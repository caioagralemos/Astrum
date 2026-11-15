// The first-run setup: a valid setup is saved over its place and the hub's
// profile carries it; bad input and anything but one medical officer are refused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupRoute, setupDone, markFreshInstall, setupFile } from './setup.ts';
import { loadAnyMission } from './missions.ts';
import { chosenMissionFile, customMissionsDir } from './paths.ts';
import { hubProfileOf } from '../engine/mission.ts';

const missionsDir = join(new URL('..', import.meta.url).pathname, 'profiles', 'missions');

async function withRoute(fn: (post: (body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>, dataDir: string) => Promise<void>) {
  const dataDir = mkdtempSync(join(tmpdir(), 'astrum-setup-'));
  const route = setupRoute({ dir: missionsDir, customDir: customMissionsDir(dataDir), dataDir });
  const server = createServer((req, res) => { void route(req, res, new URL(req.url ?? '/', 'http://x')).then((done) => { if (!done) res.writeHead(404).end(); }); });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const post = async (body: unknown) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() as Record<string, unknown> };
  };
  try { await fn(post, dataDir); } finally { server.close(); }
}

/** Today on the hub's clock, as the route counts it. */
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const DAY = 86_400_000;

const valid = () => ({
  place: 'base-mars', name: 'Ares Base', missionStart: today(), plannedDays: 500,
  crew: [
    { name: 'Ali', role: 'role.cmo', pronoun: 'he', portrait: 'crew/crew-2.jpg', medicalOfficer: true },
    { name: 'Luca', role: 'role.engineer', pronoun: 'he' },
    { name: 'Julie', role: 'role.commander', pronoun: 'she', portrait: 'crew/crew-5.jpg', medicalOfficer: false },
  ],
});

test('a valid setup is saved over its place, chosen, and the profile carries it', async () => {
  await withRoute(async (post, dataDir) => {
    const r = await post(valid());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(JSON.parse(readFileSync(chosenMissionFile(dataDir), 'utf8')).id, 'base-mars');
    assert.equal(setupDone(dataDir), true);
    const mission = loadAnyMission(missionsDir, customMissionsDir(dataDir), 'base-mars');
    const profile = hubProfileOf(mission, 'base-mars');
    assert.equal(profile.mission?.nameText, 'Ares Base');
    assert.equal(profile.mission?.plannedDays, 500);
    assert.equal(profile.mission?.gravity, 0.38);
    assert.equal(profile.missionStart.slice(0, 10), today());
    assert.deepEqual(profile.crew.map((p) => [p.name, p.role, p.pronoun, p.portrait ?? null, p.medicalOfficer ?? false]), [
      ['Ali', 'role.cmo', 'he', 'crew/crew-2.jpg', true],
      ['Luca', 'role.engineer', 'he', null, false],
      ['Julie', 'role.commander', 'she', 'crew/crew-5.jpg', false],
    ]);
  });
});

test('a trip puts the ship in transit, weightless', async () => {
  await withRoute(async (post, dataDir) => {
    const r = await post({ ...valid(), place: 'ship-mars-orbit', name: 'Ares transit', plannedDays: 300 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = loadAnyMission(missionsDir, customMissionsDir(dataDir), 'ship-mars-orbit');
    assert.equal(m.where.situation, 'transit');
    assert.equal(m.gravity, 0);
    assert.equal(m.plannedDays, 300);
  });
});

test('bad input is refused and nothing is written', async () => {
  await withRoute(async (post, dataDir) => {
    for (const bad of [
      null, 'x', { ...valid(), place: 'jupiter' }, { ...valid(), plannedDays: 5 }, { ...valid(), missionStart: 'soon' },
      { ...valid(), name: '' }, { ...valid(), crew: [] },
      { ...valid(), crew: [{ ...valid().crew[0], portrait: '../../etc/passwd' }] },
      { ...valid(), crew: [{ ...valid().crew[0], role: 'role.pilot' }] },
      { ...valid(), chips: { 'cabin-1': 'nowhere' } },
    ]) {
      const r = await post(bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal(existsSync(chosenMissionFile(dataDir)), false);
  });
});

test('exactly one medical officer', async () => {
  await withRoute(async (post) => {
    const none = valid(); none.crew[0].medicalOfficer = false;
    const two = valid(); two.crew[2].medicalOfficer = true;
    for (const crew of [none, two]) {
      const r = await post(crew);
      assert.equal(r.status, 400);
      assert.ok((r.body.problems as string[]).some((p) => p.includes('medical officer')));
    }
  });
});

test('only an empty data folder starts with the setup to do', () => {
  const fresh = mkdtempSync(join(tmpdir(), 'astrum-setup-'));
  markFreshInstall(fresh);
  assert.equal(setupDone(fresh), false);
  const existing = mkdtempSync(join(tmpdir(), 'astrum-setup-'));
  writeFileSync(join(existing, 'mission.json'), '{"id":"iss"}');
  markFreshInstall(existing);
  assert.equal(existsSync(setupFile(existing)), false);
  assert.equal(setupDone(existing), true);
});

test('an own photo is kept in the data folder, served under crew/custom, and becomes the portrait; anything else is refused', async () => {
  // The smallest real JPEG header plus filler: enough for the type check.
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
  await withRoute(async (post, dataDir) => {
    const setup = valid();
    (setup.crew[1] as Record<string, unknown>).photo = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    const r = await post(setup);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const luca = loadAnyMission(missionsDir, customMissionsDir(dataDir), 'base-mars').crew[1];
    assert.match(luca.portrait ?? '', /^crew\/custom\/[a-z0-9-]+\.jpg$/);
    assert.deepEqual(readFileSync(join(dataDir, 'crew-photos', luca.portrait!.slice('crew/custom/'.length))), jpeg);
    for (const photo of [
      `data:image/png;base64,${jpeg.toString('base64')}`, // says PNG, is a JPEG
      `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
      `data:image/jpeg;base64,${Buffer.concat([jpeg, Buffer.alloc(5 * 1024 * 1024)]).toString('base64')}`,
    ]) {
      const bad = valid();
      (bad.crew[0] as Record<string, unknown>).photo = photo;
      assert.equal((await post(bad)).status, 400);
    }
  });
});

test('every crewmate carries a portrait, and their own photo wins over the default', async () => {
  const { withPortraits } = await import('../engine/portraits.ts');
  for (const file of ['ship-mars-orbit', 'iss', 'base-mars', 'base-moon']) {
    const crew = withPortraits(hubProfileOf(loadAnyMission(missionsDir, null, file), file).crew);
    assert.ok(crew.every((p) => /^crew\/crew-[1-6]\.jpg$/.test(p.portrait ?? '')), file);
  }
  const own = withPortraits([{ id: 'a', name: 'Ali', pronouns: 'he' as const, portrait: 'crew/custom/a.jpg' }, { id: 'b', name: 'Zed' }]);
  assert.equal(own[0].portrait, 'crew/custom/a.jpg');
  assert.match(own[1].portrait ?? '', /^crew\/crew-\d\.jpg$/);
  // The running hub lays these over its profile once at start (core/main.ts), so its state carries them.
});

test('a trip goes to the Moon or Mars: the destination, its delay to Earth and the transit sky follow', async () => {
  const { destinationBody } = await import('../engine/mission.ts');
  await withRoute(async (post, dataDir) => {
    const r = await post({ ...valid(), place: 'ship-mars-orbit', name: 'Lunar hop', missionStart: today(), plannedDays: 3, destination: 'moon' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = loadAnyMission(missionsDir, customMissionsDir(dataDir), 'ship-mars-orbit');
    assert.equal(m.where.situation, 'transit');
    assert.equal(m.delayToEarthSeconds, 1.3);
    assert.equal(destinationBody(m.destination), 'moon');
    assert.equal(hubProfileOf(m, 'ship-mars-orbit').mission?.destination, 'place.moon-orbit.short');
    const back = await post({ ...valid(), place: 'ship-mars-orbit', plannedDays: 300, destination: 'mars' });
    assert.equal(back.status, 200);
    const mars = loadAnyMission(missionsDir, customMissionsDir(dataDir), 'ship-mars-orbit');
    assert.equal(destinationBody(mars.destination), 'mars');
    assert.equal(mars.delayToEarthSeconds, loadAnyMission(missionsDir, null, 'ship-mars-orbit').delayToEarthSeconds);
    assert.equal((await post({ ...valid(), destination: 'moon' })).status, 400, 'a base has no destination');
    assert.equal((await post({ ...valid(), place: 'ship-mars-orbit', destination: 'jupiter' })).status, 400);
  });
  assert.equal(destinationBody(undefined), 'mars');
});

test('today must fall inside the stay: a stay that ended, or one that starts later, is refused in plain words', async () => {
  await withRoute(async (post) => {
    const ended = await post({ ...valid(), place: 'iss', plannedDays: 30, missionStart: new Date(Date.now() - 40 * DAY).toISOString().slice(0, 10) });
    assert.equal(ended.status, 400);
    assert.ok((ended.body.problems as string[]).some((p) => p.startsWith("Today can't be after the last day.")));
    const later = await post({ ...valid(), missionStart: new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10) });
    assert.equal(later.status, 400);
    assert.ok((later.body.problems as string[]).includes("The mission can't start after today."));
    assert.equal((await post({ ...valid(), missionStart: today(), plannedDays: 30 })).status, 200, 'day 1 of 30 is fine');
  });
});
