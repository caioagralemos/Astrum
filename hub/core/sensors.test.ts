import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './db.ts';
import { Hub } from './server.ts';
import { SensorRegistry, exampleFor, handleSensors } from './sensors.ts';
import type { SensorsContext } from './sensors.ts';
import { SerialJsonAdapter } from './serial-json.ts';
import type { Profile, Row } from '../engine/types.ts';

const profile = JSON.parse(readFileSync(new URL('../profiles/mars-orbit.json', import.meta.url), 'utf8')) as Profile;

// A made-up test number, not a recommended limit.
const radMonitor = {
  id: 'rad-1', name: 'Radiation monitor', room: 'lab', transport: 'http-push',
  signals: [{ signal: 'radiation', name: 'Radiation', namePt: 'Radiação', unit: 'uSv/h', decimals: 2, limits: { alarmAbove: 50 }, bounds: { min: 0, max: 10_000 }, note: '' }],
};

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'astrum-sensors-'));
}

test('a missing or broken sensors.json is an empty registry, reported, never a crash', () => {
  const dir = tmp();
  try {
    const none = new SensorRegistry(join(dir, 'sensors.json'), profile);
    assert.deepEqual([none.list(), none.problems], [[], []]);

    const file = join(dir, 'broken.json');
    writeFileSync(file, '{"sensors": [');
    const broken = new SensorRegistry(file, profile);
    assert.equal(broken.list().length, 0);
    assert.match(broken.problems[0], /could not be read/);
    // The first save sets the broken file aside instead of writing over it.
    const checked = { ...radMonitor, transport: 'http-push' as const, addedAt: 1, signals: [{ ...radMonitor.signals[0], group: 'cabin' as const }] };
    broken.put(checked);
    assert.equal(readFileSync(`${file}.corrupt`, 'utf8'), '{"sensors": [');
    assert.deepEqual(new SensorRegistry(file, profile).list().map((s) => s.id), ['rad-1']);

    // An entry that no longer passes (its room is gone) is reported, and kept in the file.
    const stale = join(dir, 'stale.json');
    writeFileSync(stale, JSON.stringify({ version: 1, sensors: [{ ...radMonitor, room: 'attic' }] }));
    const reg = new SensorRegistry(stale, profile);
    assert.equal(reg.list().length, 0);
    assert.match(reg.problems[0], /"rad-1" is not loaded: There is no room "attic"/);
    reg.put({ ...checked, id: 'rad-2' });
    assert.equal(JSON.parse(readFileSync(stale, 'utf8')).sensors.length, 2);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('/api/sensors adds, lists, tests and removes a sensor; readings are checked at the hub\'s door', async () => {
  const dir = tmp();
  const file = join(dir, 'sensors.json');
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const registry = new SensorRegistry(file, profile);
  let now = 1_000_000;
  const ctx: SensorsContext = { store, registry, profile, now: () => now };
  // The wiring main.ts uses: the door check, then the routes.
  const ingest = hub.ingest.bind(hub);
  hub.ingest = (rows: Row[]) => ingest(registry.checkRows(rows, now));
  hub.routes.push((req, res, url) => handleSensors(req, res, url, ctx));
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as any };
  };
  const reading = (value: number, t = now, kind = 'measured', source = 'sensor:rad-1') =>
    call('POST', '/api/readings', { source, rows: [{ t, signal: 'radiation', value, unit: 'uSv/h', kind, room: 'lab' }] });

  try {
    const empty = await call('GET', '/api/sensors');
    assert.equal(empty.status, 200);
    assert.deepEqual([empty.json.sensors, empty.json.unknown, empty.json.problems], [[], [], []]);
    assert.ok(empty.json.builtIn.some((b: any) => b.signal === 'co2' && b.nasaLimit.limitSource === 'nasa'));

    // A device posting before anyone registered it is heard, and its readings kept as always.
    assert.deepEqual((await reading(0.4, now, 'measured', 'sensor:rad-1')).json, { accepted: 1 });
    const heard = (await call('GET', '/api/sensors')).json;
    assert.deepEqual(heard.unknown.map((u: any) => [u.id, u.message, u.via]), [['rad-1', 'heard from an unknown sensor: rad-1', 'http']]);

    const refused = await call('POST', '/api/sensors', { ...radMonitor, room: 'attic' });
    assert.equal(refused.status, 400);
    assert.match(refused.json.problems.join(), /no room "attic"/);
    assert.equal((await call('POST', '/api/sensors', [])).status, 400);

    const added = await call('POST', '/api/sensors', radMonitor);
    assert.equal(added.status, 200);
    assert.deepEqual([added.json.created, added.json.source, added.json.sensor.addedAt], [true, 'sensor:rad-1', now]);
    assert.ok(existsSync(file));
    assert.equal(new SensorRegistry(file, profile).get('rad-1')!.name, 'Radiation monitor', 'it is on disk');
    assert.equal((await call('GET', '/api/sensors')).json.unknown.length, 0, 'registering it answers the "unknown" line');

    // Its connection test: nothing yet, then a reading arrives.
    now += 1000;
    const test1 = await call('POST', '/api/sensors/test?id=rad-1');
    assert.deepEqual([test1.json.arrived, test1.json.startedAt], [false, now]);
    assert.match(test1.json.example.curl, /^curl -X POST http:\/\/127\.0\.0\.1:\d+\/api\/readings/);
    assert.match(test1.json.example.curl, /"source":"sensor:rad-1"/);
    assert.match(test1.json.example.curl, /"value":null,"text":"connection test"/, 'the test stores no made-up number');
    assert.match(test1.json.example.body, /"signal":"radiation","value":<value>,"unit":"uSv\/h","kind":"measured","room":"lab"/);
    now += 1000;
    assert.equal((await reading(0.31)).status, 200);
    now += 1000;
    const test2 = await call('POST', '/api/sensors/test?id=rad-1');
    assert.deepEqual([test2.json.arrived, test2.json.arrivedAt, test2.json.startedAt], [true, now - 1000, test1.json.startedAt]);
    assert.equal((await call('POST', '/api/sensors/test?id=nope')).status, 404);

    // Out of the device's own bounds: refused at the door and counted, not stored.
    assert.deepEqual((await reading(20_000)).json, { accepted: 0 });
    // Over the crew's level: stored, shown, judged as the crew's, with the device's own kind.
    assert.deepEqual((await reading(60)).json, { accepted: 1 });
    const state = (await call('GET', '/api/sensors')).json;
    const sensor = state.sensors[0];
    assert.equal(sensor.source, 'sensor:rad-1');
    assert.deepEqual(sensor.refused.map((r: any) => [r.signal, r.count, r.lastValue]), [['radiation', 1, 20_000]]);
    const sig = sensor.signals[0];
    assert.deepEqual([sig.arriving, sig.last.value, sig.last.kind, sig.unitMatches], [true, 60, 'measured', true]);
    assert.deepEqual(sig.crewLimits, { alarmAbove: 50, limitSource: 'crew' });
    assert.equal(sig.nasaLimit, null, 'NASA gives no radiation limit here, and none is made up');
    assert.deepEqual([sig.judgement.level, sig.judgement.limit, sig.judgement.limitSource, sig.judgement.kind], ['alarm', 50, 'crew', 'measured']);
    assert.ok(!state.undescribed.some((u: any) => u.signal === 'radiation'));

    // A simulated row from the device is kept as simulated.
    now += 1000;
    await reading(1, now, 'simulated');
    assert.equal((await call('GET', '/api/sensors')).json.sensors[0].signals[0].last.kind, 'simulated');

    // A signal arriving that nobody described is listed for someone to add.
    await call('POST', '/api/readings', { source: 'phone:reyes', rows: [{ t: now, signal: 'skin_temp', value: 33, unit: 'C', kind: 'measured', person: 'reyes' }] });
    assert.ok((await call('GET', '/api/sensors')).json.undescribed.some((u: any) => u.signal === 'skin_temp'));

    // Updating keeps when it was first added.
    now += 1000;
    const updated = await call('POST', '/api/sensors', { ...radMonitor, name: 'Rad monitor, lab' });
    assert.deepEqual([updated.json.created, updated.json.sensor.addedAt, updated.json.sensor.name], [false, 1_000_000, 'Rad monitor, lab']);

    // Removing it keeps every reading it stored.
    const before = store.rows({ signal: 'radiation' }).length;
    assert.deepEqual((await call('DELETE', '/api/sensors?id=rad-1')).json, { removed: 'rad-1', readingsKept: true });
    assert.equal(store.rows({ signal: 'radiation' }).length, before);
    assert.equal((await call('DELETE', '/api/sensors?id=rad-1')).status, 404);
    assert.equal(registry.list().length, 0);
    assert.equal((await call('PUT', '/api/sensors')).status, 405);
    assert.equal((await call('GET', '/api/other')).status, 404, 'other paths are left to the main server');
  } finally {
    hub.http.closeAllConnections();
    hub.http.close();
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a NASA-limited signal keeps NASA\'s limit beside the crew\'s', async () => {
  const dir = tmp();
  const store = new Store(':memory:');
  const registry = new SensorRegistry(join(dir, 'sensors.json'), profile);
  const ctx: SensorsContext = { store, registry, profile, now: () => 1000 };
  const hub = new Hub(store, profile, '/nonexistent');
  hub.routes.push((req, res, url) => handleSensors(req, res, url, ctx));
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  try {
    const body = { id: 'co2-b', name: 'CO2 backup', room: 'lab', transport: 'serial-json', signals: [{ signal: 'co2', name: 'CO2', unit: 'mmHg', decimals: 2, limits: { warnAbove: 9 }, note: '' }] };
    const added = (await (await fetch(`http://127.0.0.1:${port}/api/sensors`, { method: 'POST', body: JSON.stringify(body) })).json()) as any;
    assert.match(added.notices.join(), /NASA's limit .* still applies/);
    const sig = ((await (await fetch(`http://127.0.0.1:${port}/api/sensors`)).json()) as any).sensors[0].signals[0];
    assert.deepEqual([sig.crewLimits.limitSource, sig.crewLimits.warnAbove, sig.nasaLimit.limitSource, sig.nasaLimit.max], ['crew', 9, 'nasa', 3]);
    assert.deepEqual([sig.judgement.level, sig.judgement.reason], ['unjudged', 'no-reading']);
  } finally {
    hub.http.closeAllConnections();
    hub.http.close();
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('the serial example is the line format, built from the registration', () => {
  const example = exampleFor({ id: 'rad-1', name: 'R', room: 'lab', transport: 'serial-json', addedAt: 0, signals: [{ signal: 'radiation', name: 'R', unit: 'uSv/h', group: 'cabin', decimals: 2, note: '' }] }, 'hub:4310');
  assert.equal(example.kind, 'serial-json');
  assert.equal((example as { line: string }).line, '{"sensor":"rad-1","r":[["radiation",<value>,"uSv/h","m"]]}');
});

test('the serial adapter uses the registry: registered sensors are placed, unknown ones are listed', () => {
  const dir = tmp();
  try {
    const registry = new SensorRegistry(join(dir, 'sensors.json'), profile);
    registry.put({ id: 'band-1', name: 'Band', person: 'reyes', transport: 'serial-json', addedAt: 0, signals: [{ signal: 'skin_temp', name: 'Skin', unit: 'C', group: 'body', decimals: 1, note: '' }] });
    const rows: Row[] = [];
    const adapter = new SerialJsonAdapter({ rows: (r) => rows.push(...registry.checkRows(r, 5)), status: () => {} }, registry, '/dev/none');
    adapter.onLine('{"sensor":"band-1","r":[["skin_temp",33.2,"C","m"]]}', 5);
    adapter.onLine('{"sensor":"rad-9","r":[["radiation",0.2,"uSv/h","m"]]}', 6);
    assert.deepEqual(rows.map((r) => [r.source, r.person, r.room, r.value]), [['sensor:band-1', 'reyes', null, 33.2]]);
    assert.deepEqual(registry.unknownSensors().map((u) => [u.id, u.via, u.signals]), [['rad-9', 'serial:/dev/none', ['radiation']]]);
    assert.equal(registry.lastArrival('band-1'), 5);
    adapter.stop();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
