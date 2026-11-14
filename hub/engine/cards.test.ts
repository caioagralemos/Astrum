import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardView, displayLangs, parseCards, pickCard, NO_CARD_FITS } from './cards.ts';

// Placeholder cards in her export's shape. The step texts are markers, not
// medical content: the tests check which card is picked and what may be shown.
function card(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: { en: `${id} title`, pt: `${id} título` },
    level: 'dangerous',
    notify: 'everyone',
    message_houston: true,
    signs: { readings: [], answers: [], words: { en: [], pt: [] } },
    steps: [{ en: `${id} step 1`, pt: `${id} passo 1` }],
    do_not: [{ en: '', pt: '' }],
    sources: [{ name: '', url: '', quote: '', is_nasa: true }],
    unverified: [],
    status: 'approved',
    en_checked: true,
    notes: '',
    ...extra,
  };
}

const co2 = card('high-co2', {
  signs: {
    readings: [{ signal: 'cabin_co2', direction: 'high', basis: 'nasa_limit', threshold: 3, unit: 'mmHg', note: '' }],
    answers: [], words: { en: [], pt: [] },
  },
});
const chest = card('chest-pain', {
  signs: {
    readings: [{ signal: 'heart_rate', direction: 'high', basis: 'personal_normal', threshold: null, unit: null, note: '' }],
    answers: [{ question: 'Do you have chest pain or pressure?', answer: 'yes' }],
    words: { en: ['chest pain', 'tight chest'], pt: ['dor no peito'] },
  },
});
const none = card(NO_CARD_FITS, { level: 'dangerous' });

test('only approved cards load; drafts are listed as not approved', () => {
  const parsed = parseCards([co2, card('draft-one', { status: 'draft' }), card('no-status', { status: undefined })]);
  assert.deepEqual(parsed.cards.map((c) => c.id), ['high-co2']);
  assert.deepEqual(parsed.notApproved.map((c) => [c.id, c.status]), [['draft-one', 'draft'], ['no-status', 'missing']]);
});

test('a bad file never throws and says what is wrong in plain words', () => {
  assert.deepEqual(parseCards({ not: 'a list' }).cards, []);
  assert.match(parseCards({}).problems[0], /should be a list/);
  const parsed = parseCards([null, { title: {} }, co2, co2, card('broken', { level: 'awful' })]);
  assert.deepEqual(parsed.cards.map((c) => c.id), ['high-co2']);
  const all = parsed.problems.join('\n');
  assert.match(all, /Card 1 is not a card/);
  assert.match(all, /Card 2 has no id/);
  assert.match(all, /appears twice/);
  assert.match(all, /"broken": level must be/);
  assert.match(all, /no approved "unknown-urgent" card/);
});

test('an approved card with an unreadable sign is held back', () => {
  const bad = card('odd', { signs: { readings: [{ signal: 'heart_rate', direction: 'sideways', basis: 'personal_normal' }], answers: [], words: {} } });
  const parsed = parseCards([bad]);
  assert.equal(parsed.cards.length, 0);
  assert.match(parsed.problems.join('\n'), /unknown direction/);
});

test('English shows only when checked; Portuguese only when not marked unreviewed', () => {
  const [enOff] = parseCards([card('a', { en_checked: false })]).cards;
  assert.deepEqual(displayLangs(enOff), ['pt']);
  assert.equal(cardView(enOff, 'en')!.lang, 'pt', 'falls back to the language that may be shown');
  const [ptOff] = parseCards([card('b', { pt_reviewed: false })]).cards;
  assert.deepEqual(displayLangs(ptOff), ['en']);
  const both = parseCards([card('c', { en_checked: false, pt_reviewed: false })]);
  assert.equal(cardView(both.cards[0], 'en'), null);
  assert.match(both.problems.join('\n'), /can't be shown yet/);
  const view = cardView(parseCards([co2]).cards[0], 'pt')!;
  assert.deepEqual(view.steps, ['high-co2 passo 1']);
  assert.deepEqual(view.doNot, [], 'empty do-not lines are dropped');
});

test('a broken NASA limit picks its card, using her threshold', () => {
  const { cards } = parseCards([co2, chest, none]);
  const over = pickCard(cards, { readings: [{ signal: 'cabin_co2', direction: 'high', basis: 'nasa_limit', value: 3.4, unit: 'mmHg' }], answers: [] });
  assert.equal(over?.card.id, 'high-co2');
  assert.equal(over?.fallback, false);
  const under = pickCard(cards, { readings: [{ signal: 'cabin_co2', direction: 'high', basis: 'nasa_limit', value: 2.9, unit: 'mmHg' }], answers: [] });
  assert.equal(under?.card.id, NO_CARD_FITS, 'under her threshold: no card fits');
  const otherUnit = pickCard(cards, { readings: [{ signal: 'cabin_co2', direction: 'high', basis: 'nasa_limit', value: 5000, unit: 'ppm' }], answers: [] });
  assert.equal(otherUnit?.card.id, NO_CARD_FITS, 'a value in another unit is not compared');
});

test('a reading off the personal normal alone never picks a card', () => {
  const { cards } = parseCards([chest, none]);
  const hr = { signal: 'heart_rate', direction: 'high' as const, basis: 'personal_normal' as const };
  assert.equal(pickCard(cards, { readings: [hr], answers: [] })?.card.id, NO_CARD_FITS);
  const withAnswer = pickCard(cards, { readings: [hr], answers: [{ question: 'Do you have chest pain or pressure?', answer: 'Yes' }] });
  assert.equal(withAnswer?.card.id, 'chest-pain');
  assert.equal(withAnswer?.matched.length, 2, 'the reading adds weight once the card fits');
});

test('her words match what the crewmate typed, in either language, without accents mattering', () => {
  const { cards } = parseCards([co2, chest, none]);
  assert.equal(pickCard(cards, { readings: [], answers: [], text: 'I have a TIGHT chest since lunch' })?.card.id, 'chest-pain');
  assert.equal(pickCard(cards, { readings: [], answers: [], text: 'estou com dor no peito' })?.card.id, 'chest-pain');
  assert.equal(pickCard(cards, { readings: [], answers: [], text: 'what is the chestnut limit' })?.card.id, NO_CARD_FITS);
});

test('with no "no card fits" card, nothing fitting gives null; drafts are never picked', () => {
  const draftChest = { ...chest, status: 'draft' };
  const { cards } = parseCards([co2, draftChest]);
  assert.equal(pickCard(cards, { readings: [], answers: [], text: 'chest pain' }), null);
});

test('more matched signs wins, then the higher level', () => {
  const mild = card('mild-co2', {
    level: 'concerning',
    signs: { readings: [{ signal: 'cabin_co2', direction: 'high', basis: 'nasa_limit', threshold: null, unit: null, note: '' }], answers: [], words: { en: [], pt: [] } },
  });
  const { cards } = parseCards([mild, co2]);
  const fact = { signal: 'cabin_co2', direction: 'high' as const, basis: 'nasa_limit' as const, value: 4, unit: 'mmHg' };
  assert.equal(pickCard(cards, { readings: [fact], answers: [] })?.card.id, 'high-co2', 'same count: dangerous beats concerning');
});
