// Demo mode only: Earth's reply to a message, written by the on-board model and
// always labelled "Reply simulated by AI". Pure functions; core/earth-reply.ts
// runs the clock and calls the model.
//
// There is no ground station. In demo mode, when a message to Earth reaches its
// reply time with no reply, the hub writes one in the voice of mission
// control's flight surgeon: it acknowledges the message, says to keep following
// the steps card on screen, and says Earth is watching the readings and will
// write again after one more round trip. Nothing else. The model gets only the
// hub's own facts (the room, the kind of alert, the minutes): never a name and
// never a crewmate's own words. Its text is shown only if every check here
// passes; otherwise the fixed fallback is. A privacy-restricted alert or a
// crisis message never reaches the model and gets the fallback, which does
// not say why. Production never makes a reply.

import type { EarthMessage } from './alerts.ts';
import type { ChatMessage } from './prompt.ts';
import { CAUSE, CRISIS_WORDS, MEDICINE_OUT, VERDICT_COMFORT, notEnglish, phraseProblems } from './prompt.ts';

/** The label shown beside every simulated reply, by its key in the string table. */
export const AI_REPLY_LABEL_KEY = 'earth.simulatedByAi';
/** The fixed fallback reply, by its key ({min}: whole minutes until Earth writes again). */
export const AI_FALLBACK_KEY = 'earth.aiFallback';
export const AI_FALLBACK_ONE_KEY = 'earth.aiFallbackOne';
/** The same for an alert with no steps card: no card is mentioned. */
export const AI_FALLBACK_NO_CARD_KEY = 'earth.aiFallbackNoCard';
export const AI_FALLBACK_NO_CARD_ONE_KEY = 'earth.aiFallbackNoCardOne';
/** The fixed reply to a crewmate's own message: no alert, no room, no card. Never the model's. */
export const CREW_REPLY_KEY = 'earth.crewReply';
export const CREW_REPLY_ONE_KEY = 'earth.crewReplyOne';

/** The hub's own facts about one message: all the model is given. */
export interface ReplyFacts {
  kind: 'alert' | 'crew';
  /** The room's name as the profile gives it, or null. */
  room: string | null;
  /** The kind of alert as the hub names it ("Carbon dioxide"), or null. */
  alertKind: string | null;
  /** Whole minutes until Earth can write again: one more round trip. */
  minutes: number;
  /** The alert has a steps card on screen. Without one, no card is mentioned. */
  card: boolean;
  /** The hub-written digest of the alert's incident report (engine/earth-report.ts reportDigest): what the model writes from. */
  digest?: string | null;
  /** The alert has an incident report that is not privacy-restricted: the fallback says the report was received, by its alert and room. */
  report?: boolean;
}

/** One more round trip, in whole minutes, never less than 1. */
export function replyMinutes(oneWayMs: number): number {
  return Math.max(1, Math.round((2 * oneWayMs) / 60_000));
}

/** A crew message whose words hold a crisis (prompt.ts CRISIS_WORDS). Its reply is the fallback. */
export function isCrisisMessage(m: EarthMessage): boolean {
  if (m.kind !== 'crew' || !m.text) return false;
  const t = m.text.toLowerCase().replace(/[‘’ʼ`]/g, "'").replace(/\s+/g, ' ').trim();
  return CRISIS_WORDS.some((re) => re.test(t));
}

/** The fixed, hub-built reply, by key and its value: the default whenever the model's text is not used. */
export function fallbackReply(f: Pick<ReplyFacts, 'kind' | 'minutes' | 'card' | 'report' | 'room' | 'alertKind'>): { key: string; vars: Record<string, string | number> } {
  const one = f.minutes === 1;
  if (f.kind === 'alert' && f.report && f.alertKind) {
    const key = `earth.reportFallback${f.room ? '' : 'NoRoom'}${f.card ? '' : 'NoCard'}`;
    return { key, vars: { min: f.minutes, name: f.alertKind, ...(f.room ? { room: f.room } : {}) } };
  }
  const key = f.kind === 'crew' ? (one ? CREW_REPLY_ONE_KEY : CREW_REPLY_KEY)
    : f.card ? (one ? AI_FALLBACK_ONE_KEY : AI_FALLBACK_KEY)
    : (one ? AI_FALLBACK_NO_CARD_ONE_KEY : AI_FALLBACK_NO_CARD_KEY);
  return { key, vars: { min: f.minutes } };
}

/** The message with its simulated reply, dated when a reply could first be back, marked simulated: 'ai'. */
export function withAiReply(m: EarthMessage, reply: { text: string; key?: string; vars?: Record<string, string | number> }, at = m.replyAt): EarthMessage {
  return { ...m, reply: { text: reply.text, at, simulated: true, ...(reply.key ? { key: reply.key } : {}), ...(reply.vars ? { vars: reply.vars } : {}) }, simulated: 'ai' };
}

function system(f: ReplyFacts): string {
  return `You write Earth's reply to a crew in space, in the voice of mission control's flight surgeon.
Write ${f.card ? 'three' : 'two'} short sentences in plain English, nothing else:
1. Say mission control has the message about the alert, using only the alert and room words in the FACTS.
${f.card ? '2. Say to keep following the steps card on their screen.\n3.' : '2.'} Say Earth is watching the readings and will write again in about the minutes the FACTS give.
Mention no other room, alert, place or reading. Never give any other instruction. Never name a medicine, a dose, a diagnosis or a cause. Never say anyone is or will be fine. Use no number except the minutes. Name no person.`;
}

function factsLine(f: ReplyFacts): string {
  if (f.digest) return `INCIDENT REPORT: ${f.digest}. Earth writes again in ${f.minutes} minute${f.minutes === 1 ? '' : 's'}.`;
  return `FACTS: alert: ${f.alertKind ?? 'an alert'}${f.room ? `. Room: ${f.room}` : ''}. Earth writes again in ${f.minutes} minute${f.minutes === 1 ? '' : 's'}.`;
}

/** The prompt for an alert's message: the rules and the facts. No example, so nothing in it can be copied. Never for a crew message. */
export function buildEarthReplyMessages(f: ReplyFacts): ChatMessage[] {
  return [{ role: 'system', content: system(f) }, { role: 'user', content: factsLine(f) }];
}

/** Words naming a signal or kind of alert. Each found in a reply must be in this alert's facts. Synonyms share a group. */
const SIGNAL_WORDS: string[][] = [
  ['co2', 'carbon dioxide'], ['noise', 'sound', 'loud'], ['temperature', 'heat', 'hot', 'cold'], ['pressure'], ['oxygen', 'o2', 'spo2'],
  ['radiation', 'dose rate'], ['light', 'lighting'], ['vibration'], ['smoke'], ['fire'], ['dust', 'particles', 'particulate'],
  ['humidity'], ['heart rate', 'pulse', 'heart'], ['blood'], ['breathing', 'respiration'], ['sleep'], ['fall'], ['leak'], ['ammonia'], ['toxic', 'contamination'],
];

const SENTENCES = /(?<=[.!?])\s+/;
/** Instruction verbs the reply may never use, whatever the sentence. */
const INSTRUCTION = /\b(give|giving|take|taking|administer\w*|start|starting|stop|stopping|apply|applying|increase|increasing|reduce|reducing)\b/i;
/** A sentence that opens with an order. The one allowed is "keep following the steps card". */
const ORDER = /^(please |so |now |first,? |then |next,? |also,? |and )?(take|go|put|stop|start|call|apply|drink|eat|lie|sit|breathe|leave|wear|give|try|avoid|keep|get|increase|reduce|raise|switch|open|close|remove|add|monitor|tell|contact|follow|begin|continue|skip|hydrate|relax|wait|seek|consider|ensure|talk|inform|notify|check|move|use|let|make|stay|don'?t|do not|never)\b/i;
const STEPS_CARD_ORDER = /^(please )?(keep|continue) following the (approved )?steps card\b/i;
const ADVICE = /\b(you|he|she|they|we|everyone|the crew)( all)? (should|must|need to|needs to|have to|has to|ought to)\b|\b(i|we) (would )?(recommend|suggest|advise)\b|\bmake sure\b|\btry to\b/i;
/** Reassurance about anyone's condition, or a word about how they are. */
const REASSURE = /\b(fine|okay|ok|stable|safe|all right|alright|recover\w*|better|worse|nothing serious|not serious|will be|going to be|under control|condition|healthy|well enough)\b/i;
const DIAGNOSE = /\bdiagnos\w*|\bsymptom\w*|\bcaused?\b|\bbecause\b|\bdue to\b/i;

/** What the model's reply may be: every check, as reasons. Empty reasons: it may be shown. */
export function checkEarthReply(raw: string, f: ReplyFacts, ctx: { rooms: readonly string[]; names: readonly string[] }): { ok: true; text: string } | { ok: false; reasons: string[] } {
  let t = raw.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '').trim();
  if (/<\/?think>/.test(t)) return { ok: false, reasons: ['thinking markers'] };
  t = t.replace(/^["“]|["”]$/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return { ok: false, reasons: ['empty'] };
  const reasons: string[] = [];
  const parts = t.split(SENTENCES).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) reasons.push(`${parts.length} sentences (2 or 3 allowed)`);
  if (t.length > 400) reasons.push('longer than 400 characters');
  if (/^\s*(\d+[.)]|[-*•])\s+/m.test(raw)) reasons.push('a list');
  if (notEnglish(t)) reasons.push('not-english');
  if (f.kind !== 'alert') reasons.push('a crew message never takes the model\'s words');
  if (f.card && !/\bsteps card\b/i.test(t)) reasons.push('it does not point to the steps card');
  if (!f.card && /\bcard\b/i.test(t)) reasons.push('it mentions a card this alert does not have');
  const known = (f.alertKind ?? '').toLowerCase();
  for (const group of SIGNAL_WORDS) {
    const said = group.find((w) => new RegExp(`\\b${w}\\b`, 'i').test(t));
    if (said && !group.some((w) => new RegExp(`\\b${w}\\b`).test(known))) reasons.push(`an alert or reading the facts do not give ("${said}")`);
  }
  for (const m of t.matchAll(/\b(?:in|at|from|near)\s+(?:the\s+)?([A-Z][\w-]*(?:\s+\d+)?)/g)) {
    if (!f.room || !f.room.toLowerCase().startsWith(m[1].toLowerCase())) reasons.push(`a place the facts do not give ("${m[1]}")`);
  }
  if (!new RegExp(`\\b${f.minutes} minutes?\\b`).test(t)) reasons.push('it does not say when Earth writes again');
  const numbers = [...t.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0]);
  const allowed = new Set([String(f.minutes), ...[...`${f.room ?? ''} ${f.alertKind ?? ''}`.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0])]);
  const stray = numbers.filter((n) => !allowed.has(n));
  if (stray.length) reasons.push(`numbers that are not the hub's (${stray.join(', ')})`);
  for (const name of ctx.names) if (name && new RegExp(`(?<!\\p{L})${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'iu').test(t)) reasons.push('it names a person');
  for (const room of ctx.rooms) if (room && room !== f.room && new RegExp(`\\b${room.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) reasons.push(`it names a room the facts do not ("${room}")`);
  for (const s of parts) {
    if (MEDICINE_OUT.test(s)) reasons.push(`medicine or dose: "${s}"`);
    if (INSTRUCTION.test(s)) reasons.push(`an instruction: "${s}"`);
    if (ORDER.test(s) && !STEPS_CARD_ORDER.test(s)) reasons.push(`an order other than the steps card: "${s}"`);
    if (ADVICE.test(s)) reasons.push(`advice: "${s}"`);
    if (REASSURE.test(s) || VERDICT_COMFORT.test(s)) reasons.push(`reassurance or a word about someone's condition: "${s}"`);
    if (DIAGNOSE.test(s) || CAUSE.some((re) => re.test(s))) reasons.push(`diagnosis or cause: "${s}"`);
  }
  const phrases = phraseProblems(t);
  for (const d of phrases.diagnosis) reasons.push(`diagnosis language: "${d}"`);
  reasons.push(...phrases.unsafe);
  return reasons.length ? { ok: false, reasons } : { ok: true, text: t };
}
