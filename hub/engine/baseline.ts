// The per-person baseline: is this reading unusual FOR THIS PERSON?
//
// One sentence: the recent value is compared with the median of the same
// person's own earlier readings, taken in the same state (rest or exercise),
// and the distance is counted in units of their usual spread.
//
// No trained model. Median and MAD (scaled by 1.4826 so it matches a standard
// deviation on bell-shaped data) instead of mean and SD, so one odd night does
// not move the baseline. Pure functions: no I/O, runs in the hub and the browser.

import type { Kind, Row } from './types.ts';
import { KIND_RANK } from './types.ts';
import type { Reading, ReadingLabel } from './prompt.ts';
import { HEART_RATE_SIGNALS, heartRateRiseCounts } from './medical.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** MAD times this estimates the standard deviation of a normal distribution. */
export const MAD_SCALE = 1.4826;
/** Mean absolute deviation times this does the same; used when the MAD is 0. */
export const MEAN_AD_SCALE = 1.2533;
/** Robust z is reported up to this size, so a flat history never gives Infinity. */
export const Z_CAP = 10;

export interface BaselineOptions {
  /** The state a reading was taken in. Only readings in the same state are compared. */
  stateOf?: (row: Row) => string;
  /** How far back the baseline reaches. */
  baselineMs?: number;
  /** The recent window for dense signals. With fewer readings than `denseMin` in it, a signal that
   * usually has that many is a gap (no judgement); one that usually has fewer is judged on its latest value. */
  recentMs?: number;
  /** A signal is dense when the recent window holds at least this many readings. */
  denseMin?: number;
  /** Baseline readings needed before a dense signal is judged (30: about 2.5 hours at one reading every 5 minutes). */
  minDense?: number;
  /** Baseline readings needed before a daily signal is judged (3: three earlier days). */
  minDaily?: number;
  /** A daily value older than this is not "the latest" any more. */
  dailyFreshMs?: number;
  /**
   * Vital signs: a reading of one of these is current only this long, however
   * sparse the signal (a watch's blood oxygen every few hours is not a daily value).
   * Older, it is a gap, and is never judged or handed on as a current reading.
   */
  liveSignals?: readonly string[];
  liveFreshMs?: number;
  /** |z| at or above this counts as unusual. */
  threshold?: number;
  /**
   * A second condition a rise must also meet to count, by signal: the medical
   * lead's heart rate rule (engine/medical.ts) by default. Null turns it off.
   */
  riseCounts?: ((signal: string, usual: number, recent: number) => boolean) | null;
}

export const DEFAULTS = {
  stateOf: (row: Row): string => (row.room === 'gym' ? 'exercise' : 'rest'),
  baselineMs: 14 * DAY,
  recentMs: 60 * MINUTE,
  denseMin: 2,
  minDense: 30,
  minDaily: 3,
  dailyFreshMs: 36 * HOUR,
  /** The phone's rule: a reading counts as current for one hour; only daily values (sleep, totals) for a day and a half. */
  liveSignals: ['heart_rate', 'hrv', 'respiratory_rate', 'breathing_rate', 'blood_oxygen', 'blood_pressure_systolic', 'blood_pressure_diastolic', 'body_temperature'] as readonly string[],
  liveFreshMs: 60 * MINUTE,
  threshold: 3,
  /** Her rule: a heart rate rise counts only above 20 % or 20 bpm over the person's usual. */
  riseCounts: (signal: string, usual: number, recent: number): boolean => !HEART_RATE_SIGNALS.includes(signal) || heartRateRiseCounts(usual, recent),
};

/**
 * The same freshness rule for a screen: a vital sign counts as current for an
 * hour, any other body value (sleep, steps, energy, exercise, check-in) for 36 hours.
 */
export function isCurrentReading(signal: string, t: number, now: number): boolean {
  return now - t <= (DEFAULTS.liveSignals.includes(signal) ? DEFAULTS.liveFreshMs : DEFAULTS.dailyFreshMs);
}

/**
 * A state function that also knows sleep: the gym is exercise, the sleep
 * hours of the station day are sleep, the rest is rest. `offsetMinutes` is
 * station time minus UTC, as in crew.ts. Without it, sleep and awake rest
 * share one baseline and its spread is wider.
 */
export function stateWithSleep(offsetMinutes: number, sleepStart = 22, sleepEnd = 6): (row: Row) => string {
  return (row) => {
    if (row.room === 'gym') return 'exercise';
    const hour = ((((row.t + offsetMinutes * MINUTE) % DAY) + DAY) % DAY) / HOUR;
    const asleep = sleepStart > sleepEnd ? hour >= sleepStart || hour < sleepEnd : hour >= sleepStart && hour < sleepEnd;
    return asleep ? 'sleep' : 'rest';
  };
}

/** How many rows of each kind went into a result, so the screen can say what it was built from. */
export type KindMix = Partial<Record<Kind, number>>;

interface Common {
  signal: string;
  /** 'dense': recent = median of the recent window. 'daily': recent = the latest value. */
  mode: 'dense' | 'daily';
  state: string;
  baselineCount: number;
  kinds: KindMix;
  /** When the newest reading behind `recent` was taken. */
  latestAt?: number;
}

export interface Judged extends Common {
  status: 'judged';
  recent: number;
  /** Median of the baseline. */
  usual: number;
  /** Scaled MAD of the baseline (0 when every baseline value is identical). */
  spread: number;
  /** Robust z, signed: (recent - usual) / spread, capped at ±Z_CAP. */
  z: number;
  unusual: boolean;
  direction: 'high' | 'low' | null;
  recentCount: number;
  /** Every baseline value was identical; any difference is reported at ±Z_CAP. */
  flat: boolean;
}

export interface NotEnough extends Common {
  status: 'not-enough-history';
  recent: number;
  /** How many baseline readings it needs before it judges. */
  needed: number;
}

/** The signal has history but nothing recent: a gap, which never raises a flag. */
export interface NoRecent {
  status: 'no-recent';
  signal: string;
  baselineCount: number;
  lastSeen: number | null;
}

export type SignalBaseline = Judged | NotEnough | NoRecent;

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median and scaled MAD. Falls back to the scaled mean absolute deviation when more than half the values are equal. */
export function robust(values: number[]): { usual: number; spread: number } {
  const usual = median(values);
  const deviations = values.map((v) => Math.abs(v - usual));
  let spread = median(deviations) * MAD_SCALE;
  if (spread === 0) spread = (deviations.reduce((a, b) => a + b, 0) / deviations.length) * MEAN_AD_SCALE;
  return { usual, spread };
}

function mix(rows: Row[]): KindMix {
  const out: KindMix = {};
  for (const row of rows) out[row.kind] = (out[row.kind] ?? 0) + 1;
  return out;
}

/**
 * One signal of one person, judged against their own history.
 * `rows` are that person's rows; other signals and null values are ignored.
 */
export function signalBaseline(rows: Row[], signal: string, now: number, opts: BaselineOptions = {}): SignalBaseline {
  const o = { ...DEFAULTS, ...opts };
  const all = rows.filter((r) => r.signal === signal && r.value !== null && r.t <= now && r.t >= now - o.baselineMs).sort((a, b) => a.t - b.t);
  const recentStart = now - o.recentMs;
  const inRecent = all.filter((r) => r.t > recentStart);

  let mode: 'dense' | 'daily';
  let recentRows: Row[];
  let before: Row[];
  if (inRecent.length >= o.denseMin) {
    mode = 'dense';
    const state = o.stateOf(inRecent[inRecent.length - 1]);
    recentRows = inRecent.filter((r) => o.stateOf(r) === state);
    before = all.filter((r) => r.t <= recentStart);
  } else {
    const latest = all[all.length - 1];
    // A dense signal that went quiet is a gap, not a daily value; so is a stale daily value,
    // and so is a vital sign older than its live window.
    const older = all.filter((r) => r.t <= recentStart);
    const windows = older.length ? Math.max(1, (recentStart - older[0].t) / o.recentMs) : 1;
    const usuallyDense = older.length / windows >= o.denseMin;
    const freshMs = o.liveSignals.includes(signal) ? o.liveFreshMs : o.dailyFreshMs;
    if (!latest || usuallyDense || now - latest.t > freshMs) {
      return { status: 'no-recent', signal, baselineCount: older.length, lastSeen: latest?.t ?? null };
    }
    mode = 'daily';
    recentRows = [latest];
    before = all.slice(0, -1);
  }

  const state = o.stateOf(recentRows[recentRows.length - 1]);
  const baseline = before.filter((r) => o.stateOf(r) === state);
  const recent = median(recentRows.map((r) => r.value!));
  const needed = mode === 'dense' ? o.minDense : o.minDaily;
  const kinds = mix([...baseline, ...recentRows]);
  const common = { signal, mode, state, baselineCount: baseline.length, kinds, latestAt: recentRows[recentRows.length - 1].t };

  if (baseline.length < needed) return { status: 'not-enough-history', ...common, recent, needed };

  const { usual, spread } = robust(baseline.map((r) => r.value!));
  const diff = recent - usual;
  const flat = spread === 0;
  let z = flat ? (diff === 0 ? 0 : Math.sign(diff) * Z_CAP) : diff / spread;
  z = Math.max(-Z_CAP, Math.min(Z_CAP, z));
  const unusual = Math.abs(z) >= o.threshold && (z < 0 || !o.riseCounts || o.riseCounts(signal, usual, recent));
  return {
    status: 'judged', ...common, recent, usual, spread, z, unusual,
    direction: unusual ? (z > 0 ? 'high' : 'low') : null,
    recentCount: recentRows.length, flat,
  };
}

export interface PersonSummary {
  person: string;
  now: number;
  /** Judged signals sorted by |z| (largest first), then the ones that could not be judged. */
  signals: SignalBaseline[];
  /**
   * 0 to 1, from the largest |z| alone: min(1, |z| / (2 × threshold)).
   * 0.5 is where a signal first counts as unusual; 1 is twice that far.
   * It is a distance, not a probability.
   */
  score: number;
  /** Up to three unusual signals, largest |z| first. Empty when nothing is unusual. */
  top: string[];
}

/** Every numeric signal one person has, each judged against their own history. */
export function personSummary(rows: Row[], person: string, now: number, opts: BaselineOptions = {}): PersonSummary {
  const threshold = opts.threshold ?? DEFAULTS.threshold;
  const mine = rows.filter((r) => r.person === person && r.value !== null);
  const signals = [...new Set(mine.map((r) => r.signal))].map((s) => signalBaseline(mine, s, now, opts));
  const absZ = (s: SignalBaseline) => (s.status === 'judged' ? Math.abs(s.z) : -1);
  signals.sort((a, b) => absZ(b) - absZ(a) || a.signal.localeCompare(b.signal));
  const largest = Math.max(0, ...signals.map(absZ));
  const score = Math.min(1, largest / (2 * threshold));
  const top = signals.filter((s): s is Judged => s.status === 'judged' && s.unusual).slice(0, 3).map((s) => s.signal);
  return { person, now, signals, score: Number(score.toFixed(2)), top };
}

/**
 * The line the prompt expects (the detector line in the prompt spec, §5.3):
 * "Detector: anomaly 0.91. Main signals: heart rate, HRV, CO2." or "Detector: normal."
 */
export function detectorLine(summary: PersonSummary, names: Record<string, string> = {}): string {
  if (summary.top.length === 0) return 'Detector: normal.';
  const list = summary.top.map((s) => names[s] ?? s);
  return `Detector: anomaly ${summary.score.toFixed(2)}. Main signal${list.length > 1 ? 's' : ''}: ${list.join(', ')}.`;
}

/**
 * A signal's name as the crew reads it. `named` is the string table's name;
 * when the table has none (it hands back "signal.blood_oxygen"), the id is
 * written out in words ("blood oxygen"), so a code name never reaches a sentence.
 */
export function plainSignalName(signal: string, named?: string | null): string {
  if (named && !/^signal\./.test(named) && !/[._]/.test(named)) return named;
  if (signal === 'hrv') return 'HRV';
  return signal.replace(/^(checkin|mood)\./, '').replace(/[._]+/g, ' ').trim();
}

/**
 * The person's judged body readings, as the hub hands them to Astra and to its
 * own sentences: only readings inside their freshness window (signalBaseline
 * leaves the rest out as gaps). A daily value is named with its time: "sleep
 * last night" already is; any other is "…, latest daily value", never shown
 * as a current vital sign.
 */
export function summaryReadings(
  summary: PersonSummary | null,
  nameOf: (signal: string) => string,
  unitOf: (signal: string) => string,
): Extract<Reading, { type: 'normal' }>[] {
  const out: Extract<Reading, { type: 'normal' }>[] = [];
  const round1 = (v: number) => Math.round(v * 10) / 10;
  for (const s of summary?.signals ?? []) {
    if (s.status !== 'judged') continue;
    const label: ReadingLabel = (Object.keys(s.kinds) as Kind[]).sort((a, b) => KIND_RANK[b] - KIND_RANK[a])[0] ?? 'simulated';
    let name = plainSignalName(s.signal, nameOf(s.signal));
    if (s.mode === 'daily' && !/\b(last night|yesterday)\b/i.test(name)) name = `${name.replace(/\s*\btoday\b\s*/i, ' ').trim()}, latest daily value`;
    out.push({ type: 'normal', name, value: round1(s.recent), unit: unitOf(s.signal), label, normal: round1(s.usual), judged: s.unusual ? (s.direction === 'high' ? 'above' : 'below') : 'inside' });
  }
  return out;
}

export interface RoomOrPerson {
  person: string;
  signal: string;
  direction: 'high' | 'low';
  /** The room the person is in now, or null if not placed. */
  room: string | null;
  /** Others in that room now. */
  crewmates: string[];
  /** Crewmates whose same signal could be judged. */
  judged: string[];
  /** Crewmates unusual in the same direction. */
  same: string[];
  /** 'room' when a crewmate in the same room shows it too, 'person' when judged crewmates do not, 'unknown' when nobody can be compared. */
  pointsTo: 'room' | 'person' | 'unknown';
}

/**
 * For every unusual signal: does it point to the room or to the person?
 * `occupantsNow` is who is in each room, as `occupants()` in timeline.ts gives it.
 */
export function roomOrPerson(summaries: PersonSummary[], occupantsNow: Record<string, string[]>): RoomOrPerson[] {
  const roomOf = new Map<string, string>();
  for (const [room, people] of Object.entries(occupantsNow)) for (const p of people) roomOf.set(p, room);
  const find = (person: string, signal: string) => {
    const s = summaries.find((x) => x.person === person)?.signals.find((x) => x.signal === signal);
    return s && s.status === 'judged' ? s : null;
  };

  const out: RoomOrPerson[] = [];
  for (const summary of summaries) {
    for (const s of summary.signals) {
      if (s.status !== 'judged' || !s.unusual || !s.direction) continue;
      const room = roomOf.get(summary.person) ?? null;
      const crewmates = room ? occupantsNow[room].filter((p) => p !== summary.person) : [];
      const judged = crewmates.filter((p) => find(p, s.signal));
      const same = judged.filter((p) => find(p, s.signal)!.direction === s.direction);
      const pointsTo = same.length > 0 ? 'room' : judged.length > 0 ? 'person' : 'unknown';
      out.push({ person: summary.person, signal: s.signal, direction: s.direction, room, crewmates, judged, same, pointsTo });
    }
  }
  return out;
}
