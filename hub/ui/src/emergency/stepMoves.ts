// Which animation goes with which step of a card: only the steps the medical lead's
// list maps (~/Desktop/NASA/steps-demo/videos-astrum.md, "Which videos each card uses"),
// each to the one gesture that step's own text describes. A step not listed here shows
// no animation: never a near match. Left out on purpose, as drafts: V25a, V25b, V26.
// The card's text is never changed here; this only names a move of the steps rig.

import type { Gravity } from '../steps-demo/step.ts';

/** card id → step index (0-based) → move name in steps-demo/moves. */
export const STEP_MOVES: Record<string, Record<number, string>> = {
  'high-co2': { 0: 'V05-leave-the-room', 1: 'V04-sealed-mask', 2: 'V04-sealed-mask', 3: 'V06-lie-on-side' },
  'unknown-urgent': { 0: 'V01-call-everyone', 1: 'V08-press-with-a-cloth', 3: 'V27-watch-the-chest', 6: 'V28-cover-the-person' },
  'cardiac-arrest': { 0: 'V01-call-everyone', 2: 'V13-medical-restraint' }, // V07 and V11 exist only with gravity: no loop on the weightless card until they do
  'cardiac-arrest-gravity': { 0: 'V01-call-everyone', 1: 'V10-lie-on-back-on-floor', 2: 'V09-chest-compressions-with-gravity', 3: 'V07-bag-valve-mask', 4: 'V11-defibrillator-pads' },
  'low-oxygen': { 0: 'V02-sit-and-stay-still', 1: 'V05-leave-the-room', 2: 'V04-sealed-mask', 3: 'V18-look-at-the-watch' },
  'skin-rash': { 0: 'V15-clean-with-gauze', 3: 'V14-cold-or-warm-cloth' },
  'upper-respiratory': { 1: 'V21-saline-nose-spray', 2: 'V20-wash-hands' },
  headache: { 0: 'V02-sit-and-stay-still', 1: 'V17-sip-water' },
  'cut-injury': { 0: 'V08-press-with-a-cloth', 1: 'V15-clean-with-gauze', 2: 'V16-bandage', 3: 'V14-cold-or-warm-cloth' },
  'chest-pain': { 0: 'V02-sit-and-stay-still', 3: 'V18-look-at-the-watch' },
  'nausea-vomiting': { 0: 'V02-sit-and-stay-still', 1: 'V19-vomit-bag', 2: 'V17-sip-water' },
  'dizziness-fainting': { 0: 'V02-sit-and-stay-still', 1: 'V17-sip-water', 2: 'V18-look-at-the-watch' },
  digestive: { 0: 'V17-sip-water', 4: 'V20-wash-hands' },
  'back-pain': { 1: 'V30-stretch', 2: 'V14-cold-or-warm-cloth' },
  eyes: { 0: 'V20-wash-hands' },
  'skin-infection': { 0: 'V15-clean-with-gauze', 1: 'V16-bandage', 2: 'V29-mark-the-redness' },
  'ear-nose-throat': { 0: 'V31-yawn', 2: 'V23-pinch-the-nose' },
  neuro: { 0: 'V02-sit-and-stay-still', 1: 'V25c-seizure-turn-on-side', 2: 'V24-stroke-test' },
  // Event cards (15 Nov): V32 to V34 were described by the app's developer for her steps; awaiting her review.
  'dust-storm': { 2: 'V32-take-off-dusty-suit' },
  'ground-tremor': { 0: 'V08-press-with-a-cloth', 1: 'V33-look-at-the-pressure', 3: 'V34-watch-over-someone' },
  'meteoroid-impact': { 0: 'V08-press-with-a-cloth', 1: 'V33-look-at-the-pressure', 4: 'V34-watch-over-someone' },
};

/** The move for a step, or null. */
export function moveFor(card: string, step: number): string | null {
  return STEP_MOVES[card]?.[step] ?? null;
}

/** The variant to show: the mission's gravity when the move has it, else the one it has. */
export function variantFor(available: Gravity[], gravity: number | null): Gravity | null {
  const want: Gravity | null = gravity === null ? null : gravity > 0 ? 'gravity' : 'weightless';
  if (want && available.includes(want)) return want;
  return available[0] ?? null;
}
