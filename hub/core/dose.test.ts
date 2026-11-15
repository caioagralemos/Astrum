import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './db.ts';
import { Hub } from './server.ts';
import { CrewDose, RateSpans, doseRoute } from './dose.ts';
import { doseOfCrew, rateSpans } from '../engine/dose.ts';
import type { HubMessage, Kind, Profile, Row } from '../engine/types.ts';

const HOUR = 3600_000;
const START = Date.UTC(2026, 10, 1);
const NOW = START + 2 * 24 * HOUR;

const profile: Profile = {
  id: 'test', place: 'place.mars-orbit', missionStart: new Date(START).toISOString(), delayToEarthSeconds: 0,
  rooms: [{ id: 'lab', name: 'room.lab' }, { id: 'galley', name: 'room.galley' }],
  crew: [{ id: 'ana', name: 'Ana', role: 'role.cmo' }, { id: 'ben', name: 'Ben', role: 'role.commander' }],
  chips: {},
  mission: { id: 'test', file: 'test', kind: 'ship', where: { body: 'mars', situation: 'orbit' }, gravity: 0, plannedDays: 10 },
};

function rate(t: number, room: string, value: number, kind: Kind = 'measured', source = 'sensor:rad-1', unit = 'mSv/day'): Row {
  return { t, signal: 'radiation', value, unit, kind, source, room };
}

/** A store with a measured lab monitor every 30 s since the mission start, and Ana in the lab. */
function station(production = false) {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent', production);
  const rows: Row[] = [];
  for (let t = START; t < NOW; t += 30_000) rows.push(rate(t, 'lab', 1.8, 'measured'), rate(t, 'galley', 0.5, 'simulated', 'sim:hub'));
  hub.ingest(rows);
  hub.move('ana', 'lab', START, 'measured', 'test');
  hub.move('ben', 'galley', START, 'simulated', 'sim:crew');
  return { store, hub, rows };
}

test('room rates read a little at a time give the same spans and dose as reading them whole', () => {
  const { store, hub } = station();
  const spans = new RateSpans(store, START);
  spans.at(NOW - 6 * HOUR);
  const more: Row[] = [];
  for (let t = NOW; t < NOW + HOUR; t += 30_000) more.push(rate(t, 'lab', 2.0));
  hub.ingest(more);
  const later = NOW + HOUR;
  const input = (s: ReturnType<RateSpans['at']>) => ({ now: later, missionStart: START, plannedEnd: null, stays: store.stays(START, later), spans: s });
  const step = doseOfCrew(['ana'], input(spans.at(later)));
  const whole = doseOfCrew(['ana'], input(new RateSpans(store, START).at(later)));
  assert.equal(JSON.stringify(step), JSON.stringify(whole));
  // And the same as the engine over the store's own minute samples.
  const engine = doseOfCrew(['ana'], input(rateSpans(store.sampled('radiation', START, later, 60_000))));
  assert.ok(Math.abs(step.ana.amounts[0].mission - engine.ana.amounts[0].mission) < 1e-9);
});

test('the hub pushes each dose in the state and on change, and GET /api/dose returns it', async () => {
  const { store, hub } = station();
  const sent: HubMessage[] = [];
  hub.onBroadcast = (m) => sent.push(m);
  const dose = new CrewDose(store, profile);
  dose.onChange = (all) => hub.setDose(all);
  const all = dose.refresh(NOW);
  assert.equal(all.ana.kind, 'estimated', 'a measured monitor and a measured stay: an estimate, never measured');
  assert.ok(Math.abs(all.ana.amounts[0].mission - 3.6) < 0.01, `two days at 1.8 mSv/day, got ${all.ana.amounts[0].mission}`);
  assert.equal(all.ana.comparable, true);
  assert.equal(all.ben.kind, 'simulated');
  assert.equal(sent.filter((m) => m.type === 'dose').length, 1);
  dose.refresh(NOW + 1000);
  assert.equal(sent.filter((m) => m.type === 'dose').length, 1, 'unchanged: not sent again right away');
  const state = hub.state(NOW) as Extract<HubMessage, { type: 'state' }>;
  assert.deepEqual(Object.keys(state.dose!).sort(), ['ana', 'ben']);

  let body = '';
  let status = 0;
  const res = { writeHead: (s: number) => { status = s; return res; }, end: (b: string) => { body = b; } };
  const route = doseRoute(profile, dose);
  await route({ method: 'GET' } as never, res as never, new URL('http://hub/api/dose?person=ana'));
  assert.equal(status, 200);
  assert.equal(JSON.parse(body).dose.person, 'ana');
  await route({ method: 'GET' } as never, res as never, new URL('http://hub/api/dose?person=nobody'));
  assert.equal(status, 400);
});

test('production keeps no simulated rate, so a crew with only simulated rates and stays has no dose at all', () => {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent', true);
  const rows: Row[] = [];
  for (let t = START; t < NOW; t += 30_000) rows.push(rate(t, 'lab', 1.8, 'simulated', 'sim:hub'));
  hub.ingest(rows);
  hub.move('ana', 'lab', START, 'measured', 'test');
  assert.deepEqual(new CrewDose(store, profile).refresh(NOW), {});
});
