// Readings that cannot be trusted: impossible, stuck, or contradicted by
// another sensor. Pure functions.
//
// The rule of the project: a missing or broken reading is labelled as such,
// never shown as normal and never turned into an alarm by itself. Every rule
// below is physics or sensor behaviour, not a medical judgement.

import type { Kind, Row } from './types.ts';
import { KIND_RANK } from './types.ts';

/**
 * Values no working sensor can give. Only bounds that physics settles beyond
 * argument: relative humidity and a percentage of oxygen saturation live in
 * 0 to 100 %, a pressure or an amount of gas cannot be negative, nothing is
 * colder than absolute zero, a rate or a count cannot be negative, and the
 * chip's raw readings come from a 12-bit converter (0 to 4095). Each bound
 * applies only in the unit it is written for.
 */
export interface Bound {
  signal: string;
  /** The unit the bound is written in; a row in another unit is not checked. Null: any unit. */
  unit: string | null;
  min: number | null;
  max: number | null;
}

export const BOUNDS: Bound[] = [
  { signal: 'humidity', unit: '%', min: 0, max: 100 },
  { signal: 'blood_oxygen', unit: '%', min: 0, max: 100 },
  { signal: 'sleep_efficiency', unit: '%', min: 0, max: 100 },
  { signal: 'pressure', unit: null, min: 0, max: null },
  { signal: 'co2', unit: null, min: 0, max: null },
  { signal: 'oxygen', unit: null, min: 0, max: null },
  { signal: 'radiation', unit: null, min: 0, max: null },
  { signal: 'temperature', unit: 'C', min: -273.15, max: null },
  { signal: 'heart_rate', unit: null, min: 0, max: null },
  { signal: 'steps', unit: null, min: 0, max: null },
  { signal: 'sleep_duration', unit: null, min: 0, max: null },
  { signal: 'exercise_minutes', unit: null, min: 0, max: null },
  { signal: 'noise', unit: 'raw', min: 0, max: 4095 },
  { signal: 'light', unit: 'raw', min: 0, max: 4095 },
];

/** The bound a row breaks, or null. A row with no number breaks none. */
export function impossible(row: Pick<Row, 'signal' | 'value' | 'unit'>): Bound | null {
  if (row.value === null) return null;
  for (const b of BOUNDS) {
    if (b.signal !== row.signal || (b.unit !== null && b.unit !== row.unit)) continue;
    if ((b.min !== null && row.value < b.min) || (b.max !== null && row.value > b.max)) return b;
  }
  return null;
}

/**
 * A sensor "may be stuck" when a measured source repeats the exact same value
 * for longer than `afterMs`, with at least `minReadings` readings in the run.
 * Opt-in per signal, and only where a working sensor's own noise makes a long
 * exact repeat implausible:
 *  - co2: an NDIR sensor (such as the SCD41 the chip is meant to get) reads in
 *    1 ppm steps with noise of tens of ppm, and people breathing keep cabin CO2
 *    moving. Half an hour of one exact value is a frozen sensor, not a calm room.
 *  - noise: one sample of the microphone on the chip's 12-bit converter jitters
 *    by many counts even in a silent room. Ten minutes of one exact count means
 *    the part is not answering.
 * Left out on purpose: pressure, temperature and humidity (a regulated cabin
 * holds them steady and their sensors report in coarse steps, so long exact
 * repeats are normal), light (a dark room reads 0 for hours), vibration (the
 * chip's value can sit at its floor).
 */
export interface StuckRule {
  signal: string;
  afterMs: number;
  minReadings: number;
}

export const STUCK_RULES: StuckRule[] = [
  { signal: 'co2', afterMs: 30 * 60_000, minReadings: 10 },
  { signal: 'noise', afterMs: 10 * 60_000, minReadings: 30 },
];

/** A run that has gone on longer than its rule allows. */
export interface Stuck {
  room: string;
  signal: string;
  source: string;
  kind: Kind;
  value: number;
  /** First reading of the run, and the newest. */
  since: number;
  lastAt: number;
  readings: number;
}

/** A source that has not sent for this long is "no reading", not stuck. Same as HOLD_MS in exposure.ts. */
const QUIET_MS = 600_000;

/**
 * Every room sensor that may be stuck now. `rows` are cabin rows (room set, no
 * person) reaching back at least as far as the longest rule.
 */
export function stuckSensors(rows: Row[], now: number, rules: StuckRule[] = STUCK_RULES): Stuck[] {
  const bySource = new Map<string, Row[]>();
  for (const row of rows) {
    if (!row.room || row.person || row.kind !== 'measured' || row.value === null || row.t > now) continue;
    if (!rules.some((r) => r.signal === row.signal)) continue;
    const key = `${row.room}|${row.signal}|${row.source}`;
    const list = bySource.get(key) ?? [];
    list.push(row);
    bySource.set(key, list);
  }
  const out: Stuck[] = [];
  for (const list of bySource.values()) {
    list.sort((a, b) => a.t - b.t);
    const last = list[list.length - 1];
    if (now - last.t > QUIET_MS) continue;
    let i = list.length - 1;
    while (i > 0 && list[i - 1].value === last.value) i--;
    const rule = rules.find((r) => r.signal === last.signal)!;
    const readings = list.length - i;
    if (last.t - list[i].t >= rule.afterMs && readings >= rule.minReadings) {
      out.push({ room: last.room!, signal: last.signal, source: last.source, kind: last.kind, value: last.value!, since: list[i].t, lastAt: last.t, readings });
    }
  }
  return out;
}

/**
 * Two sources for the same room and signal are "far apart" when the larger is
 * more than `ratio` times the smaller AND they differ by more than `minGap`.
 * Defined only where it can be argued; any other signal is never called
 * contradicted.
 *  - co2: NDIR sensors are specified to about ±(40 ppm + 5 %), so two working
 *    ones at cabin levels (2 to 4 mmHg, about 2,600 to 5,300 ppm) differ by
 *    well under a fifth. A factor of two, and at least 0.5 mmHg (about 660 ppm),
 *    cannot be sensor accuracy: one of the two is wrong.
 */
export const FAR_APART: Record<string, { ratio: number; minGap: number }> = {
  co2: { ratio: 2, minGap: 0.5 },
};

export function farApart(signal: string, a: number, b: number): boolean {
  const rule = FAR_APART[signal];
  if (!rule) return false;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return hi - lo > rule.minGap && hi > rule.ratio * Math.max(lo, 0);
}

/** Problems with the reading a conclusion leans on. Empty when there are none. */
export interface SourceProblem {
  problem: 'no-reading' | 'stale' | 'stuck' | 'contradicted';
  room: string;
  signal: string;
  /** The reading in question, if there is one. */
  source: string | null;
  kind: Kind | null;
  value: number | null;
  t: number | null;
  /** Contradicted only: the other source and what it says. */
  other: { source: string; kind: Kind; value: number; t: number } | null;
}

/**
 * Checks the reading a room's conclusion rests on. `latest` holds the newest
 * row of each source (as Store.recent gives them). The reading used is the
 * best kind among fresh ones, as `current` in timeline.ts picks it.
 *  - no-reading: no source at all.
 *  - stale: the newest reading is older than `freshMs`.
 *  - stuck: the source in use is in `stuck`.
 *  - contradicted: another fresh source of equal or better kind is far apart.
 */
export function sourceProblems(latest: Row[], stuck: Stuck[], room: string, signal: string, now: number, freshMs = QUIET_MS): SourceProblem[] {
  const mine = latest.filter((r) => r.room === room && !r.person && r.signal === signal && r.value !== null && r.t <= now);
  const blank = { room, signal, other: null };
  if (!mine.length) return [{ problem: 'no-reading', ...blank, source: null, kind: null, value: null, t: null }];
  const fresh = mine.filter((r) => now - r.t <= freshMs);
  if (!fresh.length) {
    const newest = mine.reduce((a, b) => (b.t > a.t ? b : a));
    return [{ problem: 'stale', ...blank, source: newest.source, kind: newest.kind, value: newest.value, t: newest.t }];
  }
  fresh.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.t - a.t);
  const used = fresh[0];
  const at = { source: used.source, kind: used.kind, value: used.value, t: used.t };
  const out: SourceProblem[] = [];
  if (stuck.some((s) => s.room === room && s.signal === signal && s.source === used.source)) out.push({ problem: 'stuck', ...blank, ...at });
  for (const other of fresh.slice(1)) {
    if (KIND_RANK[other.kind] > KIND_RANK[used.kind] || other.source === used.source) continue;
    if (farApart(signal, used.value!, other.value!)) {
      out.push({ problem: 'contradicted', ...blank, ...at, other: { source: other.source, kind: other.kind, value: other.value!, t: other.t } });
    }
  }
  return out;
}
