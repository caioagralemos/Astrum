import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { profileOf, roomsOf, validateMission } from './mission.ts';
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
