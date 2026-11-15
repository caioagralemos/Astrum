// Each crewmate's radiation dose, worked out from where they were. Pure functions.
//
// Nobody wears a dosimeter here and the chip has no radiation sensor: a dose
// is always the radiation rate of the room a person was in, added up over the
// time they spent there (their stays). So it is never `measured`: at best it is
// `estimated` (from a real monitor's rate), and it is `replayed` or `simulated`
// as soon as any rate or stay behind it is.
//
// Rules kept here:
// - A rate holds until the next reading, for at most 10 minutes (HOLD_MS, as
//   in exposure.ts). Time with no stay on record, or no rate for the room, is
//   unknown time and is reported as such: it is never filled with a guess.
// - Units are never mixed. Absorbed dose (Gy) and dose equivalent (Sv) are
//   added up apart, each in the dose unit of its source ("uGy" from "uGy/day").
//   Only SI prefixes and time units are converted; no quality factor is
//   assumed, so absorbed dose is never turned into Sv.
// - NASA's limit (V1 4030, quoted below as NASA publishes it) is in mSv. Only
//   a dose made wholly of dose equivalent is compared with it; otherwise the
//   result says why not (`comparable: false`).

import type { Kind, Row, Stay } from './types.ts';
import { KIND_RANK } from './types.ts';
import { HOLD_MS } from './exposure.ts';

/** The timeline signal a radiation rate arrives on (core/standin.ts, a crew-added monitor). */
export const DOSE_SIGNAL = 'radiation';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** A projection rests on at least this much covered time; with less there is no projection. */
export const MIN_PROJECTION_BASIS_MS = HOUR;

/**
 * NASA's career limit, as written in NASA-STD-3001 Volume 1, section 4.8.2
 * (NASA's page "4.0 Human Performance", read 14 November 2026). The repo's
 * model prompt (engine/prompt.ts) quotes an earlier wording of the same
 * requirement with the same number.
 */
export const CAREER_LIMIT = {
  id: 'V1 4030',
  value: 600,
  unit: 'mSv',
  scope: 'career',
  quote: '[V1 4030] An individual crewmember’s total career effective radiation dose due to spaceflight radiation exposure shall be less than 600 mSv. This limit is universal for all ages and sexes.',
  source: 'NASA-STD-3001 Volume 1, 4.8.2 Career Space Permissible Exposure Limit for Spaceflight Radiation',
  url: 'https://www.nasa.gov/reference/4-0-human-performance/',
} as const;

export type Quantity = 'absorbed' | 'equivalent';

const PREFIX: Record<string, number> = { '': 1, m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9 };
const PER: Record<string, number> = { s: 1000, min: 60_000, h: HOUR, hr: HOUR, d: DAY, day: DAY };

/** A dose-rate unit read apart: "uGy/day" is absorbed dose, in uGy, 1e-6 Gy per day. Null for anything else. */
export function rateUnit(unit: string): { quantity: Quantity; dose: string; toBase: number; perMs: number } | null {
  const m = /^(n|u|µ|m|)(Gy|Sv)\/(s|min|h|hr|d|day)$/.exec(unit.trim());
  if (!m) return null;
  return { quantity: m[2] === 'Gy' ? 'absorbed' : 'equivalent', dose: `${m[1] === 'µ' ? 'u' : m[1]}${m[2]}`, toBase: PREFIX[m[1]], perMs: PER[m[3]] };
}

/** One rate holding in one room, from one source, over [from, until). */
export interface RateSpan {
  room: string;
  source: string;
  kind: Kind;
  unit: string;
  value: number;
  from: number;
  until: number;
}

/** The stretch one rate row stands for: until the next row of its series, at most HOLD_MS. */
export function heldSpan(row: Row, nextT = Infinity): RateSpan {
  return { room: row.room!, source: row.source, kind: row.kind, unit: row.unit, value: row.value!, from: row.t, until: Math.min(nextT, row.t + HOLD_MS) };
}

/** Adds a span to a series' list (in time order), joining it to the last one when they meet with the same value and kind. */
export function pushSpan(list: RateSpan[], span: RateSpan): void {
  const last = list[list.length - 1];
  if (last && last.until === span.from && last.value === span.value && last.kind === span.kind) last.until = span.until;
  else list.push(span);
}

/** True for a room's own radiation rate row (not a body reading, not empty). */
export function isRateRow(row: Row): boolean {
  return row.signal === DOSE_SIGNAL && !!row.room && !row.person && row.value !== null;
}

/** The series a rate row belongs to: one source, one room, one unit. */
export function seriesOf(row: Pick<Row, 'room' | 'source' | 'unit'>): string {
  return `${row.room}|${row.source}|${row.unit}`;
}

/** Every room's rate rows turned into held spans, per series, in time order. */
export function rateSpans(rows: Row[]): RateSpan[] {
  const bySeries = new Map<string, Row[]>();
  for (const row of rows) {
    if (!isRateRow(row)) continue;
    const key = seriesOf(row);
    (bySeries.get(key) ?? bySeries.set(key, []).get(key)!).push(row);
  }
  const out: RateSpan[] = [];
  for (const list of bySeries.values()) {
    list.sort((a, b) => a.t - b.t);
    const spans: RateSpan[] = [];
    for (let i = 0; i < list.length; i++) {
      if (i + 1 < list.length && list[i + 1].t === list[i].t) continue;
      pushSpan(spans, heldSpan(list[i], list[i + 1]?.t));
    }
    out.push(...spans);
  }
  return out;
}

/** One quantity's dose for one person, in the dose unit of its source. */
export interface DoseAmount {
  quantity: Quantity;
  /** "uGy", "mSv"...: the dose part of the rate unit that covered most of the mission. */
  unit: string;
  /** Over the last 24 hours (or since the mission start, if that is later). */
  today: number;
  /** Since the mission start. */
  mission: number;
  /**
   * The mission dose plus the rest of the planned mission at `ratePerDay`.
   * Null with no planned end, or with less than MIN_PROJECTION_BASIS_MS of covered time.
   * Past unknown time stays unknown: it is not projected over.
   */
  projected: number | null;
  /** The mission's average rate over the time it covered, in `unit` per day. */
  ratePerDay: number;
  /** Milliseconds of the mission this quantity's rates covered: what the average rests on. */
  coveredMs: number;
}

/** How much of a window is known. coveredMs + unplacedMs + noRateMs = the window's length. */
export interface DoseCoverage {
  from: number;
  to: number;
  coveredMs: number;
  /** No stay on record for this person. */
  unplacedMs: number;
  /** In a room with no usable rate (none, or in a unit that is not a dose rate). */
  noRateMs: number;
}

/** Why a dose is not compared with NASA's limit. */
export type DoseReason = 'absorbed' | 'mixed';

export interface PersonDose {
  person: string;
  now: number;
  missionStart: number;
  plannedEnd: number | null;
  /** Never measured: the dose is worked out from room rates and stays. */
  kind: 'estimated' | 'replayed' | 'simulated';
  /** Usually one; two when some rooms gave absorbed dose and others dose equivalent, kept apart. */
  amounts: DoseAmount[];
  today: DoseCoverage;
  mission: DoseCoverage;
  /** True only when the whole dose is dose equivalent, which can stand beside NASA's limit in mSv. */
  comparable: boolean;
  reason: DoseReason | null;
  /** NASA's career limit, present only when comparable. It counts a whole career; this is one mission. */
  limit: typeof CAREER_LIMIT | null;
  /** The mission and projected dose as a share of the limit (0.1 is a tenth), when comparable. */
  ofLimit: { mission: number; projected: number | null } | null;
  /** Time per room and source over the mission, for "where it came from". */
  rooms: { room: string; source: string; kind: Kind; unit: string; ms: number }[];
}

export interface DoseInput {
  now: number;
  missionStart: number;
  /** Planned end of the mission, or null if unknown. */
  plannedEnd: number | null;
  stays: Stay[];
  spans: RateSpan[];
}

interface Tally {
  covered: number;
  placed: number;
  /** By quantity: dose in base units (Gy or Sv), covered ms, and covered ms per dose unit. */
  byQuantity: Map<Quantity, { base: number; ms: number; units: Map<string, number> }>;
  kinds: Set<Kind>;
  rooms: Map<string, { room: string; source: string; kind: Kind; unit: string; ms: number }>;
}

/** Spans by room, in time order, worked out once per list. */
const indexed = new WeakMap<RateSpan[], Map<string, Map<string, RateSpan[]>>>();

function byRoom(spans: RateSpan[]): Map<string, Map<string, RateSpan[]>> {
  let index = indexed.get(spans);
  if (index) return index;
  index = new Map();
  for (const s of spans) {
    if (!rateUnit(s.unit)) continue;
    const rooms = index.get(s.room) ?? index.set(s.room, new Map()).get(s.room)!;
    const key = `${s.source}|${s.unit}`;
    (rooms.get(key) ?? rooms.set(key, []).get(key)!).push(s);
  }
  for (const rooms of index.values()) for (const list of rooms.values()) list.sort((a, b) => a.from - b.from);
  indexed.set(spans, index);
  return index;
}

/** The parts of a series inside [from, to). `list` is in time order and its spans do not overlap. */
function inside(list: RateSpan[], from: number, to: number): { span: RateSpan; ms: number }[] {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].until <= from) lo = mid + 1; else hi = mid;
  }
  const out: { span: RateSpan; ms: number }[] = [];
  for (let i = lo; i < list.length && list[i].from < to; i++) {
    const ms = Math.min(list[i].until, to) - Math.max(list[i].from, from);
    if (ms > 0) out.push({ span: list[i], ms });
  }
  return out;
}

/** One person's dose over [from, to). For each stay one series is used, as in exposure.ts: the best kind, then the one covering more. */
function tally(person: string, input: DoseInput, from: number, to: number): Tally {
  const out: Tally = { covered: 0, placed: 0, byQuantity: new Map(), kinds: new Set(), rooms: new Map() };
  if (to <= from) return out;
  const index = byRoom(input.spans);
  const stays = input.stays
    .filter((s) => s.person === person)
    .map((s) => ({ room: s.room, kind: s.kind, from: Math.max(s.from, from), until: Math.min(s.until ?? to, to) }))
    .filter((s) => s.until > s.from)
    .sort((a, b) => a.from - b.from);
  for (const stay of stays) {
    out.placed += stay.until - stay.from;
    let best: { parts: { span: RateSpan; ms: number }[]; kind: Kind; ms: number } | null = null;
    for (const list of index.get(stay.room)?.values() ?? []) {
      const parts = inside(list, stay.from, stay.until);
      if (!parts.length) continue;
      const ms = parts.reduce((a, p) => a + p.ms, 0);
      const kind = parts.reduce<Kind>((k, p) => (KIND_RANK[p.span.kind] > KIND_RANK[k] ? p.span.kind : k), 'measured');
      if (!best || KIND_RANK[kind] < KIND_RANK[best.kind] || (KIND_RANK[kind] === KIND_RANK[best.kind] && ms > best.ms)) best = { parts, kind, ms };
    }
    if (!best) continue;
    out.kinds.add(stay.kind);
    for (const { span, ms } of best.parts) {
      const u = rateUnit(span.unit)!;
      const q = out.byQuantity.get(u.quantity) ?? out.byQuantity.set(u.quantity, { base: 0, ms: 0, units: new Map() }).get(u.quantity)!;
      q.base += span.value * u.toBase * (ms / u.perMs);
      q.ms += ms;
      q.units.set(u.dose, (q.units.get(u.dose) ?? 0) + ms);
      out.covered += ms;
      out.kinds.add(span.kind);
      const key = `${stay.room}|${span.source}|${span.unit}`;
      const room = out.rooms.get(key) ?? out.rooms.set(key, { room: stay.room, source: span.source, kind: span.kind, unit: span.unit, ms: 0 }).get(key)!;
      room.ms += ms;
      if (KIND_RANK[span.kind] > KIND_RANK[room.kind]) room.kind = span.kind;
    }
  }
  return out;
}

function coverage(t: Tally, from: number, to: number): DoseCoverage {
  const length = Math.max(0, to - from);
  return { from, to, coveredMs: t.covered, unplacedMs: length - t.placed, noRateMs: t.placed - t.covered };
}

/** The dose unit's factor against its base unit ("mSv" is 1e-3 Sv). */
function factorOf(dose: string): number {
  return rateUnit(`${dose}/h`)!.toBase;
}

/**
 * One crewmate's radiation dose: today, this mission so far, and projected at
 * the planned end at this mission's average rate. Null when no rate covered
 * any of their mission time (in production with no real radiation source,
 * there is no dose at all).
 */
export function doseFor(person: string, input: DoseInput): PersonDose | null {
  const { now, missionStart, plannedEnd } = input;
  const start = Math.min(missionStart, now);
  const dayFrom = Math.max(now - DAY, start);
  const mission = tally(person, input, start, now);
  if (mission.covered <= 0) return null;
  const today = tally(person, input, dayFrom, now);

  const amounts: DoseAmount[] = [];
  for (const quantity of ['equivalent', 'absorbed'] as const) {
    const q = mission.byQuantity.get(quantity);
    if (!q || q.ms <= 0) continue;
    const unit = [...q.units.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const factor = factorOf(unit);
    const value = q.base / factor;
    const ratePerMs = value / q.ms;
    const left = plannedEnd === null ? null : Math.max(0, plannedEnd - now);
    amounts.push({
      quantity,
      unit,
      today: (today.byQuantity.get(quantity)?.base ?? 0) / factor,
      mission: value,
      projected: left === null || q.ms < MIN_PROJECTION_BASIS_MS ? null : value + ratePerMs * left,
      ratePerDay: ratePerMs * DAY,
      coveredMs: q.ms,
    });
  }

  const quantities = amounts.map((a) => a.quantity);
  const comparable = quantities.length === 1 && quantities[0] === 'equivalent';
  const reason: DoseReason | null = comparable ? null : quantities.length > 1 ? 'mixed' : 'absorbed';
  let ofLimit: PersonDose['ofLimit'] = null;
  if (comparable) {
    const a = amounts[0];
    const toMsv = factorOf(a.unit) / factorOf(CAREER_LIMIT.unit);
    ofLimit = { mission: (a.mission * toMsv) / CAREER_LIMIT.value, projected: a.projected === null ? null : (a.projected * toMsv) / CAREER_LIMIT.value };
  }

  const kinds = mission.kinds;
  const kind: PersonDose['kind'] = kinds.has('simulated') ? 'simulated' : kinds.has('replayed') ? 'replayed' : 'estimated';
  return {
    person, now, missionStart: start, plannedEnd,
    kind,
    amounts,
    today: coverage(today, dayFrom, now),
    mission: coverage(mission, start, now),
    comparable, reason,
    limit: comparable ? CAREER_LIMIT : null,
    ofLimit,
    rooms: [...mission.rooms.values()].sort((a, b) => b.ms - a.ms),
  };
}

/** Every crewmate's dose, by crew id. People with no dose at all are left out. */
export function doseOfCrew(crew: string[], input: DoseInput): Record<string, PersonDose> {
  const out: Record<string, PersonDose> = {};
  for (const person of crew) {
    const dose = doseFor(person, input);
    if (dose) out[person] = dose;
  }
  return out;
}

/** The planned end of a mission: its start plus its planned days, or null if either is missing. */
export function plannedEndOf(missionStart: number, plannedDays: number | undefined): number | null {
  return plannedDays && Number.isFinite(missionStart) ? missionStart + plannedDays * DAY : null;
}
