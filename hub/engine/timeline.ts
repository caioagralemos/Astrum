// Pure functions over timeline rows. No I/O: the hub core and the web replay
// both call these with rows they already hold.

import type { Kind, Row, Stay } from './types.ts';
import { KINDS, KIND_RANK } from './types.ts';

/** A reading older than this no longer counts as the current value. */
export const FRESH_MS = 30_000;

/**
 * How far ahead of the viewer's clock a reading may be stamped and still count.
 * Screens follow the hub's clock (clockOffset below); this only covers the
 * moment between ticks.
 */
export const CLOCK_SLACK_MS = 2000;

/** A scenario is recorded at least every 30 seconds of its clock; a screen's clock never runs further ahead than that. */
export const SCENARIO_GAP_MS = 30_000;

/** How far the hub's clock is ahead of this screen's, from a "now" the hub just sent. Negative when behind. */
export function clockOffset(hubNow: number, localNow: number): number {
  return hubNow - localNow;
}

/**
 * The time a screen shows. Live: its own clock plus the offset to the hub's.
 * During a scenario: the scenario's moment last heard, run on at the
 * scenario's speed, at most SCENARIO_GAP_MS ahead of it.
 */
export function screenNow(localNow: number, offset: number, scenario?: { at: number; speed: number; heardAt: number } | null): number {
  if (scenario) return scenario.at + Math.min((localNow - scenario.heardAt) * scenario.speed, SCENARIO_GAP_MS);
  return localNow + offset;
}


/** Where a reading belongs: one person's body or one room. */
export function scopeOf(row: Pick<Row, 'person' | 'room' | 'signal'>): string {
  return `${row.person ? `p:${row.person}` : `r:${row.room ?? ''}`}|${row.signal}`;
}

/**
 * The current value of every signal in every scope.
 *
 * "Simulated until it's not": when a real sensor answers, its reading wins over
 * a simulated one for the same signal in the same place, and when it stops
 * answering the simulated one takes over again. Among fresh readings the order
 * is measured, estimated, reported, replayed, simulated; ties go to the newest. If nothing is
 * fresh, the newest reading is returned so the screen can show it as stale.
 */
export function current(rows: Row[], now: number, freshMs = FRESH_MS): Row[] {
  const best = new Map<string, Row>();
  for (const row of rows) {
    // A screen's clock ticks once a second and can run a little behind the hub's,
    // so a reading stamped a moment ahead is still current. Anything further ahead is ignored.
    if (row.t > now + CLOCK_SLACK_MS) continue;
    const key = scopeOf(row);
    const held = best.get(key);
    if (!held || better(row, held, now, freshMs)) best.set(key, row);
  }
  return [...best.values()];
}

function better(a: Row, b: Row, now: number, freshMs: number): boolean {
  const aFresh = now - a.t <= freshMs;
  const bFresh = now - b.t <= freshMs;
  if (aFresh !== bFresh) return aFresh;
  if (aFresh && KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] < KIND_RANK[b.kind];
  return a.t >= b.t;
}

export function isFresh(row: Row, now: number, freshMs = FRESH_MS): boolean {
  return now - row.t <= freshMs;
}

/** Milliseconds one person spent in each room between two moments. */
export function timeInRooms(stays: Stay[], person: string, from: number, to: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const stay of stays) {
    if (stay.person !== person) continue;
    const start = Math.max(stay.from, from);
    const end = Math.min(stay.until ?? to, to);
    if (end > start) out[stay.room] = (out[stay.room] ?? 0) + (end - start);
  }
  return out;
}

/** Who is in each room at one moment. */
export function occupants(stays: Stay[], at: number): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const stay of stays) {
    if (stay.from <= at && (stay.until === null || stay.until > at)) {
      (out[stay.room] ??= []).push(stay.person);
    }
  }
  return out;
}

/** Checks a row arriving from outside the hub. Returns the problem, or null. */
export function rowProblem(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return 'row is not an object';
  const r = row as Record<string, unknown>;
  if (typeof r.t !== 'number' || !Number.isFinite(r.t)) return 't must be a number of milliseconds';
  if (typeof r.signal !== 'string' || !/^[a-z0-9_.]{1,64}$/.test(r.signal)) return 'signal must be lowercase letters, digits, _ or .';
  if (r.value !== null && (typeof r.value !== 'number' || !Number.isFinite(r.value))) return 'value must be a number or null';
  if (typeof r.unit !== 'string' || r.unit.length > 16) return 'unit must be a short string';
  if (!KINDS.includes(r.kind as Kind)) return 'kind must be measured, estimated, reported, replayed or simulated';
  if (r.text != null && (typeof r.text !== 'string' || r.text.length > 2000)) return 'text too long';
  for (const key of ['person', 'room'] as const) {
    if (r[key] != null && (typeof r[key] !== 'string' || !/^[a-z0-9-]{1,32}$/.test(r[key] as string))) return `${key} must be a short id`;
  }
  if (r.person == null && r.room == null) return 'a row needs a person or a room';
  return null;
}
