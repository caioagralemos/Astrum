import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCards, pickCard, cardView, GRAVITY_TABLE } from './cards.ts';
import type { Card } from './cards.ts';
import { bloodSignal, entryOfSignal, judge, parseBloodExport } from './blood.ts';
import { rowProblem } from './timeline.ts';
import { signalBaseline } from './baseline.ts';
import {
  FASTING_QUESTION, FOLLOW_UP_SIGNAL, SPO2_REPEAT_MIN_MS, bloodLevel, cardFinding, crisisFinding, followUpFinding, heartRateRiseCounts,
  spo2Finding, spo2Level, spo2Normal, findingsNow, MEDICAL_LEAD, cardLevel, parseLevelOverrides,
} from './medical.ts';
import { alertFor, medicalTeam, stepAlerts, stepEarth, NEEDS_SOMEONE, URGENT_CARD_ID } from './alerts.ts';
import type { AlertInputs, Finding } from './alerts.ts';
import { alertsFor, evidenceFor, rowFor } from './privacy.ts';
import type { Evidence } from './evidence.ts';
import type { Row } from './types.ts';

const medical = join(dirname(fileURLToPath(import.meta.url)), '..', 'medical');
const cards: Card[] = parseCards(JSON.parse(readFileSync(join(medical, 'cards.json'), 'utf8'))).cards;
const blood = parseBloodExport(JSON.parse(readFileSync(join(medical, 'blood.json'), 'utf8')));
const entry = (id: string) => blood.entries.find((e) => e.id === id)!;

const crew = [
  { id: 'reyes', name: 'Reyes', role: 'role.engineer' },
  { id: 'leo', name: 'Leo', role: 'role.scientist' },
  { id: 'okafor', name: 'Okafor', role: 'role.cmo' },
  { id: 'tanaka', name: 'Tanaka', role: 'role.commander' },
];
const inputs = (now: number, findings: Finding[], over: Partial<AlertInputs> = {}): AlertInputs => ({
  now, crew, delayToEarthMs: 600_000, roomAlarms: [], occupants: {}, unusual: [], asleep: [], findings, ...over,
});
const answer = (question: string, a: string) => ({ question, answer: a });

// ---------- her files load ----------

test('her export loads: 42 approved cards, 7 blood entries with ionized-calcium, no blood problem', () => {
  assert.equal(cards.length, 42);
  assert.deepEqual(blood.problems, []);
  assert.deepEqual(blood.entries.map((e) => e.id), ['glucose', 'sodium', 'potassium', 'ionized-calcium', 'ph', 'hematocrit', 'hemoglobin']);
});

test('a hyphen in a blood id is stored as "_" in the timeline signal, explicitly and both ways', () => {
  assert.equal(bloodSignal('ionized-calcium'), 'blood.ionized_calcium');
  assert.equal(bloodSignal('glucose'), 'blood.glucose');
  assert.equal(entryOfSignal('blood.ionized_calcium', blood.entries)?.id, 'ionized-calcium');
  assert.equal(rowProblem({ t: 1, signal: bloodSignal('ionized-calcium'), value: 1.2, unit: 'mmol/L', kind: 'measured', person: 'reyes' }), null);
  const twin = parseBloodExport([{ id: 'a-b', unit: 'x' }, { id: 'a_b', unit: 'x' }, { id: '-a', unit: 'x' }, { id: 'A', unit: 'x' }]);
  assert.deepEqual(twin.entries.map((e) => e.id), ['a-b'], 'a_b would share a-b\'s signal; a leading hyphen and capitals are refused');
});

// ---------- gravity ----------

test('gravity cards come from the hub table while her file has no applies_in, and say so', () => {
  const arrest = cards.find((c) => c.id === 'cardiac-arrest')!;
  assert.deepEqual(arrest.applies_in, ['weightless']);
  assert.equal(arrest.applies_in_from, 'hub-table');
  assert.equal(cardView(arrest, 'en')?.appliesInFrom, 'hub-table');
  assert.equal(cards.filter((c) => c.applies_in).length, Object.keys(GRAVITY_TABLE).length, 'exactly the four gravity cards');
  const hers = parseCards([{ ...JSON.parse(readFileSync(join(medical, 'cards.json'), 'utf8')).find((c: { id: string }) => c.id === 'choking'), applies_in: ['weightless'] }]).cards[0];
  assert.deepEqual(hers.applies_in, ['weightless'], 'her own applies_in wins');
  assert.equal(hers.applies_in_from, undefined);
});

test('cardiac arrest and choking pick by gravity; in partial gravity cardiac arrest falls back to the urgent card and names both', () => {
  const arrest = { readings: [], answers: [answer('Does the person respond when you speak?', 'no'), answer('Is the person breathing normally?', 'no')] };
  const choke = { readings: [], answers: [answer('Can you cough or speak?', 'no')] };
  assert.equal(pickCard(cards, arrest, 0)?.card.id, 'cardiac-arrest');
  assert.equal(pickCard(cards, arrest, 1)?.card.id, 'cardiac-arrest-gravity');
  const mars = pickCard(cards, arrest, 0.38)!;
  assert.equal(mars.card.id, 'unknown-urgent');
  assert.equal(mars.reason, 'no-card-for-this-gravity');
  assert.deepEqual(mars.otherGravity?.sort(), ['cardiac-arrest', 'cardiac-arrest-gravity']);
  const finding = cardFinding(mars, 'reyes', cards)!;
  assert.equal(finding.level, 3, 'both arrest cards are dangerous: the danger does not depend on gravity');
  assert.equal(finding.card, 'unknown-urgent');
  assert.equal(pickCard(cards, choke, 0)?.card.id, 'choking-no-gravity');
  assert.equal(pickCard(cards, choke, 0.166)?.card.id, 'choking-no-gravity', 'the Moon: her card says reduced gravity');
  assert.equal(pickCard(cards, choke, 1)?.card.id, 'choking');
  assert.equal(pickCard(cards, choke, null)?.card.id, 'unknown-urgent', 'gravity unknown: no gravity card');
});

// ---------- a card's level for the situation (medical/level-overrides.json) ----------

const levelRows = parseLevelOverrides(JSON.parse(readFileSync(join(medical, 'level-overrides.json'), 'utf8')), cards);

test('her base levels: heart-circulation, choking and choking-no-gravity are dangerous, everyone (second export)', () => {
  for (const id of ['heart-circulation', 'choking', 'choking-no-gravity']) {
    const c = cards.find((x) => x.id === id)!;
    assert.deepEqual([c.level, c.notify], ['dangerous', 'everyone'], id);
  }
});

test('level-overrides.json loads against her cards; every row quotes her and is confirmed by her (14 Nov 2026, "Pode")', () => {
  assert.deepEqual(levelRows.problems, []);
  assert.equal(levelRows.overrides.length, 2);
  for (const o of levelRows.overrides) {
    assert.ok(o.source.length > 20, o.answer.question);
    assert.match(o.status, /confirmed by the medical lead, 2026-11-14/);
  }
  const bad = parseLevelOverrides({ overrides: [
    { card: 'heart-circulation', answer: { question: 'Is your blood pressure a little high?', answer: 'yes' }, with_words: [], level: 'unusual', notify: 'self', source: 'x' },
    { card: 'heart-circulation', answer: { question: 'Is one leg or arm swollen, warm and painful?', answer: 'yes' }, with_words: [], level: 'concerning', notify: 'everyone', source: 'x' },
  ] }, cards);
  assert.equal(bad.overrides.length, 0, 'an answer the card does not have, or notify not matching the level, is left out');
  assert.equal(bad.problems.length, 2);
});

test('heart-circulation, by her situations (fields export, 14 Nov 2026): her concerning answers give concerning; an unplaced word or sign keeps her base level (everyone)', () => {
  const level = (answers: { question: string; answer: string }[], text?: string) => {
    const picked = pickCard(cards, { readings: [], answers, text })!;
    assert.equal(picked.card.id, 'heart-circulation');
    return cardLevel(picked, levelRows.overrides);
  };
  const swollen = answer('Is one leg or arm swollen, warm and painful?', 'yes');
  const pressure = answer('Is your blood pressure very high with a strong headache?', 'yes');
  const pale = answer('Are you pale with cold sweat and weakness?', 'yes');
  assert.equal(level([swollen]), 2);
  // Her situations hold no word for this one; cardLevel alone keeps the base level, and the ask-first rule takes her lone word out
  // beside the answer (engine/followup.ts withoutLoneWords; followup.test.ts gives concerning for case-077).
  assert.equal(level([swollen], 'swollen leg'), 3);
  assert.equal(level([pressure], 'high blood pressure'), 3);
  assert.equal(level([swollen, pressure]), 2);
  assert.equal(level([pale]), 3, 'her dangerous line');
  assert.equal(level([swollen, pale]), 3);
  assert.equal(level([swollen], 'swollen leg and cold sweat'), 3, 'a word the table does not place keeps the base level');
  // cardLevel alone still gives her base level for the lone words; the ask-first rule (engine/followup.ts) is what keeps it from being raised.
  assert.equal(level([], 'high blood pressure'), 3);
  assert.equal(level([], 'swollen leg'), 3);
  assert.equal(level([swollen]), cardLevel(pickCard(cards, { readings: [], answers: [swollen] })!, levelRows.overrides));
  assert.equal(cardLevel(pickCard(cards, { readings: [], answers: [swollen] })!, []), 2, 'her situations, with or without the old table');
  // Her answer, 14 Nov 2026 (night), for swollen, warm and painful at once: "AVISA AO MÉDICO ...": concerning at once.
  const swollenPick = pickCard(cards, { readings: [], answers: [swollen] });
  assert.equal(cardFinding(swollenPick, 'reyes', cards, 'reported', levelRows.overrides)?.level, 2);
  // Her other confirmed row raises at once, alone or beside the swollen limb.
  const pressurePick = pickCard(cards, { readings: [], answers: [pressure] });
  assert.equal(cardFinding(pressurePick, 'reyes', cards, 'reported', levelRows.overrides)?.level, 2);
  assert.equal(cardFinding(pickCard(cards, { readings: [], answers: [swollen, pressure] }), 'reyes', cards, 'reported', levelRows.overrides)?.level, 2);
  assert.equal(cardFinding(pickCard(cards, { readings: [], answers: [swollen, pale] }), 'reyes', cards, 'reported', levelRows.overrides)?.level, 3, 'with a dangerous sign: everyone, no waiting');
});

test('choking: no row; every pick keeps her base level, dangerous', () => {
  for (const facts of [{ readings: [], answers: [answer('Are you choking?', 'yes')] }, { readings: [], answers: [], text: 'I swallowed wrong' }]) {
    const picked = pickCard(cards, facts, 1)!;
    assert.equal(picked.card.id, 'choking');
    assert.equal(cardLevel(picked, levelRows.overrides), 3);
  }
});

// ---------- heart rate ----------

test('heart rate: a rise counts above 20 % or 20 bpm over the usual, and only with the statistics too', () => {
  assert.equal(heartRateRiseCounts(60, 78), true, '30 %');
  assert.equal(heartRateRiseCounts(60, 72), false, 'exactly 20 %: not above');
  assert.equal(heartRateRiseCounts(100, 115), false, '15 bpm, 15 %');
  assert.equal(heartRateRiseCounts(110, 131), true, '21 bpm, 19 %');
  const day = 24 * 3600_000;
  const rows: Row[] = [];
  for (let i = 0; i < 40; i++) rows.push({ t: i * 600_000, signal: 'resting_heart_rate', value: 60 + (i % 3) - 1, unit: 'bpm', kind: 'measured', source: 's', person: 'reyes' });
  const now = 40 * 600_000 + day;
  const judged = (v: number) => signalBaseline([...rows, { t: now - 1000, signal: 'resting_heart_rate', value: v, unit: 'bpm', kind: 'measured', source: 's', person: 'reyes' }], 'resting_heart_rate', now, { stateOf: () => 'rest' });
  const small = judged(70);
  assert.equal(small.status === 'judged' && small.z >= 3, true, 'statistically far');
  assert.equal(small.status === 'judged' && small.unusual, false, '10 bpm: not hers');
  const big = judged(78);
  assert.equal(big.status === 'judged' && big.unusual, true);
  const low = judged(40);
  assert.equal(low.status === 'judged' && low.unusual, true, 'her rule is about rises only');
});

// ---------- SpO2 ----------

const spo2 = (t: number, value: number, person = 'reyes'): Row => ({ t, signal: 'blood_oxygen', value, unit: '%', kind: 'measured', source: 'watch', person });

test('SpO2: her table, 95 read from her low-oxygen card', () => {
  assert.equal(spo2Normal(cards), 95);
  assert.deepEqual([97, 95, 94, 90, 89.9, 85, 84].map((v) => spo2Level(v, 95)), [null, null, 1, 1, 2, 2, 3]);
  assert.equal(spo2Level(80, null), null, 'without her card, nothing');
});

test('SpO2: one low reading never alerts; the next, at least 60 s later, does, at the level both agree on', () => {
  const now = 1_000_000;
  assert.equal(spo2Finding([spo2(now, 82)], 'reyes', now, cards), null);
  assert.equal(spo2Finding([spo2(now - 30_000, 82), spo2(now, 82)], 'reyes', now, cards), null, '30 s apart: not yet');
  const two = spo2Finding([spo2(now - SPO2_REPEAT_MIN_MS, 88), spo2(now, 82)], 'reyes', now, cards)!;
  assert.equal(two.level, 2, 'the lower level of the two');
  assert.equal(two.limitSource, MEDICAL_LEAD);
  assert.equal(two.card, 'low-oxygen');
  assert.equal(spo2Finding([spo2(now - 70_000, 82), spo2(now - 35_000, 97), spo2(now, 82)], 'reyes', now, cards), null, 'a normal reading in between');
  const mild = spo2Finding([spo2(now - 60_000, 92), spo2(now, 93)], 'reyes', now, cards)!;
  assert.equal(mild.level, 1);
  assert.equal(mild.nextQuestion, 'Are you short of breath?', 'her card\'s own question');
});

test('SpO2: an old low reading never raises her rule, alone or repeated, as on the live hub (a reading 885 minutes old)', () => {
  const now = 100 * 3_600_000;
  assert.equal(spo2Finding([spo2(now - 885 * 60_000, 89)], 'reyes', now, cards), null, 'a single old value');
  assert.equal(spo2Finding([spo2(now - 886 * 60_000, 84), spo2(now - 885 * 60_000, 84)], 'reyes', now, cards), null, 'repeated, but hours ago');
  // One old low reading and one fresh low one are not a repeat: the repeat must be within the live hour.
  assert.equal(spo2Finding([spo2(now - 885 * 60_000, 84), spo2(now, 84)], 'reyes', now, cards), null);
});

// ---------- blood ----------

test('pH: unusual outside her range (7.31 to 7.41 venous, from blood.json), dangerous at 7.60 or more, no low dangerous cut-off', () => {
  const ph = entry('ph');
  assert.deepEqual([ph.reference_range.low, ph.reference_range.high], [7.31, 7.41], 'her second export');
  assert.deepEqual([7.05, 7.3, 7.31, 7.35, 7.41, 7.45, 7.52, 7.6, 7.62].map((v) => bloodLevel(ph, v, null)?.level ?? null), [1, 1, null, null, null, 1, 1, 3, 3]);
  assert.equal(judge(ph, 7.6), 'urgent-above', '"7.60 or more"');
});

test('glucose: fasting and not fasting by her numbers; unanswered takes the higher of the two and asks', () => {
  const g = entry('glucose');
  const level = (v: number, f: boolean | null) => bloodLevel(g, v, f)?.level ?? null;
  assert.deepEqual([85, 110, 62, 57, 48].map((v) => level(v, true)), [null, 1, 1, 2, 3]);
  assert.deepEqual([100, 105, 106].map((v) => level(v, true)), [null, null, 1], 'fasting upper limit 105 since her second export, read from blood.json');
  assert.deepEqual([100, 150, 62, 57, 48, 249, 250, 270].map((v) => level(v, false)), [null, 1, 2, 2, 3, 1, 2, 2]);
  assert.deepEqual([85, 110, 62].map((v) => level(v, null)), [null, 1, 2]);
  const row: Row = { t: 1, signal: 'blood.glucose', value: 110, unit: 'mg/dL', kind: 'measured', source: 'istat', person: 'reyes' };
  assert.equal(findingsNow({ people: ['reyes'], now: 2, cards, entries: blood.entries, rowsOf: () => [], latestBlood: [row] })[0].nextQuestion, FASTING_QUESTION);
});

test('hemoglobin never alerts; sodium, potassium, calcium and hematocrit follow her bands (fields export, 14 Nov 2026)', () => {
  assert.equal(bloodLevel(entry('hemoglobin'), 3, null), null);
  for (const [id, v, level] of [['sodium', 110, 3], ['potassium', 7, 3], ['ionized-calcium', 0.5, 3], ['hematocrit', 10, 2], ['sodium', 140, null], ['hematocrit', 60, 1]] as const) {
    assert.equal(bloodLevel(entry(id), v, null)?.level ?? null, level, `${id} ${v}`);
  }
});

// ---------- who is told, not left alone, the urgent card, sleep ----------

const finding = (over: Partial<Finding>): Finding => ({
  key: 'k', person: 'reyes', level: 2, signal: 'blood_oxygen', value: 88, unit: '%', limit: 90, limitSource: MEDICAL_LEAD, direction: 'low',
  kind: 'measured', card: 'low-oxygen', private: null, nextQuestion: null, ...over,
});

test('level 2 tells the medical officer and says the person is not left alone; no countdown', () => {
  const [a] = stepAlerts([], inputs(1000, [finding({})])).alerts;
  assert.deepEqual(a.toldTo, ['reyes', 'okafor']);
  assert.equal(a.notAlone, true);
  assert.equal(a.answerBy, null);
  assert.equal(a.limitSource, MEDICAL_LEAD);
});

test('the medical officer affected: the commander is told; a crew with neither tells the rest by name', () => {
  assert.deepEqual(stepAlerts([], inputs(1000, [finding({ person: 'okafor' })])).alerts[0].toldTo, ['okafor', 'tanaka']);
  assert.deepEqual(medicalTeam(crew.filter((p) => p.id !== 'tanaka'), 'okafor'), ['reyes', 'leo']);
  assert.deepEqual(medicalTeam(crew.filter((p) => p.id !== 'okafor'), 'reyes'), ['tanaka']);
});

test('level 3 tells everyone, shows the urgent card beside its own, and messages Earth once', () => {
  const step = stepAlerts([], inputs(1000, [finding({ level: 3, value: 82, limit: 85 })]));
  const [a] = step.alerts;
  assert.equal(a.toldTo, 'everyone');
  assert.equal(a.card, 'low-oxygen');
  assert.equal(a.alsoCard, URGENT_CARD_ID);
  const earth = stepEarth([], step.alerts, step.events, 1000);
  assert.equal(earth.length, 1);
  const again = stepAlerts(step.alerts, inputs(3000, [finding({ level: 3, value: 81, limit: 85 })]));
  assert.equal(stepEarth(earth, again.alerts, again.events, 3000).length, 1);
  const urgentOnly = stepAlerts([], inputs(1000, [finding({ level: 3, card: URGENT_CARD_ID })])).alerts[0];
  assert.equal(urgentOnly.alsoCard, null, 'the urgent card is not shown twice');
});

test('level 1 from any of her rules is held while the person sleeps and sent when they wake', () => {
  const asleep = stepAlerts([], inputs(1000, [finding({ level: 1, value: 93 })], { asleep: ['reyes'] }));
  assert.equal(asleep.alerts[0].held, true);
  assert.deepEqual(asleep.alerts[0].toldTo, []);
  assert.deepEqual(asleep.events, []);
  const woke = stepAlerts(asleep.alerts, inputs(2000, [finding({ level: 1, value: 93 })]));
  assert.deepEqual(woke.alerts[0].toldTo, ['reyes']);
  assert.deepEqual(woke.events.map((e) => e.type), ['raised']);
});

test('"did not get better" is a check-in answer: a no tells the medical officer, a later yes ends it', () => {
  const row = (t: number, value: number): Row => ({ t, signal: FOLLOW_UP_SIGNAL, value, unit: '', kind: 'reported', source: 'checkin:reyes', person: 'reyes' });
  assert.equal(followUpFinding([row(1000, 0)], 'reyes', 2000)?.level, 2);
  assert.equal(followUpFinding([row(1000, 0), row(1500, 1)], 'reyes', 2000), null);
  assert.equal(followUpFinding([], 'reyes', 2000), null);
});

// ---------- privacy ----------

const pick = (text: string) => pickCard(cards, { readings: [], answers: [], text });

test('privacy: a mood card reaches the person; the medical officer and the crew learn only that she needs someone', () => {
  const picked = pick('I am anxious');
  assert.equal(picked?.card.id, 'mood-stress');
  const f = { ...cardFinding(picked, 'reyes', cards)!, level: 2 as const };
  const [a] = stepAlerts([], inputs(1000, [f])).alerts;
  assert.equal(a.card, null, 'not in the alert the hub keeps');
  assert.equal(a.signal, NEEDS_SOMEONE);
  assert.equal(JSON.stringify(a).includes('mood'), false);
  assert.equal(alertFor(a, 'reyes').card, 'mood-stress');
  for (const viewer of ['okafor', 'leo', 'common']) {
    const seen = alertFor(a, viewer);
    assert.equal(seen.card, null, viewer);
    assert.equal(JSON.stringify(seen).includes('mood'), false, viewer);
    assert.equal(seen.textKey, 'alert.needsSomeone');
  }
});

test('privacy: psychosis at level 3 tells everyone she needs someone, with the urgent card, and nobody but her sees the card', () => {
  const picked = pickCard(cards, { readings: [], answers: [answer('Do you hear voices or see things that are not there?', 'yes')] });
  assert.equal(picked?.card.id, 'depression-psychosis');
  const step = stepAlerts([], inputs(1000, [{ ...cardFinding(picked, 'reyes', cards)!, level: 3 }]));
  const [a] = step.alerts;
  assert.equal(a.toldTo, 'everyone');
  for (const viewer of ['okafor', 'tanaka', 'leo', 'common']) {
    const seen = alertFor(a, viewer);
    assert.equal(seen.card, null);
    assert.equal(seen.alsoCard, URGENT_CARD_ID);
    assert.equal(JSON.stringify(seen).includes('psychosis'), false);
  }
  assert.equal(alertFor(a, 'reyes').card, 'depression-psychosis');
  const [earth] = stepEarth([], step.alerts, step.events, 1000);
  assert.equal(earth.about.signal, NEEDS_SOMEONE, 'the message to Earth names no card either');
});

test('privacy: the gynecologic card reaches the person and the medical officer only; the commander in her place when she is the person', () => {
  const picked = pick('heavy bleeding');
  assert.equal(picked?.card.id, 'gynecologic');
  const [a] = stepAlerts([], inputs(1000, [{ ...cardFinding(picked, 'reyes', cards)!, level: 2 }])).alerts;
  assert.equal(alertFor(a, 'okafor').card, 'gynecologic');
  assert.equal(alertFor(a, 'tanaka').card, null);
  assert.equal(alertFor(a, 'common').card, null);
  const [own] = stepAlerts([], inputs(1000, [{ ...cardFinding(picked, 'okafor', cards)!, level: 2 }])).alerts;
  assert.equal(alertFor(own, 'tanaka').card, 'gynecologic');
  assert.equal(alertFor(own, 'reyes').card, null);
});

test('privacy: a crisis tells the medical officer "<name> needs someone", with no card and no words', () => {
  const [a] = stepAlerts([], inputs(1000, [crisisFinding('reyes')])).alerts;
  assert.deepEqual(a.toldTo, ['reyes', 'okafor']);
  assert.equal(a.textKey, 'alert.needsSomeone');
  assert.deepEqual(alertsFor([a], 'okafor')[0].card, null);
});

test('privacy: typed check-in answers and reported rows keep their text only for their author', () => {
  const row: Row = { t: 1, signal: 'checkin.note', value: null, text: 'private words', unit: '', kind: 'reported', source: 'checkin:reyes', person: 'reyes' };
  assert.equal(rowFor(row, 'reyes').text, 'private words');
  assert.equal(rowFor(row, 'okafor').text, null);
  assert.equal(rowFor(row, 'common').text, null);
  const body = { ...row, signal: 'heart_rate', text: 'a note' };
  assert.equal(rowFor(body, 'common').text, 'a note', 'only check-in answers');
  const ev = { person: 'reyes', reported: { rows: [{ t: 1, signal: 'checkin.note', value: null, text: 'private words', unit: '', kind: 'reported' as const }], runs: [] } } as unknown as Evidence;
  assert.equal(evidenceFor(ev, 'okafor').reported.rows[0].text, null);
  assert.equal(evidenceFor(ev, 'reyes').reported.rows[0].text, 'private words');
});
