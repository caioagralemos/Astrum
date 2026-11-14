import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './db.ts';
import { Hub } from './server.ts';
import { CALM_FROM, CLIMB_FROM, SCENARIO_ID, SCENARIO_SOURCE, ScenarioPlayer, recordReyesNight, scenarioRoute } from './scenario.ts';
import { NASA_SOURCE } from './nasa.ts';
import { COUNTDOWN_MS, RESCUER_COUNTDOWN_MS } from '../engine/alerts.ts';
import type { Alert } from '../engine/alerts.ts';
import type { HubMessage, Profile, Recording } from '../engine/types.ts';

const hubDir = fileURLToPath(new URL('..', import.meta.url));
const profile = JSON.parse(readFileSync(new URL('../profiles/mars-orbit.json', import.meta.url), 'utf8')) as Profile;

// Recording the night takes a few seconds; the tests share one.
let shared: Recording | null = null;
// Recorded as `npm run scenario` does: pinned to the ship's mission file.
const night = () => (shared ??= recordReyesNight(hubDir).recording);

interface Play { room: string; from: number; until: number; recordFrom: string; recordUntil: string }
const plays = (r: Recording) => (r.meta!.record as { plays: Play[] }).plays;
const moment = (r: Recording, starts: string) => r.meta!.moments.find((m) => m.what.startsWith(starts))!.at;

test('the same inputs record the same night, byte for byte', () => {
  const again = recordReyesNight(hubDir).recording;
  assert.equal(JSON.stringify(again), JSON.stringify(night()));
});

test('the story is the ship\'s, whatever mission the hub runs', () => {
  const first = night().messages[0].message;
  assert.ok(first.type === 'state');
  assert.equal(first.profile.mission?.file, 'ship-mars-orbit');
  const { mission: _m, ...rest } = first.profile;
  assert.deepEqual(rest, profile, 'the ship\'s rooms and crew, exactly as the old profile file has them');
});

test('the night runs in order: quiet act 1, alarm, level 2 to Reyes and the medical officer, level 3, resolved', () => {
  const r = night();
  const { messages } = r;
  assert.equal(messages[0].message.type, 'state', 'a player needs nothing before the first message');
  assert.ok(messages.every((m) => m.message.scenario?.id === SCENARIO_ID && m.message.scenario.label === 'scenario.simulated' && m.message.scenario.at === m.at));
  assert.ok(messages.every((m, i) => i === 0 || m.at >= messages[i - 1].at));
  assert.equal((r.meta!.actOne as { pointsTo: string }).pointsTo, 'room', 'act 1: Reyes\'s evidence card points to the room');

  const airStops = moment(r, 'The air stops');
  const alarmsAt = (m: HubMessage) => (m.type === 'alarms' || m.type === 'state' ? m.alarms : null);
  const q2Alarm = messages.find((m) => alarmsAt(m.message)?.some((a) => a.room === 'quarters-2'))!;
  assert.ok(!messages.some((m) => m.at < airStops && alarmsAt(m.message)?.length), 'no alarm in act 1');
  assert.ok(q2Alarm.at > airStops);

  const alertsOf = (m: HubMessage): Alert[] | null => (m.type === 'alerts' || m.type === 'state' ? m.alerts : null);
  const reyes = (level: number) => messages.find((m) => alertsOf(m.message)?.some((a) => a.person === 'reyes' && a.level === level));
  const two = reyes(2)!;
  const three = reyes(3)!;
  assert.ok(!messages.some((m) => m.at < q2Alarm.at && alertsOf(m.message)?.length), 'no alert before the alarm');
  const asked = alertsOf(two.message)!.find((a) => a.person === 'reyes')!;
  assert.equal(two.at, q2Alarm.at);
  assert.deepEqual(asked.toldTo, ['reyes', 'okafor'], 'Reyes and the Crew Medical Officer only');
  assert.equal(asked.answer, null, 'she does not answer');
  const told = alertsOf(three.message)!.find((a) => a.person === 'reyes')!;
  assert.equal(three.at - two.at, COUNTDOWN_MS, 'level 3 when the countdown ends');
  assert.equal(told.toldTo, 'everyone');
  assert.equal(told.card, 'high-co2');
  assert.deepEqual(told.earth, { sentAt: three.at, arrivesAt: three.at + profile.delayToEarthSeconds * 1000, replyAt: three.at + 2 * profile.delayToEarthSeconds * 1000 });

  const out = messages.find((m) => m.message.type === 'stay' && m.message.stays.some((s) => s.person === 'reyes' && s.room === 'galley' && s.until === null))!;
  assert.ok(out.at > three.at);
  const resolved = messages.find((m) => m.at >= three.at && m.message.type === 'alerts' && !m.message.alerts.some((a) => a.person === 'reyes'))!;
  assert.equal(resolved.at, out.at, 'her alert resolves when she is out of the room');
  assert.ok(resolved.at < told.earth!.replyAt, 'Earth\'s reply is still on its way');
  const clear = messages.find((m) => m.at > q2Alarm.at && m.message.type === 'alarms' && !m.message.alarms.length)!;
  assert.ok(clear.at > moment(r, 'Airflow restored'), 'the room alarm clears after the airflow is back');
  assert.ok(!messages.some((m) => alertsOf(m.message)?.some((a) => a.person === 'leo' || a.person === 'tanaka')), 'nobody else is raised');
});

test('the galley board sounds at level 3, the helper is not escalated, and the message to Earth outlives the alert', () => {
  const r = night();
  const { messages } = r;
  const alertsOf = (m: HubMessage): Alert[] | null => (m.type === 'alerts' || m.type === 'state' ? m.alerts : null);
  const three = messages.find((m) => alertsOf(m.message)?.some((a) => a.person === 'reyes' && a.level === 3))!;
  assert.equal(moment(r, 'The board in galley sounds'), three.at, 'the galley board sounds at level 3, though the alarm is in Quarters 2');
  assert.equal(moment(r, 'The board in galley goes quiet'), moment(r, 'Okafor taps'), 'and stops when Okafor says he has seen it');
  assert.ok(messages.some((m) => alertsOf(m.message)?.some((a) => a.person === 'reyes' && a.seenBy === 'okafor')));

  const helper = messages.flatMap((m) => alertsOf(m.message) ?? []).filter((a) => a.person === 'okafor');
  assert.ok(helper.length > 0, 'Okafor is asked when he walks in');
  assert.ok(helper.every((a) => a.level === 2 && a.askKey === 'alert.enteredOverLimit'), 'he is never escalated');
  assert.equal(helper[0].answerBy! - helper[0].levelSince, RESCUER_COUNTDOWN_MS);

  const earth = messages.filter((m) => m.message.type === 'earth' || m.message.type === 'state').at(-1)!.message;
  const listed = earth.type === 'earth' ? earth.earthMessages : earth.type === 'state' ? earth.earthMessages ?? [] : [];
  assert.equal(listed.length, 1, 'one message to Earth, still listed at the end');
  assert.equal(listed[0].about.person, 'reyes');
  assert.ok(listed[0].resolvedAt !== null && listed[0].resolvedAt < r.meta!.endsAt, 'her alert has ended');
  assert.ok(listed[0].replyAt > r.meta!.endsAt, 'Earth\'s reply is still on its way');

  const first = messages[0].message;
  assert.ok(first.type === 'state' && first.asleep?.includes('reyes'), 'Reyes is asleep whatever the viewer\'s time zone');
  const woke = messages.find((m) => m.message.type === 'asleep' && !m.message.asleep.includes('reyes'))!;
  assert.equal(woke.at, moment(r, 'Okafor gets Reyes out'), 'she counts as awake once she is out of her quarters');
});

test('what is replayed is NASA\'s record, and everything else about the crew is simulated', () => {
  const r = night();
  const dir = new URL('../data-nasa/osdr-rr1/', import.meta.url);
  const raw = JSON.parse(readFileSync(new URL('co2.json', dir), 'utf8')) as { time: string; co2_iss: number }[];
  const mmHg = (ppm: number) => Number((ppm * 760 / 1e6).toFixed(2));
  // The same 5-minute grid core/nasa.ts puts the record on.
  const start = Date.parse(raw[0].time);
  const grid: number[] = [];
  for (const item of raw) grid[Math.round((Date.parse(item.time) - start) / 300_000)] = item.co2_iss;
  for (let i = 1; i < grid.length; i++) grid[i] ??= grid[i - 1];
  const recordAt = (room: string, t: number) => {
    const play = plays(r).filter((p) => p.room === room && p.from <= t).at(-1)!;
    return Date.parse(play.recordFrom) + (t - play.from);
  };

  const rows = r.messages.flatMap((m) => (m.message.type === 'rows' ? m.message.rows : []));
  const co2 = rows.filter((row) => row.signal === 'co2' && row.source === NASA_SOURCE);
  assert.ok(co2.length > 1000);
  for (const row of co2) {
    assert.equal(row.kind, 'replayed');
    assert.equal(row.value, mmHg(grid[Math.floor((recordAt(row.room!, row.t) - start) / 300_000)]), `${row.room} at ${row.t}`);
  }
  // Spot checks against the raw file by its own timestamps, which sit up to 2 minutes off the grid.
  const rawAt = (time: string) => mmHg(raw.find((x) => x.time === time)!.co2_iss);
  const q2 = (t: number) => co2.filter((row) => row.room === 'quarters-2' && row.t <= t).at(-1)!.value;
  const climb = plays(r).find((p) => p.recordFrom === CLIMB_FROM)!;
  for (const [minutes, time] of [[0, '2014-10-21T22:43:00Z'], [10, '2014-10-21T22:53:00Z'], [40, '2014-10-21T23:23:00Z'], [70, '2014-10-21T23:53:00Z']] as const) {
    assert.equal(q2(climb.from + minutes * 60_000), rawAt(time), time);
  }
  assert.deepEqual(['2014-10-21T22:43:00Z', '2014-10-21T23:53:00Z'].map(rawAt), [2.79, 3.14]);
  const calm = plays(r).filter((p) => p.room === 'quarters-2').at(-1)!;
  assert.equal(calm.recordFrom, CALM_FROM);
  assert.equal(q2(calm.from), rawAt('2014-10-15T00:40:00Z'));

  const stays = r.messages.flatMap((m) => (m.message.type === 'stay' ? m.message.stays : []));
  const first = r.messages[0].message;
  assert.ok(stays.length && [...stays, ...(first.type === 'state' ? first.stays : [])].every((s) => s.kind === 'simulated'));
  assert.ok(stays.filter((s) => s.from > r.meta!.startsAt).every((s) => s.source === SCENARIO_SOURCE), 'the night\'s moves are the scenario\'s');
  assert.ok(rows.filter((row) => row.person === 'reyes').every((row) => row.kind === 'simulated'));
  assert.ok(rows.every((row) => row.kind === 'simulated' || row.kind === 'replayed'));
});

test('on the live hub a scenario plays to every screen, sounds the board, stores nothing and hands back live state', async () => {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  const buzzes: string[] = [];
  hub.chipCommand = (command) => { buzzes.push((command as { buzz: string }).buzz); return true; };
  hub.ingest([{ t: Date.now(), signal: 'pressure', value: 1009, unit: 'hPa', kind: 'measured', source: 'chip:cabin-1', room: 'quarters-2' }]);
  const rowsBefore = store.rows({ limit: 50_000 }).length;
  const r = night();
  // The whole night in about half a second.
  const fast: Recording = { ...r, meta: { ...r.meta!, speed: [[r.meta!.startsAt, (r.meta!.endsAt - r.meta!.startsAt) / 500]] } };
  const player = new ScenarioPlayer({ hub, load: (id) => (id === SCENARIO_ID ? fast : null), list: () => [SCENARIO_ID] });
  hub.routes.push(scenarioRoute(player, false));
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  const url = (path: string) => `http://127.0.0.1:${port}${path}`;
  const socket = new WebSocket(url('/ws').replace('http', 'ws'));
  try {
    const heard: HubMessage[] = [];
    socket.addEventListener('message', (e) => heard.push(JSON.parse(String(e.data))));
    await new Promise((done) => socket.addEventListener('open', done, { once: true }));
    await new Promise((done) => setTimeout(done, 50));

    const start = await fetch(url('/api/scenario/start'), { method: 'POST', body: JSON.stringify({ id: SCENARIO_ID }) });
    assert.deepEqual(await start.json(), { playing: SCENARIO_ID });
    assert.equal((await fetch(url('/api/scenario/start'), { method: 'POST', body: JSON.stringify({ id: 'nothing' }) })).status, 404);
    hub.ingest([{ t: Date.now(), signal: 'pressure', value: 1010, unit: 'hPa', kind: 'measured', source: 'chip:cabin-1', room: 'quarters-2' }]);
    const status = (await (await fetch(url('/api/scenario'))).json()) as { playing: string };
    assert.equal(status.playing, SCENARIO_ID);
    // A screen that connects in the middle gets the scenario, not the live station.
    const late = new WebSocket(url('/ws').replace('http', 'ws'));
    const lateFirst = await new Promise<HubMessage>((done) => late.addEventListener('message', (e) => done(JSON.parse(String(e.data))), { once: true }));
    late.close();
    assert.equal(lateFirst.scenario?.id, SCENARIO_ID);

    for (let i = 0; i < 100 && (await (await fetch(url('/api/scenario'))).json() as { playing: string | null }).playing; i++) await new Promise((done) => setTimeout(done, 50));
    await new Promise((done) => setTimeout(done, 100));

    const flagged = heard.filter((m) => m.scenario);
    assert.equal(heard[0].type, 'state');
    assert.equal(heard[0].scenario, undefined, 'the first state is live');
    assert.equal(flagged.length, r.messages.length, 'every message of the recording, and only those, while it plays');
    assert.ok(heard.slice(1, -1).every((m) => m.scenario), 'live messages are dropped while it plays');
    const last = heard.at(-1)!;
    assert.equal(last.type, 'state');
    assert.equal(last.scenario, undefined, 'it ends with a fresh live state');
    if (last.type === 'state') assert.ok(last.latest.some((row) => row.value === 1010), 'the live state holds what arrived meanwhile');
    assert.deepEqual(buzzes, ['alarm', 'off'], 'the galley board sounds at level 3 and stops when it is seen, through Hub.soundBoard');
    assert.equal(store.rows({ limit: 50_000 }).length, rowsBefore + 1, 'nothing from the recording is stored');
    assert.equal(store.stays(0, Date.now() + 1e12).length, 0);
    assert.equal((await fetch(url('/api/scenario/stop'), { method: 'POST' }).then((x) => x.json()) as { stopped: boolean }).stopped, false);
  } finally {
    player.stop();
    hub.buzz('off');
    socket.close();
    hub.http.closeAllConnections();
    hub.http.close();
    store.close();
  }
});

test('in production the scenario endpoints refuse', async () => {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent', true);
  const player = new ScenarioPlayer({ hub, load: () => night() });
  hub.routes.push(scenarioRoute(player, true));
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/scenario`)).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/scenario/start`, { method: 'POST', body: JSON.stringify({ id: SCENARIO_ID }) })).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/scenario/stop`, { method: 'POST' })).status, 403);
    assert.equal(player.status().playing, null);
  } finally {
    hub.http.closeAllConnections();
    hub.http.close();
    store.close();
  }
});
