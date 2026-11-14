// The evidence card: what the data says about one crewmate, and where it
// points. Data only; the screen words it from the string table.
//
// Four questions, each answered with numbers that carry their kind:
//   1. Unusual for this person?        the baseline (baseline.ts)
//   2. Anyone else in the same room?   room or person (baseline.ts roomOrPerson)
//   3. Where have they been?           exposure (exposure.ts), against each crewmate
//   4. What did they report?           their check-in rows (checkin.*)
// Then `pointsTo`: the room, the person, the sensor, or unknown, with the
// reasons as data. The wording rule is "points to", never "caused by". Nothing
// here is a diagnosis, and the only levels used are NASA's two CO2 numbers.

import { roomOrPerson } from './baseline.ts';
import type { Judged, KindMix, PersonSummary, RoomOrPerson } from './baseline.ts';
import { CO2_LEVELS, exposure } from './exposure.ts';
import { sourceProblems } from './quality.ts';
import type { SourceProblem, Stuck } from './quality.ts';
import type { RoomAlarm } from './cabin.ts';
import { LIMITS, windowAverages } from './cabin.ts';
import { CHECKIN_PREFIX } from './checkin.ts';
import type { Kind, Row, Stay } from './types.ts';
import { KIND_RANK } from './types.ts';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** The windows "where have they been" looks back over. */
export const WINDOWS_MS = [24 * HOUR, 72 * HOUR];

/**
 * A person's time above a CO2 level "stands out" when it is above zero and
 * more than this many times every crewmate's over the longest window. A data
 * comparison, not a health threshold: twice anyone else's is hard to put down
 * to where the schedule happened to place people.
 */
export const STANDS_OUT_RATIO = 2;

export interface EvidenceInputs {
  now: number;
  /** Every crew id in the profile. */
  crew: string[];
  /** Everyone's baseline summary (core/baseline.ts caches them). */
  summaries: PersonSummary[];
  /** Who is in each room now, as `occupants()` in timeline.ts gives it. */
  occupantsNow: Record<string, string[]>;
  /** Stays overlapping the longest window. */
  stays: Stay[];
  /** Cabin CO2 rows over the longest window. */
  cabinRows: Row[];
  /** This person's rows under "checkin." over the longest window. */
  checkins: Row[];
  /** The newest row of each source (Store.recent), for the sensor check. */
  latest: Row[];
  stuck: Stuck[];
  alarms: RoomAlarm[];
  /** Station time minus UTC, in minutes, for counting days. */
  offsetMinutes?: number;
}

export interface UnusualSignal {
  signal: string;
  direction: 'high' | 'low' | null;
  z: number;
  recent: number;
  usual: number;
  mode: 'dense' | 'daily';
  state: string;
  /** How much history it was compared with. */
  baselineCount: number;
  kinds: KindMix;
  /** The weakest kind it was built from: the label the screen shows. */
  kind: Kind;
}

export interface RoomExposure {
  room: string;
  ms: number;
  /** The kind of the stays (where the person was). */
  stayKind: Kind;
  /** Time-weighted CO2 while they were there, or null with no reading. */
  average: number | null;
  /** Milliseconds above each NASA level, over covered time only. */
  above: { level: number; ms: number }[];
  covered: number;
  /** The weakest kind of reading used, or null with no reading. */
  kind: Kind | null;
}

export interface PersonExposure {
  person: string;
  rooms: RoomExposure[];
  average: number | null;
  above: { level: number; ms: number }[];
  covered: number;
  gap: number;
  kind: Kind | null;
  stayKind: Kind | null;
  /**
   * The highest 1-hour CO2 average (cabin.ts windowAverage, the rule the room
   * alarm judges by) of the room the person was in, at any minute they were
   * there in this window. Null when no hour could be averaged.
   */
  maxHourAverage: number | null;
}

export interface ExposureWindow {
  ms: number;
  from: number;
  to: number;
  /** The person first, then each crewmate. */
  people: PersonExposure[];
}

export interface ReportRun {
  signal: string;
  /** Answers on record in the window. */
  count: number;
  /** Station days in a row, ending on the day of the newest one, with an answer that is not 0. */
  days: number;
  lastAt: number;
  kind: Kind;
}

export type Reason =
  | { code: 'exposure-stands-out'; room: string | null; level: number; ms: number; crewmatesMaxMs: number; windowMs: number; kind: Kind | null }
  | { code: 'crewmates-same'; signal: string; room: string | null; people: string[] }
  | { code: 'crewmates-normal'; signal: string; room: string | null; people: string[] }
  | { code: 'sensor'; problem: SourceProblem };

export type PointsTo = 'room' | 'person' | 'sensor' | 'unknown';

export interface Evidence {
  person: string;
  now: number;
  unusual: { signals: UnusualSignal[]; score: number };
  sameRoom: RoomOrPerson[];
  whereBeen: {
    windows: ExposureWindow[];
    /** Rooms this person spent time in over the longest window and no crewmate did. */
    onlyThem: { room: string; ms: number; stayKind: Kind }[];
  };
  reported: { rows: Pick<Row, 't' | 'signal' | 'value' | 'text' | 'unit' | 'kind'>[]; runs: ReportRun[] };
  /** Where the data points. Never a cause and never a diagnosis. */
  pointsTo: PointsTo;
  /** The room the conclusion looks at, if any. */
  focusRoom: string | null;
  /** Why, as data. Room reasons, person reasons and sensor problems found, whatever the verdict. */
  reasons: Reason[];
}

function weakest(kinds: (Kind | null | undefined)[]): Kind | null {
  let out: Kind | null = null;
  for (const k of kinds) if (k && (!out || KIND_RANK[k] > KIND_RANK[out])) out = k;
  return out;
}

/** Each room's 1-hour CO2 average at every whole minute of the longest window, worked out once per card. */
type HourlyByRoom = (room: string) => { start: number; values: (number | null)[] };

function hourlyAverages(rows: Row[], from: number, to: number): HourlyByRoom {
  const windowMs = LIMITS.find((l) => l.signal === 'co2')?.windowMs ?? 3600_000;
  const start = Math.ceil(from / 60_000) * 60_000;
  const times: number[] = [];
  for (let t = start; t <= to; t += 60_000) times.push(t);
  const memo = new Map<string, { start: number; values: (number | null)[] }>();
  let byRoom: Map<string, Row[]> | null = null;
  return (room) => {
    let held = memo.get(room);
    if (!held) {
      if (!byRoom) {
        byRoom = new Map();
        for (const row of rows) if (row.room && !row.person && row.signal === 'co2') (byRoom.get(row.room) ?? byRoom.set(row.room, []).get(row.room)!).push(row);
      }
      memo.set(room, held = { start, values: windowAverages(byRoom.get(room) ?? [], room, 'co2', times, windowMs).map((a) => (a ? a.value : null)) });
    }
    return held;
  };
}

/** The highest of those averages over the minutes this person spent in each room between from and to. */
function highestHour(mine: Stay[], hourly: HourlyByRoom, from: number, to: number): number | null {
  let max: number | null = null;
  for (const stay of mine) {
    const a = Math.max(stay.from, from);
    const b = Math.min(stay.until ?? to, to);
    if (b <= a) continue;
    const { start, values } = hourly(stay.room);
    for (let i = Math.max(0, Math.ceil((a - start) / 60_000)); i < values.length && start + i * 60_000 <= b; i++) {
      const v = values[i];
      if (v !== null && (max === null || v > max)) max = v;
    }
  }
  return max === null ? null : Number(max.toFixed(2));
}

function personExposure(person: string, stays: Stay[], byRoom: Map<string, Row[]>, all: Row[], from: number, to: number, hourly: HourlyByRoom): PersonExposure {
  const levels = CO2_LEVELS.map((l) => l.level);
  const mine = stays.filter((s) => s.person === person && s.from < to && (s.until === null || s.until > from));
  const whole = exposure(mine, all, person, 'co2', from, to, levels);
  const rooms: RoomExposure[] = [];
  for (const room of Object.keys(whole.rooms)) {
    const here = mine.filter((s) => s.room === room);
    const e = exposure(here, byRoom.get(room) ?? [], person, 'co2', from, to, levels);
    rooms.push({ room, ms: e.rooms[room] ?? 0, stayKind: weakest(here.map((s) => s.kind))!, average: e.average, above: e.above, covered: e.covered, kind: weakest(e.sources.map((s) => s.kind)) });
  }
  rooms.sort((a, b) => b.ms - a.ms);
  return {
    person, rooms, average: whole.average, above: whole.above, covered: whole.covered, gap: whole.gap,
    kind: weakest(whole.sources.map((s) => s.kind)), stayKind: weakest(mine.map((s) => s.kind)),
    maxHourAverage: highestHour(mine, hourly, from, to),
  };
}

/** Days in a row with a non-zero answer, ending on the day of the newest one. */
function runs(rows: Row[], offsetMinutes: number): ReportRun[] {
  const dayOf = (t: number) => Math.floor((t + offsetMinutes * 60_000) / DAY);
  const out: ReportRun[] = [];
  for (const signal of [...new Set(rows.map((r) => r.signal))].sort()) {
    const mine = rows.filter((r) => r.signal === signal).sort((a, b) => a.t - b.t);
    const yes = new Set(mine.filter((r) => (r.value !== null ? r.value !== 0 : !!r.text)).map((r) => dayOf(r.t)));
    const last = mine[mine.length - 1];
    let days = 0;
    for (let d = dayOf(last.t); yes.has(d); d--) days++;
    out.push({ signal, count: mine.length, days, lastAt: last.t, kind: weakest(mine.map((r) => r.kind))! });
  }
  return out;
}

/** The evidence for one crewmate. Pure: everything it needs comes in `inputs`. */
export function evidenceFor(person: string, inputs: EvidenceInputs): Evidence {
  const { now } = inputs;
  const longest = Math.max(...WINDOWS_MS);

  // 1. Unusual for this person?
  const summary = inputs.summaries.find((s) => s.person === person);
  const judged = (summary?.signals ?? []).filter((s): s is Judged => s.status === 'judged' && s.unusual);
  const signals: UnusualSignal[] = judged.filter((s) => summary!.top.includes(s.signal)).map((s) => ({
    signal: s.signal, direction: s.direction, z: s.z, recent: s.recent, usual: s.usual, mode: s.mode, state: s.state,
    baselineCount: s.baselineCount, kinds: s.kinds, kind: weakest(Object.keys(s.kinds) as Kind[]) ?? 'simulated',
  }));

  // 2. Anyone else in the same room?
  const sameRoom = roomOrPerson(inputs.summaries, inputs.occupantsNow).filter((r) => r.person === person && signals.some((s) => s.signal === r.signal));

  // 3. Where have they been? Everyone's numbers, so the card can compare.
  const byRoom = new Map<string, Row[]>();
  for (const row of inputs.cabinRows) if (row.room && !row.person) (byRoom.get(row.room) ?? byRoom.set(row.room, []).get(row.room)!).push(row);
  const order = [person, ...inputs.crew.filter((p) => p !== person)];
  const hourly = hourlyAverages(inputs.cabinRows, now - longest, now);
  const windows: ExposureWindow[] = WINDOWS_MS.map((ms) => ({
    ms, from: now - ms, to: now,
    people: order.map((p) => personExposure(p, inputs.stays, byRoom, inputs.cabinRows, now - ms, now, hourly)),
  }));
  const long = windows.find((w) => w.ms === longest)!;
  const me = long.people[0];
  const others = long.people.slice(1);
  const onlyThem = me.rooms
    .filter((r) => r.ms > 0 && !others.some((o) => o.rooms.some((x) => x.room === r.room && x.ms > 0)))
    .map((r) => ({ room: r.room, ms: r.ms, stayKind: r.stayKind }));

  // 4. What did they report?
  const checkins = inputs.checkins.filter((r) => r.person === person && r.signal.startsWith(CHECKIN_PREFIX) && r.t <= now && r.t > now - longest).sort((a, b) => a.t - b.t);
  const reported = {
    rows: checkins.map((r) => ({ t: r.t, signal: r.signal, value: r.value, text: r.text ?? null, unit: r.unit, kind: r.kind })),
    runs: runs(checkins, inputs.offsetMinutes ?? 0),
  };

  // Where it points.
  const reasons: Reason[] = [];
  const level = CO2_LEVELS[0].level;
  const msAbove = (e: { above: { level: number; ms: number }[] }) => e.above.find((a) => a.level === level)?.ms ?? 0;
  const crewmatesMaxMs = Math.max(0, ...others.map(msAbove));
  const exposureRoom = [...me.rooms].sort((a, b) => msAbove(b) - msAbove(a))[0];
  if (msAbove(me) > 0 && msAbove(me) > STANDS_OUT_RATIO * crewmatesMaxMs) {
    reasons.push({ code: 'exposure-stands-out', room: exposureRoom?.room ?? null, level, ms: msAbove(me), crewmatesMaxMs, windowMs: longest, kind: me.kind });
  }
  for (const r of sameRoom) {
    if (r.same.length) reasons.push({ code: 'crewmates-same', signal: r.signal, room: r.room, people: r.same });
    else if (r.judged.length) reasons.push({ code: 'crewmates-normal', signal: r.signal, room: r.room, people: r.judged });
  }
  const roomSide = reasons.some((r) => r.code === 'exposure-stands-out' || r.code === 'crewmates-same');
  const personSide = reasons.some((r) => r.code === 'crewmates-normal');

  const standsOut = reasons.find((r) => r.code === 'exposure-stands-out');
  const shared = reasons.find((r) => r.code === 'crewmates-same');
  const roomNow = Object.entries(inputs.occupantsNow).find(([, people]) => people.includes(person))?.[0] ?? null;
  const focusRoom = (standsOut && standsOut.room) || (shared && shared.room) || roomNow;

  // The reading a room conclusion would lean on: the focus room's CO2.
  if (focusRoom) {
    const problems = sourceProblems(inputs.latest, inputs.stuck, focusRoom, 'co2', now);
    for (const alarm of inputs.alarms) {
      if (alarm.room === focusRoom && alarm.signal === 'co2' && alarm.stale && !problems.some((p) => p.problem === 'stale')) {
        problems.push({ problem: 'stale', room: focusRoom, signal: 'co2', source: alarm.source, kind: alarm.kind, value: alarm.lastReading?.value ?? null, t: alarm.lastReading?.t ?? null, other: null });
      }
    }
    for (const problem of problems) reasons.push({ code: 'sensor', problem });
  }
  const problems = reasons.filter((r): r is Extract<Reason, { code: 'sensor' }> => r.code === 'sensor').map((r) => r.problem.problem);

  // A bad reading matters where the room is what we would point to. Where
  // nothing else answers, a stale, stuck or contradicted reading may be what
  // hides the room, so it is named; a room with no sensor at all is not.
  let pointsTo: PointsTo = 'unknown';
  if (problems.length && roomSide) pointsTo = 'sensor';
  else if (!roomSide && !personSide && problems.some((p) => p !== 'no-reading')) pointsTo = 'sensor';
  else if (roomSide) pointsTo = 'room';
  else if (personSide) pointsTo = 'person';

  return {
    person, now,
    unusual: { signals, score: summary?.score ?? 0 },
    sameRoom,
    whereBeen: { windows, onlyThem },
    reported,
    pointsTo,
    focusRoom,
    reasons,
  };
}
