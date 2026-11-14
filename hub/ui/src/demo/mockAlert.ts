// A mock alert for looking at the alert screens, on this screen only: add
// `?demoAlert` to the address. Nothing is sent to the hub; every mock reading
// and alert is labelled Simulated (source "demo").
//
// It puts the first crewmate's room over NASA's CO2 limit (a room alarm and a
// level 3 alert for them, told to everyone, with a message to Earth on its
// way) and asks the second crewmate "Are you OK?" at level 2, with a
// countdown. Times are anchored to when the page opened, so the countdowns run.

import { useRef } from 'react';
import type { World } from '../data.ts';
import { occupants } from '../../../engine/timeline.ts';
import type { Alert, EarthMessage } from '../../../engine/alerts.ts';
import type { RoomAlarm } from '../../../engine/cabin.ts';
import type { Row } from '../../../engine/types.ts';

const MIN = 60_000;

export function useMockAlert(world: World): World {
  const on = useRef(new URLSearchParams(location.search).has('demoAlert'));
  const start = useRef<number | null>(null);
  if (!on.current || !world.profile || world.profile.crew.length === 0) return world;
  if (start.current === null) start.current = world.now;
  const t0 = start.current;
  const { profile } = world;
  const here = occupants(world.stays, world.now);
  const roomOf = (id: string) => Object.entries(here).find(([, people]) => people.includes(id))?.[0] ?? profile.rooms[0]?.id ?? null;

  const first = profile.crew[0];
  const second = profile.crew[1] ?? first;
  const room = roomOf(first.id);
  if (!room) return world;
  const delay = profile.delayToEarthSeconds * 1000;
  const sentAt = t0 - 6 * MIN;
  const earth = { sentAt, arrivesAt: sentAt + delay, replyAt: sentAt + 2 * delay };

  const alarm: RoomAlarm = {
    room, signal: 'co2', value: 3.5, over: 0.5, unit: 'mmHg', limit: 3,
    limitSource: 'NASA OCHMO-TB-004: the 1-hour average CO2 is to be "no more than 3 mmHg".',
    kind: 'simulated', source: 'demo', since: t0 - 20 * MIN, acknowledged: false,
  } as RoomAlarm;
  const base = {
    reason: 'room-limit' as const, signal: 'co2', value: 3.5, over: 0.5, unit: 'mmHg', limit: 3,
    limitSource: alarm.limitSource, direction: 'high' as const, kind: 'simulated' as const,
    held: false, stationWide: false, lowestRoom: null, card: null,
  };
  const danger: Alert = {
    ...base, id: 'demo-3', person: first.id, level: 3, room,
    since: t0 - 18 * MIN, levelSince: t0 - 6 * MIN, askedAt: t0 - 8 * MIN, answerBy: t0 - 6 * MIN, answer: null,
    toldTo: 'everyone', earth, earthId: 'demo-earth',
  } as Alert;
  const asking: Alert = {
    ...base, id: 'demo-2', person: second.id, level: 2, room: roomOf(second.id),
    since: t0 - 2 * MIN, levelSince: t0, askedAt: t0, answerBy: t0 + 60_000, answer: null,
    toldTo: [second.id], earth: null, askKey: 'alert.areYouOk',
  } as Alert;
  const message: EarthMessage = {
    id: 'demo-earth', kind: 'alert',
    about: { person: first.id, room, signal: 'co2', level: 3, stationWide: false },
    sentAt, arrivesAt: earth.arrivesAt, replyAt: earth.replyAt, delivered: world.now > earth.arrivesAt,
  } as EarthMessage;
  // The room's CO2 now reads over the limit, so the room, the dock and the room view all show it.
  const co2: Row = { t: world.now, signal: 'co2', value: 3.5, text: null, unit: 'mmHg', kind: 'simulated', source: 'demo', person: null, room } as Row;

  return {
    ...world,
    alarms: [alarm, ...world.alarms],
    alerts: [danger, ...(second.id !== first.id ? [asking] : []), ...world.alerts],
    earthMessages: [message, ...world.earthMessages],
    latest: [co2, ...world.latest.filter((r) => !(r.room === room && !r.person && r.signal === 'co2'))],
  };
}
