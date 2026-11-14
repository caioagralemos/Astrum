// The mission files the hub can run and the /api/missions routes.
//
// Built-in missions are in hub/profiles/missions and never change. Editing one
// writes an override in the data folder (missions/overrides/<id>.json) that
// holds only what changed; it is merged over the built-in file whenever the
// mission is read, and an override that breaks the rules is ignored (and said
// in GET /api/missions) rather than stopping the hub. "Reset to default"
// removes it. A built-in place other than the ship is given random crew first
// names the first time it starts (engine/names.ts); they are kept in its
// override and survive a reset, so each place keeps its own crew.
//
// Missions the crew made (engine/custom.ts) are copies of one of them, kept as
// JSON in the data folder (core/paths.ts customMissionsDir), each with its own
// database like any other mission.
//
// The hub runs one mission. ASTRUM_MISSION, when set, decides it; otherwise
// the one chosen on screen (mission.json in the data folder), else the ship.
// Choosing on screen (POST /api/missions/select) writes that file and restarts
// the hub through its supervisor (core/run.ts): each mission has its own rooms,
// so the hub starts again rather than swapping them while it runs.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { roomsOf, validateMission } from '../engine/mission.ts';
import type { Body, CrewSpec, Mission, Situation } from '../engine/mission.ts';
import { applyChanges, changeProblems, changesOf, gravityFor } from '../engine/custom.ts';
import type { MissionChanges, Problem } from '../engine/custom.ts';
import { pickNames } from '../engine/names.ts';
import { t } from '../engine/strings.ts';
import { SHIP_MISSION, chosenMissionFile } from './paths.ts';

/** One mission file, as GET /api/missions lists it. `id` is what ASTRUM_MISSION takes. */
export interface MissionEntry {
  id: string;
  /** The mission's own id inside the file (the ship's is "mars-orbit"). */
  missionId: string | null;
  kind: Mission['kind'] | null;
  /** Key in the string table. */
  name: string | null;
  where: Mission['where'] | null;
  gravity: number | null;
  delayToEarthSeconds: number | null;
  rooms: number;
  /** Problems found in the file, in plain words. A file with any cannot be run. */
  problems: string[];
  /** A mission the crew made: its typed name, and the mission it was copied from. */
  custom?: boolean;
  nameText?: string | null;
  basedOn?: string | null;
  /** A built-in place with edits saved over it (an override). */
  edited?: boolean;
  /** Why its override was ignored, in plain words: the place runs as built. */
  overrideProblems?: string[];
}

/**
 * What an override file holds: only the fields that differ from the built-in
 * mission. `firstNames` are the random names given on the first start; the
 * rest are edits, which "Reset to default" removes.
 */
export interface MissionOverride {
  firstNames?: Record<string, string>;
  nameText?: string;
  where?: { body: Body | null; situation: Situation };
  delayToEarthSeconds?: number;
  missionStart?: string;
  plannedDays?: number;
  /** Null: the built-in destination is taken away. */
  destination?: string | null;
  crew?: CrewSpec[];
  /** Crew ids whose pronouns were chosen by hand: a new random name leaves them as they are. */
  pronounsChosen?: string[];
}

const EDIT_KEYS = ['nameText', 'where', 'delayToEarthSeconds', 'missionStart', 'plannedDays', 'destination', 'crew'] as const;

/** Where a built-in place's override is kept, from the folder of crew-made missions. */
export function overrideFile(customDir: string, id: string): string {
  return join(customDir, 'overrides', `${id}.json`);
}

/** True when the override changes more than the crew's first names. */
export function hasEdits(o: MissionOverride | null): boolean {
  return o !== null && EDIT_KEYS.some((k) => o[k] !== undefined);
}

/** The built-in crew with the names given on the first start; a renamed person's pronouns become "they". */
function named(base: Mission, firstNames: Record<string, string> | undefined): Mission {
  if (!firstNames) return base;
  return { ...base, crew: base.crew.map((p) => (typeof firstNames[p.id] === 'string' ? { ...p, name: firstNames[p.id], pronouns: 'they' } : p)) };
}

/** The built-in mission with an override merged over it. Check the result with overrideProblems. */
export function withOverride(base: Mission, o: MissionOverride): Mission {
  const m: Mission = { ...named(base, o.firstNames) };
  if (typeof o.nameText === 'string' && o.nameText.trim()) m.nameText = o.nameText.trim();
  if (o.where) { m.where = { body: o.where.body, situation: o.where.situation }; m.gravity = gravityFor(o.where.body, o.where.situation); }
  if (o.delayToEarthSeconds !== undefined) m.delayToEarthSeconds = o.delayToEarthSeconds;
  if (o.missionStart !== undefined) m.missionStart = o.missionStart;
  if (o.plannedDays !== undefined) m.plannedDays = o.plannedDays;
  if (o.destination === null) delete m.destination;
  else if (o.destination !== undefined) m.destination = o.destination;
  if (o.crew) m.crew = o.crew;
  return m;
}

/** Everything wrong with an override over its built-in mission, in plain words: the whole mission's rules and the editor's. */
export function overrideProblems(base: Mission, raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return ['The override is not an object.'];
  const o = raw as MissionOverride;
  if (o.firstNames !== undefined && (typeof o.firstNames !== 'object' || o.firstNames === null || Object.values(o.firstNames).some((n) => typeof n !== 'string' || !n.trim()))) return ['The first names must be a list of names by crew id.'];
  if (o.crew !== undefined && !Array.isArray(o.crew)) return ['The crew, when given, must be a list.'];
  if (o.where !== undefined && (typeof o.where !== 'object' || o.where === null)) return ['"where", when given, must say the body and situation.'];
  if (o.pronounsChosen !== undefined && (!Array.isArray(o.pronounsChosen) || o.pronounsChosen.some((x) => typeof x !== 'string'))) return ['The chosen pronouns must be a list of crew ids.'];
  const merged = withOverride(base, o);
  const hub = validateMission(merged);
  if (hub.length) return hub;
  return changeProblems(merged, changesOf(merged), { nameOptional: true }).map((p) => t(p.key, 'en', p.vars));
}

/** A built-in place's override, read and checked. Null when it has none. */
export function readOverride(builtIn: string, customDir: string | null, id: string): { override: MissionOverride; problems: string[] } | null {
  if (!customDir || !NAME.test(id)) return null;
  const file = overrideFile(customDir, id);
  if (!existsSync(file)) return null;
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { return { override: {}, problems: ['The override file is not JSON.'] }; }
  let base: Mission;
  try { base = loadMission(builtIn, id); } catch (err) { return { override: {}, problems: [(err as Error).message] }; }
  const problems = overrideProblems(base, raw);
  return { override: problems.length ? {} : raw as MissionOverride, problems };
}

function writeOverride(customDir: string, id: string, o: MissionOverride): void {
  const file = overrideFile(customDir, id);
  const kept = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  if (!Object.keys(kept).length) return void rmSync(file, { force: true });
  mkdirSync(join(customDir, 'overrides'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`);
}

/**
 * What `edited` changes from the built-in `base` (with its first names), as an
 * override: only the fields that differ. The first names and chosen pronouns are carried as given.
 */
export function overrideOf(base: Mission, edited: Mission, firstNames: Record<string, string> | undefined, pronounsChosen: string[]): MissionOverride {
  const from = named(base, firstNames);
  const o: MissionOverride = {};
  if (firstNames && Object.keys(firstNames).length) o.firstNames = firstNames;
  if (edited.nameText && edited.nameText !== from.nameText) o.nameText = edited.nameText;
  if (edited.where.body !== from.where.body || edited.where.situation !== from.where.situation) o.where = { ...edited.where };
  if (edited.delayToEarthSeconds !== from.delayToEarthSeconds) o.delayToEarthSeconds = edited.delayToEarthSeconds;
  if (edited.missionStart.slice(0, 10) !== from.missionStart.slice(0, 10)) o.missionStart = edited.missionStart;
  if (edited.plannedDays !== from.plannedDays) o.plannedDays = edited.plannedDays;
  if ((edited.destination ?? null) !== (from.destination ?? null)) o.destination = edited.destination ?? null;
  if (JSON.stringify(edited.crew) !== JSON.stringify(from.crew)) o.crew = edited.crew;
  const ids = new Set(edited.crew.map((p) => p.id));
  const chosen = [...new Set(pronounsChosen)].filter((x) => ids.has(x)).sort();
  if (chosen.length) o.pronounsChosen = chosen;
  return o;
}

/**
 * The first start of a built-in place other than the ship: its crew gets random
 * first names, kept in its override so they stay the same afterwards. Ids never
 * change, so readings and history stay with the same person. Does nothing when
 * the place already has an override. Returns true when it named them.
 */
export function nameCrewOnce(builtIn: string, customDir: string | null, id: string, seed: number | string = Date.now()): boolean {
  if (!customDir || id === SHIP_MISSION || !NAME.test(id) || !existsSync(join(builtIn, `${id}.json`))) return false;
  if (existsSync(overrideFile(customDir, id))) return false;
  const base = loadMission(builtIn, id);
  const names = pickNames(base.crew.length, seed);
  writeOverride(customDir, id, { firstNames: Object.fromEntries(base.crew.map((p, i) => [p.id, names[i] ?? p.name])) });
  return true;
}

/**
 * Crew ids whose pronouns were chosen by hand. A built-in place keeps the list
 * in its override; for a crew-made place they are the ones that differ from the
 * place it was copied from (or, for someone new, any but "they").
 */
export function pronounsChosenOf(builtIn: string, customDir: string | null, id: string, mission: Mission, custom: boolean): string[] {
  if (!custom) return readOverride(builtIn, customDir, id)?.override.pronounsChosen ?? [];
  let ref: Mission | null = null;
  try { ref = mission.basedOn ? loadMission(builtIn, mission.basedOn) : null; } catch { ref = null; }
  return mission.crew.filter((p) => {
    const r = ref?.crew.find((x) => x.id === p.id);
    return r ? (r.pronouns ?? 'they') !== (p.pronouns ?? 'they') : (p.pronouns ?? 'they') !== 'they';
  }).map((p) => p.id);
}

const NAME = /^[a-z0-9-]{1,64}$/;

/** Reads one mission file by its name (without ".json"). Throws with the file's problems in plain words. */
export function loadMission(dir: string, file: string): Mission {
  if (!NAME.test(file)) throw new Error(`"${file}" is not a mission name: use lowercase letters, digits and -, like "iss".`);
  const path = join(dir, `${file}.json`);
  if (!existsSync(path)) throw new Error(`There is no mission "${file}". The missions are: ${listMissionFiles(dir).join(', ')}.`);
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const problems = validateMission(raw);
  if (problems.length) throw new Error(`The mission "${file}" cannot be run:\n  ${problems.join('\n  ')}`);
  return raw as Mission;
}

export function listMissionFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((f) => NAME.test(f)).sort();
}

export function listMissions(dir: string, custom = false): MissionEntry[] {
  return listMissionFiles(dir).map((id) => {
    let raw: unknown = null;
    let problems: string[];
    try {
      raw = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
      problems = validateMission(raw);
    } catch {
      problems = ['The file is not JSON.'];
    }
    const m = (problems.length ? raw ?? {} : raw) as Partial<Mission>;
    const entry: MissionEntry = {
      id, missionId: typeof m.id === 'string' ? m.id : null, kind: m.kind ?? null, name: typeof m.name === 'string' ? m.name : null,
      where: m.where ?? null, gravity: typeof m.gravity === 'number' ? m.gravity : null,
      delayToEarthSeconds: typeof m.delayToEarthSeconds === 'number' ? m.delayToEarthSeconds : null,
      rooms: problems.length ? 0 : roomsOf(m as Mission).length, problems,
    };
    if (custom) Object.assign(entry, { custom: true, nameText: typeof m.nameText === 'string' ? m.nameText : null, basedOn: typeof m.basedOn === 'string' ? m.basedOn : null });
    return entry;
  });
}

/** Where a mission's file is: built-in first (a crew-made mission never takes a built-in's name). Null when there is none. */
export function missionPath(builtIn: string, customDir: string | null, id: string): { path: string; custom: boolean } | null {
  if (!NAME.test(id)) return null;
  if (existsSync(join(builtIn, `${id}.json`))) return { path: join(builtIn, `${id}.json`), custom: false };
  if (customDir && existsSync(join(customDir, `${id}.json`))) return { path: join(customDir, `${id}.json`), custom: true };
  return null;
}

/** Reads a built-in mission (with its override, when that is sound) or a crew-made one. Throws with its problems in plain words. */
export function loadAnyMission(builtIn: string, customDir: string | null, id: string): Mission {
  const found = missionPath(builtIn, customDir, id);
  if (!found) return loadMission(builtIn, id);
  if (found.custom) return loadMission(customDir!, id);
  const base = loadMission(builtIn, id);
  const over = readOverride(builtIn, customDir, id);
  return over && !over.problems.length ? withOverride(base, over.override) : base;
}

/** Remembers the mission chosen on screen, for the next start. */
export function writeChosen(dataDir: string, id: string): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(chosenMissionFile(dataDir), `${JSON.stringify({ id })}\n`);
}

/** A crew-made mission's id: "custom-" and a stamp, never used before (its database may still be there after a delete). */
function newId(customDir: string, taken: (id: string) => boolean): string {
  for (let n = Date.now(); ; n++) {
    const id = `custom-${n.toString(36)}`;
    if (!existsSync(join(customDir, `${id}.json`)) && !taken(id)) return id;
  }
}

/** A problem with the English words for it, for anyone reading the API without the string table. */
type SaidProblem = Problem & { text: string };
const said = (problems: Problem[]): SaidProblem[] => problems.map((p) => ({ ...p, text: t(p.key, 'en', p.vars) }));

export interface MissionsOptions {
  /** Where crew-made missions are kept. Without it, none can be made. */
  customDir?: string | null;
  /** The data folder, where the chosen mission is remembered. Without it, nothing can be chosen. */
  dataDir?: string | null;
  /** Why the place cannot be chosen here (core/paths.ts missionLock), or null. */
  locked?: string | null;
  /** True when the hub runs under core/run.ts, which can restart it. */
  supervised?: boolean;
  /** True while the recorded story plays. */
  storyPlaying?: () => boolean;
  /** Restarts the hub; called after the answer has gone out. */
  restart?: (to: string) => void;
  /** Demo or production, for screens to show the demo tools only where they work. */
  mode?: 'demo' | 'production';
  /** True when a database file for this mission exists, so a new id never takes over old history. */
  hasHistory?: (id: string) => boolean;
}

/**
 * GET /api/missions: every mission and which one is running. `running` is the
 * mission file the hub runs, or null when it runs an old profile file
 * (ASTRUM_PROFILE), named in `profile`. Also GET /api/missions/:id,
 * POST /api/missions (make one), PUT /api/missions/:id (a built-in place: saved
 * as its override), DELETE /api/missions/:id (crew-made only),
 * DELETE /api/missions/:id/override (Reset to default) and POST /api/missions/select.
 * Saving or resetting the place the hub runs restarts it, as a switch does.
 */
export function missionsRoute(dir: string, running: string | null, profile: string | null = null, opts: MissionsOptions = {}) {
  const customDir = opts.customDir ?? null;
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== '/api/missions' && !url.pathname.startsWith('/api/missions/')) return false;
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return true;
    };
    const list = () => [...listMissions(dir).map((e) => {
      const over = readOverride(dir, customDir, e.id);
      if (!over || e.problems.length) return e;
      if (over.problems.length) return { ...e, edited: hasEdits(over.override), overrideProblems: over.problems };
      const m = loadAnyMission(dir, customDir, e.id);
      const out: MissionEntry = { ...e, where: m.where, gravity: m.gravity, delayToEarthSeconds: m.delayToEarthSeconds, edited: hasEdits(over.override) };
      if (m.nameText) out.nameText = m.nameText;
      return out;
    }), ...(customDir ? listMissions(customDir, true) : [])];
    /** After a change to the place the hub runs: restart it when it can, once the answer has gone out. */
    const restartFor = (id: string): { restarting: boolean; restartNeeded: boolean } => {
      if (id !== running) return { restarting: false, restartNeeded: false };
      if (!opts.supervised || !opts.restart) return { restarting: false, restartNeeded: true };
      res.once('finish', () => opts.restart?.(id));
      return { restarting: true, restartNeeded: false };
    };
    const storyRefusal = 'The recorded story is playing. Stop it first, then change the place.';

    if (url.pathname === '/api/missions') {
      if (req.method === 'GET') {
        return json(200, {
          running, profile, locked: opts.locked ?? null, supervised: opts.supervised ?? false, mode: opts.mode ?? 'demo',
          switchBy: 'Choose it in Settings, or restart the hub with ASTRUM_MISSION=<id>.', missions: list(),
        });
      }
      if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
      // Make a mission from another.
      if (!customDir) return json(403, { error: 'This hub keeps no missions made by the crew.' });
      const b = (await readJson(req)) as { basedOn?: unknown; changes?: unknown } | undefined;
      if (typeof b?.basedOn !== 'string') return json(400, { error: 'needs basedOn: the id of the mission to copy' });
      let base: Mission;
      try { base = loadAnyMission(dir, customDir, b.basedOn); } catch (err) { return json(404, { error: (err as Error).message }); }
      const changes = (b.changes ?? { ...changesOf(base), nameText: t('custom.copyName', 'en', { name: base.nameText ?? t(base.name, 'en') }) }) as MissionChanges;
      const problems = changeProblems(base, changes);
      if (problems.length) return json(400, { error: 'The mission has problems.', problems: said(problems) });
      const id = newId(customDir, opts.hasHistory ?? (() => false));
      // A copy of a copy is still built on the built-in mission its modules came from.
      const mission = applyChanges(base, changes, id, base.basedOn ?? b.basedOn);
      const hub = validateMission(mission);
      if (hub.length) return json(400, { error: 'The mission has problems.', problems: [], hubProblems: hub });
      mkdirSync(customDir, { recursive: true });
      writeFileSync(join(customDir, `${id}.json`), `${JSON.stringify(mission, null, 2)}\n`);
      return json(201, { id, mission });
    }

    if (url.pathname === '/api/missions/select') {
      if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
      const b = (await readJson(req)) as { id?: unknown } | undefined;
      if (typeof b?.id !== 'string') return json(400, { error: 'needs the id of a mission, e.g. {"id":"iss"}' });
      try { loadAnyMission(dir, customDir, b.id); } catch (err) { return json(404, { error: (err as Error).message }); }
      if (opts.locked) return json(409, { error: opts.locked });
      if (!opts.dataDir) return json(409, { error: 'This hub cannot remember a chosen mission.' });
      if (!opts.supervised || !opts.restart) {
        return json(409, { error: `This hub was started without its supervisor ("node core/main.ts"), so it cannot restart itself. Stop it and start it with "npm run core" (or "node core/run.ts"), or restart it by hand with ASTRUM_MISSION=${b.id}.` });
      }
      if (opts.storyPlaying?.()) return json(409, { error: 'The recorded story is playing. Stop it first, then switch the place.' });
      writeChosen(opts.dataDir, b.id);
      const to = b.id;
      res.once('finish', () => opts.restart?.(to));
      return json(200, { restarting: true, id: to });
    }

    const rest = decodeURIComponent(url.pathname.slice('/api/missions/'.length));
    const resetting = rest.endsWith('/override');
    const id = resetting ? rest.slice(0, -'/override'.length) : rest;
    const found = missionPath(dir, customDir, id);
    if (!found) return json(404, { error: `There is no mission "${id}".` });

    if (resetting) {
      // Reset to default: the edits go; the first names given to the crew stay.
      if (req.method !== 'DELETE') return json(405, { error: 'method not allowed' });
      if (found.custom) return json(400, { error: `"${id}" was made by the crew: it has no default to go back to.` });
      if (!customDir) return json(403, { error: 'This hub keeps no edits to its places.' });
      if (opts.storyPlaying?.()) return json(409, { error: storyRefusal });
      const over = readOverride(dir, customDir, id);
      const firstNames = over?.override.firstNames;
      if (over?.problems.length) rmSync(overrideFile(customDir, id), { force: true });
      else writeOverride(customDir, id, { firstNames });
      return json(200, { id, reset: true, mission: loadAnyMission(dir, customDir, id), ...restartFor(id) });
    }

    if (req.method === 'GET') {
      try {
        const mission = loadAnyMission(dir, customDir, id);
        const over = found.custom ? null : readOverride(dir, customDir, id);
        return json(200, {
          id, custom: found.custom, mission, edited: hasEdits(over?.override ?? null),
          pronounsChosen: pronounsChosenOf(dir, customDir, id, mission, found.custom), storyCrew: id === SHIP_MISSION,
        });
      } catch (err) {
        return json(422, { error: (err as Error).message });
      }
    }
    if (req.method !== 'PUT' && req.method !== 'DELETE') return json(405, { error: 'method not allowed' });
    if (!found.custom && req.method === 'DELETE') return json(403, { error: `"${id}" is built in and cannot be deleted. Reset it to its default instead.` });
    if (opts.storyPlaying?.()) return json(409, { error: storyRefusal });
    if (!found.custom) {
      // A built-in place: the edit is saved as its override; the file in the project never changes.
      if (!customDir) return json(403, { error: 'This hub keeps no edits to its places.' });
      const base = loadMission(dir, id);
      const over = readOverride(dir, customDir, id);
      const current = loadAnyMission(dir, customDir, id);
      const b = (await readJson(req)) as { changes?: unknown; pronounsChosen?: unknown } | undefined;
      const changes = (b && typeof b === 'object' && 'changes' in b ? b.changes : b) as MissionChanges;
      const problems = changeProblems(current, changes, { nameOptional: true });
      if (problems.length) return json(400, { error: 'The mission has problems.', problems: said(problems) });
      const typed = typeof changes.nameText === 'string' ? changes.nameText.trim() : '';
      // New people get their ids as in a crew-made mission (engine/custom.ts applyChanges).
      const made = applyChanges(current, { ...changes, nameText: typed || 'x' }, id, id);
      const { nameText: _n, destination: _d, ...kept } = current;
      const edited: Mission = { ...kept, where: made.where, gravity: made.gravity, delayToEarthSeconds: made.delayToEarthSeconds, missionStart: made.missionStart, plannedDays: made.plannedDays, crew: made.crew };
      if (typed) edited.nameText = typed;
      if (made.destination) edited.destination = made.destination;
      const hub = validateMission(edited);
      if (hub.length) return json(400, { error: 'The mission has problems.', problems: [], hubProblems: hub });
      const chosen = Array.isArray(b?.pronounsChosen) ? b.pronounsChosen.filter((x): x is string => typeof x === 'string') : [...over?.override.pronounsChosen ?? []];
      // Someone new starts as "they" with a random name: other pronouns were chosen by hand.
      changes.crew.forEach((p, i) => { if (!p.id && p.pronouns !== 'they' && made.crew[i]) chosen.push(made.crew[i].id); });
      writeOverride(customDir, id, overrideOf(base, edited, over?.override.firstNames, chosen));
      // The running hub took its rooms and crew when it started: it restarts to use them.
      return json(200, { id, mission: loadAnyMission(dir, customDir, id), edited: hasEdits(readOverride(dir, customDir, id)?.override ?? null), ...restartFor(id) });
    }
    if (req.method === 'DELETE') {
      if (id === running) return json(409, { error: 'This is the place the hub runs now. Switch to another place first.' });
      rmSync(found.path, { force: true });
      // Forget it as the chosen place, so the next start does not look for it.
      if (opts.dataDir && existsSync(chosenMissionFile(opts.dataDir))) {
        try { if ((JSON.parse(readFileSync(chosenMissionFile(opts.dataDir), 'utf8')) as { id?: string }).id === id) rmSync(chosenMissionFile(opts.dataDir)); } catch { /* unreadable: main.ts falls back to the ship */ }
      }
      return json(200, { deleted: id });
    }
    const current = loadAnyMission(dir, customDir, id);
    const b = (await readJson(req)) as { changes?: unknown } | undefined;
    const changes = (b && typeof b === 'object' && 'changes' in b ? b.changes : b) as MissionChanges;
    const problems = changeProblems(current, changes);
    if (problems.length) return json(400, { error: 'The mission has problems.', problems: said(problems) });
    const mission = applyChanges(current, changes, id, current.basedOn ?? id);
    const hub = validateMission(mission);
    if (hub.length) return json(400, { error: 'The mission has problems.', problems: [], hubProblems: hub });
    writeFileSync(found.path, `${JSON.stringify(mission, null, 2)}\n`);
    // The running hub took its rooms and crew when it started: it restarts to use them.
    return json(200, { id, mission, ...restartFor(id) });
  };
}

const MAX_BODY = 200_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return undefined;
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}
