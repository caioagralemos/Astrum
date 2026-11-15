# Sources for the compressions move

The compressions move (`moves/compressions.ts`) takes its numbers from one source only, and is labelled on screen "Animation demo. Steps not yet reviewed by the medical lead."

## Primary source (fetched and quoted)

Olasveengen TM, et al. *Adult Basic Life Support: 2020 International Consensus on Cardiopulmonary Resuscitation and Emergency Cardiovascular Care Science With Treatment Recommendations.* Resuscitation 2020;156:A35–A79. Full text: Europe PMC, PMC7576327. This is the ILCOR consensus that the AHA and ERC guidelines are built on.

Quoted (section "Chest compression rate, chest compression depth, and chest wall recoil"; "Hand position during compressions"):

- "We recommend a manual chest compression rate of 100 to 120/min."
- "We recommend a chest compression depth of approximately 5 cm (2 in.) … while avoiding excessive chest compression depths (greater than 6 cm [greater than 2.4 in.] in an average adult) during manual CPR."
- "We suggest that rescuers performing manual CPR avoid leaning on the chest between compressions to allow full chest wall recoil."
- "We suggest performing chest compressions on the lower half of the sternum on adults in cardiac arrest."

## Supporting source (current, fetched)

2025 Korean Guidelines for Cardiopulmonary Resuscitation: Part 3. Adult basic life support. Clin Exp Emerg Med 2026 (Europe PMC, PMC13277413). Same rate, depth and hand position; adds "the rescuer should kneel beside the patient", which is the only source for the kneeling posture.

## Not fetched

The 2025 AHA Part 7 Adult BLS (Circulation 2025;152(16 suppl 2):S448–S478, doi 10.1161/CIR.0000000000001369) and the ERC Guidelines 2025 Adult BLS (Resuscitation 2025;215 Suppl 1:110771) both returned HTTP 403 to automated fetching, so their wording was not checked here. The medical lead should confirm the numbers against whichever guideline Astrum will cite.

## What the animation uses

| | Source says | Animated |
|---|---|---|
| Rate | 100 to 120 a minute | 110 a minute: 11 compressions in a 6.000 s loop |
| Depth | about 5 cm, not more than 6 cm | 5.0 cm, measured at the hands and at the chest surface under them |
| Hand position | lower half of the sternum | heel of the lower hand on the lower half of the breastbone, other hand on top |
| Recoil | allow full chest wall recoil | the chest returns to exactly 0 cm every cycle |
| Posture | kneel beside the person | kneeling at the side |

Not from any source, and chosen as the least invented option: equal time down and up (a plain cosine); arms straight with shoulders over the hands (common teaching, not quoted above); the camera angle.

# The medical lead's moves, 15 Nov 2026 (night)

Her answers of 14 Nov (`~/Desktop/NASA/steps-demo/videos-answers.md`) are the source for every detail below unless a guideline is named. Where her answers file marks a detail as **her choice**, it is not in any guideline text and not sourced; it is recorded in the move's `source` field and stays until she reviews the animation (every move is `reviewed: false`).

| Move | What is animated | From |
|---|---|---|
| V09 | 120 a minute (6 presses in 3.000 s), 5.5 cm deep, hands stacked on the lower half of the breastbone | her answers 11 to 13 and her corrected card ("5 to 6 cm"); ILCOR 2020 above agrees; ERC 2025 "at least 5 cm, not more than 6 cm" as summarised in medical-factcheck/PARA-A-MEDICA.md (not opened here). The difference between "about 5 cm" (answer 11) and "5 to 6 cm" (card) is asked. |
| V12 | Evetts-Russomano leg hold; face to face; right leg over the arms; hips level with the chest; back upright; 120 a minute, 5.5 cm | leg hold: DGLRM/ESAM-SMG 2020 (Hinkelbein et al., doi 10.1186/s13049-020-00793-y), quoted in the move; the rest: her answers 17, 18, 19, 23, 24, 25, **her choice** |
| V13 | handstand method between the stretcher and the opposite wall; arms strapped down; knees bent; push from hips and legs; arms straight to the chest | body line: DGLRM/ESAM-SMG 2020, quoted in the move; the rest: her answers 20, 21, 22, 26, **her choice**; rate and depth as V09, asked |
| V10 | lowered slowly from sitting, head supported, flat on the floor, rescuer kneels beside | her answer 14; side and second hand asked |
| V11 | one pad below the right collarbone, one on the left side below the armpit; hands up, rescuer stands and steps back | her answers 15 and 16 |
| V07 | small head tilt, one person: mask hand and bag hand, two squeezes of about 1 s with a short pause | her answers 8, 9, 10; where the rescuer kneels asked |
| V02 no gravity | feet in a foot loop, hands resting near the body | her answer 1 |
