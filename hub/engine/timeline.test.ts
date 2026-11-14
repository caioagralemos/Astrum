import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOCK_SLACK_MS, SCENARIO_GAP_MS, clockOffset, current, occupants, rowProblem, screenNow, timeInRooms } from './timeline.ts';
import { allStrings, t } from './strings.ts';
import type { Row, Stay } from './types.ts';

const row = (over: Partial<Row>): Row => ({ t: 1000, signal: 'co2', value: 1, unit: 'mmHg', kind: 'simulated', source: 'sim', room: 'lab', ...over });

test('a fresh measured reading wins over a newer simulated one', () => {
  const now = 10_000;
  const out = current([row({ t: 9000, kind: 'measured', source: 'chip:a', value: 2 }), row({ t: 9900, value: 3 })], now);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 2);
});

test('when the real sensor goes quiet the simulated reading takes over', () => {
  const now = 100_000;
  const out = current([row({ t: 9000, kind: 'measured', source: 'chip:a', value: 2 }), row({ t: 99_000, value: 3 })], now);
  assert.equal(out[0].value, 3);
  assert.equal(out[0].kind, 'simulated');
});

test('with nothing fresh the newest reading is kept, whatever its kind', () => {
  const out = current([row({ t: 1000, kind: 'measured', value: 2 }), row({ t: 2000, value: 3 })], 900_000);
  assert.equal(out[0].value, 3);
});

test('rooms, people and signals are kept apart, and the future is ignored', () => {
  const out = current([
    row({ room: 'lab' }), row({ room: 'galley' }), row({ signal: 'temperature' }),
    row({ room: null, person: 'reyes', signal: 'heart_rate' }), row({ t: 99_999, value: 9 }),
  ], 5000);
  assert.equal(out.length, 4);
  assert.ok(out.every((r) => r.value !== 9));
});

test('time in rooms clips stays to the period and counts open stays to its end', () => {
  const stays: Stay[] = [
    { person: 'reyes', room: 'lab', from: 0, until: 4000, kind: 'simulated', source: 's' },
    { person: 'reyes', room: 'quarters-2', from: 4000, until: null, kind: 'simulated', source: 's' },
    { person: 'leo', room: 'lab', from: 0, until: null, kind: 'simulated', source: 's' },
  ];
  assert.deepEqual(timeInRooms(stays, 'reyes', 1000, 10_000), { lab: 3000, 'quarters-2': 6000 });
  assert.deepEqual(occupants(stays, 5000), { 'quarters-2': ['reyes'], lab: ['leo'] });
});

test('rows from outside are checked', () => {
  assert.equal(rowProblem(row({})), null);
  assert.match(rowProblem(row({ kind: 'real' as never }))!, /kind/);
  assert.equal(rowProblem(row({ kind: 'reported' })), null, 'a person\'s own answer is a kind of its own');
  assert.match(rowProblem(row({ value: Number.NaN }))!, /value/);
  assert.match(rowProblem(row({ room: null }))!, /person or a room/);
  assert.match(rowProblem(row({ signal: 'CO2; drop' }))!, /signal/);
});

test('every string exists in both languages', () => {
  for (const [key, entry] of Object.entries(allStrings())) {
    assert.ok(entry.en && entry.pt, `missing a language for ${key}`);
  }
  assert.equal(t('top.missionDay', 'en', { day: 211 }), 'Mission day 211');
  assert.equal(t('no.such.key', 'pt'), 'no.such.key');
});

test('a screen follows the hub\'s clock, a scenario\'s while one plays, and the hub\'s again after', () => {
  // This screen's clock is 7 minutes behind the hub's.
  const local = 1_000_000;
  const offset = clockOffset(local + 420_000, local);
  assert.equal(offset, 420_000);
  assert.equal(screenNow(local + 5000, offset), local + 425_000, 'live: its own clock plus the offset');
  assert.equal(clockOffset(local - 3000, local), -3000, 'ahead of the hub: a negative offset');
  // A scenario at 10x, last heard 2 s ago.
  const scenario = { at: 50_000, speed: 10, heardAt: local };
  assert.equal(screenNow(local + 2000, offset, scenario), 70_000);
  assert.equal(screenNow(local + 60_000, offset, scenario), 50_000 + SCENARIO_GAP_MS, 'never far ahead of the last message');
  assert.equal(screenNow(local + 2000, offset, null), local + 422_000, 'scenario over: back on the hub\'s clock');
});

test('a reading stamped slightly ahead of the screen still counts, further ahead does not', () => {
  assert.equal(CLOCK_SLACK_MS, 2000);
  assert.equal(current([row({ t: 11_500 })], 10_000).length, 1);
  assert.equal(current([row({ t: 12_500 })], 10_000).length, 0);
});
