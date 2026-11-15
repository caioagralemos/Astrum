// The medical lead's rules for warning levels, as the hub runs them. Pure: no
// I/O, no model. Source: hub/medical/README.md, "Rules she decided that change
// how the system works", and her own files (cards.json, blood.json), including
// her level fields when her export carries them (engine/levels.ts: a card's
// "situations", a blood entry's "bands", "symptom_questions", "escalations").
//
// Every number here is hers. Where her files carry it (a card's sign
// threshold, a blood entry's flag or urgent field) it is read from the file at
// run time; where only her README states it, it is a named constant below with
// limitSource 'medical_lead'. Nothing here reads her prose notes: a rule that
// exists only in a card's notes is not run (see medical/CASES-RESULTS.md),
// except the rows copied into medical/level-overrides.json, each quoting her.
//
// Her three levels map to the hub's:
//   unusual    = level 1: only the person, never while they sleep
//   concerning = level 2: the Crew Medical Officer is told; the person is not left alone
//   dangerous  = level 3: everyone, and the urgent card is shown with any other

import type { Level, Finding } from './alerts.ts';
import type { BloodEntry } from './blood.ts';
import { bloodSignal } from './blood.ts';
import type { AnswerSign, Card, CardLevel, CardNotify, Facts, Picked } from './cards.ts';
import { NO_CARD_FITS, pickCard } from './cards.ts';
import { GLUCOSE_ID, NOTIFY_OF, bandOf, coefficientOfVariation, higher, inBound } from './levels.ts';
import type { Band, SymptomQuestion } from './levels.ts';
import type { Kind, Row } from './types.ts';

/** Where every limit in this file comes from. */
export const MEDICAL_LEAD = 'medical_lead';

export const LEVEL_OF: Record<CardLevel, Level> = { unusual: 1, concerning: 2, dangerous: 3 };

/** The urgent card (her xABCDE), shown at level 3 beside any other card. */
export const URGENT_CARD = NO_CARD_FITS;

// ---------- heart rate ----------

/**
 * README: "Heart rate: counts only above 20% or 20 bpm over her own baseline
 * (10 to 15 bpm does not count)." Read as written: a rise counts when it is
 * more than 20 % of the person's usual OR more than 20 bpm, whichever is
 * reached first. It is a condition on top of the baseline's own statistics:
 * both must hold. (Her case-096 says 15 bpm over 60 is "under 20%"; it is 25 %,
 * so under this reading that case is flagged. See CASES-RESULTS.md.)
 */
export const HR_RISE_PERCENT = 20;
export const HR_RISE_BPM = 20;
export const HEART_RATE_SIGNALS = ['heart_rate', 'resting_heart_rate'];

/** True when a heart rate rise over the person's usual counts by her rule. Falls never pass through here. */
export function heartRateRiseCounts(usual: number, recent: number): boolean {
  const rise = recent - usual;
  return rise > (usual * HR_RISE_PERCENT) / 100 || rise > HR_RISE_BPM;
}

// ---------- blood oxygen ----------

/**
 * README: "SpO2: 95 or more normal; 90 to 94 unusual (ask about shortness of
 * breath); below 90 concerning; below 85 dangerous." The 95 is also her
 * low-oxygen card's sign threshold, and is read from that card; 90 and 85 are
 * only in the README (and the card's notes).
 */
export const SPO2_CARD = 'low-oxygen';
export const SPO2_CONCERNING_BELOW = 90;
export const SPO2_DANGEROUS_BELOW = 85;
/**
 * README: "A low watch reading should alert only after it repeats on the next
 * reading (you set the time)." The owner's to decide; until then: the next
 * reading, at least this long after the first.
 */
export const SPO2_REPEAT_MIN_MS = 60_000;
/** Readings older than this are not looked at. The owner's to decide; listed as an open point. */
export const SPO2_LOOKBACK_MS = 60 * 60_000;

/** Her normal SpO2 floor: the low-oxygen card's blood_oxygen sign threshold. Null without that card. */
export function spo2Normal(cards: Card[]): number | null {
  const card = cards.find((c) => c.id === SPO2_CARD);
  const sign = card?.signs.readings.find((r) => r.signal === 'blood_oxygen' && r.direction === 'low' && r.threshold !== null);
  return sign?.threshold ?? null;
}

/** The level of one SpO2 value by her table, or null when it is normal or her floor is unknown. */
export function spo2Level(value: number, normal: number | null): Level | null {
  if (normal === null || !Number.isFinite(value) || value >= normal) return null;
  if (value < SPO2_DANGEROUS_BELOW) return 3;
  if (value < SPO2_CONCERNING_BELOW) return 2;
  return 1;
}

/**
 * One person's SpO2 finding from their readings, or null. The latest reading
 * must be low, and so must every reading back to one at least
 * SPO2_REPEAT_MIN_MS earlier: a single low reading never alerts. The level is
 * the lowest the confirming readings agree on.
 */
export function spo2Finding(rows: Row[], person: string, now: number, cards: Card[]): Finding | null {
  const normal = spo2Normal(cards);
  const mine = rows.filter((r) => r.person === person && r.signal === 'blood_oxygen' && r.value !== null && r.t <= now && r.t > now - SPO2_LOOKBACK_MS)
    .sort((a, b) => a.t - b.t);
  const last = mine[mine.length - 1];
  if (!last) return null;
  const firstIndex = mine.findLastIndex((r) => r.t <= last.t - SPO2_REPEAT_MIN_MS);
  if (firstIndex < 0) return null;
  const span = mine.slice(firstIndex);
  const levels = span.map((r) => spo2Level(r.value!, normal));
  if (levels.some((l) => l === null)) return null;
  const level = Math.min(...(levels as Level[])) as Level;
  const facts: Facts = { readings: [{ signal: 'blood_oxygen', direction: 'low', basis: 'reference_range', value: last.value!, unit: last.unit }], answers: [] };
  const picked = pickCard(cards, facts);
  const card = picked && !picked.fallback ? picked.card : null;
  const limit = level === 3 ? SPO2_DANGEROUS_BELOW : level === 2 ? SPO2_CONCERNING_BELOW : normal;
  return {
    key: 'blood_oxygen', person, level, signal: 'blood_oxygen', value: last.value, unit: last.unit, limit, limitSource: MEDICAL_LEAD,
    direction: 'low', kind: weakest(span.map((r) => r.kind)), card: card?.id ?? null, private: privacyOf(card?.id ?? null),
    // Her README: at 90 to 94 the system asks about shortness of breath. The question is her card's own.
    nextQuestion: level === 1 ? cards.find((c) => c.id === SPO2_CARD)?.signs.answers[0]?.question ?? null : null,
  };
}

// ---------- blood tests ----------

/** README: "Hemoglobin has no alerts of its own; it follows the hematocrit." */
export const NO_ALERTS_OF_ITS_OWN = ['hemoglobin'];

/** README: "Below 60 (fasting or not) she is not left alone." Only in the README. */
export const GLUCOSE_NOT_ALONE_BELOW = 60;
/** README: "not fasting uses the cut-offs 54, 70, 140 and 250". 54, 70 and 250 are blood.json's urgent_below, flag_below and urgent_above; 140 is only in the README. */
export const GLUCOSE_NOT_FASTING_HIGH = 140;
/** The fasting question, in her words (cases.json, case-039). */
export const FASTING_QUESTION = 'Are you fasting?';

/** What the hub knows beside a blood result, for her level fields. Each part optional. */
export interface BloodContext {
  /** Her symptom questions answered, by key: true yes, false no. Unanswered keys are absent. */
  answers?: Record<string, boolean>;
  /** The person's latest reading of a body signal, for an escalation that names it. */
  reading?: (signal: string) => { value: number; unit: string } | null;
  /** The same entry's recent results (this one included), oldest first, for the variation escalation. */
  history?: number[];
}

export interface BloodJudged {
  level: Level;
  limit: number | null;
  /** Her symptom question still to ask for this result, or null. */
  ask: SymptomQuestion | null;
}

/**
 * The level of one blood result by her rules, or null when it raises nothing.
 * Hemoglobin never does. With her level fields (engine/levels.ts):
 *   - an entry with "bands" takes the band that holds the value (no band: no
 *     alert); each of the band's symptom questions answered yes raises it to
 *     that question's level; the first unanswered one is asked;
 *   - glucose keeps the rules below, and each of its "escalations" whose
 *     condition holds raises it to that escalation's level.
 * Without the fields: glucose and pH by her README; sodium, potassium, ionized
 * calcium and hematocrit raise nothing (their levels were only in prose).
 *
 * `fasting` is the person's answer to her fasting question; null when not
 * answered. Unanswered, the result takes the higher of the two tables'
 * levels (both hers), and the finding asks the question.
 */
export function bloodLevel(entry: BloodEntry, value: number, fasting: boolean | null, ctx: BloodContext = {}): BloodJudged | null {
  if (!Number.isFinite(value) || NO_ALERTS_OF_ITS_OWN.includes(entry.id)) return null;
  if (entry.bands) return bandLevel(entry, entry.bands, value, ctx);
  const base = entry.id === 'ph' ? phLevel(entry, value) : entry.id === GLUCOSE_ID ? glucoseBoth(entry, value, fasting) : null;
  if (entry.id !== GLUCOSE_ID || !entry.escalations) return base ? { ...base, ask: null } : null;
  return escalate(entry, value, base, ctx);
}

function glucoseBoth(entry: BloodEntry, value: number, fasting: boolean | null): { level: Level; limit: number | null } | null {
  if (fasting !== null) return glucoseLevel(entry, value, fasting);
  const a = glucoseLevel(entry, value, true);
  const b = glucoseLevel(entry, value, false);
  if (!a) return b;
  if (!b) return a;
  return a.level >= b.level ? a : b;
}

const LEVEL_NAME: Record<Level, CardLevel> = { 1: 'unusual', 2: 'concerning', 3: 'dangerous' };

/**
 * Her symptom questions named by `keys`: the highest level of those answered
 * yes, and the band's question that goes with the result: the first one not
 * answered yes. Her case-007 (sodium 132, answered no) still expects its
 * question with the result; her case-008 (answered yes) expects none.
 */
function symptomAnswers(entry: BloodEntry, keys: readonly string[], ctx: BloodContext): { level: CardLevel | null; ask: SymptomQuestion | null } {
  let level: CardLevel | null = null;
  let ask: SymptomQuestion | null = null;
  for (const key of keys) {
    const q = entry.symptom_questions?.find((x) => x.key === key);
    if (!q) continue;
    if (ctx.answers?.[key] === true) level = higher(level, q.if_yes.level);
    else if (!ask) ask = q;
  }
  return { level, ask: level ? null : ask };
}

/** The edge of a band nearest her normal range, for the alert's limit and direction. */
function bandLimit(entry: BloodEntry, band: Band): number | null {
  const low = entry.reference_range.low;
  if (band.to !== null && (band.from === null || (low !== null && band.to <= low))) return band.to;
  return band.from;
}

function bandLevel(entry: BloodEntry, bands: Band[], value: number, ctx: BloodContext): BloodJudged | null {
  const band = bandOf(bands, value);
  if (!band) return null;
  const sym = symptomAnswers(entry, band.ask ?? [], ctx);
  const level = higher(band.level, sym.level)!;
  return { level: LEVEL_OF[level], limit: bandLimit(entry, band), ask: sym.ask };
}

/**
 * Glucose: her escalations on top of the fasting rules. Each holds only inside
 * its own range. An escalation's symptom question raises the level when
 * answered yes, but is not put to the person as the next question: her
 * case-050 (270, not fasting, no symptom answer) expects no question.
 */
function escalate(entry: BloodEntry, value: number, base: { level: Level; limit: number | null } | null, ctx: BloodContext): BloodJudged | null {
  let level: CardLevel | null = base ? LEVEL_NAME[base.level] : null;
  for (const e of entry.escalations ?? []) {
    if (e.variation) {
      const values = ctx.history ?? [];
      const cv = values.length >= e.variation.min_results ? coefficientOfVariation(values) : null;
      if (cv !== null && cv > e.variation.above_percent) level = higher(level, e.level);
      continue;
    }
    if (!inBound(e, value)) continue;
    if (e.ask) {
      if (symptomAnswers(entry, e.ask, ctx).level) level = higher(level, e.level);
    } else if (e.reading) {
      const r = ctx.reading?.(e.reading.signal) ?? null;
      if (!r || r.unit.toLowerCase() !== e.reading.unit.toLowerCase()) continue;
      if ((e.reading.below !== undefined && r.value < e.reading.below) || (e.reading.above !== undefined && r.value > e.reading.above)) level = higher(level, e.level);
    }
  }
  if (!level) return null;
  return { level: LEVEL_OF[level], limit: base?.limit ?? null, ask: null };
}

/**
 * README: "pH: ... unusual outside, 7.60 or more dangerous." The normal range is
 * read from blood.json (7.31 to 7.41 venous since her second export; it was
 * 7.35 to 7.45). No low dangerous cut-off, on purpose (her case-024).
 */
function phLevel(e: BloodEntry, v: number): { level: Level; limit: number | null } | null {
  if (e.urgent_above != null && v >= e.urgent_above) return { level: 3, limit: e.urgent_above };
  const low = e.flag_below ?? e.reference_range.low;
  const high = e.flag_above ?? e.reference_range.high;
  if (low != null && v < low) return { level: 1, limit: low };
  if (high != null && v > high) return { level: 1, limit: high };
  return null;
}

/**
 * Fasting: blood.json's range ("fasting"; 70 to 105 since her second export) is normal, outside it is
 * unusual, below 60 she is not left alone (README).
 * Not fasting: the README's four cut-offs. The README does not give the level
 * of each band; these are from blood.json's glucose notes, in her words:
 * "<54 = dangerous; 54-69 = concerning; 70-139 = normal; 140-249 = unusual;
 * >=250 = concerning (NOT everyone)".
 * Either way, below her urgent_below (54) is dangerous: the file field has no
 * fasting condition, and the stricter reading is kept until she says otherwise.
 */
function glucoseLevel(e: BloodEntry, v: number, fasting: boolean): { level: Level; limit: number | null } | null {
  if (e.urgent_below != null && v < e.urgent_below) return { level: 3, limit: e.urgent_below };
  if (v < GLUCOSE_NOT_ALONE_BELOW) return { level: 2, limit: GLUCOSE_NOT_ALONE_BELOW };
  const low = e.flag_below ?? e.reference_range.low;
  if (fasting) {
    const high = e.flag_above ?? e.reference_range.high;
    if (low != null && v < low) return { level: 1, limit: low };
    if (high != null && v > high) return { level: 1, limit: high };
    return null;
  }
  if (low != null && v < low) return { level: 2, limit: low };
  if (e.urgent_above != null && v >= e.urgent_above) return { level: 2, limit: e.urgent_above };
  if (v >= GLUCOSE_NOT_FASTING_HIGH) return { level: 1, limit: GLUCOSE_NOT_FASTING_HIGH };
  return null;
}

/** One blood result as a finding, or null. `signal` is the row's (blood.<id> with _ for -). */
export function bloodFinding(entry: BloodEntry, row: Row, fasting: boolean | null, ctx: BloodContext = {}): Finding | null {
  if (row.value === null || row.unit !== entry.unit || !row.person) return null;
  const judged = bloodLevel(entry, row.value, fasting, ctx);
  if (!judged) return null;
  return {
    key: row.signal, person: row.person, level: judged.level, signal: row.signal, value: row.value, unit: row.unit, limit: judged.limit,
    limitSource: MEDICAL_LEAD, direction: judged.limit !== null && row.value < judged.limit ? 'low' : 'high', kind: row.kind, card: null, private: null,
    // Her fasting question first; then her symptom question for this result (English, as her cases write it).
    nextQuestion: entry.id === GLUCOSE_ID && fasting === null ? FASTING_QUESTION : judged.ask?.question.en ?? null,
  };
}

// ---------- a card picked by her signs ----------

/**
 * Her privacy rule (README): what a person writes for the mood, psychosis and
 * gynecologic cards is never shown to the crew. By card id. For the
 * gynecologic card her notes say what she writes "is shown only to the medical
 * officer"; for the other two, "only the alert level". So the medical officer
 * (or whoever is told in her place) sees the gynecologic card's name, and for
 * the other two only that the person needs someone. Nobody else ever sees the
 * card, and the hub never carries the person's words in an alert.
 */
export const PRIVATE_CARDS: Record<string, { medicalOfficerSeesCard: boolean }> = {
  'mood-stress': { medicalOfficerSeesCard: false },
  'depression-psychosis': { medicalOfficerSeesCard: false },
  gynecologic: { medicalOfficerSeesCard: true },
};

export function privacyOf(cardId: string | null): { card: string; medicalOfficerSeesCard: boolean } | null {
  if (!cardId || !PRIVATE_CARDS[cardId]) return null;
  return { card: cardId, medicalOfficerSeesCard: PRIVATE_CARDS[cardId].medicalOfficerSeesCard };
}

// ---------- a card's level for the situation (medical/level-overrides.json) ----------

/**
 * One row of medical/level-overrides.json: on this card, when this answer of
 * hers was given, the situation is the one her notes list gives this level.
 * Each row quotes her sentence; none adds a level she did not write. Her
 * warning (changes-after-check.md, 14 Nov): the notes list "must still decide
 * the real level" of a card whose base level is dangerous.
 */
export interface LevelOverride {
  card: string;
  /** One of the card's own answer signs, exactly as the card writes it. */
  answer: AnswerSign;
  /** The card's own words that name the same situation, so typing them beside the answer keeps this row. */
  with_words: string[];
  level: CardLevel;
  notify: CardNotify;
  /** Her sentence, quoted. */
  source: string;
  status: string;
}


/**
 * Reads level-overrides.json against her cards. Never throws. A row that does
 * not fit her card (unknown card, an answer or word the card does not have,
 * who-is-told not matching the level by her README) is left out and named in
 * `problems`; without it the card keeps its own level.
 */
export function parseLevelOverrides(json: unknown, cards: Card[]): { overrides: LevelOverride[]; problems: string[] } {
  const overrides: LevelOverride[] = [];
  const problems: string[] = [];
  const rows = json !== null && typeof json === 'object' && Array.isArray((json as { overrides?: unknown }).overrides) ? (json as { overrides: unknown[] }).overrides : null;
  if (!rows) return { overrides, problems: json == null ? [] : ['level-overrides.json must hold { "overrides": [ ... ] }.'] };
  rows.forEach((raw, i) => {
    const where = `level-overrides.json row ${i + 1}`;
    const r = (raw ?? {}) as Partial<LevelOverride>;
    const card = cards.find((c) => c.id === r.card);
    if (!card) { problems.push(`${where}: no approved card "${String(r.card)}".`); return; }
    const answer = card.signs.answers.find((a) => a.question === r.answer?.question && a.answer === r.answer?.answer);
    if (!answer) { problems.push(`${where}: "${card.id}" has no answer sign "${r.answer?.question}" = "${r.answer?.answer}".`); return; }
    const words = Array.isArray(r.with_words) ? r.with_words : [];
    const cardWords = [...card.signs.words.en, ...card.signs.words.pt];
    const unknown = words.filter((w) => !cardWords.includes(w));
    if (unknown.length) { problems.push(`${where}: "${card.id}" has no word ${unknown.map((w) => `"${w}"`).join(', ')}.`); return; }
    if (!r.level || !(r.level in LEVEL_OF) || r.notify !== NOTIFY_OF[r.level]) { problems.push(`${where}: level and notify must be unusual/self, concerning/medical_officer or dangerous/everyone.`); return; }
    if (typeof r.source !== 'string' || !r.source.trim()) { problems.push(`${where}: no source sentence.`); return; }
    overrides.push({ card: card.id, answer, with_words: words, level: r.level, notify: r.notify, source: r.source, status: typeof r.status === 'string' ? r.status : '' });
  });
  return { overrides, problems };
}

/**
 * The level of the card her signs picked, and the card she names beside it.
 *
 * A card with "situations" (her fields, engine/levels.ts) uses them, and
 * level-overrides.json is not read for it (her fields win): every situation
 * that one of the matched answers or words belongs to counts; the level is the
 * highest of them, and never below the card's own level while any matched sign
 * (a reading, or an answer or word in no situation) belongs to no situation:
 * nothing is lowered on a guess, and nothing she placed is lowered either.
 *
 * Otherwise the card's own level, unless a row of level-overrides.json names
 * the situation: then the row's level, when every sign of that card that
 * matched is a row's answer or one of its words. Any other sign of the card
 * that matched (a word the table does not place, a reading) keeps the card's
 * own level, so nothing is lowered on a guess. Several rows: the highest of
 * their levels.
 */
export function cardSituation(picked: Picked, overrides: LevelOverride[] = []): { level: Level; alsoCard: string | null } {
  const base = LEVEL_OF[picked.card.level];
  const signs = picked.signs;
  const situations = picked.card.situations;
  if (situations?.length) {
    if (!signs) return { level: base, alsoCard: null };
    const same = (a: AnswerSign, b: AnswerSign) => a.question === b.question && a.answer === b.answer;
    const hit = situations.filter((s) => s.answers.some((a) => signs.answers.some((b) => same(a, b))) || s.words.some((w) => signs.words.includes(w)));
    if (!hit.length) return { level: base, alsoCard: null };
    // A reading that matched belongs to no situation: like any unplaced sign, it keeps the card's own level as the floor.
    const placed = !signs.readings.length && signs.answers.every((a) => hit.some((s) => s.answers.some((b) => same(a, b)))) && signs.words.every((w) => hit.some((s) => s.words.includes(w)));
    const top = hit.reduce((a, b) => (LEVEL_OF[b.level] > LEVEL_OF[a.level] ? b : a));
    const level = Math.max(LEVEL_OF[top.level], placed ? 0 : base) as Level;
    return { level, alsoCard: top.also_card ?? null };
  }
  const rows = overrides.filter((o) => o.card === picked.card.id && signs?.answers.includes(o.answer));
  if (!signs || !rows.length || signs.readings.length) return { level: base, alsoCard: null };
  const placed = (s: { question: string; answer: string } | string) => rows.some((o) => (typeof s === 'string' ? o.with_words.includes(s) : o.answer === s));
  if (!signs.answers.every(placed) || !signs.words.every(placed)) return { level: base, alsoCard: null };
  return { level: Math.max(...rows.map((o) => LEVEL_OF[o.level])) as Level, alsoCard: null };
}

/** The level only (cardSituation). */
export function cardLevel(picked: Picked, overrides: LevelOverride[] = []): Level {
  return cardSituation(picked, overrides).level;
}

/**
 * A card her signs picked, as a finding at the card's level for the situation
 * (cardLevel: her base level, or a row of level-overrides.json). The rest of
 * her notes list is not read by the hub. Her "no card fits" card is never
 * a finding by itself: README, "no card fits" alerts the medical officer only
 * if the person says it did not get better (followUpFinding).
 * When her signs matched only cards for another gravity (cardiac arrest on the
 * Moon or Mars), the finding carries her urgent card at the highest level
 * among the cards that matched: the steps differ by gravity, the danger does not.
 */
export function cardFinding(picked: Picked | null, person: string, cards: Card[] = [], kind: Kind = 'reported', overrides: LevelOverride[] = []): Finding | null {
  if (!picked) return null;
  if (picked.fallback) {
    const matched = cards.filter((c) => picked.otherGravity?.includes(c.id));
    if (!matched.length) return null;
    const level = Math.max(...matched.map((c) => LEVEL_OF[c.level])) as Level;
    return {
      key: `card:${matched.map((c) => c.id).join('+')}`, person, level, signal: null, value: null, unit: null, limit: null, limitSource: MEDICAL_LEAD,
      direction: null, kind, card: URGENT_CARD, private: null, nextQuestion: null,
    };
  }
  const card = picked.card;
  const { level, alsoCard } = cardSituation(picked, overrides);
  const finding: Finding = {
    key: `card:${card.id}`, person, level, signal: null, value: null, unit: null, limit: null, limitSource: MEDICAL_LEAD,
    direction: null, kind, card: card.id, private: privacyOf(card.id), nextQuestion: null,
  };
  if (alsoCard) finding.alsoCard = alsoCard;
  return finding;
}

/** How long an alert raised by a card her signs picked in a question stays, unless the same card is picked again. The owner's to decide. */
export const CARD_FINDING_KEEP_MS = 60 * 60_000;

/**
 * A crisis (prompt.ts CRISIS_WORDS): the hub's existing rule, "<name> needs
 * someone with them", never the words. As a finding: level 2, so the medical
 * officer (or the commander in her place) is told and the person is not left
 * alone, with no card and nothing of what was written.
 */
export function crisisFinding(person: string): Finding {
  return {
    key: 'crisis', person, level: 2, signal: null, value: null, unit: null, limit: null, limitSource: null,
    direction: null, kind: 'reported', card: null, private: { card: null, medicalOfficerSeesCard: false }, nextQuestion: null,
  };
}

// ---------- "no card fits" ----------

/** README: "No card fits: ... alerts the medical officer only if she says it did not get better." The question, in her words (cases.json, case-089). */
export const FOLLOW_UP_QUESTION = 'Did it get better?';
/** The check-in answer the hub understands for it: 1 yes, 0 no. */
export const FOLLOW_UP_SIGNAL = 'checkin.got_better';
/** How long a "no" keeps the medical officer told, unless a later answer says yes. The owner's to decide. */
export const FOLLOW_UP_KEEP_MS = 12 * 3600_000;

/** Level 2 for a person whose latest "Did it get better?" answer is no, within FOLLOW_UP_KEEP_MS. */
export function followUpFinding(rows: Row[], person: string, now: number): Finding | null {
  const latest = rows.filter((r) => r.person === person && r.signal === FOLLOW_UP_SIGNAL && r.value !== null && r.t <= now)
    .sort((a, b) => b.t - a.t)[0];
  if (!latest || latest.value !== 0 || now - latest.t > FOLLOW_UP_KEEP_MS) return null;
  return {
    key: 'not-better', person, level: 2, signal: FOLLOW_UP_SIGNAL, value: 0, unit: null, limit: null, limitSource: MEDICAL_LEAD,
    direction: null, kind: latest.kind, card: null, private: null, nextQuestion: null,
  };
}

const KIND_ORDER: Kind[] = ['simulated', 'replayed', 'reported', 'estimated', 'measured'];
function weakest(kinds: Kind[]): Kind {
  return KIND_ORDER.find((k) => kinds.includes(k)) ?? 'measured';
}

// ---------- everything at once, for the hub ----------

/** A blood result raises its finding for this long after it was taken. The owner's to decide. */
export const BLOOD_FINDING_KEEP_MS = 12 * 3600_000;
/** The check-in answer to her fasting question: 1 yes, 0 no. POST /api/blood stores it with the results. */
export const FASTING_SIGNAL = 'checkin.fasting';
/** A fasting answer counts for a glucose result taken at most this long after it. The owner's to decide. */
export const FASTING_MATCH_MS = 2 * 3600_000;

/** A symptom answer counts for a blood result from this long before it until now. The owner's to decide. */
export const SYMPTOM_MATCH_MS = FASTING_MATCH_MS;
/** A body reading (heart rate) counts for a glucose escalation when it is at most this old. The owner's to decide. */
export const READING_MATCH_MS = 10 * 60_000;
/** The glucose results her variation rule looks at. Her notes say "over the days"; the owner's to decide. */
export const VARIATION_LOOKBACK_MS = 14 * 86_400_000;

/** The check-in signal of one of her symptom questions: "checkin.<key>", 1 yes, 0 no. */
export function symptomSignal(key: string): string {
  return `checkin.${key}`;
}

/** What her level fields need beside one blood result, from the hub's own rows. Empty when the entry has none. */
function bloodContext(src: FindingSources, entry: BloodEntry, row: Row): BloodContext {
  const person = row.person!;
  const ctx: BloodContext = {};
  const keys = entry.symptom_questions?.map((q) => q.key) ?? [];
  if (keys.length) {
    ctx.answers = {};
    for (const key of keys) {
      const latest = src.rowsOf(person, symptomSignal(key), row.t - SYMPTOM_MATCH_MS).filter((r) => r.value !== null && r.t <= src.now).sort((a, b) => b.t - a.t)[0];
      if (latest) ctx.answers[key] = latest.value === 1;
    }
  }
  if (entry.escalations?.some((e) => e.reading)) {
    ctx.reading = (signal) => {
      const r = src.rowsOf(person, signal, src.now - READING_MATCH_MS).filter((x) => x.value !== null && x.t <= src.now).sort((a, b) => b.t - a.t)[0];
      return r ? { value: r.value!, unit: r.unit } : null;
    };
  }
  if (entry.escalations?.some((e) => e.variation)) {
    ctx.history = src.rowsOf(person, row.signal, src.now - VARIATION_LOOKBACK_MS).filter((r) => r.value !== null && r.t <= src.now && r.unit === entry.unit)
      .sort((a, b) => a.t - b.t).map((r) => r.value!);
  }
  return ctx;
}

export interface FindingSources {
  people: string[];
  now: number;
  cards: Card[];
  entries: BloodEntry[];
  /** One person's rows of one signal from `from` to now. */
  rowsOf: (person: string, signal: string, from: number) => Row[];
  /** Each person's newest row of each blood signal. */
  latestBlood: Row[];
}

/** What her rules find now from the hub's own records: SpO2, blood results, "it did not get better". */
export function findingsNow(src: FindingSources): Finding[] {
  const out: Finding[] = [];
  for (const person of src.people) {
    const spo2 = spo2Finding(src.rowsOf(person, 'blood_oxygen', src.now - SPO2_LOOKBACK_MS), person, src.now, src.cards);
    if (spo2) out.push(spo2);
    const notBetter = followUpFinding(src.rowsOf(person, FOLLOW_UP_SIGNAL, src.now - FOLLOW_UP_KEEP_MS), person, src.now);
    if (notBetter) out.push(notBetter);
  }
  for (const row of src.latestBlood) {
    if (!row.person || !src.people.includes(row.person) || row.t > src.now || src.now - row.t > BLOOD_FINDING_KEEP_MS) continue;
    const entry = src.entries.find((e) => bloodSignal(e.id) === row.signal);
    if (!entry) continue;
    const answer = src.rowsOf(row.person, FASTING_SIGNAL, row.t - FASTING_MATCH_MS).filter((r) => r.t <= row.t && r.value !== null).sort((a, b) => b.t - a.t)[0];
    const finding = bloodFinding(entry, row, answer ? answer.value === 1 : null, bloodContext(src, entry, row));
    if (finding) out.push(finding);
  }
  return out;
}
