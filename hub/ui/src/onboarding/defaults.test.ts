import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDefaults, todayOn } from './defaults.ts';

test('the setup starts today, day 1, for the planned length', () => {
  for (const offset of [-180, 0, 60, 540]) {
    for (const now of [Date.UTC(2026, 10, 15, 1), Date.UTC(2026, 10, 15, 23, 30)]) {
      const d = setupDefaults(500, false, now, offset);
      assert.equal(d.day, 1);
      assert.equal(d.start, todayOn(now, offset));
      assert.equal(d.days, 500);
    }
  }
  assert.equal(setupDefaults(10, false, Date.now(), 0).days, 30, 'a stay is a month at least');
  assert.equal(setupDefaults(3, true, Date.now(), 0).days, 3, 'a trip can be days long');
  assert.equal(setupDefaults(5000, true, Date.now(), 0).days, 1095);
});
