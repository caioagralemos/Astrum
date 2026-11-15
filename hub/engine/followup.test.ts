// Ask first, no level from a lone symptom (engine/followup.ts), against her
// real cards and medical/follow-up.json, with the before/after of her warning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerSignal, parseCards, pickCard } from './cards.ts';
import type { Card, Facts } from './cards.ts';
import { cardFinding, parseLevelOverrides } from './medical.ts';
import {
  askFirstFinding, decideFollowUp, followUpSignal, givenFrom, loneOnly, parseFollowUps, pendingQuestions, pickWithFollowUp,
} from './followup.ts';
import type { FollowUpRow, Given } from './followup.ts';
import { t } from './strings.ts';
import { rowProblem } from './timeline.ts';

const medical = join(dirname(fileURLToPath(import.meta.url)), '..', 'medical');
const cards: Card[] = parseCards(JSON.parse(readFileSync(join(medical, 'cards.json'), 'utf8'))).cards;
const overrides = parseLevelOverrides(JSON.parse(readFileSync(join(medical, 'level-overrides.json'), 'utf8')), cards).overrides;
const followUpJson = JSON.parse(readFileSync(join(medical, 'follow-up.json'), 'utf8'));
const { rows, problems } = parseFollowUps(followUpJson, cards);
const facts = (text: string, answers: Facts['answers'] = []): Facts => ({ readings: [], answers, text });

/** The level before this change: her signs, the card's level (with level-overrides.json), nothing asked. */
const before = (text: string, answers: Facts['answers'] = []) => cardFinding(pickCard(cards, facts(text, answers), 0), 'reyes', cards, 'reported', overrides);
/** After: her ask-first rule. */
const after = (text: string, answers: Facts['answers'] = [], given: Record<string, Given> = {}) => {
  const r = pickWithFollowUp(cards, facts(text, answers), 0, rows, given);
  return { finding: cardFinding(r.picked, 'reyes', cards, 'reported', overrides), askFirst: r.askFirst };
};

test('follow-up.json loads against her cards: two rows on heart-circulation, her sentences and the date of her answer, no level rule', () => {
  assert.deepEqual(problems, []);
  assert.deepEqual(rows.map((r) => r.id), ['high-blood-pressure', 'swollen-leg']);
  for (const r of rows) {
    assert.equal(r.card, 'heart-circulation');
    assert.equal(r.answered_on, '2026-11-14');
    assert.ok(r.her_sentence.length > 40);
    assert.deepEqual(r.level_rules, [], 'she gave no rule for turning the answers into a level');
  }
  // The lone words, exactly: from the card's own list, nothing else.
  assert.deepEqual(rows.flatMap((r) => r.lone_words).sort(), ['high blood pressure', 'perna inchada', 'pressão alta', 'swollen leg']);
});

test('every follow-up question has its text in both languages, and its check-in signal is a valid timeline signal', () => {
  for (const q of rows.flatMap((r) => r.questions)) {
    assert.notEqual(t(q.string_key, 'en'), q.string_key, q.key);
    assert.notEqual(t(q.string_key, 'pt'), q.string_key, q.key);
    assert.equal(rowProblem({ t: 1, signal: followUpSignal(q.key), value: 1, unit: '', kind: 'reported', source: 'checkin:reyes', person: 'reyes' }), null, q.key);
  }
  assert.equal(t('followup.bp.diagnosed', 'pt'), 'Você tem pressão alta (diagnóstico)?');
});

test('before/after: "pressão alta" and "perna inchada" alone called everyone; now nothing is raised and her questions are asked', () => {
  for (const text of ['pressão alta', 'high blood pressure', 'perna inchada', 'swollen leg', 'tenho pressão alta']) {
    assert.equal(before(text)?.level, 3, `before: ${text}`);
    assert.equal(before(text)?.card, 'heart-circulation');
    const a = after(text);
    assert.equal(a.finding, null, `after: nothing raised for "${text}"`);
    assert.equal(a.askFirst?.card, 'heart-circulation');
  }
  assert.deepEqual(after('pressão alta').askFirst?.questions.map((q) => q.key), ['bp_slept_well', 'bp_heavy_head', 'bp_diagnosed', 'bp_measured'],
    '"did you take your medicine?" waits for a yes to the diagnosis');
  assert.deepEqual(after('perna inchada').askFirst?.questions.map((q) => q.key), ['leg_colour_changed', 'leg_pain', 'leg_inflammation']);
  assert.deepEqual(after('pressão alta e perna inchada').askFirst?.rows, ['high-blood-pressure', 'swollen-leg']);
});

test('before/after, her warning: "headache and high blood pressure" no longer calls everyone by the tie; "pale and dizzy" still does', () => {
  // Before: one match each, and the dangerous card won the tie.
  assert.deepEqual([before('headache and high blood pressure')?.card, before('headache and high blood pressure')?.level], ['heart-circulation', 3]);
  // After: heart-circulation waits for her questions; the pick is made again without it. Her "headache" is a word of
  // both high-co2 and headache, and high-co2's higher base level wins that tie (her case-057 notes the same overlap).
  const a = after('headache and high blood pressure');
  assert.equal(a.askFirst?.card, 'heart-circulation');
  assert.deepEqual([a.finding?.card, a.finding?.level], ['high-co2', 2]);
  assert.deepEqual([after('dor de cabeça e pressão alta').finding?.card, after('dor de cabeça e pressão alta').askFirst?.card], ['high-co2', 'heart-circulation']);
  // "pale" is one of her severe signs (pale with cold sweat and weakness), not a lone symptom: unchanged.
  for (const text of ['pale and dizzy', 'pálida e tonta']) {
    assert.equal(before(text)?.level, 3, `before: ${text}`);
    assert.deepEqual([after(text).finding?.card, after(text).finding?.level, after(text).askFirst], ['heart-circulation', 3, null], `after: ${text}`);
  }
});

test('anything beyond a lone symptom keeps the card level: a severe word, one of her answers (case-077)', () => {
  assert.deepEqual([after('swollen leg and cold sweat').finding?.level, after('swollen leg and cold sweat').askFirst], [3, null]);
  const swollen = { question: 'Is one leg or arm swollen, warm and painful?', answer: 'yes' };
  assert.deepEqual([after('swollen leg', [swollen]).finding?.level, after('swollen leg', [swollen]).askFirst], [2, null], 'her confirmed row: concerning at once');
  const pale = { question: 'Are you pale with cold sweat and weakness?', answer: 'yes' };
  assert.equal(loneOnly(pickCard(cards, facts('pressão alta', [pale]), 0), rows), null);
});

test('a card that carries her own situations covering the word does not ask first (her fields win)', () => {
  const withSituations = cards.map((c) => (c.id === 'heart-circulation'
    ? { ...c, situations: [{ id: 'bp', answers: [], words: ['pressão alta'], level: 'unusual' as const, notify: 'self' as const }] } : c));
  const r = pickWithFollowUp(withSituations, facts('pressão alta'), 0, rows);
  assert.equal(r.askFirst, null);
  assert.equal(cardFinding(r.picked, 'reyes', withSituations)?.level, 1);
});

test('answers: stored per key, the conditional question follows the diagnosis, and with no rule of hers nothing is raised', () => {
  const bp = rows.filter((r) => r.id === 'high-blood-pressure');
  const given = givenFrom([
    { signal: 'checkin.bp_slept_well', value: 0, t: 1 }, { signal: 'checkin.bp_heavy_head', value: 1, t: 2 },
    { signal: 'checkin.bp_diagnosed', value: 1, t: 3 }, { signal: 'checkin.bp_diagnosed', value: 0, t: 0 },
  ]);
  assert.equal(given.bp_diagnosed.value, 1, 'the latest answer counts');
  assert.deepEqual(pendingQuestions(bp, given).map((q) => q.key), ['bp_took_medicine', 'bp_measured']);
  assert.deepEqual(pendingQuestions(bp, { ...given, bp_diagnosed: { value: 0, text: null } }).map((q) => q.key), ['bp_measured'], 'no diagnosis: no medicine question');
  const all = { ...given, bp_took_medicine: { value: 0, text: null }, bp_measured: { value: null, text: '150/95' } };
  assert.deepEqual(pendingQuestions(bp, all), []);
  assert.equal(decideFollowUp(bp, all), null);
  const r = after('pressão alta', [], all);
  assert.deepEqual([r.finding, r.askFirst?.questions, r.askFirst?.rule], [null, [], null], 'all answered, no written rule: no alert');
  assert.equal(askFirstFinding(r.askFirst, 'reyes'), null);
});

test('a level rule, when one of hers exists, is applied only when its answers are all given as written', () => {
  // Fixture: a made-up rule, to test the mechanism. It is not hers and is not in follow-up.json.
  const ruled: FollowUpRow[] = rows.map((r) => (r.id !== 'swollen-leg' ? r : {
    ...r, level_rules: [{ when: { leg_colour_changed: 'yes', leg_pain: 'yes' }, level: 'concerning', notify: 'medical_officer', source: 'test only' }],
  }));
  const yes = { value: 1, text: null };
  const no = { value: 0, text: null };
  const swollen = ruled.filter((r) => r.id === 'swollen-leg');
  assert.equal(decideFollowUp(swollen, { leg_colour_changed: yes }), null);
  assert.equal(decideFollowUp(swollen, { leg_colour_changed: yes, leg_pain: no }), null);
  assert.equal(decideFollowUp(swollen, { leg_colour_changed: yes, leg_pain: yes })?.level, 'concerning');
  const r = pickWithFollowUp(cards, facts('perna inchada'), 0, ruled, { leg_colour_changed: yes, leg_pain: yes });
  assert.deepEqual([askFirstFinding(r.askFirst, 'reyes')?.card, askFirstFinding(r.askFirst, 'reyes')?.level], ['heart-circulation', 2]);
  // A malformed rule is refused.
  const bad = structuredClone(followUpJson);
  bad.follow_ups[1].level_rules = [{ when: { leg_pain: 'yes' }, level: 'concerning', notify: 'everyone', source: 'x' }];
  assert.equal(parseFollowUps(bad, cards).rows.length, 1);
  bad.follow_ups[1].level_rules = [];
  bad.follow_ups[1].lone_words = ['leg'];
  assert.match(parseFollowUps(bad, cards).problems[0], /lone_words must be words of the card/);
});

test('answerSignal: one valid, distinct check-in signal per card question of hers', () => {
  const questions = [...new Set(cards.flatMap((c) => c.signs.answers.map((a) => a.question)))];
  const signals = questions.map(answerSignal);
  assert.equal(new Set(signals).size, questions.length);
  for (const s of signals) assert.equal(rowProblem({ t: 1, signal: s, value: 1, unit: '', kind: 'reported', source: 'checkin:reyes', person: 'reyes' }), null, s);
});
