import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from './db.ts';
import { Hub } from './server.ts';
import { RoomAlarms } from './alarms.ts';
import { AlertWatcher } from './alerts.ts';
import { DRILL_MAX_MS, DRILL_SOURCE, DRILL_VALUE, Drill, drillRoute } from './drill.ts';
import { COUNTDOWN_MS, EARTH_KEEP_MS } from '../engine/alerts.ts';
import { t as word } from '../engine/strings.ts';
import type { HubMessage, Profile } from '../engine/types.ts';

const profile = JSON.parse(readFileSync(new URL('../profiles/mars-orbit.json', import.meta.url), 'utf8')) as Profile;
const START = 1_000_000_000_000;
const HOUR = 3600_000;

/** A hub as main.ts wires it, on its own clock, with the room air under NASA's limit for the last two hours. */
async function setUp(t: TestContext, opts: { production?: boolean; story?: () => boolean; http?: boolean } = {}) {
  let now = START;
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const buzzes: string[] = [];
  hub.chipCommand = (command) => { buzzes.push((command as { buzz: string }).buzz); return true; };
  const rooms = profile.rooms.map((r) => r.id);
  const alarms = new RoomAlarms(hub, store, rooms);
  hub.acknowledgeAlarm = (room) => alarms.acknowledge(room);
  const alerts = new AlertWatcher(hub, store, profile, alarms);
  hub.answerAlert = (id, answer) => alerts.answer(id, answer, now);
  hub.seeAlert = (id, by) => alerts.see(id, by, now);
  const drill = new Drill({
    profile, alarms, alerts, production: opts.production ?? false, storyPlaying: opts.story ?? (() => false),
    roomOf: (person, at) => store.stays(at, at, person).find((s) => s.until === null)?.room ?? null, clock: () => now,
    soundBoard: () => hub.soundBoard(true),
  });
  hub.routes.push(drillRoute(drill));
  // NASA's record plays in every room: a real sensor wanders by a few hundredths.
  for (let m = -120; m <= 0; m += 5) {
    hub.ingest(rooms.map((room, i) => ({ t: START + m * 60_000, signal: 'co2', value: 2 + i / 100 + ((m / 5) % 3) / 100, unit: 'mmHg', kind: 'replayed' as const, source: 'nasa:test', room })));
  }
  hub.move('reyes', 'quarters-2', START - HOUR, 'simulated', 'sim:crew');
  hub.move('leo', 'quarters-2', START - HOUR, 'simulated', 'sim:crew');
  hub.move('okafor', 'lab', START - HOUR, 'simulated', 'sim:crew');
  hub.move('tanaka', 'command', START - HOUR, 'simulated', 'sim:crew');
  alarms.check(now);
  alerts.check(now);
  let base = '';
  if (opts.http) {
    await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(hub.http.address() as { port: number }).port}`;
  }
  t.after(() => { drill.stop(); hub.buzz('off'); if (opts.http) { hub.http.closeAllConnections(); hub.http.close(); } store.close(); });
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  /** Moves the clock and lets both watchers look, as their timers would. */
  const at = (ms: number) => { now = ms; drill.tick(now); alarms.check(now); alerts.check(now); };
  /** What a screen would be told, without the clock: everything a drill could leave behind. */
  const snapshot = () => {
    const { now: _, earthMessages: __, evidence: ___, ...rest } = hub.state(now, 'reyes') as Extract<HubMessage, { type: 'state' }>;
    return JSON.stringify({ ...rest, rows: store.rows({}).length, buzzing: buzzes.at(-1) ?? 'off' });
  };
  return { store, hub, alarms, alerts, drill, buzzes, post, at, snapshot, now: () => now };
}

test('a drill raises the real level 2 for one person, from a simulated reading that is never stored', async (t) => {
  const { store, alarms, alerts, drill, at } = await setUp(t);
  const rowsBefore = store.rows({}).length;
  const out = drill.start('reyes', null);
  assert.ok('drill' in out);
  assert.equal(out.drill.room, 'quarters-2', 'the room the hub has her in');

  const alarm = alarms.list().find((a) => a.room === 'quarters-2')!;
  assert.deepEqual([alarm.value, alarm.kind, alarm.source, alarm.drill], [DRILL_VALUE, 'simulated', DRILL_SOURCE, true], 'the 1-hour average is over at once, labelled simulated');
  const alert = alerts.list().find((a) => a.person === 'reyes')!;
  assert.deepEqual([alert.level, alert.askKey, alert.answerBy! - alert.askedAt!, alert.drill], [2, 'alert.areYouOk', COUNTDOWN_MS, true], 'the true 60-second question');
  assert.deepEqual(alert.toldTo, ['reyes', 'okafor'], 'and the Crew Medical Officer, as for a real alert');
  assert.ok(!alerts.list().some((a) => a.person === 'leo'), 'Leo shares the room, but the drill is about Reyes');
  assert.equal(store.rows({}).length, rowsBefore, 'nothing written');
  assert.equal(store.rows({}).filter((r) => r.source === DRILL_SOURCE).length, 0);

  // The stored air of Quarters 2 is unchanged: once the drill ends it judges the room again.
  at(START + 20_000);
  drill.stop();
  assert.ok(!alarms.list().some((a) => a.room === 'quarters-2'));
  assert.equal(alerts.list().length, 0);
});

test('"I am OK" in a drill answers through the real route: the alert stays at level 2, answered, while the room stays over', async (t) => {
  const { alerts, alarms, drill, buzzes, post, at } = await setUp(t, { http: true });
  drill.start('reyes', null);
  const id = alerts.list()[0].id;
  assert.equal((await post('/api/alerts/answer', { id, answer: 'ok' })).status, 200);
  assert.equal(alerts.list()[0].answer, 'ok');

  at(START + COUNTDOWN_MS + 5000);
  const after = alerts.list()[0];
  assert.deepEqual([after.level, after.answer, after.drill], [2, 'ok', true], 'no escalation: her answer holds while the room is over the limit');
  assert.equal(alerts.earthMessages().length, 0, 'nothing to Earth');
  assert.deepEqual(buzzes, [], 'no board in Quarters 2 and no level 3: silent');
  assert.ok(alarms.list().some((a) => a.room === 'quarters-2' && a.drill), 'the room alarm stays until the drill ends');

  const again = await post('/api/alerts/answer', { id, answer: 'help' });
  assert.deepEqual([again.status, again.body.code], [404, 'not-waiting'], 'answered once: a screen refreshes rather than show an error');
});

test('"I need help" in a drill is level 3 for everyone, with the card, a drill message to Earth and the board', async (t) => {
  const { alerts, drill, buzzes, post, at } = await setUp(t, { http: true });
  drill.start('reyes', null);
  const id = alerts.list()[0].id;
  assert.equal((await post('/api/alerts/answer', { id, answer: 'help' })).status, 200);
  at(START + 2000);
  const alert = alerts.list()[0];
  assert.deepEqual([alert.level, alert.toldTo, alert.card, alert.drill], [3, 'everyone', 'high-co2', true]);
  assert.deepEqual(alerts.earthMessages().map((m) => [m.id, m.drill]), [[alert.earthId, true]]);
  assert.deepEqual(buzzes, ['alarm'], 'level 3: the galley board sounds, by the normal rule');
  assert.equal((await post('/api/alerts/acknowledge', { id, by: 'leo' })).status, 200);
  assert.deepEqual(buzzes, ['alarm', 'off'], '"I\'ve seen it" silences it');
});

test('no answer in a drill escalates after the countdown; after 10 minutes it ends by itself and the message to Earth is marked resolved', async (t) => {
  const { alerts, drill, at } = await setUp(t);
  drill.start('reyes', null);
  at(START + COUNTDOWN_MS - 1000);
  assert.equal(alerts.list()[0].level, 2);
  at(START + COUNTDOWN_MS);
  assert.equal(alerts.list()[0].level, 3);
  const earthId = alerts.list()[0].earthId;

  at(START + DRILL_MAX_MS - 1000);
  assert.ok(drill.status(), 'still running a second before its time');
  at(START + DRILL_MAX_MS);
  assert.equal(drill.status(), null);
  assert.deepEqual(drill.lastEnded?.reason, 'timeout');
  assert.equal(alerts.list().length, 0);
  const message = alerts.earthMessages().find((m) => m.id === earthId)!;
  assert.deepEqual([message.drill, message.resolvedAt], [true, START + DRILL_MAX_MS], 'listed as a drill, resolved');
  at(message.replyAt + EARTH_KEEP_MS);
  assert.equal(alerts.earthMessages().length, 0, 'and it ages out like any other');
});

test('stopping a drill leaves the hub as it was: no alarm, no alert, no row, the buzzer off, the crew where it walks', async (t) => {
  const { hub, alarms, alerts, drill, buzzes, post, at, snapshot, store } = await setUp(t, { http: true });
  const before = snapshot();
  // In the galley, the room with the board: its own alarm sounds, and the normal acknowledge silences it.
  assert.ok('drill' in drill.start('reyes', 'galley'));
  assert.deepEqual(buzzes, ['alarm']);
  assert.equal((await post('/api/alarms/acknowledge', { room: 'galley' })).status, 200);
  assert.deepEqual(buzzes, ['alarm', 'off']);
  at(START + COUNTDOWN_MS);
  assert.equal(alerts.list()[0].level, 3, 'no answer');
  assert.deepEqual(buzzes, ['alarm', 'off', 'alarm'], 'a level 3 sounds again, as a real one would');
  // The simulated crew keeps walking during the drill: Reyes's stay is untouched, Leo moves.
  hub.move('leo', 'gym', START + COUNTDOWN_MS + 1000, 'simulated', 'sim:crew');
  at(START + COUNTDOWN_MS + 2000);
  assert.equal(alerts.list().filter((a) => a.person === 'reyes').length, 1, 'the engine still has her in the galley');

  assert.deepEqual((await post('/api/drill/stop', {})).body, { stopped: true });
  assert.equal((await post('/api/drill/stop', {})).body.stopped, false, 'nothing left to stop');
  assert.ok(!alarms.list().length && !alerts.list().length);
  assert.equal(buzzes.at(-1), 'off');
  assert.equal(store.rows({}).filter((r) => r.source === DRILL_SOURCE).length, 0);
  assert.equal(store.stays(0, Infinity, 'reyes').length, 1, 'her stay was never written');
  hub.move('leo', 'quarters-2', START + COUNTDOWN_MS + 3000, 'simulated', 'sim:crew');
  // Leo walked to the gym and back: the stays differ by that walk only. Everything else is as before.
  const strip = (s: string) => { const o = JSON.parse(s); delete o.stays; delete o.rows; return JSON.stringify(o); };
  assert.equal(strip(snapshot()), strip(before));
  assert.equal(store.stays(0, Infinity, 'leo').length, 3, 'the crew moved during the drill and after it');
  const messages = alerts.earthMessages();
  assert.ok(messages.length === 1 && messages[0].drill && messages[0].resolvedAt !== null, 'only the drill\'s message to Earth remains, marked and resolved');
  assert.deepEqual(hub.earth().filter((m) => !m.drill), []);
});

test('a drill is refused in production, during a recorded story, twice at once, for an unknown person, and while a real alarm is active', async (t) => {
  const prod = await setUp(t, { production: true, http: true });
  const refused = await prod.post('/api/drill/start', { person: 'reyes' });
  assert.equal(refused.status, 403);
  assert.equal(prod.drill.status(), null);

  let playing = true;
  const story = await setUp(t, { story: () => playing, http: true });
  assert.equal((await story.post('/api/drill/start', { person: 'reyes' })).status, 409);
  playing = false;
  const started = await story.post('/api/drill/start', { person: 'reyes', room: 'lab' });
  assert.equal(started.status, 200);
  assert.equal((started.body.drill as { room: string }).room, 'lab');
  assert.equal((await story.post('/api/drill/start', { person: 'leo' })).status, 409, 'one at a time');
  const status = (await (await fetch(`${'http://127.0.0.1:' + (story.hub.http.address() as { port: number }).port}/api/drill`)).json()) as { drill: { person: string } };
  assert.equal(status.drill.person, 'reyes');
  // A story that starts ends the drill.
  playing = true;
  story.at(story.now() + 2000);
  assert.deepEqual([story.drill.status(), story.drill.lastEnded?.reason], [null, 'story']);
  assert.equal(story.alerts.list().length, 0);

  const live = await setUp(t);
  assert.equal((live.drill.start('nobody', null) as { status: number }).status, 400);
  assert.equal((live.drill.start('reyes', 'nowhere') as { status: number }).status, 400);
  // A real alarm in the galley: no drill while it lasts.
  for (let m = 0; m <= 60; m += 5) live.hub.ingest([{ t: START - HOUR + m * 60_000, signal: 'co2', value: 3.5 + (m % 10) / 1000, unit: 'mmHg', kind: 'replayed', source: 'nasa:test', room: 'galley' }]);
  live.at(START);
  assert.ok(live.alarms.list().some((a) => a.room === 'galley' && !a.drill));
  assert.equal((live.drill.start('reyes', null) as { status: number }).status, 409);
});

test('a real alarm that appears during a drill ends it, even one hidden under the drill\'s own reading', async (t) => {
  const { hub, alarms, drill, at } = await setUp(t);
  drill.start('reyes', null);
  // Quarters 2's own stored air climbs past the limit under the drill's reading.
  for (let m = 0; m <= 60; m += 5) hub.ingest([{ t: START - HOUR + m * 60_000 + 1000, signal: 'co2', value: 3.6 + (m % 10) / 1000, unit: 'mmHg', kind: 'measured', source: 'chip:test', room: 'quarters-2' }]);
  at(START + 10_000);
  at(START + 12_000);
  assert.deepEqual([drill.status(), drill.lastEnded?.reason], [null, 'real-alarm']);
  const real = alarms.list().find((a) => a.room === 'quarters-2')!;
  assert.deepEqual([real.drill, real.kind], [undefined, 'measured'], 'the real alarm takes over, unmarked');
});

test('the drill\'s words exist in English and Portuguese and say Drill / Simulado', () => {
  for (const key of ['drill.badge', 'drill.alert', 'drill.alarm', 'drill.earth']) {
    assert.match(word(key, 'en'), /^Drill/);
    assert.match(word(key, 'pt'), /^Simulado/);
  }
});

test('while a recorded story plays, the hub refuses answers and acknowledgements with code "recorded"', async (t) => {
  const { hub, post } = await setUp(t, { http: true });
  hub.takeScreens(() => hub.state());
  const answer = await post('/api/alerts/answer', { id: 'reyes|room-limit|quarters-2|co2', answer: 'ok' });
  assert.deepEqual([answer.status, answer.body.code], [409, 'recorded']);
  const seen = await post('/api/alerts/acknowledge', { id: 'reyes|room-limit|quarters-2|co2', by: 'leo' });
  assert.deepEqual([seen.status, seen.body.code], [409, 'recorded']);
  hub.releaseScreens();
});
