// How often the hub raises alerts on ordinary days, measured, not guessed.
//
// Builds a whole hub in memory for each mission, the way core/scenario.ts
// records the story: its own database, the simulated crew, NASA's replayed ISS
// air, the stand-in, room alarms, alert levels, baselines and the medical
// lead's rules on the hub's own records. Nothing listens on a port and no
// model is started. The hub's clock runs ten seconds a step, as fast as the
// machine allows, for the days asked for, and every alert, room alarm and
// message to Earth is counted by day and by cause.
//
//   node scripts/quiet-days.ts                       7 quiet days, every mission
//   node scripts/quiet-days.ts --days 3 --mission iss
//   node scripts/quiet-days.ts --inject              the same days with three true problems
//   node scripts/quiet-days.ts --json out.json       also writes every event
//
// The days end, by default, when NASA's record runs out for the story's room
// (core/nasa.ts plays it up to Monday 16 Nov 2026 09:54 UTC), so every room has
// real air throughout. --end <ISO time> moves them.
//
// With --inject, three problems happen on fixed days, each on its own:
//   day 3, 01:00 station time: the story's room plays NASA's own CO2 climb (core/scenario.ts CLIMB_FROM) for 4 hours;
//   day 4, 10:00: one crewmate's heart rate runs 25 % over what the crew generator gives, for one hour;
//   day 5, 14:00: one crewmate's watch reads blood oxygen 88 % every minute for 10 minutes.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../core/db.ts';
import { Hub } from '../core/server.ts';
import { StandIn } from '../core/standin.ts';
import { SimulatedCrew } from '../core/crew.ts';
import { NasaReplay } from '../core/nasa.ts';
import { RoomAlarms } from '../core/alarms.ts';
import { AlertWatcher, crewActivity } from '../core/alerts.ts';
import { Baselines } from '../core/baseline.ts';
import { demoBloodRows, latestResults, loadBloodFile, loadInspiration4 } from '../core/blood.ts';
import { CLIMB_FROM, CALM_FROM, seeded } from '../core/scenario.ts';
import { placesOf } from '../engine/crew.ts';
import { hubProfileOf } from '../engine/mission.ts';
import type { Mission } from '../engine/mission.ts';
import { sleepersOf } from '../engine/activity.ts';
import { parseCards } from '../engine/cards.ts';
import { findingsNow } from '../engine/medical.ts';
import type { Alert, AlertEvent } from '../engine/alerts.ts';
import type { Row } from '../engine/types.ts';

const hubDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STEP_MS = 10_000;
/** Recife, the clock the demo hub keeps (core/scenario.ts STATION_OFFSET_MINUTES). */
const OFFSET_MINUTES = -180;
/** NASA's record ends 2014-11-01T03:54Z; the story's room plays it until this hub time. */
const RECORD_ENDS = Date.UTC(2026, 10, 16, 9, 50);
export const MISSIONS = ['ship-mars-orbit', 'iss', 'base-mars', 'base-moon'];

export interface Counted {
  day: number;
  t: number;
  what: 'alert' | 'room-alarm' | 'earth';
  level: number | null;
  person: string | null;
  room: string | null;
  /** The signal or rule: "unusual:heart_rate", "room-limit:co2", "finding:blood_oxygen". */
  cause: string;
  /** The person was asleep when it was raised (a level 1 is then held, not sent). */
  asleep: boolean;
  /** For a level 1: held because the person slept, so nobody was told. */
  held: boolean;
  /** The kind of data behind it. */
  kind: string;
  value: number | null;
}

export interface RunResult {
  mission: string;
  from: number;
  until: number;
  events: Counted[];
  /** Rows refused as impossible at the door, by source and signal. */
  refused: { source: string; signal: string; count: number }[];
  /** Station-time 10-second steps on which a room could not judge CO2, by room. */
  co2Unjudged: Record<string, number>;
  /** Detection, with --inject: when each problem started and when the hub first said so. */
  detections: { problem: string; startedAt: number; firstAlarmAt: number | null; firstAlertAt: number | null; firstLevel: number | null; told: string | null; notes: string[] }[];
  ms: number;
}

const stationDay = (t: number, from: number) => Math.floor((t - from) / DAY) + 1;
const stationClock = (t: number) => new Date(t + OFFSET_MINUTES * MIN).toISOString().slice(5, 16).replace('T', ' ');

/** Runs one mission's hub forward from `from` for `days`, optionally with the three problems. */
export function runMission(missionId: string, from: number, days: number, inject = false): RunResult {
  const started = Date.now();
  const mission = JSON.parse(readFileSync(join(hubDir, 'profiles', 'missions', `${missionId}.json`), 'utf8')) as Mission;
  const profile = hubProfileOf(mission, missionId);
  const rooms = profile.rooms.map((r) => r.id);
  const people = profile.crew.map((p) => p.id);
  const places = placesOf(mission);
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const crew = new SimulatedCrew(hub, store, people, OFFSET_MINUTES, places);
  const subjectRoom = places[people[0]]?.quarters ?? null;
  const nasa = new NasaReplay(hub, store, join(hubDir, 'data-nasa', 'osdr-rr1'), rooms, subjectRoom);
  const standIn = new StandIn(hub, rooms, seeded(20261114), { mission, stays: store, offsetMinutes: OFFSET_MINUTES });
  const alarms = new RoomAlarms(hub, store, rooms);
  const alerts = new AlertWatcher(hub, store, profile, alarms);
  const baselines = new Baselines(store, people, OFFSET_MINUTES);
  alerts.unusual = (now) => baselines.sustained(now);
  alerts.activity = (now) => crewActivity(store, people, now, { places, offsetMinutes: OFFSET_MINUTES });
  // The medical lead's rules on the hub's own records, as core/main.ts runs them.
  const cards = parseCards(JSON.parse(readFileSync(join(hubDir, 'medical', 'cards.json'), 'utf8'))).cards;
  const entries = loadBloodFile(join(hubDir, 'medical', 'blood.json')).entries;
  let findingsCache: { at: number; findings: ReturnType<typeof findingsNow> } | null = null;
  alerts.findings = (now) => {
    if (findingsCache && now - findingsCache.at < 5000 && now >= findingsCache.at) return findingsCache.findings;
    const findings = findingsNow({
      people, now, cards, entries,
      rowsOf: (person, signal, since) => store.rows({ person, signal, from: since, to: now }),
      latestBlood: Object.values(latestResults(store, entries)).flat().map((r) => r.row),
    });
    findingsCache = { at: now, findings };
    return findings;
  };

  let clock = from;
  let asleep: string[] = [];
  const setActivity = hub.setActivity.bind(hub);
  hub.setActivity = (activity) => { asleep = sleepersOf(activity); setActivity(activity); };
  const events: Counted[] = [];
  const counted = (e: Omit<Counted, 'day' | 't'>) => events.push({ day: stationDay(clock, from), t: clock, ...e });
  const causeOf = (a: Alert) => `${a.reason}:${a.signal}`;
  const heldSeen = new Set<string>();
  const detections: RunResult['detections'] = [];
  const watching: { d: RunResult['detections'][number]; person: string | null; room: string | null; match: (a: Alert) => boolean }[] = [];

  alerts.onEvent = (e: AlertEvent) => {
    const a = e.alert;
    if (e.type === 'raised' || e.type === 'escalated') {
      counted({ what: 'alert', level: a.level, person: a.person, room: a.room, cause: causeOf(a), asleep: asleep.includes(a.person), held: false, kind: a.kind, value: a.value });
      for (const w of watching) {
        if (w.d.firstAlertAt === null && w.match(a)) { w.d.firstAlertAt = clock; w.d.firstLevel = a.level; w.d.told = a.toldTo === 'everyone' ? 'everyone' : a.toldTo.join(', '); }
        if (w.d.firstAlertAt !== null && w.match(a) && a.level > (w.d.firstLevel ?? 0)) w.d.notes.push(`level ${a.level} at +${Math.round((clock - w.d.startedAt) / 1000)} s (${e.type})`);
      }
    }
  };
  // A level 1 held while the person sleeps is never an event: counted here, once per alert, as "held".
  const countHeld = () => {
    for (const a of alerts.list()) {
      if (!a.held || heldSeen.has(a.id + a.since)) continue;
      heldSeen.add(a.id + a.since);
      counted({ what: 'alert', level: 1, person: a.person, room: a.room, cause: causeOf(a), asleep: true, held: true, kind: a.kind, value: a.value });
    }
  };
  const alarmSeen = new Set<string>();
  const earthSeen = new Set<string>();
  const co2Unjudged: Record<string, number> = {};

  // The three problems, with --inject.
  const day = (n: number, hour: number) => from + (n - 1) * DAY + hour * HOUR;
  const hrPerson = people[1] ?? people[0];
  const spo2Person = people[2] ?? people[0];
  const climb = { at: day(3, 1), until: day(3, 5) };
  const hr = { at: day(4, 10), until: day(4, 11) };
  const spo2 = { at: day(5, 14), until: day(5, 14) + 10 * MIN };
  if (inject) {
    const d1 = { problem: `CO2 climb (NASA's own, from ${CLIMB_FROM}) in ${subjectRoom}`, startedAt: climb.at, firstAlarmAt: null, firstAlertAt: null, firstLevel: null, told: null, notes: [] };
    const d2 = { problem: `${hrPerson}'s heart rate 25 % over the generator's for 1 hour (awake, at work)`, startedAt: hr.at, firstAlarmAt: null, firstAlertAt: null, firstLevel: null, told: null, notes: [] };
    const d3 = { problem: `${spo2Person}'s watch: blood oxygen 88 % every minute for 10 minutes`, startedAt: spo2.at, firstAlarmAt: null, firstAlertAt: null, firstLevel: null, told: null, notes: [] };
    detections.push(d1, d2, d3);
    watching.push(
      { d: d1, person: null, room: subjectRoom, match: (a) => a.reason === 'room-limit' && a.room === subjectRoom && clock >= climb.at && clock < climb.until + 2 * HOUR },
      { d: d2, person: hrPerson, room: null, match: (a) => a.person === hrPerson && a.signal === 'heart_rate' && clock >= hr.at && clock < hr.until + 2 * HOUR },
      { d: d3, person: spo2Person, room: null, match: (a) => a.person === spo2Person && a.signal === 'blood_oxygen' && clock >= spo2.at },
    );
    // The heart rate: every row of the crew generator for that person, in that hour, 25 % higher.
    const ingest = hub.ingest.bind(hub);
    hub.ingest = (rows: Row[]) => ingest(rows.map((r) => (r.person === hrPerson && r.signal === 'heart_rate' && r.t >= hr.at && r.t < hr.until && r.value !== null
      ? { ...r, value: Math.round(r.value * 1.25) } : r)));
  }

  // As the live hub starts: three days of history, then Okafor's replayed Inspiration4 blood values.
  crew.catchUp(from);
  nasa.catchUp(from);
  hub.ingest(demoBloodRows(loadInspiration4(join(hubDir, 'data-nasa', 'inspiration4')), 'C001', 'okafor',
    [{ timepoint: 'L-3', t: from - 14 * DAY }, { timepoint: 'R+1', t: from - 2 * DAY }]));

  const until = from + days * DAY;
  let climbing = false;
  let dayStarted = Date.now();
  for (let t = from; t <= until; t += STEP_MS) {
    clock = t;
    if (t > from && (t - from) % DAY === 0) {
      process.stderr.write(`  ${missionId}: day ${(t - from) / DAY} of ${days} done in ${((Date.now() - dayStarted) / 1000).toFixed(0)} s\n`);
      dayStarted = Date.now();
    }

    if (inject && !climbing && t >= climb.at && t < climb.until) { climbing = true; nasa.aheadMs += Date.parse(CLIMB_FROM) - nasa.recordTime(subjectRoom!, t); }
    if (inject && climbing && t >= climb.until) { climbing = false; nasa.aheadMs += Date.parse(CALM_FROM) - nasa.recordTime(subjectRoom!, t); }
    if (inject && t >= spo2.at && t <= spo2.until && (t - spo2.at) % MIN === 0) {
      hub.ingest([{ t, signal: 'blood_oxygen', value: 88, unit: '%', kind: 'measured', source: `phone:${spo2Person}`, person: spo2Person, room: null }]);
    }
    hub.ingest(nasa.at(t));
    crew.step(t, 5000);
    hub.ingest(standIn.tick(t));
    alarms.check(t);
    for (const a of alarms.list()) {
      const key = `${a.room}|${a.signal}|${a.since ?? ''}`;
      if (alarmSeen.has(key)) continue;
      alarmSeen.add(key);
      const inRoom = Object.entries(occupantsAt(store, t)).find(([room]) => room === a.room)?.[1] ?? [];
      counted({ what: 'room-alarm', level: null, person: inRoom.join('+') || null, room: a.room, cause: `room-limit:${a.signal}`, asleep: inRoom.some((p) => asleep.includes(p)), held: false, kind: a.kind, value: a.value });
      for (const w of watching) if (w.room === a.room && w.d.firstAlarmAt === null && w.match({ reason: 'room-limit', room: a.room } as Alert)) w.d.firstAlarmAt = t;
    }
    for (const u of alarms.unjudged) if (u.signal === 'co2') co2Unjudged[u.room] = (co2Unjudged[u.room] ?? 0) + 1;
    alerts.check(t);
    countHeld();
    for (const m of alerts.earthMessages()) {
      if (earthSeen.has(m.id)) continue;
      earthSeen.add(m.id);
      counted({ what: 'earth', level: m.about.level, person: m.about.person, room: m.about.room, cause: `${m.about.stationWide ? 'station-wide ' : ''}${m.about.signal}`, asleep: asleep.includes(m.about.person), held: false, kind: '', value: null });
    }
  }
  const refused = hub.quality().rejected.map((r) => ({ source: r.source, signal: r.signal, count: r.count }));
  store.close();
  hub.http.close();
  return { mission: missionId, from, until, events, refused, co2Unjudged, detections, ms: Date.now() - started };
}

function occupantsAt(store: Store, t: number): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of store.stays(t, t)) if (s.until === null || s.until > t) (out[s.room] ??= []).push(s.person);
  return out;
}

/** The per-day table and the causes, in plain text. */
export function describe(r: RunResult, days: number): string[] {
  const lines = [`${r.mission}: ${stationClock(r.from)} to ${stationClock(r.until)} station time (UTC-3), ${days} days, ${(r.ms / 1000).toFixed(0)} s to run`];
  lines.push('  day | L1 sent | L1 held asleep | L2 | L3 | room alarms | to Earth');
  for (let d = 1; d <= days; d++) {
    const on = r.events.filter((e) => e.day === d);
    const n = (f: (e: Counted) => boolean) => on.filter(f).length;
    lines.push(`  ${String(d).padStart(3)} | ${String(n((e) => e.what === 'alert' && e.level === 1 && !e.held)).padStart(7)} | ${String(n((e) => e.what === 'alert' && e.level === 1 && e.held)).padStart(14)} | ${String(n((e) => e.what === 'alert' && e.level === 2)).padStart(2)} | ${String(n((e) => e.what === 'alert' && e.level === 3)).padStart(2)} | ${String(n((e) => e.what === 'room-alarm')).padStart(11)} | ${String(n((e) => e.what === 'earth')).padStart(8)}`);
  }
  const causes = new Map<string, number>();
  for (const e of r.events) {
    const key = `${e.what}${e.level ? ` L${e.level}` : ''}${e.held ? ' (held)' : ''} ${e.cause}${e.asleep && !e.held ? ' [asleep]' : ''}`;
    causes.set(key, (causes.get(key) ?? 0) + 1);
  }
  lines.push('  causes:');
  for (const [k, v] of [...causes].sort((a, b) => b[1] - a[1])) lines.push(`    ${String(v).padStart(4)}  ${k}`);
  for (const e of r.events.filter((x) => x.what !== 'alert' || x.level! >= 2 || !x.held).slice(0, 60)) {
    lines.push(`    ${stationClock(e.t)}  ${e.what}${e.level ? ` L${e.level}` : ''} ${e.cause} ${e.person ?? ''} ${e.room ?? ''} ${e.value ?? ''} ${e.kind}${e.asleep ? ' asleep' : ''}${e.held ? ' held' : ''}`);
  }
  if (r.refused.length) lines.push(`  refused as impossible: ${r.refused.map((x) => `${x.source} ${x.signal} x${x.count}`).join(', ')}`);
  const unjudged = Object.entries(r.co2Unjudged);
  if (unjudged.length) lines.push(`  CO2 could not be judged: ${unjudged.map(([room, steps]) => `${room} ${(steps * STEP_MS / HOUR).toFixed(1)} h`).join(', ')}`);
  for (const d of r.detections) {
    const after = (t: number | null) => (t === null ? 'never' : `+${Math.round((t - d.startedAt) / 1000)} s`);
    lines.push(`  problem: ${d.problem}, from ${stationClock(d.startedAt)}: room alarm ${after(d.firstAlarmAt)}, first alert ${after(d.firstAlertAt)}${d.firstLevel ? ` (level ${d.firstLevel}, told ${d.told})` : ''}${d.notes.length ? `; ${d.notes.join('; ')}` : ''}`);
  }
  return lines;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const days = Number(opt('--days') ?? 7);
  const end = opt('--end') ? Date.parse(opt('--end')!) : RECORD_ENDS;
  const from = end - days * DAY;
  const missions = opt('--mission') ? [opt('--mission')!] : MISSIONS;
  const inject = args.includes('--inject');
  const results: RunResult[] = [];
  for (const m of missions) {
    const r = runMission(m, from, days, inject);
    results.push(r);
    console.log(describe(r, days).join('\n'));
    console.log('');
  }
  const out = opt('--json');
  if (out) writeFileSync(out, JSON.stringify(results, null, 1));
}
