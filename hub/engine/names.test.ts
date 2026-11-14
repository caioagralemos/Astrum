import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASTRONAUT_FIRST_NAMES, pickNames } from './names.ts';

test('the name list: at least 80 first names, each one word, no surname, no repeats', () => {
  assert.ok(ASTRONAUT_FIRST_NAMES.length >= 80, `${ASTRONAUT_FIRST_NAMES.length} names`);
  for (const name of ASTRONAUT_FIRST_NAMES) {
    assert.match(name, /^\p{Lu}[\p{L}]+$/u, `"${name}" is one capitalised word, no space, hyphen or initial`);
    assert.ok(name.length <= 12, `"${name}" is short`);
  }
  const folded = ASTRONAUT_FIRST_NAMES.map((n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
  assert.equal(new Set(folded).size, folded.length, 'no name twice');
  // The ship's own crew keeps its names; the list never hands those out.
  for (const ship of ['Reyes', 'Leo', 'Okafor', 'Tanaka']) assert.ok(!ASTRONAUT_FIRST_NAMES.includes(ship));
  assert.ok(ASTRONAUT_FIRST_NAMES.includes('Marcos'), 'Brazil\'s astronaut\'s given name is there');
});

test('pickNames is repeatable for a seed, gives different names, and leaves out the ones taken', () => {
  assert.deepEqual(pickNames(6, 42), pickNames(6, 42));
  assert.deepEqual(pickNames(4, 'iss'), pickNames(4, 'iss'));
  assert.notDeepEqual(pickNames(6, 1), pickNames(6, 2));
  for (let seed = 0; seed < 200; seed++) {
    const names = pickNames(8, seed, ['Yuri', 'sally', 'Jose']);
    assert.equal(names.length, 8);
    assert.equal(new Set(names).size, 8, 'all different');
    assert.ok(!names.includes('Yuri') && !names.includes('Sally') && !names.includes('José'), 'taken names, any case or accent, are left out');
    for (const n of names) assert.ok(!/\s/.test(n));
  }
  // Seeds spread over the whole list, not the first few.
  const seen = new Set(Array.from({ length: 300 }, (_, i) => pickNames(1, i)[0]));
  assert.ok(seen.size > 60, `${seen.size} different first picks`);
  assert.equal(pickNames(ASTRONAUT_FIRST_NAMES.length + 5, 3).length, ASTRONAUT_FIRST_NAMES.length, 'fewer only when the list runs out');
});
