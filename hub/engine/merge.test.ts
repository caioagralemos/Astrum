// "npm run medical:merge" (scripts/merge-medical.ts): her partial export put into a new full folder, by id.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addText, elementSpans, merge, mergeText } from '../scripts/merge-medical.ts';

const base = '[\n  {\n    "id": "a",\n    "x": "Ação ] , {"\n  },\n  {\n    "id": "b",\n    "x": 1\n  },\n  {\n    "id": "c",\n    "x": 2\n  }\n]\n';

test('elementSpans finds each top-level entry, strings with brackets included', () => {
  const spans = elementSpans(base);
  assert.equal(spans.length, 3);
  assert.deepEqual(spans.map(([s, e]) => JSON.parse(base.slice(s, e)).id), ['a', 'b', 'c']);
});

test('a changed entry replaces the one with its id, in place; formatting and the others are kept', () => {
  const changed = '[\n  {\n    "id": "b",\n    "x": 1,\n    "situations": []\n  }\n]\n';
  const r = mergeText('cards.json', base, changed);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.changed, ['b']);
  assert.deepEqual(r.fields, { b: ['situations'] });
  assert.equal(r.text, base.replace('"x": 1\n  }', '"x": 1,\n    "situations": []\n  }'));
});

test('an id the base does not have, or one given twice, refuses the merge', () => {
  assert.match(mergeText('cards.json', base, '[{"id":"z"}]').problems[0], /never adds/);
  assert.match(mergeText('cards.json', base, '[{"id":"a"},{"id":"a"}]').problems[0], /twice/);
});

test('merge writes a new folder: base files copied, partial files merged, her notes beside them; an existing folder is refused', () => {
  const b = mkdtempSync(join(tmpdir(), 'astrum-base-'));
  const c = mkdtempSync(join(tmpdir(), 'astrum-changes-'));
  writeFileSync(join(b, 'cards.json'), base);
  writeFileSync(join(b, 'blood.json'), '[{"id":"sodium"}]');
  writeFileSync(join(b, 'README.md'), 'readme');
  writeFileSync(join(c, 'cards.changed.json'), '[{"id":"c","x":3}]');
  writeFileSync(join(c, 'changes-fields.md'), 'notes');
  const out = join(mkdtempSync(join(tmpdir(), 'astrum-out-')), 'v3');
  const reports = merge(b, c, out);
  assert.deepEqual(reports.flatMap((r) => r.problems), []);
  assert.deepEqual((JSON.parse(readFileSync(join(out, 'cards.json'), 'utf8')) as { x: unknown }[]).map((x) => x.x), ['Ação ] , {', 1, 3]);
  assert.equal(readFileSync(join(out, 'blood.json'), 'utf8'), '[{"id":"sodium"}]');
  assert.equal(readFileSync(join(out, 'README.md'), 'utf8'), 'readme');
  assert.equal(readFileSync(join(out, 'changes-fields.md'), 'utf8'), 'notes');
  assert.match(merge(b, c, out)[0].problems[0], /already exists/);
});

test('cards.new.json adds her new cards after the last one, word for word; an id the base has is refused', () => {
  const added = '[\n  {\n    "id": "d",\n    "x": "Não ] {"\n  }\n]\n';
  const r = addText('cards.json', base, added);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.changed, ['d']);
  assert.equal(r.text, base.replace('"x": 2\n  }\n]', '"x": 2\n  },\n  {\n    "id": "d",\n    "x": "Não ] {"\n  }\n]'));
  assert.match(addText('cards.json', base, '[{"id":"b"}]').problems[0], /already in the base/);
  assert.match(addText('cards.json', base, '[{"id":"z"},{"id":"z"}]').problems[0], /already in the base/);
  const b = mkdtempSync(join(tmpdir(), 'astrum-base-'));
  const c = mkdtempSync(join(tmpdir(), 'astrum-changes-'));
  writeFileSync(join(b, 'cards.json'), base);
  writeFileSync(join(c, 'cards.changed.json'), '[{"id":"c","x":3}]');
  writeFileSync(join(c, 'cards.new.json'), added);
  const out = join(mkdtempSync(join(tmpdir(), 'astrum-out-')), 'v4');
  const reports = merge(b, c, out);
  assert.deepEqual(reports.flatMap((x) => x.problems), []);
  assert.deepEqual(reports[0].changed, ['c', 'd']);
  assert.deepEqual((JSON.parse(readFileSync(join(out, 'cards.json'), 'utf8')) as { id: string }[]).map((x) => x.id), ['a', 'b', 'c', 'd']);
});
