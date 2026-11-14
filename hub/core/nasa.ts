// Replays NASA's real ISS cabin record as the air of the demo's rooms.
//
// The values are NASA's, unchanged apart from the unit conversion described in
// data-nasa/osdr-rr1/SOURCE.txt. What is not real is the place and the date:
// the record is from the ISS in 2014 and is shifted in time to play here. Every
// row is marked "replayed" and names its source. Demo mode only.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Row } from '../engine/types.ts';
import type { Store } from './db.ts';
import type { Hub } from './server.ts';

export const NASA_SOURCE = 'nasa:osdr-rr1';

const DAY = 24 * 3600_000;
const STEP = 300_000;
const HISTORY_MS = 3 * DAY;
/** ppm to mmHg at a cabin pressure of 760 mmHg. */
const PPM_TO_MMHG = 760 / 1_000_000;

/**
 * Which moment of the record plays at 00:00 UTC on Sunday 15 Nov 2026 in each room.
 *
 * Quarters 2 plays 27 Oct to 1 Nov 2014: a stretch that sits in the band where
 * NASA reports headaches (2.8 mmHg and above) for about four hours over three
 * days, all of them at night by the station's clock, while its 1-hour average
 * never passes the 3 mmHg limit (highest 2.93; single readings touch 3 for 15
 * minutes in all). So no alarm fires, and the exposure is still there to be
 * found. The stretch was chosen by searching the record for the most such
 * night hours with no hour over the limit anywhere in the hub's history
 * window (from three days before Saturday 14 Nov to the end of Sunday 15 Nov);
 * no value is changed.
 * The scenario reaches a climb past the limit by moving `aheadMs` (the record
 * passes 3 mmHg on 24 to 26 Oct, and on 5 to 7 Oct with a 1-hour average of 3.5).
 *
 * The other rooms play calm stretches (never above 2.8 on the day itself or
 * the three days before it), each a different one so they do not move in step.
 *
 * Which room plays what follows a rule, so any mission's rooms can be filled
 * (replayMoments): the story's subject room (the first crewmate's quarters)
 * plays the stretch above; every other room, in the mission's order, takes
 * the next calm stretch, in the order below. A mission with more rooms than
 * stretches starts them again, each round CYCLE_SHIFT_MS earlier in the
 * record, so no two rooms play the same moment. On the ship this gives each
 * room exactly the stretch it has always played.
 */
const ANCHOR_2026 = Date.UTC(2026, 10, 15);
export const SUBJECT_MOMENT = '2014-10-30T18:00:00Z';
export const CALM_MOMENTS: readonly string[] = [
  '2014-10-12T00:00:00Z',
  '2014-10-13T00:00:00Z',
  '2014-09-30T00:00:00Z',
  '2014-10-01T00:00:00Z',
  '2014-10-16T00:00:00Z',
  '2014-10-02T00:00:00Z',
  '2014-10-17T00:00:00Z',
];
/** How much earlier in the record each further round of calm stretches starts. */
export const CYCLE_SHIFT_MS = 2 * 3600_000 + 35 * 60_000;

/** The record time each room plays at the anchor, by the rule above. `subject` may be null (no story room). */
export function replayMoments(rooms: string[], subject: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  let i = 0;
  for (const room of rooms) {
    if (room === subject) { out[room] = Date.parse(SUBJECT_MOMENT); continue; }
    out[room] = Date.parse(CALM_MOMENTS[i % CALM_MOMENTS.length]) - Math.floor(i / CALM_MOMENTS.length) * CYCLE_SHIFT_MS;
    i++;
  }
  return out;
}

interface Series { start: number; values: number[] }

function load(dir: string, file: string, field: string): Series {
  const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>[];
  const start = Date.parse(String(raw[0].time));
  const values: number[] = [];
  // The record is one row every 5 minutes with a few uneven steps; put it on an even grid.
  for (const item of raw) {
    const index = Math.round((Date.parse(String(item.time)) - start) / STEP);
    const value = item[field];
    if (typeof value === 'number') values[index] = value;
  }
  for (let i = 1; i < values.length; i++) if (values[i] === undefined) values[i] = values[i - 1];
  return { start, values };
}

export class NasaReplay {
  private timer: NodeJS.Timeout | null = null;
  private last = 0;
  /** How far ahead in the record the subject room plays. The scenario sets it to reach the climb. */
  aheadMs = 0;
  private series: { signal: string; unit: string; scale: number; decimals: number; data: Series }[];
  private hub: Hub;
  private store: Store;
  private rooms: string[];
  /** The story's room: the only one `aheadMs` moves. */
  readonly subject: string | null;
  private moments: Record<string, number>;

  /** `rooms` in the mission's order; `subject` is the first crewmate's quarters (the ship's is Quarters 2). */
  constructor(hub: Hub, store: Store, dir: string, rooms: string[], subject: string | null = 'quarters-2') {
    this.hub = hub;
    this.store = store;
    this.rooms = rooms;
    this.subject = rooms.includes(subject ?? '') ? subject : null;
    this.moments = replayMoments(rooms, this.subject);
    this.series = [
      { signal: 'co2', unit: 'mmHg', scale: PPM_TO_MMHG, decimals: 2, data: load(dir, 'co2.json', 'co2_iss') },
      { signal: 'temperature', unit: 'C', scale: 1, decimals: 1, data: load(dir, 'temperature-iss.json', 'temperature_iss') },
      { signal: 'humidity', unit: '%', scale: 1, decimals: 0, data: load(dir, 'humidity-iss.json', 'humidity_iss') },
    ];
  }

  start(now = Date.now()): void {
    this.catchUp(now);
    // The record has a value every 5 minutes; repeat the current one often
    // enough that screens keep showing it as current and the stand-in stays out.
    this.hub.ingest(this.at(now));
    this.timer = setInterval(() => this.hub.ingest(this.at(Date.now())), 4000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Fills history since the last replayed row, at most three days back. */
  catchUp(now: number): void {
    const from = Math.max(this.store.lastTime(NASA_SOURCE) ?? 0, now - HISTORY_MS);
    const rows: Row[] = [];
    for (let t = Math.floor(from / STEP) * STEP + STEP; t <= now; t += STEP) rows.push(...this.at(t));
    this.hub.ingest(rows);
    this.last = now;
  }

  /** The moment of the record that plays in a room at hub time t. */
  recordTime(room: string, t: number): number {
    return this.moments[room] + (t - ANCHOR_2026) + (room === this.subject ? this.aheadMs : 0);
  }

  /** Every room's replayed readings at one moment. */
  at(t: number): Row[] {
    const rows: Row[] = [];
    for (const room of this.rooms) {
      for (const s of this.series) {
        const index = Math.floor((this.recordTime(room, t) - s.data.start) / STEP);
        const value = s.data.values[index];
        if (value === undefined) continue; // outside the record: send nothing
        rows.push({ t, signal: s.signal, value: Number((value * s.scale).toFixed(s.decimals)), unit: s.unit, kind: 'replayed', source: NASA_SOURCE, room });
      }
    }
    return rows;
  }
}
