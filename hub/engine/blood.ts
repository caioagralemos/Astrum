// Blood test results typed in from the station's analyser (i-STAT), and the
// medical lead's table of what each result is compared with (her blood.json).
//
// Every range and flag level here is hers. This file never adds one: where she
// has not set a number yet, a result is "no range set yet" and is never flagged.
// Pure functions, no I/O.

import type { Row } from './types.ts';

export interface BloodSource {
  name: string;
  url: string;
  quote: string;
  is_nasa: boolean;
}

/** One entry of her export, exactly as she writes it. */
export interface BloodEntry {
  /** Lowercase English, e.g. "glucose" or "ionized-calcium". The timeline signal is bloodSignal(id). */
  id: string;
  name: { en: string; pt: string };
  /** The one unit results are stored in, e.g. "mg/dL". */
  unit: string;
  reference_range: { low: number | null; high: number | null; condition: string };
  flag_below: number | null;
  flag_above: number | null;
  urgent_below: number | null;
  urgent_above: number | null;
  what_it_means: { en: string; pt: string };
  spaceflight_note: string;
  sources: BloodSource[];
  status: string;
  notes: string;
}

export interface BloodExport {
  entries: BloodEntry[];
  /** Plain-language problems found in her file, for her to fix. */
  problems: string[];
}

export type Judgement = 'no-range' | 'in-range' | 'below' | 'above' | 'urgent-below' | 'urgent-above';

/**
 * Where a blood result sits on the timeline: "blood." and the id, with each
 * hyphen written as "_", because a timeline signal allows only lowercase
 * letters, digits, "_" and "." (timeline.ts rowProblem) and her card signs
 * name blood signals the same way ("blood.ionized_calcium" in her cases).
 * "ionized-calcium" is stored as "blood.ionized_calcium".
 */
export function bloodSignal(id: string): string {
  return `blood.${id.replace(/-/g, '_')}`;
}

/** The entry a blood row belongs to, by its signal, or null. Two ids that differ only by "-" and "_" are refused at parse time, so this is one entry. */
export function entryOfSignal<E extends { id: string }>(signal: string, entries: E[]): E | null {
  return entries.find((e) => bloodSignal(e.id) === signal) ?? null;
}

/** Lowercase letters and digits, words joined by "_" or "-", as her card ids are. */
const ID = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
const ID_MAX = 48;
const LEVELS = ['flag_below', 'flag_above', 'urgent_below', 'urgent_above'] as const;

/**
 * Reads her blood.json. Never throws: whatever is wrong comes back as a
 * problem. An entry without a usable id or unit is left out. An entry whose
 * numbers contradict each other is kept, but with every range and level
 * emptied, so nothing is flagged on numbers she would not have meant.
 */
export function parseBloodExport(json: unknown): BloodExport {
  const entries: BloodEntry[] = [];
  const problems: string[] = [];
  if (json == null || json === '') return { entries, problems };
  if (!Array.isArray(json)) return { entries, problems: ['The file must be a list of entries, [ ... ].'] };

  const seen = new Set<string>();
  json.forEach((raw, i) => {
    const where = `Entry ${i + 1}`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      problems.push(`${where} is not an entry { ... }; left out.`);
      return;
    }
    const r = raw as Record<string, unknown>;
    const id = r.id;
    if (typeof id !== 'string' || id.length > ID_MAX || !ID.test(id)) {
      problems.push(`${where}: the id must be lowercase letters and digits, words joined by _ or - (like "sodium" or "ionized-calcium"); left out.`);
      return;
    }
    const name = `"${id}"`;
    if (seen.has(bloodSignal(id))) {
      problems.push(`${name} appears more than once; only the first is used.`);
      return;
    }
    seen.add(bloodSignal(id));
    const unit = typeof r.unit === 'string' ? r.unit.trim() : '';
    if (!unit || unit.length > 16) {
      problems.push(`${name} has no unit (or one longer than 16 characters); left out, because a result cannot be stored without its unit.`);
      return;
    }

    const num = (value: unknown, field: string): number | null => {
      if (value == null) return null;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      problems.push(`${name}: ${field} must be a number or null; treated as not set.`);
      return null;
    };
    const range = (typeof r.reference_range === 'object' && r.reference_range !== null ? r.reference_range : {}) as Record<string, unknown>;
    const entry: BloodEntry = {
      id,
      name: pair(r.name, id),
      unit,
      reference_range: {
        low: num(range.low, 'reference_range.low'),
        high: num(range.high, 'reference_range.high'),
        condition: text(range.condition),
      },
      flag_below: num(r.flag_below, 'flag_below'),
      flag_above: num(r.flag_above, 'flag_above'),
      urgent_below: num(r.urgent_below, 'urgent_below'),
      urgent_above: num(r.urgent_above, 'urgent_above'),
      what_it_means: pair(r.what_it_means, ''),
      spaceflight_note: text(r.spaceflight_note),
      sources: Array.isArray(r.sources) ? r.sources.filter((s) => typeof s === 'object' && s !== null).map((s) => {
        const o = s as Record<string, unknown>;
        return { name: text(o.name), url: text(o.url), quote: text(o.quote), is_nasa: o.is_nasa === true };
      }) : [],
      status: text(r.status) || 'draft',
      notes: text(r.notes),
    };
    if (typeof r.name !== 'object' || r.name === null) problems.push(`${name} has no name { en, pt }; its id is shown instead.`);

    const clash = contradiction(entry);
    if (clash) {
      problems.push(`${name}: ${clash}. Its ranges are ignored until this is fixed, so its results show as "no range set yet".`);
      entry.reference_range = { ...entry.reference_range, low: null, high: null };
      for (const level of LEVELS) entry[level] = null;
    }
    entries.push(entry);
  });
  return { entries, problems };
}

/** The first way an entry's numbers contradict each other, or null. */
function contradiction(e: BloodEntry): string | null {
  const { low, high } = e.reference_range;
  if (low != null && high != null && low > high) return `reference_range.low (${low}) is above reference_range.high (${high})`;
  if (e.flag_below != null && e.flag_above != null && e.flag_below > e.flag_above) return `flag_below (${e.flag_below}) is above flag_above (${e.flag_above})`;
  if (e.urgent_below != null && e.urgent_above != null && e.urgent_below > e.urgent_above) return `urgent_below (${e.urgent_below}) is above urgent_above (${e.urgent_above})`;
  const lower = e.flag_below ?? low;
  const upper = e.flag_above ?? high;
  if (e.urgent_below != null && lower != null && e.urgent_below > lower) return `urgent_below (${e.urgent_below}) is inside the flag range (lower limit ${lower})`;
  if (e.urgent_above != null && upper != null && e.urgent_above < upper) return `urgent_above (${e.urgent_above}) is inside the flag range (upper limit ${upper})`;
  return null;
}

/**
 * Compares one result with her numbers only. Urgent levels come first. Each
 * side uses her flag level, or her reference range where the flag level is not
 * set. A value equal to a flag or range limit counts as inside it, and so does
 * one equal to urgent_below. A value equal to urgent_above is urgent: her own
 * words for that field are "or more" (glucose 250, potassium 6.0, ionized
 * calcium 1.60, pH 7.60); only hematocrit's says "above 60", and the stricter
 * reading is kept for it too (listed as a question for her). With neither side
 * set the answer is "no-range".
 */
export function judge(entry: BloodEntry, value: number): Judgement {
  if (!Number.isFinite(value)) return 'no-range';
  if (entry.urgent_below != null && value < entry.urgent_below) return 'urgent-below';
  if (entry.urgent_above != null && value >= entry.urgent_above) return 'urgent-above';
  const lower = entry.flag_below ?? entry.reference_range.low;
  const upper = entry.flag_above ?? entry.reference_range.high;
  if (lower == null && upper == null) return 'no-range';
  if (lower != null && value < lower) return 'below';
  if (upper != null && value > upper) return 'above';
  return 'in-range';
}

/** One typed result: which entry, the number, and the unit it was typed in if the person said. */
export interface TypedResult {
  entry: BloodEntry;
  value: number;
  unit?: string;
}

export interface Refused {
  id: string;
  reason: string;
}

/**
 * Turns typed results into timeline rows for one person. Each row carries the
 * unit of her entry. A result typed in any other unit is refused, never
 * converted here; the caller may convert first on purpose (see glucose below).
 */
export function toRows(person: string, values: TypedResult[], t: number, source: string): { rows: Row[]; refused: Refused[] } {
  const rows: Row[] = [];
  const refused: Refused[] = [];
  for (const { entry, value, unit } of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      refused.push({ id: entry.id, reason: 'the result must be a number' });
    } else if (unit != null && unit.trim() !== entry.unit) {
      refused.push({ id: entry.id, reason: `typed in ${unit.trim()}, but ${entry.id} is recorded in ${entry.unit}` });
    } else {
      rows.push({ t, signal: bloodSignal(entry.id), value, text: null, unit: entry.unit, kind: 'measured', source, person });
    }
  }
  return { rows, refused };
}

/**
 * Glucose only: mg/dL per mmol/L (molar mass of glucose, 180.16 g/mol, over
 * 10). Nothing calls this by itself; the screen offers it when someone typed
 * glucose in the other unit, and says it converted.
 */
export const GLUCOSE_MGDL_PER_MMOLL = 18.016;

export function glucoseMgdlToMmoll(mgdl: number): number {
  return mgdl / GLUCOSE_MGDL_PER_MMOLL;
}

export function glucoseMmollToMgdl(mmoll: number): number {
  return mmoll * GLUCOSE_MGDL_PER_MMOLL;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function pair(value: unknown, fallback: string): { en: string; pt: string } {
  const o = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return { en: text(o.en) || fallback, pt: text(o.pt) || text(o.en) || fallback };
}
