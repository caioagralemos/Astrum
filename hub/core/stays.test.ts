// Room location from a phone (phone/Astrum/RoomLocator.swift): the board's
// Bluetooth state in its status, measured stays posted with their true times,
// leaving a room for nowhere known, and a measured place winning over the
// simulated crew's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from './db.ts';
import { Hub, MEASURED_HOLD_MS } from './server.ts';
import { parseChipLine } from './chip.ts';
import { SimulatedCrew } from './crew.ts';
import type { Profile, Stay } from '../engine/types.ts';

const profile = JSON.parse(readFileSync(new URL('../profiles/mars-orbit.json', import.meta.url), 'utf8')) as Profile;
const PHONE = 'phone:reyes:ble';

test('the chip line carries the board\'s Bluetooth state when the firmware sends it', () => {
  const roomOf = () => 'galley';
  assert.equal(parseChipLine('{"chip":"cabin-1","fw":"0.3","ble":"on","r":[],"missing":[]}', 0, roomOf)!.ble, 'on');
  assert.equal(parseChipLine('{"chip":"cabin-1","fw":"0.3","ble":"off","r":[],"missing":[]}', 0, roomOf)!.ble, 'off');
  assert.equal(parseChipLine('{"chip":"cabin-1","fw":"0.2","r":[],"missing":[]}', 0, roomOf)!.ble, undefined, 'older firmware says nothing, and nothing is assumed');
  assert.equal(parseChipLine('{"chip":"cabin-1","ble":"maybe","r":[]}', 0, roomOf)!.ble, undefined);
});

async function withHub(run: (post: (body: unknown) => Promise<Response>, store: Store, hub: Hub) => Promise<void>): Promise<void> {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  const post = (body: unknown) => fetch(`http://127.0.0.1:${port}/api/stays`, { method: 'POST', body: JSON.stringify(body) });
  try {
    await run(post, store, hub);
  } finally {
    hub.http.closeAllConnections();
    hub.http.close();
    store.close();
  }
}

test('a phone posts entering and leaving a board\'s room with the times they happened', async () => {
  await withHub(async (post, store) => {
    const now = Date.now();
    const entered = now - 20 * 60_000;
    const left = now - 5 * 60_000;
    assert.equal((await post({ person: 'reyes', room: 'galley', t: entered, kind: 'measured', source: PHONE })).status, 200);
    assert.equal((await post({ person: 'reyes', room: null, t: left, kind: 'measured', source: PHONE })).status, 200);
    const stays = store.stays(0, now, 'reyes');
    assert.deepEqual(stays.map((s) => [s.room, s.from, s.until, s.kind, s.source]), [['galley', entered, left, 'measured', PHONE]]);
    assert.equal(store.stays(now, now, 'reyes').length, 0, 'after leaving, the hub does not know where she is');
  });
});

test('a stay time in the future, or older than the person\'s current stay, is refused', async () => {
  await withHub(async (post, store) => {
    const now = Date.now();
    assert.equal((await post({ person: 'reyes', room: 'galley', t: now + 3600_000, kind: 'measured', source: PHONE })).status, 400);
    assert.equal((await post({ person: 'reyes', room: 'galley', t: Number.NaN, kind: 'measured', source: PHONE })).status, 400);
    assert.equal((await post({ person: 'reyes', room: 'galley', t: now - 60_000, kind: 'measured', source: PHONE })).status, 200);
    assert.equal((await post({ person: 'reyes', room: 'lab', t: now - 120_000, kind: 'measured', source: PHONE })).status, 409);
    assert.equal(store.stays(now, now, 'reyes')[0].room, 'galley');
  });
});

test('leaving only ends the stay the same source opened', async () => {
  await withHub(async (post, store) => {
    const now = Date.now();
    assert.equal((await post({ person: 'reyes', room: 'lab', t: now - 60_000, kind: 'simulated', source: 'sim:crew' })).status, 200);
    assert.equal((await post({ person: 'reyes', room: null, t: now - 1000, kind: 'measured', source: PHONE })).status, 200);
    assert.equal(store.stays(now, now, 'reyes')[0]?.room, 'lab', 'the phone never put her in the lab, so it cannot take her out');
  });
});

test('a measured stay wins over the simulated crew for that person, and only that person', () => {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const people = profile.crew.map((p) => p.id);
  const start = Date.UTC(2026, 10, 14, 6);
  const crew = new SimulatedCrew(hub, store, people, 0);
  crew.catchUp(start);
  const simRoom = store.stays(start, start, 'reyes')[0].room;

  // Measured in the room the simulation already has her in: the label changes to Measured.
  hub.move('reyes', simRoom, start + 1000, 'measured', PHONE);
  const here = (t: number): Stay => store.stays(t, t, 'reyes').find((s) => s.until === null)!;
  assert.deepEqual([here(start + 1000).room, here(start + 1000).kind], [simRoom, 'measured']);

  // A whole simulated day goes by: everyone else moves, she stays where she was measured.
  const before = Object.fromEntries(people.map((p) => [p, store.stays(start, start, p).length]));
  crew.step(start + 24 * 3600_000, 5 * 60_000);
  const end = start + 24 * 3600_000;
  assert.deepEqual([here(end).room, here(end).kind, here(end).source], [simRoom, 'measured', PHONE]);
  assert.equal(store.stays(start, end, 'reyes').filter((s) => s.kind === 'simulated' && s.from > start).length, 0);
  for (const other of people.filter((p) => p !== 'reyes')) assert.ok(store.stays(start, end, other).length > before[other], `${other} still moves`);

  // She leaves: her place is unknown, and the simulation leaves it unknown for the hold.
  hub.leave('reyes', end, PHONE);
  crew.step(end + MEASURED_HOLD_MS - 60_000, 5 * 60_000);
  assert.equal(store.stays(end + MEASURED_HOLD_MS - 60_000, end + MEASURED_HOLD_MS - 60_000, 'reyes').length, 0);
  // After the hold, demo mode may fill it again (labelled Simulated).
  crew.step(end + 24 * 3600_000, 5 * 60_000);
  const later = store.stays(end + 24 * 3600_000, end + 24 * 3600_000, 'reyes').filter((s) => s.until === null);
  assert.ok(later.length === 1 && later[0].kind === 'simulated');
  store.close();
});
