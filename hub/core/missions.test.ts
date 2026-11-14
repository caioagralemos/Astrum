// The hub runs any mission file: its crew's day, the replayed air, the
// profile screens get, and the ship staying exactly what it was.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './db.ts';
import { Hub } from './server.ts';
import { SimulatedCrew } from './crew.ts';
import { NasaReplay, replayMoments } from './nasa.ts';
import { RoomAlarms } from './alarms.ts';
import { databaseFile, sensorsFile } from './paths.ts';
import { listMissions, loadMission, missionsRoute } from './missions.ts';
import { ScenarioPlayer, SCENARIO_ID, scenarioRoute } from './scenario.ts';
import { SHIP_PLACES, USUAL, crewPeriod, crewStays, placesOf, roomAt } from '../engine/crew.ts';
import { hubProfileOf, roomsOf } from '../engine/mission.ts';
import { windowAverage } from '../engine/cabin.ts';
import { occupants } from '../engine/timeline.ts';
import type { Profile, Row } from '../engine/types.ts';

const hubDir = new URL('..', import.meta.url).pathname;
const missionsDir = join(hubDir, 'profiles', 'missions');
const FILES = ['ship-mars-orbit', 'iss', 'base-mars', 'base-moon'];
const mission = (file: string) => loadMission(missionsDir, file);
const people = Object.keys(USUAL);
const DAY = 86_400_000;
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

test('the ship\'s simulated crew is byte for byte what it was before missions', () => {
  // Hashes of the generator's output before the schedule was written in roles (14 Nov), for the
  // same inputs: three days of history on the story's clock, six live hours, two days of stays.
  const start = Date.UTC(2026, 10, 12, 3, 30);
  const ship = placesOf(mission('ship-mars-orbit'));
  assert.deepEqual(ship, SHIP_PLACES, 'the ship file gives each crewmate the rooms the generator always had');
  for (const places of [ship, undefined]) {
    assert.equal(sha(crewPeriod(people, start - 3 * DAY, start, 300_000, -180, places)), 'aeb1d4c9c0ef856530e3920cb4ee9535ee97edf695c8725dd77833f900838051');
    assert.equal(sha(crewPeriod(people, start, start + 6 * 3600_000, 5000, 0, places)), '30b4ec4f9fef22d51ffb7d4b456bbbd25c95527b5c8618afc8902a08a5e26957');
    assert.equal(sha(crewStays(people, start - 2 * DAY, start, -180, places)), '975792ff532dcbc8529f6a9958e2d738a008b186b1ecd8bc64932f68160d8bbd');
  }
});

test('the day is in roles: own quarters, the first galley, the exercise module, the work room', () => {
  const iss = placesOf(mission('iss'));
  assert.deepEqual(iss.reyes, { quarters: 'harmony', work: 'tranquility', galley: 'unity', exercise: 'tranquility' }, 'Unity is the first galley; Zvezda is not picked');
  assert.equal(roomAt('leo', 12.5, iss), 'unity');
  assert.equal(roomAt('leo', 16, iss), 'tranquility', 'his exercise block');
  assert.equal(roomAt('leo', 10, iss), 'kibo');
  assert.equal(roomAt('leo', 2, iss), 'harmony');

  // The bases have no exercise module: that block is spent in the work room, and no exercise is reported.
  const base = placesOf(mission('base-mars'));
  assert.deepEqual(base.okafor, { quarters: 'quarters-3', work: 'medical', galley: 'commons', exercise: null });
  assert.equal(roomAt('okafor', 17.5, base), 'medical');
  const start = Date.UTC(2026, 10, 12, 3);
  const rows = crewPeriod(people, start, start + 3 * DAY, 300_000, -180, base).rows;
  assert.equal(rows.filter((r) => r.signal === 'exercise_minutes').length, 0, 'no exercise minutes where there is nowhere to exercise');
  const rooms = new Set(roomsOf(mission('base-mars')).map((r) => r.id));
  assert.ok(rows.every((r) => !r.room || rooms.has(r.room)), 'every row is in one of the base\'s rooms');
  assert.ok(Math.max(...rows.filter((r) => r.person === 'okafor' && r.signal === 'heart_rate').map((r) => r.value!)) < USUAL.okafor.heartRate + 25, 'no exercise rise without an exercise room');
  const issRows = crewPeriod(people, start, start + DAY, 300_000, -180, iss).rows;
  assert.deepEqual([...new Set(issRows.filter((r) => r.signal === 'exercise_minutes').map((r) => r.room))], ['tranquility']);
});

test('the NASA replay keeps the ship\'s mapping exactly, and gives every other mission\'s rooms a stretch by rule', () => {
  // The mapping the ship has always played (core/nasa.ts before missions).
  const SHIP: Record<string, string> = {
    'quarters-2': '2014-10-30T18:00:00Z', command: '2014-10-12T00:00:00Z', 'quarters-1': '2014-10-13T00:00:00Z', 'quarters-3': '2014-09-30T00:00:00Z',
    'quarters-4': '2014-10-01T00:00:00Z', lab: '2014-10-16T00:00:00Z', galley: '2014-10-02T00:00:00Z', gym: '2014-10-17T00:00:00Z',
  };
  const shipRooms = roomsOf(mission('ship-mars-orbit')).map((r) => r.id);
  const moments = replayMoments(shipRooms, 'quarters-2');
  assert.deepEqual(Object.fromEntries(Object.entries(moments).map(([room, t]) => [room, new Date(t).toISOString().replace('.000', '')])), SHIP);
  // The default subject is the ship's Quarters 2, as callers before missions expect.
  const replay = new NasaReplay({} as Hub, {} as Store, join(hubDir, 'data-nasa', 'osdr-rr1'), shipRooms);
  for (const [room, iso] of Object.entries(SHIP)) assert.equal(replay.recordTime(room, Date.UTC(2026, 10, 15)), Date.parse(iso));

  for (const file of FILES) {
    const m = mission(file);
    const rooms = roomsOf(m).map((r) => r.id);
    const subject = placesOf(m)[m.crew[0].id].quarters;
    const at = replayMoments(rooms, subject);
    assert.deepEqual(Object.keys(at).sort(), [...rooms].sort(), `${file}: every room plays something`);
    assert.equal(new Set(Object.values(at)).size, rooms.length, `${file}: no two rooms move in step`);
    assert.equal(at[subject], Date.parse(SHIP['quarters-2']), `${file}: the story's room keeps the story's stretch`);
  }
});

test('on every mission the replayed air stays calm over the demo days: no hour over NASA\'s limit, other rooms under 2.8', () => {
  // The days the stretches were chosen for: the anchor day (Sunday 15 Nov) and the three before it.
  const from = Date.UTC(2026, 10, 11, 23);
  const to = Date.UTC(2026, 10, 16);
  for (const file of FILES) {
    const m = mission(file);
    const rooms = roomsOf(m).map((r) => r.id);
    const subject = placesOf(m)[m.crew[0].id].quarters;
    const replay = new NasaReplay({} as Hub, {} as Store, join(hubDir, 'data-nasa', 'osdr-rr1'), rooms, subject);
    const rows: Row[] = [];
    for (let t = from; t <= to; t += 300_000) rows.push(...replay.at(t).filter((r) => r.signal === 'co2'));
    for (const room of rooms) {
      let max = 0;
      for (let t = from + 3600_000; t <= to; t += 300_000) max = Math.max(max, windowAverage(rows, room, 'co2', t, 3600_000)?.value ?? 0);
      assert.ok(max < 3, `${file} ${room}: highest 1-hour average ${max.toFixed(2)}`);
      if (room !== subject) assert.ok(max < 2.8, `${file} ${room}: a calm room, highest ${max.toFixed(2)}`);
    }
  }
});

test('each mission boots like the live hub: history filled, crew in its own rooms, no alarm', () => {
  const now = Date.UTC(2026, 10, 14, 18);
  for (const file of FILES) {
    const m = mission(file);
    const profile = hubProfileOf(m, file);
    const places = placesOf(m);
    const rooms = profile.rooms.map((r) => r.id);
    const store = new Store(':memory:');
    const hub = new Hub(store, profile, '/nonexistent');
    try {
      new SimulatedCrew(hub, store, profile.crew.map((p) => p.id), -180, places).catchUp(now);
      new NasaReplay(hub, store, join(hubDir, 'data-nasa', 'osdr-rr1'), rooms, places.reyes.quarters).catchUp(now);
      const alarms = new RoomAlarms(hub, store, rooms);
      alarms.check(now);
      assert.deepEqual(alarms.list(), [], `${file}: no alarm`);
      assert.deepEqual(alarms.unjudged, [], `${file}: every room judged`);
      const here = occupants(store.stays(now, now), now);
      const placed = Object.entries(here).flatMap(([room, who]) => who.map((p) => [p, room]));
      assert.equal(placed.length, 4, `${file}: everyone is somewhere`);
      assert.ok(placed.every(([, room]) => rooms.includes(room)), `${file}: in the mission's own rooms`);
      assert.ok(store.rows({ signal: 'heart_rate', limit: 1 }).length > 0);
      const state = hub.state(now);
      assert.ok(state.type === 'state' && state.profile.mission?.file === file);
    } finally {
      hub.http.close();
      store.close();
    }
  }
});

test('the profile screens get carries the mission\'s facts, and stays the old shape otherwise', () => {
  const ship = hubProfileOf(mission('ship-mars-orbit'), 'ship-mars-orbit');
  const old = JSON.parse(readFileSync(join(hubDir, 'profiles', 'mars-orbit.json'), 'utf8')) as Profile;
  const { mission: facts, ...rest } = ship;
  assert.deepEqual(rest, old, 'everything an older screen reads is unchanged');
  assert.deepEqual(facts, { id: 'mars-orbit', file: 'ship-mars-orbit', kind: 'ship', where: { body: 'mars', situation: 'orbit' }, gravity: 0, plannedDays: 900, simulationNote: 'mission.simulationNote.weightless', destination: 'place.mars-orbit.short' });
  const moon = hubProfileOf(mission('base-moon'), 'base-moon');
  assert.equal(moon.mission?.gravity, 0.166);
  assert.equal(moon.delayToEarthSeconds, 1.3);
  assert.deepEqual(moon.chips, { 'cabin-1': 'commons' }, 'the sensor board\'s room comes from the mission');
});

test('each mission keeps its own database and sensor list; the ship keeps the files it always had', () => {
  assert.equal(databaseFile('/d', 'ship-mars-orbit'), '/d/astrum-3.sqlite');
  assert.equal(databaseFile('/d', null), '/d/astrum-3.sqlite', 'an old profile file: as before');
  assert.equal(databaseFile('/d', 'iss'), '/d/astrum-3-iss.sqlite');
  assert.equal(sensorsFile('/d', 'base-moon'), '/d/sensors-base-moon.json');
  assert.equal(sensorsFile('/d'), '/d/sensors.json');
  assert.throws(() => loadMission(missionsDir, 'atlantis'), /no mission "atlantis"/);
  assert.throws(() => loadMission(missionsDir, '../mars-orbit'), /not a mission name/);
});

test('GET /api/missions lists every file and the one running; the story refuses to start off the ship', async () => {
  const profile = hubProfileOf(mission('iss'), 'iss');
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const player = new ScenarioPlayer({ hub, load: () => null });
  hub.routes.push(missionsRoute(missionsDir, 'iss'), scenarioRoute(player, false, 'iss'));
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  try {
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/missions`)).json()) as { running: string; missions: ReturnType<typeof listMissions> };
    assert.equal(body.running, 'iss');
    assert.deepEqual(body.missions.map((m) => [m.id, m.kind, m.gravity, m.delayToEarthSeconds, m.rooms, m.problems.length]), [
      ['base-mars', 'base', 0.38, 1200, 10, 0], ['base-moon', 'base', 0.166, 1.3, 10, 0], ['iss', 'station', 0, 1, 9, 0], ['ship-mars-orbit', 'ship', 0, 1200, 8, 0],
    ]);
    assert.equal(body.missions.find((m) => m.id === 'iss')?.name, 'place.iss');
    const start = await fetch(`http://127.0.0.1:${port}/api/scenario/start`, { method: 'POST', body: JSON.stringify({ id: SCENARIO_ID }) });
    assert.equal(start.status, 409);
    assert.match(((await start.json()) as { error: string }).error, /happens on the ship.*ASTRUM_MISSION=ship-mars-orbit/);
    assert.equal(player.status().playing, null);
  } finally {
    hub.http.closeAllConnections();
    hub.http.close();
    store.close();
  }
});
