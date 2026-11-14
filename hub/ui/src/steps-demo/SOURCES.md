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
