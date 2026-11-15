// The one layer every screen gets its data through. It has two sources with
// the same shape: the live hub over a WebSocket, and a recorded file played
// back in the browser (the web replay, which calls no server).

import { useEffect, useState } from 'react';
import type { HubMessage, Profile, Recording, Row, ScenarioFlag, SourceStatus, Stay } from '../../engine/types.ts';
import { clockOffset, screenNow, scopeOf } from '../../engine/timeline.ts';
import { momentAfter, realOffset, speedProfile } from '../../engine/playback.ts';
import type { RoomAlarm } from '../../engine/cabin.ts';
import type { Alert, EarthMessage } from '../../engine/alerts.ts';
import type { Evidence } from '../../engine/evidence.ts';
import type { CrewWatch } from '../../engine/sensors.ts';
import type { Activity } from '../../engine/activity.ts';
import type { PersonDose } from '../../engine/dose.ts';

export interface World {
  status: 'connecting' | 'live' | 'offline' | 'replay';
  /** The hub's clock (or the replay's), in milliseconds: this screen's clock plus its offset to the hub's. */
  now: number;
  profile: Profile | null;
  /** The newest row per source for every signal and place. */
  latest: Row[];
  /** Stays that are open or just closed. */
  stays: Stay[];
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
        activity: message.activity, dose: message.dose ?? {}, restarting: null,
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
    case 'restarting':
      return { ...world, restarting: message.to };
    default:
      return world;
  }
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
        socket?.send(JSON.stringify({ type: 'hello', role: 'screen' }));
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

/**
 * A recorded file played in the browser, at the speeds its meta asks for
 * (real time for files without one). The screen's clock is the recording's.
 */
export class RecordedSource implements DataSource {
  private url: string;
  private controls: { restart(): void; skip(): void } | null = null;
  constructor(url: string) {
    this.url = url;
  }

  /** Plays it again from the beginning. */
  restart(): void {
    this.controls?.restart();
  }

  /** Jumps to the end. */
  skip(): void {
    this.controls?.skip();
  }

  start(update: (change: (world: World) => World) => void): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void fetch(this.url).then((res) => res.json()).then((recording: Recording) => {
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
          next = 0;
          update(() => ({ ...empty, status: 'replay' }));
          from(0);
        },
        skip: () => from(realOffset(speed, startsAt, endsAt)),
      };
      from(0);
    }).catch(() => update((w) => ({ ...w, status: 'offline' })));
    return () => {
      stopped = true;
      this.controls = null;
      clearInterval(timer);
    };
  }
}

export function chooseSource(): DataSource {
  const replay = new URLSearchParams(location.search).get('replay');
  return replay ? new RecordedSource(replay) : new LiveSource();
}

export function useWorld(source: DataSource): World {
  const [world, setWorld] = useState<World>(empty);
  useEffect(() => source.start(setWorld), [source]);
  return world;
}
