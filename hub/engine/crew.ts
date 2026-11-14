// The simulated crew, for demo mode and the web replay.
//
// No open record of an astronaut's body over time exists (heart rate minute by
// minute, sleep night by night), so the demo crew is generated. Its centres are
// published in-flight measurements, listed in REFERENCES with where each came
// from. The movement around those centres (noise, the daily rhythm, the
// exercise rise) is invented here and is not from any source. Every row this
// file makes is marked simulated.
//
// The generator is stateless: the rows for any period depend only on the
// period, so the hub can fill in history at startup and continue live, and the
// web replay produces the same crew.

import type { Row, Stay } from './types.ts';

export const CREW_SOURCE = 'sim:crew';

export interface Reference {
  id: string;
  /** What was measured, on whom, and when. */
  what: string;
  /** The values this file uses, as printed in the source. */
  values: string;
  source: string;
}

export const REFERENCES: Reference[] = [
  {
    id: 'sts40-resting',
    what: 'Resting heart rate and blood pressure of six astronauts, measured in flight (STS-40 and STS-58)',
    values: 'In flight, subjects 1, 3, 4, 6: heart rate 66, 58, 57, 59 beats/min; blood pressure 127/74, 112/61, 117/74, 108/66 mmHg',
    source: 'NASA Life Sciences Portal, experiment 178066 (PI Leon Farhi), Table 2 "Average resting data by subject". From Shykoff BE, Farhi LE, et al. J Appl Physiol 1996;81(1):26-32.',
  },
  {
    id: 'mir-sleep',
    what: 'Sleep recorded each night on Mir (NASA 4, Mir 23, Mir 24): 109 in-flight nights',
    values: 'In flight: sleep duration 307 min, sleep efficiency 65.8 %, 6.5 awakenings a night (before flight: 401 min, 89.6 %, 1.72)',
    source: 'NASA Life Sciences Portal, experiment 9301198 "Sleep and Vestibular Adaptation" (PI J. Allan Hobson), "Analysis of Sleep Parameters in Microgravity".',
  },
  {
    id: 'sts89-mood',
    what: 'Mood ratings of the STS-89 crew in flight, group means on visual analogue scales',
    values: 'In flight: stressed 25.75, fatigue 34.2, sleepy 37.4 (before flight: 20.0, 27.65, 26.3)',
    source: 'NASA Life Sciences Portal, "Stability and Precision of Human Performance During a Spaceflight Mission" (PI Joseph V. Brady), group mean scores table.',
  },
  {
    id: 'iss-exercise',
    what: 'Exercise prescribed on the International Space Station',
    values: '1.5 hours a day, resistance and aerobic together',
    source: 'NASA Human Research Program, Reduced Fitness risk page: "astronauts on the International Space Station perform resistance training and aerobic exercises for 1.5 hours per day".',
  },
];

/** One simulated crewmate's usual values. Heart rate and pressure are one real astronaut's in-flight row each. */
export interface Usual {
  heartRate: number;
  systolic: number;
  diastolic: number;
  quarters: string;
  /** Hour the exercise block starts, station time. */
  gymHour: number;
  /** Where they work between meals and exercise. */
  workRoom: string;
}

export const USUAL: Record<string, Usual> = {
  reyes: { heartRate: 58, systolic: 112, diastolic: 61, quarters: 'quarters-2', gymHour: 17, workRoom: 'lab' },   // STS-40 table, subject 3
  leo: { heartRate: 57, systolic: 117, diastolic: 74, quarters: 'quarters-1', gymHour: 15.5, workRoom: 'lab' },   // subject 4
  okafor: { heartRate: 59, systolic: 108, diastolic: 66, quarters: 'quarters-3', gymHour: 17, workRoom: 'lab' },  // subject 6
  tanaka: { heartRate: 66, systolic: 127, diastolic: 74, quarters: 'quarters-4', gymHour: 15.5, workRoom: 'command' }, // subject 1
};

/**
 * The story's backstory: these crewmates wake with a headache every morning
 * (checkin.headache = 1 at 06:00). Nobody said these answers, so they are
 * simulated like everything else here, not "reported". The hub fills three
 * days back, so the demo shows three mornings running.
 */
export const HEADACHE_MORNINGS: readonly string[] = ['reyes'];

const SLEEP = { minutes: 307, efficiency: 65.8, awakenings: 6.5 };
const MOOD = { stress: 25.75, fatigue: 34.2, sleepy: 37.4 };
const EXERCISE_HOURS = 1.5;

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** A repeatable number from 0 to 1 for a label: the same label always gives the same number. */
export function chance(label: string): number {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Roughly bell-shaped, centred on 0, about -1 to 1. */
function spread(label: string): number {
  return (chance(`${label}a`) + chance(`${label}b`) + chance(`${label}c`)) * (2 / 3) - 1;
}

/** Where someone is at an hour of the station day. */
export function roomAt(person: string, hour: number): string {
  const u = USUAL[person];
  if (hour < 6 || hour >= 22) return u.quarters;
  if (hour < 7) return 'galley';
  if (hour >= 12 && hour < 13) return 'galley';
  if (hour >= u.gymHour && hour < u.gymHour + EXERCISE_HOURS) return 'gym';
  if (hour >= 18.5 && hour < 20) return 'galley';
  if (hour >= 20) return u.quarters;
  return u.workRoom;
}

function stationHour(t: number, offsetMinutes: number): number {
  return (((t + offsetMinutes * 60_000) % DAY) + DAY) % DAY / HOUR;
}

/** Heart rate at one moment: the person's usual, lower asleep, higher in the exercise block. */
export function heartRateAt(person: string, t: number, offsetMinutes: number): number {
  const u = USUAL[person];
  const hour = stationHour(t, offsetMinutes);
  const room = roomAt(person, hour);
  let centre = u.heartRate;
  if (room === u.quarters && (hour < 6 || hour >= 22)) centre -= 6;
  else if (room === 'gym') {
    // Rises over five minutes, holds, comes back over five.
    const into = (hour - u.gymHour) * 60;
    const left = (u.gymHour + EXERCISE_HOURS - hour) * 60;
    centre += 55 * Math.min(1, into / 5, left / 5);
  } else centre += 6;
  const slow = 2.5 * Math.sin(t / (47 * 60_000) + chance(person) * 6.28) + 1.5 * Math.sin(t / (11 * 60_000) + chance(`${person}2`) * 6.28);
  return Math.round(centre + slow + spread(`${person}|hr|${t}`) * 2);
}

export interface CrewPeriod {
  rows: Row[];
  /** One entry per change of room, in time order: who moved where, and when. */
  moves: { person: string; room: string; t: number }[];
}

/**
 * Everything the simulated crew produces after `from` and up to `to`.
 * Heart rate lands on a grid of `stepMs`; daily values land at fixed hours.
 */
export function crewPeriod(people: string[], from: number, to: number, stepMs: number, offsetMinutes: number): CrewPeriod {
  const rows: Row[] = [];
  const moves: CrewPeriod['moves'] = [];
  const base = { kind: 'simulated' as const, source: CREW_SOURCE };

  for (const person of people) {
    const u = USUAL[person];
    if (!u) continue;

    for (let t = Math.floor(from / stepMs) * stepMs + stepMs; t <= to; t += stepMs) {
      const room = roomAt(person, stationHour(t, offsetMinutes));
      rows.push({ ...base, t, signal: 'heart_rate', value: heartRateAt(person, t, offsetMinutes), unit: 'bpm', person, room });
    }

    // Room changes happen on quarter hours; check each one in the period.
    const quarter = 15 * 60_000;
    for (let t = Math.floor(from / quarter) * quarter + quarter; t <= to; t += quarter) {
      const now = roomAt(person, stationHour(t, offsetMinutes));
      if (now !== roomAt(person, stationHour(t - quarter, offsetMinutes))) moves.push({ person, room: now, t });
    }

    // Daily values, each at its own hour of the station day.
    const firstDay = Math.floor((from + offsetMinutes * 60_000) / DAY);
    const lastDay = Math.floor((to + offsetMinutes * 60_000) / DAY);
    for (let day = firstDay; day <= lastDay; day++) {
      const at = (hour: number) => day * DAY - offsetMinutes * 60_000 + hour * HOUR;
      const inPeriod = (t: number) => t > from && t <= to;
      const key = `${person}|${day}`;

      const wake = at(6);
      if (inPeriod(wake)) {
        rows.push(
          { ...base, t: wake, signal: 'sleep_duration', value: Math.round(SLEEP.minutes + spread(`${key}|sleep`) * 45), unit: 'min', person, room: u.quarters },
          { ...base, t: wake, signal: 'sleep_efficiency', value: Math.round(SLEEP.efficiency + spread(`${key}|eff`) * 8), unit: '%', person, room: u.quarters },
          { ...base, t: wake, signal: 'sleep_awakenings', value: Math.max(0, Math.round(SLEEP.awakenings + spread(`${key}|awk`) * 3)), unit: 'count', person, room: u.quarters },
        );
        if (HEADACHE_MORNINGS.includes(person)) {
          rows.push({ ...base, t: wake, signal: 'checkin.headache', value: 1, unit: 'yes/no', person, room: u.quarters });
        }
      }
      const morning = at(6.5);
      if (inPeriod(morning)) {
        const score = (centre: number, label: string) => Math.max(0, Math.min(100, Math.round(centre + spread(`${key}|${label}`) * 12)));
        rows.push(
          { ...base, t: morning, signal: 'blood_pressure_systolic', value: Math.round(u.systolic + spread(`${key}|sys`) * 5), unit: 'mmHg', person, room: 'galley' },
          { ...base, t: morning, signal: 'blood_pressure_diastolic', value: Math.round(u.diastolic + spread(`${key}|dia`) * 4), unit: 'mmHg', person, room: 'galley' },
          { ...base, t: morning, signal: 'mood.stress', value: score(MOOD.stress, 'stress'), unit: '0-100', person, room: 'galley' },
          { ...base, t: morning, signal: 'mood.fatigue', value: score(MOOD.fatigue, 'fatigue'), unit: '0-100', person, room: 'galley' },
          { ...base, t: morning, signal: 'mood.sleepy', value: score(MOOD.sleepy, 'sleepy'), unit: '0-100', person, room: 'galley' },
        );
      }
      const afterGym = at(u.gymHour + EXERCISE_HOURS);
      if (inPeriod(afterGym)) {
        rows.push({ ...base, t: afterGym, signal: 'exercise_minutes', value: EXERCISE_HOURS * 60, unit: 'min', person, room: 'gym' });
      }
    }
  }
  rows.sort((a, b) => a.t - b.t);
  moves.sort((a, b) => a.t - b.t);
  return { rows, moves };
}

/** The stays for a period, starting with where everyone already is at `from`. */
export function crewStays(people: string[], from: number, to: number, offsetMinutes: number): Stay[] {
  const stays: Stay[] = [];
  const open = new Map<string, Stay>();
  for (const person of people) {
    if (!USUAL[person]) continue;
    const stay: Stay = { person, room: roomAt(person, stationHour(from, offsetMinutes)), from, until: null, kind: 'simulated', source: CREW_SOURCE };
    open.set(person, stay);
    stays.push(stay);
  }
  for (const move of crewPeriod(people, from, to, DAY * 3650, offsetMinutes).moves) {
    const before = open.get(move.person)!;
    before.until = move.t;
    const stay: Stay = { person: move.person, room: move.room, from: move.t, until: null, kind: 'simulated', source: CREW_SOURCE };
    open.set(move.person, stay);
    stays.push(stay);
  }
  return stays;
}
