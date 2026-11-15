import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEnReview, enHash, install, readEnReview, MEDICAL_DIR, EN_REVIEW_FILE } from '../scripts/install-medical.ts';
import type { EnReview } from '../scripts/install-medical.ts';
import { displayLangs, parseCards } from './cards.ts';

// Placeholder cards in her export's shape, written the way her file is (her
// tool writes numbers as 3.0): the edit must keep that formatting.
function cardText(pt = 'passo um', en = 'step one'): string {
  return `[
  {
    "id": "a",
    "title": {
      "en": "Title",
      "pt": "Título"
    },
    "level": "unusual",
    "threshold": 3.0,
    "steps": [
      {
        "en": "${en}",
        "pt": "${pt}"
      }
    ],
    "do_not": [],
    "en_checked": false,
    "notes": "step one"
  }
]
`;
}

function reviewOf(text: string, checked = true): EnReview {
  const card = JSON.parse(text)[0];
  return {
    about: 'test',
    cards: {
      a: {
        checked,
        pt_sha256: enHash(card, 'pt'),
        en_sha256: enHash(card, 'en'),
        fixes: { 'steps[0]': { pt: 'passo um', en: 'Step one, fixed.' } },
      },
    },
  };
}

test('a matching review writes its English fixes and en_checked, and nothing else', () => {
  const text = cardText();
  const r = applyEnReview(text, reviewOf(text));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.applied, ['a']);
  assert.deepEqual(r.checked, ['a']);
  assert.equal(r.fixed, 1);
  const out = JSON.parse(r.text)[0];
  assert.equal(out.steps[0].en, 'Step one, fixed.');
  assert.equal(out.steps[0].pt, 'passo um');
  assert.equal(out.en_checked, true);
  assert.equal(out.notes, 'step one', 'a same English string elsewhere is not touched');
  assert.ok(r.text.includes('"threshold": 3.0'), 'her formatting is kept');
});

test('a review that found an open question applies its fixes but leaves the card unchecked', () => {
  const text = cardText();
  const r = applyEnReview(text, reviewOf(text, false));
  assert.deepEqual(r.checked, []);
  const out = JSON.parse(r.text)[0];
  assert.equal(out.steps[0].en, 'Step one, fixed.');
  assert.equal(out.en_checked, false);
});

test('when she changes the Portuguese, the card drops back to unchecked and keeps her text', () => {
  const review = reviewOf(cardText());
  const changed = cardText('passo um, agora diferente');
  const r = applyEnReview(changed, review);
  assert.deepEqual(r.stale, ['a']);
  assert.deepEqual(r.applied, []);
  assert.equal(r.text, changed);
});

test('when she changes the English, the review no longer applies either', () => {
  const review = reviewOf(cardText());
  const changed = cardText('passo um', 'her new English');
  const r = applyEnReview(changed, review);
  assert.deepEqual(r.stale, ['a']);
  assert.equal(r.text, changed);
});

test('a fix that does not match the Portuguese it claims to translate fails and changes nothing', () => {
  const text = cardText();
  const review = reviewOf(text);
  review.cards.a.fixes['steps[0]'].pt = 'outro texto';
  const r = applyEnReview(text, review);
  assert.equal(r.problems.length, 1);
  assert.equal(r.text, text);
});

test('install applies the review on the way in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'astrum-en-review-'));
  try {
    const dest = join(dir, 'medical');
    for (const [file, installed] of [['cards.json', 'cards.json'], ['blood.json', 'blood.json'], ['cases.json', 'cases.json'], ['README.md', 'README.md'], ['coverage.md', 'COVERAGE.md']]) {
      const body = file === 'cards.json' ? cardText() : readFileSync(join(MEDICAL_DIR, installed), 'utf8');
      writeFileSync(join(dir, file), body);
    }
    const reports = install(dir, dest, true, reviewOf(cardText()));
    assert.deepEqual(reports.flatMap((r) => r.problems), []);
    const out = JSON.parse(readFileSync(join(dest, 'cards.json'), 'utf8'))[0];
    assert.equal(out.en_checked, true);
    assert.equal(out.steps[0].en, 'Step one, fixed.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the installed cards are the ones the English review checked', () => {
  const review = readEnReview();
  assert.ok(review, `${EN_REVIEW_FILE} is in medical/`);
  const cards = JSON.parse(readFileSync(join(MEDICAL_DIR, 'cards.json'), 'utf8'));
  for (const [id, r] of Object.entries(review.cards)) {
    const card = cards.find((c: { id: string }) => c.id === id);
    assert.ok(card, `${id} is installed`);
    assert.equal(enHash(card, 'pt'), r.pt_sha256, `${id}: the Portuguese is the one checked`);
    assert.equal(card.en_checked, r.checked, `${id}: en_checked follows the review`);
    for (const [path, fix] of Object.entries(r.fixes)) {
      const m = /^(title|steps|do_not)(?:\[(\d+)\])?$/.exec(path);
      assert.ok(m, `${id}: ${path} is a shown text`);
      const t = m[1] === 'title' ? card.title : card[m[1]][Number(m[2])];
      assert.equal(t.en, fix.en, `${id} ${path}: the fix is installed`);
      assert.equal(t.pt, fix.pt, `${id} ${path}: against her Portuguese`);
    }
    if (!r.checked) assert.ok(r.why_not, `${id}: an unchecked card says why`);
  }
  const parsed = parseCards(cards).cards;
  for (const id of ['high-co2', 'unknown-urgent', 'low-oxygen', 'cardiac-arrest', 'cardiac-arrest-gravity']) {
    assert.ok(displayLangs(parsed.find((c) => c.id === id)!).includes('en'), `${id} can be shown in English`);
  }
});
