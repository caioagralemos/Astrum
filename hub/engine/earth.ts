// Messages a crewmate writes to Earth by hand. Pure functions; core/earth.ts
// keeps them, stores them and runs the clock.
//
// A crew message sits in the same list as the messages a level 3 alert sends
// (engine/alerts.ts EarthMessage), with kind 'crew'. It reaches Earth after
// the place's one-way delay, and a reply can be back after twice that.
//
// There is no ground station: the hub never has a real reply. In demo mode
// only, a crew message gets a fixed reply once its reply time passes
// (`earth.simReply` in the string table). It is always marked simulated, says
// nothing medical, and is never written by the model. Production never makes one.
//
// The words are the crewmate's own. They are never sent to the model and
// never logged; the hub keeps them only in the stored row (crewMessageRow).

import type { EarthMessage } from './alerts.ts';
import type { Row } from './types.ts';

/** The signal a crew message is stored under, one "reported" row per message. */
export const EARTH_SIGNAL = 'earth.message';
/** The source of those rows: earth:<person>. */
export const EARTH_SOURCE_PREFIX = 'earth:';
/** How long a crew message stays listed after it was sent. */
export const CREW_KEEP_MS = 24 * 3600_000;
/** The same limit as a row's text (timeline.ts rowProblem). */
export const MAX_TEXT = 2000;
/** The fixed simulated reply, by its key in the string table. */
export const SIM_REPLY_KEY = 'earth.simReply';

/** What is wrong with a POST /api/earth/messages body, or null. */
export function messageProblem(body: unknown, crew: string[]): string | null {
  const b = body as { from?: unknown; text?: unknown } | null;
  if (typeof b !== 'object' || b === null) return 'body must be JSON: { from, text }';
  if (typeof b.from !== 'string' || !crew.includes(b.from)) return 'from must be a crewmate in the profile';
  if (typeof b.text !== 'string' || !b.text.trim()) return 'text must be the message, 1 to 2000 characters';
  if (b.text.trim().length > MAX_TEXT) return `text must be at most ${MAX_TEXT} characters`;
  return null;
}

/** A crew message as the list holds it. Its id is fixed by who sent it and when, so a reload finds the same one. */
export function crewMessage(from: string, text: string, sentAt: number, delayMs: number, now = sentAt): EarthMessage {
  return {
    id: `earth|crew|${from}|${sentAt}`, kind: 'crew',
    about: { person: from, room: null, signal: EARTH_SIGNAL, level: null, stationWide: false },
    from, text, sentAt, arrivesAt: sentAt + delayMs, replyAt: sentAt + 2 * delayMs,
    delivered: now >= sentAt + delayMs, reply: null, resolvedAt: null,
  };
}

/** The row a crew message is stored as. The crewmate said it, so it is "reported". */
export function crewMessageRow(m: EarthMessage): Row {
  return { t: m.sentAt, signal: EARTH_SIGNAL, value: null, text: m.text ?? '', unit: '', kind: 'reported', source: `${EARTH_SOURCE_PREFIX}${m.from}`, person: m.from ?? null, room: null };
}

/** The crew messages still listed at `now`, rebuilt from their stored rows. Rows from any other source are ignored. */
export function crewMessagesFromRows(rows: Row[], delayMs: number, now: number): EarthMessage[] {
  return rows
    .filter((r) => r.signal === EARTH_SIGNAL && r.kind === 'reported' && r.person && r.source === `${EARTH_SOURCE_PREFIX}${r.person}` && r.text && now - r.t < CREW_KEEP_MS)
    .sort((a, b) => a.t - b.t)
    .map((r) => crewMessage(r.person!, r.text!, r.t, delayMs, now));
}

/** Marks what has reached Earth by now, and drops what is older than CREW_KEEP_MS. */
export function stepCrewMessages(list: EarthMessage[], now: number): EarthMessage[] {
  const out: EarthMessage[] = [];
  for (const m of list) {
    if (now - m.sentAt >= CREW_KEEP_MS) continue;
    const delivered = now >= m.arrivesAt;
    out.push(delivered === m.delivered ? m : { ...m, delivered });
  }
  return out;
}

/** Demo mode only: the message with the fixed simulated reply, dated when a reply could first be back. */
export function withSimulatedReply(m: EarthMessage, text: string): EarthMessage {
  return { ...m, reply: { text, at: m.replyAt, simulated: true, key: SIM_REPLY_KEY } };
}
