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

// ---------- anyone else in a crew ----------

test('a fifth and sixth crewmate get full simulated readings, centred on one STS-40 subject\'s in-flight row each', async () => {
  const { SUBJECT_ROWS, subjectOf, usualOf, placesOf } = await import('./crew.ts');
  const { simulatedDoing } = await import('./activity.ts');
  const { readFileSync } = await import('node:fs');
  const ship = JSON.parse(readFileSync(new URL('../profiles/missions/ship-mars-orbit.json', import.meta.url), 'utf8'));
  ship.crew.push({ id: 'marcos', name: 'Marcos', role: 'role.engineer', pronouns: 'they', quarters: 'quarters-1', work: 'lab' });
  ship.crew.push({ id: 'valentina', name: 'Valentina', role: 'role.scientist', pronouns: 'they', quarters: 'quarters-3', work: 'command' });
  const places = placesOf(ship);
  assert.deepEqual(SUBJECT_ROWS.map((r) => [r.subject, r.heartRate, `${r.systolic}/${r.diastolic}`]),
    [[1, 66, '127/74'], [2, 52, '106/56'], [3, 58, '112/61'], [4, 57, '117/74'], [5, 54, '108/72'], [6, 59, '108/66']], 'the six in-flight rows as printed');

  const days = 5;
  const { rows } = crewPeriod([...people, 'marcos', 'valentina'], start, start + days * DAY, 300_000, 0, places);
  for (const person of ['marcos', 'valentina']) {
    const row = subjectOf(person);
    assert.ok(SUBJECT_ROWS.includes(row));
    assert.deepEqual(subjectOf(person), row, 'the same id always takes the same row');
    const u = usualOf(person, places);
    assert.equal(u.heartRate, row.heartRate);
    assert.ok([15.5, 17].includes(u.gymHour));
    const mine = rows.filter((r) => r.person === person);
    assert.ok(mine.every((r) => r.kind === 'simulated' && r.source === CREW_SOURCE));
    const signals = new Set(mine.map((r) => r.signal));
    for (const s of ['heart_rate', 'sleep_duration', 'sleep_efficiency', 'sleep_awakenings', 'blood_pressure_systolic', 'blood_pressure_diastolic', 'mood.stress', 'mood.fatigue', 'mood.sleepy', 'exercise_minutes']) {
      assert.ok(signals.has(s), `${person} has ${s}`);
    }
    const work = places[person].work;
    const awake = mine.filter((r) => r.signal === 'heart_rate' && r.room === work).map((r) => r.value!);
    const mean = awake.reduce((a, b) => a + b, 0) / awake.length;
    assert.ok(Math.abs(mean - (row.heartRate + 6)) < 2, `${person} awake mean ${mean} near subject ${row.subject}`);
    const sys = mine.filter((r) => r.signal === 'blood_pressure_systolic').map((r) => r.value!);
    assert.ok(Math.abs(sys.reduce((a, b) => a + b, 0) / sys.length - row.systolic) <= 4, `${person} systolic near ${row.systolic}`);
    assert.ok(mine.filter((r) => r.signal === 'heart_rate' && r.room === 'gym').some((r) => r.value! > row.heartRate + 40), 'exercise raises it');
    assert.equal(simulatedDoing(person, 3, places[person].quarters, places[person]), 'sleeping');
  }
  // The four are untouched by the newcomers.
  assert.deepEqual(rows.filter((r) => people.includes(r.person!)), crewPeriod(people, start, start + days * DAY, 300_000, 0, places).rows);
  const stays = crewStays(['marcos'], start, start + DAY, 0, places);
  assert.equal(stays[0].room, places.marcos.quarters, 'asleep in their own quarters at midnight');
});

test('the four on the ship: byte for byte the generator\'s output before anyone else could have readings', async () => {
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const { placesOf } = await import('./crew.ts');
  const out: unknown[] = [crewPeriod(people, start, start + 3 * DAY, 300_000, 0), crewPeriod(people, start, start + DAY, 5000, -180), crewStays(people, start, start + 2 * DAY, 60)];
  for (const f of ['iss', 'base-mars', 'base-moon', 'ship-mars-orbit']) {
    const m = JSON.parse(readFileSync(new URL(`../profiles/missions/${f}.json`, import.meta.url), 'utf8'));
    out.push(crewPeriod(people, start, start + 2 * DAY, 60_000, 60, placesOf(m)));
  }
  // Changed on 14 Nov 2026 for the ISS part only: Reyes works in Tranquility, the exercise room, and her heart
  // rate there went thousands of bpm below zero outside her exercise block. The ship and both bases are unchanged.
  assert.equal(createHash('sha256').update(JSON.stringify(out)).digest('hex'), '3927db3bcc3d06b4f1078336c06d4933ad291f08627006daa7cf1e0a1280da08');
});

test('on the ISS a crewmate who works in the exercise room keeps a plausible heart rate all day, and rises only in the exercise block', async () => {
  const { readFileSync } = await import('node:fs');
  const { placesOf, partOfDay, stationHour } = await import('./crew.ts');
  const iss = JSON.parse(readFileSync(new URL('../profiles/missions/iss.json', import.meta.url), 'utf8'));
  const places = placesOf(iss);
  assert.equal(places.reyes.work, places.reyes.exercise, 'the case this guards: work room and exercise room are the same');
  const start = Date.UTC(2026, 10, 14, 3);
  for (let t = start; t < start + 24 * 3600_000; t += 5 * 60_000) {
    const hr = heartRateAt('reyes', t, -180, places);
    assert.ok(hr > 35 && hr < 130, `heart rate ${hr} at ${new Date(t).toISOString()}`);
    if (partOfDay('reyes', stationHour(t, -180)) === 'work') assert.ok(hr < USUAL.reyes.heartRate + 15, `work at ${hr} bpm`);
  }
  assert.ok(heartRateAt('reyes', start + 17.5 * 3600_000, -180, places) > USUAL.reyes.heartRate + 40, 'the exercise block still raises it');
});
