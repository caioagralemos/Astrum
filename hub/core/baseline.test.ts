// The baselines kept in memory (core/baseline.ts) against the function they
// stand in for: personSummary() on the rows read from the database, on random
// streams of rows, refreshed as the clock moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './db.ts';
import { BASELINE_LIMIT, BASELINE_MS, Baselines, PersonRows, summaryOf } from './baseline.ts';
import { seeded } from './scenario.ts';
import { personSummary, stateWithSleep } from '../engine/baseline.ts';
import type { Row } from '../engine/types.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const OFFSET = -180;
const people = ['reyes', 'leo'];

/** The baseline as it was computed before: every row from the database, through personSummary. */
function reference(store: Store, person: string, now: number) {
  const rows = store.rows({ person, from: now - BASELINE_MS, to: now, limit: BASELINE_LIMIT });
  return personSummary(rows, person, now, { stateOf: stateWithSleep(OFFSET) });
}

/** Random rows of one or more people: dense heart rate, daily values, gaps, nulls, late and early rows, ties. */
function randomRows(random: () => number, from: number, to: number, stepMs: number): Row[] {
  const rows: Row[] = [];
  const rooms = ['quarters-2', 'lab', 'gym', 'galley'];
  for (let t = from; t <= to; t += stepMs) {
    for (const person of people) {
      if (random() < 0.03) continue; // a gap
      const room = rooms[Math.floor(random() * rooms.length)];
      const exercising = room === 'gym';
      rows.push({ t, signal: 'heart_rate', value: Math.round((exercising ? 110 : 60) + (random() - 0.5) * 12 + (random() < 0.002 ? 40 : 0)), unit: 'bpm', kind: random() < 0.1 ? 'measured' : 'simulated', source: 'sim:crew', person, room });
      if (random() < 0.002) rows.push({ t, signal: 'heart_rate', value: null, text: null, unit: 'bpm', kind: 'reported', source: 'checkin:x', person, room });
      if (random() < stepMs / (8 * HOUR)) rows.push({ t, signal: 'sleep_duration', value: Math.round(300 + (random() - 0.5) * 90), unit: 'min', kind: 'simulated', source: 'sim:crew', person, room: 'quarters-2' });
      if (random() < stepMs / (6 * HOUR)) rows.push({ t, signal: 'blood_oxygen', value: Math.round(96 + (random() - 0.5) * 4), unit: '%', kind: 'measured', source: `phone:${person}`, person, room: null });
      if (random() < 0.01) rows.push({ t, signal: 'heart_rate', value: 61, unit: 'bpm', kind: 'measured', source: `phone:${person}`, person, room }); // same moment, another source
    }
  }
  return rows;
}

test('kept in memory, the baseline is the same as personSummary on the database, refresh after refresh', () => {
  for (const seed of [1, 2, 3]) {
    const random = seeded(seed);
    const store = new Store(':memory:', { thin: false });
    const baselines = new Baselines(store, people, OFFSET);
    const start = Date.UTC(2026, 10, 1);
    // A history fill, then the clock moving in uneven steps with rows arriving: some late (older than the newest), some a little early.
    store.addRows(randomRows(random, start - 4 * DAY, start, 5 * MIN));
    let now = start;
    for (let i = 0; i < 40; i++) {
      const step = Math.floor(random() * 3 * HOUR) + MIN;
      const fresh = randomRows(random, now + 1, now + step, 30_000);
      const late = randomRows(random, now - 6 * HOUR, now - 5 * HOUR, 20 * MIN);
      const early = random() < 0.3 ? randomRows(random, now + step + 1, now + step + 5000, 5000) : [];
      store.addRows([...fresh, ...late, ...early].sort(() => random() - 0.5));
      now += step;
      for (const person of people) assert.deepEqual(baselines.refresh(person, now), reference(store, person, now), `seed ${seed}, step ${i}, ${person}`);
    }
    // A clock that goes back reads the database, and still agrees.
    for (const person of people) assert.deepEqual(baselines.refresh(person, now - 2 * DAY), reference(store, person, now - 2 * DAY));
    store.close();
  }
});

test('past the store\'s 50,000-row read, the newest rows count, exactly as the database gives them', () => {
  const random = seeded(9);
  const store = new Store(':memory:', { thin: false });
  const baselines = new Baselines(store, ['reyes'], OFFSET);
  const start = Date.UTC(2026, 10, 1);
  const rows: Row[] = [];
  // 60,000 rows in 3.5 days, several at the same moment.
  for (let i = 0; i < 60_000; i++) rows.push({ t: start + Math.floor(i / 3) * 15_000, signal: i % 3 === 2 ? 'hrv' : 'heart_rate', value: 50 + Math.floor(random() * 30), unit: 'x', kind: 'simulated', source: `s${i % 3}`, person: 'reyes', room: i % 7 ? 'lab' : 'gym' });
  store.addRows(rows);
  const now = start + 3.6 * DAY;
  assert.deepEqual(baselines.refresh('reyes', now), reference(store, 'reyes', now));
  store.addRows([{ t: now + 1000, signal: 'heart_rate', value: 140, unit: 'x', kind: 'measured', source: 'p', person: 'reyes', room: 'lab' }]);
  assert.deepEqual(baselines.refresh('reyes', now + 2000), reference(store, 'reyes', now + 2000));
  store.close();
});

test('rows the store did not write never count, as before', () => {
  const store = new Store(':memory:');
  const baselines = new Baselines(store, ['reyes'], OFFSET);
  const t0 = Date.UTC(2026, 10, 1);
  // Measured rows inside 10 seconds that only repeat are not written (core/persist.ts).
  const rows: Row[] = [];
  for (let i = 0; i < 2000; i++) rows.push({ t: t0 + i * 2000, signal: 'heart_rate', value: 60 + (i % 2), unit: 'bpm', kind: 'measured', source: 'phone:reyes', person: 'reyes', room: 'lab' });
  store.addRows(rows);
  const now = t0 + 2000 * 2000;
  assert.deepEqual(baselines.refresh('reyes', now), reference(store, 'reyes', now));
  store.close();
});

test('PersonRows: the window is the store\'s read, and trimming keeps what a later window needs', () => {
  const kept = new PersonRows([]);
  const r = (t: number, id: number): Row => ({ id, t, signal: 's', value: 1, unit: '', kind: 'simulated', source: 'x', person: 'p', room: null });
  for (const [t, id] of [[5, 2], [3, 1], [5, 3], [9, 4], [1, 5]]) kept.add(r(t, id));
  assert.deepEqual(kept.window(2, 8, 10).map((x) => x.id), [1, 2, 3]);
  assert.deepEqual(kept.window(0, 9, 2).map((x) => x.id), [3, 4], 'the newest two, by time then id');
  kept.trim(BASELINE_MS + 4);
  assert.deepEqual(kept.window(5, 9, 10).map((x) => x.id), [2, 3, 4]);
  assert.equal(summaryOf([], 'p', 0).signals.length, 0);
});
