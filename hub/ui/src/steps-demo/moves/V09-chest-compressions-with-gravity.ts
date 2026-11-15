// V09 chest compressions with gravity. Her description: "WITH gravity. One lies
// on their back on the floor; the other kneels beside them, hands stacked on
// the middle of the chest, arms straight, pressing hard and fast, 2 presses per
// second."
//
// Her answers (videos-answers.md, 14 Nov): 11, "about 5 cm" deep; 12, exactly
// 120 a minute; 13, both hands stacked on the lower half of the breastbone, the
// centre of the chest. Her corrected card (cards.json, cardiac-arrest-gravity,
// step 3, after the ERC 2025 check) says "5 to 6 cm deep", so the chest goes in
// 5.5 cm: it reads as 5 to 6 and is still "about 5". The difference between
// her answer 11 and her card is asked of her, once (`questions`).
//
// 120 a minute in her 3 second loop is 6 presses. The motion is the
// compressions move's (moves/compressions.ts): the kneeling body is solved
// from the floor up, so each press comes from the shoulders over straight arms.

import type { Move } from '../step.ts';
import { compressionsClip } from './compressions.ts';

/** Her card's 5 to 6 cm: the middle of it. */
const DEPTH = 0.055;

export const v09: Move = {
  id: 'V09',
  name: 'V09-chest-compressions-with-gravity',
  summary: 'One lies on their back on the floor; the other kneels beside them, hands stacked on the middle of the chest, arms straight, 2 presses per second.',
  params: {},
  medical: true,
  reviewed: false,
  source: 'Rate, hand position and depth: the medical lead’s answers 11 to 13 (14 Nov 2026) and her cardiac-arrest-gravity card, step 3 ("5 to 6 cm deep, about 2 times per second"). They agree with ILCOR 2020 Adult Basic Life Support CoSTR (Olasveengen et al., Resuscitation 2020;156:A35–A79: "100 to 120/min", "approximately 5 cm … avoiding … greater than 6 cm", "on the lower half of the sternum") and ERC 2025 ("at least 5 cm, not more than 6 cm", as summarised in medical-factcheck/PARA-A-MEDICA.md; not opened here).',
  questions: [
    'V09: your answer 11 says about 5 cm deep, your corrected card says 5 to 6 cm. The animation uses 5.5 cm. Is that right?',
  ],
  variants: { gravity: (world) => compressionsClip(world, 120, 6, 2.05, DEPTH, '5 to 6 cm') },
};
