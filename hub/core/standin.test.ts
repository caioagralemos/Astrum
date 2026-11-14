import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './db.ts';
import { Hub, STAND_IN } from './server.ts';
import { StandIn, radiationOf } from './standin.ts';
import { SimulatedCrew } from './crew.ts';
import { NasaReplay, NASA_SOURCE } from './nasa.ts';
import { RoomAlarms } from './alarms.ts';
import { DEMO_EVERY_MS } from './persist.ts';
import { hubProfileOf, mainRoom, validateMission } from '../engine/mission.ts';
import type { Mission } from '../engine/mission.ts';
import { USUAL, placesOf } from '../engine/crew.ts';
import { occupants } from '../engine/timeline.ts';
import { impossible } from '../engine/quality.ts';
import type { Row } from '../engine/types.ts';

const hubDir = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const mission = (file: string) => JSON.parse(readFileSync(join(hubDir, 'profiles', 'missions', `${file}.json`), 'utf8')) as Mission;
const FILES = ['ship-mars-orbit', 'iss', 'base-mars', 'base-moon'];
const MAIN: Record<string, string> = { 'ship-mars-orbit': 'galley', iss: 'unity', 'base-mars': 'commons', 'base-moon': 'commons' };
const ROOM_SIGNALS = ['co2', 'temperature', 'humidity', 'pressure', 'oxygen', 'noise', 'light', 'vibration', 'radiation', 'air_quality'];
const FROM_NASA = ['co2', 'temperature', 'humidity'];
/** Mir 19's per-room rates, uGy/day, and their spread around their mean (the pattern other places reuse). */
const MIR = [352.5, 414.0, 261.0, 292.8, 279.0, 336.0];
const MIR_MEAN = MIR.reduce((a, b) => a + b) / MIR.length;
const EXPECTED_RADIATION: Record<string, { unit: string; centre: number | null }> = {
  'ship-mars-orbit': { unit: 'mSv/day', centre: 1.8 },
  iss: { unit: 'uGy/day', centre: null },
  'base-mars': { unit: 'mSv/day', centre: 0.67 },
  'base-moon': { unit: 'mSv/day', centre: 1 },
};

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const HOUR = 3600_000;
const START = Date.UTC(2026, 10, 15, 0);
const STEP = 10_000;

/** One simulated day of a mission's demo hub in memory, every 10 seconds. */
function runDay(file: string) {
  const m = mission(file);
  const profile = hubProfileOf(m, file);
  const rooms = profile.rooms.map((r) => r.id);
  const places = placesOf(m);
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const crew = new SimulatedCrew(hub, store, profile.crew.map((p) => p.id), 0, places);
  const nasa = new NasaReplay(hub, store, join(hubDir, 'data-nasa', 'osdr-rr1'), rooms, places.reyes.quarters);
  const standIn = new StandIn(hub, rooms, seeded(42), { mission: m, stays: store, offsetMinutes: 0 });
  const alarms = new RoomAlarms(hub, store, rooms);
  crew.catchUp(START);
  nasa.catchUp(START);
  const sent: Row[] = [];
  /** Who was in each room at each step. */
  const people: Record<number, Record<string, string[]>> = {};
  let alarmCount = 0;
  for (let t = START + STEP; t <= START + 24 * HOUR; t += STEP) {
    hub.ingest(nasa.at(t));
    crew.step(t, STEP);
    people[t] = occupants(store.stays(t, t), t);
    sent.push(...hub.ingest(standIn.tick(t)));
    if (t % HOUR === 0) { alarms.check(t); alarmCount += alarms.list().length; }
  }
  return { m, profile, rooms, store, hub, sent, people, alarmCount, end: START + 24 * HOUR, close: () => { store.close(); hub.http.close(); } };
}

const hourOf = (t: number) => ((t % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR) / HOUR;
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

for (const file of FILES) {
  test(`${file}: a demo day gives every room every signal, labelled, suited to the place, with no alarm`, () => {
    const day = runDay(file);
    try {
      const { m, rooms, sent } = day;
      // The chip sits in the main cabin.
      assert.equal(mainRoom(m), MAIN[file]);
      assert.deepEqual(Object.values(m.chips), [MAIN[file]]);
      assert.deepEqual(validateMission(m), []);

      // Every room has every signal, from the right source and with the right label.
      const state = day.hub.state(day.end);
      if (state.type !== 'state') throw new Error('not a state message');
      for (const room of rooms) {
        for (const signal of ROOM_SIGNALS) {
          const rows: Row[] = state.latest.filter((r) => r.room === room && !r.person && r.signal === signal);
          assert.ok(rows.length > 0, `${file} ${room}: ${signal} is shown`);
          if (FROM_NASA.includes(signal)) assert.ok(rows.every((r) => r.kind === 'replayed' && r.source === NASA_SOURCE), `${file} ${room} ${signal}: NASA's replay, not the stand-in`);
          else assert.ok(rows.every((r) => r.kind === 'simulated' && r.source === STAND_IN), `${file} ${room} ${signal}: labelled simulated`);
        }
      }
      assert.ok(!sent.some((r) => r.signal === 'co2'), 'the stand-in never makes CO2 on a mission');
      assert.ok(sent.every((r) => r.kind === 'simulated' && r.source === STAND_IN && impossible(r) === null));

      // Radiation: the unit and centre of the place's documented source.
      const expected = EXPECTED_RADIATION[file];
      assert.deepEqual(radiationOf(m), { unit: expected.unit, base: expected.centre });
      const radiation = sent.filter((r) => r.signal === 'radiation');
      assert.ok(radiation.every((r) => r.unit === expected.unit), `${file}: radiation in ${expected.unit}`);
      for (const room of rooms) {
        const avg = mean(radiation.filter((r) => r.room === room).map((r) => r.value!));
        const [lo, hi] = expected.centre === null ? [Math.min(...MIR), Math.max(...MIR)] : [expected.centre * Math.min(...MIR) / MIR_MEAN, expected.centre * Math.max(...MIR) / MIR_MEAN];
        assert.ok(avg >= lo * 0.97 && avg <= hi * 1.03, `${file} ${room}: radiation ${avg.toFixed(3)} within ${lo.toFixed(3)} to ${hi.toFixed(3)}`);
      }

      // Pressure and oxygen: a sea-level cabin, the same in every place.
      assert.ok(Math.abs(mean(sent.filter((r) => r.signal === 'pressure').map((r) => r.value!)) - 1013.25) < 0.5);
      assert.ok(Math.abs(mean(sent.filter((r) => r.signal === 'oxygen').map((r) => r.value!)) - 159.2) < 0.5);

      // Lights are down at night in the quarters, and up by day.
      const quarters = m.crew.map((p) => p.quarters);
      const light = (from: number, to: number) => mean(sent.filter((r) => r.signal === 'light' && quarters.includes(r.room!) && hourOf(r.t) >= from && hourOf(r.t) < to).map((r) => r.value!));
      assert.ok(light(1, 5) < 100 && light(9, 11) > 1000, `${file}: quarters ${light(1, 5).toFixed(0)} at night, ${light(9, 11).toFixed(0)} by day`);

      // The exercise room is louder while someone exercises in it (on the ISS one crewmate also works there).
      const gym = m.modules.find((x) => x.template === 'exercise' && x.isRoom)?.id;
      if (gym) {
        const noise = sent.filter((r) => r.signal === 'noise' && r.room === gym);
        const exercising = (t: number) => (day.people[t]?.[gym] ?? []).some((p) => hourOf(t) >= USUAL[p].gymHour && hourOf(t) < USUAL[p].gymHour + 1.5);
        const busy = noise.filter((r) => exercising(r.t)).map((r) => r.value!);
        const working = noise.filter((r) => !exercising(r.t) && (day.people[r.t]?.[gym]?.length ?? 0) > 0).map((r) => r.value!);
        if (working.length) assert.ok(mean(working) < mean(busy) - 500, `${file}: working in the gym is not exercising`);
        const empty = noise.filter((r) => !(day.people[r.t]?.[gym]?.length)).map((r) => r.value!);
        assert.ok(busy.length > 100 && mean(busy) > mean(empty) + 500, `${file}: exercise noise ${mean(busy).toFixed(0)} busy, ${mean(empty).toFixed(0)} empty`);
      } else assert.equal(file.startsWith('base'), true, 'only the bases have no exercise room');

      // A surface base vibrates less than a spacecraft at rest.
      const still = mean(sent.filter((r) => r.signal === 'vibration' && quarters.includes(r.room!)).map((r) => r.value!));
      assert.ok(m.where.situation === 'surface' ? still < 0.0015 : still > 0.0015, `${file}: vibration ${still.toFixed(4)} g`);

      // Every signal wiggles: no value is held for the whole day. Not air quality: a 1-to-5 index
      // that reads 1 in clean air for days, as it always has here.
      for (const room of rooms) {
        for (const signal of ROOM_SIGNALS.filter((s) => !FROM_NASA.includes(s) && s !== 'air_quality')) {
          const values = new Set(sent.filter((r) => r.room === room && r.signal === signal).map((r) => r.value));
          assert.ok(values.size > 1, `${file} ${room} ${signal} moves`);
        }
      }

      assert.equal(day.alarmCount, 0, `${file}: no alarm fires`);
    } finally {
      day.close();
    }
  });
}

test('an hour of a mission\'s stand-in writes about one row a minute per series', () => {
  for (const file of FILES) {
    const m = mission(file);
    const profile = hubProfileOf(m, file);
    const rooms = profile.rooms.map((r) => r.id);
    const store = new Store(':memory:');
    const hub = new Hub(store, profile, '/nonexistent');
    try {
      const standIn = new StandIn(hub, rooms, seeded(9), { mission: m, offsetMinutes: 0 });
      // From 05:30 to 06:30: the lights come up at 06:00, the busiest hour for steps.
      const start = START + 5.5 * HOUR;
      let sent = 0;
      for (let s = 0; s < 3600; s++) sent += hub.ingest(standIn.tick(start + s * 1000)).length;
      const series = standIn.tick(start + HOUR).length;
      const written = store.rows({ limit: 100_000 }).length;
      const allowed = series * (HOUR / DEMO_EVERY_MS) * 1.25;
      assert.equal(sent, series * 3600, 'every row is still sent live');
      assert.ok(written <= allowed, `${file}: ${written} rows written for ${series} series (allowed ${allowed.toFixed(0)})`);
    } finally {
      store.close();
      hub.http.close();
    }
  }
});

test('the chip\'s values win in its room; the stand-in fills only what the chip does not measure', () => {
  const m = mission('base-mars');
  const profile = hubProfileOf(m, 'base-mars');
  const rooms = profile.rooms.map((r) => r.id);
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  try {
    const standIn = new StandIn(hub, rooms, seeded(3), { mission: m, offsetMinutes: 0 });
    const room = mainRoom(m)!;
    const t = START + 12 * HOUR;
    const chip = ['pressure', 'temperature', 'humidity', 'noise', 'light', 'vibration'].map((signal): Row => ({ t, signal, value: 1, unit: signal === 'pressure' ? 'hPa' : 'raw', kind: 'measured', source: 'chip:cabin-1', room }));
    hub.ingest(chip);
    const mine = standIn.tick(t + 1000).filter((r) => r.room === room).map((r) => r.signal).sort();
    assert.deepEqual(mine, ['air_quality', 'oxygen', 'radiation'], 'only what the chip has no part for');
    assert.ok(standIn.tick(t + 1000).some((r) => r.room !== room && r.signal === 'pressure'), 'other rooms still get the stand-in');
  } finally {
    store.close();
    hub.http.close();
  }
});

test('a mission names what its simulated crew is centred on, in both languages', async () => {
  const { t } = await import('../engine/strings.ts');
  for (const file of FILES) {
    const note = hubProfileOf(mission(file), file).mission as { simulationNote?: string } | undefined;
    const key = file.startsWith('base') ? 'mission.simulationNote.gravity' : 'mission.simulationNote.weightless';
    assert.equal(note?.simulationNote, key);
    assert.notEqual(t(key, 'en'), key);
    assert.notEqual(t(key, 'pt'), key);
  }
});

test('a sensor board must sit in a room people are in', () => {
  const m = mission('iss');
  assert.ok(validateMission({ ...m, chips: { 'cabin-1': 'z1' } }).some((p) => p.includes('a module people are not in')));
  const ship = mission('ship-mars-orbit');
  assert.ok(validateMission({ ...ship, chips: { 'cabin-1': 'quarters' } }).some((p) => p.includes('split into cabins')));
  assert.deepEqual(validateMission({ ...ship, chips: { 'cabin-1': 'quarters-1' } }), []);
  assert.equal(mainRoom({ ...ship, chips: {} }), 'galley', 'no board: the first galley');
});
