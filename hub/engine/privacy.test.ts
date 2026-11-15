import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestFor, rowsFor } from './privacy.ts';
import { crewMessage, crewMessageRow } from './earth.ts';
import { signalName, t } from './strings.ts';
import type { Row } from './types.ts';

const message = crewMessageRow(crewMessage('reyes', 'hello earth', 1000, 60_000));
const reading: Row = { t: 1000, signal: 'blood_oxygen', value: 97, text: null, unit: '%', kind: 'measured', source: 'phone:reyes', person: 'reyes', room: null };

test('a message to Earth is never in latest, for anyone, and its words reach only its author', () => {
  for (const viewer of ['reyes', 'leo', 'common']) {
    const latest = latestFor([reading, message], viewer);
    assert.deepEqual(latest.map((r) => r.signal), ['blood_oxygen']);
  }
  assert.equal(rowsFor([message], 'leo')[0].text, null);
  assert.equal(rowsFor([message], 'common')[0].text, null);
  assert.equal(rowsFor([message], 'reyes')[0].text, 'hello earth');
});

test('a signal never reads as its key: named in both languages, plain words when unnamed', () => {
  for (const lang of ['en', 'pt'] as const) {
    for (const key of ['active_energy', 'blood_oxygen', 'breathing_rate', 'blood.glucose', 'checkin.headache', 'some_new.thing_here']) {
      for (const name of [t(`signal.${key}`, lang), t(`signal.${key}.short`, lang), signalName(key, lang)]) {
        assert.ok(!/signal\.|[._]/.test(name), `${key} (${lang}) reads "${name}"`);
      }
    }
  }
  assert.equal(signalName('some_new.thing_here', 'en'), 'Thing here');
});
