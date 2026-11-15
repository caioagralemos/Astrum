// Does the hub slow down as a mission's database grows? Measured on real files.
//
//   node scripts/scale.ts build 7 30 180       builds databases with that many days of rows
//   node scripts/scale.ts measure 7 30 180     times the hub's own work on each
//
// Building: one day is made through the hub's real path (the simulated crew,
// NASA's replay, the stand-in, a sensor board in the galley sending every 10
// seconds, each written by the store's own thinning rule, core/persist.ts),
// then copied back day by day in SQL, so the file holds what N days of a
// running ship hub would write. It ends at the moment it is built, so a hub
// started on it carries straight on. Files go to /private/tmp/astrum-e2e/scale
// only.
//
// Measuring: opens each file with the hub's own classes and times, on the
// real file (no in-memory shortcut): opening the store, one baseline refresh
// per person, one room-alarm check, one evidence card, one alert check (what
// runs every 2 seconds), one dose refresh, and the state a new screen gets.
// Each is synchronous, so its time is how long it blocks the hub's event loop.

import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../core/db.ts';
import { Hub } from '../core/server.ts';
import { StandIn } from '../core/standin.ts';
import { SimulatedCrew } from '../core/crew.ts';
import { NasaReplay } from '../core/nasa.ts';
import { RoomAlarms } from '../core/alarms.ts';
import { AlertWatcher, crewActivity } from '../core/alerts.ts';
import { Baselines } from '../core/baseline.ts';
import { EvidenceCards } from '../core/evidence.ts';
import { CrewDose } from '../core/dose.ts';
import { latestResults, loadBloodFile } from '../core/blood.ts';
import { seeded } from '../core/scenario.ts';
import { placesOf } from '../engine/crew.ts';
import { hubProfileOf } from '../engine/mission.ts';
import type { Mission } from '../engine/mission.ts';
import { parseCards } from '../engine/cards.ts';
import { findingsNow } from '../engine/medical.ts';

const hubDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = '/private/tmp/astrum-e2e/scale';
const DAY = 86_400_000;
const OFFSET = -new Date().getTimezoneOffset();
const MISSION = 'ship-mars-orbit';

const mission = JSON.parse(readFileSync(join(hubDir, 'profiles', 'missions', `${MISSION}.json`), 'utf8')) as Mission;
const profile = hubProfileOf(mission, MISSION);
const rooms = profile.rooms.map((r) => r.id);
const people = profile.crew.map((p) => p.id);
const places = placesOf(mission);
export const fileOf = (days: number) => join(ROOT, `d${days}`, 'astrum-3.sqlite');

/** The galley board's signals and rough values, as the chip sends them. */
const BOARD: [string, number, string, number][] = [
  ['co2', 1.1, 'mmHg', 0.05], ['temperature', 22.6, 'C', 0.15], ['humidity', 44, '%', 1.5], ['pressure', 1012.8, 'hPa', 0.3],
  ['noise', 260, 'raw', 40], ['light', 1800, 'raw', 30], ['air_quality', 1.4, 'index', 0.1], ['vibration', 0.002, 'g', 0.001],
];

export function build(days: number): void {
  const file = fileOf(days);
  rmSync(dirname(file), { recursive: true, force: true });
  mkdirSync(dirname(file), { recursive: true });
  const end = Date.now();
  const start = end - DAY;
  const store = new Store(file);
  const hub = new Hub(store, profile, '/nonexistent');
  const crew = new SimulatedCrew(hub, store, people, OFFSET, places);
  const nasa = new NasaReplay(hub, store, join(hubDir, 'data-nasa', 'osdr-rr1'), rooms, places[people[0]].quarters);
  const standIn = new StandIn(hub, rooms, seeded(7), { mission, stays: store, offsetMinutes: OFFSET });
  const random = seeded(11);
  crew.catchUp(start);
  for (let t = start; t <= end; t += 10_000) {
    if (t % 60_000 < 10_000) hub.ingest(nasa.at(t));
    crew.step(t, 5000);
    hub.ingest(standIn.tick(t));
    hub.ingest(BOARD.map(([signal, centre, unit, jitter]) => ({ t, signal, value: Number((centre + (random() - 0.5) * jitter).toFixed(3)), unit, kind: 'measured' as const, source: 'chip:cabin-1', room: 'galley' })));
  }
  store.close();
  hub.http.close();
  // Copy the day back in time, day by day, readings and stays alike.
  const db = new DatabaseSync(file);
  const n = (db.prepare('SELECT COUNT(*) AS n FROM readings WHERE t > ?').get(start) as { n: number }).n;
  db.exec('BEGIN');
  const copyRows = db.prepare('INSERT INTO readings (t, signal, value, text, unit, kind, source, person, room, received) SELECT t - ?, signal, value, text, unit, kind, source, person, room, received - ? FROM readings WHERE t > ? AND t <= ?');
  const copyStays = db.prepare('INSERT INTO stays (person, room, t_from, t_until, kind, source) SELECT person, room, t_from - ?, t_until - ?, kind, source FROM stays WHERE t_from > ? AND t_until IS NOT NULL');
  for (let d = 1; d < days; d++) {
    copyRows.run(d * DAY, d * DAY, start, end);
    copyStays.run(d * DAY, d * DAY, start);
    if (d % 20 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); }
  }
  db.exec('COMMIT');
  const total = (db.prepare('SELECT COUNT(*) AS n FROM readings').get() as { n: number }).n;
  db.close();
  console.log(`built ${days} days: ${total.toLocaleString()} rows (${n.toLocaleString()} a day), ${(statSync(file).size / 1e9).toFixed(2)} GB`);
}

function time<T>(fn: () => T, repeat = 1): { ms: number; worst: number; out: T } {
  let out!: T;
  let total = 0;
  let worst = 0;
  for (let i = 0; i < repeat; i++) {
    const t0 = performance.now();
    out = fn();
    const ms = performance.now() - t0;
    total += ms;
    worst = Math.max(worst, ms);
  }
  return { ms: total / repeat, worst, out };
}

export function measure(days: number): Record<string, number> {
  const file = fileOf(days);
  const now = Date.now();
  const opened = time(() => new Store(file));
  const store = opened.out;
  const hub = new Hub(store, profile, '/nonexistent');
  const alarms = new RoomAlarms(hub, store, rooms);
  const alerts = new AlertWatcher(hub, store, profile, alarms);
  const baselines = new Baselines(store, people);
  alerts.unusual = (t) => baselines.sustained(t);
  alerts.activity = (t) => crewActivity(store, people, t, { places, offsetMinutes: OFFSET });
  const cards = parseCards(JSON.parse(readFileSync(join(hubDir, 'medical', 'cards.json'), 'utf8'))).cards;
  const entries = loadBloodFile(join(hubDir, 'medical', 'blood.json')).entries;
  alerts.findings = (t) => findingsNow({ people, now: t, cards, entries, rowsOf: (person, signal, from) => store.rows({ person, signal, from, to: t }), latestBlood: Object.values(latestResults(store, entries)).flat().map((r) => r.row) });
  const evidence = new EvidenceCards({ store, profile, baselines, alarms });
  const dose = new CrewDose(store, profile);

  const out: Record<string, number> = { days };
  out.rows = (store as unknown as { db: DatabaseSync }).db.prepare('SELECT COUNT(*) AS n FROM readings').get()!.n as number;
  out.gb = statSync(file).size / 1e9;
  out.openMs = opened.ms;
  // The first refresh of a person reads their rows; the next ones are what runs once a minute per person.
  out.baselineFirstMs = Math.max(...people.map((p) => time(() => baselines.refresh(p, now)).ms));
  out.baselineNextMs = Math.max(...people.map((p) => time(() => baselines.refresh(p, now + 60_000), 3).worst));
  out.alarmCheckMs = time(() => alarms.check(now), 3).ms;
  out.alertCheckMs = time(() => alerts.check(now), 5).worst; // includes one baseline refresh when one is due
  out.findingsMs = time(() => alerts.findings(now), 3).ms;
  out.activityMs = time(() => alerts.activity(now), 3).ms;
  out.evidenceFirstMs = time(() => evidence.refresh(people[0], now)).ms;
  out.evidenceNextMs = time(() => evidence.refresh(people[1], now + 1000), 3).ms;
  // The first dose: read whole (before), or a slice per turn of the event loop (after: the worst slice is the block).
  const spans = (dose as unknown as { spans: { catchUpSlice?: (t: number) => boolean } }).spans;
  if (spans.catchUpSlice) {
    let worst = 0;
    let total = 0;
    for (;;) { const r = time(() => spans.catchUpSlice!(now)); worst = Math.max(worst, r.ms); total += r.ms; if (r.out) break; }
    out.doseCatchUpTotalMs = total;
    out.doseCatchUpWorstSliceMs = worst;
  }
  out.doseFirstMs = time(() => dose.refresh(now)).ms;
  out.doseNextMs = time(() => dose.refresh(now + 60_000), 3).ms;
  out.stateMs = time(() => JSON.stringify(hub.state(now)), 3).ms;
  out.rssMB = process.memoryUsage().rss / 1e6;
  store.close();
  hub.http.close();
  return out;
}

if (import.meta.main) {
  const [what, ...rest] = process.argv.slice(2);
  const days = rest.map(Number).filter((n) => n > 0);
  if (what === 'build') for (const d of days) build(d);
  else if (what === 'measure') for (const d of days) console.log(JSON.stringify(Object.fromEntries(Object.entries(measure(d)).map(([k, v]) => [k, Math.round(v * 100) / 100]))));
  else console.log('node scripts/scale.ts build|measure <days...>');
}
