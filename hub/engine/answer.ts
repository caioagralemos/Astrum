// The hub-written answer: what the hub itself knows about a crewmate, in
// fixed sentences built by code, plus NASA's passages quoted word for word.
// Pure: no I/O and no model.
//
// It is what the crew sees when the model's answer is thrown away, or the
// model is off or too slow, and it travels beside every model answer as
// `facts`. Every sentence is a template filled with the hub's own numbers and
// carries the label of the data it came from. No sentence states a cause, a
// diagnosis, a treatment or a prediction. The only inference is the evidence
// card's own verdict, and it is always worded "points to".
//
// Returned as data (string-table keys with their values) and as rendered text,
// so the screen can show it in either language.

import type { Evidence } from './evidence.ts';
import { CO2_LEVELS } from './exposure.ts';
import type { Kind } from './types.ts';
import type { DangerVerdict, PersonReadings, Reading } from './prompt.ts';
import { TOPICS } from './conversation.ts';
import { hasString, t } from './strings.ts';

export type AnswerLang = 'en' | 'pt';

/**
 * The sentence templates, by string-table key. Portuguese waits for approval.
 * Portuguese names a signal by its `signal.*` name in the string table and
 * puts the article or possessive in front of it ({Sinal}, {O_sinal}).
 *
 * Person words are filled in by `render`, so one template serves "you" (the
 * crewmate asking about themselves) and a crewmate asking about someone else
 * (the name in the first sentence, then the profile's pronoun):
 *   EN {You} {you} subject · {are} its verb · {Your} {your} possessive · {them} object
 *   PT {Voce} {voce} subject · {de_voce} possessive ("de você", "dela", "de Reyes")
 */
export const ANSWER_STRINGS = {
  'answer.limit.under': {
    en: "The {signal} in {your} cabin reads {value} {unit} ({window}), {diff} {unit} below NASA's limit of {limit} {unit}.",
    pt: '{O_sinal} {na_cabine} está em {value} {unit} ({window}), {diff} {unit} abaixo do limite da NASA de {limit} {unit}.',
  },
  'answer.limit.at': {
    en: "The {signal} in {your} cabin reads {value} {unit} ({window}), at NASA's limit of {limit} {unit}.",
    pt: '{O_sinal} {na_cabine} está em {value} {unit} ({window}), no limite da NASA de {limit} {unit}.',
  },
  'answer.limit.over': {
    en: "The {signal} in {your} cabin reads {value} {unit} ({window}), {diff} {unit} above NASA's limit of {limit} {unit}. The steps card for this applies.",
    pt: '{O_sinal} {na_cabine} está em {value} {unit} ({window}), {diff} {unit} acima do limite da NASA de {limit} {unit}. O cartão de passos para isso se aplica.',
  },
  'answer.limit.plain': {
    en: 'The {signal} in {your} cabin reads {value} {unit} ({window}).',
    pt: '{O_sinal} {na_cabine} está em {value} {unit} ({window}).',
  },
  'answer.danger.under': {
    en: "The {signal} in {your} cabin is under NASA's limit: {value} {unit} ({window}), {diff} {unit} below {limit} {unit}.",
    pt: '{O_sinal} {na_cabine} está abaixo do limite da NASA: {value} {unit} ({window}), {diff} {unit} abaixo de {limit} {unit}.',
  },
  'answer.danger.at': {
    en: "The {signal} in {your} cabin is at NASA's limit: {value} {unit} ({window}); the limit is {limit} {unit}.",
    pt: '{O_sinal} {na_cabine} está no limite da NASA: {value} {unit} ({window}); o limite é {limit} {unit}.',
  },
  'answer.danger.over': {
    en: "The {signal} in {your} cabin is over NASA's limit: {value} {unit} ({window}), {diff} {unit} above {limit} {unit}. The steps card for this applies.",
    pt: '{O_sinal} {na_cabine} está acima do limite da NASA: {value} {unit} ({window}), {diff} {unit} acima de {limit} {unit}. O cartão de passos para isso se aplica.',
  },
  // The room the person is in now, when it is not their quarters: named, never called "your cabin".
  'answer.limitHere.under': {
    en: "The {signal} in {room}, where {you} {are} now, reads {value} {unit} ({window}), {diff} {unit} below NASA's limit of {limit} {unit}.",
    pt: '{O_sinal} em {room}, onde {voce} está agora, está em {value} {unit} ({window}), {diff} {unit} abaixo do limite da NASA de {limit} {unit}.',
  },
  'answer.limitHere.at': {
    en: "The {signal} in {room}, where {you} {are} now, reads {value} {unit} ({window}), at NASA's limit of {limit} {unit}.",
    pt: '{O_sinal} em {room}, onde {voce} está agora, está em {value} {unit} ({window}), no limite da NASA de {limit} {unit}.',
  },
  'answer.limitHere.over': {
    en: "The {signal} in {room}, where {you} {are} now, reads {value} {unit} ({window}), {diff} {unit} above NASA's limit of {limit} {unit}. The steps card for this applies.",
    pt: '{O_sinal} em {room}, onde {voce} está agora, está em {value} {unit} ({window}), {diff} {unit} acima do limite da NASA de {limit} {unit}. O cartão de passos para isso se aplica.',
  },
  'answer.limitHere.plain': {
    en: 'The {signal} in {room}, where {you} {are} now, reads {value} {unit} ({window}).',
    pt: '{O_sinal} em {room}, onde {voce} está agora, está em {value} {unit} ({window}).',
  },
  'answer.dangerHere.under': {
    en: "The {signal} in {room}, where {you} {are} now, is under NASA's limit: {value} {unit} ({window}), {diff} {unit} below {limit} {unit}.",
    pt: '{O_sinal} em {room}, onde {voce} está agora, está abaixo do limite da NASA: {value} {unit} ({window}), {diff} {unit} abaixo de {limit} {unit}.',
  },
  'answer.dangerHere.at': {
    en: "The {signal} in {room}, where {you} {are} now, is at NASA's limit: {value} {unit} ({window}); the limit is {limit} {unit}.",
    pt: '{O_sinal} em {room}, onde {voce} está agora, está no limite da NASA: {value} {unit} ({window}); o limite é {limit} {unit}.',
  },
  'answer.dangerHere.over': {
    en: "The {signal} in {room}, where {you} {are} now, is over NASA's limit: {value} {unit} ({window}), {diff} {unit} above {limit} {unit}. The steps card for this applies.",
    pt: '{O_sinal} em {room}, onde {voce} está agora, está acima do limite da NASA: {value} {unit} ({window}), {diff} {unit} acima de {limit} {unit}. O cartão de passos para isso se aplica.',
  },
  // Another room the evidence card points to, not the person's quarters and not where they are.
  'answer.limitThere.under': {
    en: "The {signal} in {room} reads {value} {unit} ({window}), {diff} {unit} below NASA's limit of {limit} {unit}.",
    pt: '{O_sinal} em {room} está em {value} {unit} ({window}), {diff} {unit} abaixo do limite da NASA de {limit} {unit}.',
  },
  'answer.limitThere.at': {
    en: "The {signal} in {room} reads {value} {unit} ({window}), at NASA's limit of {limit} {unit}.",
    pt: '{O_sinal} em {room} está em {value} {unit} ({window}), no limite da NASA de {limit} {unit}.',
  },
  'answer.limitThere.over': {
    en: "The {signal} in {room} reads {value} {unit} ({window}), {diff} {unit} above NASA's limit of {limit} {unit}.",
    pt: '{O_sinal} em {room} está em {value} {unit} ({window}), {diff} {unit} acima do limite da NASA de {limit} {unit}.',
  },
  'answer.limitThere.plain': {
    en: 'The {signal} in {room} reads {value} {unit} ({window}).',
    pt: '{O_sinal} em {room} está em {value} {unit} ({window}).',
  },
  // The place's gravity, a plain fact of the place. Said only when the question or a card turns on it.
  'answer.gravity.none': {
    en: 'You are weightless here.',
    pt: 'Aqui você está sem peso.',
  },
  'answer.gravity.partial': {
    en: "Gravity here is {g} of Earth's.",
    pt: 'A gravidade aqui é {g} da gravidade da Terra.',
  },
  // A single usual value is never called a range: "your usual is about 61 bpm".
  'answer.normal.inside': {
    en: '{Your} {signal} is {value} {unit}, about {your} usual.',
    pt: '{Sinal} está em {value} {unit}, perto {do_habitual}.',
  },
  'answer.normal.above': {
    en: '{Your} {signal} is {value} {unit}, above {your} usual of about {normal} {unit}.',
    pt: '{Sinal} está em {value} {unit}, acima {do_habitual}, que é de cerca de {normal} {unit}.',
  },
  'answer.normal.below': {
    en: '{Your} {signal} is {value} {unit}, below {your} usual of about {normal} {unit}.',
    pt: '{Sinal} está em {value} {unit}, abaixo {do_habitual}, que é de cerca de {normal} {unit}.',
  },
  'answer.series': {
    en: '{Your} {signal}, {window}: {values} {unit}.',
    pt: '{Sinal}, {window}: {values} {unit}.',
  },
  'answer.value': {
    en: '{Your} {signal}: {value} {unit}.',
    pt: '{Sinal}: {value} {unit}.',
  },
  'answer.exposure.standsOut': {
    en: 'In the last {hours} hours {you} spent {spent} hours in {room} with CO2 above {level} mmHg; none of {your} crewmates spent any time above it.',
    pt: 'Nas últimas {hours} horas {voce} passou {spent} horas em {room} com CO2 acima de {level} mmHg; nenhum colega passou tempo algum acima disso.',
  },
  'answer.exposure.standsOutSome': {
    en: 'In the last {hours} hours {you} spent {spent} hours in {room} with CO2 above {level} mmHg; the most any crewmate spent above it was {others} hours.',
    pt: 'Nas últimas {hours} horas {voce} passou {spent} horas em {room} com CO2 acima de {level} mmHg; o máximo de qualquer colega acima disso foi {others} horas.',
  },
  'answer.exposure.plain': {
    en: 'In the last {hours} hours {you} spent {spent} hours with CO2 above {level} mmHg; the most any crewmate spent above it was {others} hours.',
    pt: 'Nas últimas {hours} horas {voce} passou {spent} horas com CO2 acima de {level} mmHg; o máximo de qualquer colega acima disso foi {others} horas.',
  },
  'answer.exposure.plainNone': {
    en: 'In the last {hours} hours {you} spent {spent} hours with CO2 above {level} mmHg; none of {your} crewmates spent any time above it.',
    pt: 'Nas últimas {hours} horas {voce} passou {spent} horas com CO2 acima de {level} mmHg; nenhum colega passou tempo algum acima disso.',
  },
  'answer.exposure.above': {
    en: 'In the same {hours} hours {you} spent {spent} hours with single CO2 readings above {level} mmHg.',
    pt: 'Nas mesmas {hours} horas {voce} passou {spent} horas com leituras isoladas de CO2 acima de {level} mmHg.',
  },
  'answer.exposure.hourUnder': {
    en: "The 1-hour average, which is what NASA's limit of {limit} mmHg applies to, stayed under it throughout; the highest was {max} mmHg.",
    pt: 'A média de 1 hora, que é a que o limite da NASA de {limit} mmHg considera, ficou abaixo dele o tempo todo; a mais alta foi {max} mmHg.',
  },
  'answer.exposure.aboveHourUnder': {
    en: "In the same {hours} hours {you} spent {spent} hours with single CO2 readings above {level} mmHg, but the 1-hour average, which is what NASA's limit of {limit} mmHg applies to, stayed under it; the highest was {max} mmHg.",
    pt: 'Nas mesmas {hours} horas {voce} passou {spent} horas com leituras isoladas de CO2 acima de {level} mmHg, mas a média de 1 hora, que é a que o limite da NASA de {limit} mmHg considera, ficou abaixo dele; a mais alta foi {max} mmHg.',
  },
  'answer.exposure.hourOver': {
    en: "The highest 1-hour average was {max} mmHg, above NASA's limit of {limit} mmHg.",
    pt: 'A média de 1 hora mais alta foi {max} mmHg, acima do limite da NASA de {limit} mmHg.',
  },
  'answer.reported.run': {
    en: '{You} reported {what} on {days} days in a row.',
    pt: '{Voce} relatou {what} em {days} dias seguidos.',
  },
  'answer.reported.count': {
    en: '{You} reported {what} {count} times in the last {hours} hours.',
    pt: '{Voce} relatou {what} {count} vezes nas últimas {hours} horas.',
  },
  'answer.unusual.none': {
    en: 'None of {your} body readings is unusual for {them} right now.',
    pt: 'Nenhuma leitura {do_corpo} está fora do habitual agora.',
  },
  'answer.unusual.signal': {
    en: '{Your} {signal} is unusual for {them}: {recent} against {your} usual {usual}.',
    pt: '{Sinal} está fora {do_habitual}: {recent}, quando o habitual é {usual}.',
  },
  'answer.sameRoom.same': {
    en: '{people}, in the same room, show the same reading.',
    pt: '{people}, no mesmo ambiente, mostram a mesma leitura.',
  },
  'answer.sameRoom.normal': {
    en: '{people}, in the same room, do not.',
    pt: '{people}, no mesmo ambiente, não mostram.',
  },
  'answer.points.room': {
    en: 'This points to the room ({room}), not to {them}.',
    pt: 'Isso aponta para o ambiente ({room}), não para {voce}.',
  },
  'answer.points.person': {
    en: 'This points to {them}, not to the room.',
    pt: 'Isso aponta para {voce}, não para o ambiente.',
  },
  'answer.points.sensor': {
    en: "This points to the sensor: the room's reading may not be right.",
    pt: 'Isso aponta para o sensor: a leitura do ambiente pode não estar certa.',
  },
  'answer.lead.room': {
    en: 'From what the hub can see, this points to the room ({room}), not to {them}.',
    pt: 'Pelo que o hub vê, isso aponta para o ambiente ({room}), não para {voce}.',
  },
  'answer.lead.person': {
    en: 'From what the hub can see, this points to {them}, not to the room.',
    pt: 'Pelo que o hub vê, isso aponta para {voce}, não para o ambiente.',
  },
  'answer.lead.sensor': {
    en: "From what the hub can see, this points to the sensor: the room's reading may not be right.",
    pt: 'Pelo que o hub vê, isso aponta para o sensor: a leitura do ambiente pode não estar certa.',
  },
  'answer.points.unknown': {
    en: 'The readings do not point anywhere yet.',
    pt: 'As leituras ainda não apontam para nada.',
  },
  'answer.notExact': {
    en: "The closest NASA text is below; it does not answer this exactly.",
    pt: 'O texto da NASA mais próximo está abaixo; ele não responde a isso exatamente.',
  },
  'answer.noYesterday': {
    en: 'I have no {signal} from yesterday to compare with.',
    pt: '{O_sinal}: não tenho um valor de ontem para comparar.',
  },
  'answer.noAdvice': {
    en: 'The hub does not recommend what to do. Ask your Crew Medical Officer, and follow the steps card if one is on screen. To ask your flight surgeon, tap Contact Earth.',
    pt: 'O hub não recomenda o que fazer. Fale com o oficial médico da tripulação e siga o cartão de passos, se houver um na tela. Para falar com o cirurgião de voo, toque em Contatar a Terra.',
  },
  'answer.noDiagnosis': {
    en: 'The hub does not diagnose. Ask your Crew Medical Officer.',
    pt: 'O hub não faz diagnóstico. Fale com o oficial médico da tripulação.',
  },
  'answer.quote': {
    en: 'NASA, {name}: "{text}" ({url})',
    pt: 'NASA, {name}: "{text}" ({url})',
  },
} as const;

export type AnswerKey = keyof typeof ANSWER_STRINGS;

/** One input behind a sentence and its kind, e.g. the CO2 (replayed) and where she was (simulated). */
export interface LabelPart {
  what: string;
  kind: Kind;
}

/** One sentence: a key, its values, and the label of the data behind it ('hub' for the hub's own rule or fixed text). */
export interface FactItem {
  key: AnswerKey;
  vars: Record<string, string | number>;
  /** The weakest kind behind the sentence (or 'hub'). Kept for anything that wants one label. */
  label: Kind | 'hub';
  /** Each input with its own kind, when a sentence is built from more than one. */
  labels?: LabelPart[];
}

export interface QuotedPassage {
  name: string;
  url: string;
  /** NASA's words, unchanged. */
  text: string;
}

/** Who the answer is about, and whether that is the person asking. */
export interface Who {
  /** The person the question is about. */
  name: string;
  pronouns: 'she' | 'he' | 'they';
  /** True when the person asking is that person: the answer says "you". */
  self: boolean;
}

export interface HubAnswer {
  items: FactItem[];
  passages: QuotedPassage[];
  who: Who;
  /** The hub's sentences only, rendered, each followed by its label. */
  factsText: string;
  /** The whole answer: the hub's sentences, then the quotes. */
  text: string;
  /** False when the hub has nothing that bears on the question. */
  relevant: boolean;
}

export interface ComposeInput {
  /** The crewmate's name. */
  name: string;
  /** Default: the person is asking about themselves, and is "you". */
  who?: Who;
  question?: string;
  readings: PersonReadings | null;
  evidence: Evidence | null;
  passages: QuotedPassage[];
  lang: AnswerLang;
  danger?: DangerVerdict | null;
  /** Open with the line that NASA's text does not answer the question exactly. */
  notExact?: boolean;
  /** How to name rooms and crewmates in sentences. Default: their ids. */
  roomName?: (id: string) => string;
  personName?: (id: string) => string;
  /** The place's gravity, in g. Stated (label 'hub') only when the question or a card turns on it. */
  gravity?: number | null;
  /** A steps card for this person depends on gravity. */
  gravityMatters?: boolean;
  /** The person's own quarters: only that room is ever called their cabin. */
  quarters?: string | null;
  /** Current readings against NASA's limits in a room, for the room the evidence card points to. */
  roomReadings?: (room: string) => Extract<Reading, { type: 'limit' }>[];
}

const HOUR = 3_600_000;
const LEVEL_LOW = CO2_LEVELS[0].level;
const LEVEL_LIMIT = CO2_LEVELS[CO2_LEVELS.length - 1].level;

/** What a question is about, from its words. Only chooses which facts to show; never changes a fact. */
const AIR = /\b(co2|c02|carbon dioxide|air|room|quarters|cabin|stuffy|breath\w*|head\w*|sick|ill|unwell|wrong with (me|her|him|them)|somewhere else|sleep somewhere|move)\b/i;
/** "Why am I so tired today?": a question about tiredness. Only chooses which facts to show. */
export const TIRED = /\b(tired\w*|exhaust\w*|fatigue\w*|sleepy|drowsy|groggy|worn out|cansad[oa]s?|cansa[cç]o|exaust[oa]s?|sonolent[oa]s?|com sono)\b/i;
/** The readings that bear on tiredness: sleep last night, times awake, the sleepiness or tiredness check-in. */
export const TIRED_READING = /\b(sleep\w*|awake\w*|awakenings?|tired\w*|fatigue)\b/i;
/** For a tiredness question, the (at most three) readings that bear on it, in the readings' order. */
export function tirednessReadings<R extends Reading>(readings: readonly R[]): R[] {
  return readings.filter((r) => r.type !== 'note' && TIRED_READING.test(r.name)).slice(0, 3);
}
/** "…compared to yesterday?" */
const YESTERDAY = /\b(yesterday|ontem)\b/i;
/** "What does NASA say about CO2?": a question for NASA's own words. */
export const NASA_SAYS = /\b(what (does|do|did) nasa (say|said|write|recommend)|according to nasa|nasa'?s (limit|rule|guidance|text|standard)s? (on|for|about))\b/i;
/** A question about gravity or floating. Only decides whether the place's gravity is stated. */
const GRAVITY = /\b(gravity|weightless\w*|microgravity|zero[- ]?g|float\w*|g[- ]?force)\b/i;
/** A yes/no question about an action ("Should I sleep somewhere else?"), not "How much should I exercise?". */
const ADVICE = /^\W*(should|shall|can|could|must|may) (i|we|she|he|they)\b|^\W*is it (safe|ok|okay|fine|alright|all right|good|a good idea) (for (me|her|him|them|us) )?to\b|^\W*(am i|are we|is (she|he)|are they) (ok|okay|fine|good|safe|alright|all right|cleared) to\b|^\W*(do|does) (i|we|she|he|they) need to\b|^\W*(would|will) it help\b|^\W*is it better\b|^\W*what should (i|we|she|he|they) do\b/i;
const DIAGNOSIS = /\b((am i|is (she|he)|are they) (sick|ill|unwell)|(do i|does (she|he)|do they) have|what('?s| is) wrong with (me|her|him|them)|is something wrong with (me|her|him|them))\b/i;
/** A question asking for an amount, a dose or a treatment: "How long does she have to stay on oxygen?" */
const AMOUNT = /\bhow (many|much|long|often)\b|\bwhat (dose|amount|quantity)\b|\bwhich (treatment|medicine|drug)\b|\bhow (do|should|can) (i|we) treat\b|\bwhat treatment\b|\bwhat (do|should) (i|we) (take|give)\b/i;
/** A passage that names treatment options. Never shown as if it answered an amount or treatment question. */
const TREATMENT = /\b(treat\w*|therap\w*|recompress\w*|hyperbaric|medicat\w*|drugs?|analgesics?|antibiotics?|pharmaceutical\w*|decongestants?|supplemental (oxygen|o2)|100% ?o2|doses?)\b/i;

/** A question that asks the hub to recommend an action or to say whether someone is ill. The hub answers those itself. */
export function asksAdviceOrDiagnosis(question: string): boolean {
  return ADVICE.test(question) || DIAGNOSIS.test(question);
}

/** A question asking for an amount, a dose or a treatment. */
export function asksAmountOrTreatment(question: string): boolean {
  return AMOUNT.test(question);
}

/** True when NASA's passage names treatment options. */
export function namesTreatment(text: string): boolean {
  return TREATMENT.test(text);
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const hours = (ms: number) => round1(ms / HOUR);

function minus(a: number, b: number): number {
  const d = Math.max(String(a).split('.')[1]?.length ?? 0, String(b).split('.')[1]?.length ?? 0);
  return Number(Math.abs(a - b).toFixed(d));
}

/** Which sentence family names the room: the legacy "your cabin" ones only for the person's own quarters (or a reading with no room). */
function familyOf(r: Extract<Reading, { type: 'limit' }>, quarters: string | null | undefined): 'own' | 'here' | 'there' {
  if (r.room === undefined || r.room === quarters) return 'own';
  return r.here ? 'here' : 'there';
}

function limitItem(r: Extract<Reading, { type: 'limit' }>, danger: boolean, quarters?: string | null, roomName: (id: string) => string = (id) => id): FactItem {
  const vars = { signal: r.name.replace(/^cabin\s+/i, ''), value: r.value, unit: r.unit, window: r.window ?? 'latest', limit: r.limit ?? '', diff: r.limit === undefined ? 0 : minus(r.value, r.limit), room: r.room ? roomName(r.room) : '' };
  const family = familyOf(r, quarters);
  const plain = family === 'own' ? 'answer.limit.plain' : family === 'here' ? 'answer.limitHere.plain' : 'answer.limitThere.plain';
  if (r.limit === undefined) return { key: plain, vars, label: r.label };
  const side = r.value > r.limit ? 'over' : r.value < r.limit ? 'under' : 'at';
  if (family === 'there') return { key: `answer.limitThere.${side}`, vars, label: r.label };
  const key = family === 'own'
    ? (danger ? (`answer.danger.${side}` as const) : (`answer.limit.${side}` as const))
    : (danger ? (`answer.dangerHere.${side}` as const) : (`answer.limitHere.${side}` as const));
  return { key, vars, label: r.label };
}

function readingItem(r: Reading, quarters?: string | null, roomName?: (id: string) => string): FactItem | null {
  if (r.type === 'limit') return limitItem(r, false, quarters, roomName);
  if (r.type === 'note') return null; // free text: not repeated by the hub
  if (r.type === 'value') return { key: 'answer.value', vars: { signal: r.name, value: r.value, unit: r.unit }, label: r.label };
  if (r.type === 'series') return { key: 'answer.series', vars: { signal: r.name, window: r.window, values: r.values.join(', '), unit: r.unit }, label: r.label };
  // Durations read as "5 h 9 min"; a 0-100 score reads "40 out of 100"; a daily value is "latest", never "…, latest daily value".
  const minutes = r.unit === 'min' && DURATION.test(r.name);
  const shown = (v: number) => (minutes ? durationText(v) : v);
  const normal = typeof r.normal === 'number' ? shown(r.normal) : `${shown(r.normal[0])}-${shown(r.normal[1])}`;
  const unit = minutes ? '' : r.unit === '0-100' ? 'out of 100' : r.unit;
  const daily = /,\s*latest daily value$/i.test(r.name);
  const signal = daily ? r.name.replace(/,\s*latest daily value$/i, '') : r.name;
  const side = r.judged ?? (typeof r.normal === 'number'
    ? (r.value > r.normal ? 'above' : r.value < r.normal ? 'below' : 'inside')
    : (r.value > r.normal[1] ? 'above' : r.value < r.normal[0] ? 'below' : 'inside'));
  return { key: `answer.normal.${side}`, vars: { signal, value: shown(r.value), unit, normal, ...(daily ? { latest: 1 } : {}) }, label: r.label };
}

function mentions(question: string, name: string): boolean {
  const words = name.toLowerCase().replace(/^cabin\s+/, '').split(/\s+/).filter((w) => w.length > 2);
  if (words.length > 0 && words.every((w) => question.includes(w))) return true;
  // The same topic named in either language ("frequência cardíaca" for "heart rate"): only chooses which facts to show.
  const q = question.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return TOPICS.some((t) => t.id !== 'co2' && t.re.test(q) && t.re.test(name));
}

/**
 * "checkin.headache" → "headache". A name that would read as a cause
 * ("due_to_stress") is shown as "a check-in answer": the hub never prints
 * causal words, not even ones that came in as data.
 */
export function reportedName(signal: string): string {
  const name = signal.replace(/^checkin\./, '').replace(/[._]+/g, ' ').trim();
  return /\b(due to|because|caus\w*|leads? to|results? in)\b/i.test(name) || !name ? 'a check-in answer' : name;
}

function weakestKind(kinds: (Kind | null | undefined)[]): Kind | null {
  const rank: Record<Kind, number> = { measured: 0, estimated: 1, reported: 2, replayed: 3, simulated: 4 };
  let out: Kind | null = null;
  for (const k of kinds) if (k && (!out || rank[k] > rank[out])) out = k;
  return out;
}

/** The CO2 and where the person was, each with its own kind. */
function exposureLabels(co2: Kind | null, location: Kind | null): Pick<FactItem, 'label' | 'labels'> {
  const parts: LabelPart[] = [];
  if (co2) parts.push({ what: 'CO2', kind: co2 });
  if (location) parts.push({ what: 'location', kind: location });
  return { label: weakestKind([co2, location]) ?? 'simulated', labels: parts };
}

/**
 * The highest 1-hour CO2 average over the window, from the evidence card
 * (PersonExposure.maxHourAverage: the highest time-weighted 1-hour average of
 * the room the person was in, while they were there). Where a card has none,
 * the 1-hour sentence is left out rather than guessed.
 */
export function maxHourAverage(person: object | undefined): number | null {
  const v = (person as { maxHourAverage?: unknown } | undefined)?.maxHourAverage;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Signals whose values are minutes (sleep duration). */
const DURATION = /sleep|duration/i;

/** Minutes the way a person reads them: "7 h 29 min", "45 min". The one formatter for every duration fact. */
export function durationText(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

/** The evidence card's facts, as sentences. */
function evidenceItems(e: Evidence, readings: PersonReadings | null, roomName: (id: string) => string, personName: (id: string) => string): FactItem[] {
  const items: FactItem[] = [];
  // 1. Unusual for the person?
  if (e.unusual.signals.length === 0) {
    const body = readings?.readings.filter((r) => r.type === 'normal' || r.type === 'series') ?? [];
    const label = weakestKind(body.map((r) => r.label));
    if (label) items.push({ key: 'answer.unusual.none', vars: {}, label });
  }
  for (const s of e.unusual.signals) {
    const minutes = DURATION.test(s.signal);
    items.push({ key: 'answer.unusual.signal', vars: { signal: s.signal.replace(/_/g, ' '), recent: minutes ? durationText(s.recent) : round1(s.recent), usual: minutes ? durationText(s.usual) : round1(s.usual) }, label: s.kind });
  }
  // 2. The same room.
  for (const r of e.reasons) {
    if (r.code === 'crewmates-same') items.push({ key: 'answer.sameRoom.same', vars: { people: r.people.map(personName).join(', ') }, label: 'hub' });
    if (r.code === 'crewmates-normal') items.push({ key: 'answer.sameRoom.normal', vars: { people: r.people.map(personName).join(', ') }, label: 'hub' });
  }
  // 3. Where they have been.
  const long = [...e.whereBeen.windows].sort((a, b) => b.ms - a.ms)[0];
  const me = long?.people.find((p) => p.person === e.person);
  const standsOut = e.reasons.find((r) => r.code === 'exposure-stands-out');
  if (long && me && me.covered > 0) {
    const at = (p: { above: { level: number; ms: number }[] }, level: number) => p.above.find((a) => a.level === level)?.ms ?? 0;
    const others = Math.max(0, ...long.people.filter((p) => p.person !== e.person).map((p) => at(p, LEVEL_LOW)));
    if (standsOut && standsOut.code === 'exposure-stands-out' && standsOut.room) {
      const inRoom = me.rooms.find((r) => r.room === standsOut.room);
      const spent = hours(inRoom ? at(inRoom, LEVEL_LOW) : standsOut.ms);
      items.push({
        key: others === 0 ? 'answer.exposure.standsOut' : 'answer.exposure.standsOutSome',
        vars: { hours: hours(long.ms), spent, room: roomName(standsOut.room), level: LEVEL_LOW, others: hours(others) },
        ...exposureLabels(inRoom?.kind ?? me.kind, inRoom?.stayKind ?? me.stayKind),
      });
    } else {
      items.push({
        key: others === 0 ? 'answer.exposure.plainNone' : 'answer.exposure.plain',
        vars: { hours: hours(long.ms), spent: hours(at(me, LEVEL_LOW)), level: LEVEL_LOW, others: hours(others) },
        ...exposureLabels(me.kind, me.stayKind),
      });
    }
    const overLimit = at(me, LEVEL_LIMIT);
    if (overLimit > 0) {
      // Single readings above 3 mmHg are not time "above the limit": NASA's limit is a 1-hour average.
      const max = maxHourAverage(me);
      // Single readings above the level and a 1-hour average under the limit: one sentence, both facts.
      if (max !== null && max <= LEVEL_LIMIT) {
        items.push({ key: 'answer.exposure.aboveHourUnder', vars: { hours: hours(long.ms), spent: hours(overLimit), level: LEVEL_LIMIT, max: round1(max), limit: LEVEL_LIMIT }, ...exposureLabels(me.kind, me.stayKind) });
      } else {
        items.push({ key: 'answer.exposure.above', vars: { hours: hours(long.ms), spent: hours(overLimit), level: LEVEL_LIMIT }, ...exposureLabels(me.kind, me.stayKind) });
      }
      if (max !== null && max > LEVEL_LIMIT) {
        items.push({ key: max > LEVEL_LIMIT ? 'answer.exposure.hourOver' : 'answer.exposure.hourUnder', vars: { max: round1(max), limit: LEVEL_LIMIT }, ...exposureLabels(me.kind, me.stayKind) });
      }
    }
  }
  // 4. What they reported.
  for (const run of e.reported.runs) {
    const what = reportedName(run.signal);
    if (run.days >= 2) items.push({ key: 'answer.reported.run', vars: { what, days: run.days }, label: run.kind });
    else if (run.count > 0) items.push({ key: 'answer.reported.count', vars: { what, count: run.count, hours: hours(Math.max(...e.whereBeen.windows.map((w) => w.ms), 0)) }, label: run.kind });
  }
  // The verdict: the evidence card's own, worded "points to".
  if (e.pointsTo === 'room') items.push({ key: 'answer.points.room', vars: { room: e.focusRoom ? roomName(e.focusRoom) : '' }, label: 'hub' });
  else items.push({ key: `answer.points.${e.pointsTo}`, vars: {}, label: 'hub' });
  return items;
}

const SUBJECT = { she: 'she', he: 'he', they: 'they' } as const;
const POSSESSIVE = { she: 'her', he: 'his', they: 'their' } as const;
const OBJECT = { she: 'her', he: 'him', they: 'them' } as const;
const PT_SUBJECT = { she: 'ela', he: 'ele' } as const;
const PT_POSSESSIVE = { she: 'dela', he: 'dele' } as const;

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * The person words for one sentence. "you" when the person asks about
 * themselves; otherwise the name in the first sentence and the profile's
 * pronoun after it. Portuguese has no settled neutral pronoun, so "they"
 * uses the name every time.
 */
export function personWords(who: Who, first: boolean): Record<string, string> {
  if (who.self) return { You: 'You', you: 'you', are: 'are', Your: 'Your', your: 'your', them: 'you', Voce: 'Você', voce: 'você', de_voce: 'de você' };
  const named = first || who.pronouns === 'they';
  const p = who.pronouns;
  const en = first
    ? { You: who.name, you: who.name, are: 'is', Your: `${who.name}'s`, your: `${who.name}'s`, them: who.name }
    : { You: cap(SUBJECT[p]), you: SUBJECT[p], are: p === 'they' ? 'are' : 'is', Your: cap(POSSESSIVE[p]), your: POSSESSIVE[p], them: OBJECT[p] };
  const pt = named || p === 'they'
    ? { Voce: who.name, voce: who.name, de_voce: `de ${who.name}` }
    : { Voce: cap(PT_SUBJECT[p]), voce: PT_SUBJECT[p], de_voce: PT_POSSESSIVE[p] };
  return { ...en, ...pt };
}

const SELF: Who = { name: '', pronouns: 'they', self: true };

/** Uses a person word ({You}, {your}, …)? The first such sentence names the person. */
const PERSON_BLANK = /\{(You|you|are|Your|your|them|Voce|voce|de_voce|Sinal|na_cabine|do_habitual|do_corpo)\}/;

/** A signal's Portuguese name from the string table ("heart rate" → "frequência cardíaca"); unknown names stay as they are. */
export function ptSignalName(signal: string): string {
  const key = `signal.${signal.trim().toLowerCase().replace(/^cabin\s+/, '').replace(/[\s-]+/g, '_')}`;
  if (!hasString(key)) return signal;
  const name = t(key, 'pt');
  return /^[A-Z]{2}/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);
}

/** Grammatical gender and number of a Portuguese signal name, from its first word. */
function ptForm(name: string): { fem: boolean; plural: boolean } {
  const word = name.split(/[\s,]+/)[0].toLowerCase();
  return { fem: /(a|ão|dade|luz|dose)$/.test(word), plural: /s$/.test(word) && !/^(co2|o2)$/.test(word) };
}

/**
 * Portuguese words built around the signal: "Sua frequência cardíaca",
 * "A frequência cardíaca de Reyes", "O CO2", "na sua cabine", "do seu habitual".
 */
function ptWords(signal: string, who: Who, first: boolean): Record<string, string> {
  const name = ptSignalName(signal);
  const { fem, plural } = ptForm(name);
  const art = (fem ? 'a' : 'o') + (plural ? 's' : '');
  const poss = (fem ? 'sua' : 'seu') + (plural ? 's' : '');
  const p = who.pronouns;
  const of = who.self ? '' : first || p === 'they' ? `de ${who.name}` : PT_POSSESSIVE[p];
  const owned = (noun: string, fem2: boolean) => who.self ? `${fem2 ? 'sua' : 'seu'} ${noun}` : `${noun} ${of}`;
  const sinal = who.self ? `${poss} ${name}` : `${art} ${name} ${of}`;
  return {
    Sinal: cap(sinal), O_sinal: cap(`${art} ${name}`),
    na_cabine: who.self ? 'na sua cabine' : `na cabine ${of}`,
    do_habitual: who.self ? 'do seu habitual' : `do habitual ${of}`,
    do_corpo: `do ${owned('corpo', false)}`,
  };
}

export function render(item: FactItem, lang: AnswerLang, who: Who = SELF, first = true): string {
  const template = ANSWER_STRINGS[item.key][lang];
  const words = personWords(who, first);
  const pt: Record<string, string> = lang === 'pt' ? ptWords(String(item.vars.signal ?? ''), who, first) : {};
  const vars: Record<string, string | number> = { ...item.vars };
  // A daily value: "Your latest sleepiness", "Sua sonolência mais recente".
  if (item.vars.latest) {
    if (lang === 'pt') pt.Sinal = `${pt.Sinal} mais recente`;
    else vars.signal = `latest ${vars.signal}`;
  }
  if (lang === 'pt' && vars.unit === 'out of 100') vars.unit = 'de 100';
  // An empty unit leaves no gap before a comma or a full stop.
  const line = template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? pt[k] ?? words[k] ?? ''));
  return item.key.startsWith('answer.normal.') && !vars.unit ? line.replace(/ +([,.;])/g, '$1') : line;
}

/** "(replayed)", or "(CO2 replayed; location simulated)" when the inputs differ. */
export function labelText(item: FactItem): string {
  const parts = item.labels ?? [];
  if (parts.length > 1 && new Set(parts.map((p) => p.kind)).size > 1) return `(${parts.map((p) => `${p.what} ${p.kind}`).join('; ')})`;
  return `(${item.label})`;
}

/** The hub's sentences, rendered: the first one about the person names them, the rest use the pronoun. */
export function renderItems(items: FactItem[], lang: AnswerLang, who: Who): string[] {
  let named = false;
  return items.map((item) => {
    const usesPerson = PERSON_BLANK.test(ANSWER_STRINGS[item.key][lang]);
    const line = render(item, lang, who, usesPerson && !named);
    if (usesPerson) named = true;
    return item.key === 'answer.notExact' ? line : `${line} ${labelText(item)}`;
  });
}

/** The hub's answer for one question. Every sentence comes from a template above; every quote is NASA's text. */
export function composeAnswer(input: ComposeInput): HubAnswer {
  const q = (input.question ?? '').toLowerCase();
  const who = input.who ?? { name: input.name, pronouns: 'they', self: true };
  const roomName = input.roomName ?? ((id: string) => id);
  const personName = input.personName ?? ((id: string) => id);
  const items: FactItem[] = [];
  const readings = input.readings?.readings ?? [];

  // A danger question is answered from the numbers first.
  if (input.danger) items.push(limitItem(input.danger.reading, true, input.quarters, roomName));

  const air = AIR.test(q) || input.passages.some((p) => /co2/i.test(p.name))
    || (input.evidence?.reported.runs ?? []).some((r) => q.includes(reportedName(r.signal).toLowerCase()));
  const advice = ADVICE.test(q);
  const diagnosis = DIAGNOSIS.test(q);

  // Readings: the cabin's limited readings when the question is about the air or the room; others when named.
  // A tiredness question gets the two or three readings that bear on it (sleep, times awake, the check-in), nothing else.
  const tired = TIRED.test(q) && !air ? new Set<Reading>(tirednessReadings(readings)) : null;
  for (const r of readings) {
    if (input.danger && r === input.danger.reading) continue;
    const named = r.type !== 'note' && (tired ? tired.has(r) : mentions(q, r.name));
    if (!named && !(r.type === 'limit' && air)) continue;
    const item = readingItem(r, input.quarters, roomName);
    if (item) items.push(item);
  }
  // The room the evidence card points to, when it is not the room the person is in now (her quarters, say): its own reading too.
  const here = readings.find((r): r is Extract<Reading, { type: 'limit' }> => r.type === 'limit' && !!r.here)?.room;
  const focus = input.evidence?.focusRoom;
  if (air && focus && focus !== here && input.roomReadings) {
    for (const r of input.roomReadings(focus)) items.push(limitItem({ ...r, room: focus, here: false }, false, input.quarters, roomName));
  }

  // "…compared to yesterday?": a daily series answers it; a single current value cannot, and the hub says so plainly.
  if (YESTERDAY.test(q)) {
    for (const r of readings) {
      if (r.type !== 'normal' || !mentions(q, r.name)) continue;
      const signal = r.name.replace(/,\s*latest daily value$/i, '').replace(/\s*\b(last night|today)\b/i, '');
      if (!readings.some((x) => x.type === 'series' && mentions(q, x.name))) items.push({ key: 'answer.noYesterday', vars: { signal }, label: 'hub' });
    }
  }
  // The place's gravity, only when the question or a card turns on it. A fact of the place, nothing more.
  if (typeof input.gravity === 'number' && (GRAVITY.test(q) || input.gravityMatters)) {
    items.push(input.gravity === 0 ? { key: 'answer.gravity.none', vars: {}, label: 'hub' } : { key: 'answer.gravity.partial', vars: { g: input.gravity }, label: 'hub' });
  }

  // The evidence card, when the question is about the air, the room, how they are, or what to do.
  // A tiredness question: the evidence card's "points to" sentence only, when it points somewhere.
  if (input.evidence && tired && !(advice || diagnosis) && input.evidence.pointsTo !== 'unknown') {
    const e = input.evidence;
    items.push(e.pointsTo === 'room'
      ? { key: 'answer.lead.room', vars: { room: e.focusRoom ? roomName(e.focusRoom) : '' }, label: 'hub' }
      : { key: `answer.lead.${e.pointsTo}` as AnswerKey, vars: {}, label: 'hub' });
  }
  if (input.evidence && (air || advice || diagnosis)) {
    const found = evidenceItems(input.evidence, input.readings, roomName, personName);
    // The evidence card's verdict leads, in a conversational sentence; the facts follow it (after a danger reading, which always comes first).
    const verdict = found.find((i) => i.key === 'answer.points.room' || i.key === 'answer.points.person' || i.key === 'answer.points.sensor');
    items.push(...found.filter((i) => i !== verdict));
    if (verdict) items.splice(input.danger ? 1 : 0, 0, { ...verdict, key: verdict.key.replace('answer.points.', 'answer.lead.') as AnswerKey });
  }

  if (diagnosis) items.push({ key: 'answer.noDiagnosis', vars: {}, label: 'hub' });
  else if (advice) items.push({ key: 'answer.noAdvice', vars: {}, label: 'hub' });

  // For "Should I…?" and "Am I ill?" the hub gives its facts and verdict only: a passage found for those
  // words would be NASA's text about other people and other illnesses.
  // For "Is the CO2 dangerous?" the verdict sentence, with NASA's limit in it, is the answer: a passage the search
  // found near those words (the scrubber's inner workings, say) would bury it.
  const passages = advice || diagnosis || input.danger ? [] : input.passages.map((p) => ({ name: p.name, url: p.url, text: p.text }));
  const said = items.filter((i) => i.key !== 'answer.noAdvice' && i.key !== 'answer.noDiagnosis');
  // What is known comes first; the line about NASA's text closes the hub's sentences, just before the quotes it is about.
  if (input.notExact && passages.length > 0) items.push({ key: 'answer.notExact', vars: {}, label: 'hub' });
  const factsText = renderItems(items, input.lang, who).join(' ');
  const quotes = passages.map((p) => render({ key: 'answer.quote', vars: { name: p.name, text: p.text, url: p.url }, label: 'hub' }, input.lang));
  // "What does NASA say about CO2?": NASA's own words lead, then the readings, so no "that limit" is left hanging.
  const nasaFirst = NASA_SAYS.test(q) && quotes.length > 0;
  return {
    items, passages, who, factsText,
    text: (nasaFirst ? [...quotes, factsText] : [factsText, ...quotes]).filter(Boolean).join('\n\n'),
    relevant: said.length > 0 || passages.length > 0,
  };
}

/** Hub lines that are never facts and always stay: what the hub does not do, and the not-exact line before the quotes. */
const KEEP: AnswerKey[] = ['answer.notExact', 'answer.noAdvice', 'answer.noDiagnosis', 'answer.noYesterday'];
/** Which supporting fact matters most after the plain answer, best first; anything else keeps its order after these. */
const SUPPORT_ORDER = ['answer.lead.', 'answer.exposure.hourOver', 'answer.exposure.aboveHourUnder', 'answer.exposure.above', 'answer.exposure.hourUnder', 'answer.exposure.standsOut', 'answer.exposure.plain', 'answer.normal.', 'answer.unusual.signal'];
const isAnswerItem = (k: AnswerKey) => /^answer\.(danger|dangerHere|limit|limitHere|limitThere|normal|value|series)\./.test(k) || k === 'answer.value' || k === 'answer.series';

/**
 * The hub's answer as a reply, not a report: the plain answer first (the
 * reading the question is about, against NASA's limit or the person's normal,
 * as the hub already computed it), then at most `support` other sentences,
 * the most relevant first. Every sentence is one of composeAnswer's, unchanged
 * and with its label; nothing new is said. The full list stays in `items`,
 * `factsText` and `passages`. An answer of three sentences or fewer is
 * returned as it is.
 */
export function replyText(answer: HubAnswer, lang: AnswerLang, support = 2): string {
  const facts = answer.items.filter((i) => !KEEP.includes(i.key));
  if (facts.length <= 1 + support) return answer.text;
  const first = facts.find((i) => isAnswerItem(i.key)) ?? facts.find((i) => i.key.startsWith('answer.lead.')) ?? facts[0];
  const rank = (k: string) => { const r = SUPPORT_ORDER.findIndex((p) => k.startsWith(p)); return r < 0 ? SUPPORT_ORDER.length : r; };
  const rest = facts.filter((i) => i !== first).map((i, n) => ({ i, n })).sort((a, b) => rank(a.i.key) - rank(b.i.key) || a.n - b.n).slice(0, support).map((x) => x.i);
  const chosen = new Set([first, ...rest]);
  const opener = answer.items.filter((i) => i.key === 'answer.notExact');
  const closer = answer.items.filter((i) => i.key === 'answer.noYesterday' || i.key === 'answer.noAdvice' || i.key === 'answer.noDiagnosis');
  // Kept in composeAnswer's order after the plain answer, so the person is named the same way.
  const picked = [first, ...answer.items.filter((i) => chosen.has(i) && i !== first), ...closer, ...opener];
  const lines = renderItems(picked, lang, answer.who).join(' ');
  const quotes = answer.passages.map((p) => render({ key: 'answer.quote', vars: { name: p.name, text: p.text, url: p.url }, label: 'hub' }, lang));
  return (answer.text.startsWith('NASA, ') ? [...quotes, lines] : [lines, ...quotes]).filter(Boolean).join('\n\n');
}

/**
 * The evidence card as lines for the model's READINGS block, in the same
 * style: hub-computed, one fact per line, each with its label(s).
 */
export function evidenceLines(e: Evidence, name: string, roomName: (id: string) => string = (id) => id): string[] {
  const lines: string[] = [];
  const long = [...e.whereBeen.windows].sort((a, b) => b.ms - a.ms)[0];
  const me = long?.people.find((p) => p.person === e.person);
  if (long && me && me.covered > 0) {
    const at = (p: { above: { level: number; ms: number }[] }, level: number) => p.above.find((a) => a.level === level)?.ms ?? 0;
    const others = Math.max(0, ...long.people.filter((p) => p.person !== e.person).map((p) => at(p, LEVEL_LOW)));
    const standsOut = e.reasons.find((r) => r.code === 'exposure-stands-out');
    const where = standsOut && standsOut.code === 'exposure-stands-out' && standsOut.room ? ` in ${roomName(standsOut.room)}` : '';
    const label = labelText({ key: 'answer.exposure.plain', vars: {}, ...exposureLabels(me.kind, me.stayKind) });
    lines.push(`CO2 exposure, last ${hours(long.ms)} hours: ${hours(at(me, LEVEL_LOW))} h${where} above ${LEVEL_LOW} mmHg; crewmates at most ${hours(others)} h above ${LEVEL_LOW} mmHg ${label}.`);
    const overLimit = at(me, LEVEL_LIMIT);
    if (overLimit > 0) {
      const max = maxHourAverage(me);
      const hourly = max === null ? "NASA's limit is for the 1-hour average, not single readings"
        : max > LEVEL_LIMIT ? `highest 1-hour average ${round1(max)} mmHg, above the NASA limit of ${LEVEL_LIMIT} mmHg`
          : `highest 1-hour average ${round1(max)} mmHg, under the NASA limit of ${LEVEL_LIMIT} mmHg`;
      lines.push(`Single CO2 readings above ${LEVEL_LIMIT} mmHg: ${hours(overLimit)} h in total (${hourly}) ${label}.`);
    }
  }
  for (const run of e.reported.runs) {
    lines.push(run.days >= 2
      ? `${reportedName(run.signal)} reported on ${run.days} days in a row (${run.kind}).`
      : `${reportedName(run.signal)} reported ${run.count} times (${run.kind}).`);
  }
  if (e.unusual.signals.length === 0) lines.push(`No body reading is unusual for ${name}.`);
  // Worded so the model can repeat the verdict as it stands ("points to the room, not to you"); the room's name follows on its own.
  if (e.pointsTo === 'room') lines.push(`The hub's comparison points to the room, not to ${name}.${e.focusRoom ? ` The room is ${roomName(e.focusRoom)}.` : ''}`);
  else if (e.pointsTo === 'person') lines.push(`The hub's comparison points to ${name}, not to the room.`);
  else if (e.pointsTo === 'sensor') lines.push("The hub's comparison points to the room's sensor: its reading may not be right.");
  else lines.push("The hub's comparison does not point anywhere yet.");
  return lines;
}
