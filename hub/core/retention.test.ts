// Tiered retention (core/retention.ts) on a small synthetic database: what the
// hub reads back is the same after compaction, and nothing it must keep is lost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './db.ts';
import { Retention, TIERS } from './retention.ts';
import { CrewDose } from './dose.ts';
import { Baselines } from './baseline.ts';
import { seeded } from './scenario.ts';
import { exposure } from '../engine/exposure.ts';
import { windowAverage } from '../engine/cabin.ts';
import type { Profile, Row } from '../engine/types.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 9, 20);
const NOW = START + 20 * DAY;

const profile: Profile = {
  id: 'test', place: 'place.mars-orbit', missionStart: new Date(START).toISOString(), delayToEarthSeconds: 0,
  rooms: [{ id: 'lab', name: 'room.lab' }, { id: 'galley', name: 'room.galley' }],
  crew: [{ id: 'ana', name: 'Ana', role: 'role.cmo' }, { id: 'ben', name: 'Ben', role: 'role.commander' }],
  chips: {},
  mission: { id: 'test', file: 'test', kind: 'ship', where: { body: 'mars', situation: 'orbit' }, gravity: 0, plannedDays: 30 },
};

/** Twenty days of a small station: replayed CO2, stand-in radiation and pressure, a board, two bodies, check-ins, a blood result, stays. */
function station(): Store {
  const random = seeded(4);
  const store = new Store(':memory:', { thin: false });
  const rows: Row[] = [];
  let rad = 320;
  for (let t = START; t <= NOW; t += MIN) {
    if (random() < 0.08) rad += random() < 0.5 ? -1 : 1;
    for (const room of ['lab', 'galley']) {
      rows.push({ t, signal: 'radiation', value: rad + (room === 'lab' ? 30 : 0), unit: 'uGy/day', kind: 'simulated', source: 'sim:hub', room });
      if (random() < 0.05) rows.push({ t: t + 20_000, signal: 'radiation', value: rad + 2, unit: 'uGy/day', kind: 'simulated', source: 'sim:hub', room });
      rows.push({ t, signal: 'co2', value: Number((2.4 + 0.4 * Math.sin(Math.floor(t / (5 * MIN)) / 40)).toFixed(2)), unit: 'mmHg', kind: 'replayed', source: 'nasa:osdr-rr1', room });
      rows.push({ t, signal: 'pressure', value: Number((1013 + random()).toFixed(1)), unit: 'hPa', kind: 'simulated', source: 'sim:hub', room });
    }
    if (random() < 0.9) rows.push({ t: t + 5000, signal: 'noise', value: 250 + Math.round(random() * 40), unit: 'raw', kind: 'measured', source: 'chip:cabin-1', room: 'galley' });
  }
  for (let t = START; t <= NOW; t += 15_000) {
    for (const person of ['ana', 'ben']) rows.push({ t, signal: 'heart_rate', value: 58 + Math.round(random() * 10), unit: 'bpm', kind: 'simulated', source: 'sim:crew', person, room: random() < 0.1 ? 'gym' : 'lab' });
  }
  for (let d = 0; d < 20; d++) {
    rows.push({ t: START + d * DAY + 6 * HOUR, signal: 'checkin.note', value: null, text: `day ${d}`, unit: '', kind: 'reported', source: 'checkin:ana', person: 'ana', room: null });
    rows.push({ t: START + d * DAY + 6 * HOUR + 1000, signal: 'checkin.headache', value: 1, unit: 'yes/no', kind: 'reported', source: 'checkin:ana', person: 'ana', room: null });
  }
  rows.push({ t: START + 2 * DAY, signal: 'blood.glucose', value: 90, unit: 'mg/dL', kind: 'measured', source: 'istat:typed', person: 'ben', room: null });
  store.addRows(rows);
  for (let d = 0; d < 20; d++) {
    store.moveTo('ana', 'lab', START + d * DAY, 'simulated', 'sim:crew');
    store.moveTo('ana', 'galley', START + d * DAY + 13 * HOUR + 7 * MIN, 'simulated', 'sim:crew');
    store.moveTo('ben', 'galley', START + d * DAY + 2 * HOUR, 'simulated', 'sim:crew');
    store.moveTo('ben', 'lab', START + d * DAY + 15 * HOUR, 'simulated', 'sim:crew');
  }
  // An alarm five days ago: its raw rows are held.
  store.holdRaw('alarm|lab|co2|x', NOW - 5 * DAY - 2 * HOUR, NOW - 5 * DAY + 3 * HOUR);
  return store;
}

const close = (a: number | null, b: number | null) => a === b || (a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));

/** Everything checked: dose since the mission start, CO2 exposure over 72 and 24 hours, 1-hour averages, baselines. */
function readBack(store: Store, baselines = new Baselines(store, ['ana', 'ben'], -180)) {
  const dose = new CrewDose(store, profile).refresh(NOW);
  const cabin = store.sampled('co2', NOW - 72 * HOUR, NOW, MIN);
  const stays = store.stays(NOW - 72 * HOUR, NOW);
  const exposures = ['ana', 'ben'].flatMap((p) => [72, 24].map((h) => exposure(stays, cabin, p, 'co2', NOW - h * HOUR, NOW, [2.5, 3])));
  const averages = [1, 30, 71].map((h) => windowAverage(store.rows({ room: 'lab', signal: 'co2', from: NOW - h * HOUR - 2 * HOUR, to: NOW - h * HOUR, limit: 50_000 }), 'lab', 'co2', NOW - h * HOUR, HOUR));
  const summaries = ['ana', 'ben'].map((p) => baselines.refresh(p, NOW));
  return { dose, exposures, averages, summaries };
}

test('after compaction: dose, CO2 exposure, 1-hour averages and baselines are the same; restart too', () => {
  const store = station();
  const live = new Baselines(store, ['ana', 'ben'], -180);
  const before = readBack(store, live);
  const rowsBefore = store.rows({ from: 0, limit: 50_000 }).length;
  const count = () => (store.handle.prepare('SELECT COUNT(*) AS n FROM readings').get() as { n: number }).n;
  const n0 = count();
  new Retention(store.handle).runAll(NOW);
  const n1 = count();
  assert.ok(n1 < n0 * 0.6, `rows ${n0} -> ${n1}`);
  const after = readBack(store, live);
  const restarted = readBack(store);
  for (const got of [after, restarted]) {
    for (const p of ['ana', 'ben']) {
      const a = before.dose[p].amounts[0];
      const b = got.dose[p].amounts[0];
      assert.ok(close(a.mission, b.mission) && close(a.today, b.today), `dose ${p}: ${a.mission} vs ${b.mission}`);
    }
    before.exposures.forEach((e, i) => {
      assert.ok(close(e.average, got.exposures[i].average) && close(e.covered, got.exposures[i].covered), `exposure ${i}`);
      e.above.forEach((x, j) => assert.ok(close(x.ms, got.exposures[i].above[j].ms), `time above ${x.level}`));
    });
    before.averages.forEach((a, i) => assert.ok(close(a?.value ?? null, got.averages[i]?.value ?? null), `1-hour average ${i}`));
    assert.deepEqual(got.summaries, before.summaries, 'baselines identical');
  }
  assert.ok(rowsBefore > 0);
  store.close();
});

test('never thinned: reported rows, text, blood, held windows; summaries keep one series and its kind', () => {
  const store = station();
  const q = (sql: string) => (store.handle.prepare(sql).get() as { n: number }).n;
  const kept = () => [q("SELECT COUNT(*) AS n FROM readings WHERE kind = 'reported'"), q("SELECT COUNT(*) AS n FROM readings WHERE text IS NOT NULL"), q("SELECT COUNT(*) AS n FROM readings WHERE signal LIKE 'blood.%'")];
  const heldRaw = () => q(`SELECT COUNT(*) AS n FROM readings WHERE summary IS NULL AND t BETWEEN ${NOW - 5 * DAY - 2 * HOUR} AND ${NOW - 5 * DAY + 3 * HOUR}`);
  const before = kept();
  const heldBefore = heldRaw();
  new Retention(store.handle).runAll(NOW);
  assert.deepEqual(kept(), before);
  assert.equal(heldRaw(), heldBefore, 'raw rows around the alarm untouched');
  const old = store.rows({ room: 'lab', signal: 'pressure', from: START, to: START + DAY, limit: 5000 });
  assert.ok(old.length > 0 && old.every((r) => r.summary && r.summary.ms === TIERS.coarseBucketMs && r.kind === 'simulated' && r.source === 'sim:hub'), 'hourly summaries, still simulated, still the stand-in');
  const mid = store.rows({ room: 'lab', signal: 'pressure', from: NOW - 10 * DAY, to: NOW - 9 * DAY, limit: 5000 });
  assert.ok(mid.every((r) => r.summary?.ms === TIERS.midBucketMs && r.summary.n === 5), '5-minute summaries of 5 rows');
  const recent = store.rows({ room: 'lab', signal: 'pressure', from: NOW - HOUR, to: NOW, limit: 5000 });
  assert.ok(recent.length === 61 && recent.every((r) => !('summary' in r)), 'recent rows raw, in the shape they always had');
  store.close();
});

test('idempotent, and the same whether run at once or a few milliseconds per tick', () => {
  const a = station();
  const b = station();
  new Retention(a.handle).runAll(NOW);
  const all = (s: Store) => JSON.stringify(s.handle.prepare('SELECT t, signal, value, unit, kind, source, person, room, summary FROM readings ORDER BY t, signal, source, person, room, value').all());
  const once = all(a);
  new Retention(a.handle).runAll(NOW);
  assert.equal(all(a), once, 'a second run changes nothing');
  const sliced = new Retention(b.handle);
  let ticks = 0;
  while (sliced.tick(NOW, 1)) ticks++;
  assert.ok(ticks > 5);
  assert.equal(all(b), once);
  a.close();
  b.close();
});
