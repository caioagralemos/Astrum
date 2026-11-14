// Choosing the place on screen: the supervisor that restarts the hub, POST
// /api/missions/select, missions the crew makes from another, and that none of
// it touches another mission's database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { RESTART_CODE, supervise } from './run.ts';
import { loadAnyMission, loadMission, missionsRoute } from './missions.ts';
import type { MissionsOptions } from './missions.ts';
import { chosenMission, databaseFile } from './paths.ts';
import { applyChanges, changeProblems, changesOf, delayFor, gravityFor } from '../engine/custom.ts';
import type { MissionChanges } from '../engine/custom.ts';
import { hubProfileOf, validateMission } from '../engine/mission.ts';

const hubDir = new URL('..', import.meta.url).pathname;
const builtIn = join(hubDir, 'profiles', 'missions');
const temp = () => mkdtempSync(join(tmpdir(), 'astrum-switch-'));

// ---------- the supervisor ----------

/** A tiny stand-in for the hub: counts its starts in a file, and exits with the code listed for that start. */
function fakeChild(dir: string, codes: number[]): string {
  const script = join(dir, 'child.mjs');
  writeFileSync(script, `
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const file = ${JSON.stringify(join(dir, 'starts'))};
const n = existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0;
writeFileSync(file, String(n + 1));
const codes = ${JSON.stringify(codes)};
process.exit(codes[Math.min(n, codes.length - 1)]);
`);
  return script;
}
const starts = (dir: string) => Number(readFileSync(join(dir, 'starts'), 'utf8'));

test('the supervisor starts the hub again only on the restart code, and ends with the hub\'s own code otherwise', async () => {
  const dir = temp();
  try {
    const lines: string[] = [];
    const run = supervise({ command: process.execPath, args: [fakeChild(dir, [RESTART_CODE, RESTART_CODE, 0])], stdio: 'ignore', delayMs: 10, log: (l) => lines.push(l) });
    assert.equal(await run.done, 0);
    assert.equal(starts(dir), 3, 'two restarts, then a clean stop');
    assert.equal(run.restarts(), 2);

    const crashed = temp();
    const crash = supervise({ command: process.execPath, args: [fakeChild(crashed, [3])], stdio: 'ignore', delayMs: 10, log: (l) => lines.push(l) });
    assert.equal(await crash.done, 3, 'a crash is passed on, not hidden by a restart');
    assert.equal(starts(crashed), 1);
    assert.ok(lines.some((l) => /code 3.*Not restarting/.test(l)));
    rmSync(crashed, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('more than 3 restarts in 10 seconds is a loop: the supervisor stops and says so', async () => {
  const dir = temp();
  try {
    const lines: string[] = [];
    const run = supervise({ command: process.execPath, args: [fakeChild(dir, [RESTART_CODE])], stdio: 'ignore', delayMs: 5, log: (l) => lines.push(l) });
    assert.equal(await run.done, 1);
    assert.equal(starts(dir), 4, 'started once, restarted three times, then stopped');
    assert.ok(lines.some((l) => /4 times in 10 seconds/.test(l)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- the custom rules ----------

test('a crew-made mission keeps its modules, takes its gravity from where it is, and keeps the stated delays', () => {
  const iss = loadMission(builtIn, 'iss');
  const changes: MissionChanges = { ...changesOf(iss), nameText: 'Gateway practice' };
  assert.deepEqual(changeProblems(iss, changes), []);
  const made = applyChanges(iss, changes, 'custom-a', 'iss');
  assert.deepEqual(validateMission(made), []);
  assert.deepEqual(made.modules, iss.modules, 'the layout is the base\'s');
  assert.equal(made.nameText, 'Gateway practice');
  assert.equal(hubProfileOf(made, 'custom-a').mission?.nameText, 'Gateway practice');
  assert.equal(hubProfileOf(made, 'custom-a').mission?.custom, true);

  assert.equal(gravityFor('moon', 'surface'), 0.166);
  assert.equal(gravityFor('mars', 'surface'), 0.38);
  assert.equal(gravityFor('mars', 'orbit'), 0);
  assert.deepEqual(delayFor('earth', 'orbit'), { fixed: 1 });
  assert.deepEqual(delayFor('moon', 'surface'), { fixed: 1.3 });
  assert.deepEqual(delayFor('mars', 'orbit'), { min: 180, max: 1320 });

  const keys = (c: Partial<MissionChanges>) => changeProblems(iss, { ...changes, ...c }).map((p) => p.key);
  assert.deepEqual(keys({ where: { body: 'mars', situation: 'orbit' }, delayToEarthSeconds: 1 }), ['custom.problem.delayRange'], 'Mars needs its own delay');
  assert.deepEqual(keys({ where: { body: 'mars', situation: 'orbit' }, delayToEarthSeconds: 600 }), []);
  assert.deepEqual(keys({ where: { body: 'mars', situation: 'surface' }, delayToEarthSeconds: 600 }), ['custom.problem.situation'], 'a station is never on the ground');
  assert.deepEqual(keys({ nameText: ' ' }), ['custom.problem.name']);
  assert.deepEqual(keys({ crew: [] }), ['custom.problem.noCrew']);
  assert.deepEqual(keys({ crew: [{ name: 'Ana', role: 'role.cmo', pronouns: 'she', quarters: 'zarya', work: 'kibo' }] }), ['custom.problem.quarters'], 'Zarya is not a room');
  assert.deepEqual(keys({ crew: [{ id: 'someone', name: 'Ana', role: 'role.cmo', pronouns: 'she', quarters: 'harmony', work: 'kibo' }] }), ['custom.problem.personId']);

  // A new person never takes the id, and so the body, of someone the simulated crew has numbers for.
  const leo = applyChanges(iss, { ...changes, crew: [...changes.crew.filter((p) => p.id !== 'leo'), { name: 'Leo', role: 'role.engineer', pronouns: 'he', quarters: 'harmony', work: 'kibo' }] }, 'custom-b', 'iss');
  assert.ok(leo.crew.some((p) => p.id === 'leo-2' && p.name === 'Leo'));
  assert.ok(!leo.crew.some((p) => p.id === 'leo'));
});

// ---------- the routes ----------

interface Setup { url: string; data: string; restarts: string[]; close: () => Promise<void> }

async function serve(opts: Partial<MissionsOptions> & { running?: string } = {}): Promise<Setup> {
  const data = temp();
  const restarts: string[] = [];
  const route = missionsRoute(builtIn, opts.running ?? 'ship-mars-orbit', null, {
    customDir: join(data, 'missions'), dataDir: data, supervised: true, restart: (to) => restarts.push(to), locked: null, ...opts,
  });
  const server: Server = createServer((req, res) => void route(req, res, new URL(req.url ?? '/', 'http://hub')).then((handled) => { if (!handled) res.writeHead(404).end(); }));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`, data, restarts,
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

test('POST /api/missions/select checks the id, remembers it and restarts; refuses while locked, alone or during the story', async () => {
  let playing = false;
  const hub = await serve({ storyPlaying: () => playing });
  try {
    assert.equal((await call(`${hub.url}/api/missions/select`, 'POST', { id: 'atlantis' })).status, 404);
    assert.equal((await call(`${hub.url}/api/missions/select`, 'POST', { id: '../iss' })).status, 404);
    assert.equal((await call(`${hub.url}/api/missions/select`, 'POST', {})).status, 400);
    playing = true;
    const story = await call(`${hub.url}/api/missions/select`, 'POST', { id: 'iss' });
    assert.equal(story.status, 409);
    assert.match(String(story.body.error), /story is playing/);
    assert.equal(chosenMission(hub.data), null, 'nothing remembered');
    playing = false;
    const ok = await call(`${hub.url}/api/missions/select`, 'POST', { id: 'iss' });
    assert.deepEqual(ok, { status: 200, body: { restarting: true, id: 'iss' } });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(hub.restarts, ['iss'], 'restarted once the answer went out');
    assert.equal(chosenMission(hub.data), 'iss');
    const list = await call(`${hub.url}/api/missions`);
    assert.equal(list.body.supervised, true);
    assert.equal(list.body.locked, null);
  } finally {
    await hub.close();
  }

  const alone = await serve({ supervised: false });
  try {
    const r = await call(`${alone.url}/api/missions/select`, 'POST', { id: 'iss' });
    assert.equal(r.status, 409);
    assert.match(String(r.body.error), /without its supervisor.*npm run core.*ASTRUM_MISSION=iss/);
    assert.equal(chosenMission(alone.data), null);
  } finally {
    await alone.close();
  }

  const locked = await serve({ locked: 'This hub was started with ASTRUM_MISSION=iss, which fixes the place.' });
  try {
    const r = await call(`${locked.url}/api/missions/select`, 'POST', { id: 'base-moon' });
    assert.equal(r.status, 409);
    assert.match(String(r.body.error), /ASTRUM_MISSION=iss/);
    assert.equal((await call(`${locked.url}/api/missions`)).body.locked, 'This hub was started with ASTRUM_MISSION=iss, which fixes the place.');
  } finally {
    await locked.close();
  }
});

test('a crew-made mission: made from a built-in, listed, read, edited, refused when wrong, and deleted; built-ins are never deleted', async () => {
  const hub = await serve();
  try {
    const made = await call(`${hub.url}/api/missions`, 'POST', { basedOn: 'base-moon' });
    assert.equal(made.status, 201);
    const id = String(made.body.id);
    assert.match(id, /^custom-[a-z0-9]+$/);
    const file = join(hub.data, 'missions', `${id}.json`);
    assert.deepEqual(validateMission(JSON.parse(readFileSync(file, 'utf8'))), []);
    assert.equal(loadAnyMission(builtIn, join(hub.data, 'missions'), id).nameText, 'Base on the Moon, my copy');

    const list = (await call(`${hub.url}/api/missions`)).body.missions as { id: string; custom?: boolean; basedOn?: string }[];
    assert.deepEqual(list.filter((m) => m.custom).map((m) => [m.id, m.basedOn]), [[id, 'base-moon']]);
    assert.equal(list.filter((m) => !m.custom).length, 4);

    const read = await call(`${hub.url}/api/missions/${id}`);
    assert.equal(read.body.custom, true);
    const mission = read.body.mission as Parameters<typeof changesOf>[0];
    const changes = { ...changesOf(mission), nameText: 'Shackleton', crew: [...changesOf(mission).crew, { name: 'Ana Souza', role: 'role.scientist', pronouns: 'she', quarters: 'quarters-1', work: 'lab' }] };
    const edited = await call(`${hub.url}/api/missions/${id}`, 'PUT', { changes });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { nameText: string; crew: { id: string }[]; gravity: number };
    assert.equal(saved.nameText, 'Shackleton');
    assert.ok(saved.crew.some((p) => p.id === 'ana-souza'));
    assert.equal(saved.gravity, 0.166);

    const bad = await call(`${hub.url}/api/missions/${id}`, 'PUT', { changes: { ...changes, delayToEarthSeconds: 600 } });
    assert.equal(bad.status, 400);
    assert.deepEqual((bad.body.problems as { key: string; text: string }[]).map((p) => [p.key, p.text]), [['custom.problem.delayFixed', 'From here the delay is 1.3 s.']]);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).delayToEarthSeconds, 1.3, 'a refused edit changes nothing');

    // A built-in place is never deleted (its edits are reset instead, core/overrides.test.ts).
    assert.equal((await call(`${hub.url}/api/missions/iss`, 'DELETE')).status, 403);
    assert.equal((await call(`${hub.url}/api/missions/nothing-here`, 'DELETE')).status, 404);

    // It can be chosen, and then it is forgotten when deleted.
    assert.equal((await call(`${hub.url}/api/missions/select`, 'POST', { id })).status, 200);
    assert.equal(chosenMission(hub.data), id);
    assert.equal((await call(`${hub.url}/api/missions/${id}`, 'DELETE')).status, 200);
    assert.equal(chosenMission(hub.data), null);
    assert.deepEqual(readdirSync(join(hub.data, 'missions')), []);
  } finally {
    await hub.close();
  }

  // The hub running a crew-made mission cannot delete it.
  const running = await serve({ running: 'custom-now' });
  try {
    const iss = loadMission(builtIn, 'iss');
    mkdirSync(join(running.data, 'missions'), { recursive: true });
    writeFileSync(join(running.data, 'missions', 'custom-now.json'), JSON.stringify(applyChanges(iss, { ...changesOf(iss), nameText: 'Now' }, 'custom-now', 'iss')));
    const r = await call(`${running.url}/api/missions/custom-now`, 'DELETE');
    assert.equal(r.status, 409);
    assert.match(String(r.body.error), /runs now/);
  } finally {
    await running.close();
  }
});

test('switching and making missions never touch another mission\'s database', async () => {
  const hub = await serve();
  try {
    const dbs = [databaseFile(hub.data, 'ship-mars-orbit'), databaseFile(hub.data, 'iss'), databaseFile(hub.data, 'base-moon')];
    for (const [i, f] of dbs.entries()) writeFileSync(f, `history ${i}`);
    const hash = () => dbs.map((f) => createHash('sha256').update(readFileSync(f)).digest('hex'));
    const before = hash();
    const made = await call(`${hub.url}/api/missions`, 'POST', { basedOn: 'iss' });
    const id = String(made.body.id);
    assert.equal(databaseFile(hub.data, id), join(hub.data, `astrum-3-${id}.sqlite`), 'it gets its own file');
    await call(`${hub.url}/api/missions/select`, 'POST', { id: 'iss' });
    await call(`${hub.url}/api/missions/select`, 'POST', { id });
    await call(`${hub.url}/api/missions/${id}`, 'PUT', { changes: { ...changesOf(loadAnyMission(builtIn, join(hub.data, 'missions'), id)), nameText: 'Renamed' } });
    await call(`${hub.url}/api/missions/select`, 'POST', { id: 'ship-mars-orbit' });
    await call(`${hub.url}/api/missions/${id}`, 'DELETE');
    assert.deepEqual(hash(), before, 'every database byte for byte as it was');
    assert.deepEqual(readdirSync(hub.data).sort(), ['astrum-3-base-moon.sqlite', 'astrum-3-iss.sqlite', 'astrum-3.sqlite', 'mission.json', 'missions'], 'only the choice and the missions folder were added');
  } finally {
    await hub.close();
  }
});
