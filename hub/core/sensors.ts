// Sensors the crew adds: the registry (a JSON file in the hub's data folder)
// and /api/sensors, the screen's way to add, change, test and remove one.
//
// A registered sensor's rows come from the source "sensor:<id>", over HTTP
// (POST /api/readings, like any device) or a serial cable (serial-json.ts).
// The registry gives them a name, a unit, a place, the device's physical
// bounds and any levels the crew set. Crew levels are labelled as the crew's
// and judged on their own; NASA's limits are judged by cabin.ts whatever the
// crew sets. Removing a sensor keeps every reading it stored.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Profile, Row } from '../engine/types.ts';
import { QUIET_MS, builtInSignals, checkSensor, crewLimitsOf, isHubSignal, judgeCrewLimits, nasaLimitOf, outOfBounds, sensorIdOf, sourceOf } from '../engine/sensors.ts';
import type { CrewJudgement, PhysicalBounds, SensorSpec } from '../engine/sensors.ts';
import type { SensorDirectory, SensorPlace } from './serial-json.ts';
import type { Store } from './db.ts';

/** A sensor that sent something but that nobody registered. */
export interface UnknownSensor {
  id: string;
  /** What the screen shows, so a person knows there is a device to add. */
  message: string;
  firstAt: number;
  lastAt: number;
  count: number;
  /** "http" or "serial:<path>". */
  via: string;
  signals: string[];
}

/** Readings refused because they were outside the bounds the crew gave for the device. */
export interface SensorRefused {
  signal: string;
  unit: string;
  bounds: PhysicalBounds;
  count: number;
  lastValue: number;
  lastAt: number;
}

/** How long a connection test waits before a new one starts. */
const TEST_MS = 10 * 60_000;
/** How far back the arrival status looks in one query. */
const LOOK_BACK_MS = 24 * 3600_000;

export class SensorRegistry implements SensorDirectory {
  private file: string;
  private profile: Pick<Profile, 'rooms' | 'crew'>;
  private sensors = new Map<string, SensorSpec>();
  /** Entries in the file that no longer pass the checks (say, a room was removed). Kept in the file untouched. */
  private held: unknown[] = [];
  /** Problems found loading the file, in plain words. */
  readonly problems: string[] = [];
  private unknown = new Map<string, UnknownSensor>();
  private refused = new Map<string, Map<string, SensorRefused>>();
  /** When each registered sensor's rows last reached the hub, by the hub's clock. */
  private arrivals = new Map<string, number>();
  private tests = new Map<string, number>();
  /** The file could not be read as JSON: it is set aside before the first save, never overwritten. */
  private corrupt = false;

  constructor(file: string, profile: Pick<Profile, 'rooms' | 'crew'>) {
    this.file = file;
    this.profile = profile;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    let data: unknown;
    try {
      const text = readFileSync(this.file, 'utf8');
      if (!text.trim()) return;
      data = JSON.parse(text);
    } catch {
      this.corrupt = true;
      this.problems.push('sensors.json could not be read, so no sensors are loaded. It will be kept as sensors.json.corrupt when a sensor is next saved.');
      return;
    }
    const list = (data as { sensors?: unknown })?.sensors;
    if (!Array.isArray(list)) {
      this.corrupt = true;
      this.problems.push('sensors.json has no list of sensors, so none are loaded.');
      return;
    }
    for (const raw of list) {
      const checked = checkSensor(raw, this.profile, Date.now());
      if (checked.sensor && !this.sensors.has(checked.sensor.id)) this.sensors.set(checked.sensor.id, checked.sensor);
      else {
        this.held.push(raw);
        const id = (raw as { id?: unknown })?.id;
        const why = checked.problems.length ? checked.problems.join(' ') : 'The id is used twice.';
        this.problems.push(`Sensor ${typeof id === 'string' ? `"${id}"` : 'without an id'} is not loaded: ${why}`);
      }
    }
  }

  private save(): void {
    if (this.corrupt && existsSync(this.file)) renameSync(this.file, `${this.file}.corrupt`);
    this.corrupt = false;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, sensors: [...this.sensors.values(), ...this.held] }, null, 2)}\n`);
    renameSync(tmp, this.file);
  }

  list(): SensorSpec[] {
    return [...this.sensors.values()].sort((a, b) => a.addedAt - b.addedAt);
  }

  get(id: string): SensorSpec | null {
    return this.sensors.get(id) ?? null;
  }

  /** Adds or replaces one sensor and writes the file. Throws only if the file cannot be written. */
  put(sensor: SensorSpec): void {
    const before = this.sensors.get(sensor.id);
    this.sensors.set(sensor.id, sensor);
    try { this.save(); } catch (err) {
      if (before) this.sensors.set(sensor.id, before);
      else this.sensors.delete(sensor.id);
      throw err;
    }
    this.unknown.delete(sensor.id);
  }

  /** Removes the registration. The readings it stored stay in the timeline. */
  remove(id: string): boolean {
    const before = this.sensors.get(id);
    if (!before) return false;
    this.sensors.delete(id);
    try { this.save(); } catch (err) {
      this.sensors.set(id, before);
      throw err;
    }
    this.refused.delete(id);
    this.tests.delete(id);
    return true;
  }

  placeOf(id: string): SensorPlace | null {
    const s = this.sensors.get(id);
    if (!s) return null;
    return s.room ? { room: s.room } : { person: s.person };
  }

  heardUnknown(id: string, at: number, via: string, signals: string[]): void {
    const held = this.unknown.get(id);
    this.unknown.set(id, {
      id, message: `heard from an unknown sensor: ${id}`, firstAt: held?.firstAt ?? at, lastAt: at, count: (held?.count ?? 0) + 1, via,
      signals: [...new Set([...(held?.signals ?? []), ...signals])].slice(0, 32),
    });
  }

  unknownSensors(): UnknownSensor[] {
    return [...this.unknown.values()].sort((a, b) => b.lastAt - a.lastAt);
  }

  refusedFor(id: string): SensorRefused[] {
    return [...(this.refused.get(id)?.values() ?? [])];
  }

  lastArrival(id: string): number | null {
    return this.arrivals.get(id) ?? null;
  }

  /**
   * The check at the hub's door for registered sensors' rows. Drops a row
   * outside the bounds the crew gave for that device, and counts it; notes
   * when each sensor was last heard, and any "sensor:<id>" source nobody
   * registered. Every other row passes untouched, and no row's kind changes.
   */
  checkRows(rows: Row[], now = Date.now()): Row[] {
    const kept: Row[] = [];
    for (const row of rows) {
      const id = sensorIdOf(row.source);
      if (!id) { kept.push(row); continue; }
      const sensor = this.sensors.get(id);
      if (!sensor) {
        // The serial adapter stores nothing for an unknown sensor, so this one came over HTTP.
        this.heardUnknown(id, now, 'http', [row.signal]);
        kept.push(row);
        continue;
      }
      this.arrivals.set(id, now);
      const spec = sensor.signals.find((s) => s.signal === row.signal);
      const broken = spec ? outOfBounds(spec, row) : null;
      if (!broken) { kept.push(row); continue; }
      const mine = this.refused.get(id) ?? new Map<string, SensorRefused>();
      const held = mine.get(row.signal);
      mine.set(row.signal, { signal: row.signal, unit: row.unit, bounds: broken, count: (held?.count ?? 0) + 1, lastValue: row.value!, lastAt: row.t });
      this.refused.set(id, mine);
    }
    return kept;
  }

  /** Starts a connection test, or continues the one running. */
  startTest(id: string, now: number, restart = false): number {
    const held = this.tests.get(id);
    if (!restart && held !== undefined && now - held < TEST_MS) return held;
    this.tests.set(id, now);
    return now;
  }
}

export interface SensorsContext {
  store: Store;
  registry: SensorRegistry;
  profile: Pick<Profile, 'rooms' | 'crew'>;
  now?: () => number;
}

/**
 * GET /api/sensors: every registered sensor with its arrival status and the
 * crew's judgement, the hub's built-in signals, signals arriving that nobody
 * described, and sensors heard but not registered.
 * POST /api/sensors: add or update one sensor.
 * DELETE /api/sensors?id=: remove a registration (its readings are kept).
 * POST /api/sensors/test?id=: what the device should send, and whether
 * anything arrived since the test started.
 * Returns false for any other path.
 */
export async function handleSensors(req: IncomingMessage, res: ServerResponse, url: URL, ctx: SensorsContext): Promise<boolean> {
  const now = (ctx.now ?? Date.now)();

  if (url.pathname === '/api/sensors/test') {
    if (req.method !== 'POST') return answer(res, 405, { error: 'method not allowed' });
    const id = url.searchParams.get('id') ?? '';
    const sensor = ctx.registry.get(id);
    if (!sensor) return answer(res, 404, { error: `no sensor "${id}" is registered` });
    const startedAt = ctx.registry.startTest(id, now, url.searchParams.get('restart') === '1');
    const arrivedAt = arrivalSince(ctx, id, startedAt);
    return answer(res, 200, { id, transport: sensor.transport, startedAt, arrived: arrivedAt !== null, arrivedAt, example: exampleFor(sensor, req.headers.host ?? 'localhost:4310') });
  }

  if (url.pathname !== '/api/sensors') return false;

  if (req.method === 'GET') return answer(res, 200, overview(ctx, now));

  if (req.method === 'POST') {
    const body = await readJson(req);
    if (body === undefined) return answer(res, 400, { error: 'body must be JSON under 100 kB' });
    const id = (body as { id?: unknown })?.id;
    const before = typeof id === 'string' ? ctx.registry.get(id) : null;
    const input = before ? { ...(body as object), addedAt: before.addedAt } : { ...(body as object), addedAt: undefined };
    const checked = checkSensor(input, ctx.profile, now, unitsSeen(ctx, now, typeof id === 'string' ? id : ''));
    if (!checked.sensor) return answer(res, 400, { error: 'not saved', problems: checked.problems, notices: checked.notices });
    try { ctx.registry.put(checked.sensor); } catch {
      return answer(res, 500, { error: 'the sensor list could not be written to disk; nothing changed' });
    }
    return answer(res, 200, { sensor: checked.sensor, source: sourceOf(checked.sensor.id), created: !before, notices: checked.notices });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id') ?? '';
    let removed: boolean;
    try { removed = ctx.registry.remove(id); } catch {
      return answer(res, 500, { error: 'the sensor list could not be written to disk; nothing changed' });
    }
    return removed ? answer(res, 200, { removed: id, readingsKept: true }) : answer(res, 404, { error: `no sensor "${id}" is registered` });
  }

  return answer(res, 405, { error: 'method not allowed' });
}

/** When a reading from this sensor first reached the hub at or after `from`, as far as can be told. */
function arrivalSince(ctx: SensorsContext, id: string, from: number): number | null {
  const arrived = ctx.registry.lastArrival(id);
  if (arrived !== null && arrived >= from) return arrived;
  // Without the door check wired in, the newest stored row stands in for an arrival.
  const last = ctx.store.lastTime(sourceOf(id));
  return last !== null && last >= from ? last : null;
}

/** Units each signal arrives in now, plus those other registered sensors declare. A sensor's own are left out. */
function unitsSeen(ctx: SensorsContext, now: number, ownId: string): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  const own = sourceOf(ownId);
  for (const r of ctx.store.recent(now - LOOK_BACK_MS)) if (r.source !== own && r.value !== null) (out[r.signal] ??= new Set()).add(r.unit);
  for (const s of ctx.registry.list()) if (s.id !== ownId) for (const sig of s.signals) (out[sig.signal] ??= new Set()).add(sig.unit);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

interface LastReading { value: number | null; text: string | null; unit: string; kind: Row['kind']; t: number }

function overview(ctx: SensorsContext, now: number) {
  const recent = ctx.store.recent(now - LOOK_BACK_MS);
  const registered = new Set<string>();

  const sensors = ctx.registry.list().map((sensor) => {
    const source = sourceOf(sensor.id);
    const lastHeard = ctx.store.lastTime(source);
    const signals = sensor.signals.map((spec) => {
      registered.add(spec.signal);
      const newest = recent
        .filter((r) => r.source === source && r.signal === spec.signal && (sensor.room ? r.room === sensor.room && !r.person : r.person === sensor.person))
        .reduce<Row | null>((a, b) => (!a || b.t > a.t ? b : a), null);
      const last: LastReading | null = newest ? { value: newest.value, text: newest.text ?? null, unit: newest.unit, kind: newest.kind, t: newest.t } : null;
      let judgement: CrewJudgement | null = null;
      if (spec.limits) {
        const windowMs = (spec.limits.windowMinutes ?? 0) * 60_000 + QUIET_MS;
        const rows = ctx.store.rows({ signal: spec.signal, room: sensor.room, person: sensor.person, from: now - windowMs, limit: 50_000 }).filter((r) => r.source === source && (!sensor.room || !r.person));
        judgement = judgeCrewLimits(spec, rows, now);
      }
      return {
        ...spec,
        crewLimits: crewLimitsOf(spec),
        // A body signal is never judged against a cabin limit.
        nasaLimit: spec.group === 'cabin' ? nasaLimitOf(spec.signal) : null,
        last,
        arriving: !!last && now - last.t <= QUIET_MS,
        unitMatches: !last || last.unit === spec.unit,
        judgement,
      };
    });
    return { ...sensor, source, lastHeard, signals, refused: ctx.registry.refusedFor(sensor.id) };
  });

  const bySignal = new Map<string, { units: Set<string>; sources: Set<string>; lastAt: number }>();
  for (const r of recent) {
    const s = bySignal.get(r.signal) ?? { units: new Set<string>(), sources: new Set<string>(), lastAt: 0 };
    s.units.add(r.unit);
    s.sources.add(r.source);
    s.lastAt = Math.max(s.lastAt, r.t);
    bySignal.set(r.signal, s);
  }
  const seen = (signal: string) => {
    const s = bySignal.get(signal);
    return s ? { lastAt: s.lastAt, units: [...s.units], sources: [...s.sources] } : { lastAt: null, units: [], sources: [] };
  };
  const builtIn = builtInSignals().map((b) => ({ ...b, ...seen(b.signal) }));
  const known = new Set([...builtIn.map((b) => b.signal), ...registered]);
  // Arriving, but described nowhere: a device posting without being registered. The hub's own signals are not devices.
  const undescribed = [...bySignal.keys()].filter((s) => !known.has(s) && !isHubSignal(s)).sort().map((signal) => ({ signal, ...seen(signal) }));

  return { now, sensors, builtIn, undescribed, unknown: ctx.registry.unknownSensors(), problems: ctx.registry.problems };
}

/** The exact request a device should send, built from the registration. */
export function exampleFor(sensor: SensorSpec, host: string) {
  const place = sensor.room ? { room: sensor.room } : { person: sensor.person };
  if (sensor.transport === 'serial-json') {
    const r = sensor.signals.map((s) => `["${s.signal}",<value>,${JSON.stringify(s.unit)},"m"]`).join(',');
    return {
      kind: 'serial-json' as const,
      line: `{"sensor":"${sensor.id}","r":[${r}]}`,
      text: `Print one line like this for every reading, ending in a newline, at 115200 baud. Put the number the device read where <value> is. Use "m" for measured, "e" for estimated (worked out from something measured), "s" for simulated. The hub stamps the time each line arrives and puts it in ${sensor.room ? `the room "${sensor.room}"` : `${sensor.person}'s readings`}.`,
    };
  }
  const reading = (s: SensorSpec['signals'][number]) => `{"t":<milliseconds since 1970>,"signal":"${s.signal}","value":<value>,"unit":${JSON.stringify(s.unit)},"kind":"measured",${JSON.stringify(place).slice(1, -1)}}`;
  const body = `{"source":"${sourceOf(sensor.id)}","rows":[${sensor.signals.map(reading).join(',')}]}`;
  // The test sends no number, so pasting it never stores a made-up reading.
  const first = sensor.signals[0];
  const testRow = `{"t":'"$(date +%s)000"',"signal":"${first.signal}","value":null,"text":"connection test","unit":${JSON.stringify(first.unit)},"kind":"reported",${JSON.stringify(place).slice(1, -1)}}`;
  return {
    kind: 'http-push' as const,
    url: `http://${host}/api/readings`,
    body,
    curl: `curl -X POST http://${host}/api/readings -H 'content-type: application/json' -d '{"source":"${sourceOf(sensor.id)}","rows":[${testRow}]}'`,
    text: 'The device sends the body for its readings, with the number it read where <value> is and the time it read it. The curl line is a connection test: it carries no number, only the words "connection test", so pasting it stores no reading.',
  };
}

function answer(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  return true;
}

const MAX_BODY = 100_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return undefined;
    chunks.push(chunk as Buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
  } catch { return undefined; }
}
