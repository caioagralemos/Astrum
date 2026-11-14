// Alert levels: who is told, and when it escalates. Pure state machine.
//
// The order is the project's rule: the affected crewmate first, then the Crew
// Medical Officer, then everyone.
//   1  unusual     only the person, and never while they sleep
//   2  concerning  the person is asked "Are you OK?"; the Crew Medical Officer is told
//   3  dangerous   everyone is told, the steps card is shown, Earth is messaged
//
// What raises each level here:
//   - A room over one of NASA's limits (cabin.ts) with someone in it: level 2
//     for that person. No answer before the countdown ends, or an answer of
//     "help": level 3.
//   - The same limit broken in two or more rooms is one station-wide event:
//     everyone in those rooms goes straight to level 3 with no countdown,
//     because there may be nobody left unaffected to come and help. The alerts
//     share one message to Earth and name the room with the lowest reading.
//   - A reading unusual for the person (baseline): level 1.
//   - Someone who walks into a room where another person's alert is already at
//     level 3 (most likely to help) is asked too, since they now breathe the
//     same air, but with a longer countdown (RESCUER_COUNTDOWN_MS) so they are
//     not escalated as a second emergency while they work. Routing only.
//
// Messages to Earth are their own list (EarthMessage): one per level 3, or one
// per station-wide event, never sent twice. A message outlives its alert,
// because the crew has usually acted long before Earth's reply can be back.
// Nothing in this file judges health. It only routes what the limits and the
// baseline already found.

import type { RoomAlarm } from './cabin.ts';
import type { Kind, Person } from './types.ts';

export type Level = 1 | 2 | 3;

/** Seconds the person has to answer "Are you OK?" before everyone is told. */
export const COUNTDOWN_MS = 60_000;

/** The countdown for someone who entered a room where another person's alert is at level 3. */
export const RESCUER_COUNTDOWN_MS = 5 * 60_000;

/**
 * How long a message to Earth stays listed after its reply can be back, once
 * the alert it was about has ended. While that alert lasts, it stays.
 */
export const EARTH_KEEP_MS = 10 * 60_000;

export interface Unusual {
  person: string;
  signal: string;
  direction: 'high' | 'low' | null;
  /** Robust z-score from the baseline. */
  z: number;
  kind: Kind;
}

export interface Alert {
  id: string;
  person: string;
  level: Level;
  reason: 'room-limit' | 'unusual';
  room: string | null;
  signal: string;
  /** What was found, as data for the screen to word. */
  value: number | null;
  /** How far over the limit, rounded up to 2 decimals (cabin.ts overBy). */
  over?: number | null;
  unit: string | null;
  limit: number | null;
  limitSource: string | null;
  direction: 'high' | 'low' | null;
  kind: Kind;
  since: number;
  levelSince: number;
  /** When "Are you OK?" was asked, and when the countdown ends. */
  askedAt: number | null;
  answerBy: number | null;
  answer: 'ok' | 'help' | null;
  /**
   * The string key for the question at level 2: "alert.areYouOk", or
   * "alert.enteredOverLimit" for someone who walked into a room where another
   * person's alert was already at level 3.
   */
  askKey?: string | null;
  /** Level 1 waiting because the person is asleep. Nobody is told yet. */
  held: boolean;
  /** Who is told: crew ids, or everyone. */
  toldTo: string[] | 'everyone';
  /** The steps card to show, by id, at level 3. Chosen by rule, never by the AI. */
  card: string | null;
  /** Part of a station-wide event: the same limit is broken in two or more rooms. */
  stationWide: boolean;
  /** Station-wide only: the room with the lowest reading that is still under the limit, if any. */
  lowestRoom: { room: string; value: number } | null;
  /** The message to Earth: when it left, when it arrives, when a reply can be back. */
  earth: { sentAt: number; arrivesAt: number; replyAt: number } | null;
  /** The id of that message in the hub's list of messages to Earth. */
  earthId?: string | null;
  /** Level 3: someone said "I've seen it". Silences the board's buzzer for this alert; the level stays. */
  seenBy?: string | null;
  seenAt?: number | null;
  /**
   * Level 3 only: how soon the steps card says to act, in seconds, from the
   * caller's lookup (the medical lead's card file). Null when the card gives
   * no such time; this file never makes one up.
   */
  actWithinSeconds?: number | null;
  /** Level 3 only: can Earth's reply be back before the card's time runs out? Null when unknown. */
  earthInTime?: boolean | null;
}

/** A message to Earth. Listed on its own, so it outlives the alert it was about. */
export interface EarthMessage {
  id: string;
  /** The alert that sent it. For a station-wide event, the first person in it. */
  about: { person: string; room: string | null; signal: string; level: Level; stationWide: boolean };
  sentAt: number;
  arrivesAt: number;
  replyAt: number;
  /** When the last alert it was about ended. Null while one lasts. */
  resolvedAt: number | null;
}

export interface AlertEvent {
  type: 'raised' | 'escalated' | 'answered' | 'resolved';
  alert: Alert;
}

export interface AlertInputs {
  now: number;
  crew: Person[];
  delayToEarthMs: number;
  roomAlarms: RoomAlarm[];
  /** Each room's latest average for limited signals: signal → room → value. */
  roomAverages?: Record<string, Record<string, number>>;
  /** Who is in each room now. */
  occupants: Record<string, string[]>;
  unusual: Unusual[];
  /** Crew ids asleep now. */
  asleep: string[];
  /** How soon each steps card says to act, in seconds, by card id. Only cards whose file gives a time. */
  actWithin?: Record<string, number>;
}

/**
 * Compares when Earth's reply can be back with how soon the card says to act.
 * The card's time counts from when the alert reached level 3.
 */
function withEarthCheck(alert: Alert, inputs: AlertInputs): Alert {
  if (alert.level !== 3) return alert;
  const seconds = alert.card ? inputs.actWithin?.[alert.card] ?? null : null;
  const earthInTime = seconds === null || !alert.earth ? null : alert.earth.replyAt <= alert.levelSince + seconds * 1000;
  return { ...alert, actWithinSeconds: seconds, earthInTime };
}

/** The steps card for a broken limit, by signal. Only cards that exist are listed. */
const CARD_FOR: Record<string, string> = { co2: 'high-co2' };

function medicalOfficers(crew: Person[]): string[] {
  return crew.filter((p) => p.role === 'role.cmo').map((p) => p.id);
}

function toLevel(alert: Alert, level: Level, inputs: AlertInputs, rescuer = false): Alert {
  const { now, crew, delayToEarthMs } = inputs;
  const next: Alert = { ...alert, level, levelSince: now };
  if (level === 1) next.toldTo = [alert.person];
  if (level === 2) {
    next.toldTo = [...new Set([alert.person, ...medicalOfficers(crew)])];
    next.askedAt = now;
    next.answerBy = now + (rescuer ? RESCUER_COUNTDOWN_MS : COUNTDOWN_MS);
    next.askKey = rescuer ? 'alert.enteredOverLimit' : 'alert.areYouOk';
  }
  if (level === 3) {
    next.toldTo = 'everyone';
    next.card = CARD_FOR[alert.signal] ?? null;
    next.earth = { sentAt: now, arrivesAt: now + delayToEarthMs, replyAt: now + 2 * delayToEarthMs };
    next.earthId = `earth|${alert.id}|${now}`;
  }
  return withEarthCheck(next, inputs);
}

/** Advances every alert by one look at the station. Returns the new list and what changed. */
export function stepAlerts(before: Alert[], inputs: AlertInputs): { alerts: Alert[]; events: AlertEvent[] } {
  const { now } = inputs;
  const held = new Map(before.map((a) => [a.id, a]));
  const alerts: Alert[] = [];
  const events: AlertEvent[] = [];
  const blank = { askedAt: null, answerBy: null, answer: null, askKey: null, held: false, card: null, earth: null, earthId: null, seenBy: null, seenAt: null, stationWide: false, lowestRoom: null } as const;

  // A limit broken in two or more rooms is a station-wide event.
  const roomsOver = new Map<string, Set<string>>();
  for (const alarm of inputs.roomAlarms) roomsOver.set(alarm.signal, (roomsOver.get(alarm.signal) ?? new Set()).add(alarm.room));
  const wide = (signal: string) => (roomsOver.get(signal)?.size ?? 0) >= 2;
  const lowest = (signal: string, limit: number): Alert['lowestRoom'] => {
    let best: Alert['lowestRoom'] = null;
    for (const [room, value] of Object.entries(inputs.roomAverages?.[signal] ?? {})) {
      if (value <= limit && (!best || value < best.value)) best = { room, value };
    }
    return best;
  };
  // One message to Earth for the whole event: reuse one already sent about a
  // room that is over the limit now, by this step or the one before.
  const sentAlready = (signal: string): Pick<Alert, 'earth' | 'earthId'> | null => {
    const sent = [...alerts, ...before].find((a) => a.reason === 'room-limit' && a.signal === signal && a.earth && a.room !== null && roomsOver.get(signal)?.has(a.room));
    return sent ? { earth: sent.earth, earthId: sent.earthId ?? null } : null;
  };
  // A level 3 already active for someone else in this room: whoever walks in now is most likely helping.
  const levelThreeIn = (room: string, signal: string, person: string) =>
    before.some((a) => a.level === 3 && a.reason === 'room-limit' && a.room === room && a.signal === signal && a.person !== person);

  // Rooms over a limit, for each person in them.
  for (const alarm of inputs.roomAlarms) {
    for (const person of inputs.occupants[alarm.room] ?? []) {
      const id = `${person}|room-limit|${alarm.room}|${alarm.signal}`;
      let alert = held.get(id);
      if (!alert) {
        alert = toLevel({
          id, person, level: 2, reason: 'room-limit', room: alarm.room, signal: alarm.signal, value: alarm.value, over: alarm.over ?? null, unit: alarm.unit,
          limit: alarm.limit, limitSource: alarm.limitSource, direction: 'high', kind: alarm.kind, since: now, levelSince: now, toldTo: [person], ...blank,
        }, 2, inputs, levelThreeIn(alarm.room, alarm.signal, person));
        events.push({ type: 'raised', alert });
      } else {
        alert = { ...alert, value: alarm.value, over: alarm.over ?? null, kind: alarm.kind };
      }
      if (wide(alarm.signal)) {
        if (alert.level !== 3) {
          const sent = sentAlready(alarm.signal);
          alert = toLevel({ ...alert, stationWide: true }, 3, inputs);
          if (sent) Object.assign(alert, sent);
          events.push({ type: 'escalated', alert });
        }
        alert = withEarthCheck({ ...alert, stationWide: true, lowestRoom: lowest(alarm.signal, alarm.limit) }, inputs);
      } else {
        alert = { ...alert, stationWide: false, lowestRoom: null };
        const unanswered = alert.answer === null && alert.answerBy !== null && now >= alert.answerBy;
        if (alert.level === 2 && (alert.answer === 'help' || unanswered)) {
          alert = toLevel(alert, 3, inputs);
          events.push({ type: 'escalated', alert });
        }
        // The card's time may arrive after the alert did.
        alert = withEarthCheck(alert, inputs);
      }
      alerts.push(alert);
    }
  }

  // Readings unusual for the person. One alert per person, for their strongest signal.
  const strongest = new Map<string, Unusual>();
  for (const u of inputs.unusual) {
    const top = strongest.get(u.person);
    if (!top || Math.abs(u.z) > Math.abs(top.z)) strongest.set(u.person, u);
  }
  for (const [person, u] of strongest) {
    const id = `${person}|unusual`;
    const asleep = inputs.asleep.includes(person);
    let alert = held.get(id);
    if (!alert) {
      alert = toLevel({
        id, person, level: 1, reason: 'unusual', room: null, signal: u.signal, value: null, unit: null, limit: null, limitSource: null,
        direction: u.direction, kind: u.kind, since: now, levelSince: now, toldTo: [person], ...blank, held: asleep,
      }, 1, inputs);
      alert.toldTo = asleep ? [] : [person];
      if (!asleep) events.push({ type: 'raised', alert });
    } else {
      const waking = alert.held && !asleep;
      alert = { ...alert, signal: u.signal, direction: u.direction, kind: u.kind, held: alert.held && asleep, toldTo: alert.held && asleep ? [] : [person] };
      if (waking) events.push({ type: 'raised', alert });
    }
    alerts.push(alert);
  }

  const kept = new Set(alerts.map((a) => a.id));
  for (const alert of before) if (!kept.has(alert.id)) events.push({ type: 'resolved', alert });
  return { alerts, events };
}

/**
 * Keeps the list of messages to Earth in step with the alerts. A new one is
 * listed when an alert reaches level 3 with a message not listed before (so a
 * station-wide event lists one, and nothing is sent twice). When no alert
 * refers to a message any more, it is marked resolved, and it is dropped
 * EARTH_KEEP_MS after its reply can be back.
 */
export function stepEarth(before: EarthMessage[], alerts: Alert[], events: AlertEvent[], now: number): EarthMessage[] {
  const out: EarthMessage[] = [];
  const listed = new Set(before.map((m) => m.id));
  for (const e of events) {
    const a = e.alert;
    if (e.type !== 'escalated' || a.level !== 3 || !a.earth || !a.earthId || listed.has(a.earthId)) continue;
    listed.add(a.earthId);
    before = [...before, {
      id: a.earthId, about: { person: a.person, room: a.room, signal: a.signal, level: a.level, stationWide: a.stationWide },
      ...a.earth, resolvedAt: null,
    }];
  }
  const live = new Set(alerts.map((a) => a.earthId).filter(Boolean));
  for (const m of before) {
    const resolvedAt = m.resolvedAt ?? (live.has(m.id) ? null : now);
    if (resolvedAt !== null && now >= m.replyAt + EARTH_KEEP_MS) continue;
    out.push(resolvedAt === m.resolvedAt ? m : { ...m, resolvedAt });
  }
  return out;
}

/**
 * "I've seen it" on a level 3, from anyone. Silences the board's buzzer for
 * that alert and records who and when; the level does not change.
 */
export function seeAlert(alerts: Alert[], id: string, by: string | null, now: number): { alerts: Alert[]; seen: boolean } {
  let seen = false;
  const next = alerts.map((alert) => {
    if (alert.id !== id || alert.level !== 3 || alert.seenAt) return alert;
    seen = true;
    return { ...alert, seenBy: by, seenAt: now };
  });
  return { alerts: next, seen };
}

/** Records the person's answer to "Are you OK?". "help" escalates on the next step. */
export function answerAlert(alerts: Alert[], id: string, answer: 'ok' | 'help'): { alerts: Alert[]; event: AlertEvent | null } {
  let event: AlertEvent | null = null;
  const next = alerts.map((alert) => {
    if (alert.id !== id || alert.level !== 2 || alert.answer !== null) return alert;
    const answered = { ...alert, answer };
    event = { type: 'answered', alert: answered };
    return answered;
  });
  return { alerts: next, event };
}

/**
 * The one rule for a sensor board's buzzer. A board sounds while
 *   (a) its own room has a room alarm nobody has acknowledged, or
 *   (b) any alert is at level 3 (everyone is told; a board in a common room is
 *       how everyone hears it), until someone says "I've seen it" on that
 *       alert, the person answers "I am OK", or the alert ends.
 * An answer of "help" is what raised the level 3, so it does not silence it.
 * Acknowledging one does not silence the other.
 */
export function boardSounds(boardRooms: string[], alarms: RoomAlarm[], alerts: Alert[]): boolean {
  const ownRoom = alarms.some((a) => !a.acknowledged && boardRooms.includes(a.room));
  const everyone = boardRooms.length > 0 && alerts.some((a) => a.level === 3 && !a.seenAt && a.answer !== 'ok');
  return ownRoom || everyone;
}

/** The alerts one viewer may see. The common screen sees only what everyone is told. */
export function visibleTo(alerts: Alert[], viewer: string | 'common'): Alert[] {
  return alerts.filter((a) => a.toldTo === 'everyone' || (viewer !== 'common' && a.toldTo.includes(viewer)));
}
