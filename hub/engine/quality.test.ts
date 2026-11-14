import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farApart, impossible, sourceProblems, stuckSensors } from './quality.ts';
import { judgeRooms } from './cabin.ts';
import type { RoomAlarm, Unjudged } from './cabin.ts';
import type { Kind, Row } from './types.ts';

const MIN = 60_000;
const row = (t: number, signal: string, value: number, kind: Kind = 'measured', source = 'chip:cabin-1', room = 'quarters-2', unit = 'mmHg'): Row =>
  ({ t, signal, value, unit, kind, source, room });

test('impossible values are the ones physics rules out, and only in their own unit', () => {
  assert.ok(impossible({ signal: 'humidity', value: 101, unit: '%' }));
  assert.ok(impossible({ signal: 'humidity', value: -1, unit: '%' }));
  assert.equal(impossible({ signal: 'humidity', value: 100, unit: '%' }), null);
  assert.ok(impossible({ signal: 'pressure', value: -0.1, unit: 'hPa' }));
  assert.ok(impossible({ signal: 'co2', value: -0.01, unit: 'mmHg' }));
  assert.ok(impossible({ signal: 'temperature', value: -300, unit: 'C' }));
  assert.equal(impossible({ signal: 'temperature', value: -300, unit: 'K' }), null, 'a bound written in C says nothing about K');
  assert.ok(impossible({ signal: 'noise', value: 4096, unit: 'raw' }));
  assert.equal(impossible({ signal: 'co2', value: null, unit: 'mmHg' }), null);
  assert.equal(impossible({ signal: 'heart_rate', value: 250, unit: 'bpm' }), null, 'no medical bounds: only impossible ones');
});

test('a measured CO2 sensor repeating one exact value for over 30 minutes may be stuck; steady pressure is never called stuck', () => {
  const run = (minutes: number, signal = 'co2', kind: Kind = 'measured') =>
    Array.from({ length: minutes + 1 }, (_, m) => row(m * MIN, signal, signal === 'co2' ? 2.41 : 1013.2, kind));
  assert.equal(stuckSensors(run(29), 29 * MIN).length, 0);
  const stuck = stuckSensors(run(31), 31 * MIN);
  assert.equal(stuck.length, 1);
  assert.deepEqual([stuck[0].room, stuck[0].signal, stuck[0].value, stuck[0].since, stuck[0].readings], ['quarters-2', 'co2', 2.41, 0, 32]);
  assert.equal(stuckSensors(run(120, 'pressure'), 120 * MIN).length, 0, 'pressure is not opted in');
  assert.equal(stuckSensors(run(120, 'co2', 'replayed'), 120 * MIN).length, 0, 'only measured sources');
  assert.equal(stuckSensors(run(31), 60 * MIN).length, 0, 'a source that went quiet is "no reading", not stuck');
  const moving = run(40).map((r, i) => (i === 20 ? { ...r, value: 2.42 } : r));
  assert.equal(stuckSensors(moving, 40 * MIN).length, 0, 'one change restarts the run');
});

test('two CO2 sources are far apart only past a factor of two and half a mmHg', () => {
  assert.equal(farApart('co2', 2.8, 1.2), true);
  assert.equal(farApart('co2', 2.8, 2.4), false);
  assert.equal(farApart('co2', 0.2, 0.6), false, 'too small a gap to mean anything');
  assert.equal(farApart('pressure', 1013, 300), false, 'no rule, never contradicted');
});

test('the reading a conclusion leans on is checked: none, stale, stuck, contradicted', () => {
  const now = 100 * MIN;
  assert.equal(sourceProblems([], [], 'quarters-2', 'co2', now)[0].problem, 'no-reading');
  assert.equal(sourceProblems([row(now - 20 * MIN, 'co2', 2.9)], [], 'quarters-2', 'co2', now)[0].problem, 'stale');
  const fresh = row(now - MIN, 'co2', 2.9);
  assert.deepEqual(sourceProblems([fresh], [], 'quarters-2', 'co2', now), []);
  const stuck = [{ room: 'quarters-2', signal: 'co2', source: 'chip:cabin-1', kind: 'measured' as const, value: 2.9, since: 0, lastAt: now - MIN, readings: 90 }];
  assert.equal(sourceProblems([fresh], stuck, 'quarters-2', 'co2', now)[0].problem, 'stuck');
  const other = row(now - MIN, 'co2', 1.1, 'measured', 'chip:cabin-2');
  const c = sourceProblems([fresh, other], [], 'quarters-2', 'co2', now);
  assert.equal(c[0].problem, 'contradicted');
  assert.equal(c[0].other?.value, 1.1);
  assert.deepEqual(sourceProblems([fresh, { ...other, kind: 'simulated', source: 'sim:hub' }], [], 'quarters-2', 'co2', now), [], 'a weaker kind does not contradict');
});

test('a room alarm stays, marked stale, when its sensor goes quiet, and clears only when readings return under the limit', () => {
  const every = (from: number, minutes: number, value: number, kind: Kind = 'measured', source = 'chip:cabin-1') =>
    Array.from({ length: minutes }, (_, m) => row(from + m * MIN, 'co2', value + (m % 3) / 100, kind, source));
  let rows = every(0, 60, 3.4);
  let alarms: RoomAlarm[] = [];
  let unjudged: Unjudged[] = [];
  const step = (now: number) => {
    const out = judgeRooms(['quarters-2'], () => rows.filter((r) => r.t <= now), now, alarms, unjudged, []);
    alarms = out.alarms;
    unjudged = out.unjudged;
    return out;
  };

  step(60 * MIN);
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].stale, false);

  // The sensor goes quiet at minute 59. Twelve minutes on: still listed, stale, with its last reading.
  step(71 * MIN);
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].stale, true);
  assert.deepEqual(alarms[0].lastReading, { value: 3.42, t: 59 * MIN });
  assert.equal(alarms[0].since, 60 * MIN);

  // An hour of silence: no average at all. The room is "no reading" and the alarm is still there.
  const quiet = step(130 * MIN);
  assert.equal(alarms.length, 1, 'quiet is not under the limit');
  assert.deepEqual(quiet.unjudged.map((u) => [u.room, u.reason, u.last?.value]), [['quarters-2', 'no-reading', 3.42]]);
  assert.deepEqual(quiet.averages, {});

  // A simulated stand-in under the limit cannot clear what a measured sensor raised.
  rows = [...rows, ...every(130 * MIN, 60, 2.4, 'simulated', 'sim:hub')];
  step(190 * MIN);
  assert.equal(alarms.length, 1);

  // The sensor comes back under the limit for an hour: cleared.
  rows = [...rows, ...every(190 * MIN, 60, 2.4)];
  step(250 * MIN);
  assert.deepEqual(alarms, []);
  assert.deepEqual(unjudged, []);
});

test('a room that never had a reading is listed as unjudged, and keeps its first since', () => {
  const first = judgeRooms(['lab'], () => [], 1000, [], [], []);
  assert.deepEqual(first.unjudged, [{ room: 'lab', signal: 'co2', reason: 'no-reading', since: 1000, last: null }]);
  const later = judgeRooms(['lab'], () => [], 9000, [], first.unjudged, []);
  assert.equal(later.unjudged[0].since, 1000);
});
