// Editing a built-in place in place: the override in the data folder, merged
// over the built-in file, checked as a whole; Reset to default; the restart
// when the running place is saved; and the crew's first names on a first start.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { hasEdits, loadAnyMission, loadMission, missionsRoute, nameCrewOnce, overrideFile, overrideOf, overrideProblems, readOverride, withOverride } from './missions.ts';
import type { MissionOverride, MissionsOptions } from './missions.ts';
import { overridesDir } from './paths.ts';
import { changesOf } from '../engine/custom.ts';
import type { MissionChanges } from '../engine/custom.ts';
import { validateMission } from '../engine/mission.ts';
import { ASTRONAUT_FIRST_NAMES } from '../engine/names.ts';

const hubDir = new URL('..', import.meta.url).pathname;
const builtIn = join(hubDir, 'profiles', 'missions');
const temp = () => mkdtempSync(join(tmpdir(), 'astrum-override-'));
const builtInHash = () => readdirSync(builtIn).sort().map((f) => `${f}:${createHash('sha256').update(readFileSync(join(builtIn, f))).digest('hex')}`).join('\n');
const BEFORE = builtInHash();

interface Setup { url: string; data: string; customDir: string; restarts: string[]; close: () => Promise<void> }

async function serve(opts: Partial<MissionsOptions> & { running?: string } = {}): Promise<Setup> {
  const data = temp();
  const customDir = join(data, 'missions');
  const restarts: string[] = [];
  const route = missionsRoute(builtIn, opts.running ?? 'iss', null, {
    customDir, dataDir: data, supervised: true, restart: (to) => restarts.push(to), locked: null, ...opts,
  });
  const server: Server = createServer((req, res) => void route(req, res, new URL(req.url ?? '/', 'http://hub')).then((handled) => { if (!handled) res.writeHead(404).end(); }));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`, data, customDir, restarts,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      rmSync(data, { recursive: true, force: true });
    },
  };
}

const call = async (url: string, method = 'GET', body?: unknown) => {
  const res = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const settle = () => new Promise((r) => setTimeout(r, 20));

test('an override holds only what changed, merges over the built-in file, and is checked as a whole', () => {
  const iss = loadMission(builtIn, 'iss');
  const edited = { ...iss, delayToEarthSeconds: 1, plannedDays: 200, crew: iss.crew.map((p) => (p.id === 'leo' ? { ...p, name: 'Koichi' } : p)) };
  const o = overrideOf(iss, edited, undefined, []);
  assert.deepEqual(Object.keys(o).sort(), ['crew', 'plannedDays'], 'unchanged fields are left out');
  const merged = withOverride(iss, o);
  assert.deepEqual(validateMission(merged), []);
  assert.equal(merged.plannedDays, 200);
  assert.equal(merged.crew.find((p) => p.id === 'leo')?.name, 'Koichi');
  assert.deepEqual(merged.modules, iss.modules, 'the modules are always the built-in file\'s');
  assert.equal(merged.basedOn, undefined, 'still a built-in place, not a crew-made one');
  assert.deepEqual(overrideProblems(iss, o), []);
  assert.equal(hasEdits(o), true);
  assert.equal(hasEdits({ firstNames: { leo: 'Koichi' } }), false, 'first names alone are not an edit');

  // The editor's rules and the hub's both apply.
  assert.match(overrideProblems(iss, { delayToEarthSeconds: 600 }).join(' '), /delay is 1 s/);
  assert.match(overrideProblems(iss, { crew: [{ ...iss.crew[0], quarters: 'zarya' }] }).join(' '), /not a room/);
  assert.match(overrideProblems(iss, { crew: [] }).join(' '), /no crew/);
  assert.deepEqual(overrideProblems(iss, 'nonsense'), ['The override is not an object.']);
  // A destination can be taken away, and the place moved (gravity follows).
  const moon = loadMission(builtIn, 'base-moon');
  const moved = withOverride(moon, { where: { body: 'mars', situation: 'surface' }, delayToEarthSeconds: 600, destination: 'Jezero' });
  assert.equal(moved.gravity, 0.38);
  assert.deepEqual(overrideProblems(moon, { where: { body: 'mars', situation: 'surface' }, delayToEarthSeconds: 600 }), []);
  const ship = loadMission(builtIn, 'ship-mars-orbit');
  assert.equal(withOverride(ship, { destination: null }).destination, undefined);
});

test('PUT on a built-in place writes its override; GET merges it; the built-in files never change', async () => {
  const hub = await serve({ running: 'ship-mars-orbit' });
  try {
    const read = await call(`${hub.url}/api/missions/iss`);
    assert.equal(read.body.edited, false);
    const iss = read.body.mission as Parameters<typeof changesOf>[0];
    const changes: MissionChanges = { ...changesOf(iss), nameText: '', plannedDays: 240, crew: changesOf(iss).crew.map((p) => (p.id === 'okafor' ? { ...p, name: 'Svetlana', pronouns: 'she' } : p)) };
    const put = await call(`${hub.url}/api/missions/iss`, 'PUT', { changes, pronounsChosen: ['okafor'] });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.restarting, false, 'not the running place: no restart');
    assert.equal(put.body.edited, true);
    const file = overrideFile(hub.customDir, 'iss');
    assert.equal(file, join(overridesDir(hub.data), 'iss.json'));
    const saved = JSON.parse(readFileSync(file, 'utf8')) as MissionOverride;
    assert.deepEqual(Object.keys(saved).sort(), ['crew', 'plannedDays', 'pronounsChosen']);
    assert.deepEqual(saved.pronounsChosen, ['okafor']);
    assert.deepEqual(saved.crew!.map((p) => p.id), ['reyes', 'leo', 'okafor', 'tanaka'], 'ids never change');

    const again = await call(`${hub.url}/api/missions/iss`);
    assert.equal(again.body.edited, true);
    assert.deepEqual(again.body.pronounsChosen, ['okafor']);
    assert.equal((again.body.mission as { plannedDays: number }).plannedDays, 240);
    assert.equal((again.body.mission as { nameText?: string }).nameText, undefined, 'an empty name keeps the built-in one');
    const entry = ((await call(`${hub.url}/api/missions`)).body.missions as { id: string; edited?: boolean }[]).find((m) => m.id === 'iss');
    assert.equal(entry?.edited, true);

    // A refused edit changes nothing; deleting a built-in is refused.
    const bad = await call(`${hub.url}/api/missions/iss`, 'PUT', { changes: { ...changes, delayToEarthSeconds: 900 } });
    assert.equal(bad.status, 400);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), saved);
    assert.equal((await call(`${hub.url}/api/missions/iss`, 'DELETE')).status, 403);

    // Adding someone new: an id from the name, never one already used; their chosen pronouns are remembered.
    const more = await call(`${hub.url}/api/missions/iss`, 'PUT', { changes: { ...changes, crew: [...changes.crew, { name: 'Yuri', role: 'role.engineer', pronouns: 'he', quarters: 'harmony', work: 'kibo' }] }, pronounsChosen: ['okafor'] });
    assert.equal(more.status, 200, JSON.stringify(more.body));
    const crew = (more.body.mission as { crew: { id: string; name: string }[] }).crew;
    assert.deepEqual(crew.map((p) => p.id), ['reyes', 'leo', 'okafor', 'tanaka', 'yuri']);
    assert.deepEqual((JSON.parse(readFileSync(file, 'utf8')) as MissionOverride).pronounsChosen, ['okafor', 'yuri']);
    assert.equal(builtInHash(), BEFORE, 'hub/profiles/missions byte for byte as it was');
  } finally {
    await hub.close();
  }
});

test('Reset to default removes the edits and keeps the first names; an invalid override is ignored and said', async () => {
  const hub = await serve({ running: 'ship-mars-orbit' });
  try {
    assert.equal(nameCrewOnce(builtIn, hub.customDir, 'iss', 7), true);
    const named = loadAnyMission(builtIn, hub.customDir, 'iss');
    const changes = { ...changesOf(named), nameText: 'Station practice', plannedDays: 30 };
    assert.equal((await call(`${hub.url}/api/missions/iss`, 'PUT', { changes })).status, 200);
    assert.equal(loadAnyMission(builtIn, hub.customDir, 'iss').nameText, 'Station practice');

    const reset = await call(`${hub.url}/api/missions/iss/override`, 'DELETE');
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal(reset.body.reset, true);
    const after = loadAnyMission(builtIn, hub.customDir, 'iss');
    assert.equal(after.nameText, undefined);
    assert.equal(after.plannedDays, loadMission(builtIn, 'iss').plannedDays);
    assert.deepEqual(after.crew.map((p) => p.name), named.crew.map((p) => p.name), 'the first names stay');
    assert.equal((await call(`${hub.url}/api/missions/iss`)).body.edited, false);

    // The ship has no first names: its reset removes the file.
    const ship = loadMission(builtIn, 'ship-mars-orbit');
    assert.equal((await call(`${hub.url}/api/missions/ship-mars-orbit`, 'PUT', { changes: { ...changesOf(ship), nameText: '', plannedDays: 99 } })).status, 200);
    assert.ok(existsSync(overrideFile(hub.customDir, 'ship-mars-orbit')));
    assert.equal((await call(`${hub.url}/api/missions/ship-mars-orbit/override`, 'DELETE')).status, 200);
    assert.ok(!existsSync(overrideFile(hub.customDir, 'ship-mars-orbit')));
    assert.equal((await call(`${hub.url}/api/missions/nothing/override`, 'DELETE')).status, 404);

    // An override broken by hand: the place runs as built, and the list says why.
    writeFileSync(overrideFile(hub.customDir, 'base-moon'), JSON.stringify({ delayToEarthSeconds: 600 }));
    assert.equal(loadAnyMission(builtIn, hub.customDir, 'base-moon').delayToEarthSeconds, 1.3);
    const list = (await call(`${hub.url}/api/missions`)).body.missions as { id: string; edited?: boolean; overrideProblems?: string[]; problems: string[] }[];
    const moon = list.find((m) => m.id === 'base-moon')!;
    assert.deepEqual(moon.problems, [], 'it can still run');
    assert.match(moon.overrideProblems!.join(' '), /delay is 1.3 s/);
    writeFileSync(overrideFile(hub.customDir, 'base-mars'), '{ not json');
    assert.deepEqual(readOverride(builtIn, hub.customDir, 'base-mars')?.problems, ['The override file is not JSON.']);
    assert.equal(loadAnyMission(builtIn, hub.customDir, 'base-mars').crew[0].name, 'Reyes');
    // Resetting a broken one clears it.
    assert.equal((await call(`${hub.url}/api/missions/base-mars/override`, 'DELETE')).status, 200);
    assert.ok(!existsSync(overrideFile(hub.customDir, 'base-mars')));
    assert.equal(builtInHash(), BEFORE);
  } finally {
    await hub.close();
  }
});

test('saving or resetting the running place restarts the hub through its supervisor; alone it says next start; refused while the story plays', async () => {
  let playing = false;
  const hub = await serve({ running: 'iss', storyPlaying: () => playing });
  try {
    const iss = loadMission(builtIn, 'iss');
    const changes = { ...changesOf(iss), nameText: '', plannedDays: 365 };
    const put = await call(`${hub.url}/api/missions/iss`, 'PUT', { changes });
    assert.equal(put.status, 200);
    assert.equal(put.body.restarting, true);
    await settle();
    assert.deepEqual(hub.restarts, ['iss'], 'one restart, once the answer went out');

    const reset = await call(`${hub.url}/api/missions/iss/override`, 'DELETE');
    assert.equal(reset.body.restarting, true);
    await settle();
    assert.deepEqual(hub.restarts, ['iss', 'iss']);

    playing = true;
    const refused = await call(`${hub.url}/api/missions/iss`, 'PUT', { changes });
    assert.equal(refused.status, 409);
    assert.match(String(refused.body.error), /story is playing/);
    assert.equal((await call(`${hub.url}/api/missions/iss/override`, 'DELETE')).status, 409);
    assert.ok(!existsSync(overrideFile(hub.customDir, 'iss')), 'nothing written while it plays');
    assert.equal(hub.restarts.length, 2);
  } finally {
    await hub.close();
  }

  const alone = await serve({ running: 'iss', supervised: false });
  try {
    const iss = loadMission(builtIn, 'iss');
    const put = await call(`${alone.url}/api/missions/iss`, 'PUT', { changes: { ...changesOf(iss), nameText: 'Alone' } });
    assert.equal(put.status, 200);
    assert.equal(put.body.restarting, false);
    assert.equal(put.body.restartNeeded, true, 'saved, for the next start');
    assert.equal(loadAnyMission(builtIn, alone.customDir, 'iss').nameText, 'Alone');
    await settle();
    assert.deepEqual(alone.restarts, []);
  } finally {
    await alone.close();
  }
});

test('a crew-made place still works: listed, edited (restarting when it runs) and deleted when it does not', async () => {
  const hub = await serve({ running: 'ship-mars-orbit' });
  try {
    const made = await call(`${hub.url}/api/missions`, 'POST', { basedOn: 'iss' });
    assert.equal(made.status, 201, 'the copy route still works, for the app');
    const id = String(made.body.id);
    const mission = (await call(`${hub.url}/api/missions/${id}`)).body.mission as Parameters<typeof changesOf>[0];
    const edit = await call(`${hub.url}/api/missions/${id}`, 'PUT', { changes: { ...changesOf(mission), nameText: 'Mine' } });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.restarting, false);
    assert.equal((await call(`${hub.url}/api/missions/${id}/override`, 'DELETE')).status, 400, 'a crew-made place has no default');
    assert.equal((await call(`${hub.url}/api/missions/${id}`, 'DELETE')).status, 200);
  } finally {
    await hub.close();
  }
  const running = await serve({ running: 'custom-now' });
  try {
    const iss = loadMission(builtIn, 'iss');
    mkdirSync(running.customDir, { recursive: true });
    writeFileSync(join(running.customDir, 'custom-now.json'), JSON.stringify({ ...iss, id: 'custom-now', basedOn: 'iss', nameText: 'Now' }));
    const list = (await call(`${running.url}/api/missions`)).body.missions as { id: string; custom?: boolean }[];
    assert.ok(list.some((m) => m.id === 'custom-now' && m.custom));
    const edit = await call(`${running.url}/api/missions/custom-now`, 'PUT', { changes: { ...changesOf(iss), nameText: 'Now, edited' } });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.restarting, true);
    await settle();
    assert.deepEqual(running.restarts, ['custom-now']);
  } finally {
    await running.close();
  }
});

test('the first start of a built-in place names its crew once, with first names only; the ship keeps its crew; ids never change', () => {
  const data = temp();
  try {
    const customDir = join(data, 'missions');
    const iss = loadMission(builtIn, 'iss');
    assert.equal(nameCrewOnce(builtIn, customDir, 'ship-mars-orbit', 1), false, 'the ship keeps Reyes, Leo, Okafor, Tanaka');
    assert.ok(!existsSync(overrideFile(customDir, 'ship-mars-orbit')));
    assert.equal(nameCrewOnce(builtIn, customDir, 'iss', 1), true);
    const first = loadAnyMission(builtIn, customDir, 'iss');
    assert.deepEqual(first.crew.map((p) => p.id), iss.crew.map((p) => p.id), 'ids are what data is keyed by: unchanged');
    for (const p of first.crew) {
      assert.ok(ASTRONAUT_FIRST_NAMES.includes(p.name), `${p.name} is from the list`);
      assert.ok(!/\s/.test(p.name));
      assert.equal(p.pronouns, 'they', 'never guessed from a name');
    }
    assert.equal(new Set(first.crew.map((p) => p.name)).size, first.crew.length);
    assert.equal(nameCrewOnce(builtIn, customDir, 'iss', 2), false, 'only once');
    assert.deepEqual(loadAnyMission(builtIn, customDir, 'iss').crew, first.crew, 'stable afterwards');
    assert.equal(nameCrewOnce(builtIn, customDir, 'custom-x', 3), false, 'not for crew-made places');
    assert.equal(nameCrewOnce(builtIn, null, 'base-moon', 3), false, 'not without a data folder');
    assert.equal(nameCrewOnce(builtIn, customDir, 'base-moon', 3), true);
    assert.notDeepEqual(loadAnyMission(builtIn, customDir, 'base-moon').crew.map((p) => p.name), iss.crew.map((p) => p.name));
    assert.equal(builtInHash(), BEFORE);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test('someone added to a running crew gets the same three days of simulated history on the next start', async () => {
  const { Store } = await import('./db.ts');
  const { Hub } = await import('./server.ts');
  const { SimulatedCrew } = await import('./crew.ts');
  const { placesOf } = await import('../engine/crew.ts');
  const { hubProfileOf } = await import('../engine/mission.ts');
  const iss = loadMission(builtIn, 'iss');
  const store = new Store(':memory:');
  const hub = new Hub(store, hubProfileOf(iss, 'iss'), '/nonexistent');
  try {
    const now = Date.UTC(2026, 10, 14, 18);
    new SimulatedCrew(hub, store, iss.crew.map((p) => p.id), -180, placesOf(iss)).catchUp(now);
    const grown = { ...iss, crew: [...iss.crew, { id: 'naoko', name: 'Naoko', role: 'role.scientist', pronouns: 'they' as const, quarters: 'harmony', work: 'kibo' }] };
    const later = now + 60_000;
    new SimulatedCrew(hub, store, grown.crew.map((p) => p.id), -180, placesOf(grown)).catchUp(later);
    const signals = new Set(store.rows({ person: 'naoko', from: later - 3 * 86_400_000 }).map((r) => r.signal));
    for (const s of ['heart_rate', 'sleep_duration', 'blood_pressure_systolic', 'mood.stress', 'exercise_minutes']) assert.ok(signals.has(s), `naoko has ${s}`);
    assert.ok(store.rows({ person: 'naoko', from: later - 3 * 86_400_000 }).every((r) => r.kind === 'simulated'));
    assert.ok(store.stays(later, later, 'naoko').length > 0, 'and is somewhere');
  } finally {
    hub.http.close();
    store.close();
  }
});
