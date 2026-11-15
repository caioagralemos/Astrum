# The medical lead's test cases against the hub engine

Written by `npm run cases` (medical/run-cases.ts). Each case is built as inputs to the functions the hub runs (cabin.ts, baseline.ts, medical.ts, cards.ts, alerts.ts); the model is not called. How each case's words become inputs is at the top of run-cases.ts.

## Totals

- Cases: 96. **Passed: 79. Failed: 17.**
- A case passes when flag, level, who is told and card match, the next question matches where it can be checked, and no checkable "must not" fails.
- flag: 93 pass, 3 fail. level: 88 / 8. notify: 88 / 8. card: 87 / 9.
- next_question: 91 pass, 4 fail, 1 not checkable (the hub has no fixed question for it: its fixed questions are her SpO2 question, "Are you fasting?" and "Did it get better?").
- must_not items: 243: 237 pass, 4 fail, 2 not automatically checkable. "Reassure", "suggest a diagnosis" and "say the word sepsis" are checked with the output check's rules on the hub's fixed texts only; the model's own answer is not checked here.
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

### case-035: Slightly low blood oxygen

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | - | Are you short of breath? |
| got | true | unusual | self | low-oxygen | Are you short of breath? |

Fails on: card.
Why: Disagreement between the case and her card: the low-oxygen card's sign (SpO2 below 95) matches 92, so the card is shown with the unusual level; the case expects no card.
Inputs: SpO2 92 read twice, 60 s apart.

### case-052: Glucose varies a lot

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | - | - |
| got | true | unusual | self | - | Are you fasting? |

Fails on: next_question.
Why: Hub rule vs case: her variation escalation now gives unusual (as expected), but with no answer to "Are you fasting?" the hub still asks it; the case expects no question.

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

### case-068: Small red warm area of skin

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | unusual | self | skin-infection | - |
| got | true | unusual | self | skin-rash | - |

Fails on: card.
Why: Disagreement between the case and her card words: "red and warm skin" contains her skin-rash word "skin"; her skin-infection word is "red and hot skin", which it does not contain.

### case-072: Fire alarm and visible smoke

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | smoke-toxic-air | - |
| got | true | unusual | self | smoke-toxic-air | - |

Fails on: level, notify, must not "leave her alone".
Why: Mixed sign left out by her (changes-fields.md, question 4): "smoke" and "Do you see smoke or smell something strange?" can be mild or dangerous, so no situation holds them; only "fire" and "alarm" are dangerous. The card's base level (unusual) applies.

### case-073: Cough with phlegm for more than 2 days

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | asthma-lung | - |
| got | true | unusual | self | asthma-lung | - |

Fails on: level, notify.
Why: Needs a time condition (changes-fields.md, question 7): "for more than 2 days" is not an answer or a word, so no situation holds "phlegm"; the base level (unusual) applies.

### case-075: Broken tooth

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | concerning | medical_officer | dental | - |
| got | true | unusual | self | fracture | - |

Fails on: level, notify, card.
Why: Disagreement between the case and her card words: "I broke a tooth" contains her fracture word "broke"; her dental word is "broken tooth".

### case-081: Fast pressure drop alarm

| | flag | level | notify | card | next question |
|---|---|---|---|---|---|
| expected | true | dangerous | everyone | decompression-radiation | - |
| got | false | - | - | - | - |

Fails on: flag, level, notify, card, must not "leave her alone".
Why: Missing machine-readable field and an open point: there is no numeric cabin pressure limit (her README, open points), so no room alarm; a reading with no question never raises a card on its own, and her decompression card's base level is unusual.

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
| got | true | concerning | medical_officer | tingling-nerves | - |

Fails on: level, notify.
Why: Mixed question (changes-fields.md, question 10): "Do you have weakness in an arm or leg?" is in her concerning situation; her dangerous line ("sudden numbness or weakness on one side") has no answer or word of its own.

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

case-001, case-004, case-005, case-006, case-007, case-008, case-009, case-010, case-011, case-012, case-013, case-014, case-015, case-016, case-017, case-018, case-019, case-020, case-021, case-022, case-023, case-024, case-025, case-026, case-027, case-028, case-029, case-030, case-031, case-032, case-033, case-034, case-036, case-037, case-038, case-039, case-040, case-041, case-042, case-043, case-044, case-045, case-046, case-047, case-048, case-049, case-050, case-051, case-053, case-054, case-055, case-056, case-058, case-061, case-062, case-063, case-064, case-065, case-066, case-067, case-069, case-070, case-071, case-074, case-076, case-077, case-078, case-079, case-080, case-082, case-083, case-084, case-085, case-088, case-089, case-090, case-091, case-094, case-095
