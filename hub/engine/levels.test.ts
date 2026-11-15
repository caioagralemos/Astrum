// Her levels as fields (engine/levels.ts): the readers, the levels they give,
// and the installer's refusal of a malformed field. The fixtures here are made
// up for the tests (numbers and ids are not hers), except the last test, which
// uses only the examples of PEDIDO-CAMPOS.md (each copied from her notes).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCards, pickCard } from './cards.ts';
import type { Card } from './cards.ts';
import { parseBloodExport } from './blood.ts';
import type { BloodEntry } from './blood.ts';
import { bandOf, coefficientOfVariation, fieldProblems, inBound, parseBloodFields, parseSituations } from './levels.ts';
import { bloodFinding, bloodLevel, cardFinding, cardLevel, findingsNow, parseLevelOverrides } from './medical.ts';
import type { Row } from './types.ts';
import { install, readEnReview } from '../scripts/install-medical.ts';
import { runCases } from '../medical/run-cases.ts';

const medical = join(dirname(fileURLToPath(import.meta.url)), '..', 'medical');
const herCards = JSON.parse(readFileSync(join(medical, 'cards.json'), 'utf8')) as Record<string, unknown>[];
const herBlood = JSON.parse(readFileSync(join(medical, 'blood.json'), 'utf8')) as Record<string, unknown>[];

const fixtureCard = (extra: Record<string, unknown> = {}) => ({
  id: 'sore-thing', title: { en: 'Sore thing', pt: 'Coisa dolorida' }, level: 'dangerous', notify: 'everyone', message_houston: false,
  signs: {
    readings: [],
    answers: [{ question: 'Is it very sore?', answer: 'yes' }, { question: 'Is it a little sore?', answer: 'yes' }],
    words: { en: ['sore', 'very sore'], pt: ['dolorido'] },
  },
  steps: [{ en: 'Rest.', pt: 'Descanse.' }], do_not: [], sources: [], unverified: [], status: 'approved', en_checked: true, notes: '', ...extra,
});
const urgent = { ...fixtureCard(), id: 'unknown-urgent', signs: { readings: [], answers: [], words: { en: [], pt: [] } } };

// ---------- situations ----------

test('situations: absent changes nothing; well formed is read; malformed is left out and named', () => {
  const plain = parseCards([fixtureCard(), urgent]);
  assert.equal(plain.cards[0].situations, undefined);
  const good = parseCards([fixtureCard({ situations: [
    { id: 'a-little', answers: [{ question: 'Is it a little sore?', answer: 'yes' }], words: [], level: 'unusual', notify: 'self', note: 'test' },
  ] }), urgent]);
  assert.equal(good.cards[0].situations?.length, 1);
  assert.deepEqual(good.problems.filter((p) => p.includes('situation')), []);

  const card = { id: 'sore-thing', signs: fixtureCard().signs as Card['signs'] };
  const bad = (s: unknown) => parseSituations([s], card, ['sore-thing', 'unknown-urgent']).problems;
  assert.match(bad({ id: 'x', answers: [{ question: 'Is it sore?', answer: 'yes' }], level: 'unusual', notify: 'self' })[0], /not one of this card's signs.answers/);
  assert.match(bad({ id: 'x', words: ['ouch'], level: 'unusual', notify: 'self' })[0], /not one of this card's signs.words/);
  assert.match(bad({ id: 'x', words: ['sore'], level: 'unusual', notify: 'medical_officer' })[0], /notify must be "self"/);
  assert.match(bad({ id: 'x', level: 'unusual', notify: 'self' })[0], /at least one answer or one word/);
  assert.match(bad({ id: 'x', words: ['sore'], level: 'unusual', notify: 'self', also_card: 'nope' })[0], /also_card/);
  assert.match(bad({ id: 'Bad Id', words: ['sore'], level: 'unusual', notify: 'self' })[0], /id must be/);
  const halfBad = parseCards([fixtureCard({ situations: [{ id: 'x', words: ['ouch'], level: 'unusual', notify: 'self' }] }), urgent]);
  assert.equal(halfBad.cards[0].situations, undefined, 'a malformed list is not used at all');
  assert.ok(halfBad.problems.some((p) => /situations are not used/.test(p)));
});

test('situations decide the card level, never lower it on a guess, and win over level-overrides.json', () => {
  const cards = parseCards([fixtureCard({ situations: [
    { id: 'a-little', answers: [{ question: 'Is it a little sore?', answer: 'yes' }], words: ['dolorido'], level: 'unusual', notify: 'self' },
    { id: 'very', answers: [{ question: 'Is it very sore?', answer: 'yes' }], words: ['very sore'], level: 'concerning', notify: 'medical_officer', also_card: 'unknown-urgent' },
  ] }), urgent]).cards;
  const level = (answers: { question: string; answer: string }[], text?: string) => cardLevel(pickCard(cards, { readings: [], answers, text })!);
  assert.equal(level([{ question: 'Is it a little sore?', answer: 'yes' }]), 1);
  assert.equal(level([], 'dolorido'), 1);
  assert.equal(level([{ question: 'Is it very sore?', answer: 'yes' }]), 2);
  assert.equal(level([{ question: 'Is it a little sore?', answer: 'yes' }, { question: 'Is it very sore?', answer: 'yes' }]), 2, 'the highest situation');
  assert.equal(level([{ question: 'Is it a little sore?', answer: 'yes' }], 'it is sore'), 3, '"sore" is in no situation: the base level stays');
  assert.equal(level([], 'sore'), 3, 'no situation matched: the base level');
  const f = cardFinding(pickCard(cards, { readings: [], answers: [{ question: 'Is it very sore?', answer: 'yes' }] }), 'reyes', cards);
  assert.equal(f?.alsoCard, 'unknown-urgent', 'also_card travels on the finding');
  // A row of the old table for the same card is not read once the card carries situations.
  const rows = parseLevelOverrides({ overrides: [{ card: 'sore-thing', answer: { question: 'Is it a little sore?', answer: 'yes' }, with_words: [], level: 'concerning', notify: 'medical_officer', source: 'x' }] }, cards).overrides;
  assert.equal(cardLevel(pickCard(cards, { readings: [], answers: [{ question: 'Is it a little sore?', answer: 'yes' }] })!, rows), 1, 'her card fields win');
});

// ---------- blood fields ----------

const entryWith = (fields: Record<string, unknown>, id = 'salt'): BloodEntry => {
  const parsed = parseBloodExport([{ id, name: { en: id, pt: id }, unit: 'mmol/L', reference_range: { low: 10, high: 20, condition: '' }, flag_below: 10, flag_above: 20, urgent_below: null, urgent_above: null, status: 'approved', ...fields }]);
  assert.deepEqual(parsed.problems, []);
  return parsed.entries[0];
};

test('bands: edges are read exactly as written; no band, no alert', () => {
  const b = { from: 5, from_inclusive: true, to: 8, to_inclusive: false };
  assert.equal(inBound(b, 5), true);
  assert.equal(inBound(b, 8), false);
  assert.equal(inBound({ from: null, from_inclusive: null, to: 3, to_inclusive: true }, 3), true);
  const e = entryWith({ bands: [
    { from: null, from_inclusive: null, to: 5, to_inclusive: false, level: 'dangerous', notify: 'everyone' },
    { from: 5, from_inclusive: true, to: 8, to_inclusive: true, level: 'unusual', notify: 'self' },
  ] });
  assert.equal(bandOf(e.bands!, 4.9)?.level, 'dangerous');
  assert.equal(bloodLevel(e, 4.9, null)?.level, 3);
  assert.equal(bloodLevel(e, 8, null)?.level, 1);
  assert.equal(bloodLevel(e, 8.5, null), null, 'between bands: nothing');
  assert.equal(bloodLevel(e, 15, null), null, 'normal: nothing');
  assert.equal(bloodLevel(e, 4.9, null)?.limit, 5);
});

test('bands: a symptom question is asked with the result; yes raises it to her level for yes', () => {
  const e = entryWith({
    symptom_questions: [{ key: 'salt_signs', question: { pt: 'Sinais?', en: 'Signs?' }, if_yes: { level: 'concerning', notify: 'medical_officer' } }],
    bands: [{ from: 5, from_inclusive: true, to: 8, to_inclusive: true, level: 'unusual', notify: 'self', ask: ['salt_signs'] }],
  });
  assert.deepEqual([bloodLevel(e, 6, null)?.level, bloodLevel(e, 6, null)?.ask?.key], [1, 'salt_signs']);
  assert.deepEqual([bloodLevel(e, 6, null, { answers: { salt_signs: false } })?.level, bloodLevel(e, 6, null, { answers: { salt_signs: false } })?.ask?.key], [1, 'salt_signs']);
  assert.deepEqual([bloodLevel(e, 6, null, { answers: { salt_signs: true } })?.level, bloodLevel(e, 6, null, { answers: { salt_signs: true } })?.ask], [2, null]);
  const row: Row = { t: 1000, signal: 'blood.salt', value: 6, unit: 'mmol/L', kind: 'measured', source: 't', person: 'reyes' };
  assert.equal(bloodFinding(e, row, null)?.nextQuestion, 'Signs?');
  // Through findingsNow, the answer is the check-in row "checkin.salt_signs".
  const rows: Row[] = [{ t: 1500, signal: 'checkin.salt_signs', value: 1, unit: '', kind: 'reported', source: 't', person: 'reyes' }];
  const found = findingsNow({ people: ['reyes'], now: 2000, cards: [], entries: [e], rowsOf: (p, s, from) => rows.filter((r) => r.person === p && r.signal === s && r.t >= from), latestBlood: [row] });
  assert.equal(found[0]?.level, 2);
});

test('glucose escalations: a symptom answer, a slow heart rate and a large variation raise the level; outside their range nothing', () => {
  const glucose = parseBloodExport([{
    id: 'glucose', name: { en: 'Glucose', pt: 'Glicose' }, unit: 'mg/dL', reference_range: { low: 70, high: 105, condition: 'fasting' },
    flag_below: 70, flag_above: 105, urgent_below: 54, urgent_above: 250, status: 'approved',
    symptom_questions: [{ key: 'g_signs', question: { pt: 'Sinais?', en: 'Signs?' }, if_yes: { level: 'dangerous', notify: 'everyone' } }],
    escalations: [
      { id: 'high', from: 250, from_inclusive: true, to: null, to_inclusive: null, ask: ['g_signs'], level: 'dangerous', notify: 'everyone' },
      { id: 'slow', from: 54, from_inclusive: true, to: 69, to_inclusive: true, reading: { signal: 'heart_rate', below: 40, unit: 'bpm' }, level: 'dangerous', notify: 'everyone' },
      { id: 'swing', from: null, from_inclusive: null, to: null, to_inclusive: null, variation: { above_percent: 36, min_results: 3 }, level: 'unusual', notify: 'self' },
    ],
  }]);
  assert.deepEqual(glucose.problems, []);
  const g = glucose.entries[0];
  assert.equal(bloodLevel(g, 270, false)?.level, 2, 'today: concerning');
  assert.equal(bloodLevel(g, 270, false, { answers: { g_signs: true } })?.level, 3);
  assert.equal(bloodLevel(g, 270, false)?.ask, null, 'the escalation question is not put as the next question');
  const hr = (value: number) => () => ({ value, unit: 'bpm' });
  assert.equal(bloodLevel(g, 62, false, { reading: hr(38) })?.level, 3);
  assert.equal(bloodLevel(g, 62, false, { reading: hr(40) })?.level, 2, '"below 40" does not include 40');
  assert.equal(bloodLevel(g, 80, false, { reading: hr(38) }), null, 'outside the escalation range');
  assert.equal(bloodLevel(g, 100, false, { history: [70, 130, 60, 150] })?.level, 1, 'variation above 36 %');
  assert.equal(bloodLevel(g, 100, false, { history: [100, 130] }), null, 'fewer results than she asks for');
  assert.ok(Math.abs(coefficientOfVariation([70, 130, 60, 150])! - 43.2) < 0.1);
});

test('blood fields: malformed ones are left out and named; glucose takes no bands, others no escalations, hemoglobin nothing', () => {
  const p = (r: Record<string, unknown>, id = 'salt') => parseBloodFields(r, id).problems;
  const band = { from: 1, from_inclusive: true, to: 2, to_inclusive: true, level: 'unusual', notify: 'self' };
  assert.match(p({ bands: [{ ...band, from_inclusive: null }] })[0], /from_inclusive must be true or false/);
  assert.match(p({ bands: [band, { ...band, from: 2 }] })[0], /overlaps band 1/);
  assert.deepEqual(p({ bands: [band, { ...band, from: 2, from_inclusive: false, to: 3 }] }), [], 'touching edges, one excluded: no overlap');
  assert.match(p({ bands: [{ ...band, level: 'dangerous' }] })[0], /notify must be "everyone"/);
  assert.match(p({ bands: [{ ...band, ask: ['nope'] }] })[0], /not a key in symptom_questions/);
  assert.match(p({ bands: [{ ...band, from: 3 }] })[0], /must be below/);
  assert.match(p({ bands: [band] }, 'glucose')[0], /escalations/);
  assert.match(p({ escalations: [] })[0], /glucose only/);
  assert.match(p({ bands: [band] }, 'hemoglobin')[0], /no alerts of its own/);
  assert.match(p({ symptom_questions: [{ key: 'k', question: { pt: 'x' }, if_yes: { level: 'unusual', notify: 'self' } }] })[0], /both "pt" and "en"/);
  assert.match(p({ escalations: [{ id: 'a', from: 1, from_inclusive: true, to: null, to_inclusive: null, level: 'unusual', notify: 'self' }] }, 'glucose')[0], /exactly one condition/);
  const bad = parseBloodExport([{ id: 'salt', unit: 'mmol/L', reference_range: { low: 1, high: 2 }, bands: [{ ...band, level: 'x' }] }]);
  assert.equal(bad.entries[0].bands, undefined, 'the entry keeps today\'s behaviour');
  assert.ok(bad.problems.length > 0);
});

test('her installed files carry her level fields with no problem: 34 cards with situations, 5 blood entries', () => {
  assert.deepEqual(fieldProblems(herCards, herBlood), []);
  assert.equal(herCards.filter((c) => c.situations !== undefined).length, 34);
  assert.deepEqual(herBlood.filter((e) => e.bands || e.escalations).map((e) => e.id).sort(), ['glucose', 'hematocrit', 'ionized-calcium', 'potassium', 'sodium']);
});

test('the installer refuses an export with a malformed level field, with a plain sentence, and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'astrum-export-'));
  const exportDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'NASA', 'medical-export-14nov-v2');
  cpSync(exportDir, dir, { recursive: true });
  const blood = JSON.parse(readFileSync(join(dir, 'blood.json'), 'utf8')) as Record<string, unknown>[];
  blood.find((e) => e.id === 'sodium')!.bands = [{ from: 1, from_inclusive: true, to: 2, to_inclusive: true, level: 'dangerous', notify: 'self' }];
  writeFileSync(join(dir, 'blood.json'), JSON.stringify(blood, null, 2));
  const dest = mkdtempSync(join(tmpdir(), 'astrum-dest-'));
  const reports = install(dir, dest, true, readEnReview());
  const problems = reports.flatMap((r) => r.problems);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^Level fields: Blood "sodium", band 1: notify must be "everyone"/);
  assert.throws(() => readFileSync(join(dest, 'cards.json')), 'nothing written');
});

// ---------- her cases, with and without her fields ----------

test('her cases: her fields raise the pass count, and no case that passed without them fails with them', () => {
  const withFields = runCases();
  const strip = <T extends Record<string, unknown>>(list: T[], keys: string[]) => list.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !keys.includes(k))));
  const without = runCases({ cards: strip(herCards, ['situations']), blood: strip(herBlood, ['bands', 'symptom_questions', 'escalations']) });
  const passedWith = new Set(withFields.results.filter((r) => r.passed).map((r) => r.id));
  assert.ok(withFields.passed > without.passed, `${withFields.passed} with, ${without.passed} without`);
  assert.deepEqual(without.results.filter((r) => r.passed && !passedWith.has(r.id)).map((r) => r.id), []);
});
