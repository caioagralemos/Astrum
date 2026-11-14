import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiRuntime, AiTimeout, handleAsk, serverArgs } from './ai.ts';
import type { AskContext, AskResult, ChatRequest, ModelClient } from './ai.ts';
import { buildIndex } from '../engine/search.ts';
import type { Passage } from '../engine/search.ts';
import { parseCards, NO_CARD_FITS } from '../engine/cards.ts';
import { REFUSAL_TEXT } from '../engine/prompt.ts';
import type { PersonReadings } from '../engine/prompt.ts';
import library from '../data-nasa/passages/passages.json' with { type: 'json' };

const index = buildIndex(library as Passage[]);
const CO2_BRIEF = 'NASA-STD-3001 CO2 Technical Brief';

/** Stands in for llama-server. Records what it was asked; never more than one answer at a time is the runtime's job. */
class FakeModel implements ModelClient {
  answer = '';
  urgent: 'URGENT' | 'ROUTINE' = 'ROUTINE';
  delayMs = 0;
  error: Error | null = null;
  answers = 0;
  active = 0;
  maxActive = 0;
  seen: string[] = [];
  healthy = true;
  warmFails = false;
  async health() { return this.healthy ? 'ok' as const : 'down' as const; }
  async props() { return { modelPath: null }; }
  async chat(req: ChatRequest): Promise<string> {
    if (req.maxTokens === 1 && this.warmFails) throw new Error('no answer');
    if (req.maxTokens === 1) return '';
    if (req.responseFormat) return `{"label": "${this.urgent}"}`;
    this.answers++;
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.seen.push(req.messages[req.messages.length - 1].content);
    await new Promise((r) => setTimeout(r, this.delayMs));
    this.active--;
    if (this.error) throw this.error;
    return this.answer;
  }
}

const reyes: PersonReadings = {
  name: 'Reyes', pronoun: 'her', readings: [
    { type: 'limit', name: 'cabin CO2', value: 4.6, unit: 'mmHg', label: 'replayed', window: '1-hour average', limit: 3 },
    { type: 'normal', name: 'resting heart rate', value: 84, unit: 'bpm', label: 'simulated', normal: 64 },
  ],
};

// Placeholder cards: the tests check which card is picked, not what it says.
const cardFile = [
  { id: 'chest-pain', title: { en: 'Chest pain', pt: 'Dor no peito' }, level: 'dangerous', notify: 'everyone', message_houston: true,
    signs: { readings: [], answers: [], words: { en: ['chest pain'], pt: [] } }, steps: [{ en: 'step marker', pt: 'marcador' }],
    do_not: [], sources: [], unverified: [], status: 'approved', en_checked: true, notes: '' },
  { id: NO_CARD_FITS, title: { en: 'No card fits', pt: 'Nenhum cartão' }, level: 'dangerous', notify: 'everyone', message_houston: true,
    signs: { readings: [], answers: [], words: { en: [], pt: [] } }, steps: [{ en: 'fallback marker', pt: 'marcador' }],
    do_not: [], sources: [], unverified: [], status: 'approved', en_checked: true, notes: '' },
];

function context(ai: AiRuntime, crisis: string[] = []): AskContext {
  return {
    ai, index,
    readingsFor: (p) => (p === 'reyes' ? reyes : null),
    detectorLineFor: () => 'Detector: anomaly 0.91. Main signals: CO2, heart rate.',
    cards: () => parseCards(cardFile),
    facts: () => ({ readings: [], answers: [] }),
    onCrisis: (p) => { crisis.push(p); return true; },
  };
}

async function serve(ctx: AskContext): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    void handleAsk(req, res, new URL(req.url ?? '/', 'http://hub'), ctx).then((handled) => { if (!handled) res.writeHead(404).end(); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${port}` };
}

async function ask(url: string, body: unknown): Promise<{ lines: Record<string, unknown>[]; result: AskResult; status: number; raw: string }> {
  const res = await fetch(`${url}/api/ask`, { method: 'POST', body: JSON.stringify(body) });
  const raw = await res.text();
  const lines = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  return { lines, result: lines[lines.length - 1] as unknown as AskResult, status: res.status, raw };
}

const close = (server: Server) => new Promise<void>((r) => server.close(() => r()));

async function withHub(fn: (url: string, model: FakeModel, crisis: string[]) => Promise<void>): Promise<void> {
  const model = new FakeModel();
  const ai = new AiRuntime({ log: () => {}, client: model, warm: false });
  await ai.start();
  const crisis: string[] = [];
  const { server, url } = await serve(context(ai, crisis));
  try { await fn(url, model, crisis); } finally {
    await close(server);
    await ai.stop();
  }
}

test('the server is started with the spec\'s flags', () => {
  assert.deepEqual(serverArgs('/m.gguf', 18431), ['-m', '/m.gguf', '--host', '127.0.0.1', '--port', '18431', '-c', '8192', '-np', '2', '--reasoning-budget', '0', '--temp', '0', '--no-webui']);
});

test('a checked answer comes back with its passages, sources and reading labels', async () => {
  await withHub(async (url, model) => {
    model.answer = `Cabin CO2 is 4.6 mmHg, 1.6 mmHg above the NASA limit of 3 mmHg for the 1-hour average.\nSource: [${CO2_BRIEF}]`;
    const status = await (await fetch(`${url}/api/ask/status`)).json() as { state: string };
    assert.equal(status.state, 'ready');
    const { result, lines, status: code } = await ask(url, { person: 'reyes', question: 'Is the CO2 in my room too high?' });
    assert.equal(code, 200);
    assert.equal(lines[0].type, 'status');
    assert.equal(result.route, 'answer');
    assert.equal(result.by, 'model');
    assert.equal(result.source, CO2_BRIEF);
    assert.ok(result.passages.length >= 1 && result.passages.length <= 3);
    assert.ok(result.passages.every((p) => p.name && p.url.startsWith('https://www.nasa.gov/')));
    assert.deepEqual(result.readings.map((r) => r.label), ['replayed', 'simulated', 'detector']);
    assert.match(result.readings[0].line, /^cabin CO2 \(replayed\) 4\.6 mmHg, 1-hour average: 1\.6 mmHg above the NASA limit of 3 mmHg\.$/);
    assert.match(model.seen[0], /PASSAGE \[NASA-STD-3001 CO2 Technical Brief\]/);
    assert.equal(result.urgent, false);
  });
});

test('an answer that fails a check is replaced by the hub\'s own answer, never streamed', async () => {
  await withHub(async (url, model) => {
    model.answer = 'Open the window and take 400 mg of ibuprofen.';
    const { result, raw } = await ask(url, { person: 'reyes', question: 'Why does my head hurt?' });
    assert.equal(result.by, 'hub');
    assert.equal(result.text, result.facts?.text);
    assert.match(result.text, /The CO2 in your cabin reads 4\.6 mmHg \(1-hour average\), 1\.6 mmHg above NASA's limit of 3 mmHg\. The steps card for this applies\. \(replayed\)/);
    assert.match(result.text, /NASA, NASA-STD-3001 CO2 Technical Brief: "/, 'NASA quoted with its name');
    assert.equal(result.check?.discarded, true);
    assert.doesNotMatch(raw.replace(/"reasons":\[[^\]]*\]/, ''), /ibuprofen/, 'the discarded words appear only in the check reasons');
  });
});

test('advice and diagnosis questions are answered by the hub, never the model; a model refusal with a passage found falls back to the hub', async () => {
  await withHub(async (url, model) => {
    model.answer = 'Cabin CO2 is 4.6 mmHg, 1.6 mmHg above the NASA limit of 3 mmHg.';
    const sick = await ask(url, { person: 'reyes', question: 'Am I sick?' });
    assert.equal(sick.result.by, 'hub');
    assert.match(sick.result.text, /The hub does not diagnose\. Ask your Crew Medical Officer\./);
    const move = await ask(url, { person: 'reyes', question: 'Should I sleep somewhere else?' });
    assert.match(move.result.text, /The hub does not recommend what to do\./);
    model.answer = "I don't know. The passage says CO2 is limited to 3 mmHg.";
    const refused = await ask(url, { person: 'reyes', question: 'Is the CO2 in my room too high for sleeping well?' });
    assert.equal(refused.result.by, 'hub');
  });
});

test('asking about a crewmate: third person with the profile\'s pronouns; wrong pronouns are thrown away', async () => {
  const model = new FakeModel();
  const ai = new AiRuntime({ log: () => {}, client: model, warm: false });
  await ai.start();
  const people: Record<string, PersonReadings> = { reyes, okafor: { ...reyes, name: 'Okafor' } };
  const { server, url } = await serve({
    ...context(ai), readingsFor: (p) => people[p] ?? null, personName: (p) => people[p]?.name ?? p,
    pronounsOf: (p) => (p === 'reyes' ? 'she' : undefined),
  });
  try {
    model.answer = 'He has cabin CO2 at 4.6 mmHg, 1.6 mmHg above the NASA limit of 3 mmHg.';
    const wrong = await ask(url, { person: 'okafor', about: 'reyes', question: 'Is the air in her room the problem?' });
    assert.match(model.seen[0], /^ASKER: Okafor, a crewmate, is asking about Reyes\. Refer to Reyes as "she\/her"\./);
    assert.match(model.seen[0], /\(her normal 64\)/);
    assert.equal(wrong.result.by, 'hub');
    assert.match(wrong.result.check?.reasons.join(' ') ?? '', /uses "he" for Reyes/);
    assert.match(wrong.result.text, /^The CO2 in Reyes's cabin reads 4\.6 mmHg/);
    model.answer = 'Reyes has cabin CO2 at 4.6 mmHg, 1.6 mmHg above the NASA limit of 3 mmHg.';
    const named = await ask(url, { person: 'reyes', question: 'Is the air in my room the problem?' });
    assert.match(named.result.check?.reasons.join(' ') ?? '', /instead of "you"/);
    assert.equal((await ask(url, { person: 'okafor', about: 'nobody', question: 'Is the air ok?' })).status, 404);
  } finally {
    await close(server);
    await ai.stop();
  }
});

test('when the model declines, the hub opens with "NASA\'s text does not answer this exactly"; amounts with treatment passages get the refusal', async () => {
  await withHub(async (url, model) => {
    model.answer = "I don't know. The passage does not say.";
    const near = await ask(url, { person: 'reyes', question: 'Does the CO2 in my room change how I sleep?' });
    assert.equal(near.result.by, 'hub');
    assert.match(near.result.text, /^NASA's text does not answer this exactly\./);
    const oxygen = await ask(url, { person: 'reyes', question: 'How many hours of 100% oxygen does she need for decompression sickness treatment?' });
    assert.ok(oxygen.result.passages.some((p) => /treatment|hyperbaric|recompression/i.test(p.text)), 'the search found treatment text');
    assert.equal(oxygen.result.text, REFUSAL_TEXT);
    assert.deepEqual(oxygen.result.facts?.passages, [], 'no treatment passage shown as if it answered');
  });
});

test('with nothing relevant to say, a discarded answer is still the fixed refusal', async () => {
  await withHub(async (url, model) => {
    model.answer = 'Open the window and take 400 mg of ibuprofen.';
    const { result } = await ask(url, { person: 'reyes', question: 'Who won the football game back home?' });
    assert.equal(result.by, 'fixed');
    assert.equal(result.text, REFUSAL_TEXT);
    assert.equal(result.facts?.relevant, false);
  });
});

test('a danger question: a model answer that disagrees with the hub\'s under/over verdict is thrown away', async () => {
  await withHub(async (url, model) => {
    // Reyes's CO2 here is 4.6 mmHg, over the limit of 3: "No" would be wrong.
    model.answer = 'No. Cabin CO2 is 4.6 mmHg, 1.6 mmHg above the NASA limit of 3 mmHg.';
    const no = await ask(url, { person: 'reyes', question: 'Is the CO2 in my room dangerous?' });
    assert.equal(no.result.by, 'hub');
    assert.match(no.result.check?.reasons[0] ?? '', /disagrees with the hub: the reading is over/);
    assert.match(no.result.text, /^The CO2 in your cabin is over NASA's limit: 4\.6 mmHg/);
    model.answer = 'Yes. Cabin CO2 is 4.6 mmHg, 1.6 mmHg above the NASA limit of 3 mmHg.';
    const yes = await ask(url, { person: 'reyes', question: 'Is the CO2 in my room dangerous?' });
    assert.equal(yes.result.by, 'model');
    assert.ok(yes.result.facts?.relevant, 'the hub\'s facts travel alongside');
  });
});

test('the evidence card reaches the prompt as hub lines, and the facts always come back', async () => {
  const model = new FakeModel();
  model.answer = 'Cabin CO2 is 4.6 mmHg, 1.6 mmHg above the NASA limit of 3 mmHg.';
  const ai = new AiRuntime({ log: () => {}, client: model, warm: false });
  await ai.start();
  const card = {
    person: 'reyes', now: 0, unusual: { signals: [], score: 0 }, sameRoom: [], focusRoom: 'quarters-2', pointsTo: 'room' as const,
    whereBeen: { windows: [], onlyThem: [] }, reported: { rows: [], runs: [{ signal: 'checkin.headache', count: 3, days: 3, lastAt: 0, kind: 'reported' as const }] }, reasons: [],
  };
  const { server, url } = await serve({ ...context(ai), evidenceFor: () => card, roomName: () => 'Quarters 2' });
  try {
    const { result } = await ask(url, { person: 'reyes', question: 'Is it my room?' });
    assert.match(model.seen[0], /headache reported on 3 days in a row \(reported\)\.\nNo body reading is unusual for Reyes\.\nThe hub's comparison points to the room \(Quarters 2\), not to Reyes\.\nDetector:/);
    assert.ok(result.facts?.items.some((i) => i.key === 'answer.points.room'));
    const crisis = await ask(url, { person: 'reyes', question: 'everyone would be better off without me' });
    assert.equal(crisis.result.facts, null, 'never on the crisis route');
    const urgent = await ask(url, { person: 'reyes', question: 'Reyes has chest pain' });
    assert.equal(urgent.result.facts, null, 'never on the card route');
  } finally {
    await close(server);
    await ai.stop();
  }
});

test('a crisis never reaches the model, sends for a person, and never repeats the words', async () => {
  await withHub(async (url, model, crisis) => {
    const words = 'I keep thinking everyone would be better off without me';
    const { result, raw } = await ask(url, { person: 'reyes', question: words });
    assert.equal(result.route, 'crisis');
    assert.equal(model.answers, 0);
    assert.deepEqual(crisis, ['reyes']);
    assert.equal(result.key, 'ai.crisisTold');
    assert.doesNotMatch(raw, /better off/);
    assert.deepEqual(result.passages, []);
    assert.deepEqual(result.readings, []);
  });
});

test('the urgent word list opens the card her words point to, with no model call', async () => {
  await withHub(async (url, model) => {
    const chest = await ask(url, { person: 'reyes', question: 'Reyes has chest pain' });
    assert.equal(chest.result.route, 'card');
    assert.equal(chest.result.card?.id, 'chest-pain');
    const fell = await ask(url, { person: 'reyes', question: 'Leo fell off the ladder' });
    assert.equal(fell.result.card?.id, NO_CARD_FITS);
    assert.equal(model.answers, 0);
  });
});

test('medicine questions get the fixed refusal without the model; unknown people are refused', async () => {
  await withHub(async (url, model) => {
    const { result } = await ask(url, { person: 'reyes', question: 'What dose of melatonin should I take tonight?' });
    assert.equal(result.route, 'fixed');
    assert.equal(result.text, REFUSAL_TEXT);
    assert.equal(model.answers, 0);
    assert.equal((await ask(url, { person: 'nobody', question: 'Hi there' })).status, 404);
    assert.equal((await fetch(`${url}/api/ask`, { method: 'POST', body: 'not json' })).status, 400);
  });
});

test('when the urgent check says URGENT, the card shows above the normal answer', async () => {
  await withHub(async (url, model) => {
    model.urgent = 'URGENT';
    model.answer = 'Cabin CO2 is 4.6 mmHg, 1.6 mmHg above the NASA limit of 3 mmHg.';
    const { result } = await ask(url, { person: 'reyes', question: 'I feel strange and the room is spinning' });
    assert.equal(result.urgent, true);
    assert.equal(result.card?.id, NO_CARD_FITS);
    assert.equal(result.route, 'answer');
  });
});

test('too slow is the fallback: the readings and passages, no generated text', async () => {
  await withHub(async (url, model) => {
    model.error = new AiTimeout('first-token');
    const { result } = await ask(url, { person: 'reyes', question: 'Is the CO2 in my room too high?' });
    assert.equal(result.route, 'fallback');
    assert.equal(result.by, 'hub', 'too slow: the hub\'s own answer');
    assert.ok(result.readings.length > 0 && result.passages.length > 0);
    const other = await ask(url, { person: 'reyes', question: 'Who won the football game back home?' });
    assert.equal(other.result.key, 'ai.slow', 'nothing relevant: the fixed text');
  });
});

test('one question at a time: the second waits and is told its place', async () => {
  await withHub(async (url, model) => {
    model.delayMs = 150;
    model.answer = 'Cabin CO2 is 4.6 mmHg, 1.6 mmHg above the NASA limit of 3 mmHg.';
    const [a, b] = await Promise.all([
      ask(url, { person: 'reyes', question: 'Is the CO2 in my room too high?' }),
      ask(url, { person: 'reyes', question: 'How is my heart rate today?' }),
    ]);
    assert.equal(model.maxActive, 1);
    assert.equal(model.answers, 2);
    const queued = [...a.lines, ...b.lines].filter((l) => l.state === 'queued');
    assert.equal(queued.length, 1);
    assert.equal(queued[0].position, 1);
  });
});

// ---------- the sidecar: missing files, and the port ----------

const dir = mkdtempSync(join(tmpdir(), 'astrum-ai-test-'));
const modelFile = join(dir, 'LFM3-1.7B-Q8_0.gguf');
writeFileSync(modelFile, 'not a real model');
after(() => rmSync(dir, { recursive: true, force: true }));

async function stub(handler: (path: string) => { status: number; body: string }): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const { status, body } = handler(req.url ?? '/');
    res.writeHead(status, { 'content-type': 'application/json' }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: (server.address() as { port: number }).port };
}

test('a missing model or binary leaves the AI off and the API answering plainly', async () => {
  const ai = new AiRuntime({ log: () => {}, model: join(dir, 'missing.gguf'), binary: process.execPath, port: 1, warm: false });
  await ai.start();
  assert.equal(ai.state, 'unavailable');
  assert.match(ai.reason ?? '', /model file is missing/);
  const noBinary = new AiRuntime({ log: () => {}, model: modelFile, binary: join(dir, 'no-llama-server'), port: 1 });
  await noBinary.start();
  assert.match(noBinary.reason ?? '', /llama-server program is missing/);

  const { server, url } = await serve(context(ai));
  try {
    const status = await (await fetch(`${url}/api/ask/status`)).json() as { state: string };
    assert.equal(status.state, 'unavailable');
    const { result } = await ask(url, { person: 'reyes', question: 'Is the CO2 in my room too high?' });
    assert.equal(result.route, 'unavailable');
    assert.equal(result.by, 'hub', 'the hub still answers from its own numbers');
    const other = await ask(url, { person: 'reyes', question: 'Who won the football game back home?' });
    assert.equal(other.result.key, 'ai.unavailable');
  } finally {
    await close(server);
    await ai.stop();
    await noBinary.stop();
  }
});

test('a port held by some other program is left alone', async () => {
  const { server, port } = await stub(() => ({ status: 404, body: '{"error":"not here"}' }));
  try {
    const ai = new AiRuntime({ log: () => {}, model: modelFile, binary: process.execPath, port, pidFile: join(dir, 'a.pid'), warm: false });
    await ai.start();
    assert.notEqual(ai.state, 'ready');
    assert.match(ai.reason ?? '', /used by another program/);
    await ai.stop();
    assert.equal((await fetch(`http://127.0.0.1:${port}/x`)).status, 404, 'still running');
  } finally {
    await close(server);
  }
});

test('a llama-server with the same model is reused; one with another model and no proof it is ours is left running', async () => {
  const props = (model: string) => (path: string) => path === '/health'
    ? { status: 200, body: '{"status":"ok"}' }
    : path === '/props' ? { status: 200, body: JSON.stringify({ default_generation_settings: {}, model_path: model }) } : { status: 404, body: '{}' };
  const same = await stub(props('/elsewhere/LFM3-1.7B-Q8_0.gguf'));
  const other = await stub(props('/elsewhere/Qwen3.5-27B.gguf'));
  try {
    const reuse = new AiRuntime({ log: () => {}, model: modelFile, binary: process.execPath, port: same.port, pidFile: join(dir, 'b.pid'), warm: false });
    await reuse.start();
    assert.equal(reuse.state, 'ready');
    await reuse.stop();
    assert.equal((await fetch(`http://127.0.0.1:${same.port}/health`)).status, 200, 'not ours, so not stopped');

    const refuse = new AiRuntime({ log: () => {}, model: modelFile, binary: process.execPath, port: other.port, pidFile: join(dir, 'c.pid'), warm: false });
    await refuse.start();
    assert.equal(refuse.state, 'unavailable');
    assert.match(refuse.reason ?? '', /left running/);
    await refuse.stop();
    assert.equal((await fetch(`http://127.0.0.1:${other.port}/health`)).status, 200);
  } finally {
    await close(same.server);
    await close(other.server);
  }
});

// ---------- the real model, only on request ----------

test('the real model answers through the whole path (ASTRUM_AI_TEST=1)', { skip: process.env.ASTRUM_AI_TEST !== '1', timeout: 240_000 }, async () => {
  const ai = new AiRuntime();
  await ai.start();
  try {
    assert.equal(ai.state, 'ready', ai.reason ?? '');
    const { server, url } = await serve(context(ai));
    try {
      const { result } = await ask(url, { person: 'reyes', question: 'Is the CO2 in my room over the limit?' });
      assert.equal(result.route, 'answer');
      assert.ok(result.text.length > 0);
      console.log(`real model, ${result.ms} ms, by ${result.by}: ${result.text}`);
    } finally {
      await close(server);
    }
  } finally {
    await ai.stop();
  }
});

// ---------- staying up ----------

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a slow answer does not take the runtime down', async () => {
  const model = new FakeModel();
  const ai = new AiRuntime({ log: () => {}, client: model, watchMs: 20 });
  await ai.start();
  const { server, url } = await serve(context(ai));
  try {
    model.error = new AiTimeout('first-token');
    const { result } = await ask(url, { person: 'reyes', question: 'Is the CO2 in my room too high?' });
    assert.equal(result.route, 'fallback');
    await wait(80);
    assert.equal(ai.status().state, 'ready', 'the server still answers its health check, so nothing was restarted');
  } finally {
    await close(server);
    await ai.stop();
  }
});

test('a server that stops answering is noticed, status says so at once, and it is brought back', async () => {
  const model = new FakeModel();
  const ai = new AiRuntime({ log: () => {}, client: model, watchMs: 20 });
  await ai.start();
  try {
    assert.equal(ai.status().state, 'ready');
    model.healthy = false;
    await wait(100);
    assert.notEqual(ai.status().state, 'ready');
    assert.match(ai.status().reason ?? '', /stopped answering|restarting/);
    model.healthy = true;
    await wait(1500); // first restart waits 1 s
    assert.equal(ai.status().state, 'ready');
  } finally {
    await ai.stop();
  }
});

test('ready means a question works: a failed warm-up is never reported as ready', async () => {
  const model = new FakeModel();
  model.warmFails = true;
  const ai = new AiRuntime({ log: () => {}, client: model, watchMs: 20 });
  await ai.start();
  try {
    assert.notEqual(ai.status().state, 'ready');
    assert.match(ai.status().reason ?? '', /warm-up/);
  } finally {
    await ai.stop();
  }
});
