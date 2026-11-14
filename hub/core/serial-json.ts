// Sensor adapter for any device on a serial cable that prints one JSON object
// per line, like the chip does:
//
//   {"sensor":"rad-1","r":[["radiation",0.31,"uSv/h","m"]]}
//
// Each reading is [signal, value, unit, kind], kind "m" measured, "e"
// estimated or "s" simulated. The device names itself; the crew's registration
// (core/sensors.ts) says which room or person it belongs to. Lines from a
// sensor nobody registered store nothing: the hub only notes that it heard
// them, which is how a person finds a new device to add.

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import type { Kind, Row } from '../engine/types.ts';
import { rowProblem } from '../engine/timeline.ts';
import { SENSOR_ID, sourceOf } from '../engine/sensors.ts';
import type { Adapter, Sink } from './chip.ts';

const KIND: Record<string, Kind> = { m: 'measured', e: 'estimated', s: 'simulated', measured: 'measured', estimated: 'estimated', simulated: 'simulated' };

/** Where a registered sensor's readings belong. */
export interface SensorPlace {
  room?: string;
  person?: string;
}

/** What the adapter asks of the sensor registry. */
export interface SensorDirectory {
  /** The registered sensor's place, or null if nobody registered it. */
  placeOf(id: string): SensorPlace | null;
  /** A line came from a sensor nobody registered. */
  heardUnknown(id: string, at: number, via: string, signals: string[]): void;
}

export interface SensorLine {
  sensor: string;
  /** False when nobody registered this sensor: then there are no rows. */
  known: boolean;
  rows: Row[];
  /** Every signal the line named, kept or not, so an unknown sensor can be described. */
  signals: string[];
}

/**
 * Parses one line. Returns null for anything that is not a well-formed
 * message, because a serial line can carry boot noise. A reading with a
 * missing or non-numeric value is dropped, never filled in.
 */
export function parseSensorLine(line: string, now: number, placeOf: (id: string) => SensorPlace | null): SensorLine | null {
  let msg: unknown;
  try { msg = JSON.parse(line); } catch { return null; }
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return null;
  const m = msg as { sensor?: unknown; r?: unknown };
  if (typeof m.sensor !== 'string' || !SENSOR_ID.test(m.sensor)) return null;
  const sensor = m.sensor;
  const place = placeOf(sensor);
  const rows: Row[] = [];
  const signals: string[] = [];
  for (const item of Array.isArray(m.r) ? m.r : []) {
    if (!Array.isArray(item)) continue;
    const [signal, value, unit, k] = item as unknown[];
    if (typeof signal === 'string' && !signals.includes(signal)) signals.push(signal);
    const kind = typeof k === 'string' ? KIND[k] : undefined;
    if (!place || typeof signal !== 'string' || typeof value !== 'number' || !Number.isFinite(value) || typeof unit !== 'string' || !kind) continue;
    // Like the chip, the device has no clock, so the hub stamps the moment the line arrived.
    const row: Row = { t: now, signal, value, unit, kind, source: sourceOf(sensor), person: place.person ?? null, room: place.room ?? null };
    if (rowProblem(row) === null) rows.push(row);
  }
  return { sensor, known: !!place, rows, signals };
}

/** A sensor that has sent nothing for this long is reported as not connected. */
const QUIET_AFTER_MS = 10_000;

/** One serial port. Several sensors may share it; each is reported as its own source. */
export class SerialJsonAdapter implements Adapter {
  private port: SerialPort | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private sink: Sink;
  private directory: SensorDirectory;
  private path: string;
  private baudRate: number;
  /** Per registered sensor: when it last spoke and what it sent. */
  private seen = new Map<string, { lastSeen: number; live: string[]; connected: boolean }>();

  constructor(sink: Sink, directory: SensorDirectory, path: string, baudRate = 115200) {
    this.sink = sink;
    this.directory = directory;
    this.path = path;
    this.baudRate = baudRate;
  }

  start(): void {
    this.stopped = false;
    this.tryOpen();
    this.timer = setInterval(() => {
      if (!this.port) this.tryOpen();
      const now = Date.now();
      for (const [id, s] of this.seen) if (s.connected && now - s.lastSeen > QUIET_AFTER_MS) this.report(id, false);
    }, 3000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.port?.close(() => {});
    this.port = null;
  }

  private tryOpen(): void {
    if (this.stopped || this.port) return;
    const port = new SerialPort({ path: this.path, baudRate: this.baudRate, autoOpen: false });
    this.port = port;
    port.on('error', () => this.drop(port));
    port.on('close', () => this.drop(port));
    port.pipe(new ReadlineParser({ delimiter: '\n' })).on('data', (line: string) => this.onLine(line.trim(), Date.now()));
    port.open((err) => { if (err) this.drop(port); });
  }

  private drop(port: SerialPort): void {
    if (this.port !== port) return;
    this.port = null;
    for (const id of this.seen.keys()) this.report(id, false);
  }

  /** Handles one line as if it came off the cable. Public so it can be tested without a port. */
  onLine(line: string, now: number): void {
    const parsed = parseSensorLine(line, now, (id) => this.directory.placeOf(id));
    if (!parsed) return;
    if (!parsed.known) {
      this.directory.heardUnknown(parsed.sensor, now, `serial:${this.path}`, parsed.signals);
      return;
    }
    const held = this.seen.get(parsed.sensor);
    this.seen.set(parsed.sensor, { lastSeen: now, live: parsed.rows.length ? parsed.rows.map((r) => r.signal) : held?.live ?? [], connected: true });
    if (parsed.rows.length) this.sink.rows(parsed.rows);
    this.report(parsed.sensor, true);
  }

  private report(id: string, connected: boolean): void {
    const s = this.seen.get(id);
    if (!s) return;
    s.connected = connected;
    const place = this.directory.placeOf(id);
    this.sink.status({ id: sourceOf(id), connected, room: place?.room ?? null, live: connected ? s.live : [], missing: [], lastSeen: s.lastSeen });
  }
}
