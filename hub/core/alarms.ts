// Watches every room against NASA's limits. An alarm stays listed until the
// room is back under the limit, even if its sensor goes quiet; acknowledging
// it marks it silenced. Whether the board's buzzer sounds is decided in one
// place, Hub.soundBoard, from these alarms and the alerts together. Rooms it
// cannot judge, and sensors that may be stuck, are listed too.
//
// It also judges the levels the crew set on their own room sensors
// (engine/sensors.ts judgeCrewRooms): past an "alarm" level is a room alarm of
// its own, labelled as the crew's (limitSource 'crew'), beside NASA's and never
// mixed with it; past a "warn" level marks the room "watch" (crewWatch).
//
// A drill (core/drill.ts) can stand in for one room's readings of one signal,
// in memory only; the alarm it raises is marked drill.

import { LIMITS, QUIET_MS, judgeRooms, overLimit } from '../engine/cabin.ts';
import type { RoomAlarm, Unjudged } from '../engine/cabin.ts';
import { STUCK_RULES, stuckSensors } from '../engine/quality.ts';
import type { Stuck } from '../engine/quality.ts';
import type { Row } from '../engine/types.ts';
import { judgeCrewRooms, sourceOf } from '../engine/sensors.ts';
import type { CrewLevelInput, CrewWatch, SensorSpec } from '../engine/sensors.ts';
import type { Store } from './db.ts';
import type { Hub } from './server.ts';
import { DRILL_SOURCE } from './drill.ts';

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
  /** Rooms past a "warn" level the crew set, at the last check. */
  crewWatch: CrewWatch[] = [];
  /** The sensors the crew registered (core/sensors.ts). Their levels are judged on every check. */
  crewSensors: () => SensorSpec[] = () => [];
  /**
   * A drill's simulated readings for one room and signal (core/drill.ts), or null. While it gives
   * rows, the room's signal is judged on them in place of the stored ones. They are never stored,
   * and the stored rows still count for "may be stuck".
   */
  override: (room: string, signal: string, from: number, to: number) => Row[] | null = () => null;
  /** Rooms whose stored readings were over a limit under a drill's readings, at the last check: a real alarm hidden by the drill. */
  masked: string[] = [];

  list(): RoomAlarm[] {
    return [...this.active.values()];
  }

  check(now: number): void {
    const window = Math.max(...LIMITS.map((l) => l.windowMs), ...STUCK_RULES.map((r) => r.afterMs));
    const byRoom = new Map<string, Row[]>();
    const inWindow: Row[] = [];
    const masked: string[] = [];
    // The newest row of each source, if the store did not write it (core/persist.ts): it repeats or
    // nearly repeats the last row written, so it changes no average, and it keeps "last reading" exact.
    // Only the signals with a limit or a stuck rule are judged here; the rest of the room is not read.
    const signals = [...new Set([...LIMITS.map((l) => l.signal), ...STUCK_RULES.map((r) => r.signal)])];
    const unwritten = this.store.recent(now - window).filter((r) => r.id === undefined && r.room && !r.person && r.t <= now && signals.includes(r.signal));
    for (const room of this.rooms) {
      // Ten minutes more than the window, so the average knows the reading in force when the window opens.
      // A signal with only a stuck rule is only ever judged on measured rows.
      const rows = signals.flatMap((signal) => this.store.rows({
        room, signal, kind: LIMITS.some((l) => l.signal === signal) ? undefined : 'measured', from: now - window - QUIET_MS, to: now, limit: 50_000,
      }));
      for (const r of unwritten) if (r.room === room) rows.push(r);
      for (const r of rows) if (r.t >= now - window) inWindow.push(r);
      // A signal with nothing in the window: add its newest older row, so the room can say what it last read.
      for (const limit of LIMITS) {
        if (!rows.some((r) => r.signal === limit.signal && !r.person)) rows.push(...this.store.rows({ room, signal: limit.signal, to: now, limit: 1 }).filter((r) => !r.person));
      }
      // A drill's readings stand in for the stored ones of its signal; whether the stored ones are over the limit is still known.
      let judged = rows;
      for (const limit of LIMITS) {
        const drill = this.override(room, limit.signal, now - window - QUIET_MS, now);
        if (!drill) continue;
        if (overLimit(rows, room, now).some((o) => o.signal === limit.signal)) masked.push(room);
        judged = [...judged.filter((r) => r.signal !== limit.signal), ...drill];
      }
      byRoom.set(room, judged);
    }
    this.masked = masked;
    this.stuck = stuckSensors(inWindow, now);
    const before = this.fingerprint();
    // A drill's alarm whose readings are gone ends here, whatever the stored readings say.
    const held = this.list().filter((a) => !a.drill || this.override(a.room, a.signal, now, now) !== null);
    const out = judgeRooms(this.rooms, (room) => byRoom.get(room) ?? [], now, held, this.unjudged, this.stuck);
    for (const a of out.alarms) if (a.source === DRILL_SOURCE) a.drill = true;
    const crew = judgeCrewRooms(this.crewInputs(now), now, this.list(), this.stuck);
    this.active = new Map([
      ...out.alarms.map((a): [string, RoomAlarm] => [`${a.room}|${a.signal}`, a]),
      ...crew.alarms.map((a): [string, RoomAlarm] => [`${a.room}|${a.signal}|${a.source}`, a]),
    ]);
    this.unjudged = out.unjudged;
    this.averages = out.averages;
    this.crewWatch = crew.watch;
    const after = this.fingerprint();
    if (before !== after) this.hub.setAlarms(this.list(), this.unjudged, this.stuck, this.crewWatch);
  }

  /** Every registered room sensor's signal that has a level set, with that sensor's rows long enough back to judge it. */
  private crewInputs(now: number): CrewLevelInput[] {
    const inputs: CrewLevelInput[] = [];
    let newest: Row[] | null = null;
    for (const sensor of this.crewSensors()) {
      if (!sensor.room || !this.rooms.includes(sensor.room)) continue;
      const source = sourceOf(sensor.id);
      for (const spec of sensor.signals) {
        const l = spec.limits;
        if (!l || [l.warnAbove, l.warnBelow, l.alarmAbove, l.alarmBelow].every((v) => v === undefined)) continue;
        const from = now - (l.windowMinutes ?? 0) * 60_000 - QUIET_MS;
        const mine = (rows: Row[]) => rows.filter((r) => r.source === source && !r.person);
        let rows = mine(this.store.rows({ room: sensor.room, signal: spec.signal, from, to: now, limit: 50_000 }));
        // The newest row the store did not write still counts (core/persist.ts).
        newest ??= this.store.recent(now - QUIET_MS).filter((r) => r.id === undefined);
        rows.push(...newest.filter((r) => r.source === source && r.room === sensor.room && r.signal === spec.signal && !r.person && r.t <= now));
        // Quiet for longer: its newest older row, so an alarm can say what it last read.
        if (!rows.length) rows = mine(this.store.rows({ room: sensor.room, signal: spec.signal, to: now, limit: 500 })).slice(-1);
        inputs.push({ sensor, spec, rows });
      }
    }
    return inputs;
  }

  /** What screens need to hear about. The newest reading's time moves every check, so it is left out. */
  private fingerprint(): string {
    return JSON.stringify([
      this.list().map(({ lastReading: _, ...a }) => a),
      this.unjudged.map((u) => [u.room, u.signal, u.reason]),
      this.stuck.map((s) => [s.room, s.signal, s.source]),
      this.crewWatch.map(({ at: _, ...w }) => w),
    ]);
  }

  /** Marks one room's alarms silenced. Returns false if that room has no alarm waiting. */
  acknowledge(room: string): boolean {
    let found = false;
    for (const alarm of this.active.values()) {
      if (alarm.room === room && !alarm.acknowledged) { alarm.acknowledged = true; found = true; }
    }
    if (found) this.hub.setAlarms(this.list(), this.unjudged, this.stuck, this.crewWatch);
    return found;
  }
}
