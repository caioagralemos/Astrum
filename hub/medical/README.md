# Astrum medical content: export for Caio (14 Nov 2026)

Written by the medical lead (reviewed and approved line by line, in Portuguese) and drafted by the medical lead. English is a translation of what she approved: every item has `en_checked: false`, so **you check the English**.

## Files

| File | What it holds | Count |
|---|---|---|
| `cards.json` | Step cards (title, levels, who is alerted, signs, steps, do-nots, sources, what is unverified) | 39, all approved |
| `cases.json` | Test cases (story, readings, answers, expected result) | 96, all approved |
| `blood.json` | i-STAT blood values (reference range, flag and urgent cut-offs, plain meaning, flight note, sources) | 7, all approved |
| `coverage.md` | Each condition of NASA Appendix E table E.2-2 and the card that covers it | 144 of 144 |
| `videos-astrum.md` (also on the Desktop) | List of 31 looping stick-figure videos, per step and per card | 31 videos |

## What "approved" means

The medical lead approved the Portuguese text (`pt` fields), the levels, and who is alerted. It does **not** mean the steps are sourced. Most card steps were written from memory with no document source: each card lists this in its `unverified` field. The warning levels and cut-offs are her decisions; where she gave a source it is in `sources`, and none of those is from NASA except where `is_nasa` is true.

## Rules she decided that change how the system works

- Alerts follow three levels: `unusual` (only her), `concerning` (medical officer), `dangerous` (everyone). Each card's `notes` holds the full list of situations per level; the card's own `level` is only the base level.
- Concerning means she is **not left alone**; dangerous cards also show the urgent card (`unknown-urgent`, the xABCDE).
- Heart rate: counts only above **20% or 20 bpm** over her own baseline (10 to 15 bpm does not count).
- SpO2: 95 or more normal; 90 to 94 unusual (ask about shortness of breath); below 90 concerning; **below 85 dangerous**. A low watch reading should alert only after it repeats on the next reading (you set the time).
- Glucose has a fasting question: fasting 70 to 99 normal; not fasting uses the cut-offs 54, 70, 140 and 250. Below 60 (fasting or not) she is not left alone.
- pH keeps only sourced numbers: normal 7.35 to 7.45, unusual outside, **7.60 or more dangerous**. The cut-off 7.10 was removed for lack of a source (case-024 documents this gap).
- Hemoglobin has no alerts of its own; it follows the hematocrit.
- The unusual warning is **never sent while she sleeps**.
- Privacy: what she writes for mood, psychosis and gynecologic cards is never shown to the crew. If the medical officer (Okafor) is the person affected, the **commander** (Tanaka) is alerted instead.
- No card fits: the small offline AI answers from NASA documents, never diagnoses or reassures, and alerts the medical officer only if she says it did not get better.
- The system picks the gravity cards by whether gravity is on: `cardiac-arrest-gravity` or `cardiac-arrest`; `choking` or `choking-no-gravity`. Where "reduced" gravity ends is yours to define.
- The Astrum reads and alerts; it never controls air, lights or equipment.

## Open points for you

- Numeric limits for cabin pressure and radiation (the card only shows the reading).
- Temperature and humidity limits for the heat and cold card.
- How long to wait before a repeated low SpO2 alerts.
- The ship's real fire, pressure-loss and radiation procedures were not read: `smoke-toxic-air` and `decompression-radiation` must be checked against them.
- Whether the kit has dental wax, nasal spray, naloxone, a pressure cuff, a glucometer. The cards avoid medicines on purpose (those are medical decisions).
- Microgravity first aid for choking, the reverse bear hug and eye washing is not sourced.
- Videos: your questions are being answered next; the list is a draft.

## Counts and sources at a glance

- 39 cards, 96 test cases, 7 blood values.
- Coverage: the 32 conditions NASA marks as the most common, 32 of 32; the whole table, 144 of 144 (counted by hand, not checked by a second person). This measures the NASA list, not the frequency of real events: the table has no frequency numbers.
- Real data used: Inspiration4 blood reference ranges, Smith 1997 i-STAT in flight (values read from a chart, approximate), the ISS in-flight symptom study (Crucian 2016), NASA Appendix E.
