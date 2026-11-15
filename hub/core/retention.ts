// Tiered retention: the hub keeps raw readings while anything reads them raw,
// then summaries, by itself, a small slice at a time.
//
// The tiers (TIERS below, each with why):
//   raw          recent rows, untouched
//   5 minutes    one summary row per series and 5 minutes (mean, min, max, count)
//   1 hour       one per series and hour, after 14 days
// CO2 and radiation are never put in 5-minute summaries: after 2 days they are
// thinned losslessly instead (LOSSLESS): only rows that cannot change what the
// hub reads back are removed, so the dose (engine/dose.ts, from the mission
// start) and CO2 exposure (engine/exposure.ts, 72 hours), which read one row a
// minute held up to 10 minutes, come out the same. Radiation stays that way for
// the whole mission; CO2 gets hourly summaries after 14 days (nothing reads it
// that far back but charts).
//
// Never thinned: anything reported or estimated, any row with text (check-ins,
// typed answers), blood results, Earth messages, stays (a separate table, not
// touched), and every row within TIERS.holdMarginMs of an alert or room alarm
// (Store.holdRaw). A summary never mixes series: one signal, person, room,
// source, unit and kind, so a kind label is never lost or blended. A bucket
// with one row is left as it is.
//
// The baselines read each person's newest BASELINE_LIMIT rows (core/baseline.ts):
// a person's row is summarised only once it is out of that read for good.

import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { BASELINE_LIMIT } from './baseline.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const TIERS = {
  /** Raw for 2 days: the 1-hour CO2 average and its 10-minute lead (70 min), stuck sensors (30 min), the person chart (12 h), exercise minutes (26 h), the state's newest rows (24 h). */
  rawMs: 2 * DAY,
  /** The stand-in's filler (sim:hub) raw for 6 hours: nothing reads it back raw but charts. Radiation excepted (LOSSLESS). */
  standInRawMs: 6 * HOUR,
  /** A person's newest rows the baseline may read, plus slack: never summarised. */
  personKeepRows: BASELINE_LIMIT + 5_000,
  /** ...and the baseline's 14 days, plus a day. */
  personWindowMs: 15 * DAY,
  midBucketMs: 5 * MIN,
  /** Hourly after 14 days: the longest chart is 14 days. */
  coarseAfterMs: 14 * DAY,
  coarseBucketMs: HOUR,
  /** Raw rows kept from this long before an alert or alarm began to this long after it ended. */
  holdMarginMs: 2 * HOUR,
  /** One slice of rows per transaction, and how long one tick may work. */
  sliceMs: 30 * MIN,
  budgetMs: 15,
} as const;

/** Thinned losslessly, never summarised before coarseAfterMs (radiation: never). */
export const LOSSLESS = ['co2', 'radiation'];
/** A reading holds for at most this long (cabin.ts, exposure.ts, dose.ts). */
const HOLD_MS = 10 * MIN;
/** The dose and exposure read one row per source and minute (Store.sampled). */
const SAMPLE_MS = MIN;

interface R { id: number; t: number; signal: string; value: number | null; text: string | null; unit: string; kind: string; source: string; person: string | null; room: string | null; summary: string | null }
export interface Summary { n: number; min: number; max: number; ms: number }

const NEVER_SOURCES = /^(checkin:|istat:|nasa:osdr-inspiration4)/;
const NEVER_SIGNALS = /^(checkin\.|blood\.|earth\.)/;
function never(r: R): boolean {
  return r.kind === 'reported' || r.kind === 'estimated' || r.text !== null || r.value === null || NEVER_SIGNALS.test(r.signal) || NEVER_SOURCES.test(r.source);
}

/**
 * Removes the rows of one series (one signal, room and source, oldest first) that cannot change what the
 * dose and exposure read: rows that are not the first of their minute (Store.sampled never returns them),
 * and a first-of-minute row whose value the kept row before it already holds over the same time.
 * The first and last row of the slice are kept, so slices never need each other.
 */
export function losslessDrops(rows: R[]): number[] {
  const drop: number[] = [];
  const sampled: R[] = [];
  let bucket = -Infinity;
  for (const r of rows) {
    const b = Math.floor(r.t / SAMPLE_MS);
    if (b === bucket) drop.push(r.id); else { sampled.push(r); bucket = b; }
  }
  let kept: R | null = null;
  for (let i = 0; i < sampled.length; i++) {
    const r = sampled[i];
    const next = sampled[i + 1];
    if (kept && next && r.value === kept.value && kept.t + HOLD_MS >= Math.min(next.t, r.t + HOLD_MS)) { drop.push(r.id); continue; }
    kept = r;
  }
  return drop;
}

/** Summary rows for one slice: one per series and bucket with two or more rows. */
function summarise(rows: R[], bucketMs: number): { insert: Omit<R, 'id'>[]; drop: number[] } {
  const groups = new Map<string, R[]>();
  for (const r of rows) {
    const key = `${r.signal}|${r.person ?? ''}|${r.room ?? ''}|${r.source}|${r.unit}|${r.kind}|${Math.floor(r.t / bucketMs)}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  const insert: Omit<R, 'id'>[] = [];
  const drop: number[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    let n = 0, sum = 0, min = Infinity, max = -Infinity, t = Infinity;
    for (const r of g) {
      const s = r.summary ? (JSON.parse(r.summary) as Summary) : { n: 1, min: r.value!, max: r.value!, ms: 0 };
      n += s.n; sum += r.value! * s.n; min = Math.min(min, s.min); max = Math.max(max, s.max); t = Math.min(t, r.t);
      drop.push(r.id);
    }
    const f = g[0];
    insert.push({ t, signal: f.signal, value: sum / n, text: null, unit: f.unit, kind: f.kind, source: f.source, person: f.person, room: f.room, summary: JSON.stringify({ n, min, max, ms: bucketMs }) });
  }
  return { insert, drop };
}

type Family = { key: string; where: string; arg: string; person: string | null };

export class Retention {
  private db: DatabaseSync;
  private timer: NodeJS.Timeout | null = null;
  private stmts = new Map<string, StatementSync>();
  clock: () => number = Date.now;

  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec('CREATE TABLE IF NOT EXISTS retention_cursor (key TEXT PRIMARY KEY, t INTEGER NOT NULL)');
  }

  private q(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) this.stmts.set(sql, s = this.db.prepare(sql));
    return s;
  }

  /** Works a slice at a time every second while behind, every minute once caught up. */
  start(): void {
    this.stop();
    const loop = () => { let behind = false; try { behind = this.tick(this.clock()); } catch (err) { console.error(`retention: ${(err as Error).message}`); } this.timer = setTimeout(loop, behind ? 1000 : 60_000); };
    this.timer = setTimeout(loop, 30_000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One tick, within `budgetMs`. True while there is more to do. */
  tick(now: number, budgetMs: number = TIERS.budgetMs): boolean {
    const until = performance.now() + budgetMs;
    for (const f of this.families()) {
      for (const pass of ['mid', 'coarse'] as const) {
        const cutoff = this.cutoff(f, pass, now);
        while (this.slice(f, pass, cutoff)) {
          if (performance.now() > until) return true;
        }
      }
    }
    try { this.db.exec('PRAGMA incremental_vacuum(500)'); } catch { /* not an incremental database */ }
    return false;
  }

  /** Runs every tier to the end, for npm run compact and tests. */
  runAll(now: number): void {
    while (this.tick(now, 1000)) { /* more */ }
  }

  /** Room rows per source, and each person's rows. Found by walking the indexes. */
  private families(): Family[] {
    const out: Family[] = [];
    let s = '';
    for (;;) {
      const r = this.q('SELECT source FROM readings WHERE source > ? ORDER BY source LIMIT 1').get(s) as { source: string } | undefined;
      if (!r) break;
      s = r.source;
      out.push({ key: `room:${s}`, where: 'source = ? AND person IS NULL', arg: s, person: null });
    }
    let p = '';
    for (;;) {
      const r = this.q('SELECT person FROM readings WHERE person > ? ORDER BY person LIMIT 1').get(p) as { person: string } | undefined;
      if (!r) break;
      p = r.person;
      out.push({ key: `person:${p}`, where: 'person = ?', arg: p, person: p });
    }
    return out;
  }

  /** Rows of this family older than this are worked by the pass. */
  private cutoff(f: Family, pass: 'mid' | 'coarse', now: number): number {
    if (pass === 'coarse') return now - TIERS.coarseAfterMs;
    if (f.person) {
      const nth = this.q('SELECT t FROM readings WHERE person = ? ORDER BY t DESC LIMIT 1 OFFSET ?').get(f.person, TIERS.personKeepRows - 1) as { t: number } | undefined;
      // Out of the baseline's read for good: older than its 14 days, or behind its newest rows.
      return Math.min(now - TIERS.rawMs, Math.max(now - TIERS.personWindowMs, nth ? nth.t : -Infinity));
    }
    return now - (f.arg === 'sim:hub' ? TIERS.standInRawMs : TIERS.rawMs);
  }

  /** One slice of one family and pass, in one transaction. False when the pass has caught up to its cutoff. */
  private slice(f: Family, pass: 'mid' | 'coarse', cutoff: number): boolean {
    const key = `${pass}:${f.key}`;
    let from = (this.q('SELECT t FROM retention_cursor WHERE key = ?').get(key) as { t: number } | undefined)?.t;
    if (from === undefined) {
      const first = this.q(`SELECT MIN(t) AS t FROM readings WHERE ${f.where}`).get(f.arg) as { t: number | null };
      if (first.t === null) return false;
      from = Math.floor(first.t / HOUR) * HOUR;
    }
    const span = pass === 'mid' ? TIERS.sliceMs : 12 * HOUR;
    const to = Math.min(from + span, Math.floor(cutoff / span) * span);
    if (to <= from) return false;
    const rows = this.q(`SELECT id, t, signal, value, text, unit, kind, source, person, room, summary FROM readings WHERE ${f.where} AND t >= ? AND t < ? ORDER BY t, id`).all(f.arg, from, to) as unknown as R[];
    const holds = this.q('SELECT t_from, t_until FROM raw_holds WHERE t_from < ? AND (t_until IS NULL OR t_until >= ?)').all(to, from) as { t_from: number; t_until: number | null }[];
    const held = (t: number) => holds.some((h) => t >= h.t_from && (h.t_until === null || t <= h.t_until));
    const lossless = new Map<string, R[]>();
    const plain: R[] = [];
    for (const r of rows) {
      if (never(r) || held(r.t)) continue;
      const exact = LOSSLESS.includes(r.signal) && !r.person;
      if (exact && (pass === 'mid' || r.signal === 'radiation')) {
        const k = `${r.signal}|${r.room}|${r.source}`;
        (lossless.get(k) ?? lossless.set(k, []).get(k)!).push(r);
      } else plain.push(r);
    }
    const drops: number[] = [];
    for (const list of lossless.values()) drops.push(...losslessDrops(list));
    const { insert, drop } = summarise(plain, pass === 'mid' ? TIERS.midBucketMs : TIERS.coarseBucketMs);
    drops.push(...drop);
    this.db.exec('BEGIN');
    try {
      const del = this.q('DELETE FROM readings WHERE id = ?');
      for (const id of drops) del.run(id);
      const ins = this.q('INSERT INTO readings (t, signal, value, text, unit, kind, source, person, room, received, summary) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const r of insert) ins.run(r.t, r.signal, r.value, null, r.unit, r.kind, r.source, r.person, r.room, r.t, r.summary);
      this.q('INSERT INTO retention_cursor (key, t) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET t = excluded.t').run(key, to);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return true;
  }
}
