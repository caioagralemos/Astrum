// Merges the medical lead's partial export into a new full export folder, by id.
//
//   npm run medical:merge <base-folder> <changes-folder> <out-folder>
//
// <base-folder> is her last full export (cards.json, blood.json, cases.json, ...).
// <changes-folder> holds what she changed, whole: cards.changed.json and/or
// blood.changed.json (and cases.changed.json if she sends one), plus her notes.
// A new card comes in cards.new.json: each of its entries is added after the
// base's last card, in her order; an id the base already has refuses the merge.
// <out-folder> must not exist yet: it is written as a new full export, ready for
// "npm run medical:install <out-folder>". Neither input folder is touched.
//
// How it stays honest:
//   - each changed entry replaces the base entry with the same id, in the base
//     order; an id the base does not have, or an id given twice, refuses the
//     merge (nothing is added or lost);
//   - the replacement is done on the raw text, so both files keep her
//     formatting, and the result is then parsed and compared with the expected
//     list entry by entry;
//   - every other file of the base folder is copied as is, and her notes (.md)
//     from the changes folder are copied beside them.
// The report lists, per changed id, which top-level fields differ from the base.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Her full files that a partial export may change, and the name of the partial file. */
export const MERGEABLE: [string, string][] = [
  ['cards.json', 'cards.changed.json'],
  ['blood.json', 'blood.changed.json'],
  ['cases.json', 'cases.changed.json'],
];

/** Start and end (exclusive) of each element of a top-level JSON array, in the raw text. */
export function elementSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  let i = text.indexOf('[');
  if (i < 0) throw new Error('not a JSON list');
  i++;
  let depth = 0;
  let start = -1;
  let inString = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; if (depth === 0 && start < 0) start = i; continue; }
    if (/\s/.test(ch)) continue;
    if (depth === 0 && (ch === ',' || ch === ']')) {
      if (start >= 0) {
        let end = i;
        while (/\s/.test(text[end - 1])) end--;
        spans.push([start, end]);
        start = -1;
      }
      if (ch === ']') return spans;
      continue;
    }
    if (depth === 0 && start < 0) start = i;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  throw new Error('the JSON list does not close');
}

export interface FileMerge {
  file: string;
  /** Ids replaced, in base order. */
  changed: string[];
  /** Per changed id, the top-level fields that differ from the base. */
  fields: Record<string, string[]>;
  problems: string[];
  text: string;
}

function idOf(v: unknown): string | null {
  return typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null;
}

/** Merges one partial file's text into one full file's text, by id. */
export function mergeText(file: string, baseText: string, changedText: string): FileMerge {
  const out: FileMerge = { file, changed: [], fields: {}, problems: [], text: baseText };
  let base: unknown[];
  let changed: unknown[];
  try {
    base = JSON.parse(baseText);
    changed = JSON.parse(changedText);
  } catch (err) {
    out.problems.push(`${file}: not valid JSON (${(err as Error).message}).`);
    return out;
  }
  if (!Array.isArray(base) || !Array.isArray(changed)) { out.problems.push(`${file}: both files must be lists.`); return out; }
  const baseSpans = elementSpans(baseText);
  const changedSpans = elementSpans(changedText);
  if (baseSpans.length !== base.length || changedSpans.length !== changed.length) { out.problems.push(`${file}: could not find each entry in the text.`); return out; }
  const baseIds = base.map(idOf);
  const seen = new Set<string>();
  const replace = new Map<number, number>();
  changed.forEach((c, j) => {
    const id = idOf(c);
    if (!id) { out.problems.push(`${file}: changed entry ${j + 1} has no id.`); return; }
    if (seen.has(id)) { out.problems.push(`${file}: "${id}" is in the changes twice.`); return; }
    seen.add(id);
    const i = baseIds.indexOf(id);
    if (i < 0) { out.problems.push(`${file}: "${id}" is not in the base, and a merge never adds an entry.`); return; }
    replace.set(i, j);
  });
  if (out.problems.length) return out;
  let text = baseText;
  for (const i of [...replace.keys()].sort((a, b) => b - a)) {
    const [s, e] = baseSpans[i];
    const [cs, ce] = changedSpans[replace.get(i)!];
    text = text.slice(0, s) + changedText.slice(cs, ce) + text.slice(e);
  }
  // Proof: the merged list is the base with exactly those entries replaced.
  const merged = JSON.parse(text) as unknown[];
  const expected = base.map((b, i) => (replace.has(i) ? changed[replace.get(i)!] : b));
  if (JSON.stringify(merged) !== JSON.stringify(expected)) { out.problems.push(`${file}: the merged text does not parse to the expected list.`); return out; }
  for (const i of [...replace.keys()].sort((a, b) => a - b)) {
    const id = baseIds[i]!;
    const b = base[i] as Record<string, unknown>;
    const c = changed[replace.get(i)!] as Record<string, unknown>;
    out.changed.push(id);
    out.fields[id] = [...new Set([...Object.keys(b), ...Object.keys(c)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(c[k])).sort();
  }
  out.text = text;
  return out;
}

/** Her partial file of new cards: entries the base does not have yet. */
export const NEW_CARDS: [string, string] = ['cards.json', 'cards.new.json'];

/** Adds new entries after the base's last one, on the raw text; an id the base has, or one given twice, refuses. */
export function addText(file: string, baseText: string, newText: string): FileMerge {
  const out: FileMerge = { file, changed: [], fields: {}, problems: [], text: baseText };
  let base: unknown[];
  let added: unknown[];
  try {
    base = JSON.parse(baseText);
    added = JSON.parse(newText);
  } catch (err) {
    out.problems.push(`${file}: not valid JSON (${(err as Error).message}).`);
    return out;
  }
  if (!Array.isArray(base) || !Array.isArray(added)) { out.problems.push(`${file}: both files must be lists.`); return out; }
  const baseSpans = elementSpans(baseText);
  const newSpans = elementSpans(newText);
  if (baseSpans.length !== base.length || newSpans.length !== added.length || !baseSpans.length) { out.problems.push(`${file}: could not find each entry in the text.`); return out; }
  const ids = new Set(base.map(idOf));
  added.forEach((a, j) => {
    const id = idOf(a);
    if (!id) { out.problems.push(`${file}: new entry ${j + 1} has no id.`); return; }
    if (ids.has(id)) { out.problems.push(`${file}: "${id}" is already in the base (or given twice), and a new card never replaces one.`); return; }
    ids.add(id);
    out.changed.push(id);
    out.fields[id] = ['new'];
  });
  if (out.problems.length) return { ...out, changed: [], fields: {} };
  const end = baseSpans[baseSpans.length - 1][1];
  const indent = baseText.slice(baseText.lastIndexOf('\n', baseSpans[0][0]) + 1, baseSpans[0][0]);
  const text = baseText.slice(0, end) + newSpans.map(([s, e]) => `,\n${indent}${newText.slice(s, e)}`).join('') + baseText.slice(end);
  // Proof: the result is the base followed by her new entries, nothing else.
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify([...base, ...added])) { out.problems.push(`${file}: the merged text does not parse to the expected list.`); return out; }
  out.text = text;
  return out;
}

/** Merges the folders. Writes only when nothing is wrong. */
export function merge(baseDir: string, changesDir: string, outDir: string, write = true): FileMerge[] {
  const reports: FileMerge[] = [];
  if (existsSync(outDir)) return [{ file: outDir, changed: [], fields: {}, problems: [`${outDir} already exists; the merge writes a new folder only.`], text: '' }];
  for (const [full, partial] of MERGEABLE) {
    const changedPath = join(changesDir, partial);
    if (!existsSync(changedPath)) continue;
    const basePath = join(baseDir, full);
    if (!existsSync(basePath)) { reports.push({ file: full, changed: [], fields: {}, problems: [`${full} is missing from ${baseDir}.`], text: '' }); continue; }
    reports.push(mergeText(full, readFileSync(basePath, 'utf8'), readFileSync(changedPath, 'utf8')));
  }
  const newPath = join(changesDir, NEW_CARDS[1]);
  if (existsSync(newPath)) {
    const [full] = NEW_CARDS;
    const held = reports.find((r) => r.file === full);
    const basePath = join(baseDir, full);
    if (held && held.problems.length === 0) {
      const a = addText(full, held.text, readFileSync(newPath, 'utf8'));
      reports[reports.indexOf(held)] = { ...a, changed: [...held.changed, ...a.changed], fields: { ...held.fields, ...a.fields } };
    }
    else if (!held && existsSync(basePath)) reports.push(addText(full, readFileSync(basePath, 'utf8'), readFileSync(newPath, 'utf8')));
    else if (!held) reports.push({ file: full, changed: [], fields: {}, problems: [`${full} is missing from ${baseDir}.`], text: '' });
  }
  if (!reports.length) reports.push({ file: changesDir, changed: [], fields: {}, problems: [`${changesDir} has no ${[...MERGEABLE.map(([, p]) => p), NEW_CARDS[1]].join(', ')}.`], text: '' });
  if (!write || reports.some((r) => r.problems.length)) return reports;
  mkdirSync(outDir, { recursive: true });
  for (const name of readdirSync(baseDir)) {
    const from = join(baseDir, name);
    if (statSync(from).isFile()) copyFileSync(from, join(outDir, name));
  }
  for (const name of readdirSync(changesDir)) if (name.endsWith('.md')) copyFileSync(join(changesDir, name), join(outDir, name));
  for (const r of reports) writeFileSync(join(outDir, r.file), r.text);
  return reports;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, changes, out] = process.argv.slice(2);
  if (!base || !changes || !out) {
    console.error('Usage: npm run medical:merge <base-folder> <changes-folder> <out-folder>');
    process.exit(2);
  }
  const reports = merge(resolve(base), resolve(changes), resolve(out));
  for (const r of reports) {
    console.log(`${r.file}: ${r.changed.length} entries replaced or added.`);
    for (const id of r.changed) console.log(`  ${id}: ${r.fields[id].join(', ') || 'no field differs'}`);
    for (const p of r.problems) console.log(`  PROBLEM: ${p}`);
  }
  const failed = reports.some((r) => r.problems.length);
  console.log(failed ? 'Nothing was written.' : `Written to ${resolve(out)}.`);
  process.exit(failed ? 1 : 0);
}
