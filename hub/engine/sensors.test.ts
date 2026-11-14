import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtInSignals, checkSensor, crewLimitsOf, isHubSignal, judgeCrewLimits, judgeCrewRooms, nasaLimitOf, outOfBounds, sensorIdOf, sourceOf } from './sensors.ts';
import type { RoomAlarm } from './cabin.ts';
import type { SignalSpec } from './sensors.ts';
import type { Row } from './types.ts';

const profile = {
  rooms: [{ id: 'lab', name: 'room.lab' }, { id: 'galley', name: 'room.galley' }],
  crew: [{ id: 'reyes', name: 'Reyes', role: 'role.engineer' }],
};

// Every level below is a made-up test number, not a recommended limit.
const radiation = { signal: 'radiation', name: 'Radiation', unit: 'uSv/h', decimals: 2, limits: { warnAbove: 10, alarmAbove: 20 }, bounds: { min: 0, max: 1000 }, note: 'test unit' };

test('a well-formed sensor passes and is cleaned up', () => {
  const out = checkSensor({ id: 'rad-1', name: ' Radiation monitor ', room: 'lab', transport: 'http-push', signals: [radiation] }, profile, 5000);
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.sensor, {
    id: 'rad-1', name: 'Radiation monitor', room: 'lab', transport: 'http-push', addedAt: 5000,
    signals: [{ signal: 'radiation', name: 'Radiation', unit: 'uSv/h', group: 'cabin', decimals: 2, note: 'test unit', limits: { warnAbove: 10, alarmAbove: 20 }, bounds: { min: 0, max: 1000 } }],
  });
  assert.equal(sourceOf('rad-1'), 'sensor:rad-1');
  assert.equal(sensorIdOf('sensor:rad-1'), 'rad-1');
  assert.equal(sensorIdOf('chip:cabin-1'), null);
});

test('problems come back in plain words, never thrown', () => {
  assert.deepEqual(checkSensor(null, profile, 0).problems, ['The sensor must be a JSON object.']);
  const bad = checkSensor({
    id: 'Rad 1', name: '', room: 'attic', transport: 'radio',
    signals: [{ signal: 'CO2!', name: 'x', unit: 'a very long unit indeed', decimals: 9 }],
  }, profile, 0);
  assert.equal(bad.sensor, null);
  for (const pattern of [/id must be/, /needs a name/, /transport/, /no room "attic"/, /key must be/, /unit must be/, /decimals/]) {
    assert.ok(bad.problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}: ${bad.problems.join(' | ')}`);
  }
  assert.match(checkSensor({ id: 'a', name: 'A', person: 'nobody', transport: 'http-push', signals: [radiation] }, profile, 0).problems.join(), /no crewmate/);
  assert.match(checkSensor({ id: 'a', name: 'A', room: 'lab', person: 'reyes', transport: 'http-push', signals: [radiation] }, profile, 0).problems.join(), /not both/);
  assert.match(checkSensor({ id: 'a', name: 'A', transport: 'http-push', signals: [radiation] }, profile, 0).problems.join(), /which room/);
  assert.match(checkSensor({ id: 'a', name: 'A', room: 'lab', transport: 'http-push', signals: [radiation, radiation] }, profile, 0).problems.join(), /listed twice/);
  assert.match(checkSensor({ id: 'a', name: 'A', room: 'lab', transport: 'http-push', signals: [] }, profile, 0).problems.join(), /at least one signal/);
  assert.match(checkSensor({ id: 'a', name: 'A', person: 'reyes', transport: 'http-push', signals: [{ ...radiation, group: 'cabin' }] }, profile, 0).problems.join(), /body signals only/);
});

test('levels must be ordered sensibly and reachable', () => {
  const problems = (limits: object, bounds?: object) =>
    checkSensor({ id: 'a', name: 'A', room: 'lab', transport: 'http-push', signals: [{ ...radiation, limits, bounds }] }, profile, 0).problems.join(' | ');
  assert.match(problems({ warnAbove: 20, alarmAbove: 10 }), /"warn above" must be lower/);
  assert.match(problems({ warnBelow: 1, alarmBelow: 2 }), /"warn below" must be higher/);
  assert.match(problems({ warnBelow: 30, warnAbove: 10 }), /"below" levels must be lower/);
  assert.match(problems({ alarmAbove: 5000 }, { min: 0, max: 1000 }), /can never be reached/);
  assert.match(problems({ windowMinutes: 10 }), /needs at least one level/);
  assert.match(problems({ alarmAbove: 5, windowMinutes: 0.5 }), /whole number of minutes/);
  assert.match(problems({ alarmAbove: 'high' }), /must be a number/);
  assert.match(problems({ alarmAbove: 5, danger: 1 }), /"danger" is not one of/);
  assert.match(problems({}, { min: 5, max: 1 }), /lowest possible value must be below/);
  assert.equal(problems({ warnBelow: 1, alarmBelow: 0.5, warnAbove: 10, alarmAbove: 20, windowMinutes: 60 }), '');
  assert.equal(problems({ warnAbove: null, alarmAbove: 3 }), '', 'an empty field is simply not set');
});

test('a signal with a NASA limit keeps it: unit must match, and both are reported apart', () => {
  const co2 = { signal: 'co2', name: 'CO2, backup', unit: 'ppm', decimals: 0, limits: { alarmAbove: 9 }, note: '' };
  const wrong = checkSensor({ id: 'co2-b', name: 'CO2 backup', room: 'lab', transport: 'http-push', signals: [co2] }, profile, 0);
  assert.equal(wrong.sensor, null);
  assert.match(wrong.problems.join(), /NASA's limit for this signal is written in mmHg/);

  const right = checkSensor({ id: 'co2-b', name: 'CO2 backup', room: 'lab', transport: 'http-push', signals: [{ ...co2, unit: 'mmHg' }] }, profile, 0);
  assert.ok(right.sensor);
  assert.match(right.notices.join(), /NASA's limit \(3 mmHg, 60-minute average\) still applies and is judged on its own/);

  const spec = right.sensor!.signals[0];
  assert.deepEqual(crewLimitsOf(spec), { alarmAbove: 9, limitSource: 'crew' });
  assert.equal(nasaLimitOf('co2')!.limitSource, 'nasa');
  assert.equal(nasaLimitOf('co2')!.max, 3, 'the crew\'s 9 never replaces NASA\'s 3');
  assert.equal(nasaLimitOf('radiation'), null, 'no limit is made up for a signal NASA gives none for here');

  // A judgement against the crew's levels never says it is NASA's.
  const rows: Row[] = [{ t: 1000, signal: 'co2', value: 4, unit: 'mmHg', kind: 'measured', source: 'sensor:co2-b', room: 'lab' }];
  const j = judgeCrewLimits(spec, rows, 1000)!;
  assert.equal(j.level, 'ok', '4 mmHg is under the crew\'s 9; that it is over NASA\'s 3 is for cabin.ts to say');
  assert.equal(j.limitSource, 'crew');
});

test('a unit already arriving in another unit is pointed out, not refused', () => {
  const out = checkSensor({ id: 'rad-1', name: 'R', room: 'lab', transport: 'serial-json', signals: [radiation] }, profile, 0, { radiation: ['uGy/day', 'uSv/h'] });
  assert.ok(out.sensor);
  assert.match(out.notices.join(), /already arrive in uGy\/day/);
});

test('with no levels set, a signal is shown and never judged', () => {
  const spec: SignalSpec = { signal: 'oxygen_pct', name: 'Oxygen', unit: '%', group: 'cabin', decimals: 1, note: '' };
  const rows: Row[] = [{ t: 0, signal: 'oxygen_pct', value: 1, unit: '%', kind: 'measured', source: 'sensor:o2', room: 'lab' }];
  assert.equal(judgeCrewLimits(spec, rows, 0), null);
  assert.equal(judgeCrewLimits({ ...spec, limits: { windowMinutes: 5 } }, rows, 0), null);
});

test('the newest reading is judged against the crew\'s levels, labelled as the crew\'s', () => {
  const spec: SignalSpec = { signal: 'radiation', name: 'Radiation', unit: 'uSv/h', group: 'cabin', decimals: 2, note: '', limits: { warnAbove: 10, alarmAbove: 20, warnBelow: 1 } };
  const at = (value: number, t = 1000, kind: Row['kind'] = 'measured', unit = 'uSv/h'): Row => ({ t, signal: 'radiation', value, unit, kind, source: 'sensor:rad-1', room: 'lab' });
  const judge = (rows: Row[], now = 1000) => judgeCrewLimits(spec, rows, now)!;
  assert.deepEqual(judge([at(5)]), { level: 'ok', limitSource: 'crew', limit: null, direction: null, value: 5, basis: 'latest', windowMinutes: null, kind: 'measured', at: 1000 });
  assert.deepEqual([judge([at(10)]).level, judge([at(10.1)]).level, judge([at(20)]).level, judge([at(21)]).level], ['ok', 'warn', 'warn', 'alarm']);
  assert.deepEqual([judge([at(21)]).limit, judge([at(21)]).direction], [20, 'above']);
  assert.deepEqual([judge([at(0.5)]).level, judge([at(0.5)]).direction], ['warn', 'below']);
  assert.equal(judge([at(25, 500), at(5, 900)]).level, 'ok', 'the newest reading counts');
  assert.equal(judge([at(25, 1000, 'simulated')]).kind, 'simulated', 'the device\'s kind is kept, never upgraded');
  assert.deepEqual(judge([]).level, 'unjudged');
  assert.equal(judge([]).reason, 'no-reading');
  assert.equal(judge([at(25, 0)], 700_000).reason, 'stale', 'a quiet sensor is not called ok');
  assert.equal(judge([at(25, 1000, 'measured', 'mSv/h')]).reason, 'no-reading', 'a reading in another unit is not judged');
});

test('with a window, the time-weighted average is judged, and a short run is not enough', () => {
  const spec: SignalSpec = { signal: 'radiation', name: 'Radiation', unit: 'uSv/h', group: 'cabin', decimals: 2, note: '', limits: { alarmAbove: 20, windowMinutes: 10 } };
  const row = (t: number, value: number): Row => ({ t, signal: 'radiation', value, unit: 'uSv/h', kind: 'measured', source: 'sensor:rad-1', room: 'lab' });
  const minute = 60_000;
  // 9 minutes at 10, then 1 minute at 100: the newest reading is high, the average is 19.
  const rows = [row(0, 10), row(9 * minute, 100)];
  const j = judgeCrewLimits(spec, rows, 10 * minute)!;
  assert.equal(j.basis, 'average');
  assert.equal(j.level, 'ok');
  assert.ok(Math.abs(j.value! - 19) < 1e-9);
  assert.equal(judgeCrewLimits(spec, [row(0, 10), row(5 * minute, 100)], 10 * minute)!.level, 'alarm');
  const short = judgeCrewLimits(spec, [row(9 * minute, 100)], 10 * minute)!;
  assert.deepEqual([short.level, short.reason], ['unjudged', 'not-enough']);
});

test('physical bounds refuse only in the registered unit', () => {
  const spec = { unit: 'uSv/h', bounds: { min: 0, max: 1000 } };
  assert.deepEqual(outOfBounds(spec, { value: -1, unit: 'uSv/h' }), { min: 0, max: 1000 });
  assert.equal(outOfBounds(spec, { value: 5, unit: 'uSv/h' }), null);
  assert.equal(outOfBounds(spec, { value: -1, unit: 'other' }), null);
  assert.equal(outOfBounds(spec, { value: null, unit: 'uSv/h' }), null);
  assert.equal(outOfBounds({ unit: 'uSv/h' }, { value: -1, unit: 'uSv/h' }), null);
});

test('the built-in signals come from the string table, with NASA\'s limits marked as NASA\'s', () => {
  const list = builtInSignals();
  const co2 = list.find((b) => b.signal === 'co2')!;
  assert.equal(co2.nameKey, 'signal.co2');
  assert.equal(co2.nasaLimit!.max, 3);
  assert.equal(list.find((b) => b.signal === 'radiation')!.nasaLimit, null);
  assert.deepEqual(list.find((b) => b.signal === 'humidity')!.bound, { unit: '%', min: 0, max: 100 });
});

test('a crew alarm level broken in a room is a room alarm of its own, labelled as the crew\'s', () => {
  const spec: SignalSpec = { signal: 'radiation', name: 'Radiation', unit: 'uSv/h', group: 'cabin', decimals: 2, note: '', limits: { warnAbove: 10, alarmAbove: 20 } };
  const sensor = { id: 'rad-1', room: 'lab' };
  const at = (value: number, t: number): Row => ({ t, signal: 'radiation', value, unit: 'uSv/h', kind: 'measured', source: 'sensor:rad-1', room: 'lab' });
  const judge = (rows: Row[], now: number, before: RoomAlarm[] = [], stuck = false) =>
    judgeCrewRooms([{ sensor, spec, rows }], now, before, stuck ? [{ room: 'lab', signal: 'radiation', source: 'sensor:rad-1', kind: 'measured', value: 25, from: 0, to: now, count: 40 } as never] : []);

  const raised = judge([at(25, 1000)], 1000);
  assert.equal(raised.alarms.length, 1);
  const a = raised.alarms[0];
  assert.deepEqual(
    [a.room, a.signal, a.value, a.over, a.limit, a.limitSource, a.direction, a.kind, a.source, a.since, a.acknowledged, a.stale, a.textKey],
    ['lab', 'radiation', 25, 5, 20, 'crew', 'above', 'measured', 'sensor:rad-1', 1000, false, false, 'alarm.crewLevel.above'],
  );
  assert.deepEqual(raised.watch, []);

  // Still over: the first `since` and the acknowledgement are kept.
  const later = judge([at(26, 5000)], 5000, [{ ...a, acknowledged: true }]);
  assert.deepEqual([later.alarms[0].since, later.alarms[0].acknowledged, later.alarms[0].value], [1000, true, 26]);

  // The sensor goes quiet: the alarm stays, marked stale. It never clears by silence.
  const quiet = judge([at(25, 1000)], 1000 + 700_000, [a]);
  assert.deepEqual([quiet.alarms.length, quiet.alarms[0].stale, quiet.alarms[0].lastReading], [1, true, { value: 25, t: 1000 }]);

  // A stuck sensor under the level does not clear it either.
  assert.equal(judge([at(5, 9000)], 9000, [a], true).alarms.length, 1);
  assert.equal(judge([at(25, 9000)], 9000, [], true).alarms[0].stuck, true, 'over the level on a stuck sensor still alarms, marked');

  // Back within the levels: it clears.
  assert.deepEqual(judge([at(5, 9000)], 9000, [a]), { alarms: [], watch: [] });

  // Past "warn" only: the room is marked watch, nothing else.
  const warn = judge([at(12, 9000)], 9000);
  assert.deepEqual(warn.alarms, []);
  assert.deepEqual([warn.watch[0].room, warn.watch[0].value, warn.watch[0].limit, warn.watch[0].direction, warn.watch[0].limitSource], ['lab', 12, 10, 'above', 'crew']);

  // A body sensor's levels never make a room alarm; a NASA alarm in the same room is never taken for the crew's.
  assert.deepEqual(judgeCrewRooms([{ sensor: { id: 'hr-1', room: undefined }, spec: { ...spec, group: 'body' }, rows: [] }], 1000, [], []), { alarms: [], watch: [] });
  const nasa: RoomAlarm = { room: 'lab', signal: 'radiation', value: 99, unit: 'uSv/h', limit: 1, limitSource: 'NASA', kind: 'measured', source: 'sensor:rad-1', since: 0, acknowledged: true };
  assert.equal(judge([at(5, 9000)], 9000, [nasa]).alarms.length, 0, 'only its own alarm is carried over');
});

test('the hub\'s own signals are known by namespace: check-ins, messages to Earth, blood results', () => {
  assert.deepEqual(['checkin.headache', 'checkin.anything', 'earth.message', 'blood.glucose', 'radiation', 'co2'].map(isHubSignal), [true, true, true, true, false, false]);
  const named = builtInSignals().map((b) => b.signal);
  for (const signal of ['checkin.headache', 'checkin.mood', 'checkin.stress', 'checkin.fatigue', 'earth.message']) assert.ok(named.includes(signal), signal);
});
