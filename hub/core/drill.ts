// A drill: a real run of the alert engine on the live hub, labelled simulated,
// so the crew can answer a real "Are you OK?" and see what follows.
//
// How it makes the real engine fire: for as long as it runs, the alarm watcher
// judges one room's CO2 on a simulated reading (DRILL_VALUE mmHg, kind
// "simulated", source "drill") in place of the stored rows (RoomAlarms.override).
// The reading covers the whole hour, so NASA's limit on the 1-hour average is
// passed at once, and the alert engine sees the person in that room
// (AlertWatcher.placed). From there nothing is special: the level 2 question
// with its 60-second countdown, the answer through POST /api/alerts/answer,
// level 3 for everyone with the steps card and a message to Earth, the board's
// buzzer by the hub's one rule (engine/alerts.ts boardSounds), the normal
// acknowledgements. Every alarm, alert and message to Earth it causes is marked
// drill: true (strings drill.* word it).
//
// The reading is never written to the database: it exists only in memory, for
// the alarm watcher. So stored history, evidence cards and the model's room
// readings never see it, and stopping leaves no row to remove. Nobody's stay
// is written either: the person is placed in the room for the alert engine
// only, and the simulated crew keeps walking as before.
//
// Rules: demo mode only; never while a recorded story plays, and a story that
// starts ends it; one at a time; never while a real NASA alarm is active, and a
// real one (in any room, or under the drill's reading in its own room) ends it
// at once, so a drill never hides or reshapes a real event. It ends by itself
// after DRILL_MAX_MS. Ending it clears its alarm and alerts on the spot; the
// message to Earth stays listed, marked drill and resolved, until it ages out
// like any other (engine/alerts.ts EARTH_KEEP_MS).

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Profile, Row } from '../engine/types.ts';
import type { RoomAlarms } from './alarms.ts';
import type { AlertWatcher } from './alerts.ts';

export const DRILL_SOURCE = 'drill';
/** The signal a drill raises: NASA's CO2 limit, the one limit with a steps card. */
export const DRILL_SIGNAL = 'co2';
/** The drill's reading, in mmHg: clearly over NASA's 3 mmHg, and round, so nobody takes it for the room's air. */
export const DRILL_VALUE = 4;
export const DRILL_UNIT = 'mmHg';
/** A drill ends by itself after this long. */
export const DRILL_MAX_MS = 10 * 60_000;
/** One simulated reading a minute, back to the start of the window the watcher asks for. */
const STEP_MS = 60_000;
/** How often the drill looks for a reason to end. */
const TICK_MS = 2000;

export interface DrillStatus {
  id: string;
  person: string;
  room: string;
  signal: string;
  value: number;
  unit: string;
  startedAt: number;
  endsAt: number;
}

export type DrillEnd = 'stopped' | 'timeout' | 'real-alarm' | 'story';

export interface DrillDeps {
  profile: Profile;
  alarms: RoomAlarms;
  alerts: AlertWatcher;
  production: boolean;
  storyPlaying: () => boolean;
  /** The room the hub has the person in now, or null. */
  roomOf: (person: string, now: number) => string | null;
  /** The hub's clock. Tests give their own. */
  clock?: () => number;
}

export class Drill {
  private current: DrillStatus | null = null;
  private timer: NodeJS.Timeout | null = null;
  private deps: DrillDeps;
  private clock: () => number;
  /** How the last drill ended, for GET /api/drill. */
  lastEnded: { id: string; reason: DrillEnd; at: number } | null = null;

  constructor(deps: DrillDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? Date.now;
    deps.alarms.override = (room, signal, from, to) => this.readings(room, signal, from, to);
    deps.alerts.placed = () => (this.current ? { person: this.current.person, room: this.current.room } : null);
  }

  status(): DrillStatus | null {
    return this.current;
  }

  /** Starts a drill for one person, in `room` or the room the hub has them in. */
  start(person: string, room: string | null, now = this.clock()): { drill: DrillStatus } | { status: number; error: string } {
    const { profile, alarms, alerts } = this.deps;
    if (this.deps.production) return { status: 403, error: 'Drills run in demo mode only.' };
    if (this.deps.storyPlaying()) return { status: 409, error: 'A recorded story is playing. Stop it first: a drill runs on the live hub.' };
    if (this.current) return { status: 409, error: `A drill is already running for ${this.current.person} in ${this.current.room}. Stop it first.` };
    if (!profile.crew.some((p) => p.id === person)) return { status: 400, error: `"${person}" is not a crew id. Crew: ${profile.crew.map((p) => p.id).join(', ')}.` };
    if (room !== null && !profile.rooms.some((r) => r.id === room)) return { status: 400, error: `"${room}" is not a room. Rooms: ${profile.rooms.map((r) => r.id).join(', ')}.` };
    const where = room ?? this.deps.roomOf(person, now);
    if (!where) return { status: 409, error: `The hub does not know where ${person} is. Name a room: {"person":"${person}","room":"${profile.rooms[0]?.id ?? 'quarters-2'}"}.` };
    if (alarms.list().some(isRealNasaAlarm)) return { status: 409, error: 'A real alarm is active. No drill while it lasts.' };
    this.current = {
      id: `drill|${person}|${now}`, person, room: where, signal: DRILL_SIGNAL, value: DRILL_VALUE, unit: DRILL_UNIT, startedAt: now, endsAt: now + DRILL_MAX_MS,
    };
    alarms.check(now);
    alerts.check(now);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
    return { drill: this.current };
  }

  /** Ends the drill: its alarm and alerts end now. Returns false if none was running. */
  stop(reason: DrillEnd = 'stopped', now = this.clock()): boolean {
    if (!this.current) return false;
    const id = this.current.id;
    this.current = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.deps.alarms.check(now);
    this.deps.alerts.check(now);
    this.lastEnded = { id, reason, at: now };
    return true;
  }

  /** Ends the drill if its time is up, a story started, or a real alarm appeared. */
  tick(now = this.clock()): void {
    if (!this.current) return;
    const { alarms } = this.deps;
    if (now >= this.current.endsAt) this.stop('timeout', now);
    else if (this.deps.storyPlaying()) this.stop('story', now);
    else if (alarms.list().some(isRealNasaAlarm) || alarms.masked.includes(this.current.room)) this.stop('real-alarm', now);
  }

  /** The drill's simulated readings for the alarm watcher: one a minute from `from` to `to`, in memory only. */
  private readings(room: string, signal: string, from: number, to: number): Row[] | null {
    const d = this.current;
    if (!d || d.room !== room || d.signal !== signal) return null;
    const rows: Row[] = [];
    const row = (t: number): Row => ({ t, signal, value: d.value, unit: d.unit, kind: 'simulated', source: DRILL_SOURCE, room });
    for (let t = Math.floor(from / STEP_MS) * STEP_MS; t < to; t += STEP_MS) rows.push(row(t));
    rows.push(row(to));
    return rows;
  }
}

function isRealNasaAlarm(a: { drill?: true; limitSource: string }): boolean {
  return !a.drill && a.limitSource !== 'crew';
}

/**
 * GET /api/drill: the drill running now (or null) and how the last one ended.
 * POST /api/drill/start {person, room?}; POST /api/drill/stop.
 */
export function drillRoute(drill: Drill) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (!['/api/drill', '/api/drill/start', '/api/drill/stop'].includes(url.pathname)) return false;
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return true;
    };
    if (url.pathname === '/api/drill') return req.method === 'GET' ? json(200, { drill: drill.status(), lastEnded: drill.lastEnded }) : json(405, { error: 'method not allowed' });
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
    if (url.pathname === '/api/drill/stop') return json(200, { stopped: drill.stop('stopped') });
    const body = (await readBody(req)) as { person?: unknown; room?: unknown } | undefined;
    if (typeof body?.person !== 'string' || (body.room !== undefined && body.room !== null && typeof body.room !== 'string')) {
      return json(400, { error: 'needs a crew id, and a room if you want another than where the person is: {"person":"reyes","room":"quarters-2"}' });
    }
    const out = drill.start(body.person, typeof body.room === 'string' ? body.room : null);
    return 'drill' in out ? json(200, out) : json(out.status, { error: out.error });
  };
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
