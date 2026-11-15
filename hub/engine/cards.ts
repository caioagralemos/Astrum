// The steps cards: the medical lead's cards.json, read and checked, and the
// rule that picks one. Pure: no I/O, no model.
//
// The steps on a card are hers. Nothing here writes, edits or chooses a step
// with a model: a card is picked only by the signs she wrote in the file,
// matched against facts the hub already has (which limit is broken, which
// check-in answers were given, which of her words the crewmate typed).
//
// What may be shown:
//   - only cards with "status": "approved". Anything else is listed as
//     "not approved yet" and never shown as instructions;
//   - Portuguese text only when its Portuguese is marked reviewed. She approves
//     in Portuguese, so an approved card's Portuguese counts as reviewed unless
//     the file says "pt_reviewed": false;
//   - English text only when "en_checked" is true. The English is a translation
//     of what she approved, and stays hidden until someone has checked it;
//   - only cards written for the place's gravity. A card may say where it
//     applies ("applies_in": weightless, partial_gravity, earth_gravity); with
//     no such field it applies everywhere. Some steps differ with gravity (she
//     named cardiac arrest), so a card for another gravity is never shown, not
//     even when its signs match: her "no card fits" card is, and the pick says why.

import { parseSituations } from './levels.ts';
import type { Situation } from './levels.ts';

export type CardLevel = 'unusual' | 'concerning' | 'dangerous';
export type CardNotify = 'self' | 'medical_officer' | 'everyone';
export type SignDirection = 'high' | 'low' | 'rising' | 'falling' | 'changed';
export type SignBasis = 'personal_normal' | 'nasa_limit' | 'reference_range';
export type CardLang = 'en' | 'pt';

/** Where a card applies, by the place's gravity (gravityClass). */
export type GravityClass = 'weightless' | 'partial_gravity' | 'earth_gravity';

export const GRAVITY_CLASSES: readonly GravityClass[] = ['weightless', 'partial_gravity', 'earth_gravity'];

/**
 * The place's gravity, in g, as a card's "applies_in" names it: 0 is
 * weightless, above 0 and under 0.9 is partial gravity (the Moon, Mars), and
 * 0.9 or more is Earth's. Null when the gravity is not known.
 */
export function gravityClass(g: number | null | undefined): GravityClass | null {
  if (typeof g !== 'number' || !Number.isFinite(g) || g < 0) return null;
  if (g === 0) return 'weightless';
  return g < 0.9 ? 'partial_gravity' : 'earth_gravity';
}

/**
 * Where her gravity cards apply, until her export carries "applies_in" itself.
 * Her README: "The system picks the gravity cards by whether gravity is on:
 * cardiac-arrest-gravity or cardiac-arrest; choking or choking-no-gravity.
 * Where 'reduced' gravity ends is yours to define." Exactly these four ids, by
 * her titles and notes:
 *   - choking-no-gravity: "sem gravidade ou gravidade reduzida", so weightless
 *     and partial gravity (the Moon, Mars);
 *   - choking: "com gravidade": Earth's gravity only;
 *   - cardiac-arrest: "when it [gravity] is off": weightless only;
 *   - cardiac-arrest-gravity: "when gravity is on": Earth's gravity. She has not
 *     said which cardiac arrest card holds in partial gravity, so neither is
 *     shown there: the pick falls back to her urgent card and names both
 *     (Picked.otherGravity), and the question is with her.
 * A card whose file says "applies_in" keeps hers; this table never overrides it.
 */
export const GRAVITY_TABLE: Readonly<Record<string, readonly GravityClass[]>> = {
  'choking-no-gravity': ['weightless', 'partial_gravity'],
  choking: ['earth_gravity'],
  'cardiac-arrest': ['weightless'],
  'cardiac-arrest-gravity': ['earth_gravity'],
};

/** True when the card may be shown at this gravity. A card with no "applies_in" applies everywhere; one with it needs a known gravity it names. */
export function appliesAt(card: Pick<Card, 'applies_in'>, gravity: number | null | undefined): boolean {
  if (!card.applies_in) return true;
  const here = gravityClass(gravity);
  return here !== null && card.applies_in.includes(here);
}

/** Text in both languages, as her export writes it. */
export interface Both {
  en: string;
  pt: string;
}

export interface ReadingSign {
  signal: string;
  direction: SignDirection;
  basis: SignBasis;
  threshold: number | null;
  unit: string | null;
  note: string;
}

export interface AnswerSign {
  question: string;
  answer: string;
}

export interface CardSource {
  name: string;
  url: string;
  quote: string;
  is_nasa: boolean;
}

/** One card as her file holds it, after checking. */
export interface Card {
  id: string;
  title: Both;
  level: CardLevel;
  notify: CardNotify;
  message_houston: boolean;
  signs: {
    readings: ReadingSign[];
    answers: AnswerSign[];
    words: { en: string[]; pt: string[] };
  };
  steps: Both[];
  do_not: Both[];
  sources: CardSource[];
  unverified: string[];
  status: string;
  en_checked: boolean;
  /** Not in the brief's format; accepted when present. */
  pt_reviewed?: boolean;
  /** Where the card applies, by gravity. Absent: everywhere. */
  applies_in?: GravityClass[];
  /** Set when applies_in came from the hub's GRAVITY_TABLE, not from her file. */
  applies_in_from?: 'hub-table';
  /** Her levels per situation, as fields (engine/levels.ts). Absent: the card's own level, and medical/level-overrides.json. */
  situations?: Situation[];
  notes: string;
}

/** The id she gives the "no card fits" card. */
export const NO_CARD_FITS = 'unknown-urgent';

export interface ParsedCards {
  /** Approved cards, the only ones that may be shown. */
  cards: Card[];
  /** Cards that are in the file but not approved: listed, never shown as steps. */
  notApproved: { id: string; title: Both; status: string }[];
  /** Plain-language problems with the file, for the screen that lists cards. */
  problems: string[];
}

const LEVELS: CardLevel[] = ['unusual', 'concerning', 'dangerous'];
const NOTIFY: CardNotify[] = ['self', 'medical_officer', 'everyone'];
const DIRECTIONS: SignDirection[] = ['high', 'low', 'rising', 'falling', 'changed'];
const BASES: SignBasis[] = ['personal_normal', 'nasa_limit', 'reference_range'];
const SIGNALS = new Set([
  'heart_rate', 'resting_heart_rate', 'hrv', 'respiratory_rate', 'blood_oxygen', 'sleep_duration', 'exercise_minutes',
  'mood', 'fatigue', 'stress', 'conflict', 'time_alone', 'cabin_co2', 'cabin_pressure', 'cabin_temperature',
  'cabin_humidity', 'cabin_noise', 'cabin_light', 'cabin_oxygen', 'radiation',
]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function both(v: unknown): Both {
  return isObj(v) ? { en: str(v.en), pt: str(v.pt) } : { en: '', pt: '' };
}

function words(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : [];
}

/**
 * Reads her export. Never throws: whatever is wrong becomes a sentence in
 * `problems`, and a card with a problem that would make it unsafe to show
 * (no id, no steps, unreadable signs) is left out of `cards`.
 */
export function parseCards(json: unknown): ParsedCards {
  const out: ParsedCards = { cards: [], notApproved: [], problems: [] };
  if (!Array.isArray(json)) {
    out.problems.push('cards.json should be a list of cards, so no card is loaded.');
    return out;
  }
  const seen = new Set<string>();
  const allIds = json.filter(isObj).map((c) => str(c.id)).filter(Boolean);
  json.forEach((raw, i) => {
    const where = `Card ${i + 1}`;
    if (!isObj(raw)) {
      out.problems.push(`${where} is not a card, so it is left out.`);
      return;
    }
    const id = str(raw.id);
    const name = id ? `Card "${id}"` : where;
    if (!id) {
      out.problems.push(`${where} has no id, so it is left out.`);
      return;
    }
    if (seen.has(id)) {
      out.problems.push(`${name} appears twice; only the first one is used.`);
      return;
    }
    seen.add(id);

    // Where it applies. A value the hub does not know could show it at the wrong gravity, so it is a problem.
    const gravityProblems: string[] = [];
    let appliesIn: GravityClass[] | undefined;
    if (raw.applies_in != null) {
      const list = Array.isArray(raw.applies_in) ? raw.applies_in : null;
      const unknown = (list ?? []).filter((v) => !GRAVITY_CLASSES.includes(v as GravityClass));
      if (!list || list.length === 0) gravityProblems.push(`${name}: applies_in must list where it applies (weightless, partial_gravity, earth_gravity), or be left out to apply everywhere.`);
      else if (unknown.length) gravityProblems.push(`${name}: applies_in has unknown values ${unknown.map((v) => `"${String(v)}"`).join(', ')}; use weightless, partial_gravity or earth_gravity.`);
      else appliesIn = GRAVITY_CLASSES.filter((g) => list.includes(g));
    }

    const title = both(raw.title);
    const status = str(raw.status) || 'missing';
    if (status !== 'approved') {
      out.notApproved.push({ id, title, status });
      out.problems.push(...gravityProblems);
      return;
    }

    const cardProblems: string[] = [...gravityProblems];
    const level = LEVELS.includes(raw.level as CardLevel) ? (raw.level as CardLevel) : null;
    if (!level) cardProblems.push(`${name}: level must be unusual, concerning or dangerous.`);
    const notify = NOTIFY.includes(raw.notify as CardNotify) ? (raw.notify as CardNotify) : null;
    if (!notify) cardProblems.push(`${name}: notify must be self, medical_officer or everyone.`);

    const steps = Array.isArray(raw.steps) ? raw.steps.map(both).filter((s) => s.en || s.pt) : [];
    if (steps.length === 0) cardProblems.push(`${name} has no steps.`);

    const signs = isObj(raw.signs) ? raw.signs : {};
    const readings: ReadingSign[] = [];
    for (const [j, r] of (Array.isArray(signs.readings) ? signs.readings : []).entries()) {
      if (!isObj(r)) { cardProblems.push(`${name}: reading sign ${j + 1} is not readable.`); continue; }
      const signal = str(r.signal);
      const direction = r.direction as SignDirection;
      const basis = r.basis as SignBasis;
      if (!SIGNALS.has(signal) && !/^blood\.[a-z0-9_]+$/.test(signal)) cardProblems.push(`${name}: reading sign ${j + 1} names an unknown signal "${signal}".`);
      if (!DIRECTIONS.includes(direction)) cardProblems.push(`${name}: reading sign ${j + 1} has an unknown direction.`);
      if (!BASES.includes(basis)) cardProblems.push(`${name}: reading sign ${j + 1} has an unknown basis.`);
      const threshold = typeof r.threshold === 'number' && Number.isFinite(r.threshold) ? r.threshold : null;
      if (r.threshold != null && threshold === null) cardProblems.push(`${name}: reading sign ${j + 1} has a threshold that is not a number.`);
      const unit = str(r.unit) || null;
      if (threshold !== null && !unit) cardProblems.push(`${name}: reading sign ${j + 1} has a threshold but no unit.`);
      readings.push({ signal, direction, basis, threshold, unit, note: str(r.note) });
    }
    const answers: AnswerSign[] = (Array.isArray(signs.answers) ? signs.answers : [])
      .filter(isObj).map((a) => ({ question: str(a.question), answer: str(a.answer) })).filter((a) => a.question && a.answer);
    const w = isObj(signs.words) ? signs.words : {};

    const sources: CardSource[] = (Array.isArray(raw.sources) ? raw.sources : []).filter(isObj).map((s) => ({
      name: str(s.name), url: str(s.url), quote: str(s.quote), is_nasa: s.is_nasa === true,
    })).filter((s) => s.name || s.url || s.quote);

    // A sign we can't read could pick the wrong card, so the whole card waits.
    if (cardProblems.length) {
      out.problems.push(...cardProblems, `${name} is approved but has the problems above, so it is not shown.`);
      return;
    }

    const card: Card = {
      id, title, level: level!, notify: notify!, message_houston: raw.message_houston === true,
      signs: { readings, answers, words: { en: words(w.en), pt: words(w.pt) } },
      steps, do_not: (Array.isArray(raw.do_not) ? raw.do_not : []).map(both).filter((s) => s.en || s.pt),
      sources, unverified: words(raw.unverified), status, en_checked: raw.en_checked === true, notes: str(raw.notes),
    };
    if (typeof raw.pt_reviewed === 'boolean') card.pt_reviewed = raw.pt_reviewed;
    // Her levels per situation. Malformed: left out and named, so the card keeps its own level.
    const sit = parseSituations(raw.situations, card, allIds);
    out.problems.push(...sit.problems.map((p) => `${p} Its situations are not used.`));
    if (sit.situations) card.situations = sit.situations;
    if (appliesIn) card.applies_in = appliesIn;
    else if (GRAVITY_TABLE[id]) {
      card.applies_in = [...GRAVITY_TABLE[id]];
      card.applies_in_from = 'hub-table';
    }
    if (displayLangs(card).length === 0) out.problems.push(`${name} is approved, but neither its English is checked nor its Portuguese reviewed, so it can't be shown yet.`);
    else if (!card.en_checked) out.problems.push(`${name}: the English is not checked yet, so the card shows in Portuguese only.`);
    if (card.id !== NO_CARD_FITS && readings.length === 0 && answers.length === 0 && !card.signs.words.en.length && !card.signs.words.pt.length) {
      out.problems.push(`${name} has no signs, so the hub can only open it when someone picks it by hand.`);
    }
    out.cards.push(card);
  });
  if (!out.cards.some((c) => c.id === NO_CARD_FITS)) out.problems.push(`There is no approved "${NO_CARD_FITS}" card, so when no card fits, none is shown.`);
  return out;
}

/** The languages this card may be shown in. */
export function displayLangs(card: Card): CardLang[] {
  if (card.status !== 'approved') return [];
  const out: CardLang[] = [];
  const hasEn = card.steps.every((s) => s.en) && !!card.title.en;
  const hasPt = card.steps.every((s) => s.pt) && !!card.title.pt;
  if (card.en_checked && hasEn) out.push('en');
  if (card.pt_reviewed !== false && hasPt) out.push('pt');
  return out;
}

/** What the screen shows: one language, only text that may be shown. Null if the card can't be shown. */
export interface CardView {
  id: string;
  lang: CardLang;
  title: string;
  level: CardLevel;
  notify: CardNotify;
  messageHouston: boolean;
  steps: string[];
  doNot: string[];
  sources: CardSource[];
  /**
   * Her own list of the parts of this card not checked against a source. It does
   * not mean the card is unapproved: every card a screen gets is approved by her
   * (`approvedBy`). A screen says "Approved by the medical lead. Parts not checked
   * against a source: …" when this is not empty.
   */
  unverified: string[];
  /** Who approved the card: always the medical lead, since only approved cards are ever shown. */
  approvedBy: 'medical_lead';
  /** Where the card applies, when she wrote it for one gravity only. */
  appliesIn?: GravityClass[];
  /** 'hub-table' when appliesIn is the hub's reading of her titles (GRAVITY_TABLE), not a field of hers. */
  appliesInFrom?: 'hub-table';
}

export function cardView(card: Card, lang: CardLang): CardView | null {
  const langs = displayLangs(card);
  if (langs.length === 0) return null;
  const l = langs.includes(lang) ? lang : langs[0];
  const view: CardView = {
    id: card.id, lang: l, title: card.title[l], level: card.level, notify: card.notify, messageHouston: card.message_houston,
    steps: card.steps.map((s) => s[l]), doNot: card.do_not.map((s) => s[l]).filter(Boolean),
    sources: card.sources, unverified: card.unverified, approvedBy: 'medical_lead',
  };
  if (card.applies_in) view.appliesIn = card.applies_in;
  if (card.applies_in_from) view.appliesInFrom = card.applies_in_from;
  return view;
}

/** One reading the hub has judged, as a fact a sign can match. */
export interface ReadingFact {
  signal: string;
  direction: SignDirection;
  basis: SignBasis;
  value?: number;
  unit?: string;
}

/** What the hub knows right now about one person, and nothing a model said. */
export interface Facts {
  readings: ReadingFact[];
  /** Check-in questions and the answers given, as the hub asked them. */
  answers: AnswerSign[];
  /** What the crewmate typed, if anything. Matched only against her words. */
  text?: string;
}

/**
 * The check-in signal that carries the answer to one of her card questions
 * (signs.answers[].question): "checkin.q_" and the question's words, joined by
 * "_", cut to fit the timeline's 64 characters, with a short checksum so two
 * long questions never share one. 1 is "yes", 0 is "no". This is how a
 * screen's answer to her question reaches the card picker (core/main.ts facts).
 */
export function answerSignal(question: string): string {
  const words = norm(question).trim().replace(/ /g, '_');
  let h = 5381;
  for (const ch of question) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `checkin.q_${words.slice(0, 44).replace(/_+$/, '')}_${h.toString(16).padStart(8, '0').slice(0, 6)}`;
}

/** Her signs of one card that the facts matched, as she wrote them. */
export interface MatchedSigns {
  readings: ReadingSign[];
  answers: AnswerSign[];
  words: string[];
}

export interface Picked {
  card: Card;
  /** Which of her signs matched, in plain words. Empty for the "no card fits" card. */
  matched: string[];
  /** The same signs, as she wrote them, for a rule that needs to know which ones (medical.ts cardLevel). Absent for the "no card fits" card. */
  signs?: MatchedSigns;
  /** True when this is her "no card fits" card. */
  fallback: boolean;
  /** Set when her signs matched only cards written for another gravity: the reason her "no card fits" card is shown. */
  reason?: 'no-card-for-this-gravity';
  /** With that reason: the cards her signs matched, written for other gravities, so a screen can name them as a choice. */
  otherGravity?: string[];
}

const RANK: Record<CardLevel, number> = { unusual: 0, concerning: 1, dangerous: 2 };

function norm(s: string): string {
  return ` ${s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

function readingMatches(sign: ReadingSign, fact: ReadingFact): boolean {
  if (sign.signal !== fact.signal || sign.basis !== fact.basis) return false;
  if (sign.direction !== 'changed' && sign.direction !== fact.direction) return false;
  if (sign.threshold === null) return true;
  // Her number decides. With no value, or a value in another unit, it can't be compared, so it doesn't match.
  if (fact.value === undefined || !fact.unit || fact.unit.toLowerCase() !== sign.unit?.toLowerCase()) return false;
  // Her words are "above" and "below" (SpO2 "95 or more normal", respiratory rate "above 20"): the threshold itself does not match.
  if (sign.direction === 'high' || sign.direction === 'rising') return fact.value > sign.threshold;
  if (sign.direction === 'low' || sign.direction === 'falling') return fact.value < sign.threshold;
  return true;
}

/**
 * Picks the card her signs point to. A card fits when one of these matches:
 *   - one of her check-in answers was given;
 *   - one of her words is in what the crewmate typed;
 *   - one of her reading signs against a NASA limit or a reference range.
 * A reading against the person's own normal alone never picks a card: that is
 * the "unusual" level, and only adds weight to a card that already fits.
 * Among fitting cards: the most matched signs, then the higher level, then
 * her order in the file. When none fits, her "no card fits" card, else null.
 *
 * `gravity` is the place's, in g. A card written for another gravity is never
 * returned: when her signs match only such cards, the result is her "no card
 * fits" card with reason 'no-card-for-this-gravity' (null if she has none for
 * this gravity). With the gravity unknown, only cards that apply everywhere count.
 */
export function pickCard(cards: Card[], facts: Facts, gravity: number | null = null): Picked | null {
  const text = facts.text ? norm(facts.text) : '';
  let best: { picked: Picked; total: number } | null = null;
  const elsewhere: string[] = [];
  for (const card of cards) {
    if (card.id === NO_CARD_FITS || displayLangs(card).length === 0) continue;
    const signs: MatchedSigns = { readings: [], answers: [], words: [] };
    const matched: string[] = [];
    let strong = 0;
    for (const sign of card.signs.readings) {
      if (!facts.readings.some((f) => readingMatches(sign, f))) continue;
      signs.readings.push(sign);
      matched.push(`${sign.signal} ${sign.direction} (${sign.basis.replace('_', ' ')})`);
      if (sign.basis !== 'personal_normal') strong++;
    }
    for (const sign of card.signs.answers) {
      const given = facts.answers.some((a) => norm(a.question) === norm(sign.question) && norm(a.answer) === norm(sign.answer));
      if (given) { signs.answers.push(sign); matched.push(`answered "${sign.answer}" to "${sign.question}"`); strong++; }
    }
    if (text) {
      for (const word of [...card.signs.words.en, ...card.signs.words.pt]) {
        if (norm(word).trim() && text.includes(norm(word))) { signs.words.push(word); matched.push(`typed "${word}"`); strong++; }
      }
    }
    if (strong === 0) continue;
    if (!appliesAt(card, gravity)) { elsewhere.push(card.id); continue; }
    const cand = { picked: { card, matched, signs, fallback: false }, total: matched.length };
    if (!best
      || cand.total > best.total
      || (cand.total === best.total && RANK[card.level] > RANK[best.picked.card.level])) best = cand;
  }
  if (best) return best.picked;
  const none = cards.find((c) => c.id === NO_CARD_FITS && displayLangs(c).length > 0 && appliesAt(c, gravity));
  if (!none) return null;
  return elsewhere.length ? { card: none, matched: [], fallback: true, reason: 'no-card-for-this-gravity', otherGravity: elsewhere } : { card: none, matched: [], fallback: true };
}
