// Stand-in values, demo mode only.
//
// The hub never passes a made-up value off as real, and in production it makes
// none. In demo mode, when no source is giving a cabin signal for a room that
// this fills the gap with a slow wander around an ordinary cabin value, so the
// demo station has every reading a real one would. Every such row is marked simulated and comes from the source
// "sim:hub", and it stops the moment any other source gives that signal.

import type { Row } from '../engine/types.ts';
import { STAND_IN } from './server.ts';
import type { Hub } from './server.ts';

interface Shape { unit: string; centre: number; step: number; pull: number; decimals: number }

const SHAPES: Record<string, Shape> = {
  pressure: { unit: 'hPa', centre: 1013, step: 0.05, pull: 0.02, decimals: 1 },
  temperature: { unit: 'C', centre: 23, step: 0.03, pull: 0.02, decimals: 1 },
  humidity: { unit: '%', centre: 45, step: 0.2, pull: 0.02, decimals: 0 },
  co2: { unit: 'mmHg', centre: 2.4, step: 0.004, pull: 0.01, decimals: 2 },
  oxygen: { unit: 'mmHg', centre: 160, step: 0.05, pull: 0.02, decimals: 1 },
  vibration: { unit: 'g', centre: 0.002, step: 0.0005, pull: 0.1, decimals: 4 },
  air_quality: { unit: 'index', centre: 1.4, step: 0.05, pull: 0.05, decimals: 0 },
  // Raw 0-4095 readings, like the chip's microphone and light sensor.
  noise: { unit: 'raw', centre: 240, step: 12, pull: 0.2, decimals: 0 },
  light: { unit: 'raw', centre: 1900, step: 6, pull: 0.05, decimals: 0 },
  radiation: { unit: 'uGy/day', centre: 320, step: 0.4, pull: 0.02, decimals: 0 },
};

/**
 * Radiation differs by room on a real station. These centres are the six
 * per-room dose rates measured on Mir (Mir 19, 1995, 261 to 414 uGy/day;
 * Badhwar et al., from NASA's Life Sciences Portal, dataset J0001100), handed
 * out to the demo's rooms. Mir flew inside Earth's magnetic field; deep space
 * is higher. The values shown are still simulated.
 */
const RADIATION_CENTRES = [352.5, 414.0, 261.0, 292.8, 279.0, 336.0];

export class StandIn {
  private values = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private hub: Hub;
  private rooms: string[];
  private random: () => number;

  constructor(hub: Hub, rooms: string[], random: () => number = Math.random) {
    this.hub = hub;
    this.rooms = rooms;
    this.random = random;
  }

  start(): void {
    this.timer = setInterval(() => void this.hub.ingest(this.tick(Date.now())), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The rows for one second: only the signals nobody else is giving. */
  tick(now: number): Row[] {
    const rows: Row[] = [];
    for (const room of this.rooms) {
      for (const [signal, shape] of Object.entries(SHAPES)) {
        if (this.hub.hasSource(room, signal, now)) continue;
        const key = `${room}|${signal}`;
        const centre = signal === 'radiation' ? RADIATION_CENTRES[this.rooms.indexOf(room) % RADIATION_CENTRES.length] : shape.centre;
        const before = this.values.get(key) ?? centre;
        const value = Math.max(0, before + (this.random() * 2 - 1) * shape.step + (centre - before) * shape.pull);
        this.values.set(key, value);
        rows.push({ t: now, signal, value: Number(value.toFixed(shape.decimals)), unit: shape.unit, kind: 'simulated', source: STAND_IN, room });
      }
    }
    return rows;
  }
}
