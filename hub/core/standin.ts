// Stand-in values, demo mode only.
//
// The hub never passes a made-up value off as real, and in production it makes
// none. In demo mode, when no source is giving a cabin signal for a room, this
// fills the gap with a slow wander around a value that suits the place and the
// room, so the demo station has every reading a real one would. Every such row
// is marked simulated and comes from the source "sim:hub", and it stops the
// moment any other source gives that signal (the chip in its room, NASA's
// replay of CO2, temperature and humidity everywhere).
//
// Where each number comes from (also in data-nasa/standin/SOURCE.txt). Three
// classes: (a) cited, from a source already in this project; (b) a physical or
// engineering convention; (c) made up for plausibility with no source.
//
// | Signal      | Place                         | Value                         | Class |
// |-------------|-------------------------------|-------------------------------|-------|
// | radiation   | Earth orbit (ISS)             | Mir 19 per-room rates, 261 to 414 uGy/day (absorbed dose) | a |
// | radiation   | Mars orbit, transit, Moon orbit | 1.8 mSv/day (dose equivalent), Curiosity RAD in transit | a |
// | radiation   | Mars surface                  | 0.67 mSv/day (dose equivalent), Curiosity RAD on the surface | a |
// | radiation   | Moon surface                  | about 1 mSv/day               | c (no cited figure in this project) |
// | radiation   | rooms of one place            | the Mir per-room spread, as a pattern | a (pattern only) |
// | radiation   | wander                        | a display step or two, about one step in ten minutes | c |
// | pressure    | every place                   | 1013.25 hPa (760 mmHg)        | b |
// | oxygen      | every place                   | 159.2 mmHg (20.95 % of 760 mmHg) | b |
// | light       | day and night                 | follows the crew's day, 22:00 to 06:00 dark | rhythm a, numbers c |
// | light       | a window room in Earth orbit  | sunlight every 90 minutes (16 sunrises a day) | period a, brightness c |
// | light       | raw levels by room            | 30 to 2400 raw                | c |
// | noise       | raw levels by room and use    | 150 to about 1500 raw         | c |
// | exercise    | when someone is exercising    | their 1.5-hour block in the crew's day | a (NASA's 1.5 h a day) |
// | vibration   | spacecraft / surface base     | 0.002 g / 0.001 g; +0.02 g while someone exercises | c |
// | air quality | every place                   | index 1.4                     | c |
// | temperature | only if NASA's replay is silent | 23 C, 0.3 C lower at night  | c |
// | humidity    | only if NASA's replay is silent | 45 %                        | c |
// | CO2         | never, with a mission         | NASA's record is the only CO2 | - |
//
// Gravity changes nothing here: the bases keep a sea-level cabin like the
// spacecraft, and no room reading is moved by gravity. The day is the hub's
// 24-hour clock everywhere, Mars included: a Martian day is longer, and the
// demo does not keep a sol clock.
//
// Without a mission (an old profile file, the recorded story) the stand-in is
// what it always was: one ordinary cabin value per signal, CO2 included, and
// the Mir rates handed out to the rooms in order.

import type { Row, Stay } from '../engine/types.ts';
import type { Mission, Template } from '../engine/mission.ts';
import { occupants } from '../engine/timeline.ts';
import { USUAL } from '../engine/crew.ts';
import { STAND_IN } from './server.ts';
import type { Hub } from './server.ts';

interface Shape { unit: string; centre: number; step: number; pull: number; decimals: number }

const SHAPES: Record<string, Shape> = {
  pressure: { unit: 'hPa', centre: 1013, step: 0.05, pull: 0.02, decimals: 1 },
  temperature: { unit: 'C', centre: 23, step: 0.03, pull: 0.02, decimals: 1 },
  humidity: { unit: '%', centre: 45, step: 0.2, pull: 0.02, decimals: 0 },
  co2: { unit: 'mmHg', centre: 2.4, step: 0.004, pull: 0.01, decimals: 2 },
  oxygen: { unit: 'mmHg', centre: 160, step: 0.05, pull: 0.02, decimals: 1 },
  vibration: { unit: 'g', centre: 0.002, step: 0.0005, pull: 0.1, decimals: 4 },
  air_quality: { unit: 'index', centre: 1.4, step: 0.05, pull: 0.05, decimals: 0 },
  // Raw 0-4095 readings, like the chip's microphone and light sensor.
  noise: { unit: 'raw', centre: 240, step: 12, pull: 0.2, decimals: 0 },
  light: { unit: 'raw', centre: 1900, step: 6, pull: 0.05, decimals: 0 },
  radiation: { unit: 'uGy/day', centre: 320, step: 0.4, pull: 0.02, decimals: 0 },
};

/**
 * Radiation by room on a real station: the six per-room dose rates measured
 * on Mir (Mir 19, 1995, passive dosimeters, uGy/day; Badhwar et al., "Radiation
 * Environment on the Mir Orbital Station During Solar Minimum", from NASA's Life
 * Sciences Portal, dataset J0001100; ~/Desktop/NASA/data-found/DATA-FOUND.md
 * section 10). Mir flew inside Earth's magnetic field, like the ISS.
 */
const MIR = {
  commanderCabin: 352.5,
  exerciseArea: 414.0,
  nearR16: 261.0,
  engineerCabin: 292.8,
  controlPanel: 279.0,
  window: 336.0,
};
/** In the order the source lists them; without a mission they go to the rooms in this order. */
const RADIATION_CENTRES = [MIR.commanderCabin, MIR.exerciseArea, MIR.nearR16, MIR.engineerCabin, MIR.controlPanel, MIR.window];
const MIR_MEAN = RADIATION_CENTRES.reduce((a, b) => a + b, 0) / RADIATION_CENTRES.length;

/**
 * Curiosity's RAD instrument, dose equivalent: "an average GCR dose equivalent
 * rate of 1.8 millisieverts per day" in transit to Mars, and "0.67 millisieverts
 * per day from August 2012 to June 2013 on the Martian surface" (Zeitlin et al.,
 * Science 2013; Hassler et al., Science 2014; DATA-FOUND.md section 11).
 */
const RAD_TRANSIT_MSV = 1.8;
const RAD_MARS_SURFACE_MSV = 0.67;
/** No cited figure in this project. A round number, made up, between the two RAD figures. */
const MOON_SURFACE_MSV = 1;

/** Sea-level standard atmosphere: 1013.25 hPa, the 760 mmHg NASA's CO2 replay is converted at. */
const SEA_LEVEL_HPA = 1013.25;
/** Oxygen's share of dry air (20.95 %) at 760 mmHg. */
const OXYGEN_MMHG = Number((0.2095 * 760).toFixed(1));

/** "Astronauts witness 16 sunrises and sunsets per day aboard the space station" (NASA, risk-sleep-3). */
const ORBIT_MS = (24 * 3600_000) / 16;

/** NASA's "1.5 hours per day" of exercise on the ISS, the block the simulated crew keeps (engine/crew.ts). */
const EXERCISE_HOURS = 1.5;

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** What the stand-in needs to know about the place. */
export interface StandInPlace {
  mission: Mission;
  /** Where people are. The stand-in reads who is in each room from it (the store does this). */
  stays?: { stays(from: number, to: number): Stay[] };
  /** Station time against UTC, as the simulated crew keeps it. */
  offsetMinutes?: number;
}

/** One room's fixed facts. */
interface RoomFacts {
  template: Template | null;
  /** Radiation centre in `radiationUnit`, or null where no figure applies. */
  radiation: number | null;
}

/** The radiation unit and centre for a place, or null where the project has no figure. */
export function radiationOf(mission: Pick<Mission, 'where'>): { unit: string; base: number | null } | null {
  const { body, situation } = mission.where;
  // Inside Earth's magnetic field: Mir's own rates, absorbed dose, per room.
  if (body === 'earth' && situation === 'orbit') return { unit: 'uGy/day', base: null };
  if (situation === 'surface') {
    if (body === 'mars') return { unit: 'mSv/day', base: RAD_MARS_SURFACE_MSV };
    if (body === 'moon') return { unit: 'mSv/day', base: MOON_SURFACE_MSV };
    return null; // On Earth's surface: no place in this project, and no figure.
  }
  // Beyond Earth's magnetic field, in orbit or in transit: RAD in transit.
  return { unit: 'mSv/day', base: RAD_TRANSIT_MSV };
}

/** The Mir location of like use for each room; the others take the six rates in turn, by room order. */
function mirRates(mission: Mission, rooms: string[]): Record<string, number> {
  const templates = templatesOf(mission);
  const out: Record<string, number> = {};
  let cabins = 0;
  rooms.forEach((room, i) => {
    const t = templates[room];
    if (t === 'quarters') out[room] = cabins++ % 2 === 0 ? MIR.commanderCabin : MIR.engineerCabin;
    else if (t === 'exercise') out[room] = MIR.exerciseArea;
    else if (t === 'command') out[room] = MIR.controlPanel;
    else if (t === 'observation') out[room] = MIR.window;
    else out[room] = RADIATION_CENTRES[i % RADIATION_CENTRES.length];
  });
  return out;
}

/** Each room's template: a cabin has its module's. */
function templatesOf(mission: Mission): Record<string, Template> {
  const out: Record<string, Template> = {};
  for (const m of mission.modules) {
    if (m.cabins?.length) for (const c of m.cabins) out[c.id] = m.template;
    else out[m.id] = m.template;
  }
  return out;
}

const WORK_ROOMS: readonly Template[] = ['lab', 'command', 'medical', 'greenhouse'];

/** One signal's shape in a place: how it wanders, and where it is headed now. */
interface Target { unit: string; centre: number; step: number; pull: number; decimals: number }

export class StandIn {
  private values = new Map<string, number>();
  /** The value last shown per key: it moves only by a whole display step, as a sensor's reading does. */
  private shown = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private hub: Hub;
  private rooms: string[];
  private random: () => number;
  private place: StandInPlace | null;
  private facts: Record<string, RoomFacts> = {};
  private radiationUnit: string | null = null;

  /** `place` makes the values suit the mission and its rooms; without it, the old single cabin. */
  constructor(hub: Hub, rooms: string[], random: () => number = Math.random, place: StandInPlace | null = null) {
    this.hub = hub;
    this.rooms = rooms;
    this.random = random;
    this.place = place;
    if (place) {
      const templates = templatesOf(place.mission);
      const radiation = radiationOf(place.mission);
      const mir = mirRates(place.mission, rooms);
      this.radiationUnit = radiation?.unit ?? null;
      for (const room of rooms) {
        // Absorbed dose: Mir's rate itself. Dose equivalent: the place's figure, spread over rooms in Mir's proportions.
        const centre = !radiation ? null : radiation.base === null ? mir[room] : radiation.base * mir[room] / MIR_MEAN;
        this.facts[room] = { template: templates[room] ?? null, radiation: centre };
      }
    }
  }

  start(): void {
    this.timer = setInterval(() => void this.hub.ingest(this.tick(Date.now())), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The rows for one second: only the signals nobody else is giving. */
  tick(now: number): Row[] {
    return this.place ? this.placeTick(now, this.place) : this.plainTick(now);
  }

  /** Without a mission: one ordinary cabin, as the stand-in has always been. */
  private plainTick(now: number): Row[] {
    const rows: Row[] = [];
    for (const room of this.rooms) {
      for (const [signal, shape] of Object.entries(SHAPES)) {
        if (this.hub.hasSource(room, signal, now)) continue;
        const key = `${room}|${signal}`;
        const centre = signal === 'radiation' ? RADIATION_CENTRES[this.rooms.indexOf(room) % RADIATION_CENTRES.length] : shape.centre;
        const before = this.values.get(key) ?? centre;
        const value = Math.max(0, before + (this.random() * 2 - 1) * shape.step + (centre - before) * shape.pull);
        this.values.set(key, value);
        rows.push({ t: now, signal, value: Number(value.toFixed(shape.decimals)), unit: shape.unit, kind: 'simulated', source: STAND_IN, room });
      }
    }
    return rows;
  }

  /** With a mission: each room's values from its place, its use, the hour and who is in it. */
  private placeTick(now: number, place: StandInPlace): Row[] {
    const offset = place.offsetMinutes ?? -new Date(now).getTimezoneOffset();
    const hour = ((((now + offset * 60_000) % DAY) + DAY) % DAY) / HOUR;
    const here = place.stays ? occupants(place.stays.stays(now, now), now) : {};
    const rows: Row[] = [];
    for (const room of this.rooms) {
      const inRoom = here[room] ?? [];
      // Someone the simulated crew's day puts in this room to work is not exercising, even in the gym.
      const exercising = inRoom.filter((p) => !USUAL[p] || (hour >= USUAL[p].gymHour && hour < USUAL[p].gymHour + EXERCISE_HOURS)).length;
      for (const signal of PLACE_SIGNALS) {
        if (this.hub.hasSource(room, signal, now)) continue;
        const target = this.target(signal, room, hour, inRoom.length, exercising, now, place.mission);
        if (!target) continue;
        const key = `${room}|${signal}`;
        const before = this.values.get(key) ?? target.centre;
        const value = Math.max(0, before + (this.random() * 2 - 1) * target.step + (target.centre - before) * target.pull);
        this.values.set(key, value);
        const rounded = Number(value.toFixed(target.decimals));
        const last = this.shown.get(key);
        const shown = last === undefined || Math.abs(value - last) >= 10 ** -target.decimals ? rounded : last;
        this.shown.set(key, shown);
        rows.push({ t: now, signal, value: shown, unit: target.unit, kind: 'simulated', source: STAND_IN, room });
      }
    }
    return rows;
  }

  /** Where one signal of one room is headed at this moment, or null if the stand-in gives none. */
  private target(signal: string, room: string, hour: number, people: number, exercising: number, now: number, mission: Mission): Target | null {
    const facts = this.facts[room];
    const template = facts?.template ?? null;
    const night = hour < 6 || hour >= 22;
    const surface = mission.where.situation === 'surface';
    switch (signal) {
      case 'pressure': return { ...SHAPES.pressure, centre: SEA_LEVEL_HPA };
      case 'oxygen': return { ...SHAPES.oxygen, centre: OXYGEN_MMHG };
      case 'temperature': return { ...SHAPES.temperature, centre: SHAPES.temperature.centre - (night ? 0.3 : 0) };
      case 'humidity': return SHAPES.humidity;
      case 'air_quality': return SHAPES.air_quality;
      case 'vibration': {
        // A surface base has no thrusters or free-floating pumps on its frame: quieter than a spacecraft (made up).
        const base = surface ? 0.001 : 0.002;
        return { ...SHAPES.vibration, centre: base + (template === 'exercise' && exercising > 0 ? 0.02 : 0), step: surface ? 0.00025 : 0.0005 };
      }
      case 'noise': {
        let centre = SHAPES.noise.centre;
        if (template === 'lab') centre += 100; // equipment runs day and night
        else if (template === 'command' || template === 'medical') centre += 40;
        if (template === 'exercise' && exercising > 0) centre += 1000 + 100 * exercising + 40 * (people - exercising); // treadmill or resistance machine
        else if (template === 'galley') centre += 90 * people; // people eating together
        else if (!(night && template === 'quarters')) centre += 40 * people;
        if (night) centre -= template === 'quarters' ? 90 : 40;
        return { ...SHAPES.noise, centre };
      }
      case 'light': {
        let centre: number;
        if (night) centre = template === 'quarters' ? 30 : 500;
        else if (template && WORK_ROOMS.includes(template)) centre = 2400;
        else if (template === 'galley' || template === 'exercise') centre = 2000;
        else if (template === 'quarters') centre = 1400;
        else centre = 1200;
        // A window room in Earth orbit: the Sun comes and goes every orbit, whatever the station's clock says.
        if (template === 'observation' && mission.where.body === 'earth' && mission.where.situation === 'orbit') {
          centre += 1200 * Math.max(0, Math.sin((2 * Math.PI * (now % ORBIT_MS)) / ORBIT_MS));
        }
        return { ...SHAPES.light, centre };
      }
      case 'radiation': {
        if (facts?.radiation == null || !this.radiationUnit) return null;
        // The sources give one average, not its spread. The shown value moves by about one display step
        // every ten minutes and stays within a step or two of the centre (made up). Slow on purpose: the
        // store keeps every change of a unit it has no step for (core/persist.ts), as with mSv/day.
        const decimals = this.radiationUnit === 'uGy/day' ? 0 : 2;
        const resolution = 10 ** -decimals;
        return { unit: this.radiationUnit, centre: Number(facts.radiation.toFixed(decimals + 1)), step: 0.07 * resolution, pull: 0.001, decimals };
      }
      default: return null;
    }
  }
}

/** The signals the stand-in fills when it knows the place. Never CO2: the only CO2 is NASA's record. */
const PLACE_SIGNALS = ['pressure', 'temperature', 'humidity', 'oxygen', 'vibration', 'air_quality', 'noise', 'light', 'radiation'];
