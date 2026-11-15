// Cabin limits and the maths that checks a room against them. Pure functions.
//
// Every limit here is NASA's own number with its source. A reading with no
// verified NASA limit has no alarm.

import type { Kind, Row } from './types.ts';
import { KIND_RANK } from './types.ts';
import type { Stuck } from './quality.ts';

export interface Limit {
  signal: string;
  unit: string;
  /** The average over `windowMs` must not go above this. */
  max: number;
  windowMs: number;
  source: string;
}

export const LIMITS: Limit[] = [
  {
    signal: 'co2',
    unit: 'mmHg',
    max: 3,
    windowMs: 3600_000,
    source: 'NASA OCHMO-TB-004: the 1-hour average CO2 is to be "no more than 3 mmHg".',
  },
];


/**
 * The average of one room's signal over the window ending at `now`, weighted
 * by time (each reading holds until the next one). Uses one source only: the
 * best kind that covers at least three quarters of the window. Returns null
 * when no source covers enough of it, because an average of ten minutes is
 * not a 1-hour average.
 */
export function windowAverage(rows: Row[], room: string, signal: string, now: number, windowMs: number): { value: number; source: string; kind: Kind } | null {
  const from = now - windowMs;
  const bySource = new Map<string, Row[]>();
  /** Each source's reading in force when the window opens, if the rows reach back that far. */
  const before = new Map<string, Row>();
  for (const row of rows) {
    if (row.room !== room || row.person || row.signal !== signal || row.value === null || row.t > now) continue;
    if (row.t < from) {
      const held = before.get(row.source);
      if (!held || row.t > held.t) before.set(row.source, row);
      continue;
    }
    const list = bySource.get(row.source) ?? [];
    list.push(row);
    bySource.set(row.source, list);
  }
  let best: { value: number; source: string; kind: Kind } | null = null;
  for (const [source, list] of bySource) {
    list.sort((a, b) => a.t - b.t);
    let weighted = 0;
    let covered = 0;
    // The reading in force at the window's start holds into it, until the next one (at most 10 minutes from when it was read).
    const opening = before.get(source);
    if (opening) {
      const held = Math.min(list[0].t, opening.t + 600_000) - from;
      if (held > 0) { weighted += opening.value! * held; covered += held; }
    }
    for (let i = 0; i < list.length; i++) {
      const until = i + 1 < list.length ? list[i + 1].t : now;
      // A reading stands for at most 10 minutes; longer than that is a gap.
      const held = Math.min(until - list[i].t, 600_000);
      weighted += list[i].value! * held;
      covered += held;
    }
    if (covered < windowMs * 0.75) continue;
    const kind = list[list.length - 1].kind;
    if (!best || KIND_RANK[kind] < KIND_RANK[best.kind]) best = { value: weighted / covered, source, kind };
  }
  return best;
}

/**
 * windowAverage at many moments at once, for the highest 1-hour average a
 * person breathed (evidence.ts). `times` must be in ascending order; `rows`
 * in time order, as the store returns them. Each answer is windowAverage's
 * for that moment (equal up to float rounding: tested): the same reading held
 * until the next for at most 10 minutes, the reading in force when the window
 * opens, three quarters of the window covered, one source of the best kind.
 * It walks each source once instead of once per moment.
 */
export function windowAverages(rows: Row[], room: string, signal: string, times: number[], windowMs: number): ({ value: number; source: string; kind: Kind } | null)[] {
  const HOLD = 600_000;
  const bySource = new Map<string, { t: number[]; v: number[]; kind: Kind[]; order: number[] }>();
  rows.forEach((row, i) => {
    if (row.room !== room || row.person || row.signal !== signal || row.value === null) return;
    const s = bySource.get(row.source) ?? bySource.set(row.source, { t: [], v: [], kind: [], order: [] }).get(row.source)!;
    s.t.push(row.t); s.v.push(row.value); s.kind.push(row.kind); s.order.push(i);
  });
  // Per source: each reading's stretch [t, end), and the running sums of value x time and time before each one.
  const sources = [...bySource.entries()].map(([source, s]) => {
    const idx = s.t.map((_, i) => i);
    if (s.t.some((x, i) => i > 0 && x < s.t[i - 1])) idx.sort((a, b) => s.t[a] - s.t[b] || a - b);
    const t = idx.map((i) => s.t[i]);
    const v = idx.map((i) => s.v[i]);
    const kind = idx.map((i) => s.kind[i]);
    const order = idx.map((i) => s.order[i]);
    const end = t.map((x, i) => Math.min(i + 1 < t.length ? t[i + 1] : Infinity, x + HOLD));
    const sumW = [0];
    const sumC = [0];
    for (let i = 0; i < t.length; i++) { sumW.push(sumW[i] + v[i] * (end[i] - t[i])); sumC.push(sumC[i] + (end[i] - t[i])); }
    return { source, t, v, kind, order, end, sumW, sumC, upTo: 0, before: 0, atFrom: 0 };
  });
  type Src = (typeof sources)[number];
  // Value x time and time covered from the first reading up to x. k: readings at or before x.
  const integral = (s: Src, k: number, x: number): [number, number] => {
    if (k === 0) return [0, 0];
    const held = Math.max(0, Math.min(x, s.end[k - 1]) - s.t[k - 1]);
    return [s.sumW[k - 1] + s.v[k - 1] * held, s.sumC[k - 1] + held];
  };
  const out: ({ value: number; source: string; kind: Kind } | null)[] = [];
  for (const now of times) {
    const from = now - windowMs;
    let best: { value: number; source: string; kind: Kind; order: number } | null = null;
    for (const s of sources) {
      while (s.upTo < s.t.length && s.t[s.upTo] <= now) s.upTo++;
      while (s.before < s.t.length && s.t[s.before] < from) s.before++;
      while (s.atFrom < s.t.length && s.t[s.atFrom] <= from) s.atFrom++;
      if (s.upTo - s.before <= 0) continue; // no reading inside the window
      const [w1, c1] = integral(s, s.upTo, now);
      const [w0, c0] = integral(s, s.atFrom, from);
      const covered = c1 - c0;
      if (covered < windowMs * 0.75) continue;
      const kind = s.kind[s.upTo - 1];
      const order = s.order[s.before];
      if (!best || KIND_RANK[kind] < KIND_RANK[best.kind] || (KIND_RANK[kind] === KIND_RANK[best.kind] && order < best.order)) {
        best = { value: (w1 - w0) / covered, source: s.source, kind, order };
      }
    }
    out.push(best && { value: best.value, source: best.source, kind: best.kind });
  }
  return out;
}

export interface RoomAlarm {
  room: string;
  signal: string;
  /** The average that broke the limit, and the latest one. */
  value: number;
  /** How far over the limit, rounded up to 2 decimals: 3.004 against 3 is 0.01, never 0. */
  over?: number;
  unit: string;
  limit: number;
  /**
   * Where the limit comes from: NASA's words and document for a NASA limit,
   * or 'crew' for a level the crew set on one of their own sensors
   * (engine/sensors.ts judgeCrewRooms). The two are never mixed: a room can
   * have both, as two alarms.
   */
  limitSource: string;
  kind: Kind;
  source: string;
  since: number;
  /** A crew level only: which side it was passed on (`over` is then how far past), its window, the sensor, and the string key to word it. */
  direction?: 'above' | 'below';
  windowMinutes?: number | null;
  sensor?: string;
  textKey?: string;
  /** Someone has silenced it. It stays listed until the room is back under the limit. */
  acknowledged: boolean;
  /**
   * The source behind the alarm has gone quiet (nothing for HOLD_MS). The
   * alarm stays, marked stale, until readings return under the limit: a
   * sensor going quiet never clears it.
   */
  stale?: boolean;
  /** The newest reading from that source, for "last reading 3.4 mmHg, 12 minutes ago". */
  lastReading?: { value: number; t: number } | null;
  /** The source behind the alarm may be stuck (quality.ts). An over-limit value still alarms. */
  stuck?: boolean;
  /** Raised by a drill's simulated reading (core/drill.ts), never by the room's air. */
  drill?: true;
}

/** A room and signal with a limit that could not be judged: no reading, or only a reading that may be stuck. */
export interface Unjudged {
  room: string;
  signal: string;
  reason: 'no-reading' | 'stuck';
  /** When the hub first found it could not judge it, in this run. */
  since: number;
  /** The newest reading of that signal in that room from any source, or null if there is none. */
  last: { value: number; t: number; source: string; kind: Kind } | null;
}

/** A reading stands for at most this long (HOLD_MS in exposure.ts); after it, its source counts as quiet. */
export const QUIET_MS = 600_000;

/**
 * How far a value is over a limit, rounded up to 2 decimals, so a screen can
 * say "0.01 over" where the rounded value would read "3, limit 3". Never 0
 * for a value that is over. Display only: the alarm rule compares unrounded.
 */
export function overBy(value: number, limit: number): number {
  // The small allowance stops float noise (3.1 - 3 = 0.10000000000000009) from rounding up a whole step.
  return Math.max(0.01, Math.ceil((value - limit) * 100 - 1e-9) / 100);
}

/** One room's average for every signal that has a limit, whether over it or not. */
export function limitAverages(rows: Row[], room: string, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const limit of LIMITS) {
    const average = windowAverage(rows, room, limit.signal, now, limit.windowMs);
    if (average) out[limit.signal] = Number(average.value.toFixed(2));
  }
  return out;
}

/** Checks one room against every limit. Returns what is over, without history. */
export function overLimit(rows: Row[], room: string, now: number): Omit<RoomAlarm, 'since' | 'acknowledged'>[] {
  const out: Omit<RoomAlarm, 'since' | 'acknowledged'>[] = [];
  for (const limit of LIMITS) {
    const average = windowAverage(rows, room, limit.signal, now, limit.windowMs);
    if (average && average.value > limit.max) {
      out.push({ room, signal: limit.signal, value: Number(average.value.toFixed(2)), over: overBy(average.value, limit.max), unit: limit.unit, limit: limit.max, limitSource: limit.source, kind: average.kind, source: average.source });
    }
  }
  return out;
}

export interface RoomJudgement {
  alarms: RoomAlarm[];
  unjudged: Unjudged[];
  /** Each room's average for each limited signal it could be judged on: signal → room → value. */
  averages: Record<string, Record<string, number>>;
}

/**
 * Judges every room against every limit, carrying over what was found before.
 * `rowsOf(room)` gives the room's rows for the longest window, plus (if the
 * window holds none of a signal) that signal's newest older row, so a room
 * that went quiet long ago can still say what it last read.
 *
 * - Over the limit: an alarm, kept with its first `since` and acknowledgement.
 * - Under the limit, on a source that is not stuck and of a kind at least as
 *   good as the one that raised the alarm: the alarm clears. A simulated
 *   stand-in cannot clear an alarm a measured sensor raised.
 * - No average (the sensor went quiet), or only a stuck source under the
 *   limit: the room is listed as unjudged, and an alarm already raised stays,
 *   marked stale when its source has gone quiet.
 */
export function judgeRooms(rooms: string[], rowsOf: (room: string) => Row[], now: number, before: RoomAlarm[], unjudgedBefore: Unjudged[], stuck: Stuck[]): RoomJudgement {
  const alarms: RoomAlarm[] = [];
  const unjudged: Unjudged[] = [];
  const averages: Record<string, Record<string, number>> = {};
  for (const room of rooms) {
    const rows = rowsOf(room);
    for (const limit of LIMITS) {
      const held = before.find((a) => a.room === room && a.signal === limit.signal && a.limitSource !== 'crew');
      const newestOf = (source: string | null) => {
        let best: Row | null = null;
        for (const r of rows) {
          if (r.room !== room || r.person || r.signal !== limit.signal || r.value === null || r.t > now) continue;
          if (source !== null && r.source !== source) continue;
          if (!best || r.t > best.t) best = r;
        }
        return best;
      };
      const average = windowAverage(rows, room, limit.signal, now, limit.windowMs);
      const isStuck = !!average && stuck.some((s) => s.room === room && s.signal === limit.signal && s.source === average.source);
      if (average && !isStuck) (averages[limit.signal] ??= {})[room] = Number(average.value.toFixed(2));

      const keep = (alarm: RoomAlarm, source: string) => {
        const last = newestOf(source);
        alarms.push({ ...alarm, stale: !last || now - last.t > QUIET_MS, lastReading: last ? { value: last.value!, t: last.t } : null });
      };

      if (average && average.value > limit.max) {
        const value = Number(average.value.toFixed(2));
        keep({
          room, signal: limit.signal, value, over: overBy(average.value, limit.max), unit: limit.unit, limit: limit.max, limitSource: limit.source, kind: average.kind, source: average.source,
          since: held?.since ?? now, acknowledged: held?.acknowledged ?? false, stuck: isStuck,
        }, average.source);
        continue;
      }
      const clears = average && !isStuck && (!held || KIND_RANK[average.kind] <= KIND_RANK[held.kind]);
      if (clears) continue;
      if (held) keep({ ...held, stuck: stuck.some((s) => s.room === room && s.signal === limit.signal && s.source === held.source) }, held.source);
      if (!average || isStuck) {
        const prior = unjudgedBefore.find((u) => u.room === room && u.signal === limit.signal);
        const last = newestOf(null);
        unjudged.push({
          room, signal: limit.signal, reason: isStuck ? 'stuck' : 'no-reading', since: prior?.since ?? now,
          last: last ? { value: last.value!, t: last.t, source: last.source, kind: last.kind } : null,
        });
      }
    }
  }
  return { alarms, unjudged, averages };
}
