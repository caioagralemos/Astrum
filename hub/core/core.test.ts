import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from './db.ts';
import { Hub } from './server.ts';
import { parseChipLine } from './chip.ts';
import { StandIn } from './standin.ts';
import { hasString } from '../engine/strings.ts';
import type { HubMessage, Profile } from '../engine/types.ts';

const profile = JSON.parse(readFileSync(new URL('../profiles/mars-orbit.json', import.meta.url), 'utf8')) as Profile;

test('the profile only uses names the string table has', () => {
  for (const key of [profile.place, ...profile.rooms.map((r) => r.name), ...profile.crew.map((p) => p.role)]) {
    assert.ok(hasString(key), `no string for ${key}`);
  }
  for (const room of Object.values(profile.chips)) assert.ok(profile.rooms.some((r) => r.id === room));
});

test('the store keeps rows with their source and kind', () => {
  const store = new Store(':memory:');
  store.addRows([
    { t: 1000, signal: 'pressure', value: 1009, unit: 'hPa', kind: 'measured', source: 'chip:cabin-1', room: 'quarters-2' },
    { t: 2000, signal: 'pressure', value: 1010, unit: 'hPa', kind: 'measured', source: 'chip:cabin-1', room: 'quarters-2' },
    { t: 2000, signal: 'pressure', value: 1013, unit: 'hPa', kind: 'simulated', source: 'sim', room: 'quarters-2' },
    { t: 2000, signal: 'heart_rate', value: 61, unit: 'bpm', kind: 'simulated', source: 'sim', person: 'reyes' },
  ]);
  assert.equal(store.rows({ signal: 'pressure' }).length, 3);
  assert.deepEqual(store.rows({ person: 'reyes' }).map((r) => r.value), [61]);
  const recent = store.recent(0);
  assert.equal(recent.length, 3, 'one newest row per source, signal and place');
  assert.ok(recent.some((r) => r.source === 'chip:cabin-1' && r.value === 1010));
  assert.throws(() => store.addRows([{ t: 1, signal: 'x', value: 1, unit: '', kind: 'guessed' as never, source: 's', room: 'lab' }]));
  assert.equal(store.rows({}).length, 4, 'a failed batch adds nothing');
});

test('moving someone closes the old stay and opens a new one', () => {
  const store = new Store(':memory:');
  assert.equal(store.moveTo('reyes', 'lab', 1000, 'simulated', 'sim').length, 1);
  assert.equal(store.moveTo('reyes', 'lab', 2000, 'simulated', 'sim').length, 0, 'same room changes nothing');
  const changed = store.moveTo('reyes', 'quarters-2', 5000, 'simulated', 'sim');
  assert.deepEqual(changed.map((s) => [s.room, s.from, s.until]), [['lab', 1000, 5000], ['quarters-2', 5000, null]]);
  assert.equal(store.stays(0, 9000, 'reyes').length, 2);
  assert.equal(store.stays(6000, 9000, 'reyes').length, 1);
});

test('chip lines become rows in the chip\'s room; noise is dropped', () => {
  const roomOf = (id: string) => (id === 'cabin-1' ? 'quarters-2' : null);
  const out = parseChipLine('{"chip":"cabin-1","r":[["pressure",1009.2,"hPa","m"],["noise",312,"raw","m"],["bad"]],"missing":["co2"]}', 5000, roomOf)!;
  assert.equal(out.rows.length, 2);
  assert.deepEqual(out.rows[0], { t: 5000, signal: 'pressure', value: 1009.2, unit: 'hPa', kind: 'measured', source: 'chip:cabin-1', room: 'quarters-2' });
  assert.deepEqual(out.missing, ['co2']);
  assert.equal(parseChipLine('ets Jul 29 2019 12:21:46', 0, roomOf), null);
  assert.equal(parseChipLine('{"chip":"unknown","r":[["pressure",1,"hPa","m"]]}', 0, roomOf)!.rows.length, 0);
});

test('in production the hub keeps no simulated value', () => {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent', true);
  const rows = parseChipLine('{"chip":"cabin-1","r":[["pressure",1009.2,"hPa","m"],["co2",650,"ppm","s"]],"missing":["co2"]}', 5000, () => 'quarters-2')!.rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(hub.ingest(rows).map((r) => r.signal), ['pressure']);
  hub.move('reyes', 'lab', 1, 'simulated', 'sim');
  assert.equal(store.stays(0, 10).length, 0);
  store.close();
});

test('the stand-in fills only the signals no other source gives, and marks them simulated', () => {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const standIn = new StandIn(hub, ['quarters-2'], () => 0.5);
  hub.ingest([{ t: 10_000, signal: 'pressure', value: 1009, unit: 'hPa', kind: 'measured', source: 'chip:cabin-1', room: 'quarters-2' }]);
  const rows = standIn.tick(11_000);
  assert.ok(!rows.some((r) => r.signal === 'pressure'), 'the chip is giving pressure');
  assert.ok(rows.some((r) => r.signal === 'co2'));
  assert.ok(rows.every((r) => r.kind === 'simulated' && r.source === 'sim:hub' && r.room === 'quarters-2'));
  hub.ingest(rows);
  assert.ok(standIn.tick(12_000).some((r) => r.signal === 'co2'), 'its own rows do not count as a source');
  assert.ok(standIn.tick(60_000).some((r) => r.signal === 'pressure'), 'when the chip goes quiet it takes over');
  store.close();
});

test('a device posts readings over HTTP and a screen hears them over the socket', async () => {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: HubMessage[] = [];
    const next = () => new Promise<HubMessage>((done) => socket.addEventListener('message', (e) => done(JSON.parse(String(e.data))), { once: true }));
    const first = await next();
    assert.equal(first.type, 'state');
    socket.addEventListener('message', (e) => messages.push(JSON.parse(String(e.data))));

    const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', body: JSON.stringify(body) });
    const good = await post('/api/readings', { source: 'phone:reyes', rows: [{ t: Date.now(), signal: 'heart_rate', value: 58, unit: 'bpm', kind: 'measured', person: 'reyes' }] });
    assert.deepEqual(await good.json(), { accepted: 1 });
    const bad = await post('/api/readings', { source: 'phone:reyes', rows: [{ t: 1, signal: 'heart_rate', value: 58, unit: 'bpm', kind: 'real', person: 'reyes' }] });
    assert.equal(bad.status, 400);
    assert.equal((await post('/api/stays', { person: 'reyes', room: 'lab', t: Date.now(), kind: 'simulated', source: 'sim' })).status, 200);
    assert.equal((await post('/api/stays', { person: 'nobody', room: 'lab', t: 1, kind: 'simulated', source: 'sim' })).status, 400);

    await new Promise((done) => setTimeout(done, 100));
    assert.deepEqual(messages.map((m) => m.type), ['rows', 'stay']);
    const state = (await (await fetch(`http://127.0.0.1:${port}/api/state`)).json()) as Extract<HubMessage, { type: 'state' }>;
    assert.equal(state.latest[0].source, 'phone:reyes');
    assert.equal(state.stays[0].room, 'lab');
    socket.close();
  } finally {
    hub.http.closeAllConnections();
    hub.http.close();
    store.close();
  }
});

test('the simulated crew fills three days at startup and does not repeat itself on restart', async () => {
  const { SimulatedCrew } = await import('./crew.ts');
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const now = Date.UTC(2026, 10, 14, 12);
  const crew = new SimulatedCrew(hub, store, profile.crew.map((p) => p.id), 0);
  crew.catchUp(now);
  const count = store.rows({ signal: 'heart_rate', limit: 50_000 }).length;
  assert.equal(count, 4 * 3 * 288);
  assert.equal(store.stays(now + 1, now + 1).length, 4, 'everyone is in exactly one room');
  new SimulatedCrew(hub, store, profile.crew.map((p) => p.id), 0).catchUp(now + 600_000);
  assert.equal(store.rows({ signal: 'heart_rate', limit: 50_000 }).length, count + 4 * 2);
  assert.equal(store.recent(0).filter((r) => r.person === 'reyes' && r.signal === 'heart_rate').length, 1, 'one current heart rate, whatever room it was read in');
  for (const signal of new Set(store.rows({ limit: 50_000 }).map((r) => r.signal))) assert.ok(hasString(`signal.${signal}`), `no string for ${signal}`);
  store.close();
});

test('the NASA replay plays the record unchanged, shifted in time, and marks it replayed', async () => {
  const { NasaReplay, NASA_SOURCE } = await import('./nasa.ts');
  const dir = new URL('../data-nasa/osdr-rr1', import.meta.url).pathname;
  const raw = JSON.parse(readFileSync(`${dir}/co2.json`, 'utf8')) as { time: string; co2_iss: number }[];
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const replay = new NasaReplay(hub, store, dir, profile.rooms.map((r) => r.id));

  // In Quarters 2 the record plays 18 hours ahead of the clock, late in October 2014: under the limit.
  const t = Date.UTC(2026, 10, 15, 14, 36);
  assert.equal(new Date(replay.recordTime('quarters-2', t)).toISOString(), '2014-10-31T08:36:00.000Z');
  const calmDay = replay.at(t).find((r) => r.room === 'quarters-2' && r.signal === 'co2')!;
  const nearby = raw.filter((r) => Math.abs(Date.parse(r.time) - replay.recordTime('quarters-2', t)) <= 300_000).map((r) => Number((r.co2_iss * 760 / 1e6).toFixed(2)));
  assert.ok(nearby.includes(calmDay.value!), 'the value is the record\'s own');
  assert.ok(calmDay.value! < 3);
  // The scenario moves Quarters 2 to the climb: 7 Oct 2014.
  replay.aheadMs = Date.parse('2014-10-07T14:36:00Z') - replay.recordTime('quarters-2', t);
  const original = raw.find((r) => r.time === '2014-10-07T14:36:00Z')!;
  const row = replay.at(t).find((r) => r.room === 'quarters-2' && r.signal === 'co2')!;
  assert.equal(row.value, Number((original.co2_iss * 760 / 1e6).toFixed(2)));
  assert.equal(row.kind, 'replayed');
  assert.equal(row.source, NASA_SOURCE);
  assert.equal(replay.at(t).length, 8 * 3, 'three signals in each of eight rooms');
  assert.equal(replay.at(Date.UTC(2027, 0, 1)).length, 0, 'outside the record it sends nothing');

  replay.catchUp(t);
  const hour = store.rows({ room: 'quarters-2', signal: 'co2', from: t - 3600_000 + 1, to: t }).map((r) => r.value!);
  assert.equal(hour.length, 12);
  assert.ok(hour.reduce((a, b) => a + b, 0) / 12 > 3, 'this hour is above NASA\'s 3 mmHg limit');
  const calm = store.rows({ room: 'lab', signal: 'co2', from: t - 3600_000 + 1, to: t }).map((r) => r.value!);
  assert.ok(Math.max(...calm) < 3);

  const production = new Hub(new Store(':memory:'), profile, '/nonexistent', true);
  assert.equal(production.ingest(replay.at(t)).length, 0, 'production keeps no replayed value');
  store.close();
});

test('the hub tells the chip to beep, and says so when there is no chip', async () => {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  const buzz = (mode: string) => fetch(`http://127.0.0.1:${port}/api/buzz`, { method: 'POST', body: JSON.stringify({ mode }) });
  try {
    assert.equal((await buzz('beep')).status, 503);
    const sent: unknown[] = [];
    hub.chipCommand = (command) => { sent.push(command); return true; };
    assert.equal((await buzz('beep')).status, 200);
    assert.equal((await buzz('alarm')).status, 200);
    assert.equal((await buzz('off')).status, 200);
    assert.equal((await buzz('loud')).status, 400);
    assert.deepEqual(sent, [{ buzz: 'beep' }, { buzz: 'alarm' }, { buzz: 'off' }]);
  } finally {
    hub.http.closeAllConnections();
    hub.http.close();
    store.close();
  }
});

test('the room alarm sounds when the 1-hour CO2 average passes 3 mmHg, and stops when acknowledged or back under', async (t) => {
  const { RoomAlarms } = await import('./alarms.ts');
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const sent: unknown[] = [];
  hub.chipCommand = (command) => { sent.push((command as { buzz: string }).buzz); return true; };
  const alarms = new RoomAlarms(hub, store, ['galley', 'lab']);
  hub.acknowledgeAlarm = (room) => alarms.acknowledge(room);
  const co2 = (room: string, t: number, value: number) => ({ t, signal: 'co2', value, unit: 'mmHg', kind: 'measured' as const, source: 'test', room });
  const start = 1_000_000_000_000;
  t.after(() => { hub.buzz('off'); store.close(); });
  const every5 = (room: string, from: number, minutes: number, value: number) => { for (let m = 0; m < minutes; m += 5) hub.ingest([co2(room, from + m * 60_000, value)]); };

  every5('galley', start, 60, 2.9);
  alarms.check(start + 3600_000);
  assert.deepEqual(sent, [], 'under the limit: silent');

  every5('galley', start + 3600_000, 10, 3.2);
  alarms.check(start + 70 * 60_000);
  assert.deepEqual(sent, [], 'a short spike does not move the hour past the limit');

  every5('galley', start + 70 * 60_000, 60, 3.4);
  every5('lab', start + 70 * 60_000, 60, 3.4);
  alarms.check(start + 130 * 60_000);
  assert.deepEqual(sent, ['alarm']);
  assert.equal(alarms.list().length, 2, 'the lab is over too, but has no chip to sound');
  assert.equal(alarms.list()[0].limit, 3);

  assert.equal(alarms.acknowledge('galley'), true);
  assert.deepEqual(sent, ['alarm', 'off']);
  alarms.check(start + 131 * 60_000);
  assert.deepEqual(sent, ['alarm', 'off'], 'acknowledged: stays silent while still over');

  // A real sensor wanders by a few hundredths; the exact same value for an hour would be "may be stuck".
  for (let m = 0; m < 60; m += 5) hub.ingest([co2('galley', start + (131 + m) * 60_000, 2.0 + (m % 10) / 1000)]);
  alarms.check(start + 191 * 60_000);
  assert.ok(!alarms.list().some((a) => a.room === 'galley'), 'back under the limit: cleared');

  every5('lab', start + 130 * 60_000, 60, 2.0);
  alarms.check(start + 191 * 60_000);
  assert.ok(alarms.list().some((a) => a.room === 'lab'), 'one exact value for an hour may be a stuck sensor: it does not clear the alarm');
  assert.deepEqual(alarms.unjudged.map((u) => [u.room, u.reason]), [['lab', 'stuck']]);

});

test('ten minutes of readings is not a 1-hour average', async () => {
  const { windowAverage } = await import('../engine/cabin.ts');
  const rows = [0, 5].map((m) => ({ t: m * 60_000, signal: 'co2', value: 9, unit: 'mmHg', kind: 'measured' as const, source: 's', room: 'lab' }));
  assert.equal(windowAverage(rows, 'lab', 'co2', 10 * 60_000, 3600_000), null);
});

test('a room over the limit with someone in it raises an alert that escalates, and an answer stops it', async (t) => {
  const { RoomAlarms } = await import('./alarms.ts');
  const { AlertWatcher } = await import('./alerts.ts');
  const { COUNTDOWN_MS } = await import('../engine/alerts.ts');
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  t.after(() => { hub.buzz('off'); store.close(); });
  const alarms = new RoomAlarms(hub, store, ['quarters-2']);
  const watcher = new AlertWatcher(hub, store, profile, alarms);
  const events: string[] = [];
  watcher.onEvent = (e) => events.push(`${e.type}:${e.alert.level}`);
  const start = 1_000_000_000_000;
  for (let m = 0; m < 60; m += 5) hub.ingest([{ t: start + m * 60_000, signal: 'co2', value: 3.4, unit: 'mmHg', kind: 'replayed', source: 'test', room: 'quarters-2' }]);
  hub.move('reyes', 'quarters-2', start, 'simulated', 'test');
  hub.move('leo', 'lab', start, 'simulated', 'test');
  const now = start + 3600_000;
  alarms.check(now);
  watcher.check(now);
  assert.equal(watcher.list().length, 1);
  assert.deepEqual(watcher.list()[0].toldTo, ['reyes', 'okafor']);
  watcher.check(now + COUNTDOWN_MS);
  assert.equal(watcher.list()[0].level, 3);
  assert.equal(watcher.list()[0].card, 'high-co2');
  assert.deepEqual(events, ['raised:2', 'escalated:3']);
  assert.equal(watcher.answer(watcher.list()[0].id, 'ok', now + COUNTDOWN_MS), false, 'too late to answer a level 3');

  hub.move('reyes', 'lab', now + COUNTDOWN_MS + 1000, 'simulated', 'test');
  watcher.check(now + COUNTDOWN_MS + 2000);
  assert.equal(watcher.list().length, 0, 'she is out of the room');
});

test('a check-in arrives over HTTP as reported rows, and production keeps it', async () => {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent', true);
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  const post = (body: unknown) => fetch(`http://127.0.0.1:${port}/api/checkin`, { method: 'POST', body: JSON.stringify(body) });
  try {
    hub.move('reyes', 'quarters-2', Date.now() - 1000, 'measured', 'test');
    const good = await post({ person: 'reyes', answers: [{ signal: 'headache', value: 1 }, { signal: 'mood', value: 40 }] });
    assert.deepEqual(await good.json(), { accepted: 2 });
    const rows = store.rows({ person: 'reyes' });
    assert.deepEqual(rows.map((r) => [r.signal, r.kind, r.source, r.room]), [['checkin.headache', 'reported', 'checkin:reyes', 'quarters-2'], ['checkin.mood', 'reported', 'checkin:reyes', 'quarters-2']]);
    assert.equal((await post({ person: 'nobody', answers: [{ signal: 'headache', value: 1 }] })).status, 400);
    assert.equal((await post({ person: 'reyes', answers: [{ signal: 'BAD signal', value: 1 }] })).status, 400);
  } finally {
    hub.http.closeAllConnections();
    hub.http.close();
    store.close();
  }
});

test('an impossible value is refused at the door, counted, and visible', async () => {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  try {
    const rows = [
      { t: 1000, signal: 'humidity', value: 140, unit: '%', kind: 'measured', room: 'lab' },
      { t: 2000, signal: 'humidity', value: 45, unit: '%', kind: 'measured', room: 'lab' },
      { t: 3000, signal: 'pressure', value: -3, unit: 'hPa', kind: 'measured', room: 'lab' },
    ];
    const res = await fetch(`http://127.0.0.1:${port}/api/readings`, { method: 'POST', body: JSON.stringify({ source: 'chip:cabin-9', rows }) });
    assert.deepEqual(await res.json(), { accepted: 1, rejected: 2 });
    hub.ingest([{ t: 4000, signal: 'humidity', value: 101, unit: '%', kind: 'measured', source: 'chip:cabin-9', room: 'lab' }]);
    assert.deepEqual(store.rows({}).map((r) => r.value), [45], 'only the possible value is stored');
    const quality = (await (await fetch(`http://127.0.0.1:${port}/api/quality`)).json()) as { rejected: { signal: string; count: number; lastValue: number; max: number | null }[] };
    assert.deepEqual(quality.rejected.map((r) => [r.signal, r.count, r.lastValue, r.max]), [['humidity', 2, 101, 100], ['pressure', 1, -3, null]]);
    const state = hub.state() as Extract<HubMessage, { type: 'state' }>;
    assert.equal(state.quality?.rejected.length, 2);
  } finally {
    hub.http.closeAllConnections();
    hub.http.close();
    store.close();
  }
});

test('the alarm watcher keeps an alarm whose sensor went quiet, marked stale, and lists the room as unjudged', async (t) => {
  const { RoomAlarms } = await import('./alarms.ts');
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  t.after(() => { hub.buzz('off'); store.close(); });
  const alarms = new RoomAlarms(hub, store, ['quarters-2']);
  const start = 1_000_000_000_000;
  for (let m = 0; m < 60; m++) hub.ingest([{ t: start + m * 60_000, signal: 'co2', value: 3.4 + (m % 3) / 100, unit: 'mmHg', kind: 'measured', source: 'chip:cabin-1', room: 'quarters-2' }]);
  alarms.check(start + 60 * 60_000);
  assert.equal(alarms.list()[0].stale, false);
  alarms.check(start + 71 * 60_000);
  assert.deepEqual([alarms.list()[0].stale, alarms.list()[0].lastReading], [true, { value: 3.42, t: start + 59 * 60_000 }]);
  // Two hours later, nothing in the window at all: still there, and it still knows the last reading.
  alarms.check(start + 180 * 60_000);
  assert.equal(alarms.list().length, 1);
  assert.deepEqual(alarms.unjudged.map((u) => [u.room, u.reason, u.last?.value]), [['quarters-2', 'no-reading', 3.42]]);
  assert.deepEqual(hub.quality().unjudged, alarms.unjudged);
});

test('the evidence card answers over HTTP for the simulated crew', async () => {
  const { SimulatedCrew } = await import('./crew.ts');
  const { RoomAlarms } = await import('./alarms.ts');
  const { Baselines } = await import('./baseline.ts');
  const { evidenceRoute, evidenceNow, EvidenceCards } = await import('./evidence.ts');
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const ids = profile.crew.map((p) => p.id);
  const now = Date.now();
  new SimulatedCrew(hub, store, ids, 0).catchUp(now);
  const deps = { store, profile, baselines: new Baselines(store, ids, 0), alarms: new RoomAlarms(hub, store, profile.rooms.map((r) => r.id)), offsetMinutes: 0 };
  hub.routes.push(evidenceRoute(profile, new EvidenceCards(deps)));
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/evidence?person=reyes`);
    assert.equal(res.status, 200);
    const e = (await res.json()) as ReturnType<typeof evidenceNow>;
    assert.equal(e.person, 'reyes');
    assert.ok(['room', 'person', 'sensor', 'unknown'].includes(e.pointsTo));
    assert.equal(e.reported.runs.find((r) => r.signal === 'checkin.headache')?.kind, 'simulated');
    assert.equal(e.whereBeen.windows[1].people.length, ids.length);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/evidence?person=nobody`)).status, 400);
  } finally {
    hub.http.closeAllConnections();
    hub.http.close();
    store.close();
  }
});

test('a level 3 in a room with no board sounds the galley board; "I\'ve seen it" over HTTP silences it, the galley\'s own alarm still sounds', async (t) => {
  const { RoomAlarms } = await import('./alarms.ts');
  const { AlertWatcher } = await import('./alerts.ts');
  const { COUNTDOWN_MS, EARTH_KEEP_MS } = await import('../engine/alerts.ts');
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const buzzes: string[] = [];
  hub.chipCommand = (command) => { buzzes.push((command as { buzz: string }).buzz); return false; };
  const alarms = new RoomAlarms(hub, store, ['quarters-2', 'galley']);
  hub.acknowledgeAlarm = (room) => alarms.acknowledge(room);
  const watcher = new AlertWatcher(hub, store, profile, alarms);
  hub.seeAlert = (id, by) => watcher.see(id, by);
  watcher.activity = () => ({ tanaka: { what: 'sleeping', kind: 'simulated' } });
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  t.after(() => { hub.http.closeAllConnections(); hub.http.close(); store.close(); });
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', body: JSON.stringify(body) });

  const start = 1_000_000_000_000;
  const co2 = (room: string, from: number, value: number) => { for (let m = 0; m < 60; m += 5) hub.ingest([{ t: from + m * 60_000, signal: 'co2', value: value + (m % 10) / 1000, unit: 'mmHg', kind: 'replayed', source: 'test', room }]); };
  co2('quarters-2', start, 3.004);
  hub.move('reyes', 'quarters-2', start, 'simulated', 'test');
  const now = start + 3600_000;
  alarms.check(now);
  watcher.check(now);
  assert.equal(alarms.list()[0].over, 0.01, 'just over: "0.01 over", not "3, limit 3"');
  assert.equal(watcher.list()[0].level, 2);
  assert.deepEqual(buzzes, [], 'level 2 in Quarters 2: the galley board is silent');

  watcher.check(now + COUNTDOWN_MS);
  const alert = watcher.list()[0];
  assert.equal(alert.level, 3);
  assert.deepEqual(buzzes, ['alarm'], 'level 3: everyone is told, the galley board sounds');

  // The galley goes over too, with nobody in it.
  co2('galley', start + 61 * 60_000 - 3600_000, 3.4);
  alarms.check(now + COUNTDOWN_MS + 1000);
  assert.deepEqual(buzzes, ['alarm'], 'already sounding');

  assert.equal((await post('/api/alerts/acknowledge', { id: alert.id, by: 'nobody' })).status, 400);
  assert.equal((await post('/api/alerts/acknowledge', { id: 'no-such' })).status, 404);
  assert.equal((await post('/api/alerts/acknowledge', { id: alert.id, by: 'leo' })).status, 200);
  assert.deepEqual([watcher.list()[0].seenBy, watcher.list()[0].level], ['leo', 3], 'who saw it is recorded; the level stays');
  assert.deepEqual(buzzes, ['alarm'], 'the alert is seen, but the galley\'s own alarm still sounds');
  assert.equal((await post('/api/alerts/acknowledge', { id: alert.id })).status, 404, 'seen once');

  assert.equal((await post('/api/alarms/acknowledge', { room: 'galley' })).status, 200);
  assert.deepEqual(buzzes, ['alarm', 'off'], 'both seen: silent');

  // Reyes leaves: her alert ends, the message to Earth stays with its reply pending.
  hub.move('reyes', 'lab', now + COUNTDOWN_MS + 5000, 'simulated', 'test');
  watcher.check(now + COUNTDOWN_MS + 6000);
  const state = (await (await fetch(`http://127.0.0.1:${port}/api/state`)).json()) as Extract<HubMessage, { type: 'state' }>;
  assert.equal(state.alerts.length, 0);
  assert.equal(state.earthMessages?.length, 1);
  assert.equal(state.earthMessages![0].resolvedAt, now + COUNTDOWN_MS + 6000);
  assert.ok(state.earthMessages![0].replyAt > now + COUNTDOWN_MS + 6000, 'Earth\'s reply is still on its way');
  assert.deepEqual(state.asleep, ['tanaka'], 'who is asleep comes from the hub');
  watcher.check(state.earthMessages![0].replyAt + EARTH_KEEP_MS);
  assert.deepEqual(watcher.earthMessages(), []);
});

test('the hub tells screens its clock every 10 seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const heard: HubMessage[] = [];
  hub.onBroadcast = (m) => heard.push(m);
  hub.startClock();
  t.after(() => { hub.stopClock(); store.close(); });
  t.mock.timers.tick(25_000);
  assert.deepEqual(heard.map((m) => m.type), ['clock', 'clock']);
  assert.equal(typeof (heard[0] as { now: number }).now, 'number');
});
