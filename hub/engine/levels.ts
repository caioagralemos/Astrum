// The medical lead's levels as fields, read from her files. Pure: no I/O.
//
// She agreed (14 Nov 2026, "PODE EXPORTAR COMO CAMPOS, para o melhor
// entendimento dos valores de referencia") to export as fields what today lives
// only in her prose notes. The request she was sent is
// ~/Desktop/NASA/medical-factcheck/PEDIDO-CAMPOS.md; the shapes below are exactly
// the ones it asks for:
//
//   cards.json, per card:  "situations": [{ id, answers, words, level, notify, also_card?, note? }]
//   blood.json, per entry: "bands": [{ from, from_inclusive, to, to_inclusive, level, notify, ask? }]
//                          "symptom_questions": [{ key, question: { pt, en }, if_yes: { level, notify } }]
//                          "escalations" (glucose): [{ id, from.., to.., one of ask | reading | variation, level, notify, note? }]
//
// Every field is optional. Absent, the hub does what it did before. A field
// that is there but malformed is left out at run time (with a problem line, so
// the card or entry keeps today's behaviour) and refuses the install
// (scripts/install-medical.ts). Nothing here writes a level: every one is read
// from her file.

import type { AnswerSign, CardLevel, CardNotify } from './cards.ts';

export const LEVEL_NAMES: readonly CardLevel[] = ['unusual', 'concerning', 'dangerous'];
/** Her README: unusual tells only the person, concerning the medical officer, dangerous everyone. */
export const NOTIFY_OF: Record<CardLevel, CardNotify> = { unusual: 'self', concerning: 'medical_officer', dangerous: 'everyone' };
const RANK: Record<CardLevel, number> = { unusual: 1, concerning: 2, dangerous: 3 };

export function higher(a: CardLevel | null, b: CardLevel | null): CardLevel | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[b] > RANK[a] ? b : a;
}

// ---------- cards: situations ----------

export interface Situation {
  id: string;
  /** Copied exactly from the card's own signs.answers. */
  answers: AnswerSign[];
  /** Copied exactly from the card's own signs.words (en or pt). */
  words: string[];
  level: CardLevel;
  notify: CardNotify;
  also_card?: string;
  /** Her sentence from the notes. */
  note?: string;
}

interface CardSigns {
  id: string;
  signs: { answers: AnswerSign[]; words: { en: string[]; pt: string[] } };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/** Problems with a level and notify pair, or null. */
function pairProblem(where: string, level: unknown, notify: unknown): string | null {
  if (!LEVEL_NAMES.includes(level as CardLevel)) return `${where}: level must be "unusual", "concerning" or "dangerous".`;
  if (notify !== NOTIFY_OF[level as CardLevel]) return `${where}: notify must be "${NOTIFY_OF[level as CardLevel]}" with level "${String(level)}" (unusual/self, concerning/medical_officer, dangerous/everyone).`;
  return null;
}

/**
 * Reads one card's "situations". Undefined when the field is absent. When any
 * situation is malformed the whole field is left out (undefined) and each
 * problem is named: a half-read list could set a level she did not mean.
 * `cardIds` checks also_card; leave it out to skip that check.
 */
export function parseSituations(raw: unknown, card: CardSigns, cardIds?: readonly string[]): { situations?: Situation[]; problems: string[] } {
  if (raw === undefined) return { problems: [] };
  const name = `Card "${card.id}"`;
  if (!Array.isArray(raw)) return { problems: [`${name}: situations must be a list [ ... ].`] };
  const problems: string[] = [];
  const out: Situation[] = [];
  const ids = new Set<string>();
  const cardWords = [...card.signs.words.en, ...card.signs.words.pt];
  raw.forEach((s, i) => {
    const where = `${name}, situation ${i + 1}`;
    if (!isObj(s)) { problems.push(`${where} is not an object { ... }.`); return; }
    const id = typeof s.id === 'string' ? s.id : '';
    if (!SLUG.test(id)) problems.push(`${where}: id must be lowercase letters and digits joined by hyphens.`);
    else if (ids.has(id)) problems.push(`${where}: id "${id}" is used twice.`);
    ids.add(id);
    const answers: AnswerSign[] = [];
    if (s.answers !== undefined && !Array.isArray(s.answers)) problems.push(`${where}: answers must be a list.`);
    for (const a of Array.isArray(s.answers) ? s.answers : []) {
      const q = isObj(a) && typeof a.question === 'string' ? a.question : null;
      const v = isObj(a) && typeof a.answer === 'string' ? a.answer : null;
      const own = card.signs.answers.find((x) => x.question === q && x.answer === v);
      if (!own) problems.push(`${where}: the answer "${String(q)}" = "${String(v)}" is not one of this card's signs.answers (copy it exactly).`);
      else answers.push(own);
    }
    const words: string[] = [];
    if (s.words !== undefined && !Array.isArray(s.words)) problems.push(`${where}: words must be a list.`);
    for (const w of Array.isArray(s.words) ? s.words : []) {
      if (typeof w !== 'string' || !cardWords.includes(w)) problems.push(`${where}: the word "${String(w)}" is not one of this card's signs.words (copy it exactly).`);
      else words.push(w);
    }
    if (!answers.length && !words.length && !problems.some((p) => p.startsWith(where))) problems.push(`${where}: needs at least one answer or one word that means it.`);
    const pair = pairProblem(where, s.level, s.notify);
    if (pair) problems.push(pair);
    if (s.also_card != null && (typeof s.also_card !== 'string' || (cardIds && !cardIds.includes(s.also_card)))) problems.push(`${where}: also_card "${String(s.also_card)}" is not a card id in the file.`);
    if (s.note != null && typeof s.note !== 'string') problems.push(`${where}: note must be text.`);
    const sit: Situation = { id, answers, words, level: s.level as CardLevel, notify: s.notify as CardNotify };
    if (typeof s.also_card === 'string') sit.also_card = s.also_card;
    if (typeof s.note === 'string') sit.note = s.note;
    out.push(sit);
  });
  return problems.length ? { problems } : { situations: out, problems };
}

// ---------- blood: bands, symptom questions, escalations ----------

export interface Bound {
  from: number | null;
  from_inclusive: boolean | null;
  to: number | null;
  to_inclusive: boolean | null;
}

export interface Band extends Bound {
  level: CardLevel;
  notify: CardNotify;
  /** Keys of symptom_questions asked in this band. */
  ask?: string[];
}

export interface SymptomQuestion {
  /** The check-in answer is "checkin.<key>": 1 yes, 0 no. */
  key: string;
  question: { pt: string; en: string };
  if_yes: { level: CardLevel; notify: CardNotify };
}

export interface ReadingCondition {
  signal: string;
  below?: number;
  above?: number;
  unit: string;
}

export interface Escalation extends Bound {
  id: string;
  ask?: string[];
  reading?: ReadingCondition;
  variation?: { above_percent: number; min_results: number };
  level: CardLevel;
  notify: CardNotify;
  note?: string;
}

export interface BloodFields {
  bands?: Band[];
  symptom_questions?: SymptomQuestion[];
  escalations?: Escalation[];
}

/** Body readings an escalation may name (the hub's own signals). */
const READING_SIGNALS = new Set(['heart_rate', 'resting_heart_rate', 'respiratory_rate', 'blood_oxygen']);
/** The entry whose fasting rules stay in engine/medical.ts: it takes escalations, not bands. */
export const GLUCOSE_ID = 'glucose';
/** Her README: "Hemoglobin has no alerts of its own; it follows the hematocrit." */
export const NO_FIELDS_IDS = ['hemoglobin'];

function boundProblems(where: string, b: Record<string, unknown>, allowOpen: boolean): string[] {
  const out: string[] = [];
  for (const side of ['from', 'to'] as const) {
    const v = b[side];
    const inc = b[`${side}_inclusive`];
    if (v === null || v === undefined) {
      if (inc !== null && inc !== undefined) out.push(`${where}: ${side}_inclusive must be null when ${side} is null.`);
    } else if (typeof v !== 'number' || !Number.isFinite(v)) out.push(`${where}: ${side} must be a number or null.`);
    else if (typeof inc !== 'boolean') out.push(`${where}: ${side}_inclusive must be true or false when ${side} is a number.`);
  }
  const from = typeof b.from === 'number' ? b.from : null;
  const to = typeof b.to === 'number' ? b.to : null;
  if (!out.length && from === null && to === null && !allowOpen) out.push(`${where}: needs a from or a to.`);
  if (!out.length && from !== null && to !== null && (from > to || (from === to && !(b.from_inclusive && b.to_inclusive)))) out.push(`${where}: from (${from}) must be below to (${to}).`);
  return out;
}

function bound(b: Record<string, unknown>): Bound {
  const from = typeof b.from === 'number' ? b.from : null;
  const to = typeof b.to === 'number' ? b.to : null;
  return { from, from_inclusive: from === null ? null : b.from_inclusive === true, to, to_inclusive: to === null ? null : b.to_inclusive === true };
}

/** True when the value is inside the bound, exactly as she wrote its edges. */
export function inBound(b: Bound, v: number): boolean {
  if (!Number.isFinite(v)) return false;
  if (b.from !== null && (b.from_inclusive ? v < b.from : v <= b.from)) return false;
  if (b.to !== null && (b.to_inclusive ? v > b.to : v >= b.to)) return false;
  return true;
}

/** True when two bounds share at least one value. */
function overlaps(a: Bound, b: Bound): boolean {
  // a ends before b starts, or b ends before a starts.
  const endsBefore = (x: Bound, y: Bound) => x.to !== null && y.from !== null && (x.to < y.from || (x.to === y.from && !(x.to_inclusive && y.from_inclusive)));
  return !endsBefore(a, b) && !endsBefore(b, a);
}

function askProblems(where: string, ask: unknown, keys: Set<string>): string[] {
  if (ask === undefined) return [];
  if (!Array.isArray(ask) || ask.length === 0) return [`${where}: ask must be a list of symptom question keys.`];
  return ask.filter((k) => typeof k !== 'string' || !keys.has(k)).map((k) => `${where}: ask names "${String(k)}", which is not a key in symptom_questions.`);
}

function bandRange(b: Bound): string {
  const from = b.from === null ? '' : `${b.from_inclusive ? '' : 'above '}${b.from}`;
  const to = b.to === null ? '' : `${b.to_inclusive ? 'up to ' : 'below '}${b.to}`;
  return [from, to].filter(Boolean).join(' and ') || 'any value';
}

/**
 * Reads one blood entry's level fields. Each field that is malformed is left
 * out as a whole (the entry keeps today's behaviour for it) and named.
 */
export function parseBloodFields(r: Record<string, unknown>, id: string): BloodFields & { problems: string[] } {
  const name = `Blood "${id}"`;
  const problems: string[] = [];
  const out: BloodFields & { problems: string[] } = { problems };
  const present = (['bands', 'symptom_questions', 'escalations'] as const).filter((f) => r[f] !== undefined);
  if (!present.length) return out;
  if (NO_FIELDS_IDS.includes(id)) {
    problems.push(`${name}: has ${present.join(', ')}, but her README says it has no alerts of its own (it follows the hematocrit). Left out.`);
    return out;
  }

  // Symptom questions first: bands and escalations name them.
  const keys = new Set<string>();
  if (r.symptom_questions !== undefined) {
    const before = problems.length;
    const list: SymptomQuestion[] = [];
    if (!Array.isArray(r.symptom_questions)) problems.push(`${name}: symptom_questions must be a list [ ... ].`);
    else r.symptom_questions.forEach((q, i) => {
      const where = `${name}, symptom question ${i + 1}`;
      if (!isObj(q)) { problems.push(`${where} is not an object { ... }.`); return; }
      const key = typeof q.key === 'string' ? q.key : '';
      if (!KEY.test(key) || key.length > 40) problems.push(`${where}: key must be lowercase letters and digits joined by "_" (at most 40).`);
      else if (keys.has(key)) problems.push(`${where}: key "${key}" is used twice.`);
      const text = isObj(q.question) ? q.question : {};
      const pt = typeof text.pt === 'string' ? text.pt.trim() : '';
      const en = typeof text.en === 'string' ? text.en.trim() : '';
      if (!pt || !en) problems.push(`${where}: question needs both "pt" and "en".`);
      const yes = isObj(q.if_yes) ? q.if_yes : {};
      const pair = pairProblem(`${where}, if_yes`, yes.level, yes.notify);
      if (pair) problems.push(pair);
      keys.add(key);
      list.push({ key, question: { pt, en }, if_yes: { level: yes.level as CardLevel, notify: yes.notify as CardNotify } });
    });
    if (problems.length === before) out.symptom_questions = list;
    else keys.clear();
  }

  if (r.bands !== undefined) {
    const before = problems.length;
    const list: Band[] = [];
    if (id === GLUCOSE_ID) problems.push(`${name}: glucose keeps its fasting rules; its extra levels go in "escalations", not "bands".`);
    else if (!Array.isArray(r.bands) || r.bands.length === 0) problems.push(`${name}: bands must be a list [ ... ] with at least one band.`);
    else r.bands.forEach((b, i) => {
      const where = `${name}, band ${i + 1}`;
      if (!isObj(b)) { problems.push(`${where} is not an object { ... }.`); return; }
      const bp = boundProblems(where, b, false);
      problems.push(...bp);
      const pair = pairProblem(where, b.level, b.notify);
      if (pair) problems.push(pair);
      problems.push(...askProblems(where, b.ask, keys));
      if (bp.length) return;
      const band: Band = { ...bound(b), level: b.level as CardLevel, notify: b.notify as CardNotify };
      if (Array.isArray(b.ask)) band.ask = b.ask.filter((k): k is string => typeof k === 'string');
      const clash = list.findIndex((x) => overlaps(x, band));
      if (clash >= 0) problems.push(`${where} (${bandRange(band)}) overlaps band ${clash + 1} (${bandRange(list[clash])}).`);
      list.push(band);
    });
    if (problems.length === before) out.bands = list;
  }

  if (r.escalations !== undefined) {
    const before = problems.length;
    const list: Escalation[] = [];
    if (id !== GLUCOSE_ID) problems.push(`${name}: escalations are read for glucose only; use "bands" with "ask" here.`);
    else if (!Array.isArray(r.escalations) || r.escalations.length === 0) problems.push(`${name}: escalations must be a list [ ... ] with at least one escalation.`);
    else r.escalations.forEach((e, i) => {
      const where = `${name}, escalation ${i + 1}`;
      if (!isObj(e)) { problems.push(`${where} is not an object { ... }.`); return; }
      const eid = typeof e.id === 'string' ? e.id : '';
      if (!SLUG.test(eid)) problems.push(`${where}: id must be lowercase letters and digits joined by hyphens.`);
      const kinds = (['ask', 'reading', 'variation'] as const).filter((k) => e[k] !== undefined && e[k] !== null);
      if (kinds.length !== 1) problems.push(`${where}: needs exactly one condition: ask, reading or variation.`);
      problems.push(...boundProblems(where, e, kinds[0] === 'variation'));
      const pair = pairProblem(where, e.level, e.notify);
      if (pair) problems.push(pair);
      const esc: Escalation = { ...bound(e), id: eid, level: e.level as CardLevel, notify: e.notify as CardNotify };
      if (typeof e.note === 'string') esc.note = e.note;
      if (kinds[0] === 'ask') {
        problems.push(...askProblems(where, e.ask, keys));
        if (Array.isArray(e.ask)) esc.ask = e.ask.filter((k): k is string => typeof k === 'string');
      } else if (kinds[0] === 'reading') {
        const rd = isObj(e.reading) ? e.reading : {};
        const signal = typeof rd.signal === 'string' ? rd.signal : '';
        const below = typeof rd.below === 'number' && Number.isFinite(rd.below) ? rd.below : undefined;
        const above = typeof rd.above === 'number' && Number.isFinite(rd.above) ? rd.above : undefined;
        if (!READING_SIGNALS.has(signal)) problems.push(`${where}: reading.signal must be one of ${[...READING_SIGNALS].join(', ')}.`);
        if ((below === undefined) === (above === undefined)) problems.push(`${where}: reading needs exactly one of "below" or "above", a number.`);
        if (typeof rd.unit !== 'string' || !rd.unit.trim()) problems.push(`${where}: reading needs its unit (for example "bpm").`);
        const cond: ReadingCondition = { signal, unit: typeof rd.unit === 'string' ? rd.unit.trim() : '' };
        if (below !== undefined) cond.below = below;
        if (above !== undefined) cond.above = above;
        esc.reading = cond;
      } else if (kinds[0] === 'variation') {
        const v = isObj(e.variation) ? e.variation : {};
        const pct = typeof v.above_percent === 'number' && v.above_percent > 0 ? v.above_percent : null;
        const n = typeof v.min_results === 'number' && Number.isInteger(v.min_results) && v.min_results >= 2 ? v.min_results : null;
        if (pct === null) problems.push(`${where}: variation.above_percent must be a number above 0.`);
        if (n === null) problems.push(`${where}: variation.min_results must be a whole number, 2 or more.`);
        esc.variation = { above_percent: pct ?? 0, min_results: n ?? 0 };
      }
      list.push(esc);
    });
    if (problems.length === before) out.escalations = list;
  }
  return out;
}

/** The band that holds the value, or null (no band: no alert). */
export function bandOf(bands: readonly Band[], value: number): Band | null {
  return bands.find((b) => inBound(b, value)) ?? null;
}

/**
 * Coefficient of variation, in percent: her words, "SD/mean x100". The sample
 * standard deviation (n - 1) is used, as continuous-glucose reports do. Null
 * with fewer than two values or a mean of 0.
 */
export function coefficientOfVariation(values: readonly number[]): number | null {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  if (mean === 0) return null;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
  return (sd / mean) * 100;
}

// ---------- the whole-file check, for the installer ----------

/**
 * Every problem with the level fields in her two files, in plain words. Empty
 * when the fields are absent or well formed. scripts/install-medical.ts refuses
 * the install when this is not empty.
 */
export function fieldProblems(cardsJson: unknown, bloodJson: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(cardsJson)) {
    const ids = cardsJson.filter(isObj).map((c) => (typeof c.id === 'string' ? c.id : '')).filter(Boolean);
    for (const c of cardsJson) {
      if (!isObj(c) || c.situations === undefined) continue;
      const signs = isObj(c.signs) ? c.signs : {};
      const words = isObj(signs.words) ? signs.words : {};
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
      const answers = (Array.isArray(signs.answers) ? signs.answers : []).filter(isObj)
        .map((a) => ({ question: String(a.question ?? ''), answer: String(a.answer ?? '') }));
      out.push(...parseSituations(c.situations, { id: String(c.id ?? '?'), signs: { answers, words: { en: list(words.en), pt: list(words.pt) } } }, ids).problems);
    }
  }
  if (Array.isArray(bloodJson)) {
    for (const e of bloodJson) if (isObj(e)) out.push(...parseBloodFields(e, String(e.id ?? '?')).problems);
  }
  return out;
}
