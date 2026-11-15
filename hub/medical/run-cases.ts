// The medical lead's 96 test cases (medical/cases.json) against the hub's real
// engine. `npm run cases` writes medical/CASES-RESULTS.md.
//
// Each case's situation is built as inputs to the same functions the hub runs:
// the room's CO2 rows through cabin.ts overLimit (NASA's limit), the person's
// readings through baseline.ts signalBaseline (their own normal, with her heart
// rate rule), SpO2 and blood results through medical.ts findingsNow, her check-in
// answers and the words typed through cards.ts pickCard (as the question path
// does) at the level medical.ts cardLevel gives (with medical/level-overrides.json),
// and all of it through alerts.ts stepAlerts (levels, who is told). The
// model is never called. No case id appears below: every case goes through the
// same steps.
//
// How a case's words become inputs (the only reading of her text here):
//   - who: "reyes" on the ship's crew (an engineer: not the medical officer).
//   - gravity: the ship's (0 g), or 1 g when the title or story says gravity is
//     on, 0 g when it says gravity is off.
//   - asleep: when the story says "asleep".
//   - "does not wake / answer": the alert steps again after the countdown.
//   - a cabin reading: an hour of rows at that value in her room (so NASA's
//     1-hour average is that value), and a fact for her card signs, high or low
//     by the first word of `compared`, against "nasa_limit".
//   - SpO2: the value read twice, SPO2_REPEAT_MIN_MS apart (her rule needs the
//     next reading; the case states a steady value).
//   - a reading against "this person's normal/baseline": a synthesised baseline
//     that makes exactly that statement true: the usual is the number the case
//     gives ("baseline of 60", "about 52 bpm"), or the value itself for
//     "within", or the value x 0.75 for "above" and x 1.25 for "below/shorter"
//     when it gives none; 40 earlier readings at the usual +-1, so the spread
//     never decides, her rule and the statistics' 3 do. "During exercise":
//     the same, in the exercise state, with the value as that state's usual
//     ("back to her normal" is stated).
//   - other readings (heart rate "below 40"): a fact against a reference value.
//   - blood: one result row at the case's value in her unit; "fasting" from her
//     answer to "Are you fasting?". The last of several values is the latest.
//   - "Did it get better?" answers: the check-in answer the hub understands.
//   - an answer to one of her blood symptom questions (blood.json
//     symptom_questions, when her export carries them, matched by its English
//     text): the check-in answer "checkin.<key>".
//   - heart rate given against a reference value ("below 40"): also a reading
//     row now, for a glucose escalation that names it.
//   - other answers and the English words typed: her card signs, as a question,
//     with her ask-first rule (medical/follow-up.json): a card picked only by a
//     lone-symptom word raises nothing; its first question is the next question.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCards } from '../engine/cards.ts';
import { parseFollowUps, pickWithFollowUp } from '../engine/followup.ts';
import type { FollowUpRow } from '../engine/followup.ts';
import { t } from '../engine/strings.ts';
import type { Card, Facts, ReadingFact } from '../engine/cards.ts';
import { parseBloodExport } from '../engine/blood.ts';
import { overLimit } from '../engine/cabin.ts';
import type { RoomAlarm } from '../engine/cabin.ts';
import { signalBaseline } from '../engine/baseline.ts';
import { COUNTDOWN_MS, alertFor, stepAlerts } from '../engine/alerts.ts';
import type { Alert, AlertInputs, Finding, Unusual } from '../engine/alerts.ts';
import {
  FASTING_QUESTION, FASTING_SIGNAL, FOLLOW_UP_QUESTION, FOLLOW_UP_SIGNAL, SPO2_REPEAT_MIN_MS, cardFinding, crisisFinding, findingsNow, parseLevelOverrides, symptomSignal,
} from '../engine/medical.ts';
import type { LevelOverride } from '../engine/medical.ts';
import { FIXED_TEXTS, phraseProblems, screenInput } from '../engine/prompt.ts';
import type { Person, Row } from '../engine/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const hub = join(here, '..');

type LevelName = 'unusual' | 'concerning' | 'dangerous';
type Notify = 'self' | 'medical_officer' | 'everyone';

export interface Case {
  id: string;
  title: { en: string; pt: string } | string;
  story: { en: string; pt: string };
  readings: { signal: string; value: number | null; unit: string; compared: string }[];
  answers: { question: string; answer: string }[];
  said: { en: string; pt: string };
  expected: { flag: boolean; level: LevelName | null; notify: Notify | null; card: string | null; next_question: string; must_not: string[] };
  why: string;
}

export interface Got {
  flag: boolean;
  level: LevelName | null;
  notify: Notify | null;
  card: string | null;
  alsoCard: string | null;
  nextQuestion: string;
}

export type Check = 'pass' | 'fail' | 'not checkable';

export interface CaseResult {
  id: string;
  title: string;
  expected: Case['expected'];
  got: Got;
  checks: { flag: Check; level: Check; notify: Check; card: Check; next_question: Check };
  mustNot: { item: string; result: Check; note: string }[];
  passed: boolean;
  /** How the inputs were expressed, where it took a choice. */
  expressed: string[];
}

const PERSON = 'reyes';
const ROOM = 'quarters-2';
const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const MIN = 60_000;
const LEVEL_NAME: Record<number, LevelName> = { 1: 'unusual', 2: 'concerning', 3: 'dangerous' };
/** The hub's fixed questions: the only next questions it can be checked on. */
const FIXED_QUESTIONS = (cards: Card[], entries: ReturnType<typeof parseBloodExport>['entries'] = []) => new Set([
  FASTING_QUESTION, FOLLOW_UP_QUESTION, cards.find((c) => c.id === 'low-oxygen')?.signs.answers[0]?.question ?? '',
  // Her blood symptom questions, once her export carries them as fields.
  ...entries.flatMap((e) => (e.symptom_questions ?? []).map((q) => q.question.en)),
]);

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function shipCrew(): Person[] {
  const mission = loadJson(join(hub, 'profiles', 'missions', 'ship-mars-orbit.json')) as { crew: Person[]; gravity: number };
  return mission.crew.map((p) => ({ id: p.id, name: p.name, role: p.role }));
}

function shipGravity(): number {
  return (loadJson(join(hub, 'profiles', 'missions', 'ship-mars-orbit.json')) as { gravity: number }).gravity;
}

function direction(compared: string): 'high' | 'low' | 'changed' {
  const c = compared.toLowerCase().trim();
  if (/^(far )?above|^more than|^\d+(\.\d+)?%? (bpm )?above/.test(c)) return 'high';
  if (/^below|^shorter|^fast drop/.test(c)) return 'low';
  return 'changed';
}

const isPersonal = (compared: string) => /this person'?s|her (normal|baseline)|her own|baseline/.test(compared.toLowerCase());

/** The usual a "compared" text states, or the one that makes it true. */
function usualFor(value: number, compared: string): { usual: number; how: string } {
  const c = compared.toLowerCase();
  const stated = /baseline of (about )?(\d+(\.\d+)?)|about (\d+(\.\d+)?) bpm/.exec(c);
  if (stated) return { usual: Number(stated[2] ?? stated[4]), how: 'the usual the case states' };
  if (/^within|back to her normal|^normal/.test(c)) return { usual: value, how: 'the value as the usual ("within")' };
  if (/above|more than/.test(c)) return { usual: value * 0.75, how: 'usual = value x 0.75 ("above", no number given)' };
  return { usual: value * 1.25, how: 'usual = value x 1.25 ("below", no number given)' };
}

function personRows(signal: string, value: number, unit: string, usual: number, state: 'rest' | 'exercise', daily: boolean): Row[] {
  const rows: Row[] = [];
  const room = state === 'exercise' ? 'gym' : ROOM;
  const base = { signal, unit, kind: 'measured' as const, source: 'case', person: PERSON, room };
  if (daily) {
    for (let d = 5; d >= 1; d--) rows.push({ ...base, t: NOW - d * 24 * 60 * MIN, value: usual + ((d % 3) - 1) * 0.1 });
    rows.push({ ...base, t: NOW - MIN, value });
    return rows;
  }
  for (let i = 0; i < 40; i++) rows.push({ ...base, t: NOW - 2 * 24 * 60 * MIN + i * 10 * MIN, value: usual + (i % 3) - 1 });
  for (const m of [50, 30, 10]) rows.push({ ...base, t: NOW - m * MIN, value });
  return rows;
}

const DAILY = new Set(['sleep_duration', 'exercise_minutes', 'stress', 'mood', 'conflict', 'time_alone']);
const CABIN: Record<string, string> = { cabin_co2: 'co2', cabin_pressure: 'pressure', cabin_temperature: 'temperature', cabin_humidity: 'humidity', cabin_oxygen: 'oxygen' };

function textOf(c: Case): string {
  return typeof c.title === 'string' ? c.title : c.title.en;
}

/** Builds one case's situation and runs it through the engine. */
export function runCase(c: Case, cards: Card[], entries: ReturnType<typeof parseBloodExport>['entries'], crew: Person[], opts: { asleep?: boolean; overrides?: LevelOverride[]; followUps?: FollowUpRow[] } = {}): { got: Got; alerts: Alert[]; expressed: string[]; shownTexts: string[] } {
  const expressed: string[] = [];
  const story = `${textOf(c)} ${c.story.en}`.toLowerCase();
  let gravity = shipGravity();
  if (/gravity (is )?on\b/.test(story)) { gravity = 1; expressed.push('gravity on: 1 g'); }
  if (/gravity (is )?off\b/.test(story)) { gravity = 0; expressed.push('gravity off: 0 g'); }
  const asleep = opts.asleep ?? /\basleep\b/.test(story);
  if (asleep && opts.asleep === undefined) expressed.push('asleep');
  const noAnswer = /does not (wake|answer|respond)|not waking|doesn'?t wake/.test(story);

  const roomRows: Row[] = [];
  const bodyRows: Row[] = [];
  const bloodRows: Row[] = [];
  const unusual: Unusual[] = [];
  const facts: ReadingFact[] = [];

  for (const r of c.readings ?? []) {
    const dir = direction(r.compared);
    if (CABIN[r.signal]) {
      if (r.value !== null) for (let m = 60; m >= 0; m--) roomRows.push({ t: NOW - m * MIN, signal: CABIN[r.signal], value: r.value, unit: r.unit, kind: 'measured', source: 'case', room: ROOM });
      const fact: ReadingFact = { signal: r.signal, direction: dir === 'changed' ? 'high' : dir, basis: 'nasa_limit' };
      if (r.value !== null) { fact.value = r.value; fact.unit = r.unit; }
      facts.push(fact);
      continue;
    }
    if (r.signal === 'blood_oxygen' && r.value !== null) {
      bodyRows.push({ t: NOW - SPO2_REPEAT_MIN_MS, signal: r.signal, value: r.value, unit: r.unit, kind: 'measured', source: 'case', person: PERSON });
      bodyRows.push({ t: NOW, signal: r.signal, value: r.value, unit: r.unit, kind: 'measured', source: 'case', person: PERSON });
      facts.push({ signal: r.signal, direction: r.value < 95 ? 'low' : 'high', basis: 'reference_range', value: r.value, unit: r.unit });
      expressed.push(`SpO2 ${r.value} read twice, ${SPO2_REPEAT_MIN_MS / 1000} s apart`);
      continue;
    }
    if (r.signal.startsWith('blood.') && r.value !== null) {
      bloodRows.push({ t: NOW - (c.readings.length - bloodRows.length) * MIN, signal: r.signal, value: r.value, unit: r.unit, kind: 'measured', source: 'case', person: PERSON });
      const entry = entries.find((e) => `blood.${e.id.replace(/-/g, '_')}` === r.signal);
      const low = entry?.flag_below ?? entry?.reference_range.low;
      const high = entry?.flag_above ?? entry?.reference_range.high;
      const side = low != null && r.value < low ? 'low' : high != null && r.value > high ? 'high' : 'changed';
      facts.push({ signal: r.signal, direction: side === 'changed' ? 'high' : side, basis: 'reference_range', value: r.value, unit: r.unit });
      continue;
    }
    if (isPersonal(r.compared) && r.value !== null) {
      const exercise = /during exercise/.test(r.compared.toLowerCase());
      const { usual, how } = exercise ? { usual: r.value, how: 'the value as the exercise usual ("back to her normal")' } : usualFor(r.value, r.compared);
      const rows = personRows(r.signal, r.value, r.unit, usual, exercise ? 'exercise' : 'rest', DAILY.has(r.signal));
      const judged = signalBaseline(rows, r.signal, NOW, { stateOf: (row) => (row.room === 'gym' ? 'exercise' : 'rest') });
      expressed.push(`${r.signal}: ${how}`);
      if (judged.status === 'judged' && judged.unusual && judged.direction) unusual.push({ person: PERSON, signal: r.signal, direction: judged.direction, z: judged.z, kind: 'measured' });
      facts.push({ signal: r.signal, direction: dir === 'changed' ? 'high' : dir, basis: 'personal_normal', value: r.value, unit: r.unit });
      continue;
    }
    if (r.value !== null) facts.push({ signal: r.signal, direction: dir === 'changed' ? 'high' : dir, basis: 'reference_range', value: r.value, unit: r.unit });
    if (r.value !== null && (r.signal === 'heart_rate' || r.signal === 'resting_heart_rate')) bodyRows.push({ t: NOW - MIN, signal: r.signal, value: r.value, unit: r.unit, kind: 'measured', source: 'case', person: PERSON });
  }

  // Her answers: the two the hub understands as check-in answers, the rest for her card signs.
  const checkins: Row[] = [];
  const cardAnswers: Facts['answers'] = [];
  for (const a of c.answers ?? []) {
    const yes = /^yes/i.test(a.answer.trim());
    if (a.question === FASTING_QUESTION) checkins.push({ t: NOW - 2 * MIN, signal: FASTING_SIGNAL, value: yes ? 1 : 0, unit: '', kind: 'reported', source: 'case', person: PERSON });
    else if (a.question === FOLLOW_UP_QUESTION) checkins.push({ t: NOW - MIN, signal: FOLLOW_UP_SIGNAL, value: yes ? 1 : 0, unit: '', kind: 'reported', source: 'case', person: PERSON });
    else if (symptomKey(a.question, entries)) checkins.push({ t: NOW - MIN, signal: symptomSignal(symptomKey(a.question, entries)!), value: yes ? 1 : 0, unit: '', kind: 'reported', source: 'case', person: PERSON });
    else cardAnswers.push({ question: a.question, answer: a.answer.split(':')[0].trim() });
  }
  if ((c.answers ?? []).some((a) => a.answer.includes(':'))) expressed.push('an answer "yes: ..." is given to her signs as "yes"');

  const all = [...bodyRows, ...checkins, ...bloodRows];
  const findings: Finding[] = findingsNow({
    people: [PERSON], now: NOW, cards, entries,
    rowsOf: (person, signal, from) => all.filter((r) => r.person === person && r.signal === signal && r.t >= from && r.t <= NOW),
    latestBlood: latestPerSignal(bloodRows),
  });

  // The question path: the words typed and the answers, through her card signs.
  const said = c.said?.en?.trim() ?? '';
  const shownTexts: string[] = [];
  let followUp = false;
  let askQuestion = '';
  if (said || cardAnswers.length) {
    const screen = said ? screenInput(said) : null;
    if (screen?.route === 'crisis') {
      findings.push(crisisFinding(PERSON));
      shownTexts.push(FIXED_TEXTS['ai.crisisTold']);
    } else {
      const { picked, askFirst } = pickWithFollowUp(cards, { readings: facts.filter((f) => f.basis !== 'personal_normal'), answers: cardAnswers, text: said || undefined }, gravity, opts.followUps ?? []);
      const finding = cardFinding(picked, PERSON, cards, 'reported', opts.overrides ?? []);
      if (finding) findings.push(finding);
      // Only a lone symptom: nothing raised for that card; her first follow-up question is asked.
      if (askFirst?.questions[0]) { askQuestion = t(askFirst.questions[0].stringKey, 'en'); shownTexts.push(askQuestion); expressed.push(`ask first (${askFirst.card}): no level from a lone symptom`); }
      // No card fits: the hub asks later whether it got better, unless she has already answered.
      else if (!finding && said && !checkins.some((r) => r.signal === FOLLOW_UP_SIGNAL)) { followUp = true; shownTexts.push(FOLLOW_UP_QUESTION); }
      if (screen?.route === 'card') shownTexts.push(FIXED_TEXTS['ai.card']);
      if (screen?.route === 'fixed') shownTexts.push(FIXED_TEXTS[screen.key]);
    }
  }

  const roomAlarms: RoomAlarm[] = overLimit(roomRows, ROOM, NOW).map((a) => ({ ...a, since: NOW, acknowledged: false }));
  const inputs = (now: number): AlertInputs => ({
    now, crew, delayToEarthMs: 600_000, roomAlarms, occupants: { [ROOM]: [PERSON] }, unusual,
    asleep: asleep ? [PERSON] : [], findings,
  });
  let alerts = stepAlerts([], inputs(NOW)).alerts;
  if (noAnswer) { alerts = stepAlerts(alerts, inputs(NOW + COUNTDOWN_MS)).alerts; expressed.push('no answer: one more step after the countdown'); }

  for (const a of alerts) if (a.nextQuestion) shownTexts.push(a.nextQuestion);
  // The result: the highest level, and among equals the one with a card, as the person herself receives it.
  const mine = alerts.map((a) => alertFor(a, PERSON));
  const top = [...mine].sort((a, b) => b.level - a.level || Number(!!b.card) - Number(!!a.card))[0];
  const own = top ?? null;
  const notify: Notify | null = !top ? null : top.toldTo === 'everyone' ? 'everyone' : top.toldTo.some((id) => id !== PERSON) ? 'medical_officer' : 'self';
  const got: Got = {
    flag: alerts.length > 0, level: top ? LEVEL_NAME[top.level] : null, notify, card: own?.card ?? null, alsoCard: own?.alsoCard ?? null,
    // The question that comes with the result: the top alert's, else the "no card fits" follow-up.
    nextQuestion: own?.nextQuestion ?? (askQuestion || (followUp ? FOLLOW_UP_QUESTION : '')),
  };
  return { got, alerts, expressed, shownTexts };
}

/** The key of her blood symptom question with this English text, or null. */
function symptomKey(question: string, entries: ReturnType<typeof parseBloodExport>['entries']): string | null {
  for (const e of entries) for (const q of e.symptom_questions ?? []) if (q.question.en === question) return q.key;
  return null;
}

function latestPerSignal(rows: Row[]): Row[] {
  const best = new Map<string, Row>();
  for (const r of rows) { const held = best.get(r.signal); if (!held || r.t > held.t) best.set(r.signal, r); }
  return [...best.values()];
}

function checkMustNot(item: string, c: Case, run: ReturnType<typeof runCase>, cards: Card[], entries: ReturnType<typeof parseBloodExport>['entries'], crew: Person[], overrides: LevelOverride[], followUps: FollowUpRow[]): { result: Check; note: string } {
  const { alerts, got, shownTexts } = run;
  const told = (pred: (a: Alert) => boolean) => alerts.some((a) => !a.held && pred(a));
  const cmo = crew.filter((p) => p.role === 'role.cmo').map((p) => p.id);
  const i = item.toLowerCase();
  const text = shownTexts.join(' ');
  const textNote = 'checked on the hub\'s fixed texts only; the model\'s answer is not checked without the model';
  if (i === 'alert everyone') return { result: told((a) => a.toldTo === 'everyone') ? 'fail' : 'pass', note: '' };
  if (i === 'alert the medical officer') return { result: told((a) => a.toldTo === 'everyone' || a.toldTo.some((id) => cmo.includes(id))) ? 'fail' : 'pass', note: '' };
  if (i === 'alert anyone') return { result: told((a) => a.toldTo === 'everyone' || a.toldTo.length > 0) ? 'fail' : 'pass', note: '' };
  if (i === 'leave her alone') return { result: alerts.some((a) => a.notAlone) ? 'pass' : 'fail', note: 'passes when an alert says she is not left alone' };
  if (i === 'show the co2 card') return { result: alerts.some((a) => a.card === 'high-co2' || a.alsoCard === 'high-co2') ? 'fail' : 'pass', note: '' };
  if (i === 'show a card') return { result: got.card || got.alsoCard ? 'fail' : 'pass', note: '' };
  if (i === 'keep it as unusual') return { result: got.level === 'unusual' ? 'fail' : 'pass', note: '' };
  if (i === 'wait for symptom answers before alerting') {
    if ((c.answers ?? []).length) return { result: 'not checkable', note: 'the case gives answers' };
    return { result: got.flag ? 'pass' : 'fail', note: 'passes when the alert is raised with no answers' };
  }
  if (i === 'send the warning while she sleeps') {
    const sleeping = runCase(c, cards, entries, crew, { asleep: true, overrides, followUps });
    return { result: sleeping.alerts.some((a) => a.level === 1 && a.toldTo !== 'everyone' && a.toldTo.length > 0) ? 'fail' : 'pass', note: 'run again with her asleep: every level 1 is held' };
  }
  if (i === 'show what she wrote to the crew') {
    const words = [c.said?.en, c.said?.pt].filter((w): w is string => !!w);
    const others = crew.filter((p) => p.id !== PERSON).map((p) => p.id);
    const leaks = alerts.some((a) => [...others, 'common'].some((v) => {
      const seen = JSON.stringify(alertFor(a, v));
      const privateCard = alertFor(a, PERSON).private?.card;
      return words.some((w) => seen.includes(w)) || (!!privateCard && seen.includes(privateCard) && !(alertFor(a, v).private?.medicalOfficerSeesCard && (a.medicalTeam ?? []).includes(v)));
    }));
    return { result: leaks ? 'fail' : 'pass', note: 'every alert as each crewmate and the common screen receive it: no words, no private card' };
  }
  if (i.startsWith('reassure')) return { result: phraseProblems(text).unsafe.some((u) => u.startsWith('false comfort')) ? 'fail' : 'pass', note: textNote };
  if (i.startsWith('suggest a diagnosis')) return { result: phraseProblems(text).diagnosis.length ? 'fail' : 'pass', note: textNote };
  if (i === 'say the word sepsis') return { result: /sepsis/i.test(text) ? 'fail' : 'pass', note: textNote };
  return { result: 'not checkable', note: 'about the answer\'s content; needs the model' };
}

/** Her files, as runCases reads them. Each may be swapped, for a test with a small fixture. */
export interface CaseFiles {
  cards?: unknown;
  blood?: unknown;
}

export function runCases(files: CaseFiles = {}): { results: CaseResult[]; passed: number; failed: number } {
  const cases = loadJson(join(here, 'cases.json')) as Case[];
  const cards = parseCards(files.cards ?? loadJson(join(here, 'cards.json'))).cards;
  const entries = parseBloodExport(files.blood ?? loadJson(join(here, 'blood.json'))).entries;
  const crew = shipCrew();
  const levels = parseLevelOverrides(loadJson(join(here, 'level-overrides.json')), cards);
  if (levels.problems.length) throw new Error(levels.problems.join('\n'));
  const overrides = levels.overrides;
  const asks = parseFollowUps(loadJson(join(here, 'follow-up.json')), cards);
  if (asks.problems.length) throw new Error(asks.problems.join('\n'));
  const followUps = asks.rows;
  const fixed = FIXED_QUESTIONS(cards, entries);
  const results: CaseResult[] = cases.map((c) => {
    const run = runCase(c, cards, entries, crew, { overrides, followUps });
    const e = c.expected;
    const g = run.got;
    const cardOk = e.card === null ? g.card === null : g.card === e.card || g.alsoCard === e.card;
    const nqCheckable = fixed.has(e.next_question) || g.nextQuestion !== '' || e.next_question === '';
    const checks = {
      flag: (g.flag === e.flag ? 'pass' : 'fail') as Check,
      level: (g.level === e.level ? 'pass' : 'fail') as Check,
      notify: (g.notify === e.notify ? 'pass' : 'fail') as Check,
      card: (cardOk ? 'pass' : 'fail') as Check,
      next_question: (!nqCheckable ? 'not checkable' : g.nextQuestion === e.next_question ? 'pass' : 'fail') as Check,
    };
    const mustNot = (e.must_not ?? []).map((item) => ({ item, ...checkMustNot(item, c, run, cards, entries, crew, overrides, followUps) }));
    const passed = Object.values(checks).every((x) => x !== 'fail') && mustNot.every((m) => m.result !== 'fail');
    return { id: c.id, title: textOf(c), expected: e, got: g, checks, mustNot, passed, expressed: run.expressed };
  });
  const passed = results.filter((r) => r.passed).length;
  return { results, passed, failed: results.length - passed };
}

// ---------- the results document ----------

/**
 * My reading of why each failing case fails, for the results document only.
 * It never changes a result: runCases() above does not read it. A failing case
 * with no line here is printed as "not read yet".
 */
const PROSE_BLOOD = 'Missing machine-readable field: this entry\'s level per band is only in blood.json `notes`, so the hub raises nothing. The hub now reads a `bands` field (engine/levels.ts); her export does not carry it yet (asked for in PEDIDO-CAMPOS.md).';
const PROSE_LEVEL = 'Missing machine-readable field: the right card is picked, but the level for this situation is only in the card\'s `notes`; the hub uses the card\'s base `level`. The hub now reads a card `situations` field (engine/levels.ts); her export does not carry it yet (asked for in PEDIDO-CAMPOS.md).';
export const WHY: Record<string, string> = {
  'case-002': 'Disagreement between the case and the rules: she does not wake, so the project\'s countdown rule takes the CO2 alert to everyone after 60 s; the case expects "concerning" told to "self", while her README says concerning tells the medical officer.',
  'case-003': 'Disagreement between the case and her cards: at 2.6 mmHg her headache card\'s CO2 sign (above 2.3) matches; her high-co2 card\'s sign is the NASA limit (above 3) and does not.',
  'case-005': PROSE_BLOOD, 'case-006': PROSE_BLOOD, 'case-007': PROSE_BLOOD + ' Her symptom question is also only in the notes (field: `symptom_questions`).', 'case-008': PROSE_BLOOD,
  'case-010': PROSE_BLOOD, 'case-011': PROSE_BLOOD, 'case-012': PROSE_BLOOD, 'case-014': PROSE_BLOOD, 'case-015': PROSE_BLOOD, 'case-016': PROSE_BLOOD,
  'case-017': PROSE_BLOOD, 'case-018': PROSE_BLOOD + ' Her symptom question is also only in the notes (field: `symptom_questions`).', 'case-019': PROSE_BLOOD, 'case-021': PROSE_BLOOD,
  'case-022': PROSE_BLOOD, 'case-023': PROSE_BLOOD, 'case-029': PROSE_BLOOD, 'case-030': PROSE_BLOOD, 'case-032': PROSE_BLOOD, 'case-033': PROSE_BLOOD,
  'case-035': 'Disagreement between the case and her card: the low-oxygen card\'s sign (SpO2 below 95) matches 92, so the card is shown with the unusual level; the case expects no card.',
  'case-048': 'Missing machine-readable field: "low glucose and heart rate below 40 = dangerous" is only in the glucose notes; the hub gives the not-fasting 54-69 band, concerning. The hub now reads glucose `escalations` (engine/levels.ts); not in her export yet.',
  'case-051': 'Missing machine-readable field: the escalation at 250 or more (fast deep breathing, vomiting, drowsiness = dangerous) is only in the glucose notes. The hub now reads glucose `escalations`; not in her export yet.',
  'case-052': 'Hub rule vs case: her variation escalation now gives unusual (as expected), but with no answer to "Are you fasting?" the hub still asks it; the case expects no question.',
  'case-057': 'Card overlap: "headache" is a word of both her high-co2 and headache cards; with one match each the higher base level wins (high-co2, concerning), though the CO2 is normal. Her words, and the engine\'s tie rule (most matches, then level).',
  'case-059': 'Engine rule vs case: a reading against the person\'s own normal alone never picks a card (it raises only the unusual level); the case expects her poor-sleep card.',
  'case-060': 'Engine rule vs case: a reading against the person\'s own normal alone never picks a card; the case expects her chest-pain card. The level and who is told match.',
  'case-064': PROSE_LEVEL, 'case-066': PROSE_LEVEL, 'case-070': PROSE_LEVEL, 'case-071': PROSE_LEVEL,
  'case-072': 'Mixed sign left out by her (changes-fields.md, question 4): "smoke" and "Do you see smoke or smell something strange?" can be mild or dangerous, so no situation holds them; only "fire" and "alarm" are dangerous. The card\'s base level (unusual) applies.',
  'case-073': 'Needs a time condition (changes-fields.md, question 7): "for more than 2 days" is not an answer or a word, so no situation holds "phlegm"; the base level (unusual) applies.',
  'case-076': PROSE_LEVEL, 'case-078': PROSE_LEVEL, 'case-079': PROSE_LEVEL, 'case-080': PROSE_LEVEL,
  'case-084': PROSE_LEVEL, 'case-085': PROSE_LEVEL, 'case-088': PROSE_LEVEL,
  'case-087': 'Mixed question (changes-fields.md, question 10): "Do you have weakness in an arm or leg?" is in her concerning situation; her dangerous line ("sudden numbness or weakness on one side") has no answer or word of its own.',
  'case-068': 'Disagreement between the case and her card words: "red and warm skin" contains her skin-rash word "skin"; her skin-infection word is "red and hot skin", which it does not contain.',
  'case-075': 'Disagreement between the case and her card words: "I broke a tooth" contains her fracture word "broke"; her dental word is "broken tooth".',
  'case-081': 'Missing machine-readable field and an open point: there is no numeric cabin pressure limit (her README, open points), so no room alarm; a reading with no question never raises a card on its own, and her decompression card\'s base level is unusual.',
  'case-086': 'Disagreement between the case and her card words: "suit mark" contains none of her eva-hand-nails words ("spacesuit", "glove", ...), so no card fits.',
  'case-092': 'Engine gap (ambiguous): with no card, the hub always offers "Did it get better?"; it cannot tell a question from a symptom without the model.',
  'case-093': 'Engine gap (ambiguous): with no card, the hub always offers "Did it get better?"; it cannot tell a question from a symptom without the model.',
  'case-096': 'Disagreement between the case and her rule: 15 bpm over 60 is 25 %, above her 20 %, so under the README\'s "20% or 20 bpm" it counts. The case calls it "under 20%".',
};

function cell(v: unknown): string {
  return v === null || v === undefined || v === '' ? '-' : String(v).replace(/\|/g, '/');
}

export function resultsMarkdown(results: CaseResult[]): string {
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);
  const count = (k: keyof CaseResult['checks'], v: Check) => results.filter((r) => r.checks[k] === v).length;
  const mustNot = results.flatMap((r) => r.mustNot);
  const mn = (v: Check) => mustNot.filter((m) => m.result === v).length;
  const L: string[] = [];
  L.push('# The medical lead\'s test cases against the hub engine', '');
  L.push('Written by `npm run cases` (medical/run-cases.ts). Each case is built as inputs to the functions the hub runs (cabin.ts, baseline.ts, medical.ts, cards.ts, alerts.ts); the model is not called. How each case\'s words become inputs is at the top of run-cases.ts.', '');
  L.push('## Totals', '');
  L.push(`- Cases: ${results.length}. **Passed: ${passed.length}. Failed: ${failed.length}.**`);
  L.push('- A case passes when flag, level, who is told and card match, the next question matches where it can be checked, and no checkable "must not" fails.');
  L.push(`- flag: ${count('flag', 'pass')} pass, ${count('flag', 'fail')} fail. level: ${count('level', 'pass')} / ${count('level', 'fail')}. notify: ${count('notify', 'pass')} / ${count('notify', 'fail')}. card: ${count('card', 'pass')} / ${count('card', 'fail')}.`);
  L.push(`- next_question: ${count('next_question', 'pass')} pass, ${count('next_question', 'fail')} fail, ${count('next_question', 'not checkable')} not checkable (the hub has no fixed question for it: its fixed questions are her SpO2 question, "Are you fasting?" and "Did it get better?").`);
  L.push(`- must_not items: ${mustNot.length}: ${mn('pass')} pass, ${mn('fail')} fail, ${mn('not checkable')} not automatically checkable. "Reassure", "suggest a diagnosis" and "say the word sepsis" are checked with the output check\'s rules on the hub\'s fixed texts only; the model\'s own answer is not checked here.`);
  L.push('- Card: the alert carries her urgent card beside any level 3 card, so an expected card passes when it is either one; an expected "no card" needs the alert\'s own card to be empty.', '');
  L.push('## Failing cases', '');
  for (const r of failed) {
    const e = r.expected;
    const g = r.got;
    const bad = (Object.keys(r.checks) as (keyof CaseResult['checks'])[]).filter((k) => r.checks[k] === 'fail');
    const mnBad = r.mustNot.filter((m) => m.result === 'fail').map((m) => m.item);
    L.push(`### ${r.id}: ${r.title}`, '');
    L.push('| | flag | level | notify | card | next question |', '|---|---|---|---|---|---|');
    L.push(`| expected | ${cell(e.flag)} | ${cell(e.level)} | ${cell(e.notify)} | ${cell(e.card)} | ${cell(e.next_question)} |`);
    L.push(`| got | ${cell(g.flag)} | ${cell(g.level)} | ${cell(g.notify)} | ${cell(g.card)}${g.alsoCard ? ` (+ ${g.alsoCard})` : ''} | ${cell(g.nextQuestion)} |`, '');
    L.push(`Fails on: ${[...bad, ...mnBad.map((m) => `must not "${m}"`)].join(', ')}.`);
    L.push(`Why: ${WHY[r.id] ?? 'not read yet.'}`);
    if (r.expressed.length) L.push(`Inputs: ${r.expressed.join('; ')}.`);
    L.push('');
  }
  L.push('## Passing cases', '');
  L.push(passed.map((r) => r.id).join(', '), '');
  return L.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { results, passed, failed } = runCases();
  writeFileSync(join(here, 'CASES-RESULTS.md'), resultsMarkdown(results));
  console.log(`${passed} passed, ${failed} failed of ${results.length}. Written to medical/CASES-RESULTS.md.`);
}
