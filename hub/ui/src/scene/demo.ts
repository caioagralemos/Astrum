// Development switches for the station view, read from the page address once.
// The simulated crew only reaches some states at certain hours (asleep at
// night, everyone at a meal), and rooms rarely go over a limit, so these let
// the view be checked in any state. They are not part of the interface and do
// nothing unless the address asks for them.
//
//   ?demoStatus=quarters-2:over,galley:watch,okafor:over   room or crew id : ok | watch | over | unknown
//   ?demoWhere=*:galley   or   tanaka:lab,leo:gym           move people (* means everyone)
//   ?demoAsleep=*         or   leo,reyes                     draw them asleep (in a cabin only)
//   ?demoSelect=room:galley   or   person:okafor             select this on load
//   ?demoGrid=off   or   on   or   strong                     the moving grid behind the station (strong to see its shape)

import type { Status } from '../../../engine/status.ts';

export interface Demo {
  status: Record<string, Status>;
  where: Record<string, string>;
  asleep: string[] | '*' | null;
  select: { kind: 'room' | 'person'; id: string } | null;
  grid: 'off' | 'on' | 'strong' | null;
}

const STATUSES: readonly string[] = ['ok', 'watch', 'over', 'unknown'];

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
  const sleepers = query.get('demoAsleep');
  const asleep = sleepers === '*' ? '*' : sleepers ? sleepers.split(',') : null;
  const [kind, id] = (query.get('demoSelect') ?? '').split(':');
  const select = (kind === 'room' || kind === 'person') && id ? { kind, id } as const : null;
  const gridValue = query.get('demoGrid');
  const grid = gridValue === 'off' || gridValue === 'on' || gridValue === 'strong' ? gridValue : null;
  return { status, where, asleep, select, grid };
}
