// Would have caught the slow hub: a million rows shaped like a demo hub's first
// hours (stand-in, NASA replay, chip, simulated crew), written the old way,
// then the paths a screen waits on, timed. The bounds are generous; on a
// machine much slower than a recent laptop the test skips and says so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from './db.ts';
import { Hub, STAND_IN } from './server.ts';
import { StandIn } from './standin.ts';
import { SimulatedCrew } from './crew.ts';
import { NasaReplay, NASA_SOURCE } from './nasa.ts';
import { RoomAlarms } from './alarms.ts';
import { Baselines } from './baseline.ts';
import { EvidenceCards, evidenceRoute } from './evidence.ts';
import { handleBlood, demoBloodRows, loadInspiration4 } from './blood.ts';
import { seeded } from './scenario.ts';
import { DEMO_EVERY_MS } from './persist.ts';
import type { HubMessage, Profile } from '../engine/types.ts';

const hubDir = new URL('..', import.meta.url).pathname;
const profile = JSON.parse(readFileSync(new URL('../profiles/mars-orbit.json', import.meta.url), 'utf8')) as Profile;
const rooms = profile.rooms.map((r) => r.id);
const ids = profile.crew.map((p) => p.id);
const BOUND_MS = 100;

/** About 300 ms on a recent laptop. */
function machineSpeed(): number {
  const random = seeded(1);
  const values = Array.from({ length: 1_000_000 }, random);
  const start = performance.now();
  values.sort((a, b) => a - b);
  return performance.now() - start;
}
const speed = machineSpeed();
const slow = speed > 1500 ? `this machine sorts a million numbers in ${speed.toFixed(0)} ms (a recent laptop: about 300); the time bounds would not mean anything here` : false;

test('a million stored rows: current values, a new screen, evidence and blood answer in milliseconds', { skip: slow, timeout: 120_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'astrum-perf-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'astrum-3.sqlite');
  new Store(file).close(); // tables and indexes
  const now = Date.now();

  // The old way: every row written. Per second: the stand-in's 7 signals in 7 rooms, the chip's 6
  // in the galley; the replay's 3 signals in 8 rooms every 4 seconds; the crew's heart rates every 5.
  const db = new DatabaseSync(file);
  const insert = db.prepare('INSERT INTO readings (t, signal, value, text, unit, kind, source, person, room, received) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const random = seeded(2);
  const standInSignals: [string, string, number][] = [['pressure', 'hPa', 1013], ['oxygen', 'mmHg', 160], ['vibration', 'g', 0.002], ['air_quality', 'index', 1], ['noise', 'raw', 240], ['light', 'raw', 1900], ['radiation', 'uGy/day', 320]];
  const chipSignals: [string, string, number][] = [['pressure', 'hPa', 1011], ['temperature', 'C', 28.4], ['humidity', '%', 65], ['noise', 'raw', 990], ['light', 'raw', 1940], ['vibration', 'g', 0.007]];
  let made = 0;
  db.exec('BEGIN');
  for (let t0 = now - 4.4 * 3600_000; made < 1_000_000; t0 += 1000) {
    for (const room of rooms.filter((r) => r !== 'galley')) for (const [signal, unit, centre] of standInSignals) { insert.run(t0, signal, centre, null, unit, 'simulated', STAND_IN, null, room, t0); made++; }
    for (const [signal, unit, centre] of chipSignals) { insert.run(t0, signal, Math.round(centre * (1 + (random() - 0.5) / 50) * 100) / 100, null, unit, 'measured', 'chip:cabin-1', null, 'galley', t0); made++; }
    if (t0 % 4000 < 1000) for (const room of rooms) for (const [signal, unit, v] of [['co2', 'mmHg', 2.4], ['temperature', 'C', 22], ['humidity', '%', 45]] as const) { insert.run(t0, signal, v, null, unit, 'replayed', NASA_SOURCE, null, room, t0); made++; }
    if (t0 % 5000 < 1000) for (const person of ids) { insert.run(t0, 'heart_rate', 60, null, 'bpm', 'simulated', 'sim:crew', person, 'lab', t0); made++; }
  }
  db.exec('COMMIT');
  db.close();

  let start = performance.now();
  const store = new Store(file);
  const openMs = performance.now() - start;
  const hub = new Hub(store, profile, '/nonexistent');
  new SimulatedCrew(hub, store, ids, 0).catchUp(now);
  new NasaReplay(hub, store, join(hubDir, 'data-nasa', 'osdr-rr1'), rooms).catchUp(now);
  hub.ingest(demoBloodRows(loadInspiration4(join(hubDir, 'data-nasa', 'inspiration4')), 'C001', 'okafor', [{ timepoint: 'L-3', t: now - 14 * 86_400_000 }, { timepoint: 'R+1', t: now - 2 * 86_400_000 }]));
  const alarms = new RoomAlarms(hub, store, rooms);
  const cards = new EvidenceCards({ store, profile, baselines: new Baselines(store, ids, 0), alarms, offsetMinutes: 0 });
  cards.onChange = (person, card) => hub.setEvidence(person, card);
  hub.routes.push(evidenceRoute(profile, cards));
  hub.routes.push((req, res, url) => handleBlood(req, res, url, { store, ingest: (rows) => hub.ingest(rows), bloodFile: join(hubDir, 'medical', 'blood.json'), crew: ids }));
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  t.after(() => { cards.stop(); hub.http.closeAllConnections(); hub.http.close(); store.close(); });

  const timed = async (label: string, run: () => unknown, bound = BOUND_MS) => {
    const times: number[] = [];
    for (let i = 0; i < 3; i++) { const a = performance.now(); await run(); times.push(performance.now() - a); }
    const ms = Math.min(...times);
    t.diagnostic(`${label}: ${ms.toFixed(1)} ms`);
    assert.ok(ms < bound, `${label} took ${ms.toFixed(0)} ms (bound ${bound})`);
  };
  t.diagnostic(`${made} rows; opening the store (newest rows from the index): ${openMs.toFixed(0)} ms; this machine's sort: ${speed.toFixed(0)} ms`);
  assert.ok(openMs < 500, `opening took ${openMs.toFixed(0)} ms`);

  start = performance.now();
  alarms.check(now);
  t.diagnostic(`first alarm check (cold): ${(performance.now() - start).toFixed(0)} ms`);
  await timed('alarm check', () => alarms.check(now));
  // The background work: one card per tick.
  start = performance.now();
  for (let i = 0; i < ids.length; i++) cards.tick(now);
  t.diagnostic(`first round of ${ids.length} cards: ${(performance.now() - start).toFixed(0)} ms`);
  await timed('one card, in the background', () => cards.tick(now + 30_000));

  await timed('state()', () => JSON.stringify(hub.state()));
  await timed('a new screen\'s first message', () => new Promise<void>((done) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    socket.onmessage = (e) => {
      const first = JSON.parse(String(e.data)) as HubMessage;
      assert.equal(first.type, 'state');
      assert.equal(Object.keys((first as Extract<HubMessage, { type: 'state' }>).evidence ?? {}).length, ids.length);
      socket.close();
      done();
    };
  }));
  const get = (path: string) => async () => { const res = await fetch(`http://127.0.0.1:${port}${path}`); assert.equal(res.status, 200); await res.arrayBuffer(); };
  await timed('GET /api/state', get('/api/state'));
  await timed('GET /api/evidence', get('/api/evidence?person=reyes'));
  await timed('GET /api/blood', get('/api/blood'));
});

test('an hour of the stand-in writes one row a minute per signal and room, plus its rare steps', () => {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const standIn = new StandIn(hub, rooms, seeded(9));
  const start = Date.UTC(2026, 10, 14, 12);
  let sent = 0;
  for (let s = 0; s < 3600; s++) sent += hub.ingest(standIn.tick(start + s * 1000)).length;
  const series = standIn.tick(start + 3600_000).length;
  const written = store.rows({ limit: 50_000 }).length;
  const allowed = series * (3600_000 / DEMO_EVERY_MS) * 1.05;
  assert.equal(sent, series * 3600, 'every row is still sent live');
  assert.ok(written >= series * 60 && written <= allowed, `${written} rows written for ${series} series (allowed ${allowed.toFixed(0)}); it used to be ${sent}`);
  store.close();
  hub.http.close();
});
