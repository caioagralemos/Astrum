// The mission files the view can draw. The ship is what the running hub uses; the
// others are for ?demoMission= (see demo.ts) until the hub reads mission files itself.

import type { Mission } from '../../../engine/mission.ts';
import ship from '../../../profiles/missions/ship-mars-orbit.json';
import iss from '../../../profiles/missions/iss.json';
import baseMars from '../../../profiles/missions/base-mars.json';
import baseMoon from '../../../profiles/missions/base-moon.json';
import type { MissionName } from './demo.ts';

export const SHIP = ship as unknown as Mission;

export const MISSIONS: Record<MissionName, Mission> = {
  ship: SHIP,
  iss: iss as unknown as Mission,
  'base-mars': baseMars as unknown as Mission,
  'base-moon': baseMoon as unknown as Mission,
};

/**
 * A built-in mission as the hub runs it. The bundled file says where the place
 * was built to be; a ship moved in Settings (an override the hub keeps) is
 * somewhere else, and the hub's facts say where: the planet below and the
 * weightless poses follow them. Everything else (modules, view) is the file's.
 */
export function placedAt(mission: Mission, facts: { where: Mission['where']; gravity: number; destination?: string } | undefined): Mission {
  if (!facts) return mission;
  const { where, gravity } = facts;
  // Where a ship in transit is going (the setup's trip to the Moon or Mars) comes from the hub too.
  const destination = facts.destination ?? mission.destination;
  if (where.body === mission.where.body && where.situation === mission.where.situation && gravity === mission.gravity && destination === mission.destination) return mission;
  return { ...mission, where: { body: where.body, situation: where.situation }, gravity, ...(destination ? { destination } : {}) };
}
