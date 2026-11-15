# The medical lead's test cases against the hub engine

Written by `npm run cases` (medical/run-cases.ts). Each case is built as inputs to the functions the hub runs (cabin.ts, baseline.ts, medical.ts, cards.ts, alerts.ts); the model is not called. How each case's words become inputs is at the top of run-cases.ts.

## Totals

- Cases: 96. **Passed: 46. Failed: 50.**
- A case passes when flag, level, who is told and card match, the next question matches where it can be checked, and no checkable "must not" fails.
- flag: 73 pass, 23 fail. level: 55 / 41. notify: 55 / 41. card: 87 / 9.
- next_question: 89 pass, 4 fail, 3 not checkable (the hub has no fixed question for it: its fixed questions are her SpO2 question, "Are you fasting?" and "Did it get better?").
- must_not items: 243: 218 pass, 23 fail, 2 not automatically checkable. "Reassure", "suggest a diagnosis" and "say the word sepsis" are checked with the output check's rules on the hub's fixed texts only; the model's own answer is not checked here.
- Card: the alert carries her urgent card beside any level 3 card, so an expected card passes when it is either one; an expected "no card" needs the alert's own card to be empty.

## Failing cases

### case-002: High CO2 while asleep, not waking, watch normal

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | self | high-co2 | - |
| got | true | dangerous | everyone | high-co2 (+ unknown-urgent) | - |

Fails on: level, notify, must not "alert everyone".
Why: Disagreement between the case and the rules: she does not wake, so the project's countdown rule takes the CO2 alert to everyone after 60 s; the case expects "concerning" told to "self", while her README says concerning tells the medical officer.
Inputs: asleep; respiratory_rate: the value as the usual ("within"); heart_rate: the usual the case states; SpO2 97 read twice, 60 s apart; no answer: one more step after the countdown.

### case-003: Headache with CO2 below the NASA limit

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | high-co2 | - |
| got | true | unusual | self | headache | - |

Fails on: card.
Why: Disagreement between the case and her cards: at 2.6 mmHg her headache card's CO2 sign (above 2.3) matches; her high-co2 card's sign is the NASA limit (above 3) and does not.

### case-005: Very low sodium

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify, must not "leave her alone".
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-006: Low sodium, moderate

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify, must not "wait for symptom answers before alerting".
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-007: Mild low sodium, no symptoms

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | - | Do you have confusion, slow thinking, headache, nausea or vomiting? |
| got | false | - | - | - | - |

Fails on: flag, level, notify.
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing. Her symptom question is also only in the notes.

### case-008: Mild low sodium, with symptoms

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify.
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.
Inputs: an answer "yes: ..." is given to her signs as "yes".

### case-010: High sodium, severe

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify, must not "leave her alone", must not "wait for symptom answers before alerting".
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-011: Low potassium

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify, must not "leave her alone".
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-012: Mildly low potassium

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify.
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-014: Mildly high potassium

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify.
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-015: High potassium

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify, must not "leave her alone".
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-016: Very high potassium

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify.
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-017: Very low ionized calcium

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify, must not "leave her alone".
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-018: Moderately low ionized calcium

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | - | Do you have tingling, cramps, spasms, confusion, thirst, vomiting or weakness? |
| got | false | - | - | - | - |

Fails on: flag, level, notify.
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing. Her symptom question is also only in the notes.

### case-019: Mildly low ionized calcium

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify.
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-021: Mildly high ionized calcium

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify.
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-022: High ionized calcium at the critical limit

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify, must not "leave her alone".
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-023: Very high ionized calcium

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify, must not "leave her alone".
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-029: Critically low hematocrit

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify, must not "leave her alone".
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-030: Low hematocrit

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify.
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-032: High hematocrit

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify.
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-033: Critically high hematocrit

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | - | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify, must not "leave her alone".
Why: Missing machine-readable field: this entry's level per band is only in blood.json `notes`; blood.json has flag/urgent numbers but no level (and "urgent" means concerning for some entries, dangerous for others), so the hub raises nothing.

### case-035: Slightly low blood oxygen

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | - | Are you short of breath? |
| got | true | unusual | self | low-oxygen | Are you short of breath? |

Fails on: card.
Why: Disagreement between the case and her card: the low-oxygen card's sign (SpO2 below 95) matches 92, so the card is shown with the unusual level; the case expects no card.
Inputs: SpO2 92 read twice, 60 s apart.

### case-048: Not fasting, low, sleepy, slow heartbeat

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | - | - |
| got | true | concerning | medical_officer | - | - |

Fails on: level, notify.
Why: Missing machine-readable field: "low glucose and heart rate below 40 = dangerous" is only in the glucose notes; the hub gives the not-fasting 54-69 band, concerning.
Inputs: an answer "yes: ..." is given to her signs as "yes".

### case-051: Not fasting, very high with fast deep breathing

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | - | - |
| got | true | concerning | medical_officer | - | - |

Fails on: level, notify.
Why: Missing machine-readable field: the escalation at 250 or more (fast deep breathing, vomiting, drowsiness = dangerous) is only in the glucose notes.
Inputs: an answer "yes: ..." is given to her signs as "yes".

### case-052: Glucose varies a lot

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | - | - |
| got | true | unusual | self | - | Are you fasting? |

Fails on: next_question.
Why: Engine gap (missing field): the variation rule (CV above 36 %) is only in the glucose notes and is not run. The level matches only because the latest value, 150, is unusual on both her tables; with no fasting answer the hub asks "Are you fasting?", which the case does not expect.

### case-057: Headache with repeated vomiting

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | headache | - |
| got | true | concerning | medical_officer | high-co2 | - |

Fails on: card.
Why: Card overlap: "headache" is a word of both her high-co2 and headache cards; with one match each the higher base level wins (high-co2, concerning), though the CO2 is normal. Her words, and the engine's tie rule (most matches, then level).

### case-059: Two short nights

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | poor-sleep | - |
| got | true | unusual | self | - | - |

Fails on: card.
Why: Engine rule vs case: a reading against the person's own normal alone never picks a card (it raises only the unusual level); the case expects her poor-sleep card.
Inputs: sleep_duration: usual = value x 1.25 ("below", no number given).

### case-060: Fast resting heart rate, nothing else

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | chest-pain | - |
| got | true | unusual | self | - | - |

Fails on: card.
Why: Engine rule vs case: a reading against the person's own normal alone never picks a card; the case expects her chest-pain card. The level and who is told match.
Inputs: resting_heart_rate: the usual the case states.

### case-064: Diarrhea for 3 days, cannot drink

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | digestive | - |
| got | true | unusual | self | digestive | - |

Fails on: level, notify.
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.

### case-066: Chemical in the eye

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | eyes | - |
| got | true | unusual | self | eyes | - |

Fails on: level, notify.
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.
Inputs: an answer "yes: ..." is given to her signs as "yes".

### case-068: Small red warm area of skin

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | skin-infection | - |
| got | true | unusual | self | skin-rash | - |

Fails on: card.
Why: Disagreement between the case and her card words: "red and warm skin" contains her skin-rash word "skin"; her skin-infection word is "red and hot skin", which it does not contain.

### case-070: Stroke signs

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | neuro | - |
| got | true | unusual | self | neuro | - |

Fails on: level, notify, must not "leave her alone".
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.

### case-071: Burn with blisters on the hand

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | burn | - |
| got | true | unusual | self | burn | - |

Fails on: level, notify, must not "leave her alone".
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.

### case-072: Fire alarm and visible smoke

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | smoke-toxic-air | - |
| got | true | unusual | self | smoke-toxic-air | - |

Fails on: level, notify, must not "leave her alone".
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.

### case-073: Cough with phlegm for more than 2 days

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | asthma-lung | - |
| got | true | unusual | self | asthma-lung | - |

Fails on: level, notify.
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.

### case-075: Broken tooth

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | dental | - |
| got | true | unusual | self | fracture | - |

Fails on: level, notify, card.
Why: Disagreement between the case and her card words: "I broke a tooth" contains her fracture word "broke"; her dental word is "broken tooth".

### case-076: Very hard belly and sudden pain

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | acute-abdomen | - |
| got | true | concerning | medical_officer | acute-abdomen | - |

Fails on: level, notify.
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.

### case-078: Confused with very hot, dry skin

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | heat-cold | - |
| got | true | unusual | self | heat-cold | - |

Fails on: level, notify, must not "leave her alone".
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.

### case-079: Hearing voices

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | depression-psychosis | - |
| got | true | concerning | medical_officer | depression-psychosis | - |

Fails on: level, notify.
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.

### case-080: Fever with confusion and cold sweat

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | sepsis-anemia | - |
| got | true | unusual | self | sepsis-anemia | - |

Fails on: level, notify, must not "leave her alone".
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.

### case-081: Fast pressure drop alarm

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | decompression-radiation | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify, card, must not "leave her alone".
Why: Missing machine-readable field and an open point: there is no numeric cabin pressure limit (her README, open points), so no room alarm; a reading with no question never raises a card on its own, and her decompression card's base level is unusual.

### case-084: Hard to wake after taking a medicine

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | medication-overdose | - |
| got | true | unusual | self | medication-overdose | - |

Fails on: level, notify, must not "leave her alone".
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.

### case-085: Heavy bleeding

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | gynecologic | - |
| got | true | unusual | self | gynecologic | - |

Fails on: level, notify, must not "leave her alone".
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.

### case-086: Suit mark on the skin

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | eva-hand-nails | - |
| got | false | - | - | - | Did it get better? |

Fails on: flag, level, notify, card, next_question.
Why: Disagreement between the case and her card words: "suit mark" contains none of her eva-hand-nails words ("spacesuit", "glove", ...), so no card fits.

### case-087: Sudden numbness and weakness on one side

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | tingling-nerves | - |
| got | true | unusual | self | tingling-nerves | - |

Fails on: level, notify, must not "leave her alone".
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.

### case-088: Very little urine for many hours

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | nutrition-dust-kidney | - |
| got | true | unusual | self | nutrition-dust-kidney | - |

Fails on: level, notify, must not "leave her alone".
Why: Missing machine-readable field: the right card is picked, but the level for this situation is only in the card's `notes`; the hub uses the card's base `level`.

### case-092: No card: question about water

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | false | - | - | - | - |
| got | false | - | - | - | Did it get better? |

Fails on: next_question.
Why: Engine gap (ambiguous): with no card, the hub always offers "Did it get better?"; it cannot tell a question from a symptom without the model.

### case-093: No card: asks if it is cancer

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | false | - | - | - | - |
| got | false | - | - | - | Did it get better? |

Fails on: next_question.
Why: Engine gap (ambiguous): with no card, the hub always offers "Did it get better?"; it cannot tell a question from a symptom without the model.

### case-096: Resting heart rate 15 bpm above baseline

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | false | - | - | - | - |
| got | true | unusual | self | - | - |

Fails on: flag, level, notify, must not "alert anyone".
Why: Disagreement between the case and her rule: 15 bpm over 60 is 25 %, above her 20 %, so under the README's "20% or 20 bpm" it counts. The case calls it "under 20%".
Inputs: resting_heart_rate: the usual the case states.

## Passing cases

case-001, case-004, case-009, case-013, case-020, case-024, case-025, case-026, case-027, case-028, case-031, case-034, case-036, case-037, case-038, case-039, case-040, case-041, case-042, case-043, case-044, case-045, case-046, case-047, case-049, case-050, case-053, case-054, case-055, case-056, case-058, case-061, case-062, case-063, case-065, case-067, case-069, case-074, case-077, case-082, case-083, case-089, case-090, case-091, case-094, case-095
