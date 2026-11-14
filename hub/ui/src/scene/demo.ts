// Development switches for the station view, read from the page address once.
// The simulated crew only reaches some states at certain hours (asleep at
// night, everyone at a meal), and rooms rarely go over a limit, so these let
// the view be checked in any state. They are not part of the interface and do
// nothing unless the address asks for them.
//
//   ?demoStatus=quarters-2:over,galley:watch,okafor:over   room or crew id : ok | watch | over | unknown
//   ?demoWhere=*:galley   or   tanaka:lab,leo:gym           move people (* means everyone)
//   ?demoAsleep=*         or   leo,reyes                     draw them asleep (in a cabin only)
//   ?demoActivity=leo:exercising,tanaka:eating                 what they are doing: sleeping | exercising | eating | none
//                                                             (* means everyone); drawn only where the room has the furniture for it
//   ?demoSelect=room:galley   or   person:okafor             select this on load
//   ?demoGrid=off   or   on   or   strong                     the moving grid behind the station (strong to see its shape)
//   ?demoOrbit=35,10                                          turn the view from its default: degrees round, degrees up
//   ?demoZoom=2                                               and zoom it (2 is twice as close; works with or without demoOrbit)
//   ?demoSky=pixel   or   soft   or   off                     the sky's look (overrides --scene-sky-style)
//   ?demoNebula=on                                            hold a nebula in view at full strength
//   ?demoPlanet=off   or   on   or   strong                   the planet below the station
//   ?demoInset=80,0,260,0                                     insets (top, right, bottom, left, CSS pixels) as if interface
//                                                             covered those edges; also outlines them
//   ?demoMission=ship   or   iss   or   base-mars   or   base-moon
//                                                             draw that place from its mission file (hub/profiles/missions).
//                                                             The running hub knows only the ship's rooms, so the crew are
//                                                             put in their usual work rooms (their quarters with demoAsleep),
//                                                             every room's status is unknown unless demoStatus sets it, and
//                                                             demoWhere / demoSelect use that mission's room ids.

import type { Status } from '../../../engine/status.ts';
import type { Doing } from './layout.ts';

export interface Demo {
  status: Record<string, Status>;
  where: Record<string, string>;
  asleep: string[] | '*' | null;
  /** What people are doing, by crew id (or * for everyone), over what the hub says. */
  activity: Record<string, Doing>;
  select: { kind: 'room' | 'person'; id: string } | null;
  grid: 'off' | 'on' | 'strong' | null;
  /** Degrees round, degrees up, zoom factor. */
  orbit: [number, number, number] | null;
  sky: 'pixel' | 'soft' | 'off' | null;
  nebula: boolean;
  planet: 'off' | 'on' | 'strong' | null;
  mission: MissionName | null;
  /** Top, right, bottom, left, in CSS pixels. */
  inset: [number, number, number, number] | null;
}

export const MISSION_NAMES = ['ship', 'iss', 'base-mars', 'base-moon'] as const;
export type MissionName = typeof MISSION_NAMES[number];

const STATUSES: readonly string[] = ['ok', 'watch', 'over', 'unknown'];
const DOINGS: readonly string[] = ['sleeping', 'exercising', 'eating', 'none'];

function pairs(value: string | null): [string, string][] {
  if (!value) return [];
  return value.split(',').map((part) => part.split(':')).filter((p) => p.length === 2).map(([a, b]) => [a.trim(), b.trim()]);
}

export function readDemo(): Demo | null {
  const query = new URLSearchParams(location.search);
  if (![...query.keys()].some((key) => key.startsWith('demo'))) return null;
  const status: Record<string, Status> = {};
  for (const [id, value] of pairs(query.get('demoStatus'))) if (STATUSES.includes(value)) status[id] = value as Status;
  const where: Record<string, string> = Object.fromEntries(pairs(query.get('demoWhere')));
  const activity: Record<string, Doing> = {};
  for (const [id, value] of pairs(query.get('demoActivity'))) if (DOINGS.includes(value)) activity[id] = value as Doing;
  const sleepers = query.get('demoAsleep');
  const asleep = sleepers === '*' ? '*' : sleepers ? sleepers.split(',') : null;
  const [kind, id] = (query.get('demoSelect') ?? '').split(':');
  const select = (kind === 'room' || kind === 'person') && id ? { kind, id } as const : null;
  const gridValue = query.get('demoGrid');
  const grid = gridValue === 'off' || gridValue === 'on' || gridValue === 'strong' ? gridValue : null;
  const [round, raise] = (query.get('demoOrbit') ?? '').split(',').map(Number);
  const zoom = Number(query.get('demoZoom') ?? 1);
  const orbit: [number, number, number] | null = query.has('demoOrbit') || query.has('demoZoom')
    ? [round || 0, raise || 0, zoom > 0 ? zoom : 1] : null;
  const skyValue = query.get('demoSky');
  const sky = skyValue === 'pixel' || skyValue === 'soft' || skyValue === 'off' ? skyValue : null;
  const nebula = query.get('demoNebula') === 'on';
  const planetValue = query.get('demoPlanet');
  const planet = planetValue === 'off' || planetValue === 'on' || planetValue === 'strong' ? planetValue : null;
  const missionValue = query.get('demoMission');
  const mission = (MISSION_NAMES as readonly string[]).includes(missionValue ?? '') ? missionValue as MissionName : null;
  const insetValues = (query.get('demoInset') ?? '').split(',').map(Number);
  const inset = query.has('demoInset') && insetValues.length === 4 && insetValues.every((v) => Number.isFinite(v) && v >= 0)
    ? insetValues as [number, number, number, number] : null;
  return { status, where, asleep, activity, select, grid, orbit, sky, nebula, planet, mission, inset };
}
