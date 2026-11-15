// Each crewmate's evidence card (engine/evidence.ts), kept ready in memory.
//
// EvidenceCards recomputes one person's card per tick (all of them about every
// 30 seconds), and a person's card at once when one of their alerts changes.
// Screens get the cards in the state message and a short message when one
// changes, so selecting someone needs no request. GET /api/evidence?person=
// returns the cached card, computing it only if there is none yet.
//
// The cabin CO2 every card needs is read once and kept: the first card reads
// the longest window, later ones read only the minutes since.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { evidenceFor, WINDOWS_MS } from '../engine/evidence.ts';
import type { Evidence } from '../engine/evidence.ts';
import { CHECKIN_PREFIX } from '../engine/checkin.ts';
import { evidenceFor as evidenceSharedAs } from '../engine/privacy.ts';
import { occupants } from '../engine/timeline.ts';
import type { Profile, Row } from '../engine/types.ts';
import type { RoomAlarms } from './alarms.ts';
import type { Baselines } from './baseline.ts';
import type { Store } from './db.ts';
import { RECENT_MS } from './db.ts';

export interface EvidenceDeps {
  store: Store;
  profile: Profile;
  baselines: Baselines;
  alarms: RoomAlarms;
  offsetMinutes?: number;
}

/** A card as the hub keeps it: the evidence plus when it was worked out (the hub's clock). */
export type Card = Evidence & { computedAt: number };

/** One cabin row a minute per source is enough: a reading holds for up to 10 minutes. */
const SAMPLE_MS = 60_000;
/** Every card is recomputed about this often; the ticks are spread over it, one person each. */
export const EVIDENCE_EVERY_MS = 30_000;
/**
 * A card that has not changed in substance is still sent again after this
 * long, so the durations a screen shows never fall far behind.
 */
export const RESEND_MS = 5 * 60_000;

/** Cabin CO2 sampled once a minute over the longest window, read incrementally. */
export class CabinCo2 {
  private rows: Row[] = [];
  /** Start of the newest minute already read; it is read again next time, as it may have filled since. */
  private readTo: number | null = null;
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  /** The rows of the longest window ending at `now`, oldest first. */
  at(now: number): Row[] {
    const from = now - Math.max(...WINDOWS_MS);
    if (this.readTo === null || this.readTo < from || this.readTo > now) {
      this.rows = this.store.sampled('co2', from, now, SAMPLE_MS);
    } else {
      const fresh = this.store.sampled('co2', this.readTo, now, SAMPLE_MS);
      let keep = this.rows.length;
      while (keep > 0 && this.rows[keep - 1].t >= this.readTo) keep--;
      let drop = 0;
      while (drop < keep && this.rows[drop].t < from) drop++;
      this.rows = this.rows.slice(drop, keep).concat(fresh);
    }
    this.readTo = Math.floor(now / SAMPLE_MS) * SAMPLE_MS;
    return this.rows;
  }
}

/** Works out one card now. `cabin` is shared between cards; without one the window is read whole. */
export function evidenceNow(person: string, deps: EvidenceDeps, now = Date.now(), cabin?: CabinCo2): Evidence {
  const longest = Math.max(...WINDOWS_MS);
  const from = now - longest;
  return evidenceFor(person, {
    now,
    crew: deps.profile.crew.map((p) => p.id),
    summaries: deps.baselines.all(now),
    occupantsNow: occupants(deps.store.stays(now, now), now),
    stays: deps.store.stays(from, now),
    cabinRows: (cabin ?? new CabinCo2(deps.store)).at(now),
    checkins: deps.store.rows({ person, signalPrefix: CHECKIN_PREFIX, from, to: now, limit: 5000 }),
    latest: deps.store.recent(now - RECENT_MS).filter((r) => r.signal === 'co2' && !r.person),
    stuck: deps.alarms.stuck,
    alarms: deps.alarms.list(),
    offsetMinutes: deps.offsetMinutes ?? -new Date(now).getTimezoneOffset(),
  });
}

/**
 * What counts as a change a screen should hear about. Every verdict, room,
 * signal, person, reason and check-in counts exactly. Numbers count coarsely:
 * time in a room or above a level in 15-minute steps, how much of the window
 * had a reading in whole hours, CO2 averages, z and scores to one decimal.
 * The clock-bound fields (now, window edges, times) are left out. So a card
 * that only aged a little is "the same"; the live hub still resends every
 * card every few minutes (RESEND_MS) so its durations never fall far behind.
 */
export function cardFingerprint(card: Evidence): string {
  return JSON.stringify(card, (key, value) => {
    if (key === 'now' || key === 'from' || key === 'to' || key === 'computedAt' || key === 't' || key === 'lastAt') return undefined;
    if (typeof value !== 'number') return value;
    if (key === 'ms' || key === 'crewmatesMaxMs' || key === 'windowMs') return Math.round(value / 900_000);
    if (key === 'covered' || key === 'gap') return Math.round(value / 3600_000);
    return Math.round(value * 10) / 10;
  });
}

export class EvidenceCards {
  private cards = new Map<string, Card>();
  /** What was last sent for each person, and when. */
  private sent = new Map<string, { fingerprint: string; at: number }>();
  private cabin: CabinCo2;
  private next = 0;
  private timer: NodeJS.Timeout | null = null;
  private soon = new Map<string, NodeJS.Immediate>();
  private deps: EvidenceDeps;
  private people: string[];
  /** Hears every card that changed in substance (the hub broadcasts it). */
  onChange: (person: string, card: Card) => void = () => {};
  /** The hub's clock. The scenario passes its own. */
  clock: () => number = Date.now;
  /** How long an unchanged card waits before it is sent again. */
  resendMs = RESEND_MS;

  constructor(deps: EvidenceDeps) {
    this.deps = deps;
    this.people = deps.profile.crew.map((p) => p.id);
    this.cabin = new CabinCo2(deps.store);
  }

  /** One person per tick, so all are fresh about every EVIDENCE_EVERY_MS. */
  start(): void {
    this.stop();
    this.timer = setInterval(() => this.tick(this.clock()), Math.max(1000, EVIDENCE_EVERY_MS / Math.max(1, this.people.length)));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const handle of this.soon.values()) clearImmediate(handle);
    this.soon.clear();
  }

  /** Recomputes the next person in turn. */
  tick(now: number): void {
    if (!this.people.length) return;
    const person = this.people[this.next % this.people.length];
    this.next = (this.next + 1) % this.people.length;
    this.refresh(person, now);
  }

  /** Recomputes one person's card soon, off the caller's path (an alert of theirs changed). */
  refreshSoon(person: string): void {
    if (!this.people.includes(person) || this.soon.has(person)) return;
    this.soon.set(person, setImmediate(() => {
      this.soon.delete(person);
      this.refresh(person, this.clock());
    }));
  }

  /** Recomputes one person's card now, and tells onChange if it changed in substance. */
  refresh(person: string, now: number): Card {
    const card: Card = { ...evidenceNow(person, this.deps, now, this.cabin), computedAt: now };
    this.cards.set(person, card);
    const fingerprint = cardFingerprint(card);
    const sent = this.sent.get(person);
    if (!sent || sent.fingerprint !== fingerprint || now - sent.at >= this.resendMs || now < sent.at) {
      this.sent.set(person, { fingerprint, at: now });
      this.onChange(person, card);
    }
    return card;
  }

  /** The cached card, or a fresh one if there is none yet. */
  get(person: string): Card {
    return this.cards.get(person) ?? this.refresh(person, this.clock());
  }

  /** Every card computed so far, by person. */
  all(): Record<string, Card> {
    return Object.fromEntries(this.cards);
  }
}

/** The route, for Hub.routes. Returns true when it handled the request. */
export function evidenceRoute(profile: Profile, cards: EvidenceCards) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== '/api/evidence' || req.method !== 'GET') return false;
    const person = url.searchParams.get('person');
    const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (!person || !profile.crew.some((p) => p.id === person)) {
      json(400, { error: 'person must be a crewmate in the profile' });
      return true;
    }
    // A shared request: a typed check-in answer stays with its author (engine/privacy.ts).
    json(200, evidenceSharedAs(cards.get(person), 'common'));
    return true;
  };
}
