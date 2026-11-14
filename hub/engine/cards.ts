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
//     of what she approved, and stays hidden until someone has checked it.

export type CardLevel = 'unusual' | 'concerning' | 'dangerous';
export type CardNotify = 'self' | 'medical_officer' | 'everyone';
export type SignDirection = 'high' | 'low' | 'rising' | 'falling' | 'changed';
export type SignBasis = 'personal_normal' | 'nasa_limit' | 'reference_range';
export type CardLang = 'en' | 'pt';

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

    const title = both(raw.title);
    const status = str(raw.status) || 'missing';
    if (status !== 'approved') {
      out.notApproved.push({ id, title, status });
      return;
    }

    const cardProblems: string[] = [];
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
  unverified: string[];
}

export function cardView(card: Card, lang: CardLang): CardView | null {
  const langs = displayLangs(card);
  if (langs.length === 0) return null;
  const l = langs.includes(lang) ? lang : langs[0];
  return {
    id: card.id, lang: l, title: card.title[l], level: card.level, notify: card.notify, messageHouston: card.message_houston,
    steps: card.steps.map((s) => s[l]), doNot: card.do_not.map((s) => s[l]).filter(Boolean),
    sources: card.sources, unverified: card.unverified,
  };
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

export interface Picked {
  card: Card;
  /** Which of her signs matched, in plain words. Empty for the "no card fits" card. */
  matched: string[];
  /** True when this is her "no card fits" card. */
  fallback: boolean;
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
  if (sign.direction === 'high' || sign.direction === 'rising') return fact.value >= sign.threshold;
  if (sign.direction === 'low' || sign.direction === 'falling') return fact.value <= sign.threshold;
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
 */
export function pickCard(cards: Card[], facts: Facts): Picked | null {
  const text = facts.text ? norm(facts.text) : '';
  let best: { picked: Picked; total: number } | null = null;
  for (const card of cards) {
    if (card.id === NO_CARD_FITS || displayLangs(card).length === 0) continue;
    const matched: string[] = [];
    let strong = 0;
    for (const sign of card.signs.readings) {
      if (!facts.readings.some((f) => readingMatches(sign, f))) continue;
      matched.push(`${sign.signal} ${sign.direction} (${sign.basis.replace('_', ' ')})`);
      if (sign.basis !== 'personal_normal') strong++;
    }
    for (const sign of card.signs.answers) {
      const given = facts.answers.some((a) => norm(a.question) === norm(sign.question) && norm(a.answer) === norm(sign.answer));
      if (given) { matched.push(`answered "${sign.answer}" to "${sign.question}"`); strong++; }
    }
    if (text) {
      for (const word of [...card.signs.words.en, ...card.signs.words.pt]) {
        if (norm(word).trim() && text.includes(norm(word))) { matched.push(`typed "${word}"`); strong++; }
      }
    }
    if (strong === 0) continue;
    const cand = { picked: { card, matched, fallback: false }, total: matched.length };
    if (!best
      || cand.total > best.total
      || (cand.total === best.total && RANK[card.level] > RANK[best.picked.card.level])) best = cand;
  }
  if (best) return best.picked;
  const none = cards.find((c) => c.id === NO_CARD_FITS && displayLangs(c).length > 0);
  return none ? { card: none, matched: [], fallback: true } : null;
}
