// Everyday questions to Astra, as they were typed on the live hub (person leo), and what each must now get.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksAdviceOrDiagnosis, composeAnswer, render, renderItems, replyText } from './answer.ts';
import { checkAnswer, modelReadingsBlock, readingLine, SYSTEM_PROMPT } from './prompt.ts';
import type { PersonReadings } from './prompt.ts';
import type { Evidence } from './evidence.ts';
import { messageLang, smallTalkKind, smallTalkReply } from './conversation.ts';
import { buildIndex, onTopic, search } from './search.ts';
import type { Passage } from './search.ts';
import library from '../data-nasa/passages/passages.json' with { type: 'json' };
import { focusReadings } from '../core/ai.ts';

const leo: PersonReadings = {
  name: 'Leo', pronoun: 'their', readings: [
    { type: 'normal', name: 'heart rate', value: 65, unit: 'bpm', label: 'simulated', normal: 61, judged: 'inside' },
    { type: 'normal', name: 'resting heart rate', value: 58, unit: 'bpm', label: 'simulated', normal: 57, judged: 'inside' },
    { type: 'normal', name: 'HRV', value: 52, unit: 'ms', label: 'simulated', normal: 50, judged: 'inside' },
    { type: 'normal', name: 'sleep last night', value: 309, unit: 'min', label: 'simulated', normal: 308, judged: 'inside' },
    { type: 'normal', name: 'times awake in the night', value: 2, unit: '', label: 'simulated', normal: 2, judged: 'inside' },
    { type: 'normal', name: 'sleepiness, latest daily value', value: 40, unit: '0-100', label: 'simulated', normal: 40, judged: 'inside' },
    { type: 'normal', name: 'steps today', value: 4200, unit: 'steps', label: 'simulated', normal: 5000, judged: 'inside' },
  ],
};
const index = buildIndex(library as Passage[]);
const hub = (question: string, lang: 'en' | 'pt' = 'en', extra: Partial<Parameters<typeof composeAnswer>[0]> = {}) =>
  composeAnswer({ name: 'Leo', question, readings: leo, evidence: null, passages: [], lang, ...extra });

test('1. "is my heart rate ok?": one usual value, never a "range", in the hub sentence, the model facts and the prompt', () => {
  const line = readingLine(leo.readings[0], 'your');
  assert.equal(line, 'heart rate 65 bpm (simulated) (your usual about 61 bpm): about your usual.');
  assert.doesNotMatch(line, /range/);
  const a = hub('is my heart rate ok?');
  const lines = renderItems(a.items, 'en', a.who);
  assert.equal(lines[0], 'Your heart rate is 65 bpm, about your usual. (simulated)');
  assert.doesNotMatch(lines.join(' '), /range/);
  assert.match(SYSTEM_PROMPT, /your usual is about 61 bpm/);
  // A passage about the heart's shape in low gravity is not about heart rate.
  assert.equal(onTopic('is my heart rate ok?', { heading: 'Cardiovascular', text: 'Gravity can change the shape of the heart and raise the risk of blood clots or fainting at landing.' }), false);
});

test('2. "how did I sleep last night?": hours and minutes, about the usual, no range', () => {
  const a = hub('how did I sleep last night?');
  const lines = renderItems(a.items, 'en', a.who);
  assert.ok(lines.includes('Your sleep last night is 5 h 9 min, about your usual. (simulated)'), lines.join(' | '));
  assert.doesNotMatch(lines.join(' '), /range|309 min/);
});

test('3. "why am I so tired today?": only the readings that bear on tiredness, and the "points to" sentence', () => {
  const evidence = { pointsTo: 'person', focusRoom: null, reported: { rows: [], runs: [] } } as unknown as Evidence;
  const a = hub('why am I so tired today?', 'en', { evidence });
  assert.deepEqual(renderItems(a.items, 'en', a.who), [
    'Your sleep last night is 5 h 9 min, about your usual. (simulated)',
    'Your times awake in the night is 2, about your usual. (simulated)',
    'Your latest sleepiness is 40 out of 100, about your usual. (simulated)',
    'From what the hub can see, this points to you, not to the room. (hub)',
  ]);
  assert.doesNotMatch(replyText(a, 'en'), /heart rate|HRV|steps/);
  // The model gets the same two or three readings, not seven.
  assert.deepEqual(focusReadings(leo, 'why am I so tired today?').readings.map((r) => r.type === 'note' ? '' : r.name),
    ['sleep last night', 'times awake in the night', 'sleepiness, latest daily value']);
});

test('4. "I have a headache": what is known first, in one sentence; the line about NASA\'s text before the quotes', () => {
  const CO2 = { name: 'NASA-STD-3001 CO2 Technical Brief', url: 'https://www.nasa.gov/x.pdf', text: 'Headaches at levels between 2.8-4.5 mmHg.' };
  const readings: PersonReadings = { ...leo, readings: [{ type: 'limit', name: 'cabin CO2', value: 2.6, unit: 'mmHg', label: 'replayed', window: '1-hour average', limit: 3 }] };
  const a = hub('I have a headache', 'en', { readings, passages: [CO2], notExact: true });
  assert.match(a.text, /^The CO2 in your cabin reads 2\.6 mmHg/);
  assert.doesNotMatch(a.text, /Here is what it does say/);
  assert.match(a.factsText, /The closest NASA text is below; it does not answer this exactly\.$/);
  assert.match(replyText(a, 'en'), /^The CO2 in your cabin/);
});

test('5. "como eu dormi?": answered in Portuguese, durations as "5 h 9 min", the 0-100 score as a sentence', () => {
  assert.equal(messageLang('como eu dormi?', 'en'), 'pt');
  assert.equal(messageLang('how did I sleep?', 'en'), 'en');
  assert.equal(messageLang('I talked to José', 'en'), 'en', 'one accent mark alone is a name, not a language');
  const a = hub('como eu dormi?', 'pt');
  const lines = renderItems(a.items, 'pt', a.who);
  assert.ok(lines.includes('Seu sono da última noite está em 5 h 9 min, perto do seu habitual. (simulated)'), lines.join(' | '));
  assert.doesNotMatch(lines.join(' '), /309 min|0-100/);
  const sleepiness = composeAnswer({ name: 'Leo', question: 'sleepiness', readings: { ...leo, readings: [leo.readings[5]] }, evidence: null, passages: [], lang: 'en' });
  assert.equal(render(sleepiness.items[0], 'en'), 'Your latest sleepiness is 40 out of 100, about your usual.');
  assert.equal(render(sleepiness.items[0], 'pt'), 'Sua sonolência mais recente está em 40 de 100, perto do seu habitual.');
});

test('6. "thanks, that helps" as a first message: the short acknowledgement, never a clarifying question', () => {
  assert.equal(smallTalkKind('thanks, that helps'), 'thanks');
  assert.equal(smallTalkKind('that helps'), 'ack');
  assert.equal(smallTalkKind('thanks, my head hurts'), null, 'a symptom is never small talk');
  assert.doesNotMatch(smallTalkReply('thanks', 'en', 0), /Do you mean/);
});

test('7. "I think my blood pressure is high": no passage about radiation and cancer', () => {
  const r = search(index, 'I think my blood pressure is high');
  for (const h of r.hits) assert.match(`${h.passage.heading} ${h.passage.text}`, /blood pressure|hypertens|hypotens|systolic|diastolic/i, h.passage.heading);
  assert.equal(onTopic('I think my blood pressure is high', { heading: 'Radiation', text: 'Exposure to space radiation raises the lifetime risk of cancer.' }), false);
  assert.equal(onTopic('Why do I keep waking up?', { heading: 'Radiation', text: 'Exposure to space radiation raises the lifetime risk of cancer.' }), true, 'no named topic: the search scores decide');
});

test('8. a model answer that ends on what it does not know, or what the data does not say, is thrown away', () => {
  const facts = 'heart rate (simulated) 65 bpm (your usual about 61 bpm): about your usual.\nsleep last night (simulated) 5 h 9 min (309 min); your usual about 5 h 8 min (308 min): about your usual.';
  const check = (answer: string) => checkAnswer({ answer, passageNames: [], facts, message: facts });
  const heart = check("Your latest simulated heart rate is 65 bpm, about your usual of 61 bpm. I don't know if 65 is ok; contact Earth's flight surgeon.");
  assert.notEqual(heart.by, 'model');
  assert.match(heart.reasons.join(' '), /does not know/);
  const sleep = check("You slept 5 hours and 9 minutes, about your usual. It doesn't say what you were dreaming about.");
  assert.notEqual(sleep.by, 'model');
  assert.equal(check('You slept 5 h 9 min last night, about your usual.').by, 'model');
  assert.match(SYSTEM_PROMPT, /It doesn't say what you were dreaming about/);
});

// ---------- second live rerun (okafor) ----------

test('R1. "how did I sleep last night?": one duration, one verdict, no internal detail', () => {
  const okafor: PersonReadings = { name: 'you', pronoun: 'your', readings: [
    { type: 'normal', name: 'sleep last night', value: 323, unit: 'min', label: 'simulated', normal: 308, judged: 'inside' },
    { type: 'normal', name: 'time in bed asleep', value: 91, unit: '%', label: 'simulated', normal: 90, judged: 'inside' },
  ] };
  const block = modelReadingsBlock(okafor, 'Detector: anomaly 0.90. Main signals: sleep last night.', [], true) ?? '';
  assert.match(block, /sleep last night 5 h 23 min \(simulated\); your usual about 5 h 8 min: about your usual\./);
  assert.doesNotMatch(block, /323 min|308 min|unusual|asleep/);
  const check = (answer: string) => checkAnswer({ answer, passageNames: [], facts: block, message: block, readings: okafor.readings });
  assert.notEqual(check('You slept 5 h 23 min (323 min), about your usual of 5 h 8 min.').by, 'model');
  // Judged unusual: the line says so, once, with how.
  const unusual = readingLine({ type: 'normal', name: 'sleep last night', value: 449, unit: 'min', label: 'simulated', normal: 320.5, judged: 'above' }, 'your');
  assert.equal(unusual, 'sleep last night 7 h 29 min (simulated); your usual about 5 h 21 min: +2 h 9 min, above your usual, which the hub marks as unusual.');
});

test('R2. "is my heart rate ok?": the kind is a label on the number; no "I have no NASA passage" filler', () => {
  const line = readingLine({ type: 'normal', name: 'heart rate', value: 66, unit: 'bpm', label: 'simulated', normal: 64, judged: 'inside' }, 'your');
  assert.equal(line, 'heart rate 66 bpm (simulated) (your usual about 64 bpm): about your usual.');
  const block = modelReadingsBlock({ name: 'you', pronoun: 'your', readings: [{ type: 'normal', name: 'heart rate', value: 66, unit: 'bpm', label: 'simulated', normal: 64, judged: 'inside' }] }, 'Detector: anomaly 0.90. Main signals: heart rate.', [], true) ?? '';
  assert.doesNotMatch(block, /unusual/, 'one verdict per reading');
  const r = checkAnswer({ answer: 'Your heart rate is 66 bpm (simulated), about your usual of 64 bpm. I have no NASA passage on heart rate limits.', passageNames: [], facts: block, message: block });
  assert.notEqual(r.by, 'model');
  assert.match(SYSTEM_PROMPT, /66 bpm \(simulated\)/);
});

test('R3. "and compared to yesterday?": with no value from yesterday, the hub says so plainly', () => {
  const a = hub('How was my heart rate yesterday?');
  assert.ok(renderItems(a.items, 'en', a.who).includes('I have no heart rate from yesterday to compare with. (hub)'));
  assert.match(replyText(a, 'en'), /I have no heart rate from yesterday to compare with\./);
});

test('R4. "is it safe to work out now?": the hub does not recommend; no dump; Contact Earth', () => {
  for (const q of ['is it safe to work out now?', 'am I ok to exercise?', 'can I go for a run?']) assert.equal(asksAdviceOrDiagnosis(q), true, q);
  const evidence = { pointsTo: 'person', focusRoom: null, reported: { rows: [], runs: [] }, unusual: { signals: [] }, reasons: [], whereBeen: { windows: [] } } as unknown as Evidence;
  const text = replyText(hub('is it safe to work out now?', 'en', { evidence }), 'en', 1);
  assert.match(text, /The hub does not recommend what to do\..*tap Contact Earth\. \(hub\)$/);
  assert.ok((text.match(/\((simulated|replayed|measured|hub)\)/g) ?? []).length <= 3, 'at most two readings beside the fixed line');
  assert.doesNotMatch(text, /sleep|sleepiness|times awake/, 'no reading dump');
});

test('R5. "what does NASA say about CO2?": NASA\'s statement leads, then the reading', () => {
  const CO2 = { name: 'NASA-STD-3001 CO2 Technical Brief', url: 'https://www.nasa.gov/x.pdf', text: 'The 1-hour average CO2 limit is 3 mmHg.' };
  const readings: PersonReadings = { ...leo, readings: [{ type: 'limit', name: 'cabin CO2', value: 2.4, unit: 'mmHg', label: 'replayed', window: '1-hour average', limit: 3 }] };
  const a = hub('what does NASA say about CO2?', 'en', { readings, passages: [CO2] });
  assert.match(a.text, /^NASA, NASA-STD-3001 CO2 Technical Brief: "The 1-hour average CO2 limit is 3 mmHg\."/);
  assert.match(replyText(a, 'en'), /^NASA, /);
  const facts = readingLine(readings.readings[0], 'your');
  const dangling = checkAnswer({ answer: 'Your replayed cabin CO2 is now 2.4 mmHg, 0.6 mmHg below that limit.', passageNames: [], facts, message: facts });
  assert.notEqual(dangling.by, 'model');
});
