import { test } from 'node:test';
import assert from 'node:assert/strict';
import { momentAfter, realOffset, speedAt, speedProfile } from './playback.ts';

test('a speed profile maps a recording\'s clock to real time and back', () => {
  const profile = speedProfile([[100_000, 10], [0, 2]], 0);
  assert.deepEqual(profile, [[0, 2], [100_000, 10]]);
  assert.equal(speedAt(profile, 50_000), 2);
  assert.equal(speedAt(profile, 150_000), 10);
  assert.equal(realOffset(profile, 0, 100_000), 50_000);
  assert.equal(realOffset(profile, 0, 200_000), 60_000);
  for (const t of [0, 1234, 100_000, 177_777]) assert.ok(Math.abs(momentAfter(profile, 0, realOffset(profile, 0, t)) - t) < 1e-6);
  assert.deepEqual(speedProfile(undefined, 5), [[5, 1]], 'a file without one plays in real time');
});
