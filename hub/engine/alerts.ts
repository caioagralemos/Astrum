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
//   - A room past an "alarm" level the crew set on one of their sensors
//     (limitSource 'crew'): the same levels as a NASA limit, kept apart from
//     NASA's (its own alert, its own station-wide count), worded as set by the
//     crew, and with no steps card unless her cards have one for that signal.
//   - A reading unusual for the person (baseline): level 1.
//   - A base-wide event a crewmate declared (core/events.ts): level 3 for
//     everyone at once, no countdown, no reading. The hub has no weather or
//     radiation feed, so a person saying so is the only source (kind
//     'reported'). One alert per event; its card only by EVENT_CARD. Declared
//     ahead (expectedAt), it is first a warning: a level 2 notice for everyone
//     (notice: true), no question, no countdown, no card, no buzzer, no
//     message to Earth; at expectedAt the same alert becomes the level 3.
//   - A finding by the medical lead's rules (engine/medical.ts): a body
//     reading or blood result past one of her limits, a card her signs
//     picked, or "it did not get better". The finding's level is hers, and it
//     moves when her limits say so; there is no countdown on it.
//
// Her rules on every alert (hub/medical/README.md):
//   - level 2 tells the Crew Medical Officer and says the person is not left
//     alone (notAlone). If the Crew Medical Officer is the person, the
//     Commander is told instead; with neither aboard (or the only one is the
//     person), the rest of the crew, by name, never the common screen;
//   - level 3 shows her urgent card (alsoCard) beside any other card;
//   - level 1 is never sent while the person sleeps, whatever raised it;
//   - a private card (mood, psychosis, gynecologic) never travels in the alert
//     as others receive it: alertFor() decides what each viewer gets, and the
//     alert's own signal says only that the person needs someone.
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
import type { CardView } from './cards.ts';
import type { IncidentReport } from './earth-report.ts';

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
  reason: 'room-limit' | 'unusual' | 'finding' | 'declared';
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
  /** A crew level only: the string key it is worded with, which says the level was set by the crew. NASA's alerts have none. */
  textKey?: string;
  /** Level 3: someone said "I've seen it". Silences the board's buzzer for this alert; the level stays. */
  seenBy?: string | null;
  seenAt?: number | null;
  /**
   * Level 3: someone marked the emergency settled (a crew id, or null from a shared screen). The takeover
   * stops showing and the buzzer stops as for "seen"; the alert, its level and any room alarm stay.
   * It applies to this occurrence only: a settle from before `levelSince` is not one (isSettled).
   */
  settledBy?: string | null;
  settledAt?: number;
  /**
   * Level 3 only: how soon the steps card says to act, in seconds, from the
   * caller's lookup (the medical lead's card file). Null when the card gives
   * no such time; this file never makes one up.
   */
  actWithinSeconds?: number | null;
  /** Level 3 only: can Earth's reply be back before the card's time runs out? Null when unknown. */
  earthInTime?: boolean | null;
  /** Level 3: her urgent card (xABCDE), shown beside `card`. Below level 3: the card a situation of hers names (Finding.alsoCard), else null. */
  alsoCard?: string | null;
  /** Level 2 and 3: the person is not left alone (her rule for "concerning"). A fact for the screens; the hub only tells. */
  notAlone?: boolean;
  /** Level 2 and 3: who is told in the Crew Medical Officer's place, or the officer. */
  medicalTeam?: string[];
  /**
   * A private card (engine/medical.ts PRIVATE_CARDS). As the hub keeps the
   * alert, `card` is null and the card is here; alertFor() gives it back only
   * to the person, and to the medical team when her rule allows. Absent for
   * every other alert.
   */
  private?: { card: string | null; medicalOfficerSeesCard: boolean } | null;
  /** A finding only: the question her rule says to ask next, in her words (English). */
  nextQuestion?: string | null;
  /**
   * Added by the hub as each viewer receives the alert (core/server.ts): her
   * text for `card` and `alsoCard`, in a language it may be shown in, with its
   * sources and what is unverified. Never kept in the alert itself.
   */
  cardViews?: CardView[];
  /** Raised by a drill (core/drill.ts): the real engine on a simulated reading. It can be answered like any alert. */
  drill?: true;
  /** A base-wide event a crewmate declared (core/events.ts). Its signal is "event.<kind>"; `person` is who declared it. */
  declared?: Declared & { stage: 'warning' | 'event' };
  /**
   * Information for everyone to acknowledge ("I've seen it"), never a question:
   * askKey and answerBy stay null and it cannot be answered. Only the warning
   * stage of a declared event, at level 2.
   */
  notice?: true;
}

/** The base-wide events a crewmate may declare. A fixed list: each has its words in the string table ("event.<kind>"). */
export const EVENT_KINDS = ['dust_storm', 'solar_particle_event', 'pressure_loss', 'fire', 'quake', 'meteoroid_impact', 'other'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * The medical lead's card that plainly covers an event, by its own id and title:
 * "Smoke and toxic air" for a fire, "Pressure drop and radiation" for a loss of
 * pressure or a solar particle event. A dust storm, a quake, a meteoroid impact
 * and "other" have none of hers, so they get no card; no steps are ever made up here.
 */
export const EVENT_CARD: Readonly<Partial<Record<EventKind, string>>> = {
  fire: 'smoke-toxic-air',
  pressure_loss: 'decompression-radiation',
  solar_particle_event: 'decompression-radiation',
};

/**
 * A base-wide event as a crewmate declared it. `note` is their own words, and,
 * unlike every other typed text (engine/privacy.ts), it is addressed to all:
 * a base-wide notice is written for the whole crew to read.
 */
export interface Declared {
  kind: EventKind;
  /** Crew id of who declared it (for a forecast from Earth, who entered it). */
  by: string;
  at: number;
  note: string | null;
  /** Room id: where to go. */
  shelter: string | null;
  /**
   * Where the word came from: 'crew' (a person on board), 'earth' (a forecast
   * mission control sent, entered by a crewmate), or 'sensor', reserved for a
   * real sensor past a real limit; nothing sets it yet.
   */
  source: 'crew' | 'earth' | 'sensor';
  /** When it is expected, on the hub's clock. Null: it is happening now. Before this time the event is a warning. */
  expectedAt: number | null;
}

/** A declared event as the alert engine takes it: with its card, already checked against her file and the gravity. */
export interface DeclaredEvent extends Declared {
  id: string;
  card: string | null;
}

/**
 * What the medical lead's rules found about one person (engine/medical.ts):
 * the level is hers. `key` keeps one alert per finding.
 */
export interface Finding {
  key: string;
  person: string;
  level: Level;
  signal: string | null;
  value: number | null;
  unit: string | null;
  limit: number | null;
  limitSource: string | null;
  direction: 'high' | 'low' | null;
  kind: Kind;
  card: string | null;
  /** A private finding: card null for one with no card (a crisis), which says only that the person needs someone. */
  private: { card: string | null; medicalOfficerSeesCard: boolean } | null;
  nextQuestion: string | null;
  /** A card her situation names beside `card` (a card's situations[].also_card). Level 3 shows her urgent card instead. */
  alsoCard?: string | null;
}

/** The signal a private alert carries, and the string key it is worded with: "<name> needs someone with them". */
export const NEEDS_SOMEONE = 'needs-someone';
export const NEEDS_SOMEONE_KEY = 'alert.needsSomeone';

/**
 * The person asked for help themselves (Ask Astra's "Call for help", POST /api/ask/help): the same level 3 an
 * answer of "help" to "Are you OK?" brings, for everyone, with her urgent card beside it. No card, no words.
 */
export const ASKED_HELP = 'asked-help';
export function askedHelpFinding(person: string): Finding {
  return {
    key: ASKED_HELP, person, level: 3, signal: ASKED_HELP, value: null, unit: null, limit: null, limitSource: null,
    direction: null, kind: 'reported', card: null, private: null, nextQuestion: null,
  };
}
/** Her urgent card, shown at level 3 beside any other. */
export const URGENT_CARD_ID = 'unknown-urgent';

/**
 * A message to Earth. Listed on its own, so it outlives the alert it was about.
 * Two kinds share the list: 'alert', sent by a level 3 alert (below), and
 * 'crew', written by a crewmate (engine/earth.ts).
 */
export interface EarthMessage {
  id: string;
  kind: 'alert' | 'crew';
  /**
   * The alert that sent it (for a station-wide event, the first person in it).
   * A crew message is about its sender: no room, the signal "earth.message", no level.
   */
  about: { person: string; room: string | null; signal: string; level: Level | null; stationWide: boolean };
  /** A crew message only: who wrote it, and what they wrote. */
  from?: string;
  text?: string;
  sentAt: number;
  arrivesAt: number;
  /** The earliest a reply can be back: sent plus twice the one-way delay. */
  replyAt: number;
  /** True once it has reached Earth (the hub's clock is past arrivesAt). */
  delivered: boolean;
  /**
   * Earth's reply. The hub has no ground station, so the only reply there can
   * be is a simulated one, in demo mode only (engine/earth-reply.ts). Always
   * null in production. `key` names its text in the string table, for a screen
   * in Portuguese, with `vars` filling its blanks.
   */
  reply: { text: string; at: number; simulated: true; key?: string; vars?: Record<string, string | number> } | null;
  /** Demo mode only: the reply was written by the on-board model or is its fixed fallback. Every screen shows "Reply simulated by AI" beside it. */
  simulated?: 'ai';
  /** An alert's message: the incident report the hub filed with it at level 3 (engine/earth-report.ts). Absent on a crew message. */
  report?: IncidentReport;
  /** Demo mode only: arrivesAt and replyAt are the demo's shortened delay (demoEarthReplySeconds), not the mission's. Screens say "simulated delay". */
  simulatedDelay?: true;
  /** When the last alert it was about ended. Null while one lasts, and always for a crew message. */
  resolvedAt: number | null;
  /** Listed by a drill's alert (core/drill.ts). Stays marked after the drill ends. */
  drill?: true;
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
  /** For a crew level: her steps card for that signal, by id, or null when she has none. */
  cardFor?: (signal: string) => string | null;
  /** What her rules found now (engine/medical.ts). */
  findings?: Finding[];
  /** Base-wide events a crewmate declared and nobody has ended (core/events.ts). */
  declared?: DeclaredEvent[];
}

/** The string keys a crew-level alert is worded with ('.above' or '.below'). They say the level was set by the crew. */
export const CREW_ALERT_KEY = 'alert.crewLevel';

const isCrew = (a: { limitSource: string | null }) => a.limitSource === 'crew';

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

/**
 * Who is told at level 2 besides the person. Her rule: the Crew Medical
 * Officer; if that is the person, the Commander instead. A crew with neither
 * (or whose only one is the person) tells the rest of the crew by name.
 */
export function medicalTeam(crew: Person[], person: string): string[] {
  const others = crew.filter((p) => p.id !== person);
  const cmo = others.filter((p) => p.role === 'role.cmo').map((p) => p.id);
  if (cmo.length) return cmo;
  const commander = others.filter((p) => p.role === 'role.commander').map((p) => p.id);
  if (commander.length) return commander;
  return others.map((p) => p.id);
}

/** Her urgent card beside a level 3 card: null when the card already is it. */
function urgentBeside(card: string | null): string | null {
  return card === URGENT_CARD_ID ? null : URGENT_CARD_ID;
}

function toLevel(alert: Alert, level: Level, inputs: AlertInputs, rescuer = false): Alert {
  const { now, crew, delayToEarthMs } = inputs;
  const next: Alert = { ...alert, level, levelSince: now };
  // A new level is a new occurrence: a settle from before it does not carry.
  delete next.settledBy;
  delete next.settledAt;
  if (level === 1) next.toldTo = [alert.person];
  if (level === 2) {
    next.medicalTeam = medicalTeam(crew, alert.person);
    next.toldTo = [...new Set([alert.person, ...next.medicalTeam])];
    next.notAlone = true;
    next.askedAt = now;
    next.answerBy = now + (rescuer ? RESCUER_COUNTDOWN_MS : COUNTDOWN_MS);
    next.askKey = rescuer ? 'alert.enteredOverLimit' : 'alert.areYouOk';
  }
  if (level === 3) {
    next.toldTo = 'everyone';
    // A crew level has a card only if hers covers the signal; NASA's limit has its own.
    next.card = isCrew(alert) ? inputs.cardFor?.(alert.signal) ?? null : CARD_FOR[alert.signal] ?? null;
    next.alsoCard = urgentBeside(next.card);
    next.notAlone = true;
    next.medicalTeam ??= medicalTeam(crew, alert.person);
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

  // A limit broken in two or more rooms is a station-wide event. NASA's limits and the crew's levels are counted apart.
  const keyOf = (a: { signal: string; limitSource: string | null }) => (isCrew(a) ? `crew|${a.signal}` : a.signal);
  const roomsOver = new Map<string, Set<string>>();
  for (const alarm of inputs.roomAlarms) roomsOver.set(keyOf(alarm), (roomsOver.get(keyOf(alarm)) ?? new Set()).add(alarm.room));
  const wide = (key: string) => (roomsOver.get(key)?.size ?? 0) >= 2;
  const lowest = (signal: string, limit: number): Alert['lowestRoom'] => {
    let best: Alert['lowestRoom'] = null;
    for (const [room, value] of Object.entries(inputs.roomAverages?.[signal] ?? {})) {
      if (value <= limit && (!best || value < best.value)) best = { room, value };
    }
    return best;
  };
  // One message to Earth for the whole event: reuse one already sent about a
  // room that is over the limit now, by this step or the one before.
  const sentAlready = (key: string): Pick<Alert, 'earth' | 'earthId'> | null => {
    const sent = [...alerts, ...before].find((a) => a.reason === 'room-limit' && keyOf(a) === key && a.earth && a.room !== null && roomsOver.get(key)?.has(a.room));
    return sent ? { earth: sent.earth, earthId: sent.earthId ?? null } : null;
  };
  // A level 3 already active for someone else in this room: whoever walks in now is most likely helping.
  const levelThreeIn = (room: string, key: string, person: string) =>
    before.some((a) => a.level === 3 && a.reason === 'room-limit' && a.room === room && keyOf(a) === key && a.person !== person);

  // Rooms over a limit, for each person in them.
  for (const alarm of inputs.roomAlarms) {
    const key = keyOf(alarm);
    const crew = isCrew(alarm);
    for (const person of inputs.occupants[alarm.room] ?? []) {
      const id = `${person}|room-limit|${alarm.room}|${alarm.signal}${crew ? `|${alarm.source}` : ''}`;
      let alert = held.get(id);
      if (!alert) {
        const fresh: Alert = {
          id, person, level: 2, reason: 'room-limit', room: alarm.room, signal: alarm.signal, value: alarm.value, over: alarm.over ?? null, unit: alarm.unit,
          limit: alarm.limit, limitSource: alarm.limitSource, direction: alarm.direction === 'below' ? 'low' : 'high', kind: alarm.kind, since: now, levelSince: now, toldTo: [person], ...blank,
        };
        if (crew) fresh.textKey = `${CREW_ALERT_KEY}.${alarm.direction === 'below' ? 'below' : 'above'}`;
        alert = toLevel(fresh, 2, inputs, levelThreeIn(alarm.room, key, person));
        events.push({ type: 'raised', alert });
      } else {
        alert = { ...alert, value: alarm.value, over: alarm.over ?? null, kind: alarm.kind };
      }
      if (wide(key)) {
        if (alert.level !== 3) {
          const sent = sentAlready(key);
          alert = toLevel({ ...alert, stationWide: true }, 3, inputs);
          if (sent) Object.assign(alert, sent);
          events.push({ type: 'escalated', alert });
        }
        alert = withEarthCheck({ ...alert, stationWide: true, lowestRoom: crew ? null : lowest(alarm.signal, alarm.limit) }, inputs);
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

  // Her rules' findings: one alert each, at the level her limits give now.
  for (const f of mergePrivate(inputs.findings ?? [])) {
    // A private finding's id names no card: one per person, whatever raised it.
    const id = f.private ? `${f.person}|finding|${NEEDS_SOMEONE}` : `${f.person}|finding|${f.key}`;
    const was = held.get(id);
    let alert = findingAlert(was ?? null, f, id, inputs);
    if (!was) {
      if (!alert.held) events.push({ type: 'raised', alert });
    } else if (alert.level > was.level) {
      events.push({ type: 'escalated', alert });
    } else if (was.held && !alert.held) {
      events.push({ type: 'raised', alert });
    }
    alert = withEarthCheck(alert, inputs);
    alerts.push(alert);
  }

  // Base-wide events a person declared: a level 2 notice while expected, level 3 for everyone once it is here.
  for (const d of inputs.declared ?? []) {
    const was = held.get(d.id);
    const { id: _, card, ...rest } = d;
    const warning = d.expectedAt !== null && now < d.expectedAt;
    if (was && was.level === 3) { alerts.push(withEarthCheck(was, inputs)); continue; }
    const base = {
      id: d.id, person: d.by, reason: 'declared', room: null, signal: `event.${d.kind}`, value: null, unit: null, limit: null, limitSource: null,
      direction: null, kind: 'reported', since: was?.since ?? now, ...blank, toldTo: 'everyone', alsoCard: null, stationWide: true,
    } as const;
    if (warning) {
      // The time may move (POST /api/events/update): the notice follows, keeping who has seen it.
      alerts.push({ ...base, level: 2, levelSince: was?.levelSince ?? now, seenBy: was?.seenBy ?? null, seenAt: was?.seenAt ?? null, notice: true, declared: { ...rest, stage: 'warning' } });
      if (!was) events.push({ type: 'raised', alert: alerts[alerts.length - 1] });
      continue;
    }
    const alert = withEarthCheck({
      ...base, level: 3, levelSince: now, card, declared: { ...rest, stage: 'event' },
      earth: { sentAt: now, arrivesAt: now + inputs.delayToEarthMs, replyAt: now + 2 * inputs.delayToEarthMs }, earthId: `earth|${d.id}`,
    }, inputs);
    events.push({ type: was ? 'escalated' : 'raised', alert });
    alerts.push(alert);
  }

  const kept = new Set(alerts.map((a) => a.id));
  for (const alert of before) if (!kept.has(alert.id)) events.push({ type: 'resolved', alert });
  return { alerts, events };
}

/** Private findings, one per person: the highest level, and its card. */
function mergePrivate(findings: Finding[]): Finding[] {
  const top = new Map<string, Finding>();
  const out: Finding[] = [];
  for (const f of findings) {
    if (!f.private) { out.push(f); continue; }
    const held = top.get(f.person);
    if (!held || f.level > held.level || (f.level === held.level && !held.private?.card && f.private.card)) top.set(f.person, f);
  }
  return [...out, ...top.values()];
}

/** One finding as an alert: fresh, or the one before brought to the finding's level. */
function findingAlert(was: Alert | null, f: Finding, id: string, inputs: AlertInputs): Alert {
  const { now, crew, delayToEarthMs } = inputs;
  const asleep = inputs.asleep.includes(f.person);
  const priv = f.private ? { card: null, medicalOfficerSeesCard: f.private.medicalOfficerSeesCard } : null;
  const card = f.private ? null : f.card;
  const levelChanged = !was || was.level !== f.level;
  const next: Alert = {
    id, person: f.person, level: f.level, reason: 'finding', room: null,
    signal: f.private ? NEEDS_SOMEONE : f.signal ?? '', value: f.private ? null : f.value, unit: f.private ? null : f.unit,
    limit: f.private ? null : f.limit, limitSource: f.limitSource, direction: f.private ? null : f.direction, kind: f.kind,
    since: was?.since ?? now, levelSince: levelChanged ? now : was!.levelSince,
    askedAt: null, answerBy: null, answer: null, askKey: null, held: false, toldTo: [f.person], card,
    stationWide: false, lowestRoom: null, earth: null, earthId: null, seenBy: was?.seenBy ?? null, seenAt: was?.seenAt ?? null,
    ...(was && !levelChanged && was.settledAt !== undefined ? { settledBy: was.settledBy ?? null, settledAt: was.settledAt } : {}),
    alsoCard: f.private ? null : f.alsoCard ?? null, notAlone: false, private: priv, nextQuestion: f.private ? null : f.nextQuestion,
  };
  if (f.private) next.textKey = NEEDS_SOMEONE_KEY;
  // The person's own private card, kept for alertFor; never in the alert others get.
  if (f.private?.card) privateCards.set(id, f.private.card);
  else if (f.private) privateCards.delete(id);
  if (f.level === 1) {
    next.held = asleep;
    next.toldTo = asleep ? [] : [f.person];
  } else {
    next.medicalTeam = medicalTeam(crew, f.person);
    next.notAlone = true;
    next.toldTo = f.level === 2 ? [...new Set([f.person, ...next.medicalTeam])] : 'everyone';
  }
  if (f.level === 3) {
    next.alsoCard = urgentBeside(f.private ? null : f.card);
    // One message to Earth per level 3, kept while the alert stays at 3.
    if (was && was.level === 3 && was.earth) Object.assign(next, { earth: was.earth, earthId: was.earthId });
    else {
      next.earth = { sentAt: now, arrivesAt: now + delayToEarthMs, replyAt: now + 2 * delayToEarthMs };
      next.earthId = `earth|${id}|${now}`;
    }
  }
  return next;
}

/** Private cards by alert id. Module state, read only by alertFor; an id is unique per person and finding. */
const privateCards = new Map<string, string>();

/**
 * The alert as one viewer receives it ('common' for a shared screen). A
 * private card goes to the person, and to the medical team when her rule
 * allows; to anyone else the alert says only that the person needs someone.
 */
export function alertFor(alert: Alert, viewer: string | 'common'): Alert {
  if (!alert.private) return alert;
  const card = privateCards.get(alert.id) ?? null;
  const team = viewer !== 'common' && (alert.medicalTeam ?? []).includes(viewer);
  if (viewer === alert.person || (team && alert.private.medicalOfficerSeesCard)) return { ...alert, card, private: { ...alert.private, card } };
  return { ...alert, card: null, private: { card: null, medicalOfficerSeesCard: alert.private.medicalOfficerSeesCard } };
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
    if ((e.type !== 'escalated' && !(e.type === 'raised' && (a.reason === 'finding' || a.reason === 'declared'))) || a.level !== 3 || !a.earth || !a.earthId || listed.has(a.earthId)) continue;
    listed.add(a.earthId);
    before = [...before, {
      id: a.earthId, kind: 'alert', about: { person: a.person, room: a.room, signal: a.signal, level: a.level, stationWide: a.stationWide },
      ...a.earth, delivered: false, reply: null, resolvedAt: null,
    }];
  }
  const live = new Set(alerts.map((a) => a.earthId).filter(Boolean));
  for (const m of before) {
    const resolvedAt = m.resolvedAt ?? (live.has(m.id) ? null : now);
    if (resolvedAt !== null && now >= m.replyAt + EARTH_KEEP_MS) continue;
    const delivered = now >= m.arrivesAt;
    out.push(resolvedAt === m.resolvedAt && delivered === m.delivered ? m : { ...m, resolvedAt, delivered });
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
    if (alert.id !== id || (alert.level !== 3 && !alert.notice) || alert.seenAt) return alert;
    seen = true;
    return { ...alert, seenBy: by, seenAt: now };
  });
  return { alerts: next, seen };
}

/** Whether this occurrence of a level 3 was marked settled (a new levelSince is a new occurrence). */
export function isSettled(alert: Alert): boolean {
  return alert.level === 3 && typeof alert.settledAt === 'number' && alert.settledAt >= alert.levelSince;
}

/**
 * "Emergency settled" on a level 3, from anyone. Records who and when; the level, the alert and any
 * room alarm stay. A declared base-wide event has its own end (events/end) and is not settled here.
 */
export function settleAlert(alerts: Alert[], id: string, by: string | null, now: number): { alerts: Alert[]; settled: boolean } {
  let settled = false;
  const next = alerts.map((alert) => {
    if (alert.id !== id || alert.level !== 3 || alert.declared || isSettled(alert)) return alert;
    settled = true;
    return { ...alert, settledBy: by, settledAt: now };
  });
  return { alerts: next, settled };
}

/** Records the person's answer to "Are you OK?". "help" escalates on the next step. */
export function answerAlert(alerts: Alert[], id: string, answer: 'ok' | 'help'): { alerts: Alert[]; event: AlertEvent | null } {
  let event: AlertEvent | null = null;
  const next = alerts.map((alert) => {
    if (alert.id !== id || alert.level !== 2 || alert.notice || alert.answer !== null) return alert;
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
  const everyone = boardRooms.length > 0 && alerts.some((a) => a.level === 3 && !a.seenAt && !isSettled(a) && a.answer !== 'ok');
  return ownRoom || everyone;
}

/** The alerts one viewer may see. The common screen sees only what everyone is told. */
export function visibleTo(alerts: Alert[], viewer: string | 'common'): Alert[] {
  return alerts.filter((a) => a.toldTo === 'everyone' || (viewer !== 'common' && a.toldTo.includes(viewer)));
}
