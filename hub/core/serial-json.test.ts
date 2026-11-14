import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialJsonAdapter, parseSensorLine } from './serial-json.ts';
import type { SensorDirectory, SensorPlace } from './serial-json.ts';
import type { Row, SourceStatus } from '../engine/types.ts';

const places: Record<string, SensorPlace> = { 'rad-1': { room: 'lab' }, 'band-1': { person: 'reyes' } };
const placeOf = (id: string) => places[id] ?? null;

test('a registered sensor\'s line becomes rows in its room, from its own source', () => {
  const out = parseSensorLine('{"sensor":"rad-1","r":[["radiation",0.31,"uSv/h","m"],["dose",1.2,"uSv","e"]]}', 5000, placeOf)!;
  assert.equal(out.known, true);
  assert.deepEqual(out.rows, [
    { t: 5000, signal: 'radiation', value: 0.31, unit: 'uSv/h', kind: 'measured', source: 'sensor:rad-1', person: null, room: 'lab' },
    { t: 5000, signal: 'dose', value: 1.2, unit: 'uSv', kind: 'estimated', source: 'sensor:rad-1', person: null, room: 'lab' },
  ]);
  const body = parseSensorLine('{"sensor":"band-1","r":[["skin_temp",33.1,"C","measured"]]}', 1, placeOf)!;
  assert.deepEqual([body.rows[0].person, body.rows[0].room, body.rows[0].kind], ['reyes', null, 'measured']);
});

test('the kind is the device\'s own; a simulated reading stays simulated', () => {
  const out = parseSensorLine('{"sensor":"rad-1","r":[["radiation",0.3,"uSv/h","s"]]}', 1, placeOf)!;
  assert.equal(out.rows[0].kind, 'simulated');
});

test('noise and bad readings are dropped; no value is filled in', () => {
  assert.equal(parseSensorLine('ets Jul 29 2019 12:21:46', 0, placeOf), null);
  assert.equal(parseSensorLine('{"chip":"cabin-1","r":[]}', 0, placeOf), null, 'a chip line is not a sensor line');
  assert.equal(parseSensorLine('{"sensor":"Bad Id","r":[]}', 0, placeOf), null);
  assert.equal(parseSensorLine('[1,2]', 0, placeOf), null);
  const out = parseSensorLine('{"sensor":"rad-1","r":[["radiation",null,"uSv/h","m"],["radiation","0.3","uSv/h","m"],["radiation",0.3,"uSv/h","x"],["Radiation!",0.3,"uSv/h","m"],["radiation",0.3,"uSv/h","r"],"junk",["radiation",0.4,"uSv/h","m"]]}', 0, placeOf)!;
  assert.deepEqual(out.rows.map((r) => r.value), [0.4]);
});

test('a line from an unregistered sensor stores nothing but names what it carries', () => {
  const out = parseSensorLine('{"sensor":"o2-7","r":[["oxygen_pct",20.9,"%","m"]]}', 0, placeOf)!;
  assert.deepEqual(out, { sensor: 'o2-7', known: false, rows: [], signals: ['oxygen_pct'] });
});

test('the adapter sends rows and status for known sensors and reports unknown ones', () => {
  const rows: Row[] = [];
  const statuses: SourceStatus[] = [];
  const heard: string[] = [];
  const directory: SensorDirectory = { placeOf, heardUnknown: (id, _at, via, signals) => heard.push(`${id} ${via} ${signals.join(',')}`) };
  // Never started, so no port is opened: lines are fed by hand.
  const adapter = new SerialJsonAdapter({ rows: (r) => rows.push(...r), status: (s) => statuses.push(s) }, directory, '/dev/none');
  adapter.onLine('{"sensor":"rad-1","r":[["radiation",0.31,"uSv/h","m"]]}', 1000);
  adapter.onLine('{"sensor":"o2-7","r":[["oxygen_pct",20.9,"%","m"]]}', 1100);
  adapter.onLine('boot noise', 1200);
  assert.deepEqual(rows.map((r) => [r.source, r.signal, r.value]), [['sensor:rad-1', 'radiation', 0.31]]);
  assert.deepEqual(statuses, [{ id: 'sensor:rad-1', connected: true, room: 'lab', live: ['radiation'], missing: [], lastSeen: 1000 }]);
  assert.deepEqual(heard, ['o2-7 serial:/dev/none oxygen_pct']);
  adapter.stop();
});
