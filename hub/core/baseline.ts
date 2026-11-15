// Keeps each crewmate's baseline summary up to date (engine/baseline.ts) and
// hands the alert levels the readings that have stayed unusual.
//
// A reading has to stay unusual for 20 minutes before anyone is told: on
// ordinary simulated days the first minutes of exercise looked unusual for a
// moment about once a day, and a crew that gets false alarms stops listening.
//
// Each person's last 14 days of written rows (at most BASELINE_LIMIT, the newest)
// are kept in memory (PersonRows): read from the database once, then added to
// as the store writes rows. A refresh then reads no database and judges each
// signal on its own rows only. The result is the same as personSummary() on the
// same rows read from the database (core/baseline.test.ts checks it).

import { DEFAULTS, signalBaseline, stateWithSleep } from '../engine/baseline.ts';
import type { BaselineOptions, Judged, PersonSummary, SignalBaseline } from '../engine/baseline.ts';
import type { Unusual } from '../engine/alerts.ts';
import type { Kind, Row } from '../engine/types.ts';
import type { Store } from './db.ts';

export const BASELINE_MS = 14 * 24 * 3600_000;
/** The most rows of one person a baseline is built from: the newest, as the store's largest read. */
export const BASELINE_LIMIT = 50_000;
/** Rows kept beyond the limit, for rows stamped a little ahead of the clock. */
const SLACK = 5_000;

const before = (a: Row, b: Row) => a.t - b.t || (a.id ?? 0) - (b.id ?? 0);

/**
 * One person's written rows, oldest first (by time, then by id, as the store
 * returns them), bounded to the newest BASELINE_LIMIT + SLACK and to the
 * baseline's 14 days. window() gives what store.rows({ person, from, to, limit }) gives.
 */
export class PersonRows {
  private rows: Row[] = [];
  private sorted = true;
  /** The latest `now` trimmed to: a window ending earlier may need rows already dropped. */
  trimmedTo = -Infinity;

  constructor(rows: Row[]) {
    this.rows = rows.slice().sort(before);
  }

  add(row: Row): void {
    const last = this.rows[this.rows.length - 1];
    if (last && before(row, last) < 0) this.sorted = false;
    this.rows.push(row);
  }

  /** Rows with from <= t <= to, the newest `limit` of them, oldest first. */
  window(from: number, to: number, limit: number): Row[] {
    if (!this.sorted) { this.rows.sort(before); this.sorted = true; }
    const rows = this.rows;
    let end = rows.length;
    while (end > 0 && rows[end - 1].t > to) end--;
    let lo = 0;
    let hi = end;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].t < from) lo = mid + 1; else hi = mid; }
    return rows.slice(Math.max(lo, end - limit), end);
  }

  /** Drops rows the baseline can no longer use at `now` or later. */
  trim(now: number): void {
    if (!this.sorted) { this.rows.sort(before); this.sorted = true; }
    let drop = 0;
    while (drop < this.rows.length && this.rows[drop].t < now - BASELINE_MS) drop++;
    drop = Math.max(drop, this.rows.length - (BASELINE_LIMIT + SLACK));
    if (drop > 0) this.rows = this.rows.slice(drop);
    this.trimmedTo = Math.max(this.trimmedTo, now);
  }

  get size(): number { return this.rows.length; }
}

/**
 * personSummary() (engine/baseline.ts) for rows that are all one person's,
 * judging each signal on its own rows instead of filtering every row once per
 * signal. Same signals, same order, same score.
 */
export function summaryOf(rows: Row[], person: string, now: number, opts: BaselineOptions = {}): PersonSummary {
  const threshold = opts.threshold ?? DEFAULTS.threshold;
  const bySignal = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.person !== person || r.value === null) continue;
    const list = bySignal.get(r.signal);
    if (list) list.push(r); else bySignal.set(r.signal, [r]);
  }
  const signals: SignalBaseline[] = [...bySignal].map(([signal, list]) => signalBaseline(list, signal, now, opts));
  const absZ = (s: SignalBaseline) => (s.status === 'judged' ? Math.abs(s.z) : -1);
  signals.sort((a, b) => absZ(b) - absZ(a) || a.signal.localeCompare(b.signal));
  const largest = Math.max(0, ...signals.map(absZ));
  const score = Math.min(1, largest / (2 * threshold));
  const top = signals.filter((s): s is Judged => s.status === 'judged' && s.unusual).slice(0, 3).map((s) => s.signal);
  return { person, now, signals, score: Number(score.toFixed(2)), top };
}
const REFRESH_MS = 60_000;
export const SUSTAIN_MS = 20 * 60_000;
const RANK: Kind[] = ['simulated', 'replayed', 'reported', 'estimated', 'measured'];

export class Baselines {
  private summaries = new Map<string, PersonSummary>();
  /** When each person's summary was computed. */
  private computedAt = new Map<string, number>();
  /** When each person's signal first turned unusual in its current run. */
  private unusualSince = new Map<string, number>();
  private store: Store;
  private people: string[];
  private offsetMinutes: number;
  /** Each person's rows in memory, once read; only when the store says what it writes. */
  private kept = new Map<string, PersonRows>();
  private follows: boolean;

  constructor(store: Store, people: string[], offsetMinutes = -new Date().getTimezoneOffset()) {
    this.store = store;
    this.people = people;
    this.offsetMinutes = offsetMinutes;
    this.follows = typeof store.onWritten === 'function';
    if (this.follows) store.onWritten((rows) => { for (const r of rows) if (r.person) this.kept.get(r.person)?.add(r); });
  }

  /** The rows a refresh reads: from memory once the person's rows are kept, else from the database. */
  private rowsOf(person: string, now: number): Row[] {
    const from = now - BASELINE_MS;
    if (!this.follows) return this.store.rows({ person, from, to: now, limit: BASELINE_LIMIT });
    let kept = this.kept.get(person);
    // A clock that went back may need rows already dropped: read the database for that one.
    if (kept && now < kept.trimmedTo) return this.store.rows({ person, from, to: now, limit: BASELINE_LIMIT });
    if (!kept) {
      kept = new PersonRows(this.store.rows({ person, from, to: Number.MAX_SAFE_INTEGER, limit: BASELINE_LIMIT + SLACK }));
      this.kept.set(person, kept);
    }
    kept.trim(now);
    return kept.window(from, now, BASELINE_LIMIT);
  }

  /**
   * Everyone's summary, each recomputed about once a minute. A call refreshes
   * at most one person whose summary is due (the one waiting longest), so the
   * work is spread over the watcher's ticks instead of landing in one; a
   * person never computed yet is computed at once.
   */
  all(now: number): PersonSummary[] {
    const due = this.people.filter((p) => {
      const at = this.computedAt.get(p);
      return at === undefined || now - at >= REFRESH_MS || now < at;
    });
    const missing = due.filter((p) => !this.summaries.has(p));
    const oldest = due.filter((p) => this.summaries.has(p)).sort((a, b) => this.computedAt.get(a)! - this.computedAt.get(b)!)[0];
    for (const person of missing.length ? missing : oldest ? [oldest] : []) this.refresh(person, now);
    return this.people.map((p) => this.summaries.get(p)!);
  }

  /** One person's summary, from the store, now. */
  refresh(person: string, now: number): PersonSummary {
    const rows = this.rowsOf(person, now);
    const summary = summaryOf(rows, person, now, { stateOf: stateWithSleep(this.offsetMinutes) });
    this.summaries.set(person, summary);
    this.computedAt.set(person, now);

    const seen = new Set<string>();
    for (const s of summary.signals) {
      if (s.status !== 'judged' || !s.unusual) continue;
      const key = `${person}|${s.signal}|${s.direction}`;
      seen.add(key);
      if (!this.unusualSince.has(key)) this.unusualSince.set(key, now);
    }
    for (const key of [...this.unusualSince.keys()]) if (key.startsWith(`${person}|`) && !seen.has(key)) this.unusualSince.delete(key);
    return summary;
  }

  /** One person's summary as last computed, or null before the first. No work. */
  cached(person: string): PersonSummary | null {
    return this.summaries.get(person) ?? null;
  }

  /** Readings that have been unusual for at least 20 minutes. */
  sustained(now: number): Unusual[] {
    const out: Unusual[] = [];
    for (const summary of this.all(now)) {
      for (const s of summary.signals) {
        if (s.status !== 'judged' || !s.unusual) continue;
        const since = this.unusualSince.get(`${summary.person}|${s.signal}|${s.direction}`);
        if (since === undefined || now - since < SUSTAIN_MS) continue;
        // The label is the weakest kind the baseline was built from.
        const kind = RANK.find((k) => (s.kinds[k] ?? 0) > 0) ?? 'simulated';
        out.push({ person: summary.person, signal: s.signal, direction: s.direction, z: s.z, kind });
      }
    }
    return out;
  }
}
