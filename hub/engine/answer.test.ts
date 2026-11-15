import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWER_STRINGS, asksAmountOrTreatment, composeAnswer, evidenceLines, namesTreatment, render, renderItems, reportedName } from './answer.ts';
import type { FactItem } from './answer.ts';
import { checkAnswer, dangerCheck, readingsBlock, statesCause } from './prompt.ts';
import type { PersonReadings, Reading } from './prompt.ts';
import type { Evidence, PointsTo } from './evidence.ts';
import type { Kind } from './types.ts';

const H = 3_600_000;

/** An evidence card shaped like Reyes's on the demo data (values from the live hub, 14 Nov). */
function reyesCard(over: Partial<Evidence> = {}): Evidence {
  const person = (id: string, above28: number, above3: number, room: string) => ({
    person: id, average: 2.3, above: [{ level: 2.8, ms: above28 * H }, { level: 3, ms: above3 * H }], covered: 72 * H, gap: 0, maxHourAverage: null as number | null,
    kind: 'replayed' as Kind, stayKind: 'simulated' as Kind,
    rooms: [{ room, ms: 30 * H, stayKind: 'simulated' as Kind, average: 2.6, above: [{ level: 2.8, ms: above28 * H }, { level: 3, ms: above3 * H }], covered: 30 * H, kind: 'replayed' as Kind }],
  });
  return {
    person: 'reyes', now: 0,
    unusual: { signals: [], score: 0.17 },
    sameRoom: [],
    whereBeen: { windows: [{ ms: 72 * H, from: 0, to: 72 * H, people: [person('reyes', 10.9, 6.1, 'quarters-2'), person('leo', 0, 0, 'quarters-1'), person('okafor', 0, 0, 'quarters-3')] }], onlyThem: [] },
    reported: { rows: [], runs: [{ signal: 'checkin.headache', count: 3, days: 3, lastAt: 0, kind: 'reported' }] },
    pointsTo: 'room', focusRoom: 'quarters-2',
    reasons: [{ code: 'exposure-stands-out', room: 'quarters-2', level: 2.8, ms: 10.9 * H, crewmatesMaxMs: 0, windowMs: 72 * H, kind: 'replayed' }],
    ...over,
  };
}

const reyes: PersonReadings = {
  name: 'Reyes', pronoun: 'her', readings: [
    { type: 'normal', name: 'heart rate', value: 66.5, unit: 'bpm', label: 'simulated', normal: 64, judged: 'inside' },
    { type: 'limit', name: 'cabin CO2', value: 2.6, unit: 'mmHg', label: 'replayed', window: '1-hour average', limit: 3 },
  ],
};
const ROOMS: Record<string, string> = { 'quarters-2': 'Quarters 2' };
const roomName = (id: string) => ROOMS[id] ?? id;
const CO2 = { name: 'NASA-STD-3001 CO2 Technical Brief', url: 'https://www.nasa.gov/x.pdf', text: 'Headaches at levels between 2.8-4.5 mmHg; worsening with increasing levels of CO2.' };

test("Reyes's story question: true facts with labels, the verdict as \"points to\", NASA quoted unchanged", () => {
  const a = composeAnswer({ name: 'Reyes', question: 'Why do I keep waking up with a headache?', readings: reyes, evidence: reyesCard(), passages: [CO2], lang: 'en', roomName });
  assert.equal(a.relevant, true);
  const lines = renderItems(a.items, 'en', a.who);
  assert.deepEqual(lines, [
    "The CO2 in your cabin reads 2.6 mmHg (1-hour average), 0.4 mmHg below NASA's limit of 3 mmHg. (replayed)",
    'None of your body readings is unusual for you right now. (simulated)',
    'In the last 72 hours you spent 10.9 hours in Quarters 2 with CO2 above 2.8 mmHg; none of your crewmates spent any time above it. (CO2 replayed; location simulated)',
    'In the same 72 hours you spent 6.1 hours with single CO2 readings above 3 mmHg. (CO2 replayed; location simulated)',
    'You reported headache on 3 days in a row. (reported)',
    'This points to the room (Quarters 2), not to you. (hub)',
  ]);
  const exposure = a.items.find((i) => i.key === 'answer.exposure.standsOut')!;
  assert.equal(exposure.label, 'simulated', 'the single weakest label stays for anything downstream');
  assert.deepEqual(exposure.labels, [{ what: 'CO2', kind: 'replayed' }, { what: 'location', kind: 'simulated' }]);
  assert.ok(a.text.includes(`NASA, ${CO2.name}: "${CO2.text}" (${CO2.url})`), 'quoted word for word with name and URL');
  assert.ok(!a.factsText.includes(CO2.text), 'the hub\'s sentences and NASA\'s words are kept apart');
});

test('a danger question about a reading under the limit says so, first, and never implies danger', () => {
  const danger = dangerCheck('Is the CO2 in my room dangerous?', reyes);
  const a = composeAnswer({ name: 'Reyes', question: 'Is the CO2 in my room dangerous?', readings: reyes, evidence: reyesCard(), passages: [], lang: 'en', roomName, danger });
  assert.equal(render(a.items[0], 'en'), "The CO2 in your cabin is under NASA's limit: 2.6 mmHg (1-hour average), 0.4 mmHg below 3 mmHg.");
  assert.equal(a.items.filter((i) => i.key.startsWith('answer.limit.')).length, 0, 'not said twice');
  assert.doesNotMatch(a.factsText, /danger|unsafe|harm/i);
  const over: PersonReadings = { ...reyes, readings: [{ ...reyes.readings[1], value: 3.4 } as Reading] };
  const b = composeAnswer({ name: 'Reyes', question: 'Is the CO2 in my room dangerous?', readings: over, evidence: null, passages: [], lang: 'en', danger: dangerCheck('Is the CO2 in my room dangerous?', over) });
  assert.equal(render(b.items[0], 'en'), "The CO2 in your cabin is over NASA's limit: 3.4 mmHg (1-hour average), 0.4 mmHg above 3 mmHg. The steps card for this applies.");
});

test('advice and diagnosis questions get the facts and the verdict, never a recommendation', () => {
  const advice = composeAnswer({ name: 'Reyes', question: 'Should I sleep somewhere else?', readings: reyes, evidence: reyesCard(), passages: [], lang: 'en', roomName });
  assert.equal(advice.items[advice.items.length - 1].key, 'answer.noAdvice');
  assert.ok(advice.items.some((i) => i.key === 'answer.points.room'));
  assert.doesNotMatch(advice.factsText, /\byou should\b|\bsleep (in|somewhere)\b|\bmove (to|rooms)\b/i);
  const sick = composeAnswer({ name: 'Reyes', question: 'Am I sick?', readings: reyes, evidence: reyesCard(), passages: [CO2], lang: 'en', roomName });
  assert.equal(sick.items[sick.items.length - 1].key, 'answer.noDiagnosis');
  assert.equal(sick.relevant, true);
  assert.deepEqual(sick.passages, [], 'no NASA text about other people\'s illnesses under "Am I sick?"');
  const how = composeAnswer({ name: 'Reyes', question: 'How much should I exercise?', readings: reyes, evidence: reyesCard(), passages: [CO2], lang: 'en', roomName });
  assert.ok(!how.items.some((i) => i.key === 'answer.noAdvice'), '"how much should I" asks for a fact, not advice');
  assert.equal(how.passages.length, 1);
});

test('an unknown verdict says the readings do not point anywhere yet', () => {
  const a = composeAnswer({ name: 'Reyes', question: 'Is it my room?', readings: reyes, evidence: reyesCard({ pointsTo: 'unknown', reasons: [] }), passages: [], lang: 'en', roomName });
  assert.ok(a.items.some((i) => render(i, 'en') === 'The readings do not point anywhere yet.'));
});

test('nothing relevant: no facts and no passage', () => {
  const a = composeAnswer({ name: 'Reyes', question: 'Who won the cup?', readings: reyes, evidence: reyesCard(), passages: [], lang: 'en' });
  assert.equal(a.relevant, false);
  assert.equal(a.items.length, 0);
  const ex = composeAnswer({ name: 'Reyes', question: 'How much should I exercise?', readings: reyes, evidence: reyesCard(), passages: [CO2], lang: 'en' });
  assert.equal(ex.relevant, true, 'a passage alone is something to say');
});

test('every key has English and Portuguese; Portuguese renders', () => {
  for (const [key, v] of Object.entries(ANSWER_STRINGS)) {
    assert.ok(v.en && v.pt, key);
    const data = (t: string) => [...new Set([...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((b) => !/^(You|you|are|Your|your|them|Voce|voce|de_voce)$/.test(b)))].sort();
    assert.deepEqual(data(v.en), data(v.pt), `${key}: same data blanks`);
  }
  const a = composeAnswer({ name: 'Reyes', question: 'Is it my room?', readings: reyes, evidence: reyesCard(), passages: [], lang: 'pt', roomName });
  assert.match(a.factsText, /Isso aponta para o ambiente \(Quarters 2\), não para você\./);
});

test('evidence lines for the prompt: hub numbers with labels, "points to", and they pass the cause check', () => {
  const lines = evidenceLines(reyesCard(), 'Reyes', roomName);
  assert.deepEqual(lines, [
    'CO2 exposure, last 72 hours: 10.9 h in Quarters 2 above 2.8 mmHg; crewmates at most 0 h above 2.8 mmHg (CO2 replayed; location simulated).',
    "Single CO2 readings above 3 mmHg: 6.1 h in total (NASA's limit is for the 1-hour average, not single readings) (CO2 replayed; location simulated).",
    'headache reported on 3 days in a row (reported).',
    'No body reading is unusual for Reyes.',
    "The hub's comparison points to the room (Quarters 2), not to Reyes.",
  ]);
  assert.equal(statesCause(lines.join('\n')), false);
});

test('a crewmate asking about someone else: the name first, then the profile\'s pronouns', () => {
  const she = composeAnswer({ name: 'Reyes', who: { name: 'Reyes', pronouns: 'she', self: false }, question: 'Why does she keep waking up with a headache?', readings: reyes, evidence: reyesCard(), passages: [], lang: 'en', roomName });
  const lines = renderItems(she.items, 'en', she.who);
  assert.equal(lines[0], "The CO2 in Reyes's cabin reads 2.6 mmHg (1-hour average), 0.4 mmHg below NASA's limit of 3 mmHg. (replayed)");
  assert.equal(lines[1], 'None of her body readings is unusual for her right now. (simulated)');
  assert.match(lines[2], /^In the last 72 hours she spent 10\.9 hours in Quarters 2/);
  assert.equal(lines[4], 'She reported headache on 3 days in a row. (reported)');
  assert.equal(lines[5], 'This points to the room (Quarters 2), not to her. (hub)');
  assert.doesNotMatch(she.factsText, /\byou(r)?\b/i);
  const they = composeAnswer({ name: 'Okafor', who: { name: 'Okafor', pronouns: 'they', self: false }, question: 'Is it their room?', readings: { ...reyes, name: 'Okafor' }, evidence: reyesCard(), passages: [], lang: 'en', roomName });
  assert.match(they.factsText, /not to them\. \(hub\)/);
  assert.doesNotMatch(they.factsText, /\b(she|her|he|him|his)\b/i, 'unset means they/them');
  const pt = composeAnswer({ name: 'Reyes', who: { name: 'Reyes', pronouns: 'she', self: false }, question: 'Is it her room?', readings: reyes, evidence: reyesCard(), passages: [], lang: 'pt', roomName });
  assert.match(pt.factsText, /^O CO2 na cabine de Reyes está em 2\.6 mmHg/);
  assert.match(pt.factsText, /Isso aponta para o ambiente \(Quarters 2\), não para ela\./);
});

test('the 1-hour average: said only when the evidence card carries the highest one', () => {
  const plain = composeAnswer({ name: 'Reyes', question: 'Is it my room?', readings: reyes, evidence: reyesCard(), passages: [], lang: 'en', roomName });
  assert.ok(!plain.items.some((i) => i.key.startsWith('answer.exposure.hour')), 'no field, no sentence');
  const card = reyesCard();
  (card.whereBeen.windows[0].people[0] as unknown as { maxHourAverage: number }).maxHourAverage = 2.94;
  const a = composeAnswer({ name: 'Reyes', question: 'Is it my room?', readings: reyes, evidence: card, passages: [], lang: 'en', roomName });
  assert.ok(a.factsText.includes("The 1-hour average, which is what NASA's limit of 3 mmHg applies to, stayed under it throughout; the highest was 2.9 mmHg."));
  assert.doesNotMatch(a.factsText, /above (the|NASA's) limit/);
});

test('when NASA\'s text only comes near the question, the answer says so first', () => {
  const a = composeAnswer({ name: 'Reyes', question: 'How much should I exercise?', readings: reyes, evidence: null, passages: [CO2], lang: 'en', notExact: true });
  assert.match(a.text, /^NASA's text does not answer this exactly\. Here is what it does say, and what the readings show\. /);
  assert.ok(a.text.indexOf('\n\nNASA, ') > a.text.indexOf('(replayed)'), 'the line, then the facts, then the quotes');
  assert.equal(composeAnswer({ name: 'Reyes', question: 'Who won?', readings: reyes, evidence: null, passages: [], lang: 'en', notExact: true }).items.length, 0, 'never alone');
});

test('amount, dose and treatment questions, and passages that name treatments', () => {
  for (const q of ['How long does she have to stay on oxygen?', 'How long should she stay on it?', 'What dose is right?', 'What treatment does she need?']) assert.ok(asksAmountOrTreatment(q), q);
  assert.equal(asksAmountOrTreatment('Is it my room?'), false);
  assert.ok(namesTreatment('If DCS occurs, current treatment options include recompression to sea level pressure or higher (hyperbaric therapy), breathing 100% O2'));
  assert.equal(namesTreatment('Six to seven days a week, astronauts on the International Space Station perform resistance training'), false);
});

// ---------- property: no template can ever state a cause ----------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test('property: over 3000 generated cards, readings and questions, no output states a cause, a danger under the limit, or advice', () => {
  const r = rng(20261114);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const KINDS: Kind[] = ['measured', 'estimated', 'reported', 'replayed', 'simulated'];
  const POINTS: PointsTo[] = ['room', 'person', 'sensor', 'unknown'];
  const SIGNALS = ['checkin.headache', 'checkin.chest_pain', 'checkin.nausea', 'checkin.poor_sleep', 'checkin.due_to_stress', 'checkin.caused_by_noise'];
  const QUESTIONS = ['Why do I keep waking up with a headache?', 'Is it my room?', 'Is the CO2 in my room dangerous?', 'Am I sick?', 'Should I sleep somewhere else?',
    'How much should I exercise?', 'Is the air safe?', 'Is my heart rate ok?', 'What is going on with me?', 'Is the CO2 too high?', 'Who won?'];
  for (let n = 0; n < 3000; n++) {
    const co2 = Math.round(r() * 60) / 10;
    const readings: PersonReadings = {
      name: 'Reyes', readings: [
        { type: 'limit', name: 'cabin CO2', value: co2, unit: 'mmHg', label: pick(KINDS), window: '1-hour average', limit: 3 },
        { type: 'normal', name: 'heart rate', value: 50 + Math.round(r() * 60), unit: 'bpm', label: pick(KINDS), normal: [60, 70] },
        { type: 'series', name: 'sleep', values: [6.1, 5.2], unit: 'h', window: 'last 2 nights', label: pick(KINDS) },
      ],
    };
    const above = r() * 40;
    const others = r() < 0.5 ? 0 : r() * 10;
    const card = reyesCard({
      pointsTo: pick(POINTS),
      focusRoom: r() < 0.8 ? 'quarters-2' : null,
      unusual: r() < 0.5 ? { signals: [], score: 0 } : { signals: [{ signal: 'heart_rate', direction: 'high', z: 4, recent: 90.04, usual: 64, mode: 'dense', state: 'rest', baselineCount: 40, kinds: {}, kind: pick(KINDS) }], score: 0.7 },
      reported: { rows: [], runs: r() < 0.3 ? [] : [{ signal: pick(SIGNALS), count: 1 + Math.floor(r() * 5), days: Math.floor(r() * 5), lastAt: 0, kind: pick(KINDS) }] },
      reasons: [
        ...(r() < 0.6 ? [{ code: 'exposure-stands-out' as const, room: 'quarters-2', level: 2.8, ms: above * H, crewmatesMaxMs: others * H, windowMs: 72 * H, kind: pick(KINDS) }] : []),
        ...(r() < 0.3 ? [{ code: 'crewmates-same' as const, signal: 'heart_rate', room: 'quarters-2', people: ['leo'] }] : []),
        ...(r() < 0.3 ? [{ code: 'crewmates-normal' as const, signal: 'heart_rate', room: 'quarters-2', people: ['okafor', 'tanaka'] }] : []),
      ],
    });
    const question = pick(QUESTIONS);
    const danger = dangerCheck(question, readings);
    const who = r() < 0.5 ? undefined : { name: 'Reyes', pronouns: pick(['she', 'he', 'they'] as const), self: false };
    for (const lang of ['en', 'pt'] as const) {
      const a = composeAnswer({ name: 'Reyes', who, question, readings, evidence: card, passages: r() < 0.5 ? [CO2] : [], lang, roomName, danger, notExact: r() < 0.3 });
      const hub = a.factsText;
      if (lang === 'en') {
        assert.equal(statesCause(hub), false, hub);
        assert.doesNotMatch(hub.replace('The hub does not diagnose.', ''), /\b(because of|caused by|due to|causing|leads? to|results? in|will (get|become|be)|diagnos\w*)\b/i, hub);
        assert.doesNotMatch(hub, /\byou should\b|\b(take|drink|rest|avoid|stop|start)\b [a-z]/i, hub);
        // Each hub sentence passes the hub's own output checks against the hub's own numbers.
        const facts = [readingsBlock(readings, null) ?? '', ...evidenceLines(card, 'Reyes', roomName)].join('\n');
        assert.doesNotMatch(hub, /\b(above|over|exceed\w*)\b[^.]{0,30}\blimit\b[^.]{0,40}\b(for|during)\b|\b\d+(\.\d+)?\s*hours?\b[^.]{0,60}\b(above|over)\b[^.]{0,30}\blimit\b/i, `no time "above the limit": ${hub}`);
        for (const item of a.items) {
          const s = render(item, 'en');
          const c = checkAnswer({ answer: `${s} ${s}`, passageNames: [], facts: `${facts}\n${hub}`, message: facts });
          assert.ok(!c.reasons.some((x) => /cause|diagnosis|medicine|help only Earth|false comfort/.test(x)), `${s}: ${c.reasons.join('; ')}`);
        }
        if (co2 <= 3) assert.doesNotMatch(hub, /danger|unsafe|harm|above NASA's limit|over NASA's limit/i, hub);
        if (co2 > 3 && a.items.some((i) => i.key === 'answer.limit.over' || i.key === 'answer.danger.over')) assert.match(hub, /steps card for this applies/);
      }
      for (const item of a.items as FactItem[]) assert.ok(ANSWER_STRINGS[item.key], item.key);
    }
  }
  assert.equal(reportedName('checkin.chest_pain'), 'chest pain');
});

test('the cabin sentence names the room the person is in now, and "your cabin" only for their own quarters', () => {
  const galleyCo2: Extract<Reading, { type: 'limit' }> = { type: 'limit', name: 'cabin CO2', value: 2.4, unit: 'mmHg', label: 'replayed', window: '1-hour average', limit: 3, room: 'galley', here: true };
  const inGalley: PersonReadings = { name: 'Reyes', pronoun: 'her', readings: [galleyCo2] };
  const names: Record<string, string> = { galley: 'the Galley', 'quarters-2': 'Quarters 2' };
  const quartersNow = [{ type: 'limit' as const, name: 'cabin CO2', value: 2.7, unit: 'mmHg', label: 'replayed' as const, window: '1-hour average', limit: 3 }];
  const base = { name: 'Reyes', question: 'Why do I keep waking up with a headache?', evidence: reyesCard(), passages: [], lang: 'en' as const, roomName: (id: string) => names[id] ?? id, quarters: 'quarters-2', roomReadings: (room: string) => (room === 'quarters-2' ? quartersNow : []) };
  const self = renderItems(composeAnswer({ ...base, readings: inGalley }).items, 'en', { name: 'Reyes', pronouns: 'she', self: true });
  assert.equal(self[0], "The CO2 in the Galley, where you are now, reads 2.4 mmHg (1-hour average), 0.6 mmHg below NASA's limit of 3 mmHg. (replayed)");
  assert.equal(self[1], "The CO2 in your cabin reads 2.7 mmHg (1-hour average), 0.3 mmHg below NASA's limit of 3 mmHg. (replayed)", 'the room the card points to, her quarters, as its own sentence');
  const other = composeAnswer({ ...base, readings: inGalley, who: { name: 'Reyes', pronouns: 'she', self: false } });
  const lines = renderItems(other.items, 'en', other.who);
  assert.equal(lines[0], "The CO2 in the Galley, where Reyes is now, reads 2.4 mmHg (1-hour average), 0.6 mmHg below NASA's limit of 3 mmHg. (replayed)");
  assert.equal(lines[1], "The CO2 in her cabin reads 2.7 mmHg (1-hour average), 0.3 mmHg below NASA's limit of 3 mmHg. (replayed)");
  assert.match(renderItems(other.items, 'pt', other.who)[0], /^O CO2 em the Galley, onde Reyes está agora, está em 2\.4 mmHg/);
  // Nobody's cabin but theirs: a focus room that is not her quarters is named plainly.
  const lab = composeAnswer({ ...base, readings: inGalley, evidence: reyesCard({ focusRoom: 'lab' }), roomReadings: () => quartersNow });
  const labLines = renderItems(lab.items, 'en', lab.who);
  assert.equal(labLines[1], "The CO2 in lab reads 2.7 mmHg (1-hour average), 0.3 mmHg below NASA's limit of 3 mmHg. (replayed)");
  assert.ok(labLines.every((l) => !/your cabin/.test(l)), labLines.join('\n'));
  // In her own quarters now: the cabin sentence, once, and nothing added.
  const home = composeAnswer({ ...base, readings: { name: 'Reyes', readings: [{ ...galleyCo2, room: 'quarters-2' }] } });
  assert.deepEqual(home.items.filter((i) => i.key.startsWith('answer.limit')).map((i) => i.key), ['answer.limit.under']);
  // A danger question about the room she is in now names it too.
  const danger = composeAnswer({ ...base, readings: inGalley, question: 'Is the CO2 in my room dangerous?', danger: dangerCheck('Is the CO2 in my room dangerous?', inGalley) });
  assert.equal(render(danger.items[0], 'en'), "The CO2 in the Galley, where you are now, is under NASA's limit: 2.4 mmHg (1-hour average), 0.6 mmHg below 3 mmHg.");
});

test('gravity is stated as a plain fact, only when the question or a card turns on it', () => {
  const ask = (question: string, gravity: number | null, gravityMatters = false) =>
    composeAnswer({ name: 'Reyes', question, readings: reyes, evidence: null, passages: [], lang: 'en', gravity, gravityMatters }).items.filter((i) => i.key.startsWith('answer.gravity'));
  assert.deepEqual(ask('Why do my legs feel weak when I float?', 0).map((i) => render(i, 'en')), ['You are weightless here.']);
  const mars = ask('Does the gravity here change my bones?', 0.38);
  assert.deepEqual(mars.map((i) => [render(i, 'en'), render(i, 'pt'), i.label]), [["Gravity here is 0.38 of Earth's.", 'A gravidade aqui é 0.38 da gravidade da Terra.', 'hub']]);
  assert.deepEqual(ask('How did I sleep?', 0.38), [], 'not about gravity: not said');
  assert.equal(ask('How did I sleep?', 0.166, true).length, 1, 'a card that depends on gravity: said');
  assert.deepEqual(ask('Am I floating?', null), [], 'unknown gravity: nothing said');
});
