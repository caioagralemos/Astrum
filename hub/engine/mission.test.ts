import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { missionDayOf, profileOf, roomsOf, validateMission } from './mission.ts';
import { pickStart, START_MARGIN_DAYS } from './names.ts';
import type { Mission } from './mission.ts';
import { hasString } from './strings.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const FILES = ['ship-mars-orbit', 'iss', 'base-mars', 'base-moon'];

for (const name of FILES) {
  test(`${name}.json is a valid mission`, () => {
    assert.deepEqual(validateMission(read(`../profiles/missions/${name}.json`)), []);
  });

  test(`${name}.json names everything through the string table`, () => {
    const mission = read(`../profiles/missions/${name}.json`) as Mission;
    const keys = [mission.name, `${mission.name}.short`, ...mission.modules.map((m) => m.name), ...mission.modules.flatMap((m) => m.cabins?.map((c) => c.name) ?? []), ...mission.crew.map((p) => p.role)];
    assert.deepEqual(keys.filter((key) => !hasString(key)), []);
  });
}

test('the ship mission is exactly the hub\'s current profile', () => {
  const ship = read('../profiles/missions/ship-mars-orbit.json') as Mission;
  const profile = read('../profiles/mars-orbit.json');
  assert.deepEqual(roomsOf(ship), profile.rooms);
  assert.deepEqual(profileOf(ship), profile);
});

test('the Moon and Mars bases differ only in body, gravity, delay and name', () => {
  const mars = read('../profiles/missions/base-mars.json') as Mission;
  const moon = read('../profiles/missions/base-moon.json') as Mission;
  const strip = ({ id: _i, name: _n, where, gravity: _g, delayToEarthSeconds: _d, ...rest }: Mission) => ({ ...rest, situation: where.situation });
  assert.deepEqual(strip(moon), strip(mars));
  assert.equal(mars.gravity, 0.38);
  assert.equal(moon.gravity, 0.166);
});

test('problems come back in words, never as a throw', () => {
  assert.deepEqual(validateMission(null), ['The mission is not an object.']);
  const ship = read('../profiles/missions/ship-mars-orbit.json');
  ship.crew[0].quarters = 'attic';
  ship.modules[1].shape.length = -1;
  ship.kind = 'submarine';
  const problems = validateMission(ship);
  assert.ok(problems.some((p) => p.includes('"attic", which is not a room')));
  assert.ok(problems.some((p) => p.includes('length and radius above 0')));
  assert.ok(problems.some((p) => p.includes('ship, station or base')));
  assert.doesNotThrow(() => validateMission({ modules: [null, 3], crew: 'x', chips: [] }));
});

test('the mission day turns at midnight on the station clock, not at midnight UTC', () => {
  const start = '2026-04-18T00:00:00Z';
  const recife = -180;
  // 14 November 2026, 23:05 in Recife is already the 15th in UTC.
  const lateEvening = Date.parse('2026-11-15T02:05:00Z');
  assert.equal(missionDayOf(start, lateEvening, recife), 211);
  assert.equal(missionDayOf(start, lateEvening, 0), 212, 'on UTC it would turn three hours early');
  // One minute either side of local midnight.
  assert.equal(missionDayOf(start, Date.parse('2026-11-15T02:59:00Z'), recife), 211);
  assert.equal(missionDayOf(start, Date.parse('2026-11-15T03:01:00Z'), recife), 212);
  assert.equal(missionDayOf(start, Date.parse('2026-11-16T03:01:00Z'), recife), 213, 'and 213 the next night');
  assert.equal(missionDayOf(start, Date.parse('2026-04-18T03:00:00Z'), recife), 1, 'the start date is day 1');
});

test('a random start for the example crew: repeatable, today inside the plan, never in the future', () => {
  const now = Date.parse('2026-11-15T02:05:00Z');
  for (const file of ['ship-mars-orbit', 'iss', 'base-mars', 'base-moon']) {
    const m = JSON.parse(readFileSync(new URL(`../profiles/missions/${file}.json`, import.meta.url), 'utf8')) as Mission;
    const days = new Set<number>();
    for (let seed = 0; seed < 300; seed++) {
      const start = pickStart(m.plannedDays, now, -180, `${file}:${seed}`);
      assert.equal(start, pickStart(m.plannedDays, now, -180, `${file}:${seed}`), 'same seed, same date');
      const day = missionDayOf(start, now, -180);
      assert.ok(day >= START_MARGIN_DAYS && day <= m.plannedDays - START_MARGIN_DAYS, `${file}: day ${day} of ${m.plannedDays}`);
      assert.ok(Date.parse(start) <= now);
      days.add(day);
    }
    assert.ok(days.size > 50, 'spread over the plan');
  }
  assert.equal(missionDayOf(pickStart(10, now, 0, 1), now, 0) <= 10, true, 'a short plan: any day of it');
});
