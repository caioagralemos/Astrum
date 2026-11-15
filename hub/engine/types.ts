// The shapes every part of Astrum shares: hub core, interface, web replay.
// Pure types, no runtime code, so this file loads anywhere.

/** How a value came to exist. Shown on screen beside every reading. */
/**
 * - measured: a sensor read it here and now.
 * - estimated: worked out from something measured.
 * - reported: said by the person (a check-in answer, "I have a headache").
 * - replayed: a real measurement from somewhere else (NASA's ISS record), played back here.
 * - simulated: made up.
 * Production keeps only the first three.
 */
export type Kind = 'measured' | 'estimated' | 'reported' | 'replayed' | 'simulated';

export const KINDS: readonly Kind[] = ['measured', 'estimated', 'reported', 'replayed', 'simulated'];

/**
 * Which kind wins where sources compete for the same reading: lower is better.
 * A person's own answer is real but not an instrument, so it comes after
 * anything measured or worked out here, and before anything from elsewhere.
 */
export const KIND_RANK: Record<Kind, number> = { measured: 0, estimated: 1, reported: 2, replayed: 3, simulated: 4 };

/** True for values that did not come from this place's own sensors. */
export function isDemoOnly(kind: Kind): boolean {
  return kind === 'replayed' || kind === 'simulated';
}

/**
 * One row of the timeline. Body readings, cabin readings, mission events and
 * check-in answers are all rows, so anything lines up with anything by time,
 * person and room.
 */
export interface Row {
  id?: number;
  /** When it was true, in milliseconds since 1970 (UTC). */
  t: number;
  /** What was read, e.g. "co2", "heart_rate", "checkin.headache". */
  signal: string;
  /** The number, or null when the row carries only text. */
  value: number | null;
  /** Free text for events and answers. */
  text?: string | null;
  unit: string;
  kind: Kind;
  /** Who or what produced it, e.g. "chip:cabin-1", "nasa:osdr-rr1", "phone:reyes". */
  source: string;
  /** Whose body, if it is a body reading. */
  person?: string | null;
  /** Which room, if it is a cabin reading (or where the body reading was taken). */
  room?: string | null;
}

/** Where one crewmate was, from when until when. Open stays have until = null. */
export interface Stay {
  id?: number;
  person: string;
  room: string;
  from: number;
  until: number | null;
  kind: Kind;
  source: string;
}

export interface Room {
  id: string;
  /** Key in the string table. */
  name: string;
}

export interface Person {
  id: string;
  name: string;
  /** Key in the string table, e.g. "role.cmo". */
  role: string;
  /** How the hub and the model refer to this person. Unset means they/them. */
  pronouns?: 'she' | 'he' | 'they';
  /** A photo of them (an image address), if the mission gives one. Screens draw a plain outline without it. */
  portrait?: string;
}

/**
 * What the hub tells screens about the mission it runs (engine/mission.ts):
 * where the place is, its gravity and how long the mission lasts. Facts of
 * the place, with no medical meaning.
 */
export interface MissionFacts {
  /** The mission file's own id (the ship's is "mars-orbit"). */
  id: string;
  /** The file it was read from, without ".json": what ASTRUM_MISSION names. */
  file: string;
  kind: 'ship' | 'station' | 'base';
  where: { body: 'earth' | 'moon' | 'mars' | null; situation: 'orbit' | 'transit' | 'surface' };
  /** In g. 0 means everyone floats. */
  gravity: number;
  plannedDays: number;
  /** Key in the string table, if the mission has one (text the crew typed, on a mission they made). */
  destination?: string;
  /** The name the crew typed for a mission they made; shown instead of the profile's place key. */
  nameText?: string;
  /** True for a mission the crew made from another (engine/custom.ts). */
  custom?: boolean;
  /** The station clock against UTC, in minutes: the hub's time zone, which the simulated crew keeps. The mission day turns at its midnight. */
  clockOffsetMinutes?: number;
}

/** The environment this hub is installed in. One settings file per place. */
export interface Profile {
  id: string;
  /** Key in the string table. */
  place: string;
  /** Mission start, ISO date. */
  missionStart: string;
  /** One-way delay to Earth in seconds. */
  delayToEarthSeconds: number;
  rooms: Room[];
  crew: Person[];
  /** Which room each chip sits in, by the id the chip announces. */
  chips: Record<string, string>;
  /** Present when the hub runs a mission file. Older profiles and recordings have none. */
  mission?: MissionFacts;
}

/** What a sensor source says about itself when it connects. */
export interface SourceStatus {
  id: string;
  connected: boolean;
  room: string | null;
  /** Signals it is sending now. */
  live: string[];
  /** Signals it has a driver for but whose part is not answering. */
  missing: string[];
  lastSeen: number | null;
  /** A sensor board's Bluetooth room beacon (chip/README.md): "on" while it advertises. Absent when the board does not say. */
  ble?: 'on' | 'off';
}

import type { RoomAlarm, Unjudged } from './cabin.ts';
import type { CrewWatch } from './sensors.ts';
import type { Alert, EarthMessage } from './alerts.ts';
import type { Stuck } from './quality.ts';
import type { Evidence } from './evidence.ts';
import type { Activity } from './activity.ts';
import type { PersonDose } from './dose.ts';

/** Readings refused at ingest because no working sensor could give them (quality.ts BOUNDS). */
export interface Rejected {
  source: string;
  signal: string;
  unit: string;
  /** The bound that was broken. */
  min: number | null;
  max: number | null;
  count: number;
  lastValue: number;
  lastAt: number;
}

/** What the hub knows is wrong with its readings: refused, unjudged, maybe stuck. */
export interface Quality {
  rejected: Rejected[];
  unjudged: Unjudged[];
  stuck: Stuck[];
}

/**
 * Carried by every message of a simulated scenario (core/scenario.ts), so a
 * screen can say "Simulated scenario". Live messages never carry it.
 */
export interface ScenarioFlag {
  id: string;
  /** Key in the string table for the label the screen shows. */
  label: string;
  /** The scenario's own clock at this message, in milliseconds. */
  at: number;
  /** How fast it plays here: scenario milliseconds per real millisecond. */
  speed: number;
}

/**
 * Messages between the hub and anything connected to it.
 * - state.now and clock.now are the hub's clock: a screen ticks on its own
 *   clock plus the difference (timeline.ts clockOffset). The hub sends "clock"
 *   every 10 seconds.
 * - asleep: crew ids the hub counts as asleep, sent when it changes. Always
 *   the sleepers of `activity`, so the two never disagree.
 * - activity: what each crewmate is doing as far as the hub knows (sleeping,
 *   exercising, eating or none), labelled with how it is known
 *   (engine/activity.ts), sent when it changes. Absent from older hubs and recordings.
 * - earth: every message to Earth still listed, sent when the list changes.
 * - evidence: one crewmate's evidence card, sent when it changes in substance
 *   (and at least every few minutes). state.evidence holds every card so far,
 *   by crew id, so a screen can show anyone's card without asking.
 * - crewWatch: rooms past a "warn" level the crew set on one of their own
 *   sensors (engine/sensors.ts). Not an alarm: the room is marked "watch".
 *   Sent with every alarms message; absent from older hubs and recordings.
 * - dose: every crewmate's radiation dose by crew id (engine/dose.ts), an
 *   estimate from room rates and stays, or simulated; never measured. Sent when
 *   it changes; state.dose holds the latest. Absent from older hubs and
 *   recordings, and empty with no radiation source.
 */
export type HubMessage = (
  | {
    type: 'state'; now: number; profile: Profile; latest: Row[]; stays: Stay[]; sources: SourceStatus[]; alarms: RoomAlarm[]; alerts: Alert[]; quality?: Quality;
    asleep?: string[]; earthMessages?: EarthMessage[]; evidence?: Record<string, Evidence & { computedAt?: number }>; crewWatch?: CrewWatch[];
    activity?: Record<string, Activity>; dose?: Record<string, PersonDose>;
  }
  | { type: 'alarms'; alarms: RoomAlarm[]; unjudged?: Unjudged[]; stuck?: Stuck[]; crewWatch?: CrewWatch[] }
  | { type: 'alerts'; alerts: Alert[] }
  | { type: 'earth'; earthMessages: EarthMessage[] }
  | { type: 'asleep'; asleep: string[] }
  | { type: 'activity'; activity: Record<string, Activity> }
  | { type: 'clock'; now: number }
  | { type: 'rows'; rows: Row[] }
  | { type: 'stay'; stays: Stay[] }
  | { type: 'sources'; sources: SourceStatus[] }
  | { type: 'evidence'; person: string; evidence: Evidence & { computedAt?: number } }
  | { type: 'dose'; dose: Record<string, PersonDose> }
  /** The hub is about to restart on another mission (`to`, a mission file): screens wait for its new state. */
  | { type: 'restarting'; to: string }
) & { scenario?: ScenarioFlag };

/** What a recording says about itself. Every field is optional for older files. */
export interface RecordingMeta {
  id: string;
  title: string;
  /** The recording's first and last moment, on its own clock. */
  startsAt: number;
  endsAt: number;
  /**
   * How fast to play it: each entry is [moment, speed], the speed (recording
   * milliseconds per real millisecond) holding from that moment to the next.
   */
  speed: [number, number][];
  /** String-table keys for what the screen shows about it. */
  labels: Record<string, string>;
  /** The story's moments, in order, for captions and for people reading the file. */
  moments: { at: number; what: string }[];
  /** Anything else the file wants to state about where its values came from. */
  [key: string]: unknown;
}

/** A recorded file: the messages the hub sent, each with the moment it was sent. */
export interface Recording {
  meta?: RecordingMeta;
  messages: { at: number; message: HubMessage }[];
}

export type ClientMessage =
  | { type: 'hello'; role: 'hub' | 'screen' | 'phone'; person?: string }
  | { type: 'readings'; source: string; rows: Row[] };
