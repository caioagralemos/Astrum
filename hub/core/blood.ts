// Blood test results on the hub: the medical lead's blood.json, the screen's
// /api/blood, and, for demo mode, real blood panels from NASA's Inspiration4
// record.
//
// The Inspiration4 values are the four private astronauts' own (subjects
// C001-C004), unchanged, taken before and after their 2021 flight, none in
// flight. See data-nasa/inspiration4/SOURCE.txt. In demo mode one subject's
// values play for one simulated crewmate, marked "replayed".

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { bloodSignal, judge, parseBloodExport, toRows } from '../engine/blood.ts';
import type { BloodEntry, BloodExport, Judgement, TypedResult } from '../engine/blood.ts';
import { rowProblem } from '../engine/timeline.ts';
import type { Row } from '../engine/types.ts';
import type { Store } from './db.ts';

export const INSPIRATION4_SOURCE = 'nasa:osdr-inspiration4';
export const TYPED_SOURCE = 'istat:typed';

/** The sampling days, in order: days before launch (L-) and after return (R+). */
export const TIMEPOINTS = ['L-92', 'L-44', 'L-3', 'R+1', 'R+45', 'R+82', 'R+194'] as const;

export const INSPIRATION4_FILES = [
  'LSDS-8_Comprehensive_Metabolic_Panel_CMP_TRANSFORMED.csv',
  'LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv',
];

/** The files' unit words, written short as the screen shows them. */
const UNITS: Record<string, string> = {
  '': '',
  gram_per_deciliter: 'g/dL',
  grams_per_deciliter: 'g/dL',
  milligram_per_deciliter: 'mg/dL',
  millimol_per_liter: 'mmol/L',
  units_per_liter: 'U/L',
  'milliliter_per_minute_per_1.73_meter_squared': 'mL/min/1.73m2',
  cells_per_microliter: 'cells/uL',
  thousand_per_microliter: '10^3/uL',
  million_per_microliter: '10^6/uL',
  percent: '%',
  picogram: 'pg',
  femtoliter: 'fL',
};

/**
 * Units the file states that do not fit its own numbers. Hemoglobin is filed
 * as "percent", but its values (11.5 to 17.0) and the lab's range (13.2-17.1
 * or 11.7-15.5) read as g/dL. Not corrected here: these analytes are left out
 * of the demo until someone checks the original lab report.
 */
export const DOUBTFUL_UNITS: Record<string, string> = {
  hemoglobin: 'filed as percent; the values read as g/dL',
};

export interface LabValue {
  value: number;
  /** Short unit, e.g. "mg/dL". */
  unit: string;
  /** The unit as the file names it, e.g. "milligram_per_deciliter". */
  fileUnit: string;
  /** The lab's own reference range, as printed in the file. */
  rangeMin: number | null;
  rangeMax: number | null;
}

/** subject → timepoint → analyte → value. */
export type Inspiration4Blood = Record<string, Record<string, Record<string, LabValue>>>;

const SAMPLE = /^(C\d{3})_[a-z-]+_([LR][+-]\d+)(?:_[a-z]+)?$/;
const COLUMN = /^(.+?)_(value|range_min|range_max|max)(?:_(.+))?$/;

/** Reads both Inspiration4 CSVs into one structure. Blank, "NA" and "N/A" cells are left out. */
export function loadInspiration4(dir: string): Inspiration4Blood {
  const out: Inspiration4Blood = {};
  for (const file of INSPIRATION4_FILES) {
    const [head, ...lines] = parseCsv(readFileSync(join(dir, file), 'utf8'));
    const columns = head.map((name) => {
      const m = COLUMN.exec(name);
      return m ? { analyte: m[1], part: m[2] === 'max' ? 'range_max' : m[2], fileUnit: m[3] ?? '' } : null;
    });
    for (const cells of lines) {
      const sample = SAMPLE.exec(cells[0] ?? '');
      if (!sample) continue;
      const [, subject, timepoint] = sample;
      const values = ((out[subject] ??= {})[timepoint] ??= {});
      const parts: Record<string, { value?: number; rangeMin?: number; rangeMax?: number; fileUnit: string }> = {};
      columns.forEach((col, i) => {
        if (!col) return;
        const n = number(cells[i]);
        const p = (parts[col.analyte] ??= { fileUnit: col.fileUnit });
        if (col.part === 'value') { p.value = n ?? undefined; p.fileUnit = col.fileUnit; }
        else if (col.part === 'range_min') p.rangeMin = n ?? undefined;
        else p.rangeMax = n ?? undefined;
      });
      for (const [analyte, p] of Object.entries(parts)) {
        if (p.value === undefined) continue;
        values[analyte] = { value: p.value, unit: UNITS[p.fileUnit] ?? p.fileUnit, fileUnit: p.fileUnit, rangeMin: p.rangeMin ?? null, rangeMax: p.rangeMax ?? null };
      }
    }
  }
  return out;
}

function number(cell: string | undefined): number | null {
  const s = (cell ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** A small CSV reader: commas, quoted cells, a leading byte-order mark, CRLF. */
function parseCsv(textIn: string): string[][] {
  const text = textIn.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

/**
 * Demo mode only: one Inspiration4 subject's real values as one simulated
 * crewmate's blood results, one batch per scheduled timepoint. Analytes with
 * a doubtful unit are left out. Each row names the subject, the timepoint and
 * the lab's own range.
 */
export function demoBloodRows(
  data: Inspiration4Blood,
  subject: string,
  person: string,
  schedule: { timepoint: string; t: number }[],
): Row[] {
  const rows: Row[] = [];
  for (const { timepoint, t } of schedule) {
    const values = data[subject]?.[timepoint];
    if (!values) continue;
    for (const [analyte, v] of Object.entries(values)) {
      if (DOUBTFUL_UNITS[analyte]) continue;
      const range = v.rangeMin != null && v.rangeMax != null ? ` Lab range ${v.rangeMin}-${v.rangeMax}.` : '';
      const row: Row = {
        t, signal: bloodSignal(analyte), value: v.value, unit: v.unit, kind: 'replayed', source: INSPIRATION4_SOURCE, person,
        text: `Inspiration4 ${subject}, ${timepoint}.${range}`,
      };
      if (rowProblem(row) === null) rows.push(row);
    }
  }
  return rows;
}

/** Reads her blood.json. A missing or empty file means no entries, which is fine. */
export function loadBloodFile(path: string): BloodExport {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return { entries: [], problems: [] }; }
  if (!text.trim()) return { entries: [], problems: [] };
  try { return parseBloodExport(JSON.parse(text)); } catch {
    return { entries: [], problems: ['blood.json is not valid JSON, so no entries are loaded.'] };
  }
}

export interface BloodContext {
  store: Store;
  /** Stores rows and tells every screen (the hub's ingest). */
  ingest: (rows: Row[]) => Row[];
  /** Where her blood.json lives. Read on every request, so a new export needs no restart. */
  bloodFile: string;
  /** Crew ids results may be typed for. */
  crew: string[];
}

export interface BloodResult {
  id: string;
  row: Row;
  /** Compared with her entry only when the row is in her entry's unit. */
  judgement: Judgement;
  unitMatches: boolean;
}

/** The newest blood result of every kind for every person, compared with her entries. */
export function latestResults(store: Store, entries: BloodEntry[]): Record<string, BloodResult[]> {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const newest = new Map<string, Row>();
  for (const row of store.recent(0)) {
    if (!row.person || !row.signal.startsWith('blood.')) continue;
    const key = `${row.person}|${row.signal}`;
    const held = newest.get(key);
    if (!held || row.t > held.t) newest.set(key, row);
  }
  const out: Record<string, BloodResult[]> = {};
  for (const row of newest.values()) {
    const id = row.signal.slice('blood.'.length);
    const entry = byId.get(id);
    const unitMatches = !!entry && entry.unit === row.unit;
    const judgement = unitMatches && row.value != null ? judge(entry!, row.value) : 'no-range';
    (out[row.person!] ??= []).push({ id, row, judgement, unitMatches });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/**
 * GET /api/blood: her entries, the problems in her file, and each person's
 * newest results.
 * POST /api/blood: { person, t?, values: { id: number }, units?: { id: unit } }.
 * All or nothing: if any value is refused, none is stored.
 * Returns false for any other path.
 */
export async function handleBlood(req: IncomingMessage, res: ServerResponse, url: URL, ctx: BloodContext): Promise<boolean> {
  if (url.pathname !== '/api/blood') return false;
  const blood = loadBloodFile(ctx.bloodFile);

  if (req.method === 'GET') {
    send(res, 200, { entries: blood.entries, problems: blood.problems, latest: latestResults(ctx.store, blood.entries) });
    return true;
  }
  if (req.method !== 'POST') {
    send(res, 405, { error: 'method not allowed' });
    return true;
  }

  const b = (await readJson(req)) as { person?: unknown; t?: unknown; values?: unknown; units?: unknown } | undefined;
  if (!b || typeof b !== 'object') return fail(res, 'body must be JSON');
  if (typeof b.person !== 'string' || !ctx.crew.includes(b.person)) return fail(res, 'needs a known person');
  const t = b.t ?? Date.now();
  if (typeof t !== 'number' || !Number.isFinite(t)) return fail(res, 't must be a number of milliseconds');
  if (typeof b.values !== 'object' || b.values === null || Array.isArray(b.values) || !Object.keys(b.values).length) {
    return fail(res, 'values must be { id: number }, with at least one result');
  }
  const units = (typeof b.units === 'object' && b.units !== null ? b.units : {}) as Record<string, unknown>;

  const byId = new Map(blood.entries.map((e) => [e.id, e]));
  const typed: TypedResult[] = [];
  const refused: { id: string; reason: string }[] = [];
  for (const [id, value] of Object.entries(b.values as Record<string, unknown>)) {
    const entry = byId.get(id);
    if (!entry) { refused.push({ id, reason: `blood.json has no entry "${id}"` }); continue; }
    const unit = units[id];
    typed.push({ entry, value: value as number, unit: typeof unit === 'string' ? unit : undefined });
  }
  const made = toRows(b.person, typed, t, TYPED_SOURCE);
  refused.push(...made.refused);
  if (refused.length) {
    send(res, 400, { error: 'nothing was stored', refused });
    return true;
  }
  const saved = ctx.ingest(made.rows);
  send(res, 200, { saved: saved.map((row) => ({ row, judgement: judge(byId.get(row.signal.slice('blood.'.length))!, row.value!) })) });
  return true;
}

function fail(res: ServerResponse, error: string): true {
  send(res, 400, { error });
  return true;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

const MAX_BODY = 100_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return undefined;
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}
