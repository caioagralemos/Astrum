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
