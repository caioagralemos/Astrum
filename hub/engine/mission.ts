// A mission file: where the crew is going, for how long, who they are and what
// their place is like, module by module. One file describes a ship, a station
// or a surface base well enough for the station view to draw it and for the
// hub to know its rooms. A future setup screen writes this file; today it is
// written by hand (hub/profiles/missions/).
//
// Coordinates are metres in the place's own frame: +y is up (zenith in orbit,
// away from the ground on a surface), and a vehicle's forward is -x, so its
// aft is +x. For the ISS that makes port +z and starboard -z.
//
// Pure types and functions, no runtime imports, so this file loads anywhere.

import type { MissionFacts, Person, Profile, Room } from './types.ts';

export type Vec3 = [number, number, number];

export type MissionKind = 'ship' | 'station' | 'base';
export type Body = 'earth' | 'moon' | 'mars';
export type Situation = 'orbit' | 'transit' | 'surface';

/** What the inside of a module is, which decides its furniture. */
export type Template =
  | 'command' | 'lab' | 'galley' | 'exercise' | 'quarters' | 'node' | 'airlock'
  | 'storage' | 'service' | 'observation' | 'medical' | 'greenhouse';

export const TEMPLATES: readonly Template[] = [
  'command', 'lab', 'galley', 'exercise', 'quarters', 'node', 'airlock',
  'storage', 'service', 'observation', 'medical', 'greenhouse',
];

/**
 * The few shapes every place is built from. A cylinder (or, with radiusEnd, a
 * cone) and a box lie along the module's axis, centred on its position; a dome
 * rises along its axis from a round floor at its position. Rooms are drawn
 * eight-sided, like the ship's hull; `sides` changes only non-room outlines.
 * `chamfer` draws a closed pod with bevelled ends (no cutaway).
 */
export type Shape =
  | { kind: 'cylinder'; length: number; radius: number; radiusEnd?: number; sides?: number; chamfer?: boolean }
  | { kind: 'box'; length: number; width: number; height: number }
  | { kind: 'dome'; radius: number; height?: number; sides?: number };

/** One sleeping cabin inside a module, which is its own room. */
export interface Cabin {
  id: string;
  /** Key in the string table. */
  name: string;
  /** Upper or lower half of the module's height. */
  band: 'upper' | 'lower';
  /** Where it starts and ends, in metres from the module's start along its axis. */
  from: number;
  to: number;
}

/** Which port of which module this one is fixed to, so connections can be drawn and modules snapped. */
export interface Attachment {
  module: string;
  /** forward | aft | port | starboard | zenith | nadir on a vehicle; `spoke-N` round a base's hub. */
  port: string;
}

export interface ModuleSpec {
  id: string;
  /** Key in the string table. */
  name: string;
  template: Template;
  /** People can be here: it gets readings and a status light. A truss or an engine section is not a room. */
  isRoom: boolean;
  shape: Shape;
  /** Centre of a cylinder or box; centre of a dome's floor. */
  position: Vec3;
  /** Direction the module lies along (a dome: the way it rises). */
  axis: Vec3;
  /** Which way is "up" inside, if not the place's +y. */
  up?: Vec3;
  cabins?: Cabin[];
  attachedTo?: Attachment;
  /** True where the source gives no dimension or position and the value is an estimate. */
  approx?: boolean;
  note?: string;
}

/** A beam: a single line when thin, a braced square girder when it has a size. */
export interface Truss {
  id?: string;
  from: Vec3;
  to: Vec3;
  /** Width of the square cross-section in metres; 0 or absent draws one line. */
  size?: number;
  approx?: boolean;
  note?: string;
}

/**
 * A flat gridded wing (solar array or radiator): it runs from `from` to `from + length`
 * metres along `along`, starting at `at`; each panel spans [a, b] metres along `across`,
 * turned by `tilt` radians about `along`.
 */
export interface Panel {
  id?: string;
  at: Vec3;
  along: Vec3;
  across: Vec3;
  from: number;
  length: number;
  panels: [number, number][];
  tilt?: number;
  /** Grid lines: columns across each panel, rows along it. */
  cols?: number;
  rows?: number;
  /** Draw a bar from each panel's inner edge to the spine at mid-length. */
  braces?: boolean;
  /** Draw the spine along the middle, from `at` to the far end. */
  spine?: boolean;
  approx?: boolean;
  note?: string;
}

export interface Antenna {
  id?: string;
  /** Foot of the mast, on the hull. */
  at: Vec3;
  up: Vec3;
  /** From the foot to the middle of the dish. */
  height: number;
  dish: number;
  approx?: boolean;
}

export interface Engine {
  id?: string;
  /** The throat of the bell. */
  at: Vec3;
  axis: Vec3;
  length: number;
  /** Radius at the bell's exit. */
  radius: number;
}

export interface Legs {
  /** The module standing on them. */
  module: string;
  /** From the ground to the module's underside, metres. */
  height: number;
}

export interface Rock { at: Vec3; size: number }

export interface Ground {
  /** The faceted plain round the base reaches this far, metres. */
  radius: number;
  rocks?: Rock[];
  crater?: { at: Vec3; radius: number };
}

/** How the view first frames the place. */
export interface View {
  /** Radians round (0 looks from +z) and up for the default view. */
  yaw: number;
  pitch: number;
  /** In orbit there is no up: a tall screen turns the place a quarter turn. */
  turnOnTall: boolean;
  /** Which way awake people face, radians round from +z. */
  face?: number;
  /** Points the default view fits; computed from the modules when absent. */
  frame?: Vec3[];
  /** How deep the distance fade reaches, in multiples of the ship's (1). */
  depth?: number;
  /**
   * How what cannot be interacted with (trusses, wings, radiators, antennas, engines, legs,
   * modules that are not rooms) is drawn: 'quiet' (default) dimmer and thinner than the rooms, as
   * context; 'full' as strong as the rooms' hulls (the ship, whose extras are few).
   */
  extras?: 'quiet' | 'full';
}

export interface CrewSpec extends Person {
  /** Room (module or cabin id) where they sleep. */
  quarters: string;
  /** Room where they usually work. */
  work: string;
}

export interface Mission {
  id: string;
  kind: MissionKind;
  /** Key in the string table; `${name}.short` is the short form. */
  name: string;
  /** A name the crew typed, shown instead of `name` (a mission they made, engine/custom.ts). */
  nameText?: string;
  /** The mission file a crew-made mission was copied from. Its modules come from there. */
  basedOn?: string;
  where: { body: Body | null; situation: Situation };
  /** In g. 0 means everyone floats. Moon 0.166, Mars 0.38. */
  gravity: number;
  /** One way. */
  delayToEarthSeconds: number;
  /** ISO date. */
  missionStart: string;
  plannedDays: number;
  destination?: string;
  modules: ModuleSpec[];
  crew: CrewSpec[];
  /** Which room each sensor board sits in, by the id the board announces. */
  chips: Record<string, string>;
  trusses?: Truss[];
  solarArrays?: Panel[];
  radiators?: Panel[];
  antennas?: Antenna[];
  engines?: Engine[];
  legs?: Legs[];
  ground?: Ground;
  view?: View;
  note?: string;
}

/** The rooms the rest of the hub uses, in module order: a module's cabins, or the module itself. */
export function roomsOf(mission: Mission): Room[] {
  const rooms: Room[] = [];
  for (const m of mission.modules) {
    if (m.cabins?.length) for (const c of m.cabins) rooms.push({ id: c.id, name: c.name });
    else if (m.isRoom) rooms.push({ id: m.id, name: m.name });
  }
  return rooms;
}

/**
 * The place's name key. A station or a base stays where it is, so its file's
 * name is its name. A ship can be moved (Settings, Edit this place), and the
 * ship's name says where it is ("Station in Mars orbit"), so a ship's name
 * follows its location: Mars orbit keeps the file's own key, Earth or Moon
 * orbit and transit take their own. The id never changes.
 */
export function placeNameOf(mission: Pick<Mission, 'kind' | 'name' | 'where'>): string {
  if (mission.kind !== 'ship') return mission.name;
  const { body, situation } = mission.where;
  if (situation === 'transit') return 'place.transit';
  if (situation === 'orbit' && body === 'earth') return 'place.earth-orbit';
  if (situation === 'orbit' && body === 'moon') return 'place.moon-orbit';
  if (situation === 'orbit' && body === 'mars') return 'place.mars-orbit';
  return mission.name;
}

const DAY_MS = 24 * 3600_000;

/**
 * The mission day at `now`, counted on the station's clock: the start date is
 * day 1, and the day turns at midnight on a clock `offsetMinutes` from UTC.
 * The hub keeps the simulated crew's day on its own time zone (core/crew.ts),
 * so it gives its offset (MissionFacts.clockOffsetMinutes) and the day turns
 * while the crew sleeps, not at midnight UTC. Before the start it is 0 or less.
 */
export function missionDayOf(missionStart: string, now: number, offsetMinutes: number): number {
  const start = Date.parse(`${missionStart.slice(0, 10)}T00:00:00Z`);
  return Math.floor((now + offsetMinutes * 60_000) / DAY_MS) - Math.floor(start / DAY_MS) + 1;
}

/** The mission day screens show: on the hub's station clock, or, from an older hub that does not say it, the screen's own time zone. */
export function dayOf(profile: Pick<Profile, 'missionStart' | 'mission'>, now: number): number {
  return missionDayOf(profile.missionStart, now, profile.mission?.clockOffsetMinutes ?? -new Date(now).getTimezoneOffset());
}

/** The hub's settings for this place, in the shape it has always read. */
export function profileOf(mission: Mission): Profile {
  return {
    id: mission.id,
    place: placeNameOf(mission),
    missionStart: mission.missionStart,
    delayToEarthSeconds: mission.delayToEarthSeconds,
    rooms: roomsOf(mission),
    crew: mission.crew.map(({ quarters: _q, work: _w, ...person }) => person),
    chips: { ...mission.chips },
  };
}

/** What screens are told about the mission, beside the profile. `file` is the mission file's name without ".json". */
export function missionFacts(mission: Mission, file: string): MissionFacts & { simulationNote: string } {
  const facts: MissionFacts & { simulationNote: string } = {
    id: mission.id, file, kind: mission.kind, where: { ...mission.where }, gravity: mission.gravity, plannedDays: mission.plannedDays,
    simulationNote: simulationNoteOf(mission),
  };
  if (mission.destination) facts.destination = mission.destination;
  if (mission.nameText) facts.nameText = mission.nameText;
  if (mission.basedOn) facts.custom = true;
  return facts;
}

/** The profile the hub runs with: the profile it has always read, plus the mission's facts. */
export function hubProfileOf(mission: Mission, file: string): Profile {
  return { ...profileOf(mission), mission: missionFacts(mission, file) };
}

/**
 * The first room of the first room-module with this template, in file order,
 * or null when the mission has none. A module split into cabins gives its first cabin.
 */
export function firstRoomOf(mission: Mission, template: Template): string | null {
  for (const m of mission.modules) if (m.template === template && m.isRoom) return m.cabins?.[0]?.id ?? m.id;
  return null;
}

/**
 * The place's main cabin: the room the sensor board sits in (the common room
 * where the crew meets), else the first galley, else the first room.
 */
export function mainRoom(mission: Mission): string | null {
  const chip = Object.values(mission.chips ?? {})[0];
  return chip ?? firstRoomOf(mission, 'galley') ?? roomsOf(mission)[0]?.id ?? null;
}

/**
 * String key saying what the simulated crew's body readings are centred on.
 * They are always the in-flight (weightless) measurements in engine/crew.ts;
 * in gravity, what is usual is not known, and the note says so.
 */
export function simulationNoteOf(mission: Pick<Mission, 'gravity'>): string {
  return mission.gravity > 0 ? 'mission.simulationNote.gravity' : 'mission.simulationNote.weightless';
}

const KINDS: readonly string[] = ['ship', 'station', 'base'];
const BODIES: readonly string[] = ['earth', 'moon', 'mars'];
const SITUATIONS: readonly string[] = ['orbit', 'transit', 'surface'];
const PRONOUNS: readonly string[] = ['she', 'he', 'they'];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Everything wrong with a mission file, in plain words. Empty means it is fine.
 * Never throws, whatever it is given.
 */
export function validateMission(input: unknown): string[] {
  const problems: string[] = [];
  const say = (text: string) => problems.push(text);
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return ['The mission is not an object.'];
  const m = input as Record<string, unknown>;

  if (!isText(m.id)) say('The mission has no id.');
  if (!KINDS.includes(m.kind as string)) say(`The kind must be ship, station or base, not "${String(m.kind)}".`);
  if (!isText(m.name)) say('The mission has no name key.');
  if (m.nameText !== undefined && !isText(m.nameText)) say('The typed name, when given, must be text.');
  const where = m.where as Record<string, unknown> | undefined;
  if (typeof where !== 'object' || where === null) say('The mission does not say where it is.');
  else {
    if (where.body !== null && !BODIES.includes(where.body as string)) say(`The body must be earth, moon, mars or null, not "${String(where.body)}".`);
    if (!SITUATIONS.includes(where.situation as string)) say(`The situation must be orbit, transit or surface, not "${String(where.situation)}".`);
    if (where.situation === 'surface' && where.body === null) say('A surface mission needs a body to stand on.');
  }
  if (!isNum(m.gravity) || m.gravity < 0) say('Gravity must be a number of g, 0 or more.');
  else if (where?.situation === 'surface' && m.gravity === 0) say('On a surface gravity cannot be 0.');
  if (!isNum(m.delayToEarthSeconds) || m.delayToEarthSeconds < 0) say('The delay to Earth must be a number of seconds, 0 or more.');
  if (!isText(m.missionStart) || Number.isNaN(Date.parse(m.missionStart))) say('The mission start is not a date.');
  if (!isNum(m.plannedDays) || m.plannedDays <= 0) say('The planned length must be a number of days above 0.');
  if (m.destination !== undefined && !isText(m.destination)) say('The destination, when given, must be a string key.');

  // Modules, and the rooms they make.
  const moduleIds = new Set<string>();
  const roomIds = new Set<string>();
  const modules = Array.isArray(m.modules) ? m.modules as Record<string, unknown>[] : [];
  if (!Array.isArray(m.modules) || modules.length === 0) say('The mission has no modules.');
  modules.forEach((mod, i) => {
    const label = isText(mod?.id) ? `Module "${mod.id}"` : `Module ${i + 1}`;
    if (typeof mod !== 'object' || mod === null) { say(`${label} is not an object.`); return; }
    if (!isText(mod.id)) say(`${label} has no id.`);
    else if (moduleIds.has(mod.id)) say(`${label} appears twice.`);
    else moduleIds.add(mod.id);
    if (!isText(mod.name)) say(`${label} has no name key.`);
    if (!TEMPLATES.includes(mod.template as Template)) say(`${label} has an unknown template "${String(mod.template)}".`);
    if (typeof mod.isRoom !== 'boolean') say(`${label} does not say whether it is a room.`);
    if (!isVec(mod.position)) say(`${label} has no position [x, y, z].`);
    if (!isVec(mod.axis) || Math.hypot(...mod.axis) < 1e-6) say(`${label} has no direction (axis).`);
    if (mod.up !== undefined && (!isVec(mod.up) || Math.hypot(...mod.up) < 1e-6)) say(`${label} has an "up" that is not a direction.`);
    const shape = mod.shape as Record<string, unknown> | undefined;
    const positive = (v: unknown) => isNum(v) && v > 0;
    if (typeof shape !== 'object' || shape === null) say(`${label} has no shape.`);
    else if (shape.kind === 'cylinder') {
      if (!positive(shape.length) || !positive(shape.radius)) say(`${label}: a cylinder needs a length and radius above 0.`);
      if (shape.radiusEnd !== undefined && !positive(shape.radiusEnd)) say(`${label}: radiusEnd must be above 0.`);
      if (shape.sides !== undefined && (!Number.isInteger(shape.sides) || (shape.sides as number) < 3)) say(`${label}: sides must be a whole number, 3 or more.`);
    } else if (shape.kind === 'box') {
      if (!positive(shape.length) || !positive(shape.width) || !positive(shape.height)) say(`${label}: a box needs length, width and height above 0.`);
    } else if (shape.kind === 'dome') {
      if (!positive(shape.radius)) say(`${label}: a dome needs a radius above 0.`);
      if (shape.height !== undefined && !positive(shape.height)) say(`${label}: a dome's height must be above 0.`);
    } else say(`${label} has an unknown shape "${String(shape.kind)}".`);
    const cabins = mod.cabins;
    if (cabins !== undefined) {
      if (!Array.isArray(cabins) || cabins.length === 0) say(`${label}: cabins, when given, must be a list.`);
      else {
        if (shape?.kind !== 'cylinder') say(`${label}: only a cylinder can be split into cabins.`);
        const length = isNum(shape?.length) ? shape.length : Infinity;
        for (const c of cabins as Record<string, unknown>[]) {
          const cl = isText(c?.id) ? `cabin "${c.id}"` : 'a cabin';
          if (!isText(c?.id)) say(`${label}: ${cl} has no id.`);
          else if (roomIds.has(c.id)) say(`${label}: ${cl} has the same id as another room.`);
          else roomIds.add(c.id);
          if (!isText(c?.name)) say(`${label}: ${cl} has no name key.`);
          if (c?.band !== 'upper' && c?.band !== 'lower') say(`${label}: ${cl} must be in the upper or lower band.`);
          if (!isNum(c?.from) || !isNum(c?.to) || c.from < 0 || c.to <= c.from || c.to > length + 1e-6) say(`${label}: ${cl} must start and end within the module.`);
        }
      }
    } else if (mod.isRoom === true && isText(mod.id)) {
      if (roomIds.has(mod.id)) say(`${label} has the same id as another room.`);
      roomIds.add(mod.id);
    }
    if (mod.cabins !== undefined && mod.isRoom !== true) say(`${label} has cabins but is not a room.`);
  });
  if (roomIds.size === 0 && modules.length) say('No module is a room: people need somewhere to be.');
  for (const mod of modules) {
    const at = mod?.attachedTo as Record<string, unknown> | undefined;
    if (at === undefined) continue;
    if (!isText(at?.module) || !moduleIds.has(at.module)) say(`Module "${String(mod.id)}" is attached to "${String(at?.module)}", which is not in the mission.`);
    else if (at.module === mod.id) say(`Module "${String(mod.id)}" is attached to itself.`);
    if (!isText(at?.port)) say(`Module "${String(mod.id)}" does not say which port it is attached to.`);
  }
  const ports = new Map<string, string>();
  for (const mod of modules) {
    const at = mod?.attachedTo as Record<string, unknown> | undefined;
    if (!at || !isText(at.module) || !isText(at.port)) continue;
    const key = `${at.module}:${at.port}`;
    if (ports.has(key)) say(`Modules "${ports.get(key)}" and "${String(mod.id)}" are both on the ${at.port} port of "${at.module}".`);
    else ports.set(key, String(mod.id));
  }

  // Crew.
  const crewIds = new Set<string>();
  const crew = Array.isArray(m.crew) ? m.crew as Record<string, unknown>[] : [];
  if (!Array.isArray(m.crew) || crew.length === 0) say('The mission has no crew.');
  crew.forEach((p, i) => {
    const label = isText(p?.id) ? `Crewmate "${p.id}"` : `Crewmate ${i + 1}`;
    if (typeof p !== 'object' || p === null) { say(`${label} is not an object.`); return; }
    if (!isText(p.id)) say(`${label} has no id.`);
    else if (crewIds.has(p.id)) say(`${label} appears twice.`);
    else crewIds.add(p.id);
    if (!isText(p.name)) say(`${label} has no name.`);
    if (!isText(p.role)) say(`${label} has no role key.`);
    if (p.pronouns !== undefined && !PRONOUNS.includes(p.pronouns as string)) say(`${label}: pronouns must be she, he or they.`);
    if (!isText(p.quarters) || !roomIds.has(p.quarters)) say(`${label} sleeps in "${String(p.quarters)}", which is not a room.`);
    if (!isText(p.work) || !roomIds.has(p.work)) say(`${label} works in "${String(p.work)}", which is not a room.`);
  });

  if (typeof m.chips !== 'object' || m.chips === null || Array.isArray(m.chips)) say('The mission does not list its sensor boards (chips).');
  else {
    for (const [chip, room] of Object.entries(m.chips)) {
      // A board sits where people are: a room module, or one of its cabins. Never a truss, a tunnel or a tank.
      const mod = modules.find((x) => x?.id === room);
      if (mod && mod.isRoom !== true) say(`Sensor board "${chip}" is in "${String(room)}", a module people are not in (isRoom is false).`);
      else if (mod && Array.isArray(mod.cabins) && mod.cabins.length) say(`Sensor board "${chip}" is in "${String(room)}", which is split into cabins: name one of them.`);
      else if (!roomIds.has(room as string)) say(`Sensor board "${chip}" is in "${String(room)}", which is not a room.`);
    }
  }

  // Structure.
  const list = (key: string) => {
    const v = m[key];
    if (v === undefined) return [] as Record<string, unknown>[];
    if (!Array.isArray(v)) { say(`"${key}", when given, must be a list.`); return []; }
    return v as Record<string, unknown>[];
  };
  list('trusses').forEach((t, i) => { if (!isVec(t?.from) || !isVec(t?.to)) say(`Truss ${i + 1} needs from and to points.`); });
  for (const key of ['solarArrays', 'radiators']) {
    list(key).forEach((p, i) => {
      const label = `${key === 'solarArrays' ? 'Solar array' : 'Radiator'} ${isText(p?.id) ? `"${p.id}"` : i + 1}`;
      if (!isVec(p?.at) || !isVec(p?.along) || !isVec(p?.across)) say(`${label} needs at, along and across.`);
      if (!isNum(p?.from) || !isNum(p?.length) || (p.length as number) <= 0) say(`${label} needs a start and a length above 0.`);
      if (!Array.isArray(p?.panels) || !(p.panels as unknown[]).every((q) => Array.isArray(q) && q.length === 2 && q.every(isNum))) say(`${label} needs its panels as [from, to] pairs.`);
    });
  }
  list('antennas').forEach((a, i) => { if (!isVec(a?.at) || !isVec(a?.up) || !isNum(a?.height) || !isNum(a?.dish)) say(`Antenna ${i + 1} needs at, up, height and dish.`); });
  list('engines').forEach((e, i) => { if (!isVec(e?.at) || !isVec(e?.axis) || !isNum(e?.length) || !isNum(e?.radius)) say(`Engine ${i + 1} needs at, axis, length and radius.`); });
  list('legs').forEach((l, i) => {
    if (!isText(l?.module) || !moduleIds.has(l.module)) say(`Legs ${i + 1} stand under "${String(l?.module)}", which is not a module.`);
    if (!isNum(l?.height) || (l.height as number) < 0) say(`Legs ${i + 1} need a height.`);
  });
  if (m.ground !== undefined) {
    const g = m.ground as Record<string, unknown>;
    if (!isNum(g?.radius) || (g.radius as number) <= 0) say('The ground needs a radius above 0.');
    if (where?.situation !== 'surface') say('Only a surface mission has ground.');
  }
  if (m.view !== undefined) {
    const v = m.view as Record<string, unknown>;
    if (!isNum(v?.yaw) || !isNum(v?.pitch) || typeof v?.turnOnTall !== 'boolean') say('The view needs yaw, pitch and turnOnTall.');
    if (v?.frame !== undefined && (!Array.isArray(v.frame) || !(v.frame as unknown[]).every(isVec))) say('The view\'s frame must be a list of [x, y, z] points.');
  }
  return problems;
}
