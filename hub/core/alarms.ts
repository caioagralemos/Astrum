// Watches every room against NASA's limits. An alarm stays listed until the
// room is back under the limit, even if its sensor goes quiet; acknowledging
// it marks it silenced. Whether the board's buzzer sounds is decided in one
// place, Hub.soundBoard, from these alarms and the alerts together. Rooms it
// cannot judge, and sensors that may be stuck, are listed too.

import { LIMITS, judgeRooms } from '../engine/cabin.ts';
import type { RoomAlarm, Unjudged } from '../engine/cabin.ts';
import { STUCK_RULES, stuckSensors } from '../engine/quality.ts';
import type { Stuck } from '../engine/quality.ts';
import type { Row } from '../engine/types.ts';
import type { Store } from './db.ts';
import type { Hub } from './server.ts';

export class RoomAlarms {
  private active = new Map<string, RoomAlarm>();
  private timer: NodeJS.Timeout | null = null;
  private hub: Hub;
  private store: Store;
  private rooms: string[];

  constructor(hub: Hub, store: Store, rooms: string[]) {
    this.hub = hub;
    this.store = store;
    this.rooms = rooms;
  }

  start(): void {
    this.timer = setInterval(() => this.check(Date.now()), 10_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Every room's latest average for each limited signal: signal → room → value. */
  averages: Record<string, Record<string, number>> = {};

  /** Rooms and limited signals that could not be judged at the last check. */
  unjudged: Unjudged[] = [];
  /** Room sensors that may be stuck at the last check. */
  stuck: Stuck[] = [];

  list(): RoomAlarm[] {
    return [...this.active.values()];
  }

  check(now: number): void {
    const window = Math.max(...LIMITS.map((l) => l.windowMs), ...STUCK_RULES.map((r) => r.afterMs));
    const byRoom = new Map<string, Row[]>();
    for (const room of this.rooms) {
      const rows = this.store.rows({ room, from: now - window, to: now, limit: 50_000 });
      // A signal with nothing in the window: add its newest older row, so the room can say what it last read.
      for (const limit of LIMITS) {
        if (!rows.some((r) => r.signal === limit.signal && !r.person)) rows.push(...this.store.rows({ room, signal: limit.signal, to: now, limit: 1 }).filter((r) => !r.person));
      }
      byRoom.set(room, rows);
    }
    this.stuck = stuckSensors([...byRoom.values()].flat(), now);
    const before = this.fingerprint();
    const out = judgeRooms(this.rooms, (room) => byRoom.get(room) ?? [], now, this.list(), this.unjudged, this.stuck);
    this.active = new Map(out.alarms.map((a) => [`${a.room}|${a.signal}`, a]));
    this.unjudged = out.unjudged;
    this.averages = out.averages;
    const after = this.fingerprint();
    if (before !== after) this.hub.setAlarms(this.list(), this.unjudged, this.stuck);
  }

  /** What screens need to hear about. The newest reading's time moves every check, so it is left out. */
  private fingerprint(): string {
    return JSON.stringify([
      this.list().map(({ lastReading: _, ...a }) => a),
      this.unjudged.map((u) => [u.room, u.signal, u.reason]),
      this.stuck.map((s) => [s.room, s.signal, s.source]),
    ]);
  }

  /** Marks one room's alarms silenced. Returns false if that room has no alarm waiting. */
  acknowledge(room: string): boolean {
    let found = false;
    for (const alarm of this.active.values()) {
      if (alarm.room === room && !alarm.acknowledged) { alarm.acknowledged = true; found = true; }
    }
    if (found) this.hub.setAlarms(this.list(), this.unjudged, this.stuck);
    return found;
  }
}
