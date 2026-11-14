import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkinRows } from './checkin.ts';
import { isDemoOnly } from './types.ts';

const crew = ['reyes', 'leo'];

test('a check-in becomes rows marked reported, under checkin., from checkin:<person>', () => {
  const out = checkinRows({ person: 'reyes', answers: [{ signal: 'headache', value: 1 }, { signal: 'checkin.mood', value: 62, unit: '0-100' }, { signal: 'note', value: null, text: 'Woke up twice' }] }, crew, 5000, () => 'quarters-2');
  assert.ok('rows' in out);
  assert.deepEqual(out.rows.map((r) => [r.signal, r.value, r.unit]), [['checkin.headache', 1, ''], ['checkin.mood', 62, '0-100'], ['checkin.note', null, '']]);
  assert.ok(out.rows.every((r) => r.kind === 'reported' && r.source === 'checkin:reyes' && r.person === 'reyes' && r.room === 'quarters-2' && r.t === 5000));
  assert.equal(isDemoOnly('reported'), false, 'production keeps what a person said');
});

test('a check-in is refused for someone not in the crew, a bad signal name, or an empty answer', () => {
  assert.ok('error' in checkinRows({ person: 'nobody', answers: [{ signal: 'headache', value: 1 }] }, crew, 0));
  assert.ok('error' in checkinRows({ person: 'reyes', answers: [] }, crew, 0));
  assert.match((checkinRows({ person: 'reyes', answers: [{ signal: 'Head ache!', value: 1 }] }, crew, 0) as { error: string }).error, /signal/);
  assert.match((checkinRows({ person: 'reyes', answers: [{ signal: 'mood', value: Number.NaN }] }, crew, 0) as { error: string }).error, /value/);
  assert.match((checkinRows({ person: 'reyes', answers: [{ signal: 'note', value: null }] }, crew, 0) as { error: string }).error, /value or a text/);
});
