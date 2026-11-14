// Runs the simulated crew in demo mode: fills in the last three days when the
// hub starts, then keeps the crew going live. Production never loads this.

import { CREW_SOURCE, SHIP_PLACES, crewPeriod, roomAt, simulates } from '../engine/crew.ts';
import type { Places } from '../engine/crew.ts';
import type { Store } from './db.ts';
import type { Hub } from './server.ts';

const HISTORY_MS = 3 * 24 * 3600_000;
const HISTORY_STEP_MS = 5 * 60_000;
const LIVE_STEP_MS = 5000;

export class SimulatedCrew {
  private timer: NodeJS.Timeout | null = null;
  private last = 0;
  private hub: Hub;
  private store: Store;
  private people: string[];
  private offsetMinutes: number;
  /** Which room plays each part of the day, from the mission (engine/crew.ts placesOf). */
  private places: Record<string, Places>;

  constructor(hub: Hub, store: Store, people: string[], offsetMinutes = -new Date().getTimezoneOffset(), places: Record<string, Places> = SHIP_PLACES) {
    this.hub = hub;
    this.store = store;
    this.places = places;
    this.people = people.filter((p) => simulates(p) && places[p]);
    this.offsetMinutes = offsetMinutes;
  }

  start(now = Date.now()): void {
    this.catchUp(now);
    this.timer = setInterval(() => this.step(Date.now(), LIVE_STEP_MS), LIVE_STEP_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Fills the gap since the crew's last row, at most three days back. */
  catchUp(now: number): void {
    const lastRow = this.store.lastTime(CREW_SOURCE);
    const from = Math.max(lastRow ?? 0, now - HISTORY_MS);
    if (lastRow === null) {
      const hour = (((from + this.offsetMinutes * 60_000) % 86_400_000) + 86_400_000) % 86_400_000 / 3600_000;
      for (const person of this.people) this.hub.move(person, roomAt(person, hour, this.places), from, 'simulated', CREW_SOURCE);
    }
    this.last = from;
    // Someone added to the crew since the history was filled gets the same three days the others have.
    if (lastRow !== null && lastRow > now - HISTORY_MS) {
      const start = now - HISTORY_MS;
      const newcomers = this.people.filter((p) => this.store.rows({ person: p, signal: 'heart_rate', kind: 'simulated', from: start, limit: 1 }).length === 0);
      if (newcomers.length) {
        const hour = (((start + this.offsetMinutes * 60_000) % 86_400_000) + 86_400_000) % 86_400_000 / 3600_000;
        for (const person of newcomers) this.hub.move(person, roomAt(person, hour, this.places), start, 'simulated', CREW_SOURCE);
        const { rows, moves } = crewPeriod(newcomers, start, from, HISTORY_STEP_MS, this.offsetMinutes, this.places);
        for (const move of moves) this.hub.move(move.person, move.room, move.t, 'simulated', CREW_SOURCE);
        this.hub.ingest(rows);
      }
    }
    this.step(now, HISTORY_STEP_MS);
  }

  /** Everything since the last step, up to `now`. Live calls it every 5 seconds; the scenario drives it on its own clock. */
  step(now: number, stepMs = LIVE_STEP_MS): void {
    const { rows, moves } = crewPeriod(this.people, this.last, now, stepMs, this.offsetMinutes, this.places);
    this.last = now;
    for (const move of moves) this.hub.move(move.person, move.room, move.t, 'simulated', CREW_SOURCE);
    this.hub.ingest(rows);
  }
}
