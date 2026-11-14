// Sensors the crew adds themselves: a radiation monitor, a second CO2 sensor,
// anything the spacecraft has. Pure functions: what a sensor and its signals
// are, the checks on what the crew typed, and the judgement against limits
// the crew set.
//
// The rule of the project: NASA's limits (cabin.ts) and limits typed by the
// crew are never mixed up. A crew-set limit is always labelled as the crew's,
// it is judged on its own, and it never replaces or loosens a NASA limit: a
// signal with a NASA limit is still judged against it by cabin.ts. With no
// limit set, a signal is shown and never judged. No limit is made up here.

import type { Kind, Profile, Row } from './types.ts';
import { KIND_RANK } from './types.ts';
import { LIMITS } from './cabin.ts';
import { BOUNDS } from './quality.ts';
import { allStrings } from './strings.ts';

export type SignalGroup = 'cabin' | 'body';
export type Transport = 'http-push' | 'serial-json';

export const TRANSPORTS: readonly Transport[] = ['http-push', 'serial-json'];

/** Levels the crew typed. Every field is optional; a value past a level is judged by it. */
export interface CrewLimits {
  warnAbove?: number;
  warnBelow?: number;
  alarmAbove?: number;
  alarmBelow?: number;
  /** Judge the average over this many minutes instead of the newest reading. */
  windowMinutes?: number;
}

/** Values the device cannot give: a reading past them is refused at the door, not stored. */
export interface PhysicalBounds {
  min?: number;
  max?: number;
}

/** One signal a sensor carries. */
export interface SignalSpec {
  /** The timeline key, e.g. "radiation". Same rule as every signal: lowercase letters, digits, _ and . */
  signal: string;
  /** The name the crew typed, shown on screen. */
  name: string;
  /** The same name in Portuguese, if someone typed one. */
  namePt?: string;
  unit: string;
  group: SignalGroup;
  /** Digits after the point when shown. */
  decimals: number;
  limits?: CrewLimits;
  bounds?: PhysicalBounds;
  /** Anything the crew wants to say about it: model, where it is mounted, how it is calibrated. */
  note: string;
}

/** One sensor the crew registered. */
export interface SensorSpec {
  /** Short id: lowercase letters, digits and -. Its rows come from the source "sensor:<id>". */
  id: string;
  name: string;
  /** For a cabin sensor: the room it is in. */
  room?: string;
  /** For a body sensor: whose body. */
  person?: string;
  signals: SignalSpec[];
  transport: Transport;
  /** When it was first registered, in milliseconds. */
  addedAt: number;
}

export const SENSOR_ID = /^[a-z0-9-]{1,32}$/;
/** The same rule as rowProblem in timeline.ts. */
export const SIGNAL_KEY = /^[a-z0-9_.]{1,64}$/;
/** The same rule as rowProblem in timeline.ts. */
export const MAX_UNIT = 16;
const MAX_NAME = 60;
const MAX_NOTE = 500;
const MAX_SIGNALS = 32;
const MAX_WINDOW_MINUTES = 7 * 24 * 60;

/** The source name of a registered sensor's rows. */
export function sourceOf(id: string): string {
  return `sensor:${id}`;
}

/** The sensor id behind a source name, or null if it is not a registered sensor's source. */
export function sensorIdOf(source: string): string | null {
  const id = source.startsWith('sensor:') ? source.slice('sensor:'.length) : '';
  return SENSOR_ID.test(id) ? id : null;
}

export interface Checked {
  /** The cleaned-up sensor, or null when there is any problem. */
  sensor: SensorSpec | null;
  /** What stops it being saved, in plain words. */
  problems: string[];
  /** Things worth knowing that do not stop it, such as a NASA limit that still applies. */
  notices: string[];
}

/**
 * Checks a sensor as sent by a screen. Never throws. `unitsSeen` lists the
 * units readings of each signal already arrive in, so a different one can be
 * pointed out.
 */
export function checkSensor(input: unknown, profile: Pick<Profile, 'rooms' | 'crew'>, now: number, unitsSeen: Record<string, string[]> = {}): Checked {
  const problems: string[] = [];
  const notices: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { sensor: null, problems: ['The sensor must be a JSON object.'], notices };
  const s = input as Record<string, unknown>;

  const id = typeof s.id === 'string' ? s.id.trim() : '';
  if (!SENSOR_ID.test(id)) problems.push('The id must be 1 to 32 lowercase letters, digits or -, like "rad-1".');
  const name = text(s.name);
  if (!name || name.length > MAX_NAME) problems.push(`The sensor needs a name of up to ${MAX_NAME} characters.`);
  const transport = s.transport as Transport;
  if (!TRANSPORTS.includes(transport)) problems.push('The transport must be "http-push" (the device sends HTTP requests) or "serial-json" (the device is on a serial cable).');

  const room = s.room == null || s.room === '' ? undefined : s.room;
  const person = s.person == null || s.person === '' ? undefined : s.person;
  if (room !== undefined && person !== undefined) problems.push('A sensor is either in a room or on a person, not both.');
  else if (room === undefined && person === undefined) problems.push('Say which room the sensor is in, or whose body it reads.');
  else if (room !== undefined && !profile.rooms.some((r) => r.id === room)) problems.push(`There is no room "${String(room)}" on this station.`);
  else if (person !== undefined && !profile.crew.some((p) => p.id === person)) problems.push(`There is no crewmate "${String(person)}".`);
  const group: SignalGroup = person !== undefined ? 'body' : 'cabin';

  const signals: SignalSpec[] = [];
  if (!Array.isArray(s.signals) || !s.signals.length) problems.push('The sensor needs at least one signal.');
  else if (s.signals.length > MAX_SIGNALS) problems.push(`A sensor can carry at most ${MAX_SIGNALS} signals.`);
  else {
    const seen = new Set<string>();
    s.signals.forEach((raw, i) => {
      const checked = checkSignal(raw, i, group, unitsSeen);
      problems.push(...checked.problems);
      notices.push(...checked.notices);
      if (!checked.signal) return;
      if (seen.has(checked.signal.signal)) problems.push(`The signal "${checked.signal.signal}" is listed twice.`);
      seen.add(checked.signal.signal);
      signals.push(checked.signal);
    });
  }

  if (problems.length) return { sensor: null, problems, notices };
  const addedAt = typeof s.addedAt === 'number' && Number.isFinite(s.addedAt) ? s.addedAt : now;
  const sensor: SensorSpec = { id, name, signals, transport, addedAt };
  if (room !== undefined) sensor.room = room as string;
  else sensor.person = person as string;
  return { sensor, problems, notices };
}

function checkSignal(raw: unknown, i: number, group: SignalGroup, unitsSeen: Record<string, string[]>): { signal: SignalSpec | null; problems: string[]; notices: string[] } {
  const problems: string[] = [];
  const notices: string[] = [];
  const at = `Signal ${i + 1}`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { signal: null, problems: [`${at} must be an object.`], notices };
  const r = raw as Record<string, unknown>;

  const key = typeof r.signal === 'string' ? r.signal.trim() : '';
  const label = key ? `"${key}"` : at;
  if (!SIGNAL_KEY.test(key)) problems.push(`${at}: the key must be lowercase letters, digits, _ or . (up to 64), like "radiation".`);
  const name = text(r.name);
  if (!name || name.length > MAX_NAME) problems.push(`${label}: needs a name of up to ${MAX_NAME} characters.`);
  const namePt = text(r.namePt);
  if (namePt.length > MAX_NAME) problems.push(`${label}: the Portuguese name is longer than ${MAX_NAME} characters.`);
  const unit = typeof r.unit === 'string' ? r.unit.trim() : null;
  if (unit === null || unit.length > MAX_UNIT) problems.push(`${label}: the unit must be up to ${MAX_UNIT} characters, like "uSv/h" (empty for a plain count).`);
  if (r.group !== undefined && r.group !== group) problems.push(`${label}: a sensor ${group === 'body' ? 'on a person carries body' : 'in a room carries cabin'} signals only.`);
  const decimals = r.decimals ?? 1;
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 6) problems.push(`${label}: decimals must be a whole number from 0 to 6.`);
  const note = text(r.note);
  if (note.length > MAX_NOTE) problems.push(`${label}: the note is longer than ${MAX_NOTE} characters.`);

  const limits = numbers(r.limits, ['warnAbove', 'warnBelow', 'alarmAbove', 'alarmBelow', 'windowMinutes'], `${label}: limits`, problems) as CrewLimits | undefined;
  const bounds = numbers(r.bounds, ['min', 'max'], `${label}: physical bounds`, problems) as PhysicalBounds | undefined;
  if (limits) problems.push(...limitProblems(limits, bounds, label));
  if (bounds && bounds.min !== undefined && bounds.max !== undefined && bounds.min >= bounds.max) problems.push(`${label}: the lowest possible value must be below the highest.`);

  if (problems.length) return { signal: null, problems, notices };

  // A NASA limit is judged on its own, in its own unit, whatever the crew sets.
  const nasa = LIMITS.find((l) => l.signal === key);
  if (nasa && group === 'cabin') {
    if (unit !== nasa.unit) {
      problems.push(`${label}: NASA's limit for this signal is written in ${nasa.unit}. Register it in ${nasa.unit} so NASA's limit can still be judged, or use another key.`);
      return { signal: null, problems, notices };
    }
    notices.push(`${label}: NASA's limit (${nasa.max} ${nasa.unit}, ${nasa.windowMs / 60_000}-minute average) still applies and is judged on its own.${limits ? ' The levels you set are shown beside it as the crew\'s.' : ''}`);
  }
  const others = (unitsSeen[key] ?? []).filter((u) => u !== unit);
  if (others.length) notices.push(`${label}: readings of this signal already arrive in ${others.join(', ')}. Values in different units are shown apart, never averaged together.`);

  const signal: SignalSpec = { signal: key, name, unit: unit!, group, decimals: decimals as number, note };
  if (namePt) signal.namePt = namePt;
  if (limits) signal.limits = limits;
  if (bounds) signal.bounds = bounds;
  return { signal, problems, notices };
}

/** The ordering a set of levels must have: warn before alarm, everything below under everything above. */
export function limitProblems(l: CrewLimits, b: PhysicalBounds | undefined, label: string): string[] {
  const out: string[] = [];
  if (l.windowMinutes !== undefined && (!Number.isInteger(l.windowMinutes) || l.windowMinutes < 1 || l.windowMinutes > MAX_WINDOW_MINUTES)) {
    out.push(`${label}: the averaging window must be a whole number of minutes from 1 to ${MAX_WINDOW_MINUTES}.`);
  }
  const levels = [l.warnAbove, l.warnBelow, l.alarmAbove, l.alarmBelow].filter((v) => v !== undefined);
  if (!levels.length && l.windowMinutes !== undefined) out.push(`${label}: an averaging window needs at least one level to judge against.`);
  if (l.warnAbove !== undefined && l.alarmAbove !== undefined && l.warnAbove >= l.alarmAbove) out.push(`${label}: "warn above" must be lower than "alarm above".`);
  if (l.warnBelow !== undefined && l.alarmBelow !== undefined && l.warnBelow <= l.alarmBelow) out.push(`${label}: "warn below" must be higher than "alarm below".`);
  const highestBelow = Math.max(l.warnBelow ?? -Infinity, l.alarmBelow ?? -Infinity);
  const lowestAbove = Math.min(l.warnAbove ?? Infinity, l.alarmAbove ?? Infinity);
  if (highestBelow >= lowestAbove) out.push(`${label}: the "below" levels must be lower than the "above" levels.`);
  if (b) {
    for (const [name, v] of [['warn above', l.warnAbove], ['warn below', l.warnBelow], ['alarm above', l.alarmAbove], ['alarm below', l.alarmBelow]] as const) {
      if (v === undefined) continue;
      if ((b.min !== undefined && v < b.min) || (b.max !== undefined && v > b.max)) out.push(`${label}: "${name}" ${v} can never be reached, because values outside ${b.min ?? '-'} to ${b.max ?? '-'} are refused.`);
    }
  }
  return out;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Reads an optional object of finite numbers. Leaves out null fields; undefined when nothing is set. */
function numbers(v: unknown, keys: string[], label: string, problems: string[]): Record<string, number> | undefined {
  if (v == null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) { problems.push(`${label} must be an object.`); return undefined; }
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (n == null || n === '') continue;
    if (!keys.includes(k)) { problems.push(`${label}: "${k}" is not one of ${keys.join(', ')}.`); continue; }
    if (typeof n !== 'number' || !Number.isFinite(n)) { problems.push(`${label}: "${k}" must be a number.`); continue; }
    out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The value a registered sensor's row breaks its physical bounds with, or null. */
export function outOfBounds(spec: Pick<SignalSpec, 'unit' | 'bounds'>, row: Pick<Row, 'value' | 'unit'>): PhysicalBounds | null {
  const b = spec.bounds;
  if (!b || row.value === null || row.unit !== spec.unit) return null;
  if ((b.min !== undefined && row.value < b.min) || (b.max !== undefined && row.value > b.max)) return b;
  return null;
}

/** NASA's limit for a signal, labelled as NASA's, or null. Cabin signals only. */
export interface NasaLimitInfo {
  limitSource: 'nasa';
  max: number;
  unit: string;
  windowMinutes: number;
  source: string;
}

export function nasaLimitOf(signal: string): NasaLimitInfo | null {
  const l = LIMITS.find((x) => x.signal === signal);
  return l ? { limitSource: 'nasa', max: l.max, unit: l.unit, windowMinutes: l.windowMs / 60_000, source: l.source } : null;
}

/** The crew's levels for a signal, labelled as the crew's, or null when none are set. */
export function crewLimitsOf(spec: SignalSpec): (CrewLimits & { limitSource: 'crew' }) | null {
  return spec.limits ? { ...spec.limits, limitSource: 'crew' } : null;
}

/** A reading stands for at most this long; after it, the sensor counts as quiet. Same as QUIET_MS in cabin.ts. */
export const QUIET_MS = 600_000;

export interface CrewJudgement {
  /** "unjudged": a level is set, but there is no reading recent or complete enough to judge. */
  level: 'ok' | 'warn' | 'alarm' | 'unjudged';
  /** Always the crew's: this never judges against a NASA limit. */
  limitSource: 'crew';
  /** The level that was passed, or null. */
  limit: number | null;
  direction: 'above' | 'below' | null;
  /** The value judged: the newest reading, or the average over the window. */
  value: number | null;
  basis: 'latest' | 'average';
  windowMinutes: number | null;
  /** The kind of the readings judged, as the device reported it. */
  kind: Kind | null;
  /** When the newest reading judged was taken. */
  at: number | null;
  reason?: 'no-reading' | 'stale' | 'not-enough';
}

/**
 * Judges one signal against the levels the crew set, and nothing else.
 * `rows` are this sensor's own rows of this signal; rows in another unit are
 * not judged. Null when the crew set no level: the signal is shown, never
 * judged. A value exactly at a level is not past it.
 */
export function judgeCrewLimits(spec: SignalSpec, rows: Row[], now: number): CrewJudgement | null {
  const l = spec.limits;
  if (!l || [l.warnAbove, l.warnBelow, l.alarmAbove, l.alarmBelow].every((v) => v === undefined)) return null;
  const mine = rows.filter((r) => r.signal === spec.signal && r.unit === spec.unit && r.value !== null && r.t <= now).sort((a, b) => a.t - b.t);
  const windowMinutes = l.windowMinutes ?? null;
  const blank: CrewJudgement = { level: 'unjudged', limitSource: 'crew', limit: null, direction: null, value: null, basis: windowMinutes ? 'average' : 'latest', windowMinutes, kind: null, at: null };
  if (!mine.length) return { ...blank, reason: 'no-reading' };
  const newest = mine[mine.length - 1];
  if (now - newest.t > QUIET_MS) return { ...blank, kind: newest.kind, at: newest.t, value: newest.value, reason: 'stale' };

  let value = newest.value!;
  let kind = newest.kind;
  if (windowMinutes) {
    const average = timeAverage(mine, now, windowMinutes * 60_000);
    if (!average) return { ...blank, kind: newest.kind, at: newest.t, reason: 'not-enough' };
    value = average.value;
    kind = average.kind;
  }
  const out = { ...blank, value, kind, at: newest.t, level: 'ok' as CrewJudgement['level'] };
  if (l.alarmAbove !== undefined && value > l.alarmAbove) return { ...out, level: 'alarm', limit: l.alarmAbove, direction: 'above' };
  if (l.alarmBelow !== undefined && value < l.alarmBelow) return { ...out, level: 'alarm', limit: l.alarmBelow, direction: 'below' };
  if (l.warnAbove !== undefined && value > l.warnAbove) return { ...out, level: 'warn', limit: l.warnAbove, direction: 'above' };
  if (l.warnBelow !== undefined && value < l.warnBelow) return { ...out, level: 'warn', limit: l.warnBelow, direction: 'below' };
  return out;
}

/**
 * Time-weighted average over the window ending at `now`, as cabin.ts does it:
 * each reading holds until the next one, for at most 10 minutes, and the
 * readings must cover three quarters of the window. The kind is the worst one
 * used, so an average with a simulated reading in it is never called measured.
 */
function timeAverage(sorted: Row[], now: number, windowMs: number): { value: number; kind: Kind } | null {
  const from = now - windowMs;
  const list = sorted.filter((r) => r.t >= from);
  let weighted = 0;
  let covered = 0;
  let kind: Kind = 'measured';
  for (let i = 0; i < list.length; i++) {
    const until = i + 1 < list.length ? list[i + 1].t : now;
    const held = Math.min(until - list[i].t, QUIET_MS);
    weighted += list[i].value! * held;
    covered += held;
    if (KIND_RANK[list[i].kind] > KIND_RANK[kind]) kind = list[i].kind;
  }
  if (!covered || covered < windowMs * 0.75) return null;
  return { value: weighted / covered, kind };
}

/** A signal the hub knows without anyone registering it: it has a name in the string table. */
export interface BuiltInSignal {
  signal: string;
  /** Key in the string table. */
  nameKey: string;
  nasaLimit: NasaLimitInfo | null;
  /** Values no working sensor can give (quality.ts). */
  bound: { unit: string | null; min: number | null; max: number | null } | null;
}

export function builtInSignals(): BuiltInSignal[] {
  return Object.keys(allStrings())
    .filter((k) => k.startsWith('signal.'))
    .map((nameKey) => {
      const signal = nameKey.slice('signal.'.length);
      const b = BOUNDS.find((x) => x.signal === signal);
      return { signal, nameKey, nasaLimit: nasaLimitOf(signal), bound: b ? { unit: b.unit, min: b.min, max: b.max } : null };
    });
}
