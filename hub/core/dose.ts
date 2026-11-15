// Each crewmate's radiation dose (engine/dose.ts), kept ready in memory.
//
// CrewDose works out every crewmate's dose about once a minute, off the
// request path, as the evidence cards are. Screens get it in the state message
// (state.dose) and a "dose" message when it changes; GET /api/dose returns the
// cached result. The room rates are read once from the mission start and then
// only the minutes since, kept as held spans (a slow rate is a few spans an hour).
//
// Every dose is an estimate from room rates and stays (or simulated): the chip
// has no radiation sensor and nobody wears a dosimeter. In production the store
// keeps no simulated or replayed rows, so with no real radiation source there
// is no dose at all.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { DOSE_SIGNAL, doseOfCrew, heldSpan, plannedEndOf, pushSpan, seriesOf } from '../engine/dose.ts';
import type { PersonDose, RateSpan } from '../engine/dose.ts';
import type { Profile, Row } from '../engine/types.ts';
import type { Store } from './db.ts';

/** How often every dose is worked out again. */
export const DOSE_EVERY_MS = 60_000;
/** An unchanged dose is still sent again after this long, so "today" never falls far behind. */
export const DOSE_RESEND_MS = 5 * 60_000;
/** One rate row a minute per source is enough: a rate holds for up to 10 minutes. */
const SAMPLE_MS = 60_000;
/** The first read goes a day at a time, under the store's limit per read. */
const CHUNK_MS = 24 * 3600_000;
/** At start, the history is read in slices this long, one per turn of the event loop, so alerts are never held up by it. */
export const CATCH_UP_SLICE_MS = 2 * 3600_000;

/** Room radiation rates as held spans, from the mission start, read incrementally. */
export class RateSpans {
  private closed = new Map<string, RateSpan[]>();
  /** The newest row of each series: its span is still open. */
  private open = new Map<string, Row>();
  private readTo: number | null = null;
  private store: Store;
  private from: number;

  constructor(store: Store, from: number) {
    this.store = store;
    this.from = from;
  }

  /**
   * Reads one slice of history toward `now` (CATCH_UP_SLICE_MS of rows) and says whether it is caught up.
   * The spans are the same as at() reading it all at once: slices start on whole minutes from the mission
   * start, like at()'s days, and a row read twice at a slice edge counts once.
   */
  catchUpSlice(now: number): boolean {
    const t = this.readTo ?? this.from;
    if (now - t <= CHUNK_MS) return true;
    const to = t + CATCH_UP_SLICE_MS;
    for (const row of this.store.sampled(DOSE_SIGNAL, t, to, SAMPLE_MS)) this.add(row);
    this.readTo = to;
    return false;
  }

  /** Every span up to `now`, the open ones held for at most 10 minutes. A new list each time. */
  at(now: number): RateSpan[] {
    let t = this.readTo ?? this.from;
    while (t <= now) {
      const to = Math.min(now, t + CHUNK_MS);
      for (const row of this.store.sampled(DOSE_SIGNAL, t, to, SAMPLE_MS)) this.add(row);
      if (to >= now) break;
      t = to;
    }
    // The newest minute is read again next time, as it may have filled since.
    this.readTo = Math.max(this.from, Math.floor(now / SAMPLE_MS) * SAMPLE_MS);
    const out: RateSpan[] = [];
    for (const list of this.closed.values()) out.push(...list);
    for (const row of this.open.values()) out.push(heldSpan(row));
    return out;
  }

  private add(row: Row): void {
    if (!row.room || row.value === null) return;
    const key = seriesOf(row);
    const last = this.open.get(key);
    if (last && row.t <= last.t) return;
    if (last) {
      const list = this.closed.get(key) ?? this.closed.set(key, []).get(key)!;
      pushSpan(list, heldSpan(last, row.t));
    }
    this.open.set(key, row);
  }
}

/** A dose as screens compare it: numbers to 3 significant figures, durations in whole hours, window edges and the clock left out. */
export function doseFingerprint(dose: Record<string, PersonDose>): string {
  return JSON.stringify(dose, (key, value) => {
    if (key === 'now' || key === 'from' || key === 'to') return undefined;
    if (typeof value !== 'number') return value;
    if (key.endsWith('Ms') || key === 'ms') return Math.round(value / 3600_000);
    return Number(value.toPrecision(3));
  });
}

export class CrewDose {
  private dose: Record<string, PersonDose> = {};
  private computed = false;
  private sent: { fingerprint: string; at: number } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Immediate | null = null;
  private store: Store;
  private crew: string[];
  private missionStart: number;
  private plannedEnd: number | null;
  private spans: RateSpans;
  /** Hears every dose that changed (the hub broadcasts it). */
  onChange: (dose: Record<string, PersonDose>) => void = () => {};
  clock: () => number = Date.now;

  constructor(store: Store, profile: Profile) {
    this.store = store;
    this.crew = profile.crew.map((p) => p.id);
    this.missionStart = Date.parse(profile.missionStart);
    this.plannedEnd = plannedEndOf(this.missionStart, profile.mission?.plannedDays);
    this.spans = new RateSpans(store, this.missionStart);
  }

  /** Works the doses out once right away (off the caller's path), then every DOSE_EVERY_MS. */
  start(): void {
    this.stop();
    // A long mission's history is read a slice per turn of the event loop first: read at once, it held the loop for seconds.
    const step = () => {
      this.first = null;
      if (this.spans.catchUpSlice(this.clock())) this.refresh(this.clock());
      else this.first = setImmediate(step);
    };
    this.first = setImmediate(step);
    this.timer = setInterval(() => this.refresh(this.clock()), DOSE_EVERY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.first) clearImmediate(this.first);
    this.first = null;
  }

  /** Works every dose out now, and tells onChange if it changed (or has not been sent for a while). */
  refresh(now: number): Record<string, PersonDose> {
    if (!Number.isFinite(this.missionStart)) return this.dose;
    this.dose = doseOfCrew(this.crew, {
      now,
      missionStart: this.missionStart,
      plannedEnd: this.plannedEnd,
      stays: this.store.stays(Math.min(this.missionStart, now), now),
      spans: this.spans.at(now),
    });
    this.computed = true;
    const fingerprint = doseFingerprint(this.dose);
    if (!this.sent || this.sent.fingerprint !== fingerprint || now - this.sent.at >= DOSE_RESEND_MS || now < this.sent.at) {
      this.sent = { fingerprint, at: now };
      this.onChange(this.dose);
    }
    return this.dose;
  }

  /** The cached doses, worked out first if there are none yet. */
  all(): Record<string, PersonDose> {
    return this.computed ? this.dose : this.refresh(this.clock());
  }
}

/**
 * GET /api/dose: every crewmate's dose, or one with ?person=. A dose carries
 * no typed text, so like the evidence card it goes to any screen (engine/privacy.ts).
 */
export function doseRoute(profile: Profile, dose: CrewDose) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== '/api/dose' || req.method !== 'GET') return false;
    const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    const person = url.searchParams.get('person');
    if (person !== null && !profile.crew.some((p) => p.id === person)) {
      json(400, { error: 'person must be a crewmate in the profile' });
      return true;
    }
    const all = dose.all();
    json(200, person === null ? { dose: all } : { dose: all[person] ?? null });
    return true;
  };
}
