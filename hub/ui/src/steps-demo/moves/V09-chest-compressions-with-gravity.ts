// V09 chest compressions with gravity. Her description: "WITH gravity. One lies
// on their back on the floor; the other kneels beside them, hands stacked on
// the middle of the chest, arms straight, pressing hard and fast, 2 presses per
// second."
//
// Her "2 presses per second" is 120 a minute; the loop is her 3 seconds, so 6
// presses. What her line leaves open is taken from the cited guideline (see
// SOURCES.md and `source`), and asked of her (`questions`): the depth (about
// 5 cm) and the exact spot (the lower half of the breastbone, which is in the
// middle of the chest). The motion is the compressions move's (moves/compressions.ts).

import type { Move } from '../step.ts';
import { compressionsClip } from './compressions.ts';

export const v09: Move = {
  id: 'V09',
  name: 'V09-chest-compressions-with-gravity',
  summary: 'One lies on their back on the floor; the other kneels beside them, hands stacked on the middle of the chest, arms straight, 2 presses per second.',
  params: {},
  medical: true,
  reviewed: false,
  source: 'Rate: hers, 2 a second (120 a minute; within ILCOR 2020’s 100 to 120). Depth about 5 cm and hands on the lower half of the sternum: ILCOR 2020 Adult Basic Life Support CoSTR (Olasveengen et al., Resuscitation 2020;156:A35–A79).',
  questions: [
    'V09: how deep should the chest go? (The animation uses about 5 cm, from the ILCOR 2020 guideline, until you say otherwise.)',
    'V09: exactly where on the chest do the hands go? (The animation uses the lower half of the breastbone, from the ILCOR 2020 guideline.)',
  ],
  variants: { gravity: (world) => compressionsClip(world, 120, 6, 2.05) },
};
