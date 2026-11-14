import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Persistence } from './persist.ts';
import { Store, newestKey } from './db.ts';
import { Hub, STAND_IN } from './server.ts';
import { StandIn } from './standin.ts';
import { NasaReplay, NASA_SOURCE } from './nasa.ts';
import { seeded } from './scenario.ts';
import { windowAverage } from '../engine/cabin.ts';
import { stuckSensors } from '../engine/quality.ts';
import type { Profile, Row } from '../engine/types.ts';

const profile = JSON.parse(readFileSync(new URL('../profiles/mars-orbit.json', import.meta.url), 'utf8')) as Profile;
const HOUR = 3600_000;
const T0 = Date.UTC(2026, 10, 15, 3, 0);

const row = (over: Partial<Row>): Row => ({ t: T0, signal: 'co2', value: 2.4, unit: 'mmHg', kind: 'measured', source: 'chip:cabin-1', room: 'galley', ...over });

test('the rule never thins what a person reported or typed, the simulated crew, or rows with text', () => {
  const rule = new Persistence();
  const kept = (r: Row) => [0, 1000, 2000].every((dt) => rule.keep({ ...r, t: r.t + dt }));
  assert.ok(kept(row({ signal: 'checkin.headache', value: 1, unit: 'yes/no', kind: 'reported', source: 'checkin:reyes', person: 'reyes' })));
  assert.ok(kept(row({ signal: 'blood.glucose', value: 90, unit: 'mg/dL', kind: 'measured', source: 'istat:typed', person: 'reyes', room: null })));
  assert.ok(kept(row({ signal: 'heart_rate', value: 60, unit: 'bpm', kind: 'simulated', source: 'sim:crew', person: 'reyes' })));
  assert.ok(kept(row({ signal: 'heart_rate', value: 60, unit: 'bpm', kind: 'estimated', source: 'phone:reyes', person: 'reyes' })));
  assert.ok(kept(row({ value: null, text: 'connection test', kind: 'measured' })));
  assert.ok(kept(row({ kind: 'simulated', source: 'sim:other' })), 'only the stand-in\'s simulated rows are thinned');
});

test('the rule: demo rows once a minute or on a step, the replay on any change, measured every 10 s or on a step', () => {
  const rule = new Persistence();
  const stand = (dt: number, value: number) => rule.keep(row({ t: T0 + dt, value, kind: 'simulated', source: STAND_IN }));
  assert.deepEqual([stand(0, 2.40), stand(1000, 2.45), stand(2000, 2.50), stand(59_000, 2.45), stand(62_000, 2.45), stand(63_000, 2.56)], [true, false, true, false, true, true]);
  const nasa = (dt: number, value: number) => rule.keep(row({ t: T0 + dt, value, kind: 'replayed', source: NASA_SOURCE }));
  assert.deepEqual([nasa(0, 2.5), nasa(4000, 2.5), nasa(8000, 2.51), nasa(12_000, 2.51), nasa(68_000, 2.51)], [true, false, true, false, true]);
  const noise = (dt: number, value: number) => rule.keep(row({ t: T0 + dt, signal: 'noise', unit: 'raw', value }));
  assert.deepEqual([noise(0, 900), noise(1000, 1000), noise(2000, 4095), noise(3000, 950), noise(4000, 1000), noise(13_000, 1000)], [true, false, true, true, false, true], 'a clap and the reading after it are kept');
  const light = (dt: number, value: number) => rule.keep(row({ t: T0 + dt, signal: 'light', unit: 'raw', value }));
  assert.deepEqual([light(0, 1900), light(1000, 1910), light(2000, 300), light(3000, 1895)], [true, false, true, true], 'a hand over the light sensor is kept');
  const unknown = (dt: number, value: number) => rule.keep(row({ t: T0 + dt, signal: 'sound_level', unit: 'dB', value, person: 'leo', room: null, source: 'phone:leo' }));
  assert.deepEqual([unknown(0, 61.9), unknown(1000, 61.9), unknown(2000, 61.91)], [true, false, true], 'a signal with no step keeps every change');
  assert.equal(noise(-60_000, 1), true, 'a row older than the last kept is history arriving late: kept');
});

/** The hour of rows a source gives, and the same rows as the hub stores them. */
function thinned(rows: Row[]): Row[] {
  const rule = new Persistence();
  return rows.filter((r) => rule.keep(r));
}

/** What the alarm watcher reads at `now`: stored rows, plus each series' newest row if it was not stored. */
function asAlarmsRead(all: Row[], kept: Set<Row>, now: number): Row[] {
  const newest = new Map<string, Row>();
  for (const r of all) if (r.t <= now) newest.set(newestKey(r), r);
  const out = all.filter((r) => kept.has(r) && r.t <= now);
  for (const r of newest.values()) if (!kept.has(r)) out.push(r);
  return out;
}

function compareAverages(all: Row[], room: string, label: string, exact: boolean): number {
  const kept = new Set(thinned(all));
  // A noisy real sensor moves past a step often, so less of it is dropped; demo rows mostly repeat.
  assert.ok(kept.size < all.length / (label === 'measured' ? 1.5 : 10), `${label}: thinning keeps ${kept.size} of ${all.length}`);
  let worst = 0;
  const end = all[all.length - 1].t;
  for (let now = all[0].t + HOUR; now <= end; now += 10_000) {
    const full = windowAverage(all, room, 'co2', now, HOUR);
    const thin = windowAverage(asAlarmsRead(all, kept, now), room, 'co2', now, HOUR);
    assert.ok(full && thin, `${label}: both judged at ${now}`);
    const diff = Math.abs(full.value - thin.value);
    worst = Math.max(worst, diff);
    if (exact) assert.ok(diff < 1e-9, `${label}: identical at ${now} (${full.value} vs ${thin.value})`);
    assert.ok(diff < 0.005, `${label}: within rounding at ${now} (${full.value} vs ${thin.value})`);
    assert.equal(full.value > 3, thin.value > 3, `${label}: the same alarm decision at ${now}`);
  }
  return worst;
}

test('the 1-hour CO2 average over a thinned hour equals the unthinned one: exactly for the replay, within rounding otherwise', (t) => {
  const hub = new Hub(new Store(':memory:', { thin: false }), profile, '/nonexistent');
  t.after(() => hub.http.close());

  // The NASA replay as the live hub sends it, every 4 seconds, over the climb past 3 mmHg the scenario uses.
  const replay = new NasaReplay(hub, new Store(':memory:'), new URL('../data-nasa/osdr-rr1', import.meta.url).pathname, ['quarters-2']);
  const start = Date.UTC(2026, 10, 15, 3, 0);
  replay.aheadMs = Date.parse('2014-10-21T22:44:00Z') - replay.recordTime('quarters-2', start);
  const nasa: Row[] = [];
  for (let at = start; at <= start + 3 * HOUR; at += 4000) nasa.push(...replay.at(at).filter((r) => r.signal === 'co2'));
  assert.ok(nasa.some((r) => r.value! > 3), 'the record climbs past the limit');
  compareAverages(nasa, 'quarters-2', 'replay', true);

  // The stand-in, once a second, filling a room's CO2.
  const standIn = new StandIn({ hasSource: () => false } as unknown as Hub, ['lab'], seeded(7));
  const stand: Row[] = [];
  for (let at = start; at <= start + 2 * HOUR; at += 1000) stand.push(...standIn.tick(at).filter((r) => r.signal === 'co2'));
  const standWorst = compareAverages(stand, 'lab', 'stand-in', false);

  // A real CO2 sensor once a second: a slow climb with tens of ppm of noise, in mmHg.
  const random = seeded(11);
  const measured: Row[] = [];
  for (let at = start, i = 0; at <= start + 2 * HOUR; at += 1000, i++) {
    const value = 2.6 + 0.5 * (i / 7200) + (random() - 0.5) * 0.06;
    measured.push(row({ t: at, value: Number(value.toFixed(3)), room: 'galley' }));
  }
  const measuredWorst = compareAverages(measured, 'galley', 'measured', false);
  t.diagnostic(`largest difference: stand-in ${standWorst.toExponential(1)} mmHg, measured ${measuredWorst.toExponential(1)} mmHg`);
});

test('a stuck sensor is still found in thinned rows, and a jittery one is not', () => {
  const now = T0 + HOUR;
  const frozen: Row[] = [];
  const jitter: Row[] = [];
  const random = seeded(3);
  for (let at = T0; at <= now; at += 1000) {
    frozen.push(row({ t: at, signal: 'noise', unit: 'raw', value: 812, room: 'galley' }));
    jitter.push(row({ t: at, signal: 'noise', unit: 'raw', value: 800 + Math.round(random() * 40), room: 'lab' }));
  }
  const stuck = stuckSensors([...thinned(frozen), ...thinned(jitter)], now);
  assert.deepEqual(stuck.map((s) => [s.room, s.signal]), [['galley', 'noise']]);
  assert.ok(stuck[0].readings >= 30 && stuck[0].readings <= 400, `about one reading every 10 seconds: ${stuck[0].readings}`);
});

const RECENT_SQL = `
  SELECT id, MAX(t) AS t, signal, value, text, unit, kind, source, person, room FROM readings
  WHERE t >= ?
  GROUP BY signal, person, CASE WHEN person IS NULL THEN room END, source`;

test('current values from memory match the old query, as rows arrive and after a restart', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'astrum-newest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'a.sqlite');
  const store = new Store(file, { thin: false });
  const random = seeded(5);
  const sources = ['chip:cabin-1', 'sim:hub', 'nasa:osdr-rr1', 'phone:reyes'];
  const people = [null, null, 'reyes', 'leo'];
  const rooms = ['lab', 'galley', 'quarters-2', null];
  const now = T0 + 30 * HOUR;
  const rows: Row[] = [];
  for (let i = 0; i < 20_000; i++) {
    const person = people[Math.floor(random() * people.length)];
    const room = rooms[Math.floor(random() * rooms.length)] ?? (person ? null : 'lab');
    // Distinct times, so "the newest" never depends on how ties break.
    rows.push({ t: now - 30 * HOUR + i * 5000 + Math.floor(random() * 4000), signal: ['co2', 'noise', 'heart_rate', 'blood.glucose'][Math.floor(random() * 4)], value: Math.round(random() * 100), unit: 'x', kind: 'measured', source: sources[Math.floor(random() * sources.length)], person, room });
  }
  for (let i = 0; i < rows.length; i += 997) store.addRows(rows.slice(i, i + 997));
  const db = new DatabaseSync(file, { readOnly: true });
  t.after(() => db.close());
  const norm = (list: Row[]) => list.map((r) => JSON.stringify([r.id, r.t, r.signal, r.value, r.unit, r.kind, r.source, r.person ?? null, r.room ?? null])).sort();
  const since = now - 24 * HOUR;
  const sql = db.prepare(RECENT_SQL).all(since) as unknown as Row[];
  assert.ok(sql.length > 40);
  assert.deepEqual(norm(store.recent(since)), norm(sql), 'as rows arrive');
  store.close();
  const reopened = new Store(file, { thin: false });
  assert.deepEqual(norm(reopened.recent(since)), norm(sql), 'rebuilt from the database at startup');
  reopened.close();
});

test('with thinning on, current values are the newest rows that arrived, written or not', () => {
  const store = new Store(':memory:');
  const sent = store.addRows([0, 1000, 2000, 3000].map((dt) => row({ t: T0 + dt, value: 2.4, kind: 'simulated', source: STAND_IN })));
  assert.deepEqual(sent.map((r) => r.id !== undefined), [true, false, false, false], 'every row comes back; only the first was written');
  assert.equal(store.rows({}).length, 1);
  assert.deepEqual(store.recent(0).map((r) => r.t), [T0 + 3000]);
  assert.equal(store.lastTime(STAND_IN), T0 + 3000, 'the last time counts rows that were not written');
  store.close();
});
