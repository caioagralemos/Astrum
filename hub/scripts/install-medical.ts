// Installs the medical lead's export into hub/medical/, with one change on the
// way in: the drafting tool's product name is taken out of her provenance notes
// (the owner's rule: no product of that kind is named in the repository; the
// project's one disclosure of how it was made lives in the repo README).
// Nothing else may change.
//
//   node scripts/install-medical.ts <export-folder> [--check] [--sentences]
//
// --check installs nothing: it only prints what would change.
// --sentences also prints every changed sentence, old and new, for the owner to read.
//
// How it stays honest:
//   - the replacement runs on the raw text, so the file keeps her formatting;
//   - both versions are then parsed and compared field by field: only provenance
//     text may differ (cards: notes and unverified; blood and cases: notes), and
//     each such string must equal the scrub of hers. Any other difference, or a
//     product name left anywhere (a step, a title, a source), fails the install
//     and writes nothing, because those fields are hers to change.

//
// Then the English check (medical/en-review.json) is applied to cards.json. It
// holds, per card, the English corrections of an independent language review
// and a hash of the Portuguese and English it was checked against. While both
// hashes still match her card, the corrections are written in and, if the
// review found the card's English faithful, "en_checked" becomes true. When she
// changes a card's Portuguese or English, the review no longer matches: nothing
// is applied to that card and it stays as she exported it (unchecked), until
// someone checks it again. "en_checked" means the English says what her
// Portuguese says; it is not a medical check of the steps.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const MEDICAL_DIR = join(here, '..', 'medical');

/** Her file → its installed name. */
export const FILES: [string, string][] = [
  ['cards.json', 'cards.json'],
  ['blood.json', 'blood.json'],
  ['cases.json', 'cases.json'],
  ['README.md', 'README.md'],
  ['coverage.md', 'COVERAGE.md'],
];

/** Fields whose text may be scrubbed, by file. Every other field must come out unchanged. */
const SCRUBBABLE: Record<string, RegExp> = {
  'cards.json': /^\[\d+\]\.(notes|unverified\[\d+\])$/,
  'blood.json': /^\[\d+\]\.notes$/,
  'cases.json': /^\[\d+\]\.notes$/,
};

// The two names are written split so this file never contains them whole.
const PRODUCT = ['Clau', 'de'].join('');
const COMPANY = ['Anthro', 'pic'].join('');
/** Words that must not be left anywhere in the installed files. */
export const BANNED = new RegExp(`\\b(${PRODUCT}|${COMPANY})\\b`, 'i');

const P = PRODUCT;
/**
 * In order: the specific phrases first, then the general ones. The owner's rule:
 *   - the tool credited as author or drafter: "the medical lead" (she directed
 *     and approved the text; her README already says "written by the medical lead");
 *   - "from <tool>'s memory": "from memory", with no author added;
 *   - any other mention: the name is dropped, or "the drafting tool" where the
 *     sentence needs a noun. Nothing that says what is unverified changes.
 */
const REPLACEMENTS: [RegExp, string][] = [
  [new RegExp(`drafted by her ${P}`, 'g'), 'drafted by the medical lead'],
  [new RegExp(`\\bfrom memory by ${P}\\b`, 'g'), 'from memory'],
  [new RegExp(`\\b([Ff])rom ${P}'s memory`, 'g'), '$1rom memory'],
  [new RegExp(`\\(${P}'s memory`, 'g'), '(from memory'],
  [new RegExp(`\\b(written|drafted) by ${P}\\b`, 'g'), '$1 by the medical lead'],
  [new RegExp(`\\b${P} (wrote|drafted)\\b`, 'g'), 'the medical lead $1'],
  [new RegExp(`\\b${P}'s translation\\b|\\b${P} translation\\b`, 'g'), 'a translation'],
  [new RegExp(`\\b${P}'s reading\\b`, 'g'), 'a reading'],
  [new RegExp(`\\b${P}'s recommendations\\b`, 'g'), "the draft's recommendations"],
  [new RegExp(`\\bproposed by ${P}\\b`, 'g'), 'proposed in the draft'],
  [new RegExp(`\\b(opened|verified|checked|read) by ${P}\\b`, 'g'), '$1'],
  [new RegExp(`\\b([Cc])ounted by hand by ${P}\\b`, 'g'), '$1ounted by hand'],
  [new RegExp(`\\bwhich ${P} did not read\\b`, 'g'), 'which was not read'],
  [new RegExp(`\\b${P} did not open them\\b`, 'g'), 'they were not opened'],
  [new RegExp(`\\bguideline ${P} read\\b`, 'g'), 'guideline read'],
  [new RegExp(`\\b${P}'s\\b`, 'g'), "the drafting tool's"],
  [new RegExp(`\\b${P}\\b`, 'g'), 'the drafting tool'],
  [new RegExp(`\\b${COMPANY}\\b`, 'g'), 'the drafting tool'],
];

/** The scrub. A phrase that starts a sentence keeps its capital. */
export function scrub(text: string): string {
  let out = text;
  for (const [re, to] of REPLACEMENTS) out = out.replace(re, to);
  return out.replace(/(^|[.!?:]\s+|\n\s*|"\s*)(the drafting tool|the draft's|the medical lead|a translation|a reading|they were not opened)\b/g,
    (_m, lead: string, phrase: string) => lead + phrase[0].toUpperCase() + phrase.slice(1));
}

/** The sentences the scrub changes in one text, old and new, in order. */
export function changedSentences(original: string): [string, string][] {
  const split = (t: string) => t.split(/(?<=[.!?])\s+|\n+/);
  const out: [string, string][] = [];
  for (const sentence of split(original)) {
    if (!BANNED.test(sentence)) continue;
    out.push([sentence.trim(), scrub(sentence).trim()]);
  }
  return out;
}

/** Every string leaf of a JSON value, by path ("[3].notes"). */
function leaves(value: unknown, path = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) leaves(v, path ? `${path}.${k}` : `.${k}`.slice(1), out);
  else out.set(path, value);
  return out;
}

export interface FileReport {
  file: string;
  installedAs: string;
  /** How many strings changed, by field pattern ("notes", "unverified"). */
  changed: Record<string, number>;
  problems: string[];
  text: string;
  /** cards.json only: what the English check did. */
  enReview?: Omit<EnReviewReport, 'text'>;
}

/** Scrubs one of her files and checks that only the product name changed. */
export function prepare(file: string, original: string): FileReport {
  const installedAs = FILES.find(([f]) => f === file)?.[1] ?? file;
  const text = scrub(original);
  const report: FileReport = { file, installedAs, changed: {}, problems: [], text };
  if (BANNED.test(text)) report.problems.push(`${file}: a product name is still in the text after the scrub.`);
  if (!file.endsWith('.json')) {
    const changed = original.split('\n').filter((line, i) => line !== text.split('\n')[i]).length;
    if (changed) report.changed.lines = changed;
    return report;
  }
  let before: Map<string, unknown>;
  let after: Map<string, unknown>;
  try {
    before = leaves(JSON.parse(original));
    after = leaves(JSON.parse(text));
  } catch (err) {
    report.problems.push(`${file}: not valid JSON (${(err as Error).message}).`);
    return report;
  }
  const allowed = SCRUBBABLE[file];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(path);
    const b = after.get(path);
    if (a === b) continue;
    const field = path.replace(/^\[\d+\]\./, '').replace(/\[\d+\]/g, '');
    if (!allowed?.test(path) || typeof a !== 'string' || b !== scrub(a)) {
      report.problems.push(`${file}: ${path} would change, and only the product name in ${allowed ? 'notes or unverified' : 'no field'} may.`);
      continue;
    }
    report.changed[field] = (report.changed[field] ?? 0) + 1;
  }
  return report;
}

// ---- The English check ----

/** One English correction: the Portuguese it translates, and the new English. */
export interface EnFix {
  pt: string;
  en: string;
}

export interface EnReviewCard {
  /** True when the review found every crew-visible English text of the card faithful (after the fixes). */
  checked: boolean;
  /** Why not, when checked is false. */
  why_not?: string;
  /** enHash of her card's Portuguese, and of her English, as reviewed. */
  pt_sha256: string;
  en_sha256: string;
  /** Path in the card ("title", "steps[2]", "do_not[0]") to the corrected English. */
  fixes: Record<string, EnFix>;
}

export interface EnReview {
  about: string;
  cards: Record<string, EnReviewCard>;
}

export const EN_REVIEW_FILE = 'en-review.json';

interface ShownTexts {
  title: { en?: unknown; pt?: unknown };
  steps: { en?: unknown; pt?: unknown }[];
  do_not: { en?: unknown; pt?: unknown }[];
}

/** The texts of a card the crew sees, by path. */
function shown(card: ShownTexts): [string, { en?: unknown; pt?: unknown }][] {
  return [
    ['title', card.title ?? {}],
    ...(card.steps ?? []).map((s, i): [string, { en?: unknown; pt?: unknown }] => [`steps[${i}]`, s ?? {}]),
    ...(card.do_not ?? []).map((s, i): [string, { en?: unknown; pt?: unknown }] => [`do_not[${i}]`, s ?? {}]),
  ];
}

/** sha256 of one language of a card's crew-visible texts, paths included, so an added or removed step changes it. */
export function enHash(card: ShownTexts, lang: 'en' | 'pt'): string {
  const texts = shown(card).map(([path, t]) => [path, typeof t[lang] === 'string' ? t[lang] : null]);
  return createHash('sha256').update(JSON.stringify(texts)).digest('hex');
}

/** Where each string or literal value sits in a JSON text, by path ("[3].steps[1].en"). */
function positions(text: string): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] ?? '')) i++; };
  const string = (): string => {
    const start = i;
    i++;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (path: string): void => {
    ws();
    const start = i;
    if (text[i] === '{') {
      i++; ws();
      while (text[i] !== '}') {
        const key = string();
        ws(); i++; // the colon
        value(path ? `${path}.${key}` : key);
        ws();
        if (text[i] === ',') { i++; ws(); }
      }
      i++;
    } else if (text[i] === '[') {
      i++; ws();
      for (let n = 0; text[i] !== ']'; n++) {
        value(`${path}[${n}]`);
        ws();
        if (text[i] === ',') { i++; ws(); }
      }
      i++;
    } else if (text[i] === '"') {
      string();
      out.set(path, [start, i]);
    } else {
      while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
      out.set(path, [start, i]);
    }
  };
  value('');
  return out;
}

export interface EnReviewReport {
  /** Cards whose review matched: fixes written in. */
  applied: string[];
  /** Of those, the cards now marked en_checked. */
  checked: string[];
  /** Cards she changed since the review: left as exported, unchecked. */
  stale: string[];
  /** How many English texts were replaced. */
  fixed: number;
  problems: string[];
  text: string;
}

/**
 * Applies the English check to the installed cards.json text. Edits the raw
 * text, so the file keeps her formatting, and then proves that only English
 * text of the title, steps and do-nots, and en_checked, changed.
 */
export function applyEnReview(cardsText: string, review: EnReview): EnReviewReport {
  const report: EnReviewReport = { applied: [], checked: [], stale: [], fixed: 0, problems: [], text: cardsText };
  let cards: (ShownTexts & { id?: unknown; en_checked?: unknown })[];
  try {
    cards = JSON.parse(cardsText);
  } catch (err) {
    report.problems.push(`cards.json: not valid JSON (${(err as Error).message}).`);
    return report;
  }
  if (!Array.isArray(cards)) return report;
  const at = positions(cardsText);
  const edits: [number, number, string][] = [];
  for (const [id, r] of Object.entries(review.cards ?? {})) {
    const i = cards.findIndex((c) => c?.id === id);
    if (i < 0) { report.stale.push(id); continue; }
    const card = cards[i];
    if (enHash(card, 'pt') !== r.pt_sha256 || enHash(card, 'en') !== r.en_sha256) { report.stale.push(id); continue; }
    const texts = new Map(shown(card));
    const bad = Object.entries(r.fixes ?? {}).filter(([path, fix]) => texts.get(path)?.pt !== fix.pt || typeof fix.en !== 'string' || !fix.en.trim());
    if (bad.length) {
      report.problems.push(`${EN_REVIEW_FILE}: card "${id}" has fixes that do not match its Portuguese (${bad.map(([p]) => p).join(', ')}).`);
      continue;
    }
    for (const [path, fix] of Object.entries(r.fixes ?? {})) {
      const pos = at.get(`[${i}].${path}.en`);
      if (!pos) { report.problems.push(`cards.json: card "${id}" has no English at ${path}.`); continue; }
      edits.push([pos[0], pos[1], JSON.stringify(fix.en)]);
      report.fixed++;
    }
    report.applied.push(id);
    if (r.checked === true) {
      const pos = at.get(`[${i}].en_checked`);
      if (!pos) { report.problems.push(`cards.json: card "${id}" has no en_checked field.`); continue; }
      edits.push([pos[0], pos[1], 'true']);
      report.checked.push(id);
    }
  }
  if (report.problems.length) return { ...report, text: cardsText };
  let text = cardsText;
  for (const [start, end, to] of edits.sort((a, b) => b[0] - a[0])) text = text.slice(0, start) + to + text.slice(end);
  // Proof: only English of shown texts, and en_checked, may differ.
  const before = leaves(cards);
  const after = leaves(JSON.parse(text));
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(path) === after.get(path)) continue;
    if (!/^\[\d+\]\.(title\.en|steps\[\d+\]\.en|do_not\[\d+\]\.en|en_checked)$/.test(path)) report.problems.push(`cards.json: ${path} would change, and the English check may change only English text and en_checked.`);
  }
  if (report.problems.length) return { ...report, text: cardsText };
  return { ...report, text };
}

export function readEnReview(dir = MEDICAL_DIR): EnReview | null {
  const path = join(dir, EN_REVIEW_FILE);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as EnReview : null;
}

export function install(exportDir: string, dest = MEDICAL_DIR, write = true, review: EnReview | null = readEnReview(dest)): FileReport[] {
  const reports = FILES.map(([file]) => {
    const path = join(exportDir, file);
    if (!existsSync(path)) return { file, installedAs: file, changed: {}, problems: [`${file} is missing from ${exportDir}.`], text: '' };
    return prepare(file, readFileSync(path, 'utf8'));
  });
  const cards = reports.find((r) => r.file === 'cards.json');
  if (review && cards && cards.problems.length === 0) {
    const r = applyEnReview(cards.text, review);
    cards.text = r.text;
    cards.problems.push(...r.problems);
    const { text: _text, ...summary } = r;
    cards.enReview = summary;
  }
  if (write && reports.every((r) => r.problems.length === 0)) {
    mkdirSync(dest, { recursive: true });
    for (const r of reports) writeFileSync(join(dest, r.installedAs), r.text);
  }
  return reports;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('Usage: node scripts/install-medical.ts <export-folder> [--check]');
    process.exit(2);
  }
  const check = args.includes('--check');
  const reports = install(resolve(dir), MEDICAL_DIR, !check);
  for (const r of reports) {
    const summary = Object.entries(r.changed).map(([field, n]) => `${n} ${field}`).join(', ') || 'nothing';
    console.log(`${r.file} -> medical/${r.installedAs}: product name replaced in ${summary}.`);
    if (r.enReview) {
      const e = r.enReview;
      console.log(`  English check: ${e.applied.length} cards matched the review, ${e.fixed} English texts corrected, ${e.checked.length} marked en_checked.`);
      if (e.stale.length) console.log(`  English check: changed since the review, left unchecked: ${e.stale.join(', ')}.`);
    }
    for (const p of r.problems) console.log(`  PROBLEM: ${p}`);
  }
  if (args.includes('--sentences')) {
    const seen = new Map<string, { to: string; n: number }>();
    for (const [file] of FILES) {
      const path = join(resolve(dir), file);
      if (!existsSync(path)) continue;
      for (const [from, to] of changedSentences(readFileSync(path, 'utf8'))) {
        const held = seen.get(from);
        seen.set(from, { to, n: (held?.n ?? 0) + 1 });
      }
    }
    for (const [from, { to, n }] of seen) console.log(`\n${n > 1 ? `(${n}x) ` : ''}OLD: ${from}\nNEW: ${to}`);
  }
  const failed = reports.some((r) => r.problems.length);
  console.log(failed ? 'Nothing was installed.' : check ? 'Check only: nothing was written.' : `Installed into ${MEDICAL_DIR}.`);
  process.exit(failed ? 1 : 0);
}
