// Sensor adapter for the cabin chip over USB serial.
//
// The chip speaks one JSON object per line (see chip/README.md). This adapter
// finds the port, keeps reconnecting, turns each line into timeline rows and
// reports which parts are answering.

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import type { Kind, Row, SourceStatus } from '../engine/types.ts';

/** What every sensor adapter gives the hub. Other adapters implement the same. */
export interface Sink {
  rows(rows: Row[]): void;
  status(status: SourceStatus): void;
}

export interface Adapter {
  start(): void;
  stop(): void;
  /** Sends a command to the device, if it takes any. */
  send?(command: Record<string, unknown>): boolean;
}

const KIND: Record<string, Kind> = { m: 'measured', e: 'estimated', s: 'simulated' };

export interface ChipLine {
  rows: Row[];
  chip?: string;
  missing?: string[];
}

/**
 * Parses one line from the chip. Returns null for anything that is not a
 * well-formed message, because a serial line can carry boot noise.
 */
export function parseChipLine(line: string, now: number, roomOf: (chip: string) => string | null): ChipLine | null {
  let msg: any;
  try { msg = JSON.parse(line); } catch { return null; }
  if (typeof msg !== 'object' || msg === null || typeof msg.chip !== 'string') return null;
  const chip: string = msg.chip;
  if (!/^[a-z0-9-]{1,32}$/.test(chip)) return null;
  const missing = Array.isArray(msg.missing) ? msg.missing.filter((s: unknown) => typeof s === 'string') : [];
  const room = roomOf(chip);
  const rows: Row[] = [];
  if (Array.isArray(msg.r) && room) {
    for (const item of msg.r) {
      if (!Array.isArray(item)) continue;
      const [signal, value, unit, k] = item;
      const kind = KIND[k];
      if (typeof signal !== 'string' || typeof value !== 'number' || !Number.isFinite(value) || typeof unit !== 'string' || !kind) continue;
      // The chip has no clock, so the hub stamps the moment the line arrived.
      rows.push({ t: now, signal, value, unit, kind, source: `chip:${chip}`, room });
    }
  }
  return { rows, chip, missing };
}

export class ChipAdapter implements Adapter {
  private port: SerialPort | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private chip: string | null = null;
  private lastSeen: number | null = null;
  private live: string[] = [];
  private missing: string[] = [];
  private sink: Sink;
  private roomOf: (chip: string) => string | null;
  private fixedPath: string | undefined;

  constructor(sink: Sink, roomOf: (chip: string) => string | null, fixedPath?: string) {
    this.sink = sink;
    this.roomOf = roomOf;
    this.fixedPath = fixedPath;
  }

  start(): void {
    this.stopped = false;
    void this.tryOpen();
    this.timer = setInterval(() => {
      if (!this.port) void this.tryOpen();
      // A chip that stops talking without unplugging still counts as gone.
      else if (this.lastSeen && Date.now() - this.lastSeen > 10_000) this.report(false);
    }, 3000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.port?.close(() => {});
    this.port = null;
  }

  send(command: Record<string, unknown>): boolean {
    if (!this.port?.isOpen) return false;
    this.port.write(`${JSON.stringify(command)}\n`);
    return true;
  }

  private async tryOpen(): Promise<void> {
    if (this.stopped || this.port) return;
    const path = this.fixedPath ?? (await findChipPort());
    if (!path) return;
    const port = new SerialPort({ path, baudRate: 115200, autoOpen: false });
    this.port = port;
    port.on('error', () => this.drop(port));
    port.on('close', () => this.drop(port));
    port.pipe(new ReadlineParser({ delimiter: '\n' })).on('data', (line: string) => this.onLine(line.trim()));
    port.open((err) => { if (err) this.drop(port); });
  }

  private drop(port: SerialPort): void {
    if (this.port !== port) return;
    this.port = null;
    this.report(false);
  }

  private onLine(line: string): void {
    const now = Date.now();
    const parsed = parseChipLine(line, now, this.roomOf);
    if (!parsed) return;
    this.chip = parsed.chip ?? this.chip;
    this.lastSeen = now;
    this.missing = parsed.missing ?? this.missing;
    if (parsed.rows.length) {
      this.live = parsed.rows.map((r) => r.signal);
      this.sink.rows(parsed.rows);
    }
    this.report(true);
  }

  private report(connected: boolean): void {
    if (!this.chip) return;
    this.sink.status({
      id: `chip:${this.chip}`,
      connected,
      room: this.roomOf(this.chip),
      live: connected ? this.live : [],
      missing: this.missing,
      lastSeen: this.lastSeen,
    });
  }
}

/** The ESP32 board shows up as a CP2102 USB serial port. */
async function findChipPort(): Promise<string | null> {
  const ports = await SerialPort.list();
  const hit = ports.find((p) => /usbserial|SLAB_USBtoUART|wchusbserial/i.test(p.path) || /10c4/i.test(p.vendorId ?? ''));
  return hit?.path ?? null;
}
