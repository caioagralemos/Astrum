// The one layer every screen gets its data through. It has two sources with
// the same shape: the live hub over a WebSocket, and a recorded file played
// back in the browser (the web replay, which calls no server).

import { useEffect, useState } from 'react';
import type { HubMessage, Profile, Recording, Row, ScenarioFlag, SourceStatus, Stay } from '../../engine/types.ts';
import { clockOffset, screenNow, scopeOf } from '../../engine/timeline.ts';
import type { LastSeen } from '../../engine/timeline.ts';
import { momentAfter, realOffset, speedProfile } from '../../engine/playback.ts';
import type { RoomAlarm } from '../../engine/cabin.ts';
import type { Alert, EarthMessage } from '../../engine/alerts.ts';
import type { Evidence } from '../../engine/evidence.ts';
import type { CrewWatch } from '../../engine/sensors.ts';
import type { Activity } from '../../engine/activity.ts';
import type { PersonDose } from '../../engine/dose.ts';
import type { FollowUpAsk } from '../../engine/followup.ts';

export interface World {
  status: 'connecting' | 'live' | 'offline' | 'replay';
  /** The hub's clock (or the replay's), in milliseconds: this screen's clock plus its offset to the hub's. */
  now: number;
  profile: Profile | null;
  /** The newest row per source for every signal and place. */
  latest: Row[];
  /** Stays that are open or just closed. */
  stays: Stay[];
  /** Display only: each unplaced crewmate's last room, as of the hub's last state (engine/timeline.ts lastSeen). */
  lastSeen?: Record<string, LastSeen>;
  sources: SourceStatus[];
  alarms: RoomAlarm[];
  alerts: Alert[];
  /** Messages to Earth still listed, including ones whose alert has ended while the reply is on its way. */
  earthMessages: EarthMessage[];
  /** Crew ids the hub counts as asleep. */
  asleep: string[];
  /**
   * Each crewmate's evidence card by crew id, as the hub last worked it out
   * (computedAt is the hub's clock then). The hub keeps them fresh and pushes
   * them, so a screen shows a selected person's card with no request. Missing
   * for a person until the hub has computed theirs, and from older hubs.
   */
  evidence?: Record<string, Evidence & { computedAt?: number }>;
  /** Set while what is shown is a simulated scenario, for the screen to say so. */
  scenario?: ScenarioFlag | null;
  /**
   * Rooms past a "warn" level the crew set on one of their sensors: mark the
   * room "watch" (room.summary.crewWatch). Never an alarm. Missing from older
   * hubs and recordings. The mission's facts (gravity, body, kind) are in
   * profile.mission; crew-level alarms are in `alarms` with limitSource 'crew'.
   */
  crewWatch?: CrewWatch[];
  /**
   * What each crewmate is doing as far as the hub knows (sleeping, exercising, eating or none),
   * with how it is known (engine/activity.ts). Missing from older hubs and recordings.
   */
  activity?: Record<string, Activity>;
  /**
   * Each crewmate's radiation dose by crew id (engine/dose.ts): today, this mission, projected at
   * the planned end, with its kind (estimated, replayed or simulated: never measured) and unknown time.
   * Missing for a person with no dose at all, and from older hubs and recordings.
   */
  dose?: Record<string, PersonDose>;
  /** Set when the hub said it is restarting on another mission (a mission file); cleared by its next state. */
  restarting?: string | null;
  /**
   * The medical lead's follow-up question waiting for this screen's own crewmate (`?person=<id>`),
   * or null. The hub sends it to their socket only; a shared screen never has one.
   */
  followUp?: FollowUpAsk | null;
}

const empty: World = { status: 'connecting', now: Date.now(), profile: null, latest: [], stays: [], sources: [], alarms: [], alerts: [], earthMessages: [], asleep: [] };

export interface DataSource {
  start(update: (change: (world: World) => World) => void): () => void;
}

/** Applies one hub message to the world. The replay feeds the same messages. */
export function apply(world: World, message: HubMessage): World {
  return { ...applyOne(world, message), scenario: message.scenario ?? null };
}

function applyOne(world: World, message: HubMessage): World {
  switch (message.type) {
    case 'state':
      return {
        ...world, now: message.now, profile: message.profile, latest: message.latest, stays: message.stays, sources: message.sources, alarms: message.alarms ?? [], alerts: message.alerts ?? [],
        earthMessages: message.earthMessages ?? [], asleep: message.asleep ?? [], evidence: message.evidence ?? {}, crewWatch: message.crewWatch ?? [],
        activity: message.activity, dose: message.dose ?? {}, lastSeen: message.lastSeen ?? {}, restarting: null,
        // A recorded story's state carries none: the live question stays, unanswerable, until the story ends.
        followUp: message.scenario ? world.followUp : message.followUp ?? null,
      };
    case 'rows': {
      const latest = new Map(world.latest.map((r) => [`${scopeOf(r)}|${r.source}`, r]));
      for (const row of message.rows) {
        const key = `${scopeOf(row)}|${row.source}`;
        const held = latest.get(key);
        if (!held || row.t >= held.t) latest.set(key, row);
      }
      return { ...world, latest: [...latest.values()] };
    }
    case 'stay': {
      const stays = new Map(world.stays.map((s) => [s.id, s]));
      for (const stay of message.stays) stays.set(stay.id, stay);
      return { ...world, stays: [...stays.values()] };
    }
    case 'sources':
      return { ...world, sources: message.sources };
    case 'alarms':
      return { ...world, alarms: message.alarms, crewWatch: message.crewWatch ?? world.crewWatch };
    case 'alerts':
      return { ...world, alerts: message.alerts };
    case 'earth':
      return { ...world, earthMessages: message.earthMessages };
    case 'asleep':
      return { ...world, asleep: message.asleep };
    case 'activity':
      return { ...world, activity: message.activity };
    case 'clock':
      return { ...world, now: message.now };
    case 'evidence':
      return { ...world, evidence: { ...world.evidence, [message.person]: message.evidence } };
    case 'dose':
      return { ...world, dose: message.dose };
    case 'followUp':
      return { ...world, followUp: message.followUp };
    case 'restarting':
      return { ...world, restarting: message.to };
    default:
      return world;
  }
}

/** A recorded story playing in the browser (`?replay=`): there is no hub, so nothing is asked of one or sent to one. */
export function isReplay(): boolean {
  return new URLSearchParams(location.search).has('replay');
}

/** Where the hub is. The interface served by the hub talks to the address it came from. */
export function hubAddress(): string {
  const forced = new URLSearchParams(location.search).get('hub') ?? import.meta.env.VITE_HUB;
  if (forced) return forced;
  const servedByHub = location.protocol.startsWith('http') && location.port !== '5173';
  return servedByHub ? location.host : `${location.hostname || '127.0.0.1'}:4310`;
}

export class LiveSource implements DataSource {
  start(update: (change: (world: World) => World) => void): () => void {
    let socket: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(`ws://${hubAddress()}/ws`);
      socket.onopen = () => {
        // A crewmate's own screen says who it is, so the hub sends it what only they may see (engine/privacy.ts).
        const person = new URLSearchParams(location.search).get('person');
        socket?.send(JSON.stringify(person ? { type: 'hello', role: 'screen', person } : { type: 'hello', role: 'screen' }));
        update((w) => ({ ...w, status: 'live' }));
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as HubMessage;
        heardAt = Date.now();
        // The hub's own clock, never a scenario's: follow it from now on.
        if (!message.scenario && (message.type === 'state' || message.type === 'clock')) offset = clockOffset(message.now, heardAt);
        update((w) => (message.scenario ? { ...apply(w, message), now: message.scenario.at } : apply(w, message)));
      };
      socket.onclose = () => {
        update((w) => ({ ...w, status: w.profile ? 'offline' : 'connecting' }));
        retry = setTimeout(connect, 1500);
      };
      socket.onerror = () => socket?.close();
    };
    let heardAt = Date.now();
    /** How far the hub's clock is ahead of this screen's, from its last "state" or "clock". */
    let offset = 0;
    connect();
    // Tick on this screen's clock, moved onto the hub's. A scenario the hub is
    // playing runs on its own clock, at its own speed; when it ends, the hub's
    // fresh live state brings the screen back to the hub's clock.
    const tick = setInterval(() => update((w) => ({
      ...w,
      now: screenNow(Date.now(), offset, w.scenario ? { at: w.scenario.at, speed: w.scenario.speed, heardAt } : null),
    })), 1000);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(tick);
      socket?.close();
    };
  }
}

export type { Recording };

/** The words a scenario shows before it plays (meta.intro): plain English, or English and Portuguese. */
export type IntroText = string | { en: string; pt?: string };
/** A notification shown in the replay: where it landed (a phone, a board) and its words. */
export interface Notice { at: number; on: string; kind: 'phone' | 'board'; title: string; body: string }

export interface Intro { title: IntroText; lines: IntroText[]; /** The sheet's line icon: what kind of story it is. */ icon?: 'moon' | 'wind' | 'flame' }

/** How long the hub runs as it is before a scenario's intro sheet comes up, ms. */
const INTRO_AFTER = 6000;
/** One entry of the scenario list (ui/public/scenario/index.json). */
export interface ScenarioEntry { file: string; title: string }
export interface PhoneTake { src: string; videoTime(now: number): number; endsAt: number }

const LIST = 'scenario/index.json';

/**
 * A recorded file played in the browser, at the speeds its meta asks for
 * (real time for files without one). The screen's clock is the recording's.
 * `?replay=random` (or an empty `?replay`) plays the scenario list in order:
 * the first one on arrival, so every visitor starts with the same story, and
 * "Another scenario" the next one along (back to the first after the last). A file with an intro waits on its
 * card until begin(): the hub shows the recording's first moment, as it is, and the
 * card comes up over it after INTRO_AFTER.
 */
export class RecordedSource implements DataSource {
  private url: string;
  private controls: { restart(): void; skip(): void } | null = null;
  private waiting: (() => void) | null = null;
  private listeners = new Set<() => void>();
  /** The intro card's words while it waits for Start, else null. */
  intro: Intro | null = null;
  /** The narrator's lines (meta.moments[].caption), by recording time: one plain sentence per beat of the story. */
  captions: { at: number; text: IntroText }[] = [];
  /** What reached a phone or a cabin board at a beat (meta.moments[].notices), shown as a banner. */
  notices: Notice[] = [];
  /** How many scenarios the list offers (0 when there is no list): "Another scenario" shows for two or more. */
  choices = 0;
  /** The phone recording filmed in the same take, if the file has one: its address, and its time (s) at a moment of the replay. */
  phone: PhoneTake | null = null;
  constructor(url: string) {
    this.url = url;
  }

  /** Calls `fn` whenever intro or choices change; returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  private introTimer: ReturnType<typeof setTimeout> | undefined;

  /** Starts the scenario waiting on its intro card. */
  begin(): void {
    const go = this.waiting;
    clearTimeout(this.introTimer);
    this.waiting = null;
    this.intro = null;
    this.changed();
    go?.();
  }

  /** Plays it again from the beginning. */
  restart(): void {
    this.controls?.restart();
  }

  /** Jumps to the end. */
  skip(): void {
    this.controls?.skip();
  }

  /** Loads a different scenario from the list. */
  another(): void {
    const params = new URLSearchParams(location.search);
    params.set('replay', 'random');
    params.set('after', this.url);
    location.search = params.toString();
  }

  /** The file to play: the one asked for, else the list's first, or the one after `after`. */
  private async resolve(list: ScenarioEntry[]): Promise<string> {
    if (this.url && this.url !== 'random') return this.url;
    const params = new URLSearchParams(location.search);
    if (!list.length) throw new Error('no scenarios listed');
    const last = params.get('after');
    const at = last ? list.findIndex((e) => `scenario/${e.file}` === last) : -1;
    const file = `scenario/${list[(at + 1) % list.length].file}`;
    // The address names the file, so a reload or the Astra sheet (its recorded answers sit beside it) finds the same one.
    params.set('replay', file);
    params.delete('after');
    history.replaceState(null, '', `?${params.toString()}${location.hash}`);
    return file;
  }

  start(update: (change: (world: World) => World) => void): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void fetch(LIST).then((res) => (res.ok ? res.json() : [])).catch(() => [])
      .then(async (list: ScenarioEntry[]) => {
        this.choices = Array.isArray(list) ? list.length : 0;
        this.url = await this.resolve(Array.isArray(list) ? list : []);
        this.changed();
        return (await fetch(this.url)).json();
      })
      .then((recording: Recording) => {
      const { messages } = recording;
      if (stopped || !messages.length) return;
      const startsAt = recording.meta?.startsAt ?? messages[0].at;
      const endsAt = recording.meta?.endsAt ?? messages[messages.length - 1].at;
      const speed = speedProfile(recording.meta?.speed, startsAt);
      let next = 0;
      let begun = 0;
      const play = () => {
        const now = Math.min(momentAfter(speed, startsAt, performance.now() - begun), endsAt);
        const due: HubMessage[] = [];
        while (next < messages.length && messages[next].at <= now) due.push(messages[next++].message);
        update((w) => ({ ...due.reduce(apply, w), status: 'replay', now }));
        if (next >= messages.length && now >= endsAt) clearInterval(timer);
      };
      const from = (real: number) => {
        clearInterval(timer);
        begun = performance.now() - real;
        timer = setInterval(play, 100);
        play();
      };
      this.controls = {
        restart: () => {
          this.begin();
          next = 0;
          update(() => ({ ...empty, status: 'replay' }));
          from(0);
        },
        skip: () => { this.begin(); from(realOffset(speed, startsAt, endsAt)); },
      };
      const phone = recording.meta?.phone;
      if (phone?.file && Number.isFinite(phone.offsetMs)) {
        // The replay clock reaches `now` after realOffset(...) ms of playing; the video began offsetMs from startsAt
        // on that played time (RecordingMeta.phone). Both scenarios with one play at real time.
        this.phone = {
          src: this.url.replace(/[^/]*$/, '') + phone.file,
          videoTime: (now) => (realOffset(speed, startsAt, now) - phone.offsetMs) / 1000,
          endsAt,
        };
        this.changed();
      }
      const moments = (recording.meta?.moments ?? []) as { at: number; caption?: IntroText; notices?: Omit<Notice, 'at'>[] }[];
      this.notices = moments.flatMap((m) => (m.notices ?? []).map((n) => ({ ...n, at: m.at })));
      this.captions = moments.filter((m) => m.caption).map((m) => ({ at: m.at, text: m.caption as IntroText })).sort((a, b) => a.at - b.at);
      const intro = recording.meta?.intro as Intro | undefined;
      if (intro?.title) {
        // The hub as it is at the recording's first moment, then the card over it.
        begun = performance.now();
        play();
        this.waiting = () => { if (!stopped) from(0); };
        this.introTimer = setTimeout(() => { if (stopped || !this.waiting) return; this.intro = intro; this.changed(); }, INTRO_AFTER);
      } else from(0);
    }).catch(() => update((w) => ({ ...w, status: 'offline' })));
    return () => {
      stopped = true;
      clearTimeout(this.introTimer);
      this.controls = null;
      this.waiting = null;
      clearInterval(timer);
    };
  }
}

export function chooseSource(): DataSource {
  const params = new URLSearchParams(location.search);
  return params.has('replay') ? new RecordedSource(params.get('replay') ?? '') : new LiveSource();
}

/** A recorded source's intro card and list size, re-rendered when they change. */
export function useRecordedState(source: DataSource): { intro: Intro | null; choices: number; phone: PhoneTake | null; captions: { at: number; text: IntroText }[]; notices: Notice[] } {
  const [, bump] = useState(0);
  useEffect(() => (source instanceof RecordedSource ? source.subscribe(() => bump((n) => n + 1)) : undefined), [source]);
  return source instanceof RecordedSource ? { intro: source.intro, choices: source.choices, phone: source.phone, captions: source.captions, notices: source.notices } : { intro: null, choices: 0, phone: null, captions: [], notices: [] };
}

export function useWorld(source: DataSource): World {
  const [world, setWorld] = useState<World>(empty);
  useEffect(() => source.start(setWorld), [source]);
  return world;
}
