// Demo mode's simulated Earth reply: only in demo mode, at the reply time,
// marked simulated: 'ai', the model's words only when every check passes, and
// never the model for a restricted alert or a crisis message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EarthReplies } from './earth-reply.ts';
import type { EarthRepliesOptions } from './earth-reply.ts';
import { crewMessage } from '../engine/earth.ts';
import { AI_FALLBACK_KEY, AI_FALLBACK_NO_CARD_KEY, CREW_REPLY_KEY, buildEarthReplyMessages, checkEarthReply } from '../engine/earth-reply.ts';
import type { ReplyFacts } from '../engine/earth-reply.ts';
import type { EarthMessage } from '../engine/alerts.ts';
import { t } from '../engine/strings.ts';

const MIN = 60_000;
const DELAY = 20 * MIN;
const GOOD = 'Mission control here: we have your message about the carbon dioxide alert in Quarters 2. Keep following the steps card on your screen. We are watching the readings with you and will write again in about 40 minutes.';
const facts: ReplyFacts = { kind: 'alert', room: 'Quarters 2', alertKind: 'Carbon dioxide', minutes: 40, card: true };
const ctx = { rooms: ['Quarters 2', 'Lab', 'Galley'], names: ['Ana Reyes', 'Reyes'] };

function alertMessage(sentAt: number): EarthMessage {
  return {
    id: `earth|alert|${sentAt}`, kind: 'alert', about: { person: 'reyes', room: 'q2', signal: 'co2', level: 3, stationWide: false },
    sentAt, arrivesAt: sentAt + DELAY, replyAt: sentAt + 2 * DELAY, delivered: false, reply: null, resolvedAt: null,
  };
}

function rig(list: EarthMessage[], over: Partial<EarthRepliesOptions> & { text?: string } = {}) {
  let now = 0;
  let calls = 0;
  let published = 0;
  const replies = new EarthReplies({
    messages: () => list,
    publish: () => { published++; },
    storyPlaying: () => false,
    restricted: () => false,
    facts: () => ({ room: 'Quarters 2', alertKind: 'Carbon dioxide', card: true }),
    delayMs: DELAY, demoSeconds: null, rooms: ctx.rooms, names: ctx.names,
    model: { ready: () => true, chat: async () => { calls++; return over.text ?? GOOD; } },
    clock: () => now, log: () => {},
    ...over,
  });
  const settle = () => new Promise((done) => setTimeout(done, 5));
  return { replies, at: (ms: number) => { now = ms; }, calls: () => calls, published: () => published, settle };
}

test('outside demo mode no reply is ever made: main.ts makes the replier only when not in production', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  assert.match(main, /const earthReplies = production \? null : new EarthReplies\(/);
  assert.match(main, /simulatedReply: null/);
  // With no replier, the watcher's list is left as it is: a message past its reply time keeps reply null.
  const m = crewMessage('reyes', 'hello Earth', 0, DELAY);
  assert.equal(m.reply, null);
});

test('demo mode: at replyAt the message gets the model\'s reply, marked simulated "ai", dated at its reply time', async () => {
  const m = alertMessage(1000);
  const r = rig([m]);
  r.at(m.replyAt - 1);
  r.replies.step();
  await r.settle();
  assert.equal(r.calls(), 0, 'nothing before the reply time');
  assert.equal(r.replies.apply([m])[0].reply, null);
  r.at(m.replyAt);
  r.replies.step();
  await r.settle();
  const out = r.replies.apply([m])[0];
  assert.equal(out.simulated, 'ai');
  assert.equal(out.reply?.text, GOOD);
  assert.equal(out.reply?.at, m.replyAt);
  assert.equal(out.reply?.simulated, true);
  assert.equal(out.reply?.key, undefined);
  assert.equal(out.sentAt, m.sentAt);
  assert.equal(r.published(), 1);
});

test('a model reply with a medicine, a dose or a new instruction is rejected and the fixed fallback is used', async () => {
  for (const text of [
    'Mission control here. Give her 400 mg of ibuprofen now. Keep following the steps card and we will write again in about 40 minutes.',
    'We have your message. Keep following the steps card on your screen. Start oxygen and we will write again in about 40 minutes.',
    'We have your message. Keep following the steps card on your screen. She will be fine, and we will write again in about 40 minutes.',
  ]) {
    const m = alertMessage(0);
    const r = rig([m], { text });
    r.at(m.replyAt);
    r.replies.step();
    await r.settle();
    const out = r.replies.apply([m])[0];
    assert.equal(r.calls(), 1);
    assert.equal(out.simulated, 'ai');
    assert.equal(out.reply?.key, AI_FALLBACK_KEY);
    assert.deepEqual(out.reply?.vars, { min: 40 });
    assert.equal(out.reply?.text, t(AI_FALLBACK_KEY, 'en', { min: 40 }));
  }
});

test('a privacy-restricted alert and a crisis message never reach the model; the fallback does not say why', async () => {
  const restricted = alertMessage(0);
  const crisis = crewMessage('reyes', 'I want to die', 0, DELAY);
  const r = rig([restricted, crisis], { restricted: (m) => m.kind === 'alert' });
  r.at(2 * DELAY);
  r.replies.step();
  await r.settle();
  assert.equal(r.calls(), 0);
  const keys = [AI_FALLBACK_KEY, CREW_REPLY_KEY];
  for (const out of r.replies.apply([restricted, crisis])) {
    assert.equal(out.simulated, 'ai');
    assert.equal(out.reply?.key, keys.shift());
    assert.doesNotMatch(out.reply!.text, /privacy|private|crisis|mood/i);
  }
});

test('never while a recorded story plays', async () => {
  const m = alertMessage(0);
  const r = rig([m], { storyPlaying: () => true });
  r.at(m.replyAt + MIN);
  r.replies.step();
  await r.settle();
  assert.equal(r.calls(), 0);
  assert.equal(r.replies.apply([m])[0].reply, null);
});

test('demoEarthReplySeconds: the reply comes that long after sending, and the message says its delay is simulated', async () => {
  const m = alertMessage(0);
  const r = rig([m], { demoSeconds: 20 });
  r.at(19_000);
  r.replies.step();
  await r.settle();
  let out = r.replies.apply([m], 19_000)[0];
  assert.equal(out.reply, null);
  assert.equal(out.replyAt, 20_000);
  assert.equal(out.simulatedDelay, true);
  r.at(20_000);
  r.replies.step();
  await r.settle();
  out = r.replies.apply([m], 20_000)[0];
  assert.equal(out.simulated, 'ai');
  assert.equal(out.reply?.at, 20_000);
});

test('the reply checks: a short flight-surgeon reply passes; extra sentences, stray numbers, names and other rooms do not', () => {
  assert.deepEqual(checkEarthReply(GOOD, facts, ctx), { ok: true, text: GOOD });
  const bad = (text: string) => { const v = checkEarthReply(text, facts, ctx); return v.ok ? [] : v.reasons; };
  assert.ok(bad(`${GOOD} Stay calm.`).length, 'four sentences');
  assert.ok(bad(GOOD.replace('Quarters 2', 'Lab')).length, 'a room the facts do not give');
  assert.ok(bad(GOOD.replace('the carbon dioxide alert', 'Reyes and the alert')).length, 'a name');
  assert.ok(bad(GOOD.replace('readings with you', 'readings at 1,500 ppm')).length, 'a number of its own');
  assert.ok(bad('Mission control here: we have your message. Take the medicine on the steps card. We will write again in about 40 minutes.').length);
  assert.ok(bad('Mission control here: we have your message. The cause is the CO2 in the room. Keep following the steps card, we will write again in about 40 minutes.').length);
  assert.ok(bad('Aqui é o controle da missão. Continuem seguindo o steps card. Escreveremos em 40 minutes.').length, 'not English');
});

const LIVE_FAILURE = 'Mission control here: a crewmate has sent a message, and we have an alert for noise in Galley. Keep following the steps card on your screen. We are monitoring the readings with you and will write again in about 40 minutes.';
const MARS_ROOMS = ['Commons', 'Command', 'Lab', 'Medical', 'Quarters 1', 'Quarters 2', 'Quarters 3', 'Quarters 4', 'Airlock', 'Greenhouse'];

test('the live failure is rejected: an invented room ("Galley") and an alert the facts do not give ("noise")', () => {
  for (const f of [
    { kind: 'crew', room: null, alertKind: null, minutes: 40, card: false },
    { kind: 'alert', room: 'Quarters 1', alertKind: 'Carbon dioxide', minutes: 40, card: true },
  ] as ReplyFacts[]) {
    const v = checkEarthReply(LIVE_FAILURE, f, { rooms: MARS_ROOMS, names: ['Leo'] });
    assert.equal(v.ok, false);
  }
  const v = checkEarthReply(LIVE_FAILURE.replace('noise in Galley', 'carbon dioxide in Quarters 1').replace('a crewmate has sent a message, and ', ''),
    { kind: 'alert', room: 'Quarters 1', alertKind: 'Carbon dioxide', minutes: 40, card: true }, { rooms: MARS_ROOMS, names: ['Leo'] });
  assert.equal(v.ok, true, 'the same reply with this alert\'s own facts passes');
});

test('a plain crew message never calls the model and gets the fixed crew reply: no alert, no room, no card', async () => {
  const m = crewMessage('leo', 'Test from the hub: checking the link to Earth.', 0, DELAY);
  const r = rig([m], { facts: () => ({ room: null, alertKind: null, card: false }) });
  r.at(m.replyAt);
  r.replies.step();
  await r.settle();
  assert.equal(r.calls(), 0);
  const out = r.replies.apply([m])[0];
  assert.equal(out.simulated, 'ai');
  assert.equal(out.reply?.key, CREW_REPLY_KEY);
  assert.equal(out.reply?.text, 'Mission control here. We have your message. We will write again in about 40 minutes.');
  assert.match(t(CREW_REPLY_KEY, 'pt', { min: 40 }), /^Aqui é o controle da missão\. Recebemos a sua mensagem\. Escreveremos de novo em cerca de 40 minutos\.$/);
});

test('an alert with no steps card: no card in the prompt, a card sentence is rejected, and the fallback leaves it out', async () => {
  const f: ReplyFacts = { ...facts, card: false };
  assert.doesNotMatch(buildEarthReplyMessages(f).map((x) => x.content).join(' '), /steps card/);
  assert.equal(checkEarthReply(GOOD, f, ctx).ok, false);
  assert.equal(checkEarthReply('Mission control here: we have your message about the carbon dioxide alert in Quarters 2. We are watching the readings with you and will write again in about 40 minutes.', f, ctx).ok, true);
  const m = alertMessage(0);
  const r = rig([m], { facts: () => ({ room: 'Quarters 2', alertKind: 'Carbon dioxide', card: false }) });
  r.at(m.replyAt);
  r.replies.step();
  await r.settle();
  assert.equal(r.calls(), 1, 'one try only');
  const out = r.replies.apply([m])[0];
  assert.equal(out.reply?.key, AI_FALLBACK_NO_CARD_KEY);
  assert.doesNotMatch(out.reply!.text, /card/);
});
