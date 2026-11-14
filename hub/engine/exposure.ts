// What one person was exposed to: where they were, what the air in those rooms
// held while they were there, and how long they spent alone. Pure functions.
//
// Exposure belongs to a person, not a room: each stay is matched with that
// room's readings for the same stretch of time. A reading holds until the next
// one, for at most 10 minutes (the convention of windowAverage in cabin.ts).
// Time with no reading is reported as a gap. A gap is never counted as safe
// and never counted as above a level.

import type { Kind, Row, Stay } from './types.ts';
import { KIND_RANK } from './types.ts';

/** A reading stands for at most this long; longer than that is a gap. */
export const HOLD_MS = 600_000;

const DAY = 24 * 3600_000;

/** NASA's CO2 levels, for the `levels` argument of `exposure`. */
export const CO2_LEVELS = [
  { level: 2.8, unit: 'mmHg', source: 'NASA OCHMO-TB-004: "Headaches at levels between 2.8-4.5 mmHg".' },
  { level: 3, unit: 'mmHg', source: 'NASA OCHMO-TB-004: the 1-hour average CO2 is to be "no more than 3 mmHg".' },
];

export interface Exposure {
  person: string;
  signal: string;
  from: number;
  to: number;
  /** Milliseconds in each room. */
  rooms: Record<string, number>;
  /** Milliseconds with no stay on record for this person. */
  unplaced: number;
  /** Milliseconds covered by a reading of the room they were in. */
  covered: number;
  /** Milliseconds without one (including unplaced time). covered + gap = to - from. */
  gap: number;
  /** Time-weighted average over the covered time, or null when nothing was covered. */
  average: number | null;
  /** Milliseconds strictly above each level, counted only over covered time. */
  above: { level: number; ms: number }[];
  /** Which source was used for each stay, and how much of the stay it covered. */
  sources: { room: string; from: number; until: number; source: string | null; kind: Kind | null; covered: number }[];
}

interface Piece { from: number; until: number; value: number }

/** The stretches one source covers inside [from, to), each reading held until the next, capped at HOLD_MS. */
function pieces(list: Row[], from: number, to: number): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < list.length; i++) {
    const start = list[i].t;
    const next = i + 1 < list.length ? list[i + 1].t : Infinity;
    const end = Math.min(next, start + HOLD_MS);
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    if (b > a) out.push({ from: a, until: b, value: list[i].value! });
  }
  return out;
}

/** One room's readings of one signal, grouped by source and sorted by time. */
function bySource(rows: Row[], room: string, signal: string): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const row of rows) {
    if (row.room !== room || row.person || row.signal !== signal || row.value === null) continue;
    const list = out.get(row.source) ?? [];
    list.push(row);
    out.set(row.source, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.t - b.t);
  return out;
}

/** The stays of one person clipped to [from, to), in time order. */
function clippedStays(stays: Stay[], person: string, from: number, to: number): { room: string; from: number; until: number }[] {
  return clip(stays.filter((s) => s.person === person), from, to);
}

function clip(stays: Stay[], from: number, to: number): { room: string; from: number; until: number }[] {
  return stays
    .map((s) => ({ room: s.room, from: Math.max(s.from, from), until: Math.min(s.until ?? to, to) }))
    .filter((s) => s.until > s.from)
    .sort((a, b) => a.from - b.from);
}

/**
 * What one person breathed or heard of one signal between `from` and `to`.
 * For each stay one source is used: the best kind (measured, estimated,
 * reported, replayed, simulated), and among equals the one covering more of the stay.
 */
export function exposure(stays: Stay[], cabinRows: Row[], person: string, signal: string, from: number, to: number, levels: number[] = []): Exposure {
  const rooms: Record<string, number> = {};
  const above = levels.map((level) => ({ level, ms: 0 }));
  const sources: Exposure['sources'] = [];
  const cache = new Map<string, Map<string, Row[]>>();
  let placed = 0;
  let covered = 0;
  let weighted = 0;

  for (const stay of clippedStays(stays, person, from, to)) {
    const length = stay.until - stay.from;
    rooms[stay.room] = (rooms[stay.room] ?? 0) + length;
    placed += length;

    if (!cache.has(stay.room)) cache.set(stay.room, bySource(cabinRows, stay.room, signal));
    let best: { source: string; kind: Kind; parts: Piece[]; covered: number } | null = null;
    for (const [source, list] of cache.get(stay.room)!) {
      const parts = pieces(list, stay.from, stay.until);
      if (!parts.length) continue;
      const kind = list[list.length - 1].kind;
      const total = parts.reduce((a, p) => a + p.until - p.from, 0);
      if (!best || KIND_RANK[kind] < KIND_RANK[best.kind] || (KIND_RANK[kind] === KIND_RANK[best.kind] && total > best.covered)) {
        best = { source, kind, parts, covered: total };
      }
    }

    sources.push({ room: stay.room, from: stay.from, until: stay.until, source: best?.source ?? null, kind: best?.kind ?? null, covered: best?.covered ?? 0 });
    for (const p of best?.parts ?? []) {
      const held = p.until - p.from;
      covered += held;
      weighted += p.value * held;
      for (const a of above) if (p.value > a.level) a.ms += held;
    }
  }

  return {
    person, signal, from, to, rooms,
    unplaced: to - from - placed,
    covered,
    gap: to - from - covered,
    average: covered > 0 ? weighted / covered : null,
    above,
    sources,
  };
}

export interface AloneDay {
  /** Start of the day, in milliseconds. */
  day: number;
  /** Milliseconds with nobody else in the same room. */
  alone: number;
  /** Milliseconds this person had a stay on record that day. */
  placed: number;
}

/**
 * Time alone per day: stretches where this person's room held nobody else.
 * Days start at midnight station time; `offsetMinutes` is station time minus UTC,
 * as in crew.ts. Only time with a stay on record counts.
 */
export function aloneByDay(stays: Stay[], person: string, from: number, to: number, offsetMinutes = 0): AloneDay[] {
  const offset = offsetMinutes * 60_000;
  const out: AloneDay[] = [];
  for (let day = Math.floor((from + offset) / DAY) * DAY - offset; day < to; day += DAY) {
    const a = Math.max(day, from);
    const b = Math.min(day + DAY, to);
    if (b <= a) continue;
    let alone = 0;
    let placed = 0;
    for (const mine of clippedStays(stays, person, a, b)) {
      placed += mine.until - mine.from;
      const others = clip(stays.filter((s) => s.person !== person && s.room === mine.room), mine.from, mine.until);
      alone += mine.until - mine.from - unionLength(others);
    }
    out.push({ day, alone, placed });
  }
  return out;
}

function unionLength(spans: { from: number; until: number }[]): number {
  let total = 0;
  let end = -Infinity;
  for (const s of [...spans].sort((x, y) => x.from - y.from)) {
    if (s.until <= end) continue;
    total += s.until - Math.max(s.from, end);
    end = s.until;
  }
  return total;
}
