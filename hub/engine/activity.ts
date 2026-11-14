// What each crewmate is doing now, as a fact with a label, so the station view
// draws someone running on the treadmill only when the hub knows they are
// exercising. The room alone never decides it: a person in the exercise room
// with nothing to say they are exercising is simply there.
//
// Sources, each labelled with how it came to exist:
// - The simulated crew (demo mode only): from the generator's own schedule
//   (engine/crew.ts). Sleeping during the sleep block in their own quarters,
//   exercising during their own exercise block in the exercise room, eating
//   during the meal blocks in the galley. Kind "simulated".
// - A real person with a phone: exercising is estimated from the phone's own
//   readings: the day's exercise minutes (the running total Apple's exercise
//   ring keeps, itself a measurement of activity) rose within the last few
//   minutes. It ends a few minutes after the total stops rising. Kind
//   "estimated". The phone reports sleep only after the fact, at waking (one
//   sleep_duration row for the night), so a real person is never shown asleep
//   live; the hour of the day is never used to guess it. Nothing measures
//   eating, so a real person is never shown eating.
// - Anyone else, and anything not known: "none".
//
// Pure: no clock, no database. core/alerts.ts gathers the inputs.

import type { Kind, Row } from './types.ts';
import { partOfDay, simulates } from './crew.ts';
import type { Places } from './crew.ts';

export type Doing = 'sleeping' | 'exercising' | 'eating' | 'none';

export interface Activity {
  what: Doing;
  kind: Kind;
  /** When this began, as far as the hub knows (hub clock, milliseconds). */
  since: number;
}

/** What the hub decided this moment, before it is given a start time. */
export interface Decided {
  what: Doing;
  kind: Kind;
  /** When it is known from the readings themselves; otherwise it began when first decided. */
  since?: number;
}

/** A rise in the day's exercise minutes this recent counts as exercising now. */
export const EXERCISE_HOLD_MS = 5 * 60_000;
/** Someone whose own devices sent a measured reading this recently is a real person: the simulated schedule no longer speaks for them. */
export const REAL_WITHIN_MS = 60 * 60_000;

/** What one person's own devices say. */
export interface RealInputs {
  /** Their measured exercise_minutes rows (the day's running total) of the last day or so, in any order. */
  exercise: Row[];
}

/**
 * Exercising, estimated from the day's exercise minutes: the newest rise is at
 * most EXERCISE_HOLD_MS old. A row is a rise when its total is above the one
 * before it; the first row of a day (or the first ever) rises from zero. Since
 * is the first rise of the unbroken run that ends with it.
 */
export function estimatedExercise(rows: Row[], now: number): { since: number } | null {
  const sorted = rows.filter((r) => r.value !== null && r.t <= now).sort((a, b) => a.t - b.t);
  const rises: number[] = [];
  let before: number | null = null;
  for (const row of sorted) {
    const value = row.value!;
    // A total lower than the last one is a new day, counted from zero.
    const from = before !== null && before <= value ? before : 0;
    if (value > from) rises.push(row.t);
    before = value;
  }
  const last = rises[rises.length - 1];
  if (last === undefined || now - last > EXERCISE_HOLD_MS) return null;
  let since = last;
  for (let i = rises.length - 2; i >= 0 && since - rises[i] <= EXERCISE_HOLD_MS; i--) since = rises[i];
  return { since };
}

/** A simulated crewmate, from the schedule: the part of their day, and the room they are actually in. */
export function simulatedDoing(person: string, hour: number, room: string | null, places: Places): Doing {
  if (!simulates(person) || room === null) return 'none';
  const part = partOfDay(person, hour);
  if (part === 'sleep' && room === places.quarters) return 'sleeping';
  if (part === 'exercise' && places.exercise !== null && room === places.exercise) return 'exercising';
  if (part === 'meal' && places.galley !== null && room === places.galley) return 'eating';
  return 'none';
}

/** A real person: only what their own readings show. */
export function realDoing(inputs: RealInputs, now: number): Decided {
  const exercise = estimatedExercise(inputs.exercise, now);
  if (exercise) return { what: 'exercising', kind: 'estimated', since: exercise.since };
  return { what: 'none', kind: 'estimated' };
}

export interface PersonInputs {
  /** The room they are in now, or null. */
  room: string | null;
  /** True when their own devices sent a measured reading within REAL_WITHIN_MS. */
  real: boolean;
  exercise: Row[];
}

/**
 * Everyone's activity this moment, in the order of `people`. `simulated` is the
 * simulated crew's day (demo mode), or null in production, where nothing is simulated.
 */
export function decideActivity(
  people: string[],
  inputs: (person: string) => PersonInputs,
  now: number,
  simulated: { hour: number; places: Record<string, Places> } | null,
): Record<string, Decided> {
  const out: Record<string, Decided> = {};
  for (const person of people) {
    const input = inputs(person);
    const places = simulated?.places[person];
    if (!input.real && simulated && places && simulates(person)) {
      out[person] = { what: simulatedDoing(person, simulated.hour, input.room, places), kind: 'simulated' };
    } else {
      out[person] = realDoing({ exercise: input.exercise }, now);
    }
  }
  return out;
}

/**
 * Gives each decision its start time: kept from before while the same thing goes
 * on, taken from the readings when they say, or now. The order of `decided` is kept.
 */
export function settleActivity(before: Record<string, Activity>, decided: Record<string, Decided>, now: number): Record<string, Activity> {
  const out: Record<string, Activity> = {};
  for (const [person, d] of Object.entries(decided)) {
    const held = before[person];
    const same = held && held.what === d.what && held.kind === d.kind;
    out[person] = { what: d.what, kind: d.kind, since: d.since ?? (same ? held.since : now) };
  }
  return out;
}

/** Who is asleep, from the activity: the one place "asleep" comes from, so the two never disagree. */
export function sleepersOf(activity: Record<string, Activity>): string[] {
  return Object.entries(activity).filter(([, a]) => a.what === 'sleeping').map(([person]) => person);
}
