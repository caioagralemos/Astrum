// The demo's story as a one-button run: "Reyes's night".
//
// recordReyesNight() builds a whole hub in memory (its own database, crew,
// NASA replay, stand-in, alarms, alert levels, baselines), fills three days of
// history, then plays one night on its own clock, ten seconds at a time,
// following SCRIPT below. Every message the hub would have sent a screen is
// kept with its moment: that list is the recording. The browser plays it with
// no server (ui/src/data.ts RecordedSource); the live hub plays it to every
// screen and phone for filming (ScenarioPlayer). The same inputs always give
// the same file: no random numbers and no wall clock go into it.
//
// What is real and what is not:
// - Every room's CO2, temperature and humidity are NASA's ISS record, replayed
//   (core/nasa.ts). For the climb, Quarters 2 is moved to a stretch of the
//   record where the 1-hour average genuinely crosses 3 mmHg; for the
//   recovery, to a calm stretch. Values are never changed. The file lists
//   which record times play where.
// - The crew, their bodies, where they are and where they go are simulated.
//   Nothing here changes Reyes's body readings: they are the ordinary
//   simulated ones, and the room tells the story.
// - Every message carries a flag that says it is a simulated scenario.
//
// The story happens on the ship (profiles/missions/ship-mars-orbit.json),
// whatever mission the live hub runs: its rooms, crew schedule and replay are
// the ship's. A hub running another mission refuses to play it.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Store } from './db.ts';
import { Hub } from './server.ts';
import { StandIn } from './standin.ts';
import { SimulatedCrew } from './crew.ts';
import { NasaReplay, NASA_SOURCE } from './nasa.ts';
import { RoomAlarms } from './alarms.ts';
import { AlertWatcher, crewActivity } from './alerts.ts';
import { Baselines } from './baseline.ts';
import { EvidenceCards } from './evidence.ts';
import { demoBloodRows, loadInspiration4 } from './blood.ts';
import { placesOf } from '../engine/crew.ts';
import { hubProfileOf } from '../engine/mission.ts';
import type { Mission } from '../engine/mission.ts';
import { FRESH_MS, scopeOf } from '../engine/timeline.ts';
import { realOffset, speedAt, speedProfile } from '../engine/playback.ts';
import type { SpeedProfile } from '../engine/playback.ts';
import type { AlertEvent } from '../engine/alerts.ts';
import type { HubMessage, Profile, Recording, Row, ScenarioFlag, Stay } from '../engine/types.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** The scenario's clock moves ten seconds at a time. */
const STEP_MS = 10_000;
/** A screen counts a reading as current for 30 seconds, so each one is recorded at least that often. */
const KEEP_MS = FRESH_MS;
/** A night that has not ended after this long has gone wrong. */
const MAX_NIGHT_MS = 8 * HOUR;

export const SCENARIO_ID = 'reyes-night';
/** Where the scenario's people move to and from: simulated stays, from this source. */
export const SCENARIO_SOURCE = 'sim:scenario';
/**
 * The station clock: UTC-3, the clock the demo hub keeps in Recife. Pinned, so
 * the crew's night and the replay's mapping never depend on where or when the
 * recording is made.
 */
export const STATION_OFFSET_MINUTES = -180;
/**
 * 00:30 on Sunday 15 Nov 2026, station clock: the night after Reyes's third
 * headache morning. The three days before it are act 1, from the live data's
 * own generators.
 */
export const STARTS_AT = Date.UTC(2026, 10, 15, 3, 30);
/**
 * The climb: NASA's record from 21 Oct 2014 22:44 UTC (on the replay's 5-minute
 * grid; the sample itself is stamped 22:43). It had been under the
 * 3 mmHg 1-hour limit for the 55 hours before; the raw value steps from 2.79
 * to 2.94 ten minutes later, keeps climbing to 3.17, and the record's own
 * 1-hour average passes 3 at 23:54 and stays over for four hours. Of the
 * record's 19 crossings this is the cleanest from below.
 */
export const CLIMB_FROM = '2014-10-21T22:44:00Z';
/** The recovery: a calm stretch of the record, 15 Oct 2014 from 00:39 UTC, 2.37 to 2.45 mmHg for three hours. */
export const CALM_FROM = '2014-10-15T00:39:00Z';
const ROOM = 'quarters-2';
/** The mission file the story belongs to. */
export const STORY_MISSION = 'ship-mars-orbit';

/** The ship's mission file, which the story is pinned to. */
export function shipMission(hubDir: string): Mission {
  return JSON.parse(readFileSync(join(hubDir, 'profiles', 'missions', `${STORY_MISSION}.json`), 'utf8')) as Mission;
}

/** The anchors a cue can wait for. Cues can add their own with `marks`. */
type Anchor = 'start' | 'air-stops' | 'alarm' | 'level-3' | 'seen' | 'okafor-arrives' | 'restored' | 'clear';

type Action =
  | { do: 'air-stops' }
  | { do: 'air-restored' }
  | { do: 'move'; person: string; room: string }
  | { do: 'acknowledge'; room: string }
  | { do: 'see'; person: string; by: string }
  | { do: 'end' };

export interface Cue {
  /** What it waits for, and how long after it. */
  after: Anchor;
  ms: number;
  action: Action;
  /** Names this moment, so later cues can wait for it. */
  marks?: Anchor;
  says: string;
}

/**
 * The night. Moments the hub itself decides (the alarm, the alert levels, the
 * alarm clearing) are not scripted: the cues only wait for them.
 */
export const SCRIPT: Cue[] = [
  { after: 'start', ms: 5 * MIN, action: { do: 'air-stops' }, marks: 'air-stops', says: 'The air stops moving in Quarters 2: the room plays the climb in NASA\'s record' },
  { after: 'level-3', ms: MIN, action: { do: 'see', person: 'reyes', by: 'okafor' }, marks: 'seen', says: 'Okafor taps "I\'ve seen it" on Reyes\'s level 3 and heads to Quarters 2' },
  { after: 'level-3', ms: 3 * MIN, action: { do: 'move', person: 'okafor', room: ROOM }, marks: 'okafor-arrives', says: 'Okafor, the Crew Medical Officer, reaches Quarters 2' },
  { after: 'okafor-arrives', ms: 0, action: { do: 'acknowledge', room: ROOM }, says: 'Okafor silences the room alarm' },
  { after: 'okafor-arrives', ms: 30_000, action: { do: 'move', person: 'reyes', room: 'galley' }, says: 'Okafor gets Reyes out to the galley' },
  { after: 'okafor-arrives', ms: 30_000, action: { do: 'move', person: 'okafor', room: 'galley' }, says: 'Okafor goes with her' },
  { after: 'okafor-arrives', ms: 2 * MIN, action: { do: 'air-restored' }, marks: 'restored', says: 'Airflow restored: the room plays a calm stretch of NASA\'s record' },
  { after: 'clear', ms: 3 * MIN, action: { do: 'end' }, says: 'The end' },
];

/**
 * How fast each part plays, as [anchor, minutes after it, speed]. About two
 * minutes in all: slow for the alarm, the countdown and level 3, fast through
 * the hour the 1-hour average needs to pass the limit.
 */
const PACE: [Anchor, number, number][] = [
  ['start', 0, 60],
  ['air-stops', 1, 360],
  ['alarm', -4, 24],
  ['alarm', 0, 4],
  ['level-3', 0, 8],
  ['okafor-arrives', 0, 4],
  ['restored', 0, 15],
];

/** A repeatable stream of numbers from 0 to 1 (mulberry32), for the stand-in. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The station clock's time of day, for people reading the summary. */
export function stationTime(t: number): string {
  return new Date(t + STATION_OFFSET_MINUTES * MIN).toISOString().slice(11, 19);
}

function describe(e: AlertEvent): string {
  const a = e.alert;
  const told = a.toldTo === 'everyone' ? 'everyone' : a.toldTo.join(' and ');
  if (e.type === 'resolved') return `${a.person}: alert resolved (was level ${a.level})`;
  let text = `${a.person}: level ${a.level} ${e.type}, ${a.reason} in ${a.room ?? '-'}${a.over ? ` (${a.over} ${a.unit} over)` : ''}, told to ${told}`;
  if (a.level === 2 && a.answerBy) text += `, ${a.askKey === 'alert.enteredOverLimit' ? '"You entered a room over the limit"' : '"Are you OK?"'} countdown ${(a.answerBy - a.levelSince) / 1000} s`;
  if (a.level === 3 && a.card) text += `, steps card ${a.card}`;
  if (a.level === 3 && a.earth) text += `, message to Earth arrives ${stationTime(a.earth.arrivesAt)}, reply ${stationTime(a.earth.replyAt)}`;
  return text;
}

export interface RecordedNight {
  recording: Recording;
  /** A short human timeline of what happened. */
  summary: string[];
}

/**
 * Records "Reyes's night". `hubDir` is the hub folder (for NASA's data and the
 * ship's mission file). The profile defaults to the ship's; the crew's day is
 * always the ship's.
 */
export function recordReyesNight(hubDir: string, profile: Profile = hubProfileOf(shipMission(hubDir), STORY_MISSION)): RecordedNight {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  try {
    return play(hub, store, hubDir, profile);
  } finally {
    store.close();
    hub.http.close();
  }
}

function play(hub: Hub, store: Store, hubDir: string, profile: Profile): RecordedNight {
  const rooms = profile.rooms.map((r) => r.id);
  const people = profile.crew.map((p) => p.id);
  const places = placesOf(shipMission(hubDir));
  const crew = new SimulatedCrew(hub, store, people, STATION_OFFSET_MINUTES, places);
  const nasa = new NasaReplay(hub, store, join(hubDir, 'data-nasa', 'osdr-rr1'), rooms, ROOM);
  const standIn = new StandIn(hub, rooms, seeded(20261115));
  const alarms = new RoomAlarms(hub, store, rooms);
  const alerts = new AlertWatcher(hub, store, profile, alarms);
  const baselines = new Baselines(store, people, STATION_OFFSET_MINUTES);
  alerts.unusual = (now) => baselines.sustained(now);
  // What each crewmate is doing, from the crew's day on the station clock: asleep in their own
  // quarters at night (Reyes, until Okafor gets her out), the same rule the live hub keeps.
  alerts.activity = (now) => crewActivity(store, people, now, { places, offsetMinutes: STATION_OFFSET_MINUTES });
  // Evidence cards as the live hub keeps them: one person per step, at once for a person whose
  // alert changed, sent only when a card changes in substance (no periodic resend: the file stays small).
  const cards = new EvidenceCards({ store, profile, baselines, alarms, offsetMinutes: STATION_OFFSET_MINUTES });
  cards.resendMs = Infinity;
  cards.onChange = (person, card) => hub.setEvidence(person, card);

  let clock = STARTS_AT;
  const at: Partial<Record<Anchor, number>> = { start: STARTS_AT };
  const moments: { at: number; what: string }[] = [];
  const say = (what: string) => moments.push({ at: clock, what });
  // The board's buzzer, as the hub decides it (Hub.soundBoard). No chip is attached here.
  const boards = [...new Set(Object.values(profile.chips))].join(' and ');
  hub.chipCommand = (command) => {
    if (command.buzz === 'alarm') say(`The board in ${boards} sounds its buzzer`);
    if (command.buzz === 'off') say(`The board in ${boards} goes quiet`);
    return false;
  };
  alerts.onEvent = (e) => {
    say(describe(e));
    cards.refresh(e.alert.person, clock);
    if (e.type === 'escalated' && e.alert.level === 3 && e.alert.person === 'reyes') at['level-3'] ??= clock;
  };

  // Which record time plays in Quarters 2, stretch by stretch.
  const q2Plays: { from: number; until: number; recordFrom: number; recordUntil: number }[] = [];
  const moveQ2To = (record: string) => {
    const open = q2Plays[q2Plays.length - 1];
    if (open) { open.until = clock; open.recordUntil = nasa.recordTime(ROOM, clock); }
    nasa.aheadMs += Date.parse(record) - nasa.recordTime(ROOM, clock);
    q2Plays.push({ from: clock, until: clock, recordFrom: nasa.recordTime(ROOM, clock), recordUntil: 0 });
  };

  // Act 1: the three days before tonight, as the live hub fills them at startup.
  crew.catchUp(STARTS_AT);
  nasa.catchUp(STARTS_AT);
  hub.ingest(demoBloodRows(loadInspiration4(join(hubDir, 'data-nasa', 'inspiration4')), 'C001', 'okafor',
    [{ timepoint: 'L-3', t: STARTS_AT - 14 * DAY }, { timepoint: 'R+1', t: STARTS_AT - 2 * DAY }]));

  let ended = false;
  const fired = new Set<Cue>();
  const runCues = (t: number) => {
    for (const cue of SCRIPT) {
      const anchor = at[cue.after];
      if (fired.has(cue) || anchor === undefined || t < anchor + cue.ms) continue;
      fired.add(cue);
      say(cue.says);
      const a = cue.action;
      if (a.do === 'air-stops') moveQ2To(CLIMB_FROM);
      if (a.do === 'air-restored') moveQ2To(CALM_FROM);
      if (a.do === 'move') hub.move(a.person, a.room, t, 'simulated', SCENARIO_SOURCE);
      if (a.do === 'acknowledge') alarms.acknowledge(a.room);
      if (a.do === 'see') {
        const alert = alerts.list().find((x) => x.person === a.person && x.level === 3);
        if (alert) alerts.see(alert.id, a.by, t);
      }
      if (a.do === 'end') ended = true;
      if (cue.marks) at[cue.marks] = t;
    }
  };

  const step = (t: number) => {
    clock = t;
    runCues(t);
    hub.ingest(nasa.at(t));
    crew.step(t);
    hub.ingest(standIn.tick(t));
    alarms.check(t);
    const alarm = alarms.list().find((a) => a.room === ROOM && a.signal === 'co2');
    if (alarm && at.alarm === undefined) {
      at.alarm = t;
      say(`Room alarm: Quarters 2's 1-hour CO2 average is ${alarm.value} mmHg, ${alarm.over} over NASA's ${alarm.limit} mmHg limit`);
    }
    if (!alarm && at.alarm !== undefined && at.restored !== undefined && at.clear === undefined) {
      at.clear = t;
      say(`Room alarm clears: Quarters 2's 1-hour CO2 average is back to ${alarms.averages.co2?.[ROOM]} mmHg`);
    }
    alerts.check(t);
    cards.tick(t);
  };

  // The first step happens before recording, so the first message is a whole, judged station.
  step(STARTS_AT);
  q2Plays.push({ from: STARTS_AT, until: STARTS_AT, recordFrom: nasa.recordTime(ROOM, STARTS_AT), recordUntil: 0 });
  // Every card is ready before the first message, so the first screenful carries them all.
  for (const person of people) cards.refresh(person, STARTS_AT);
  const actOne = cards.get('reyes');
  say(`Night, ${stationTime(STARTS_AT)} station clock. Reyes asleep in Quarters 2. No alarm. Her evidence card points to: ${actOne.pointsTo}${actOne.focusRoom ? ` (${actOne.focusRoom})` : ''}`);

  const raw: { at: number; message: HubMessage }[] = [];
  const first = hub.state(STARTS_AT);
  raw.push({ at: STARTS_AT, message: first });

  // Readings are thinned to what a screen needs; everything else is kept as sent.
  const lastKept = new Map<string, { t: number; value: number | null }>();
  const keyOf = (r: Row) => `${scopeOf(r)}|${r.source}`;
  if (first.type === 'state') for (const r of first.latest) lastKept.set(keyOf(r), { t: r.t, value: r.value });
  let made = 0;
  let keptRows = 0;
  const thin = (rows: Row[]) => rows.filter((row) => {
    made++;
    const held = lastKept.get(keyOf(row));
    const keep = !held || row.t - held.t >= KEEP_MS || (row.kind === 'replayed' && row.value !== held.value);
    if (keep) { lastKept.set(keyOf(row), { t: row.t, value: row.value }); keptRows++; }
    return keep;
  });

  let pending: HubMessage[] = [];
  hub.onBroadcast = (message) => void pending.push(message);
  for (let t = STARTS_AT + STEP_MS; !ended; t += STEP_MS) {
    if (t - STARTS_AT > MAX_NIGHT_MS) throw new Error(`the night did not end; moments so far: ${moments.map((m) => m.what).join(' / ')}`);
    step(t);
    const rows = thin(pending.flatMap((m) => (m.type === 'rows' ? m.rows : [])));
    if (rows.length) raw.push({ at: t, message: { type: 'rows', rows } });
    for (const m of pending) if (m.type !== 'rows') raw.push({ at: t, message: m });
    pending = [];
  }
  hub.onBroadcast = () => {};
  const endsAt = clock;
  for (const m of alerts.earthMessages()) {
    const reply = m.replyAt > endsAt ? `reply can arrive ${stationTime(m.replyAt)}, still pending` : 'reply due';
    say(`At the end: message to Earth about ${m.about.person} (sent ${stationTime(m.sentAt)}) still listed, ${m.resolvedAt ? `alert ended ${stationTime(m.resolvedAt)}` : 'alert still active'}, ${reply}`);
  }
  q2Plays[q2Plays.length - 1].until = endsAt;
  q2Plays[q2Plays.length - 1].recordUntil = nasa.recordTime(ROOM, endsAt);

  // The pace, from when things actually happened.
  const speed: SpeedProfile = speedProfile(PACE.map(([anchor, minutes, v]) => [at[anchor]! + minutes * MIN, v]), STARTS_AT);
  const flag = (t: number): ScenarioFlag => ({ id: SCENARIO_ID, label: 'scenario.simulated', at: t, speed: speedAt(speed, t) });
  const messages = raw.map(({ at: t, message }) => ({ at: t, message: { ...message, scenario: flag(t) } as HubMessage }));

  const iso = (t: number) => new Date(t).toISOString().replace('.000', '');
  nasa.aheadMs = 0;
  const plays = [
    ...q2Plays.map((p) => ({ room: ROOM, from: p.from, until: p.until, recordFrom: iso(p.recordFrom), recordUntil: iso(p.recordUntil) })),
    ...rooms.filter((r) => r !== ROOM).map((room) => ({ room, from: STARTS_AT, until: endsAt, recordFrom: iso(nasa.recordTime(room, STARTS_AT)), recordUntil: iso(nasa.recordTime(room, endsAt)) })),
  ];

  const recording: Recording = {
    meta: {
      id: SCENARIO_ID,
      title: 'Reyes\'s night',
      startsAt: STARTS_AT,
      endsAt,
      speed,
      labels: { scenario: 'scenario.simulated', title: 'scenario.reyes-night' },
      moments,
      // The web replay's context card before it plays (ui/src/demo/Intro.tsx).
      intro: {
        title: { en: 'One night on a ship in Mars orbit.', pt: 'Uma noite numa nave em órbita de Marte.' },
        lines: [
          { en: 'Reyes is asleep in her quarters.', pt: 'Reyes dorme em seus aposentos.' },
          { en: 'The air in her room is about to change.', pt: 'O ar do quarto dela está prestes a mudar.' },
        ],
      },
      stationOffsetMinutes: STATION_OFFSET_MINUTES,
      actOne: { person: 'reyes', pointsTo: actOne.pointsTo, focusRoom: actOne.focusRoom },
      record: {
        source: NASA_SOURCE,
        files: 'data-nasa/osdr-rr1/co2.json, temperature-iss.json, humidity-iss.json (NASA OSDR, ISS, RR-1, 20 Sep to 1 Nov 2014)',
        conversion: 'CO2 in mmHg = co2_iss (read as ppm) x 760 / 1,000,000, rounded to 2 decimals',
        rule: 'A row at scenario time t in a room plays that room\'s record time recordFrom + (t - from), on the record\'s 5-minute grid counted from its first row (2014-09-20T03:59Z): the grid slot at or before that time. The record\'s own timestamps drift up to 2 minutes from that grid (the sample stamped 22:43 sits in the 22:44 slot); a slot with no sample repeats the one before (11 of 12,096).',
        plays,
      },
      notes: [
        'Simulated scenario. The crew, their bodies, where they are and where they move are simulated.',
        'Every room\'s CO2, temperature and humidity are NASA\'s ISS record, replayed unchanged: real values, another place and date.',
        `Quarters 2 plays three stretches of the record: the one the live demo plays, then the climb from ${CLIMB_FROM}, then a calm stretch from ${CALM_FROM}. The climb past 3 mmHg is the record's own. The recovery is a jump to a calm stretch, because nothing in the record falls fast from above 3 mmHg.`,
        'The room alarm judges the 1-hour average of the replayed rows stored in the room, so for the first hour of the climb it mixes the stretch before the air stopped with the climb.',
        'Reyes\'s body readings are the ordinary simulated ones; nothing in the scenario changes them.',
        'Pressure, oxygen, noise, light, vibration, air quality and radiation are the hub\'s simulated stand-in values.',
        `Thinned for size: each signal of each room and person is kept at most once every ${KEEP_MS / 1000} seconds of the scenario's clock (a screen counts a reading as current for that long), and a replayed value also whenever it changes. The hub made ${made} rows during the night; this file keeps ${keptRows}. Every other message is kept as sent.`,
      ],
    },
    messages,
  };

  const real = (t: number) => realOffset(speed, STARTS_AT, t) / 1000;
  const summary = [
    `Reyes's night: ${new Date(STARTS_AT).toISOString().slice(0, 10)} (UTC), station clock UTC${STATION_OFFSET_MINUTES / 60}. Plays in about ${Math.round(real(endsAt))} s.`,
    ...moments.map((m) => `  ${stationTime(m.at)}  (+${real(m.at).toFixed(1).padStart(5)} s)  ${m.what}`),
    'NASA record times played in Quarters 2:',
    ...q2Plays.map((p) => `  ${stationTime(p.from)} to ${stationTime(p.until)}: record ${iso(p.recordFrom)} to ${iso(p.recordUntil)}`),
    `Rows: the hub made ${made} during the night; the file keeps ${keptRows}. ${messages.length} messages.`,
  ];
  return { recording, summary };
}

type StateMessage = Extract<HubMessage, { type: 'state' }>;

/** What a screen would hold after one more message: the same as the interface's apply(), on the hub. */
function fold(state: StateMessage, message: HubMessage, at: number): StateMessage {
  const next: StateMessage = { ...state, now: at, scenario: message.scenario };
  if (message.type === 'state') return { ...message, now: at };
  if (message.type === 'rows') {
    const latest = new Map(state.latest.map((r) => [`${scopeOf(r)}|${r.source}`, r]));
    for (const row of message.rows) {
      const held = latest.get(`${scopeOf(row)}|${row.source}`);
      if (!held || row.t >= held.t) latest.set(`${scopeOf(row)}|${row.source}`, row);
    }
    next.latest = [...latest.values()];
  }
  if (message.type === 'stay') {
    const stays = new Map<number | undefined, Stay>(state.stays.map((s) => [s.id, s]));
    for (const stay of message.stays) stays.set(stay.id, stay);
    next.stays = [...stays.values()];
  }
  if (message.type === 'alarms') {
    next.alarms = message.alarms;
    if (state.quality) next.quality = { ...state.quality, unjudged: message.unjudged ?? state.quality.unjudged, stuck: message.stuck ?? state.quality.stuck };
  }
  if (message.type === 'alerts') next.alerts = message.alerts;
  if (message.type === 'earth') next.earthMessages = message.earthMessages;
  if (message.type === 'asleep') next.asleep = message.asleep;
  if (message.type === 'activity') next.activity = message.activity;
  if (message.type === 'sources') next.sources = message.sources;
  if (message.type === 'evidence') next.evidence = { ...state.evidence, [message.person]: message.evidence };
  if (message.type === 'dose') next.dose = message.dose;
  return next;
}

/** Reads a recording from a folder by id, or null if there is none. */
export function loadRecording(dir: string, id: string): Recording | null {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) return null;
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as Recording;
}

/** The recordings in a folder, by id. */
export function listRecordings(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

interface Run {
  id: string;
  messages: Recording['messages'];
  /** Real milliseconds from the start to each message. */
  offsets: number[];
  speed: SpeedProfile;
  startsAt: number;
  startedAt: number;
  next: number;
  state: StateMessage;
  timer: NodeJS.Timeout | null;
}

export interface PlayerOptions {
  hub: Hub;
  load: (id: string) => Recording | null;
  list?: () => string[];
  /** Real time. Tests can pass their own. */
  clock?: () => number;
}

/**
 * Plays a recording to every screen and phone of the live hub, for filming
 * with the real board. While it plays, the hub's live messages are dropped
 * (Hub.takeScreens) and nothing from the recording is stored. The board's
 * buzzer follows the scenario's alarms and alerts, decided by the same
 * Hub.soundBoard the live hub uses. At the end, every screen gets a fresh live state.
 */
/** The first "Are you OK?" in a recording: when it was asked and when the answer was due. */
function firstCountdown(messages: unknown[]): { askedAt: number; answerBy: number } | null {
  const seen = (value: unknown): { askedAt: number; answerBy: number } | null => {
    if (Array.isArray(value)) { for (const v of value) { const hit = seen(v); if (hit) return hit; } return null; }
    if (value === null || typeof value !== 'object') return null;
    const o = value as Record<string, unknown>;
    if (typeof o.askedAt === 'number' && typeof o.answerBy === 'number' && o.answerBy > o.askedAt) return { askedAt: o.askedAt, answerBy: o.answerBy };
    for (const v of Object.values(o)) { const hit = seen(v); if (hit) return hit; }
    return null;
  };
  return seen(messages);
}

export class ScenarioPlayer {
  private run: Run | null = null;
  private hub: Hub;
  private load: (id: string) => Recording | null;
  private list: () => string[];
  private clock: () => number;

  constructor(options: PlayerOptions) {
    this.hub = options.hub;
    this.load = options.load;
    this.list = options.list ?? (() => []);
    this.clock = options.clock ?? Date.now;
  }

  /** Starts a recording from its beginning, replacing any that is playing. False if there is no such recording. */
  start(id: string, realCountdown = false): boolean {
    const recording = this.load(id);
    const first = recording?.messages[0];
    if (!recording || first?.message.type !== 'state') return false;
    this.end(false);
    const startsAt = recording.meta?.startsAt ?? first.at;
    let speed = speedProfile(recording.meta?.speed, startsAt);
    // For trying the alert on a real phone: the "Are you OK?" countdown plays at its true length,
    // so the person has the same time to answer as on a hub that is not playing a recording.
    if (realCountdown) {
      const asked = firstCountdown(recording.messages.map((m) => m.message));
      if (asked) {
        const after = speedAt(speed, asked.answerBy);
        speed = [...speed.filter(([t]) => t < asked.askedAt || t > asked.answerBy), [asked.askedAt, 1], [asked.answerBy, after]];
        speed.sort((a, b) => a[0] - b[0]);
      }
    }
    this.run = {
      id, messages: recording.messages, offsets: recording.messages.map((m) => realOffset(speed, startsAt, m.at)), speed, startsAt,
      startedAt: this.clock(), next: 0, state: first.message, timer: null,
    };
    const run = this.run;
    this.hub.takeScreens(() => run.state);
    this.pump();
    return true;
  }

  /** Stops the recording that is playing and gives the screens back. False if none was. */
  stop(): boolean {
    return this.end(true);
  }

  status(): { playing: string | null; at: number | null; startedAt: number | null; available: string[] } {
    const run = this.run;
    return { playing: run?.id ?? null, at: run ? run.state.now : null, startedAt: run?.startedAt ?? null, available: this.list() };
  }

  private pump(): void {
    const run = this.run;
    if (!run) return;
    run.timer = null;
    const elapsed = this.clock() - run.startedAt;
    while (run.next < run.messages.length && run.offsets[run.next] <= elapsed) {
      const { at, message } = run.messages[run.next++];
      run.state = fold(run.state, message, at);
      this.hub.sendToScreens(message);
      this.hub.soundBoard();
    }
    if (run.next >= run.messages.length) return void this.end(true);
    run.timer = setTimeout(() => this.pump(), Math.max(0, run.offsets[run.next] - elapsed));
  }

  private end(release: boolean): boolean {
    const run = this.run;
    if (!run) return false;
    if (run.timer) clearTimeout(run.timer);
    this.run = null;
    if (release) this.hub.releaseScreens(this.clock());
    return true;
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 10_000) return undefined;
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return undefined; }
}

/**
 * GET /api/scenario, POST /api/scenario/start {id}, POST /api/scenario/stop,
 * for Hub.routes. In production every one refuses: production plays no story.
 * `mission` is the mission file the hub runs (null for an old profile file,
 * which is the ship's): the story is the ship's, so any other mission refuses to start it.
 */
export function scenarioRoute(player: ScenarioPlayer, production: boolean, mission: string | null = STORY_MISSION) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const paths = ['/api/scenario', '/api/scenario/start', '/api/scenario/stop'];
    if (!paths.includes(url.pathname)) return false;
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return true;
    };
    if (production) return json(403, { error: 'scenarios run in demo mode only' });
    if (url.pathname === '/api/scenario' && req.method === 'GET') return json(200, player.status());
    if (req.method !== 'POST' || url.pathname === '/api/scenario') return json(405, { error: 'method not allowed' });
    if (url.pathname === '/api/scenario/stop') return json(200, { stopped: player.stop() });
    if (mission !== null && mission !== STORY_MISSION) {
      return json(409, { error: `The recorded story happens on the ship. This hub runs the mission "${mission}". Restart it with ASTRUM_MISSION=${STORY_MISSION} to play the story.` });
    }
    const body = (await readBody(req)) as { id?: unknown; realCountdown?: unknown } | undefined;
    if (typeof body?.id !== 'string') return json(400, { error: 'needs the id of a recording, e.g. {"id":"reyes-night"}' });
    if (!player.start(body.id, body.realCountdown === true)) return json(404, { error: `no recording "${body.id}"; run "npm run scenario" in hub/` });
    return json(200, { playing: body.id });
  };
}

// npm run scenario: records the night and writes it where the interface can fetch it.
if (import.meta.main) {
  const hubDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  // Always the ship, whatever ASTRUM_MISSION says.
  const { recording, summary } = recordReyesNight(hubDir);
  const out = join(hubDir, 'ui', 'public', 'scenario', `${SCENARIO_ID}.json`);
  mkdirSync(dirname(out), { recursive: true });
  const text = JSON.stringify(recording);
  writeFileSync(out, text);
  console.log(summary.join('\n'));
  console.log(`Wrote ${out} (${(Buffer.byteLength(text) / 1e6).toFixed(2)} MB)`);
}
