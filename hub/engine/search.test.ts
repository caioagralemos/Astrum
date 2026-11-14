import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search, sourceName, statesLimit, terms } from './search.ts';
import type { Passage } from './search.ts';
import library from '../data-nasa/passages/passages.json' with { type: 'json' };

const passages = library as Passage[];
const index = buildIndex(passages);

// Questions the way a crewmate would type them, written before any tuning.
// `want`: any of these ids in the top 3 is a hit. An empty list means the
// library has no answer and the search must return nothing.
const TABLE: { q: string; want: string[]; readings?: string[] }[] = [
  { q: 'I have a headache, could it be the CO2?', want: ['co2-limit', 'co2-headaches-1'] },
  { q: "what's the max co2 we're allowed in the cabin", want: ['co2-limit', 'co2-headaches-1', 'co2-monitoring-1'] },
  { q: 'CO2 is fine under 7.5, right?', want: ['co2-limit'] },
  { q: "cant sleep, is that normal up here", want: ['risk-sleep-1', 'risk-sleep-2', 'risk-sleep-3'] },
  { q: 'why does the sun keep rising and setting so often', want: ['risk-sleep-3'] },
  { q: 'how much exercise am I supposed to do every day', want: ['risk-reduced-fitness-2'] },
  { q: 'how fast do my bones lose density up here', want: ['risk-bone-1', 'hazard-gravity-fields-2'] },
  { q: 'first week and Im dizzy and nauseous all the time', want: ['risk-sensorimotor-1', 'risk-sensorimotor-3', 'risk-sensorimotor-2'] },
  { q: 'my vision is getting blurry', want: ['risk-sans-1', 'risk-sans-3', 'hazard-gravity-fields-2'] },
  { q: 'feeling lonely and kind of depressed lately', want: ['risk-behavioral-1', 'risk-behavioral-2', 'hazard-isolation-and-confinement-1'] },
  { q: 'what happens if the co2 scrubber breaks', want: ['co2-iss-levels', 'co2-lioh', 'co2-cdra-1', 'co2-vozdukh'] },
  { q: 'think I got the bends after the spacewalk, what do I do', want: ['risk-decompression-sickness-1', 'risk-decompression-sickness-2'] },
  { q: 'low oxygen symtoms?', want: ['risk-hypoxia-1', 'risk-hypoxia-3'] },
  { q: 'is all this radiation going to give me cancer', want: ['risk-radiation-induced-cancers-1', 'risk-radiation-induced-cancers-2', 'hazard-space-radiation-4'] },
  { q: 'got a cold sore on my lip, why', want: ['risk-immune-3', 'risk-immune-1'] },
  { q: 'my heart feels irregular, is that a space thing?', want: ['risk-cardiovascular-adaptations-1'] },
  { q: 'how long does a mesage take to get to earth', want: ['hazard-distance-from-earth-1'] },
  { q: 'does high co2 make it harder to think straight', want: ['co2-cognition'] },
  { q: 'my crewmate and I keep arguing', want: ['risk-inadequate-teamwork-1', 'risk-inadequate-teamwork-2'] },
  { q: 'how much do muscles and fitness drop on a long mision', want: ['risk-reduced-fitness-3', 'risk-reduced-fitness-1'] },
  // No answer in the library: the right result is nothing.
  { q: 'how many mg of ibuprofen can I take', want: [] },
  { q: 'what is the wifi password', want: [] },
  { q: 'who won the world cup', want: [] },
  { q: 'how do I fix the toilet', want: [] },
  { q: 'how do I make pizza dough', want: [] },
];

// Held out: written after the table above was tuned, and never tuned against.
// Its hit rate is the honest estimate of how the search does on new questions.
const HELD_OUT: typeof TABLE = [
  { q: "is it bad that I've been forgetting things and can't concentrate", want: ['co2-cognition', 'risk-hypoxia-1', 'hazard-space-radiation-4'] },
  { q: 'what does the scrubber on the station actually do', want: ['co2-cdra-1', 'co2-cdra-2', 'co2-vozdukh'] },
  { q: 'I feel faint when I stand up', want: ['risk-cardiovascular-adaptations-1', 'risk-cardiovascular-adaptations-2'] },
  { q: 'how much bone will I lose on a six month trip', want: ['risk-bone-1', 'hazard-gravity-fields-2'] },
  { q: 'why are my eyes swollen', want: ['risk-sans-1', 'risk-sans-3'] },
  { q: 'whats a safe co2 level for sleeping', want: ['co2-limit', 'co2-headaches-1', 'co2-monitoring-1'] },
  { q: 'can solar storms hurt us', want: ['hazard-space-radiation-2', 'hazard-space-radiation-3', 'risk-radiation-induced-cancers-3'] },
  { q: 'I keep getting rashes', want: ['risk-immune-3', 'risk-immune-1'] },
  { q: 'is it normal to feel space sick the first days', want: ['risk-sensorimotor-3', 'risk-sensorimotor-1'] },
  { q: 'how do i stay sane being stuck in here for years', want: ['risk-behavioral-2', 'hazard-isolation-and-confinement-1', 'risk-behavioral-3'] },
  { q: "what's the treadmill schedule astronauts follow on the ISS", want: ['risk-reduced-fitness-2'] },
  { q: 'will the low cabin pressure make me sick', want: ['risk-hypoxia-1', 'risk-hypoxia-3', 'risk-decompression-sickness-3'] },
  { q: 'do germs grow differently up here', want: ['risk-microbes-1', 'hazard-hostile-environments-1'] },
  { q: 'what happened on apollo 13 with the co2', want: ['co2-apollo13-1', 'co2-apollo13-2'] },
  { q: 'does the heart change shape in microgravity', want: ['risk-cardiovascular-adaptations-3'] },
  { q: 'what dose of melatonin should I take to sleep', want: [] },
  { q: 'how many calories should I eat today', want: [] },
  { q: 'when is the next resupply ship arriving', want: [] },
  { q: 'can you play some music', want: [] },
  { q: "what's my blood type", want: [] },
];

// Full sentences, the way a tired crewmate types. Written 14 Nov before the framing fix
// (hit rate then 4/20), and then tuned against (17/20 after). Not a held-out set.
const FULL_SENTENCE: { q: string; want: string[]; readings?: string[] }[] = [
  { q: 'Why do I keep waking up with a headache?', want: ['co2-headaches-1', 'co2-headaches-2', 'co2-symptoms'], readings: ['CO2'] },
  { q: 'My head has been pounding every morning this week, is it the air in here?', want: ['co2-headaches-1', 'co2-headaches-2', 'co2-symptoms', 'co2-limit'] },
  { q: 'What does it mean that I get headaches after a long shift in the lab?', want: ['co2-headaches-1', 'co2-headaches-2', 'co2-symptoms'] },
  { q: 'Is the CO2 in my room dangerous?', want: ['co2-limit', 'co2-symptoms', 'co2-monitoring-1', 'co2-iss-levels', 'co2-summary'] },
  { q: 'How high can the CO2 get in here before it starts to hurt us?', want: ['co2-limit', 'co2-symptoms', 'co2-monitoring-1', 'co2-iss-levels'] },
  { q: 'Is my room making me sick?', want: ['co2-symptoms', 'co2-headaches-1', 'hazard-hostile-environments-1', 'co2-limit'] },
  { q: "I keep waking up at 3am and can't fall back asleep, is that normal up here?", want: ['risk-sleep-1', 'risk-sleep-2', 'risk-sleep-3'] },
  { q: 'Why do I feel so wiped out even after I sleep eight hours?', want: ['risk-sleep-1', 'risk-sleep-2', 'risk-sleep-3', 'co2-symptoms'] },
  { q: 'Is it bad that I only get like five hours of sleep a night?', want: ['risk-sleep-1', 'risk-sleep-2', 'risk-sleep-3'] },
  { q: "I get dizzy every time I turn my head fast, what's going on?", want: ['risk-sensorimotor-1', 'risk-sensorimotor-2', 'risk-sensorimotor-3'] },
  { q: "Why does the room feel like it's spinning when I first wake up?", want: ['risk-sensorimotor-1', 'risk-sensorimotor-2', 'risk-sensorimotor-3'] },
  { q: 'How much bone am I actually losing up here every month?', want: ['risk-bone-1', 'risk-bone-3', 'bone-summary', 'hazard-gravity-fields-2'] },
  { q: 'My legs feel weaker than when we launched, is that muscle loss?', want: ['risk-reduced-fitness-1', 'risk-reduced-fitness-3'] },
  { q: 'Is all this radiation going to hurt me long term?', want: ['risk-radiation-induced-cancers-1', 'risk-radiation-induced-cancers-2', 'risk-radiation-induced-cancers-3', 'hazard-space-radiation-2', 'hazard-space-radiation-3'] },
  { q: "I'm worried about the radiation dose from the solar storm last week", want: ['hazard-space-radiation-2', 'hazard-space-radiation-3', 'risk-radiation-induced-cancers-3'] },
  { q: 'Does being stuck in this tin can for months mess with your head?', want: ['risk-behavioral-1', 'risk-behavioral-2', 'risk-behavioral-3', 'hazard-isolation-and-confinement-1'] },
  { q: 'Why do I feel short of breath when I work out in the gym module?', want: ['co2-symptoms', 'risk-hypoxia-1', 'co2-limit'] },
  { q: 'What does it mean that my heart races when I stand up?', want: ['risk-cardiovascular-adaptations-1', 'risk-cardiovascular-adaptations-2'] },
  // No answer in the library, in a full sentence.
  { q: 'Can you tell me what time it is back home right now?', want: [] },
  { q: 'What was the score of the football game back on Earth?', want: [] },
];

// Written after the framing fix and measured once, with no change since: 5/8. The honest
// estimate for new full sentences.
const FRESH: typeof TABLE = [
  { q: 'Could the stuffy air in my quarters be why I wake up groggy?', want: ['co2-symptoms', 'co2-cognition', 'co2-headaches-1', 'co2-headaches-2', 'co2-limit'] },
  { q: "I've had a dull headache since lunch, should I be worried?", want: ['co2-headaches-1', 'co2-headaches-2', 'co2-symptoms'] },
  { q: "Why can't I sleep more than a few hours at a time up here?", want: ['risk-sleep-1', 'risk-sleep-2', 'risk-sleep-3'] },
  { q: 'Every time I float off my bunk I get queasy, is that normal?', want: ['risk-sensorimotor-1', 'risk-sensorimotor-2', 'risk-sensorimotor-3'] },
  { q: 'How fast are my bones getting weaker out here?', want: ['risk-bone-1', 'risk-bone-3', 'bone-summary', 'hazard-gravity-fields-2'] },
  { q: 'Is it normal that my muscles feel smaller after three months?', want: ['risk-reduced-fitness-1', 'risk-reduced-fitness-3'] },
  { q: 'How worried should I be about cancer from all the radiation?', want: ['risk-radiation-induced-cancers-1', 'risk-radiation-induced-cancers-2', 'risk-radiation-induced-cancers-3'] },
  { q: 'Can you order more coffee for the next cargo run?', want: [] },
];

function run(table: typeof TABLE) {
  return table.map((row) => {
    const r = search(index, row.q, { limit: 3, readings: row.readings });
    const got = r.hits.map((h) => h.id);
    const hit = row.want.length === 0 ? !r.found : row.want.some((id) => got.includes(id));
    return { ...row, got, hit };
  });
}

function report(t: { diagnostic: (m: string) => void }, rows: ReturnType<typeof run>): number {
  const hits = rows.filter((r) => r.hit).length;
  t.diagnostic(`hit rate ${hits}/${rows.length} (${Math.round((100 * hits) / rows.length)}%)`);
  for (const m of rows.filter((r) => !r.hit)) {
    t.diagnostic(`MISS "${m.q}" → [${m.got.join(', ') || 'nothing'}], wanted [${m.want.join(', ') || 'nothing'}]`);
  }
  return hits / rows.length;
}

const results = run(TABLE);

test('every passage is NASA text of a usable size with its source', () => {
  const ids = new Set<string>();
  for (const p of passages) {
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    assert.match(p.url, /^https:\/\/www\.nasa\.gov\//);
    assert.ok(p.source && p.heading && p.fetched, p.id);
    const n = p.text.split(/\s+/).length;
    assert.ok(n <= 220, `${p.id} has ${n} words`);
  }
});

test('the crew question table: hit rate (right passage in the top 3, or nothing when nothing fits)', (t) => {
  assert.ok(report(t, results) >= 0.8);
});

test('held-out questions: hit rate on questions the search was not tuned on', (t) => {
  assert.ok(report(t, run(HELD_OUT)) >= 0.5);
});

test('questions the library cannot answer return nothing', () => {
  for (const r of results.filter((x) => x.want.length === 0)) {
    assert.deepEqual(r.got, [], `"${r.q}" returned ${r.got.join(', ')}`);
  }
});

test('the CO2 headache question finds the brief and names it the way the prompt cites it', () => {
  const r = search(index, 'I have a headache, could it be the CO2?');
  assert.equal(r.found, true);
  assert.ok(r.hits.length >= 1 && r.hits.length <= 2);
  assert.equal(r.hits[0].name, 'NASA-STD-3001 CO2 Technical Brief');
  assert.equal(sourceName({ ...r.hits[0].passage, source: 'Risk of Hypoxia' }), 'NASA Risk of Hypoxia');
});

test('readings re-rank but never find a passage alone', () => {
  assert.equal(search(index, 'what is the wifi password', { readings: ['CO2', 'sleep'] }).found, false);
  const r = search(index, 'why do I feel so tired', { limit: 3, readings: ['CO2'] });
  if (r.found) assert.ok(r.hits.length <= 3);
});

test('never more than 3 passages, and an empty question finds nothing', () => {
  assert.ok(search(index, 'sleep exercise radiation bone co2', { limit: 9 }).hits.length <= 3);
  assert.equal(search(index, '   ').found, false);
  assert.deepEqual(terms("Can't sleep!"), ['sleep']);
});

test('full sentences: framing words ("why do I keep", "waking up with", "in my room") do not count against a question', (t) => {
  assert.ok(report(t, run(FULL_SENTENCE)) >= 0.8);
  const story = search(index, 'Why do I keep waking up with a headache?', { readings: ['CO2'] });
  assert.equal(story.found, true);
  assert.ok(story.hits.some((h) => h.id.startsWith('co2-headaches')));
  for (const r of run(FULL_SENTENCE).filter((x) => x.want.length === 0)) assert.deepEqual(r.got, [], r.q);
});

test('fresh full sentences: hit rate on sentences written after the fix', (t) => {
  assert.ok(report(t, run(FRESH)) >= 0.5);
});

test('framing words never let a question the library cannot answer through', () => {
  for (const q of ['what dose of melatonin should I take to sleep', 'Why do I keep waking up wanting pizza?', 'What does it mean that the toilet in my room keeps clogging?']) {
    assert.equal(search(index, q, { readings: ['CO2', 'sleep'] }).found, false, q);
  }
});

test('a question about a signal with a NASA limit gets the passage that states the limit first', () => {
  assert.deepEqual(passages.filter((p) => statesLimit(p, 'co2')).map((p) => p.id), ['co2-limit'], 'only a passage opening with the 1-hour limit counts');
  for (const q of ['Is the CO2 in my room dangerous?', 'what is the co2 limit', 'How high can the CO2 get before it hurts us?', 'I have a headache, could it be the CO2?']) {
    assert.equal(search(index, q, { readings: ['cabin CO2'] }).hits[0]?.id, 'co2-limit', q);
  }
});

test('headache questions keep a headache passage in the top 2; the readings alone never hijack a question', () => {
  for (const q of ['Why do I keep waking up with a headache?', 'I have a headache, could it be the CO2?', 'my head hurts every morning']) {
    const top2 = search(index, q, { readings: ['cabin CO2'] }).hits.slice(0, 2).map((h) => h.id);
    assert.ok(top2.some((id) => id.startsWith('co2-headaches')), `${q} → ${top2.join(', ')}`);
  }
  assert.ok(search(index, "Why can't I sleep?", { readings: ['cabin CO2'] }).hits.every((h) => h.id.startsWith('risk-sleep')));
});
