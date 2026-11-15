import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AFTER_USE_MS, EMPTY_BEAT_MS, closeIn, noteCount, openedWith } from './autoClose.ts';

test('closes a beat after the last alert goes', () => {
  let s = openedWith(2);
  s = noteCount(s, 1, 1000);
  assert.equal(closeIn(s, 1000, false), null);
  s = noteCount(s, 0, 2000);
  assert.equal(closeIn(s, 2000, false), EMPTY_BEAT_MS);
  assert.equal(closeIn(s, 2000 + EMPTY_BEAT_MS + 50, false), 0);
});

test('the beat counts from when it first became empty', () => {
  let s = noteCount(openedWith(1), 0, 2000);
  s = noteCount(s, 0, 2900);
  assert.equal(closeIn(s, 2900, false), EMPTY_BEAT_MS - 900);
});

test('stays open when opened empty on purpose', () => {
  let s = openedWith(0);
  s = noteCount(s, 0, 5000);
  assert.equal(closeIn(s, 99_000, false), null);
});

test('opened empty, then an alert comes and goes: closes', () => {
  let s = noteCount(openedWith(0), 1, 1000);
  s = noteCount(s, 0, 3000);
  assert.equal(closeIn(s, 3000, false), EMPTY_BEAT_MS);
});

test('a new alert during the beat keeps it open', () => {
  let s = noteCount(openedWith(1), 0, 1000);
  s = noteCount(s, 1, 1500);
  assert.equal(closeIn(s, 9000, false), null);
});

test('waits while someone interacts, and a little after', () => {
  const s = noteCount(openedWith(1), 0, 1000);
  assert.equal(closeIn(s, 5000, true), null);
  assert.equal(closeIn(s, 5000, false, 5000), AFTER_USE_MS);
  assert.equal(closeIn(s, 1200, false, 1100), EMPTY_BEAT_MS - 200);
});
