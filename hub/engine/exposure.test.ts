import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CO2_LEVELS, HOLD_MS, aloneByDay, exposure } from './exposure.ts';
import { USUAL, crewStays } from './crew.ts';
import { timeInRooms } from './timeline.ts';
import type { Kind, Row, Stay } from './types.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const start = Date.UTC(2026, 10, 10); // midnight, station time = UTC in these tests
const people = Object.keys(USUAL);
const ROOMS = ['quarters-1', 'quarters-2', 'quarters-3', 'quarters-4', 'galley', 'lab', 'gym'];

/** Cabin CO2 for every room, one reading every `step`, from `value(room, t)`. */
function cabin(from: number, to: number, step: number, value: (room: string, t: number) => number, kind: Kind = 'simulated', source = 'sim:cabin'): Row[] {
  const rows: Row[] = [];
  for (const room of ROOMS) for (let t = from; t < to; t += step) rows.push({ t, signal: 'co2', value: value(room, t), unit: 'mmHg', kind, source: `${source}-${room}`, room });
  return rows;
}
const stay = (person: string, room: string, from: number, until: number | null): Stay => ({ person, room, from, until, kind: 'simulated', source: 's' });
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test('a full day with readings everywhere adds up to the period, with no gap', () => {
  const stays = crewStays(people, start, start + DAY, 0);
  const rows = cabin(start, start + DAY, 5 * MIN, (room) => (room === 'quarters-2' ? 3.2 : 0.8));
  const e = exposure(stays, rows, 'reyes', 'co2', start, start + DAY, CO2_LEVELS.map((l) => l.level));
  assert.deepEqual(e.rooms, timeInRooms(stays, 'reyes', start, start + DAY));
  assert.equal(Object.values(e.rooms).reduce((a, b) => a + b, 0) + e.unplaced, DAY);
  assert.equal(e.unplaced, 0);
  assert.equal(e.covered, DAY);
  assert.equal(e.gap, 0);
  // Ten hours in quarters at 3.2, fourteen elsewhere at 0.8.
  near(e.average!, (10 * 3.2 + 14 * 0.8) / 24);
  assert.deepEqual(e.above, [{ level: 2.8, ms: 10 * HOUR }, { level: 3, ms: 10 * HOUR }]);
  assert.ok(e.sources.every((s) => s.source === `sim:cabin-${s.room}` && s.kind === 'simulated'));
});

test('the time-weighted average matches a hand calculation, and a reading holds into the next stay', () => {
  const t0 = start;
  const stays = [stay('reyes', 'lab', t0, t0 + 20 * MIN), stay('reyes', 'galley', t0 + 20 * MIN, t0 + 30 * MIN)];
  const rows: Row[] = [
    { t: t0, signal: 'co2', value: 1, unit: 'mmHg', kind: 'measured', source: 'chip:lab', room: 'lab' },
    { t: t0 + 5 * MIN, signal: 'co2', value: 4, unit: 'mmHg', kind: 'measured', source: 'chip:lab', room: 'lab' },
    // Taken before she walks in; holds for her first 5 minutes in the galley.
    { t: t0 + 15 * MIN, signal: 'co2', value: 2, unit: 'mmHg', kind: 'measured', source: 'chip:galley', room: 'galley' },
  ];
  const e = exposure(stays, rows, 'reyes', 'co2', t0, t0 + 30 * MIN, [3]);
  // Lab: 1 for 5 min, 4 for 10 min (capped), then 5 min with nothing. Galley: 2 for 5 min, then nothing.
  assert.equal(e.covered, 20 * MIN);
  assert.equal(e.gap, 10 * MIN);
  near(e.average!, (1 * 5 + 4 * 10 + 2 * 5) / 20);
  assert.deepEqual(e.above, [{ level: 3, ms: 10 * MIN }]);
});

test('one source per room: the best kind wins, whatever the others say', () => {
  const stays = [stay('leo', 'lab', start, start + HOUR)];
  const rows = [
    ...cabin(start, start + HOUR, 5 * MIN, () => 0.5, 'simulated', 'sim:cabin'),
    ...cabin(start, start + HOUR, 5 * MIN, () => 2.0, 'replayed', 'nasa:iss'),
    ...cabin(start, start + HOUR, MIN, () => 1.2, 'measured', 'chip'),
  ];
  const e = exposure(stays, rows, 'leo', 'co2', start, start + HOUR);
  near(e.average!, 1.2);
  assert.equal(e.covered, HOUR);
  assert.deepEqual(e.sources.map((s) => [s.source, s.kind]), [['chip-lab', 'measured']]);
});

test('gaps are reported, not guessed, and never counted above a level', () => {
  const from = start;
  const to = start + 4 * HOUR;
  // Her stays start an hour in; the lab sensor is silent from 2:00 to 3:00.
  const stays = [stay('okafor', 'lab', from + HOUR, null)];
  const rows = cabin(from, to, 5 * MIN, () => 3.5).filter((r) => r.t < from + 2 * HOUR || r.t >= from + 3 * HOUR);
  const e = exposure(stays, rows, 'okafor', 'co2', from, to, [3]);
  assert.equal(e.unplaced, HOUR);
  assert.equal(e.rooms.lab, 3 * HOUR);
  // The 1:55 reading holds its 10 minutes into the silence, so the sensor gap is 55 minutes.
  assert.equal(e.gap, HOUR + HOUR - (HOLD_MS - 5 * MIN));
  assert.equal(e.covered + e.gap, to - from);
  assert.deepEqual(e.above, [{ level: 3, ms: e.covered }]);
  near(e.average!, 3.5);

  const none = exposure(stays, [], 'okafor', 'co2', from, to, [3]);
  assert.equal(none.average, null);
  assert.equal(none.covered, 0);
  assert.equal(none.gap, to - from);
  assert.deepEqual(none.above, [{ level: 3, ms: 0 }]);
  assert.equal(none.sources[0].source, null);
});

test('sparse readings hold for 10 minutes at most', () => {
  const stays = [stay('tanaka', 'gym', start, start + 3 * HOUR)];
  const rows = cabin(start, start + 3 * HOUR, 30 * MIN, () => 1);
  const e = exposure(stays, rows, 'tanaka', 'co2', start, start + 3 * HOUR);
  assert.equal(e.covered, HOUR);
  assert.equal(e.gap, 2 * HOUR);
});

test('person rows and other signals are ignored', () => {
  const stays = [stay('reyes', 'lab', start, start + HOUR)];
  const rows: Row[] = [
    ...cabin(start, start + HOUR, 5 * MIN, () => 1),
    { t: start, signal: 'co2', value: 9, unit: 'mmHg', kind: 'measured', source: 'x', room: 'lab', person: 'reyes' },
    { t: start, signal: 'temperature', value: 22, unit: 'C', kind: 'measured', source: 'chip-lab', room: 'lab' },
  ];
  near(exposure(stays, rows, 'reyes', 'co2', start, start + HOUR).average!, 1);
});

test('time alone per day, from the generated crew', () => {
  const stays = crewStays(people, start, start + 2 * DAY, 0);
  for (const person of people) {
    const days = aloneByDay(stays, person, start, start + 2 * DAY, 0);
    assert.equal(days.length, 2);
    for (const d of days) {
      assert.equal(d.placed, DAY);
      // Each sleeps alone in their own quarters (10 hours). Reyes and Okafor are never
      // otherwise alone; Leo has the lab to himself while they exercise (1.5 hours);
      // Tanaka works alone in the command room.
      const expected: Record<string, number> = { reyes: 10, okafor: 10, leo: 11.5 };
      if (person in expected) assert.equal(d.alone, expected[person] * HOUR, `${person} alone ${d.alone / HOUR} h`);
      else assert.ok(d.alone > 15 * HOUR, `${person} alone ${d.alone / HOUR} h`);
    }
  }
  assert.deepEqual(aloneByDay(stays, 'reyes', start, start + 2 * DAY, 0).map((d) => d.day), [start, start + DAY]);
});

test('time alone: overlapping crewmates are counted once, days follow station time, unplaced time is not alone', () => {
  const stays = [
    stay('reyes', 'lab', start + 1 * HOUR, start + 5 * HOUR),
    stay('leo', 'lab', start + 2 * HOUR, start + 3 * HOUR),
    stay('okafor', 'lab', start + 2.5 * HOUR, start + 3.5 * HOUR),
    stay('tanaka', 'galley', start, start + 6 * HOUR),
  ];
  const [d] = aloneByDay(stays, 'reyes', start, start + DAY, 0);
  assert.equal(d.placed, 4 * HOUR);
  assert.equal(d.alone, 2.5 * HOUR);

  // Station time two hours ahead: the station day began at 22:00 UTC the day before.
  const shifted = aloneByDay(stays, 'reyes', start, start + DAY, 120);
  assert.equal(shifted[0].day, start - 2 * HOUR);
  assert.equal(shifted.length, 2);
  assert.equal(shifted[0].alone + shifted[1].alone, 2.5 * HOUR);
});
