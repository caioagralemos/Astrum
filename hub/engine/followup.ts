// Ask first, no level from a lone symptom. Pure: no I/O, no model.
//
// The medical lead, 14 Nov 2026: "Não dá para classificarmos o nível sem outras
// informações relacionadas, a duração, a coloração e outros sintomas
// associados, classificamos o quadro do paciente e não um sintoma isolado."
//
// Her heart-circulation card's base level is dangerous (everyone), so typing
// only "pressão alta" or "perna inchada" used to call everyone. Now, when the
// words a person typed pick a card only through her lone-symptom words
// (medical/follow-up.json, "lone_words"), the hub raises nothing for that card:
// it asks her follow-up questions, to that person only, and stores the answers
// as reported check-in rows ("checkin.<key>"). A level comes from the answers
// only through a rule she wrote ("level_rules", each quoting her); with none,
// nothing is raised. Any other sign of the card that matched (an answer, a
// severe word such as "pale" or "cold sweat", a reading) keeps the card's
// level, as before. A card that carries her own "situations" covering the word
// uses those instead (her fields win).

import type { Finding, Level } from './alerts.ts';
import type { Card, Facts, Picked } from './cards.ts';
import { pickCard } from './cards.ts';
import { LEVEL_NAMES, NOTIFY_OF } from './levels.ts';
import type { CardLevel, CardNotify } from './cards.ts';
import { MEDICAL_LEAD, privacyOf } from './medical.ts';
import { hasString, t } from './strings.ts';
import type { Lang } from './strings.ts';

export interface FollowUpQuestion {
  /** The check-in answer is stored as "checkin.<key>". */
  key: string;
  /** Its text, EN and PT, in engine/strings.ts. */
  string_key: string;
  /** yes_no: value 1 yes, 0 no. value: a number or a typed text (a blood pressure reading). */
  kind: 'yes_no' | 'value';
  unit?: string;
  /** Asked only once this earlier question has this answer. */
  only_if?: { key: string; answer: 'yes' | 'no' };
}

/** A rule she wrote that turns answers into a level. Every key must be answered as listed. */
export interface FollowUpRule {
  when: Record<string, 'yes' | 'no'>;
  level: CardLevel;
  notify: CardNotify;
  /** Her sentence. */
  source: string;
}

export interface FollowUpRow {
  id: string;
  card: string;
  /** The card's own words that, alone, ask first. */
  lone_words: string[];
  her_sentence: string;
  /** The date of her answer, YYYY-MM-DD. */
  answered_on: string;
  questions: FollowUpQuestion[];
  level_rules: FollowUpRule[];
}

/** One stored answer: the latest check-in row of its signal. */
export interface Given {
  value: number | null;
  text: string | null;
}

export const FOLLOW_UP_FILE = 'follow-up.json';

/** The check-in signal of one follow-up question. */
export function followUpSignal(key: string): string {
  return `checkin.${key}`;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Reads medical/follow-up.json against her cards. Never throws. A row that
 * does not fit (unknown card, a word the card does not have, a question with
 * no string, a rule that is not hers in shape) is left out and named; without
 * it the card keeps its own level, as before.
 */
export function parseFollowUps(json: unknown, cards: Card[]): { rows: FollowUpRow[]; problems: string[] } {
  const rows: FollowUpRow[] = [];
  const problems: string[] = [];
  if (json == null) return { rows, problems };
  const list = isObj(json) && Array.isArray(json.follow_ups) ? json.follow_ups : null;
  if (!list) return { rows, problems: [`${FOLLOW_UP_FILE} must hold { "follow_ups": [ ... ] }.`] };
  const keys = new Set<string>();
  list.forEach((raw, i) => {
    const where = `${FOLLOW_UP_FILE} row ${i + 1}`;
    if (!isObj(raw)) { problems.push(`${where} is not an object.`); return; }
    const card = cards.find((c) => c.id === raw.card);
    if (!card) { problems.push(`${where}: no approved card "${String(raw.card)}".`); return; }
    const cardWords = [...card.signs.words.en, ...card.signs.words.pt];
    const lone = Array.isArray(raw.lone_words) ? raw.lone_words.filter((w): w is string => typeof w === 'string') : [];
    if (!lone.length || lone.some((w) => !cardWords.includes(w))) { problems.push(`${where}: lone_words must be words of the card "${card.id}", copied exactly.`); return; }
    if (typeof raw.her_sentence !== 'string' || !raw.her_sentence.trim()) { problems.push(`${where}: no sentence of hers.`); return; }
    if (typeof raw.answered_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.answered_on)) { problems.push(`${where}: answered_on must be the date of her answer, YYYY-MM-DD.`); return; }
    const questions: FollowUpQuestion[] = [];
    let bad = false;
    for (const q of Array.isArray(raw.questions) ? raw.questions : []) {
      const key = isObj(q) && typeof q.key === 'string' && /^[a-z0-9_]{1,48}$/.test(q.key) ? q.key : null;
      const sk = isObj(q) && typeof q.string_key === 'string' ? q.string_key : '';
      const kind = isObj(q) && (q.kind === 'yes_no' || q.kind === 'value') ? q.kind : null;
      if (!key || keys.has(key) || !hasString(sk) || !kind) { problems.push(`${where}: a question needs a new key, a string_key in engine/strings.ts and a kind (yes_no or value).`); bad = true; break; }
      const fq: FollowUpQuestion = { key, string_key: sk, kind };
      if (isObj(q) && typeof q.unit === 'string') fq.unit = q.unit;
      if (isObj(q) && isObj(q.only_if)) {
        const earlier = questions.find((x) => x.key === (q.only_if as Record<string, unknown>).key && x.kind === 'yes_no');
        const ans = (q.only_if as Record<string, unknown>).answer;
        if (!earlier || (ans !== 'yes' && ans !== 'no')) { problems.push(`${where}: only_if must name an earlier yes/no question and "yes" or "no".`); bad = true; break; }
        fq.only_if = { key: earlier.key, answer: ans };
      }
      keys.add(key);
      questions.push(fq);
    }
    if (bad) return;
    if (!questions.length) { problems.push(`${where}: no questions.`); return; }
    const rules: FollowUpRule[] = [];
    for (const r of Array.isArray(raw.level_rules) ? raw.level_rules : []) {
      const when = isObj(r) && isObj(r.when) ? r.when : null;
      const okWhen = when && Object.keys(when).length > 0 && Object.entries(when).every(([k, v]) => questions.some((q) => q.key === k && q.kind === 'yes_no') && (v === 'yes' || v === 'no'));
      const level = isObj(r) ? r.level : null;
      const okLevel = LEVEL_NAMES.includes(level as CardLevel) && isObj(r) && r.notify === NOTIFY_OF[level as CardLevel];
      const okSource = isObj(r) && typeof r.source === 'string' && r.source.trim().length > 0;
      if (!okWhen || !okLevel || !okSource) { problems.push(`${where}: a level rule needs "when" (yes/no answers of its questions), level and notify that match, and her sentence as source.`); bad = true; break; }
      rules.push({ when: when as Record<string, 'yes' | 'no'>, level: level as CardLevel, notify: NOTIFY_OF[level as CardLevel], source: (r as Record<string, unknown>).source as string });
    }
    if (bad) return;
    rows.push({ id: String(raw.id ?? `row-${i + 1}`), card: card.id, lone_words: lone, her_sentence: raw.her_sentence, answered_on: raw.answered_on, questions, level_rules: rules });
  });
  return { rows, problems };
}

/**
 * The follow-up rows that apply to this pick, or null when the card's level
 * stands. They apply only when every sign of the card that matched is a lone
 * word of one of the card's rows: no answer, no reading, no other word. A word
 * covered by one of the card's own situations (her fields) never asks first.
 */
export function loneOnly(picked: Picked | null, rows: readonly FollowUpRow[]): FollowUpRow[] | null {
  if (!picked || picked.fallback || !picked.signs) return null;
  const mine = rows.filter((r) => r.card === picked.card.id);
  const s = picked.signs;
  if (!mine.length || s.readings.length || s.answers.length || !s.words.length) return null;
  if (!s.words.every((w) => mine.some((r) => r.lone_words.includes(w)))) return null;
  if (picked.card.situations?.some((sit) => sit.words.some((w) => s.words.includes(w)))) return null;
  return mine.filter((r) => r.lone_words.some((w) => s.words.includes(w)));
}

function answerOf(q: FollowUpQuestion, given: Readonly<Record<string, Given>>): 'yes' | 'no' | 'value' | null {
  const g = given[q.key];
  if (!g) return null;
  if (q.kind === 'value') return g.value !== null || (g.text ?? '').trim() ? 'value' : null;
  return g.value === 1 ? 'yes' : g.value === 0 ? 'no' : null;
}

/** The questions still to ask, in order. A question with only_if waits until its condition is answered, and is skipped when it is not met. */
export function pendingQuestions(rows: readonly FollowUpRow[], given: Readonly<Record<string, Given>>): FollowUpQuestion[] {
  const out: FollowUpQuestion[] = [];
  for (const row of rows) {
    for (const q of row.questions) {
      if (answerOf(q, given)) continue;
      if (q.only_if) {
        const cond = row.questions.find((x) => x.key === q.only_if!.key);
        if (!cond || answerOf(cond, given) !== q.only_if.answer) continue;
      }
      out.push(q);
    }
  }
  return out;
}

/** The highest level of her rules whose answers are all given as written, or null (no rule of hers covers it: nothing is raised). */
export function decideFollowUp(rows: readonly FollowUpRow[], given: Readonly<Record<string, Given>>): FollowUpRule | null {
  const RANK: Record<CardLevel, number> = { unusual: 1, concerning: 2, dangerous: 3 };
  let best: FollowUpRule | null = null;
  for (const row of rows) {
    for (const rule of row.level_rules) {
      const holds = Object.entries(rule.when).every(([k, v]) => {
        const q = row.questions.find((x) => x.key === k);
        return q !== undefined && answerOf(q, given) === v;
      });
      if (holds && (!best || RANK[rule.level] > RANK[best.level])) best = rule;
    }
  }
  return best;
}

export interface AskFirst {
  /** The card whose level waits. */
  card: string;
  /** The follow-up rows asked (medical/follow-up.json ids). */
  rows: string[];
  /** Still to ask, with the check-in signal each answer goes to. */
  questions: { key: string; signal: string; stringKey: string; kind: 'yes_no' | 'value'; unit?: string }[];
  /** A rule of hers that the answers meet, or null: then nothing is raised for the card. */
  rule: FollowUpRule | null;
}

export interface PickedWithFollowUp {
  /** The card whose finding is raised (its own level), or null. */
  picked: Picked | null;
  /** Set when the card her lone words picked waits for answers. */
  askFirst: AskFirst | null;
}

/**
 * pickCard, then her ask-first rule. When the pick is a card picked only by
 * her lone words, that card raises nothing: the pick is made again without it
 * (so "headache and high blood pressure" gives the headache card at its own
 * level, instead of heart-circulation winning the tie by its dangerous base
 * level), and the questions to ask are returned. With no other card, the pick
 * is null.
 */
export function pickWithFollowUp(cards: Card[], rawFacts: Facts, gravity: number | null, rows: readonly FollowUpRow[], given: Readonly<Record<string, Given>> = {}): PickedWithFollowUp {
  const facts = recognised(rawFacts, cards, rows);
  const first = pickCard(cards, facts, gravity);
  const lone = loneOnly(first, rows);
  if (!first || !lone) return { picked: withoutLoneWords(first, rows), askFirst: null };
  const again = pickCard(cards.filter((c) => c.id !== first.card.id), facts, gravity);
  const picked = again && !again.fallback ? again : null;
  const askFirst: AskFirst = {
    card: first.card.id,
    rows: lone.map((r) => r.id),
    questions: pendingQuestions(lone, given).map((q) => {
      const out: AskFirst['questions'][number] = { key: q.key, signal: followUpSignal(q.key), stringKey: q.string_key, kind: q.kind };
      if (q.unit) out.unit = q.unit;
      return out;
    }),
    rule: decideFollowUp(lone, given),
  };
  return { picked, askFirst };
}

/**
 * Recognition only: the ways people actually say her lone words and her
 * combined answer, on the lower-case, accent-free text (as cards.ts matches).
 * "My leg is getting swollen" is her "swollen leg"; "acho que minha pressão
 * está alta" is her "pressão alta". No word, level or card of hers changes:
 * a phrase found here adds her own word (or her own answer) to what was
 * typed, and her rules decide as before. Each applies only while her data
 * still has that word as a lone word (or that question as an answer sign).
 */
const LEG = String.raw`\b(legs?|arms?|calf|calves|ankles?|feet|foot|pernas?|bra[cç]os?|panturrilhas?|tornozelos?|p[eé]s?)\b`;
const SWOLLEN = String.raw`\b(swollen|swelling|swell|swells|swelled|puffy|inchad[oa]s?|inchando|inchou|incha|inchaco)\b`;
const BP = String.raw`\b(blood pressure|bp|pressao( arterial)?)\b`;
const HIGH = String.raw`\b(high|higher|up|raised|elevated|alta|elevada|subiu|subindo)\b`;
const near = (a: string, b: string, gap = 40) => new RegExp(`${a}[^.!?;]{0,${gap}}${b}|${b}[^.!?;]{0,${gap}}${a}`);
const LONE_PHRASES: Record<string, RegExp> = {
  'swollen leg': near(LEG, SWOLLEN),
  'perna inchada': near(LEG, SWOLLEN),
  'high blood pressure': near(BP, HIGH),
  'pressão alta': near(BP, HIGH),
};
/** Her combined answer, said in one message: the limb, swollen, warm and painful together. */
const ANSWER_PHRASES: Record<string, (text: string) => boolean> = {
  'Is one leg or arm swollen, warm and painful?': (s) => near(LEG, SWOLLEN).test(s)
    && /\b(warm|hot|heat|quente|calor|esquentando)\b/.test(s)
    && /\b(pain\w*|hurts?|hurting|sore|tender|dor|dores|dolorid[oa]s?|doendo|doi)\b/.test(s),
};

function plainText(s: string): string {
  return ` ${s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.!?;]+/g, ' ').trim()} `;
}

/** The facts with her lone words and her combined answer added where the typed text says them in other words. */
export function recognised(facts: Facts, cards: readonly Card[], rows: readonly FollowUpRow[]): Facts {
  if (!facts.text) return facts;
  const s = plainText(facts.text);
  // Per row of hers: nothing to add when one of its own words is already there as typed; else its first word said in other words.
  const typed = (w: string) => s.replace(/[.!?;]/g, ' ').replace(/ +/g, ' ').includes(` ${plainText(w).replace(/[.!?;]/g, '').trim()} `);
  const words = rows.filter((r) => !r.lone_words.some(typed))
    .map((r) => r.lone_words.find((w) => LONE_PHRASES[w]?.test(s)))
    .filter((w): w is string => !!w);
  const signs = cards.flatMap((c) => c.signs.answers);
  const answers = Object.entries(ANSWER_PHRASES)
    .filter(([q, test]) => signs.some((a) => a.question === q && a.answer === 'yes') && test(s)
      && !facts.answers.some((a) => a.question === q))
    .map(([question]) => ({ question, answer: 'yes' }));
  if (!words.length && !answers.length) return facts;
  return { ...facts, text: words.length ? `${facts.text} ${words.join(', ')}` : facts.text, answers: [...facts.answers, ...answers] };
}

/**
 * When other signs of the card matched too, her lone words are taken out of
 * the matched signs: by her answer of 14 Nov 2026 a lone symptom sets no level
 * of its own, so it neither raises nor holds the card's level beside a sign
 * that does (her case-077: "swollen leg" typed with "Is one leg or arm
 * swollen, warm and painful? yes" is that answer's situation, concerning).
 */
function withoutLoneWords(picked: Picked | null, rows: readonly FollowUpRow[]): Picked | null {
  if (!picked?.signs || picked.fallback) return picked;
  const lone = new Set(rows.filter((r) => r.card === picked.card.id).flatMap((r) => r.lone_words));
  const words = picked.signs.words.filter((w) => !lone.has(w));
  if (words.length === picked.signs.words.length) return picked;
  if (!words.length && !picked.signs.answers.length && !picked.signs.readings.length) return picked;
  return { ...picked, signs: { ...picked.signs, words } };
}

/** The level a rule of hers gives, as the hub's number. */
export function ruleLevel(rule: FollowUpRule): Level {
  return ({ unusual: 1, concerning: 2, dangerous: 3 } as const)[rule.level];
}

/** The card's finding when a rule of hers holds for the answers; null otherwise (nothing is raised). */
export function askFirstFinding(a: AskFirst | null, person: string): Finding | null {
  if (!a?.rule) return null;
  return {
    key: `card:${a.card}`, person, level: ruleLevel(a.rule), signal: null, value: null, unit: null, limit: null, limitSource: MEDICAL_LEAD,
    direction: null, kind: 'reported', card: a.card, private: privacyOf(a.card), nextQuestion: null,
  };
}

/**
 * The one follow-up question waiting for a person, as their own screen receives it
 * (engine/privacy.ts followUpFor: no other screen gets it). Her words, EN and PT, from
 * engine/strings.ts; the answer goes to POST /api/checkin under `signal`, 1 yes, 0 no.
 */
export interface FollowUpAsk {
  person: string;
  signal: string;
  kind: 'yes_no' | 'value';
  unit?: string;
  text: { en: string; pt: string };
  /** When the hub started asking (the hub's clock). */
  since: number;
  /** Who started the sequence: 'person' = they typed a symptom to Ask Astra, 'hub' = the hub needs data from them (phone notifies only for 'hub'). */
  origin: 'person' | 'hub';
}

/** The next question still to ask `person` from these rows, or null when none is left. */
export function nextFollowUp(person: string, rows: readonly FollowUpRow[], given: Readonly<Record<string, Given>>, since: number, origin: 'person' | 'hub' = 'person'): FollowUpAsk | null {
  const q = pendingQuestions(rows, given)[0];
  if (!q) return null;
  const out: FollowUpAsk = { person, signal: followUpSignal(q.key), kind: q.kind, text: { en: t(q.string_key, 'en'), pt: t(q.string_key, 'pt') }, since, origin };
  if (q.unit) out.unit = q.unit;
  return out;
}

/** A question's text in one language. */
export function questionText(stringKey: string, lang: Lang): string {
  return t(stringKey, lang);
}

/** The latest answer per follow-up key from check-in rows (any order). */
export function givenFrom(rows: readonly { signal: string; value: number | null; text?: string | null; t: number }[]): Record<string, Given> {
  const out: Record<string, Given & { t: number }> = {};
  for (const r of rows) {
    if (!r.signal.startsWith('checkin.')) continue;
    const key = r.signal.slice('checkin.'.length);
    if (!out[key] || r.t > out[key].t) out[key] = { value: r.value, text: r.text ?? null, t: r.t };
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { value: v.value, text: v.text }]));
}
