// Missions the crew makes: a copy of any mission, with its data edited. What
// can change is the mission's name, where it is, the delay to Earth, its dates,
// its destination and its crew. The modules and rooms always come from the
// mission it was copied from (the layout editor is not built yet), and gravity
// is never typed: it follows from where the place is.
//
// The same rules run in the editor, as the crew types, and on the hub, which
// refuses a file that breaks them. Each problem is a key in the string table
// with its values, so the editor can say it in either language.
//
// Pure functions, no runtime imports beyond the engine.

import type { Body, CrewSpec, Mission, MissionKind, Situation } from './mission.ts';
import { roomsOf } from './mission.ts';
import { USUAL, simulates } from './crew.ts';

/** The roles a crewmate can have, by key in the string table. */
export const ROLE_KEYS: readonly string[] = ['role.commander', 'role.cmo', 'role.engineer', 'role.scientist'];
export const PRONOUNS = ['she', 'he', 'they'] as const;
export type Pronouns = typeof PRONOUNS[number];

export const MAX_NAME = 60;
export const MAX_DESTINATION = 80;
export const MAX_PERSON_NAME = 40;
export const MAX_CREW = 8;
export const MAX_DAYS = 3650;

/** The project's stated one-way delays: Earth orbit about 1 s, the Moon 1.3 s, Mars between 180 and 1320 s. */
export const MARS_DELAY = { min: 180, max: 1320 } as const;

/** Where a kind of mission can be: a ship orbits or travels, a station orbits, a base stands on the ground. */
export function situationsFor(kind: MissionKind): Situation[] {
  return kind === 'ship' ? ['orbit', 'transit'] : kind === 'station' ? ['orbit'] : ['surface'];
}

/** The bodies a place can be at in that situation: none while travelling, never Earth's ground. */
export function bodiesFor(situation: Situation): (Body | null)[] {
  return situation === 'transit' ? [null] : situation === 'surface' ? ['moon', 'mars'] : ['earth', 'moon', 'mars'];
}

/** Gravity in g, from where the place is: weightless in orbit and in transit. */
export function gravityFor(body: Body | null, situation: Situation): number {
  if (situation !== 'surface') return 0;
  return body === 'moon' ? 0.166 : body === 'mars' ? 0.38 : 0;
}

/**
 * The one-way delay a place can have, in seconds: fixed for Earth orbit and the
 * Moon, a range for Mars. In transit there is no body to take it from, so the
 * whole range up to Mars's farthest is open.
 */
export function delayFor(body: Body | null, situation: Situation): { fixed: number } | { min: number; max: number } {
  if (situation === 'transit' || body === null) return { min: 1, max: MARS_DELAY.max };
  if (body === 'earth') return { fixed: 1 };
  if (body === 'moon') return { fixed: 1.3 };
  return { ...MARS_DELAY };
}

export interface CrewChange {
  /** Kept for someone already in the mission, so their readings stay theirs. A new person has none: the hub gives one. */
  id?: string;
  name: string;
  role: string;
  pronouns: Pronouns;
  quarters: string;
  work: string;
}

/** Everything the crew can change in a mission they made. */
export interface MissionChanges {
  nameText: string;
  where: { body: Body | null; situation: Situation };
  delayToEarthSeconds: number;
  /** YYYY-MM-DD. */
  missionStart: string;
  plannedDays: number;
  /** Free text; empty for none. */
  destination: string;
  crew: CrewChange[];
}

/** One problem, as a key in the string table and its values. `field` names the input it belongs to. */
export interface Problem {
  field: string;
  key: string;
  vars?: Record<string, string | number>;
}

/** A mission's editable data, as the editor starts from it. */
export function changesOf(m: Mission): MissionChanges {
  return {
    nameText: m.nameText ?? '',
    where: { body: m.where.body, situation: m.where.situation },
    delayToEarthSeconds: m.delayToEarthSeconds,
    missionStart: m.missionStart.slice(0, 10),
    plannedDays: m.plannedDays,
    destination: m.destination ?? '',
    crew: m.crew.map((p) => ({ id: p.id, name: p.name, role: p.role, pronouns: p.pronouns ?? 'they', quarters: p.quarters, work: p.work })),
  };
}

const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Everything wrong with these changes to a mission copied from `base`. Empty means it can be saved. Never throws.
 * `nameOptional`: a built-in place keeps its own name when none is typed.
 */
export function changeProblems(base: Mission, input: unknown, opts: { nameOptional?: boolean } = {}): Problem[] {
  const out: Problem[] = [];
  const say = (field: string, key: string, vars?: Problem['vars']) => out.push(vars ? { field, key, vars } : { field, key });
  if (typeof input !== 'object' || input === null) return [{ field: '', key: 'custom.problem.notObject' }];
  const c = input as Partial<Record<keyof MissionChanges, unknown>>;

  if (opts.nameOptional && (c.nameText === undefined || c.nameText === '' || (typeof c.nameText === 'string' && !c.nameText.trim()))) { /* keeps the built-in name */ }
  else if (!text(c.nameText)) say('nameText', 'custom.problem.name');
  else if (c.nameText.trim().length > MAX_NAME) say('nameText', 'custom.problem.nameLong', { max: MAX_NAME });

  const where = c.where as { body?: unknown; situation?: unknown } | undefined;
  const situation = where?.situation as Situation;
  const body = (where?.body ?? null) as Body | null;
  const situationOk = situationsFor(base.kind).includes(situation);
  if (!situationOk) say('situation', 'custom.problem.situation');
  else if (!bodiesFor(situation).includes(body)) say('body', 'custom.problem.body');

  const delay = c.delayToEarthSeconds;
  if (typeof delay !== 'number' || !Number.isFinite(delay)) say('delay', 'custom.problem.delay');
  else if (situationOk && bodiesFor(situation).includes(body)) {
    const allowed = delayFor(body, situation);
    if ('fixed' in allowed ? delay !== allowed.fixed : delay < allowed.min || delay > allowed.max) {
      say('delay', 'fixed' in allowed ? 'custom.problem.delayFixed' : 'custom.problem.delayRange', 'fixed' in allowed ? { value: allowed.fixed } : { min: allowed.min, max: allowed.max });
    }
  }

  if (typeof c.missionStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.missionStart) || Number.isNaN(Date.parse(`${c.missionStart}T00:00:00Z`))) say('missionStart', 'custom.problem.start');
  if (typeof c.plannedDays !== 'number' || !Number.isInteger(c.plannedDays) || c.plannedDays < 1 || c.plannedDays > MAX_DAYS) say('plannedDays', 'custom.problem.days', { max: MAX_DAYS });
  if (c.destination !== undefined && (typeof c.destination !== 'string' || c.destination.trim().length > MAX_DESTINATION)) say('destination', 'custom.problem.destination', { max: MAX_DESTINATION });

  const rooms = new Set(roomsOf(base).map((r) => r.id));
  const crew = Array.isArray(c.crew) ? c.crew as Partial<CrewChange>[] : null;
  if (!crew || crew.length === 0) say('crew', 'custom.problem.noCrew');
  else if (crew.length > MAX_CREW) say('crew', 'custom.problem.crewMany', { max: MAX_CREW });
  const ids = new Set<string>();
  crew?.forEach((p, i) => {
    const at = `crew.${i}`;
    const n = i + 1;
    if (typeof p !== 'object' || p === null) { say(at, 'custom.problem.person', { n }); return; }
    if (p.id !== undefined) {
      if (typeof p.id !== 'string' || !base.crew.some((b) => b.id === p.id) || ids.has(p.id)) say(at, 'custom.problem.personId', { n });
      else ids.add(p.id);
    }
    if (!text(p.name)) say(`${at}.name`, 'custom.problem.personName', { n });
    else if (p.name.trim().length > MAX_PERSON_NAME) say(`${at}.name`, 'custom.problem.personNameLong', { n, max: MAX_PERSON_NAME });
    if (!ROLE_KEYS.includes(p.role as string)) say(`${at}.role`, 'custom.problem.role', { n });
    if (!(PRONOUNS as readonly string[]).includes(p.pronouns as string)) say(`${at}.pronouns`, 'custom.problem.pronouns', { n });
    if (!rooms.has(p.quarters as string)) say(`${at}.quarters`, 'custom.problem.quarters', { n });
    if (!rooms.has(p.work as string)) say(`${at}.work`, 'custom.problem.work', { n });
  });
  return out;
}

/** A lowercase id from a name: letters, digits and dashes. */
export function slug(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

/**
 * The mission these changes make, copied from `base`. Kept from the base: the
 * modules, rooms, sensor boards, structure and view. A new crewmate gets an id
 * from their name, never one the simulated crew has numbers for nor one the
 * mission already used, so a new "Leo" is not given another person's body or history. Call only when changeProblems is empty.
 */
export function applyChanges(base: Mission, c: MissionChanges, id: string, basedOn: string): Mission {
  const taken = new Set(c.crew.flatMap((p) => (p.id ? [p.id] : [])));
  const crew: CrewSpec[] = c.crew.map((p) => {
    let pid = p.id;
    if (!pid) {
      const root = slug(p.name) || 'crew';
      pid = root;
      for (let n = 2; taken.has(pid) || USUAL[pid] || base.crew.some((b) => b.id === pid); n++) pid = `${root}-${n}`;
      taken.add(pid);
    }
    return { id: pid, name: p.name.trim(), role: p.role, pronouns: p.pronouns, quarters: p.quarters, work: p.work };
  });
  const { destination: _d, ...rest } = base;
  const mission: Mission = {
    ...rest,
    id, basedOn, nameText: c.nameText.trim(),
    where: { body: c.where.body, situation: c.where.situation },
    gravity: gravityFor(c.where.body, c.where.situation),
    delayToEarthSeconds: c.delayToEarthSeconds,
    missionStart: `${c.missionStart}T00:00:00Z`,
    plannedDays: c.plannedDays,
    crew,
  };
  if (c.destination.trim()) mission.destination = c.destination.trim();
  return mission;
}

/** True when the simulated demo crew gives this person readings: in demo mode, everyone (engine/crew.ts usualOf). */
export function simulatedFor(personId: string): boolean {
  return simulates(personId);
}
