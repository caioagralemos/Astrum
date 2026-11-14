// Which rows the hub writes to disk. Every row is still sent live to every
// screen as it arrives; this only decides what the database keeps.
//
// Why: the stand-in sends about 50 rows a second and the NASA replay repeats
// each room's current value every 4 seconds. Kept whole, that is a million
// rows a day, and every query over history slows down with it.
//
// The rule, per signal, place and source (the "key"):
//  - Kept whole, always: anything reported, estimated or typed (check-ins,
//    blood results), rows that carry text, the simulated crew, and any source
//    not named below. Nothing a person entered is ever thinned.
//  - The stand-in's simulated values (sim:hub) and the NASA replay
//    (nasa:osdr-rr1): one row a minute per key, plus every row whose value
//    moved by at least a step from the last row kept. For the replay a step
//    is any change at all: its values only change every 5 minutes, so its
//    stored series is the exact one (its 5-minute history fill is a row every
//    5 minutes, so all of it is kept). For the stand-in a step is five sensor
//    steps: its made-up wander, rounded to the screen's decimals, flickers
//    across one sensor step every few seconds and means nothing.
//  - Measured rows (the chip, phones, sensors the crew adds): one row every
//    10 seconds per key, plus every row whose value moved by at least the
//    signal's step. A clap or a hand over the light sensor moves far more than
//    a step, so it is kept, and so is the reading after it.
//
// What history is used for, and why this keeps it:
//  - The 1-hour CO2 average (cabin.ts) holds each reading until the next, for
//    up to 10 minutes. A dropped row only repeated (replay) or nearly repeated
//    (within a step) the row kept before it, and a row is kept at least every
//    minute, so the average is unchanged within rounding, and exactly for the
//    replay (tested). That needs the reading in force when the hour opens to
//    count (cabin.ts windowAverage), and the alarm watcher to see each
//    source's newest row even when it was not written (alarms.ts).
//  - Exposure and evidence already sample cabin CO2 at one row a minute.
//  - The stuck-sensor check needs 10 identical CO2 readings over 30 minutes,
//    or 30 identical noise readings over 10 minutes: one row every 10 seconds
//    gives 180 and 60.
//  - Baselines read the crew's body rows, which are kept whole.
// Thinning never changes a row: no kind, source or value is altered and no
// row is made up. A dropped row is simply not written.

import type { Row } from '../engine/types.ts';
import { STAND_IN } from './server.ts';
import { NASA_SOURCE } from './nasa.ts';

/** A demo row (stand-in or replay) is kept at least this often per key. */
export const DEMO_EVERY_MS = 60_000;
/** A measured row is kept at least this often per key. */
export const MEASURED_EVERY_MS = 10_000;

/**
 * The smallest change that is always kept, by signal and unit. About the
 * sensor's own resolution or a little above its jitter at rest; anything a
 * person would notice is many steps. A signal or unit not listed has step 0:
 * every change is kept.
 */
export const STEPS: Record<string, number> = {
  'co2|mmHg': 0.02,
  'co2|ppm': 20,
  'pressure|hPa': 0.2,
  'temperature|C': 0.1,
  'humidity|%': 1,
  'oxygen|mmHg': 0.5,
  'vibration|g': 0.01,
  'air_quality|index': 1,
  // The chip's microphone swings by about 130 counts between readings in a quiet room; a clap reaches 4095.
  'noise|raw': 400,
  // A hand over the light sensor drops it by hundreds of counts.
  'light|raw': 40,
  'radiation|uGy/day': 2,
};

/** The stand-in's step, in sensor steps (see the rule above). */
export const STAND_IN_STEPS = 5;

/** Float noise allowance, so a change of exactly one step counts as one. */
const EPSILON = 1e-9;

/** How often a row like this must be kept, or null if every one is kept. */
export function thinEvery(row: Row): number | null {
  if (row.value === null || row.text) return null;
  if (row.signal.startsWith('blood.') || row.signal.startsWith('checkin.')) return null;
  if (row.kind === 'simulated' && row.source === STAND_IN) return DEMO_EVERY_MS;
  if (row.kind === 'replayed' && row.source === NASA_SOURCE) return DEMO_EVERY_MS;
  if (row.kind === 'measured') return MEASURED_EVERY_MS;
  return null;
}

/** The change that is always kept for this row. */
export function stepOf(row: Row): number {
  if (row.kind === 'replayed') return 0;
  const step = STEPS[`${row.signal}|${row.unit}`] ?? 0;
  return row.kind === 'simulated' ? step * STAND_IN_STEPS : step;
}

/** The key thinning works on: one series of one source in one place. */
export function seriesKey(row: Row): string {
  return `${row.source}|${row.signal}|${row.person ?? ''}|${row.room ?? ''}|${row.unit}`;
}

/** Remembers the last row kept for each series and decides about the next one. */
export class Persistence {
  private kept = new Map<string, { t: number; value: number }>();

  /** True if this row is to be written. Rows must be offered in the order they arrive. */
  keep(row: Row): boolean {
    const every = thinEvery(row);
    if (every === null) return true;
    const key = seriesKey(row);
    const last = this.kept.get(key);
    // Older than the last row kept: history arriving late, kept as it comes.
    if (last && row.t < last.t) return true;
    const keep = !last
      || row.t - last.t >= every
      || (row.value !== last.value && Math.abs(row.value! - last.value) >= stepOf(row) - EPSILON);
    if (keep) this.kept.set(key, { t: row.t, value: row.value! });
    return keep;
  }
}
