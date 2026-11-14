// One word for how a room or a person is doing, for the colour on the station
// view. It reads what the limits and alert levels already decided; it adds no
// judgement of its own.

import type { Alert } from './alerts.ts';
import type { RoomAlarm } from './cabin.ts';
import { CO2_LEVELS } from './exposure.ts';
import type { Stuck } from './quality.ts';
import { isFresh } from './timeline.ts';
import type { Row } from './types.ts';

export type Status = 'ok' | 'watch' | 'over' | 'unknown';

/**
 * A room is "over" when it has an alarm (a NASA limit is broken), "watch" when
 * its CO2 now is at or above the level where NASA reports headaches
 * (2.8 mmHg, OCHMO-TB-004), "unknown" with no current CO2 reading or one
 * from a sensor that may be stuck (never "ok" on a reading that cannot be
 * trusted), else "ok".
 */
export function roomStatus(room: string, values: Row[], alarms: RoomAlarm[], now: number, stuck: Stuck[] = []): Status {
  if (alarms.some((a) => a.room === room)) return 'over';
  const co2 = values.find((r) => r.room === room && !r.person && r.signal === 'co2');
  if (!co2 || co2.value === null || !isFresh(co2, now)) return 'unknown';
  if (stuck.some((s) => s.room === room && s.signal === 'co2' && s.source === co2.source)) return 'unknown';
  return co2.value >= CO2_LEVELS[0].level ? 'watch' : 'ok';
}

/** A person follows their highest alert: level 3 "over", levels 1 and 2 "watch". */
export function personStatus(person: string, alerts: Alert[]): Status {
  const mine = alerts.filter((a) => a.person === person && !a.held);
  if (mine.some((a) => a.level === 3)) return 'over';
  return mine.length ? 'watch' : 'ok';
}
