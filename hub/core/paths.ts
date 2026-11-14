// Where the hub keeps its files, shared by the hub and the compaction script.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The user's app-data folder, not the project: a synced folder (iCloud
 * Desktop) copies a live database and can corrupt it. ASTRUM_DATA overrides it.
 */
export function dataDir(): string {
  const appData = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
    : (process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'));
  return process.env.ASTRUM_DATA ?? join(appData, 'Astrum');
}

/** The mission file the ship's history has always been kept under. */
export const SHIP_MISSION = 'ship-mars-orbit';

/**
 * The database file. Its name changes when the table's CHECK rules change: an
 * older file keeps its old rules, so a new file is started rather than rewriting the old one.
 * Each mission keeps its own file, because each has its own rooms: the ship's
 * is astrum-3.sqlite as it always was, another's astrum-3-<mission>.sqlite.
 */
export function databaseFile(dir = dataDir(), mission: string | null = SHIP_MISSION): string {
  return join(dir, mission === null || mission === SHIP_MISSION ? 'astrum-3.sqlite' : `astrum-3-${mission}.sqlite`);
}

/** The crew's sensor list, kept apart per mission like the database, since sensors sit in rooms. */
export function sensorsFile(dir = dataDir(), mission: string | null = SHIP_MISSION): string {
  return join(dir, mission === null || mission === SHIP_MISSION ? 'sensors.json' : `sensors-${mission}.json`);
}

/** The small file that remembers the mission chosen on screen: {"id": "<mission file>"}. */
export function chosenMissionFile(dir = dataDir()): string {
  return join(dir, 'mission.json');
}

/** Where the missions the crew made are kept (engine/custom.ts): the data folder, not the project. */
export function customMissionsDir(dir = dataDir()): string {
  return join(dir, 'missions');
}

/**
 * Where edits to the built-in places are kept, one file per place holding only
 * what changed (core/missions.ts). The files in hub/profiles/missions never change.
 */
export function overridesDir(dir = dataDir()): string {
  return join(customMissionsDir(dir), 'overrides');
}

/** The mission chosen on screen, or null when none was (or the file cannot be read). */
export function chosenMission(dir = dataDir()): string | null {
  const file = chosenMissionFile(dir);
  if (!existsSync(file)) return null;
  try {
    const id = (JSON.parse(readFileSync(file, 'utf8')) as { id?: unknown }).id;
    return typeof id === 'string' && /^[a-z0-9-]{1,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * The mission the hub runs: ASTRUM_MISSION when set (it always wins), else the
 * one chosen on screen, else the ship. Null when ASTRUM_PROFILE names an old
 * profile file instead.
 */
export function missionName(dir = dataDir()): string | null {
  if (process.env.ASTRUM_PROFILE && !process.env.ASTRUM_MISSION) return null;
  return process.env.ASTRUM_MISSION || chosenMission(dir) || SHIP_MISSION;
}

/** Why the place cannot be chosen on screen, in plain words, or null when it can. */
export function missionLock(): string | null {
  if (process.env.ASTRUM_MISSION) return `This hub was started with ASTRUM_MISSION=${process.env.ASTRUM_MISSION}, which fixes the place. Start it without ASTRUM_MISSION to choose the place here.`;
  if (process.env.ASTRUM_PROFILE) return `This hub was started with ASTRUM_PROFILE=${process.env.ASTRUM_PROFILE}, an old profile file. Start it without ASTRUM_PROFILE to choose the place here.`;
  return null;
}

/** While a hub has the database open it holds this file, with its process id in it. */
export function lockFile(database: string): string {
  return `${database}.lock`;
}
