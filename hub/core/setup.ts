// The hub's first-run setup (ui/src/onboarding/): one route that saves the
// whole setup at once, and the flag that says whether it was done.
//
// The setup chooses one of the built-in places (a trip on the ship, a base on
// Mars or the Moon, a stay on the ISS) and saves what the crew typed over it
// as that place's override (core/missions.ts): its name, its start and length,
// the crew (with their portrait, pronoun and medical officer) and the room of
// each sensor board. The place becomes the chosen one and the hub restarts to
// run it, as a switch in Settings does. Gravity, rooms and the delay to Earth
// stay the place's own.
//
// setup.json in the data folder holds { setupDone }. Only a hub started on an
// empty data folder writes it as false, so an existing install, which has no
// such file, counts as set up and never shows the setup by itself.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { missionDayOf, validateMission, roomsOf } from '../engine/mission.ts';
import type { CrewSpec, Mission } from '../engine/mission.ts';
import { PRONOUNS, ROLE_KEYS, delayFor, slug } from '../engine/custom.ts';
import { USUAL } from '../engine/crew.ts';
import { loadAnyMission, loadMission, overrideOf, readOverride, writeChosen, writeOverride } from './missions.ts';

/** The places the setup can choose, by mission file. */
export const SETUP_PLACES = ['ship-mars-orbit', 'base-mars', 'base-moon', 'iss'] as const;
export type SetupPlace = typeof SETUP_PLACES[number];

export interface SetupCrewmate {
  /** Their id when they are already on the place's crew; absent for someone new. */
  id?: string;
  name: string;
  role: string;
  pronoun: 'she' | 'he' | 'they';
  /** A path under the hub's public folder, e.g. "crew/crew-4.jpg". */
  portrait?: string;
  /** Their own photo, as a data URL (JPEG, PNG or WebP, up to 5 MB): kept in the hub's data folder and served at crew/custom/<id>.<ext>; it becomes `portrait`. */
  photo?: string;
  medicalOfficer?: boolean;
}

export interface Setup {
  place: SetupPlace;
  /** The mission's name, as typed. */
  name: string;
  /** YYYY-MM-DD: day 1 of the stay, or the departure. */
  missionStart: string;
  plannedDays: number;
  crew: SetupCrewmate[];
  /** Which room each sensor board sits in, by the id the board announces (without "chip:"). */
  chips?: Record<string, string>;
  /** A trip's destination; Mars when absent. Only for the ship. */
  destination?: 'mars' | 'moon';
}

const PORTRAIT = /^crew\/(crew-[1-9]|custom\/[a-z0-9-]+)\.(jpg|png|webp)$/;
const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PHOTO = 5 * 1024 * 1024;
const MAX_SETUP_BODY = 12 * 1024 * 1024;

/** A photo sent in a setup: its bytes and extension, or null when it is not a JPEG, PNG or WebP of up to 5 MB. The bytes must match the type. */
export function photoOf(dataUrl: unknown): { bytes: Buffer; ext: string } | null {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_PHOTO) return null;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
  const type = m[1];
  if ((type === 'image/jpeg' && !isJpeg) || (type === 'image/png' && !isPng) || (type === 'image/webp' && !isWebp)) return null;
  return { bytes, ext: PHOTO_TYPES[type] };
}

/** Where the crew's own photos are kept: the data folder, never the project. */
export function photosDir(dataDir: string): string {
  return join(dataDir, 'crew-photos');
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_SETUP_BODY) return undefined;
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_DAYS = 30;
const MAX_DAYS = 3 * 365;
const MAX_CREW = 12;

export function setupFile(dataDir: string): string {
  return join(dataDir, 'setup.json');
}

/** On a hub started on an empty data folder, before anything else is written: the setup is still to do. */
export function markFreshInstall(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  if (readdirSync(dataDir).length === 0) writeFileSync(setupFile(dataDir), `${JSON.stringify({ setupDone: false })}\n`);
}

/** True unless setup.json says it is still to do. No file (an existing install) means done. */
export function setupDone(dataDir: string): boolean {
  const file = setupFile(dataDir);
  if (!existsSync(file)) return true;
  try { return (JSON.parse(readFileSync(file, 'utf8')) as { setupDone?: unknown }).setupDone !== false; } catch { return true; }
}

/** Everything wrong with a setup, in plain words, against the place it chooses. Empty means it can be saved. */
export function setupProblems(raw: unknown, place: Mission | null, now = Date.now(), offsetMinutes = -new Date(now).getTimezoneOffset()): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return ['The setup is not an object.'];
  const s = raw as Record<string, unknown>;
  const problems: string[] = [];
  const say = (text: string) => problems.push(text);
  if (!(SETUP_PLACES as readonly string[]).includes(s.place as string)) say(`The place must be one of ${SETUP_PLACES.join(', ')}.`);
  if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 60) say('The mission needs a name of up to 60 characters.');
  if (typeof s.missionStart !== 'string' || !DATE.test(s.missionStart) || Number.isNaN(Date.parse(s.missionStart))) say('The mission start must be a date (YYYY-MM-DD).');
  // A trip can be days long (the Moon is about three); a stay is a month at least.
  const minDays = s.place === 'ship-mars-orbit' ? 1 : MIN_DAYS;
  if (typeof s.plannedDays !== 'number' || !Number.isInteger(s.plannedDays) || s.plannedDays < minDays || s.plannedDays > MAX_DAYS) say(`The stay must be a whole number of days from ${minDays} to ${MAX_DAYS}.`);
  // Today must fall inside the stay: on or after its first day, on or before its last.
  if (typeof s.missionStart === 'string' && DATE.test(s.missionStart) && typeof s.plannedDays === 'number' && Number.isInteger(s.plannedDays)) {
    const day = missionDayOf(s.missionStart, now, offsetMinutes);
    if (day < 1) say("The mission can't start after today.");
    else if (day > s.plannedDays) say(`Today can't be after the last day. Day ${day} of ${s.plannedDays}.`);
  }
  if (s.destination !== undefined && (s.destination !== 'mars' && s.destination !== 'moon' || s.place !== 'ship-mars-orbit')) say('The destination, for a trip only, must be mars or moon.');
  if (!Array.isArray(s.crew) || s.crew.length === 0 || s.crew.length > MAX_CREW) say(`The crew must have 1 to ${MAX_CREW} people.`);
  else {
    const ids = new Set<string>();
    (s.crew as unknown[]).forEach((x, i) => {
      const n = i + 1;
      if (typeof x !== 'object' || x === null) { say(`Crewmate ${n} is not an object.`); return; }
      const p = x as Record<string, unknown>;
      if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40) say(`Crewmate ${n} needs a name of up to 40 characters.`);
      if (!ROLE_KEYS.includes(p.role as string)) say(`Crewmate ${n} has an unknown role.`);
      if (!(PRONOUNS as readonly string[]).includes(p.pronoun as string)) say(`Crewmate ${n}: the pronoun must be she, he or they.`);
      if (p.portrait !== undefined && (typeof p.portrait !== 'string' || !PORTRAIT.test(p.portrait))) say(`Crewmate ${n}: the portrait must be one of the hub's crew pictures.`);
      if (p.photo !== undefined && !photoOf(p.photo)) say(`Crewmate ${n}: the photo must be a JPEG, PNG or WebP of up to 5 MB.`);
      if (p.medicalOfficer !== undefined && typeof p.medicalOfficer !== 'boolean') say(`Crewmate ${n}: medicalOfficer must be true or false.`);
      if (p.id !== undefined) {
        if (typeof p.id !== 'string' || !place?.crew.some((c) => c.id === p.id)) say(`Crewmate ${n} has an id that is not on this place's crew.`);
        else if (ids.has(p.id)) say(`Crewmate ${n} appears twice.`);
        else ids.add(p.id);
      }
    });
    const officers = (s.crew as Record<string, unknown>[]).filter((p) => p?.medicalOfficer === true).length;
    if (officers !== 1) say('Exactly one crewmate must be the medical officer.');
  }
  if (s.chips !== undefined) {
    if (typeof s.chips !== 'object' || s.chips === null || Array.isArray(s.chips)) say('The boards must be a list of rooms by board id.');
    else if (place) {
      const rooms = new Set(roomsOf(place).map((r) => r.id));
      for (const [board, room] of Object.entries(s.chips)) if (typeof room !== 'string' || !rooms.has(room)) say(`Board "${board}" is put in "${String(room)}", which is not a room here.`);
    }
  }
  return problems;
}

/** The place's mission with the setup laid over it. Check the result with validateMission. */
export function missionOfSetup(current: Mission, setup: Setup, base: Mission = current): Mission {
  const taken = new Set(setup.crew.flatMap((p) => (p.id ? [p.id] : [])));
  const crew: CrewSpec[] = setup.crew.map((p, i) => {
    const known = p.id ? current.crew.find((c) => c.id === p.id) : undefined;
    let id = known?.id;
    if (!id) {
      const root = slug(p.name) || 'crew';
      id = root;
      for (let n = 2; taken.has(id) || USUAL[id] || current.crew.some((c) => c.id === id); n++) id = `${root}-${n}`;
      taken.add(id);
    }
    // Someone new sleeps and works where the place's crewmate in the same place in the list did.
    const like = known ?? current.crew[i % current.crew.length];
    const person: CrewSpec = { id, name: p.name.trim(), role: p.role, pronouns: p.pronoun, pronoun: p.pronoun, quarters: like.quarters, work: like.work };
    if (p.portrait) person.portrait = p.portrait;
    if (p.medicalOfficer) person.medicalOfficer = true;
    return person;
  });
  const { nameText: _n, ...kept } = current;
  const out: Mission = { ...kept, nameText: setup.name.trim(), missionStart: `${setup.missionStart}T00:00:00Z`, plannedDays: setup.plannedDays, crew, chips: { ...current.chips, ...setup.chips } };
  // A trip is the ship in transit, weightless, from Earth to the Moon or Mars. Its delay to Earth is the destination's:
  // the Moon's fixed 1.3 s (engine/custom.ts delayFor), or the ship file's own for Mars.
  if (setup.place === 'ship-mars-orbit') {
    const moon = setup.destination === 'moon';
    out.where = { body: null, situation: 'transit' };
    out.gravity = 0;
    out.destination = moon ? 'place.moon-orbit.short' : base.destination ?? 'place.mars-orbit.short';
    const fixed = delayFor('moon', 'orbit');
    out.delayToEarthSeconds = moon && 'fixed' in fixed ? fixed.fixed : base.delayToEarthSeconds;
  }
  return out;
}

export interface SetupOptions {
  /** The built-in missions folder. */
  dir: string;
  customDir: string | null;
  dataDir: string | null;
  supervised?: boolean;
  storyPlaying?: () => boolean;
  restart?: (to: string) => void;
  /** The hub's addresses on the station's network, for the phones. */
  addresses?: () => string[];
  port?: number;
}

/** GET /api/setup: whether it was done, and the hub's addresses. POST /api/setup: saves a whole setup. */
export function setupRoute(opts: SetupOptions) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const served = /^\/crew\/custom\/([a-z0-9-]+)\.(jpg|png|webp)$/.exec(url.pathname);
    if (served && req.method === 'GET' && opts.dataDir) {
      try {
        const data = await readFile(join(photosDir(opts.dataDir), `${served[1]}.${served[2]}`));
        res.writeHead(200, { 'content-type': served[2] === 'jpg' ? 'image/jpeg' : `image/${served[2]}`, 'cache-control': 'no-cache' }).end(data);
      } catch { res.writeHead(404).end(); }
      return true;
    }
    if (url.pathname !== '/api/setup') return false;
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return true;
    };
    if (req.method === 'GET') return json(200, { setupDone: opts.dataDir ? setupDone(opts.dataDir) : true, addresses: opts.addresses?.() ?? [], port: opts.port ?? null });
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
    if (!opts.customDir || !opts.dataDir) return json(403, { error: 'This hub cannot keep a setup.' });
    if (opts.storyPlaying?.()) return json(409, { error: 'The recorded story is playing. Stop it first, then save the setup.' });
    const body = await readBody(req);
    const placeId = (body as { place?: unknown } | undefined)?.place;
    let current: Mission | null = null;
    if ((SETUP_PLACES as readonly unknown[]).includes(placeId)) {
      try { current = loadAnyMission(opts.dir, opts.customDir, placeId as string); } catch (err) { return json(422, { error: (err as Error).message }); }
    }
    const problems = setupProblems(body, current);
    if (problems.length || !current) return json(400, { error: 'The setup has problems.', problems });
    const setup = body as Setup;
    const edited = missionOfSetup(current, setup, loadMission(opts.dir, setup.place));
    // Each own photo is written to the data folder under the crewmate's id and becomes their portrait.
    const photos: { path: string; bytes: Buffer }[] = [];
    setup.crew.forEach((p, i) => {
      const photo = p.photo ? photoOf(p.photo) : null;
      if (!photo) return;
      const person = edited.crew[i];
      person.portrait = `crew/custom/${person.id}.${photo.ext}`;
      photos.push({ path: join(photosDir(opts.dataDir!), `${person.id}.${photo.ext}`), bytes: photo.bytes });
    });
    const hub = validateMission(edited);
    if (hub.length) return json(400, { error: 'The setup has problems.', problems: hub });
    const over = readOverride(opts.dir, opts.customDir, setup.place);
    const base = loadMission(opts.dir, setup.place);
    const override = overrideOf(base, edited, over?.override.firstNames, edited.crew.map((p) => p.id), over?.override.pickedStart);
    if (JSON.stringify(edited.chips) !== JSON.stringify(base.chips)) override.chips = { ...edited.chips };
    if (photos.length) mkdirSync(photosDir(opts.dataDir), { recursive: true });
    for (const photo of photos) writeFileSync(photo.path, photo.bytes);
    writeOverride(opts.customDir, setup.place, override);
    writeChosen(opts.dataDir, setup.place);
    writeFileSync(setupFile(opts.dataDir), `${JSON.stringify({ setupDone: true, at: new Date().toISOString() })}\n`);
    const mission = loadAnyMission(opts.dir, opts.customDir, setup.place);
    if (opts.supervised && opts.restart) {
      const to = setup.place;
      res.once('finish', () => opts.restart?.(to));
      return json(200, { saved: true, id: to, mission, restarting: true });
    }
    return json(200, { saved: true, id: setup.place, mission, restarting: false, restartNeeded: true });
  };
}
