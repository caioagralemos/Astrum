// The dock when nothing is selected: the smart stacks of station widgets
// (SmartDock.tsx, widgets.tsx): one stack of pages, each a whole arrangement of the dock.

import type { Status } from '../../../engine/status.ts';
import type { Profile, Row } from '../../../engine/types.ts';
import type { World } from '../data.ts';
import type { LastSeen } from '../../../engine/timeline.ts';
import type { Selection } from '../scene/Station.tsx';
import { SmartDock } from './SmartDock.tsx';
import type { S } from './widgets.tsx';

export interface StationDockProps {
  world: World;
  profile: Profile;
  values: Row[];
  where: Record<string, string>;
  lastSeen?: Record<string, LastSeen>;
  roomStatus: Record<string, Status>;
  personStatus: Record<string, Status>;
  s: S;
  onSelect: (selection: Selection) => void;
  onAlerts: () => void;
  onEarth?: (id: string | null) => void;
  earthUnread?: number;
}

export function StationDock({ world, profile, values, where, lastSeen, roomStatus, personStatus, s, onSelect, onAlerts, onEarth, earthUnread }: StationDockProps) {
  return (
    <SmartDock
      context={{ world, profile, values, where, lastSeen, roomStatus, personStatus, now: world.now, s, onSelect, onAlerts, onEarth, earthUnread }} />
  );
}
