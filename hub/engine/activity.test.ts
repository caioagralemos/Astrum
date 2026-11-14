import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISE_HOLD_MS, decideActivity, estimatedExercise, settleActivity, simulatedDoing, sleepersOf } from './activity.ts';
import type { PersonInputs } from './activity.ts';
import { SHIP_PLACES } from './crew.ts';
import type { Row } from './types.ts';

const MIN = 60_000;
const T = Date.UTC(2026, 10, 14, 18, 0);
const minutes = (person: string, at: number, value: number): Row =>
  ({ t: at, signal: 'exercise_minutes', value, unit: 'min', kind: 'measured', source: `phone:${person}`, person });

test('the simulated crew: sleeping in their own quarters in the sleep block, nowhere else', () => {
  assert.equal(simulatedDoing('reyes', 2, 'quarters-2', SHIP_PLACES.reyes), 'sleeping');
  assert.equal(simulatedDoing('reyes', 2, 'galley', SHIP_PLACES.reyes), 'none', 'moved out of her cabin at night: not asleep');
  assert.equal(simulatedDoing('okafor', 2, 'quarters-2', SHIP_PLACES.okafor), 'none', 'in someone else\'s cabin');
  assert.equal(simulatedDoing('reyes', 21, 'quarters-2', SHIP_PLACES.reyes), 'none', 'the evening in her cabin is not sleep');
});

test('the simulated crew: exercising only in their own block and in the exercise room', () => {
  assert.equal(simulatedDoing('leo', 16, 'gym', SHIP_PLACES.leo), 'exercising');
  assert.equal(simulatedDoing('leo', 16, 'lab', SHIP_PLACES.leo), 'none', 'his block, but not in the gym');
  assert.equal(simulatedDoing('reyes', 16, 'gym', SHIP_PLACES.reyes), 'none', 'in the gym outside her block');
  const noGym = { ...SHIP_PLACES.leo, exercise: null };
  assert.equal(simulatedDoing('leo', 16, 'lab', noGym), 'none', 'no exercise room: no exercise');
});

test('the simulated crew: eating during meal blocks in the galley', () => {
  assert.equal(simulatedDoing('tanaka', 12.5, 'galley', SHIP_PLACES.tanaka), 'eating');
  assert.equal(simulatedDoing('tanaka', 6.5, 'galley', SHIP_PLACES.tanaka), 'eating');
  assert.equal(simulatedDoing('tanaka', 10, 'galley', SHIP_PLACES.tanaka), 'none', 'in the galley between meals');
  assert.equal(simulatedDoing('tanaka', 12.5, 'command', SHIP_PLACES.tanaka), 'none');
});

test('a real person exercises when the day\'s exercise minutes rose in the last few minutes', () => {
  const rows = [minutes('leo', T - 40 * MIN, 12), minutes('leo', T - 3 * MIN, 13), minutes('leo', T - 2 * MIN, 14), minutes('leo', T - MIN, 15)];
  assert.deepEqual(estimatedExercise(rows, T), { since: T - 3 * MIN }, 'since the first rise of the run');
  assert.notEqual(estimatedExercise(rows, T - MIN + EXERCISE_HOLD_MS), null, 'still within the hold');
  assert.equal(estimatedExercise(rows, T - MIN + EXERCISE_HOLD_MS + 1), null, 'ends a few minutes after the total stops rising');
});

test('a total that only repeats is not exercise; a new day counts from zero', () => {
  assert.equal(estimatedExercise([minutes('leo', T - 30 * MIN, 20), minutes('leo', T - MIN, 20)], T), null, 'the same total sent again');
  assert.deepEqual(estimatedExercise([minutes('leo', T - 30 * MIN, 45), minutes('leo', T - MIN, 2)], T), { since: T - MIN }, 'yesterday 45, today 2: rising');
  assert.equal(estimatedExercise([minutes('leo', T - 30 * MIN, 45), minutes('leo', T - MIN, 0)], T), null);
  assert.equal(estimatedExercise([minutes('leo', T + MIN, 30)], T), null, 'a row from the future is ignored');
  assert.equal(estimatedExercise([], T), null);
});

const inputs = (table: Record<string, Partial<PersonInputs>>) => (person: string): PersonInputs =>
  ({ room: null, real: false, exercise: [], ...table[person] });

test('a real person sitting in the exercise room with no rising exercise minutes is doing nothing known', () => {
  const out = decideActivity(['leo'], inputs({ leo: { room: 'gym', real: true, exercise: [minutes('leo', T - 2 * 3600_000, 30)] } }), T, null);
  assert.deepEqual(out.leo, { what: 'none', kind: 'estimated' });
});

test('a real person is never shown asleep or eating, whatever the hour or room; their phone outranks the simulated day', () => {
  const sim = { hour: 2, places: SHIP_PLACES };
  const night = decideActivity(['reyes'], inputs({ reyes: { room: 'quarters-2', real: true } }), T, sim);
  assert.equal(night.reyes.what, 'none', 'in her cabin at 02:00 with a phone: not guessed asleep');
  const meal = decideActivity(['tanaka'], inputs({ tanaka: { room: 'galley', real: true } }), T, { hour: 12.5, places: SHIP_PLACES });
  assert.equal(meal.tanaka.what, 'none', 'nothing measures eating');
  const running = decideActivity(['leo'], inputs({ leo: { room: 'lab', real: true, exercise: [minutes('leo', T - MIN, 5)] } }), T, sim);
  assert.deepEqual(running.leo, { what: 'exercising', kind: 'estimated', since: T - MIN }, 'the phone says so, whatever the room');
});

test('in production nothing is simulated: the schedule never speaks', () => {
  const out = decideActivity(['reyes'], inputs({ reyes: { room: 'quarters-2' } }), T, null);
  assert.deepEqual(out.reyes, { what: 'none', kind: 'estimated' });
  const demo = decideActivity(['reyes', 'stranger'], inputs({ reyes: { room: 'quarters-2' }, stranger: { room: 'quarters-2' } }), T, { hour: 2, places: SHIP_PLACES });
  assert.deepEqual(demo.reyes, { what: 'sleeping', kind: 'simulated' });
  assert.equal(demo.stranger.what, 'none', 'someone the simulated crew does not cover');
});

test('since is kept while the same thing goes on; asleep is the sleepers of the activity', () => {
  const first = settleActivity({}, { reyes: { what: 'sleeping', kind: 'simulated' }, leo: { what: 'none', kind: 'simulated' } }, T);
  const later = settleActivity(first, { reyes: { what: 'sleeping', kind: 'simulated' }, leo: { what: 'exercising', kind: 'estimated', since: T + 30_000 } }, T + MIN);
  assert.equal(later.reyes.since, T);
  assert.equal(later.leo.since, T + 30_000);
  const woke = settleActivity(later, { reyes: { what: 'none', kind: 'simulated' }, leo: { what: 'none', kind: 'estimated' } }, T + 2 * MIN);
  assert.equal(woke.reyes.since, T + 2 * MIN);
  assert.deepEqual(sleepersOf(first), ['reyes']);
  assert.deepEqual(sleepersOf(woke), []);
});
