// The setup's starting values for a place: the stay starts today (day 1), for
// its planned length; a trip departs today. The person changes any of them.
// Pure, so it is tested without a screen (defaults.test.ts).

import { missionDayOf } from '../../../engine/mission.ts';

const MIN_STAY = 30;
const MAX_DAYS = 3 * 365;

/** Today's date on the station's clock (`offsetMinutes` from UTC), YYYY-MM-DD: day 1 of a stay that starts today. */
export function todayOn(now: number, offsetMinutes: number): string {
  return new Date(now + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function setupDefaults(plannedDays: number, trip: boolean, now: number, offsetMinutes: number): { start: string; days: number; day: number } {
  const start = todayOn(now, offsetMinutes);
  const days = Math.min(MAX_DAYS, Math.max(trip ? 1 : MIN_STAY, Math.round(plannedDays)));
  return { start, days, day: missionDayOf(start, now, offsetMinutes) };
}
