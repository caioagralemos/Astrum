// A base-wide event (a dust storm, a solar particle event, a loss of pressure,
// a fire): declared by a crewmate, because the hub has no weather or radiation
// feed and makes nothing up. Declaring one raises a single level 3 alert for
// everyone through the real alert engine (engine/alerts.ts, the 'declared'
// reason), the way a drill feeds it (core/drill.ts): the engine asks for the
// active events each time it looks. From there nothing is special: every
// screen sees it, the board's buzzer sounds by the hub's one rule
// (boardSounds), "I've seen it" silences it, and Earth is messaged with the
// delay.
//
// Declared ahead (expectedAt: someone on board expects it, or Earth sent a
// forecast), it is first a warning: a level 2 notice for everyone, no question,
// no buzzer, no card, no message to Earth. When the hub's clock reaches
// expectedAt, the same alert becomes the level 3. Until then anyone may move
// the time or cancel it ("did not happen"). The hub has no weather or
// radiation sensor, so nothing here detects anything: `source` says who gave
// the word ('crew' or 'earth'; 'sensor' is reserved for a real sensor with a
// real limit, and nothing sets it yet).
//
// It is a real report, so it works in production as in demo mode. Never
// declared while a recorded story plays. One active event per kind; anyone
// ends it, at either stage. Active events are kept in a JSON file beside the
// mission's database, so they survive a restart; one whose time passed while
// the hub was down becomes level 3 on the first look, and still says when it
// was expected.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EVENT_CARD, EVENT_KINDS } from '../engine/alerts.ts';
import type { DeclaredEvent, EventKind } from '../engine/alerts.ts';
import type { Profile } from '../engine/types.ts';
import type { AlertWatcher } from './alerts.ts';

/** The longest note a declarer may write. */
export const NOTE_MAX = 280;
/** The furthest ahead an event may be expected. */
export const AHEAD_MAX_MS = 72 * 3600_000;
const SOURCES = ['crew', 'earth'] as const;

export interface BaseEventsDeps {
  profile: Profile;
  alerts: AlertWatcher;
  storyPlaying: () => boolean;
  /** True when the medical lead's card exists in her file and applies at this mission's gravity. */
  cardUsable: (card: string) => boolean;
  /** Where active events are kept across restarts, or null to keep them in memory only. */
  file: string | null;
  /** The hub's clock. Tests give their own. */
  clock?: () => number;
}

export type Refusal = { status: number; error: string };

export class BaseEvents {
  private active: DeclaredEvent[] = [];
  private deps: BaseEventsDeps;
  private clock: () => number;

  constructor(deps: BaseEventsDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? Date.now;
    deps.alerts.declared = () => this.active;
    this.load();
  }

  private load(): void {
    const { file } = this.deps;
    if (!file || !existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as DeclaredEvent[];
      if (Array.isArray(saved)) this.active = saved.filter((e) => e && typeof e.id === 'string' && (EVENT_KINDS as readonly string[]).includes(e.kind));
    } catch (err) {
      console.error(`Could not read the active base-wide events in ${file}:`, err);
    }
  }

  private save(now: number): void {
    const { file } = this.deps;
    if (file) {
      writeFileSync(`${file}.tmp`, JSON.stringify(this.active));
      renameSync(`${file}.tmp`, file);
    }
    this.deps.alerts.check(now);
  }

  private aheadProblem(expectedAt: unknown, now: number): string | null {
    if (typeof expectedAt !== 'number' || !Number.isFinite(expectedAt)) return '"expectedAt" must be a time on the hub\'s clock, in milliseconds.';
    if (expectedAt <= now) return '"expectedAt" must be in the future. For an event happening now, leave it out.';
    if (expectedAt > now + AHEAD_MAX_MS) return `"expectedAt" is at most ${AHEAD_MAX_MS / 3600_000} hours ahead.`;
    return null;
  }

  list(): DeclaredEvent[] {
    return this.active;
  }

  declare(input: { kind: unknown; by: unknown; note?: unknown; shelter?: unknown; expectedAt?: unknown; source?: unknown }, now = this.clock()): { event: DeclaredEvent } | Refusal {
    const { profile } = this.deps;
    if (this.deps.storyPlaying()) return { status: 409, error: 'A recorded story is playing. Stop it first: a base-wide event is declared on the live hub.' };
    if (typeof input.kind !== 'string' || !(EVENT_KINDS as readonly string[]).includes(input.kind)) return { status: 400, error: `"kind" must be one of: ${EVENT_KINDS.join(', ')}.` };
    const kind = input.kind as EventKind;
    if (typeof input.by !== 'string' || !profile.crew.some((p) => p.id === input.by)) return { status: 400, error: `"by" must be a crew id. Crew: ${profile.crew.map((p) => p.id).join(', ')}.` };
    const shelter = input.shelter ?? null;
    if (shelter !== null && (typeof shelter !== 'string' || !profile.rooms.some((r) => r.id === shelter))) return { status: 400, error: `"shelter" must be a room id. Rooms: ${profile.rooms.map((r) => r.id).join(', ')}.` };
    const note = input.note ?? null;
    if (note !== null && typeof note !== 'string') return { status: 400, error: '"note" must be text.' };
    const text = note?.trim() || null;
    if (text && text.length > NOTE_MAX) return { status: 400, error: `"note" is at most ${NOTE_MAX} characters.` };
    const expectedAt = input.expectedAt ?? null;
    const ahead = expectedAt === null ? null : this.aheadProblem(expectedAt, now);
    if (ahead) return { status: 400, error: ahead };
    const source = input.source ?? 'crew';
    if (!(SOURCES as readonly unknown[]).includes(source)) return { status: 400, error: '"source" is "crew" (someone on board) or "earth" (a forecast from mission control).' };
    if (this.active.some((e) => e.kind === kind)) return { status: 409, error: `A ${kind} event is already active. End it first.` };
    const mapped = EVENT_CARD[kind] ?? null;
    const event: DeclaredEvent = {
      id: `event|${kind}|${now}`, kind, by: input.by, at: now, note: text, shelter: shelter as string | null,
      source: source as 'crew' | 'earth', expectedAt: expectedAt as number | null,
      card: mapped && this.deps.cardUsable(mapped) ? mapped : null,
    };
    this.active = [...this.active, event];
    this.save(now);
    return { event };
  }

  /** While it is still a warning: moves its time, or cancels it ("did not happen"). From anyone. */
  update(input: { id: unknown; by: unknown; expectedAt?: unknown; cancel?: unknown }, now = this.clock()): { event: DeclaredEvent } | { cancelled: string } | Refusal {
    if (typeof input.by !== 'string' || !this.deps.profile.crew.some((p) => p.id === input.by)) return { status: 400, error: '"by" must be a crew id.' };
    const event = this.active.find((e) => e.id === input.id);
    if (!event) return { status: 404, error: 'No active event with that id. GET /api/events lists them.' };
    if (event.expectedAt === null || event.expectedAt <= now) return { status: 409, error: 'The event is already here: end it with POST /api/events/end.' };
    if (input.cancel === true) {
      this.active = this.active.filter((e) => e.id !== event.id);
      this.save(now);
      return { cancelled: event.id };
    }
    const ahead = this.aheadProblem(input.expectedAt, now);
    if (ahead) return { status: 400, error: `${ahead} Or send "cancel": true.` };
    const moved = { ...event, expectedAt: input.expectedAt as number };
    this.active = this.active.map((e) => (e.id === event.id ? moved : e));
    this.save(now);
    return { event: moved };
  }

  /** Ends an event, from anyone. Always allowed, so a real event can always be cleared. */
  end(id: unknown, by: unknown, now = this.clock()): { ended: string } | Refusal {
    if (typeof by !== 'string' || !this.deps.profile.crew.some((p) => p.id === by)) return { status: 400, error: '"by" must be a crew id.' };
    if (!this.active.some((e) => e.id === id)) return { status: 404, error: 'No active event with that id. GET /api/events lists them.' };
    this.active = this.active.filter((e) => e.id !== id);
    this.save(now);
    return { ended: id as string };
  }
}

/**
 * GET /api/events; POST /api/events/declare {kind, by, note?, shelter?, expectedAt?, source?};
 * POST /api/events/update {id, by, expectedAt | cancel: true}; POST /api/events/end {id, by}.
 */
export function eventsRoute(events: BaseEvents) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (!['/api/events', '/api/events/declare', '/api/events/update', '/api/events/end'].includes(url.pathname)) return false;
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return true;
    };
    if (url.pathname === '/api/events') return req.method === 'GET' ? json(200, { events: events.list() }) : json(405, { error: 'method not allowed' });
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
    const body = (await readBody(req)) as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') return json(400, { error: 'needs a JSON body: {"kind":"dust_storm","by":"reyes"}' });
    const out = url.pathname === '/api/events/declare'
      ? events.declare({ kind: body.kind, by: body.by, note: body.note, shelter: body.shelter, expectedAt: body.expectedAt, source: body.source })
      : url.pathname === '/api/events/update'
        ? events.update({ id: body.id, by: body.by, expectedAt: body.expectedAt, cancel: body.cancel })
        : events.end(body.id, body.by);
    return 'error' in out ? json(out.status, { error: out.error }) : json(200, out);
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
