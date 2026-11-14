import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glucoseMgdlToMmoll, glucoseMmollToMgdl, judge, parseBloodExport, toRows } from './blood.ts';
import type { BloodEntry } from './blood.ts';
import { rowProblem } from './timeline.ts';

// The numbers below are test numbers, not clinical ranges.
function entry(id: string, fields: Partial<BloodEntry> & { low?: number | null; high?: number | null } = {}): Record<string, unknown> {
  const { low = null, high = null, ...rest } = fields;
  return {
    id, name: { en: id, pt: id }, unit: 'u',
    reference_range: { low, high, condition: '' },
    flag_below: null, flag_above: null, urgent_below: null, urgent_above: null,
    what_it_means: { en: '', pt: '' }, spaceflight_note: '', sources: [], status: 'draft', notes: '',
    ...rest,
  };
}

const parsed = (raw: Record<string, unknown>) => {
  const out = parseBloodExport([raw]);
  assert.deepEqual(out.problems, []);
  return out.entries[0];
};

test('her export reads as she wrote it, and an empty file is a valid state', () => {
  const out = parseBloodExport([{
    id: 'glucose', name: { en: 'Glucose', pt: 'Glicose' }, unit: 'mg/dL',
    reference_range: { low: null, high: null, condition: '' },
    flag_below: null, flag_above: null, urgent_below: null, urgent_above: null,
    what_it_means: { en: '', pt: '' }, spaceflight_note: '',
    sources: [{ name: '', url: '', quote: '', is_nasa: false }], status: 'draft', notes: '',
  }]);
  assert.deepEqual(out.problems, []);
  assert.equal(out.entries[0].unit, 'mg/dL');
  assert.equal(out.entries[0].name.pt, 'Glicose');
  assert.deepEqual(parseBloodExport([]), { entries: [], problems: [] });
  assert.deepEqual(parseBloodExport(null), { entries: [], problems: [] });
});

test('a broken file gives plain problems and never throws', () => {
  assert.equal(parseBloodExport({ id: 'x' }).problems.length, 1);
  const out = parseBloodExport([
    'nonsense',
    entry('Sodium Level'),
    { ...entry('potassium'), unit: '' },
    entry('glucose'),
    entry('glucose'),
    entry('calcium', { low: 10, high: 5 }),
    entry('chloride', { flag_below: '3' as never }),
  ]);
  assert.deepEqual(out.entries.map((e) => e.id), ['glucose', 'calcium', 'chloride']);
  const all = out.problems.join('\n');
  for (const words of ['Entry 1', 'Entry 2', '"potassium" has no unit', '"glucose" appears more than once', '"calcium": reference_range.low (10) is above', '"chloride": flag_below must be a number']) {
    assert.ok(all.includes(words), `missing problem: ${words}`);
  }
  const calcium = out.entries.find((e) => e.id === 'calcium')!;
  assert.equal(judge(calcium, 100), 'no-range', 'contradicting numbers are ignored, not guessed at');
});

test('an urgent level inside the flag range is a problem, and the entry is not flagged on it', () => {
  const out = parseBloodExport([entry('a', { low: 10, high: 20, urgent_below: 12 }), entry('b', { flag_above: 30, urgent_above: 25 })]);
  assert.equal(out.problems.length, 2);
  assert.ok(out.problems[0].includes('urgent_below (12) is inside the flag range'));
  assert.ok(out.problems[1].includes('urgent_above (25) is inside the flag range'));
  assert.equal(judge(out.entries[0], 5), 'no-range');
});

test('judge uses only her numbers: urgent first, then flag levels, then the reference range', () => {
  const none = parsed(entry('a'));
  assert.equal(judge(none, 1e9), 'no-range');

  const range = parsed(entry('b', { low: 10, high: 20 }));
  assert.equal(judge(range, 9.9), 'below');
  assert.equal(judge(range, 10), 'in-range', 'a value on the limit is inside it');
  assert.equal(judge(range, 20), 'in-range');
  assert.equal(judge(range, 20.1), 'above');

  const flags = parsed(entry('c', { low: 10, high: 20, flag_below: 8, flag_above: 25, urgent_below: 5, urgent_above: 40 }));
  assert.equal(judge(flags, 9), 'in-range', 'her flag level wins over the reference range');
  assert.equal(judge(flags, 7), 'below');
  assert.equal(judge(flags, 4), 'urgent-below');
  assert.equal(judge(flags, 30), 'above');
  assert.equal(judge(flags, 41), 'urgent-above');

  const oneSide = parsed(entry('d', { flag_above: 20 }));
  assert.equal(judge(oneSide, -100), 'in-range');
  assert.equal(judge(oneSide, 21), 'above');

  const urgentOnly = parsed(entry('e', { urgent_above: 50 }));
  assert.equal(judge(urgentOnly, 10), 'no-range');
  assert.equal(judge(urgentOnly, 51), 'urgent-above');
  assert.equal(judge(range, Number.NaN), 'no-range');
});

test('typed results become measured rows in her unit; another unit is refused, not converted', () => {
  const glucose = parsed({ ...entry('glucose'), unit: 'mg/dL' });
  const sodium = parsed({ ...entry('sodium'), unit: 'mmol/L' });
  const { rows, refused } = toRows('reyes', [
    { entry: glucose, value: 92 },
    { entry: sodium, value: 141, unit: 'mmol/L' },
    { entry: glucose, value: 5.1, unit: 'mmol/L' },
    { entry: sodium, value: Number.NaN },
  ], 5000, 'istat:typed');
  assert.deepEqual(rows[0], { t: 5000, signal: 'blood.glucose', value: 92, text: null, unit: 'mg/dL', kind: 'measured', source: 'istat:typed', person: 'reyes' });
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(rowProblem(row), null);
  assert.deepEqual(refused.map((r) => r.id), ['glucose', 'sodium']);
  assert.ok(refused[0].reason.includes('mmol/L'));
});

test('the glucose conversion is explicit and round-trips', () => {
  assert.equal(Number(glucoseMmollToMgdl(5).toFixed(2)), 90.08);
  assert.equal(Number(glucoseMgdlToMmoll(90.08).toFixed(3)), 5);
  assert.equal(Number(glucoseMgdlToMmoll(glucoseMmollToMgdl(6.2)).toFixed(10)), 6.2);
});
