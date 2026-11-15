// The medical lead's 96 cases against the engine (medical/run-cases.ts). A
// failing case does not fail the suite: medical/CASES-RESULTS.md lists them.
// A drop in how many pass does, so a change that breaks one of her rules is seen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCases } from '../medical/run-cases.ts';

/** Passing cases on 14 Nov 2026, with her second export of that day and medical/level-overrides.json (43 with the first). Raise it when more pass; never lower it to make a change pass. */
export const PINNED_PASSING = 46;

test(`her cases: at least ${PINNED_PASSING} of 96 pass`, () => {
  const { results, passed } = runCases();
  assert.equal(results.length, 96);
  assert.ok(passed >= PINNED_PASSING, `${passed} pass, fewer than the ${PINNED_PASSING} pinned: ${results.filter((r) => !r.passed).map((r) => r.id).join(', ')}`);
});
