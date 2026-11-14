import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREW_SOURCE, HEADACHE_MORNINGS, USUAL, crewPeriod, crewStays, heartRateAt, roomAt } from './crew.ts';
import { timeInRooms } from './timeline.ts';

const people = Object.keys(USUAL);
const DAY = 24 * 3600_000;
const start = Date.UTC(2026, 10, 10); // midnight, station time = UTC in these tests

test('the same period always gives the same crew, and every row is marked simulated', () => {
  const a = crewPeriod(people, start, start + DAY, 300_000, 0);
  const b = crewPeriod(people, start, start + DAY, 300_000, 0);
  assert.deepEqual(a, b);
  assert.ok(a.rows.length > 1000);
  assert.ok(a.rows.every((r) => r.kind === 'simulated' && r.source === CREW_SOURCE && r.person));
});

test('splitting a period in two gives the same rows as doing it at once', () => {
  const whole = crewPeriod(people, start, start + DAY, 300_000, 0);
  const first = crewPeriod(people, start, start + DAY / 3, 300_000, 0);
  const rest = crewPeriod(people, start + DAY / 3, start + DAY, 300_000, 0);
  assert.equal(first.rows.length + rest.rows.length, whole.rows.length);
  assert.equal(first.moves.length + rest.moves.length, whole.moves.length);
});

test('resting heart rate sits near the published in-flight value; exercise raises it', () => {
  for (const person of people) {
    const rows = crewPeriod([person], start, start + 3 * DAY, 300_000, 0).rows.filter((r) => r.signal === 'heart_rate');
    const awakeAtRest = rows.filter((r) => r.room === USUAL[person].workRoom).map((r) => r.value!);
    const mean = awakeAtRest.reduce((a, b) => a + b, 0) / awakeAtRest.length;
    assert.ok(Math.abs(mean - (USUAL[person].heartRate + 6)) < 2, `${person} awake mean ${mean}`);
    const asleep = heartRateAt(person, start + 3 * 3600_000, 0);
    assert.ok(Math.abs(asleep - (USUAL[person].heartRate - 6)) <= 7, `${person} asleep ${asleep}`);
    assert.ok(Math.max(...rows.filter((r) => r.room === 'gym').map((r) => r.value!)) > USUAL[person].heartRate + 40);
  }
});

test('each day has one night of sleep near the Mir figures, one mood entry and 90 minutes of exercise', () => {
  const rows = crewPeriod(['reyes'], start, start + 3 * DAY, DAY, 0).rows;
  const of = (signal: string) => rows.filter((r) => r.signal === signal).map((r) => r.value!);
  assert.equal(of('sleep_duration').length, 3);
  assert.ok(of('sleep_duration').every((v) => v >= 262 && v <= 352));
  assert.ok(of('sleep_efficiency').every((v) => v >= 57 && v <= 74));
  assert.equal(of('mood.fatigue').length, 3);
  assert.ok(of('mood.fatigue').every((v) => v >= 22 && v <= 47));
  assert.deepEqual(of('exercise_minutes'), [90, 90, 90]);
});

test('everyone sleeps in their own quarters and the day adds up to 24 hours', () => {
  assert.equal(roomAt('reyes', 2), 'quarters-2');
  assert.equal(roomAt('reyes', 17.5), 'gym');
  assert.equal(roomAt('leo', 17.5), 'lab');
  const stays = crewStays(people, start, start + DAY, 0);
  for (const person of people) {
    const time = timeInRooms(stays, person, start, start + DAY);
    assert.equal(Object.values(time).reduce((a, b) => a + b, 0), DAY);
    assert.equal(time.gym, 1.5 * 3600_000);
    assert.equal(time[USUAL[person].quarters], 10 * 3600_000);
  }
});

test('the backstory: Reyes wakes with a headache each morning, marked simulated because nobody said it', () => {
  const rows = crewPeriod(people, start, start + 3 * DAY, 300_000, 0).rows.filter((r) => r.signal === 'checkin.headache');
  assert.deepEqual(HEADACHE_MORNINGS, ['reyes']);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.person === 'reyes' && r.value === 1 && r.kind === 'simulated' && r.source === CREW_SOURCE && r.room === 'quarters-2'));
  assert.deepEqual(rows.map((r) => (r.t - start) / 3600_000), [6, 30, 54], 'three mornings at 06:00');
});
