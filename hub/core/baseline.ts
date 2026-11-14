// Keeps each crewmate's baseline summary up to date (engine/baseline.ts) and
// hands the alert levels the readings that have stayed unusual.
//
// A reading has to stay unusual for 20 minutes before anyone is told: on
// ordinary simulated days the first minutes of exercise looked unusual for a
// moment about once a day, and a crew that gets false alarms stops listening.

import { personSummary, stateWithSleep } from '../engine/baseline.ts';
import type { PersonSummary } from '../engine/baseline.ts';
import type { Unusual } from '../engine/alerts.ts';
import type { Kind } from '../engine/types.ts';
import type { Store } from './db.ts';

const BASELINE_MS = 14 * 24 * 3600_000;
const REFRESH_MS = 60_000;
export const SUSTAIN_MS = 20 * 60_000;
const RANK: Kind[] = ['simulated', 'replayed', 'reported', 'estimated', 'measured'];

export class Baselines {
  private summaries: PersonSummary[] = [];
  private computedAt = 0;
  /** When each person's signal first turned unusual in its current run. */
  private unusualSince = new Map<string, number>();
  private store: Store;
  private people: string[];
  private offsetMinutes: number;

  constructor(store: Store, people: string[], offsetMinutes = -new Date().getTimezoneOffset()) {
    this.store = store;
    this.people = people;
    this.offsetMinutes = offsetMinutes;
  }

  /** Everyone's summary, recomputed at most once a minute. */
  all(now: number): PersonSummary[] {
    if (now - this.computedAt < REFRESH_MS && now >= this.computedAt) return this.summaries;
    const stateOf = stateWithSleep(this.offsetMinutes);
    this.summaries = this.people.map((person) => {
      const rows = this.store.rows({ person, from: now - BASELINE_MS, to: now, limit: 50_000 });
      return personSummary(rows, person, now, { stateOf });
    });
    this.computedAt = now;

    const seen = new Set<string>();
    for (const summary of this.summaries) {
      for (const s of summary.signals) {
        if (s.status !== 'judged' || !s.unusual) continue;
        const key = `${summary.person}|${s.signal}|${s.direction}`;
        seen.add(key);
        if (!this.unusualSince.has(key)) this.unusualSince.set(key, now);
      }
    }
    for (const key of [...this.unusualSince.keys()]) if (!seen.has(key)) this.unusualSince.delete(key);
    return this.summaries;
  }

  /** Readings that have been unusual for at least 20 minutes. */
  sustained(now: number): Unusual[] {
    const out: Unusual[] = [];
    for (const summary of this.all(now)) {
      for (const s of summary.signals) {
        if (s.status !== 'judged' || !s.unusual) continue;
        const since = this.unusualSince.get(`${summary.person}|${s.signal}|${s.direction}`);
        if (since === undefined || now - since < SUSTAIN_MS) continue;
        // The label is the weakest kind the baseline was built from.
        const kind = RANK.find((k) => (s.kinds[k] ?? 0) > 0) ?? 'simulated';
        out.push({ person: summary.person, signal: s.signal, direction: s.direction, z: s.z, kind });
      }
    }
    return out;
  }
}
