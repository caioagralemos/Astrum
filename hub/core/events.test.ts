import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './db.ts';
import { Hub } from './server.ts';
import { RoomAlarms } from './alarms.ts';
import { AlertWatcher } from './alerts.ts';
import { AHEAD_MAX_MS, BaseEvents } from './events.ts';
import { EVENT_KINDS, boardSounds, visibleTo } from '../engine/alerts.ts';
import type { Alert } from '../engine/alerts.ts';
import { t as word } from '../engine/strings.ts';
import type { Profile } from '../engine/types.ts';

const profile = JSON.parse(readFileSync(new URL('../profiles/mars-orbit.json', import.meta.url), 'utf8')) as Profile;
const START = 1_000_000_000_000;
const HOUR = 3600_000;
const CARDS = new Set((JSON.parse(readFileSync(new URL('../medical/cards.json', import.meta.url), 'utf8')) as { id: string }[]).map((c) => c.id));

function setUp(t: TestContext, opts: { story?: () => boolean; file?: string | null; clock?: { now: number } } = {}) {
  const clock = opts.clock ?? { now: START };
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  hub.chipCommand = () => true;
  const alarms = new RoomAlarms(hub, store, profile.rooms.map((r) => r.id));
  const alerts = new AlertWatcher(hub, store, profile, alarms);
  const events = new BaseEvents({ profile, alerts, storyPlaying: opts.story ?? (() => false), cardUsable: (id) => CARDS.has(id), file: opts.file ?? null, clock: () => clock.now });
  t.after(() => { hub.buzz('off'); store.close(); });
  const at = (ms: number) => { clock.now = ms; alerts.check(ms); };
  const declared = (): Alert[] => alerts.list().filter((a) => a.reason === 'declared');
  return { events, alerts, at, declared, clock };
}

const crew = profile.crew.map((p) => p.id);
const room = profile.rooms[0].id;

test('a declared dust storm is one level 3 alert every viewer sees, with a message to Earth and the buzzer', (t) => {
  const { events, alerts, declared } = setUp(t);
  const out = events.declare({ kind: 'dust_storm', by: crew[0], shelter: room, note: 'All inside.' });
  assert.ok('event' in out);
  assert.equal(declared().length, 1);
  const a = declared()[0];
  assert.equal(a.level, 3);
  assert.equal(a.kind, 'reported');
  assert.equal(a.value, null);
  assert.equal(a.card, null, 'no card of hers covers a dust storm');
  assert.equal(a.askKey, null);
  assert.equal(a.declared?.stage, 'event');
  assert.equal(a.declared?.note, 'All inside.');
  assert.equal(a.declared?.shelter, room);
  for (const viewer of [...crew, 'common']) assert.ok(visibleTo(alerts.list(), viewer).some((x) => x.id === a.id), viewer);
  assert.ok(alerts.earthMessages().some((m) => m.id === a.earthId));
  assert.equal(boardSounds([room], [], alerts.list()), true);
  assert.equal(word('event.declaredBy', 'en', { name: 'Reyes', time: '14:05' }), 'Declared by Reyes at 14:05');
});

test('a card is attached only where one of hers plainly covers the kind', (t) => {
  const { events, declared } = setUp(t);
  const expected: Record<string, string | null> = { dust_storm: null, solar_particle_event: 'decompression-radiation', pressure_loss: 'decompression-radiation', fire: 'smoke-toxic-air', quake: null, meteoroid_impact: null, other: null };
  for (const kind of EVENT_KINDS) assert.ok('event' in events.declare({ kind, by: crew[0] }), kind);
  for (const a of declared()) assert.equal(a.card, expected[a.declared!.kind], a.declared!.kind);
});

test('unknown kind, person, room, a long note and a story playing are refused', (t) => {
  let story = false;
  const { events, declared } = setUp(t, { story: () => story });
  assert.equal((events.declare({ kind: 'meteor', by: crew[0] }) as { status: number }).status, 400);
  assert.equal((events.declare({ kind: 'fire', by: 'nobody' }) as { status: number }).status, 400);
  assert.equal((events.declare({ kind: 'fire', by: crew[0], shelter: 'attic' }) as { status: number }).status, 400);
  assert.equal((events.declare({ kind: 'fire', by: crew[0], note: 'x'.repeat(281) }) as { status: number }).status, 400);
  assert.equal((events.declare({ kind: 'fire', by: crew[0], source: 'sensor' }) as { status: number }).status, 400);
  story = true;
  assert.equal((events.declare({ kind: 'fire', by: crew[0] }) as { status: number }).status, 409);
  assert.equal(declared().length, 0);
});

test('a second declare of the same kind is refused; end clears it', (t) => {
  const { events, alerts, declared } = setUp(t);
  const first = events.declare({ kind: 'fire', by: crew[0] });
  assert.ok('event' in first);
  assert.equal((events.declare({ kind: 'fire', by: crew[1] }) as { status: number }).status, 409);
  assert.ok('ended' in events.end(first.event.id, crew[1]));
  assert.equal(declared().length, 0);
  assert.equal(events.list().length, 0);
  assert.ok(alerts.earthMessages().every((m) => m.resolvedAt !== null));
  assert.ok('event' in events.declare({ kind: 'fire', by: crew[1] }));
});

test('declared ahead: a level 2 notice with no question, no card, no buzzer, no Earth; level 3 at the time', (t) => {
  const { events, alerts, at, declared } = setUp(t);
  const out = events.declare({ kind: 'solar_particle_event', by: crew[0], expectedAt: START + 6 * HOUR, source: 'earth' });
  assert.ok('event' in out);
  let a = declared()[0];
  assert.equal(a.level, 2);
  assert.equal(a.notice, true);
  assert.equal(a.askKey, null);
  assert.equal(a.answerBy, null);
  assert.equal(a.card, null);
  assert.equal(a.toldTo, 'everyone');
  assert.equal(a.declared?.stage, 'warning');
  assert.equal(a.declared?.source, 'earth');
  assert.equal(a.declared?.expectedAt, START + 6 * HOUR);
  assert.equal(alerts.earthMessages().length, 0);
  assert.equal(boardSounds([room], [], alerts.list()), false);
  assert.equal(alerts.answer(a.id, 'help', START), false, 'a notice cannot be answered');
  assert.equal(alerts.see(a.id, crew[1], START), true, 'a notice can be acknowledged');
  at(START + 6 * HOUR - 1000);
  assert.equal(declared()[0].level, 2);
  at(START + 6 * HOUR);
  a = declared()[0];
  assert.equal(declared().length, 1);
  assert.equal(a.id, out.event.id, 'the same alert, not a second one');
  assert.equal(a.level, 3);
  assert.equal(a.notice, undefined);
  assert.equal(a.seenAt, null, 'level 3 is heard again');
  assert.equal(a.card, 'decompression-radiation');
  assert.equal(a.declared?.stage, 'event');
  assert.equal(alerts.earthMessages().length, 1);
  assert.equal(boardSounds([room], [], alerts.list()), true);
});

test('a quake and a meteoroid impact: warning ahead, then the event with its words only, then ended', (t) => {
  for (const kind of ['quake', 'meteoroid_impact'] as const) {
    const { events, at, declared } = setUp(t);
    const out = events.declare({ kind, by: crew[0], expectedAt: START + HOUR });
    assert.ok('event' in out, kind);
    let a = declared()[0];
    assert.equal(a.signal, `event.${kind}`);
    assert.equal(a.level, 2);
    assert.equal(a.notice, true);
    assert.equal(a.declared?.stage, 'warning');
    assert.equal(a.declared?.expectedAt, START + HOUR);
    assert.equal(a.card, null);
    at(START + HOUR);
    a = declared()[0];
    assert.equal(a.level, 3);
    assert.equal(a.declared?.stage, 'event');
    assert.equal(a.card, null, 'no card of hers covers it: no steps are made up');
    assert.ok('ended' in events.end(out.event.id, crew[1]));
    assert.equal(declared().length, 0);
    assert.notEqual(word(`event.${kind}`, 'en'), `event.${kind}`);
    assert.notEqual(word(`event.${kind}`, 'pt'), `event.${kind}`);
  }
});

test('update moves the time or cancels; past and too-far times are refused', (t) => {
  const { events, at, declared } = setUp(t);
  assert.equal((events.declare({ kind: 'dust_storm', by: crew[0], expectedAt: START - 1 }) as { status: number }).status, 400);
  assert.equal((events.declare({ kind: 'dust_storm', by: crew[0], expectedAt: START + AHEAD_MAX_MS + 1 }) as { status: number }).status, 400);
  const out = events.declare({ kind: 'dust_storm', by: crew[0], expectedAt: START + HOUR });
  assert.ok('event' in out);
  const id = out.event.id;
  assert.equal((events.update({ id, by: crew[1], expectedAt: START - 1 }) as { status: number }).status, 400);
  assert.ok('event' in events.update({ id, by: crew[1], expectedAt: START + 3 * HOUR }));
  at(START + 2 * HOUR);
  assert.equal(declared()[0].level, 2);
  assert.equal(declared()[0].declared?.expectedAt, START + 3 * HOUR);
  assert.ok('cancelled' in events.update({ id, by: crew[1], cancel: true }));
  assert.equal(declared().length, 0);
  at(START + 4 * HOUR);
  assert.equal(declared().length, 0);
});

test('a pending event survives a restart, and becomes level 3 if its time passed while the hub was down', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'astrum-events-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'events.json');
  const first = setUp(t, { file });
  const out = first.events.declare({ kind: 'pressure_loss', by: crew[0], expectedAt: START + HOUR });
  assert.ok('event' in out);
  const later = setUp(t, { file, clock: { now: START + 2 * HOUR } });
  later.at(START + 2 * HOUR);
  const a = later.declared()[0];
  assert.equal(a.id, out.event.id);
  assert.equal(a.level, 3);
  assert.equal(a.declared?.expectedAt, START + HOUR, 'it still says when it was expected');
  assert.equal(a.card, 'decompression-radiation');
});
