// The incident report a level 3 alert files with its message to Earth: the
// hub's own facts with their kinds, a timeline in order, privacy kept, the
// reply written from it, and the report kept across a restart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReport, reportDigest } from '../engine/earth-report.ts';
import type { ReportInput } from '../engine/earth-report.ts';
import { buildEarthReplyMessages, checkEarthReply, fallbackReply } from '../engine/earth-reply.ts';
import type { ReplyFacts } from '../engine/earth-reply.ts';
import { EarthReports } from './earth-report.ts';
import { EarthReplies } from './earth-reply.ts';
import type { Alert, EarthMessage } from '../engine/alerts.ts';
import type { RoomAlarm } from '../engine/cabin.ts';
import { t } from '../engine/strings.ts';

const T0 = 1_000_000_000_000;
const MIN = 60_000;

function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 'a1', person: 'reyes', level: 3, reason: 'room-limit', room: 'q2', signal: 'co2', value: 6.1, over: 0.1, unit: 'mmHg',
    limit: 6, limitSource: 'NASA SMAC', direction: 'high', kind: 'measured', since: T0, levelSince: T0 + 2 * MIN,
    askedAt: T0 + 10_000, answerBy: T0 + 70_000, answer: null, held: false, toldTo: 'everyone', card: 'high-co2',
    stationWide: false, lowestRoom: null, earth: { sentAt: T0 + 2 * MIN, arrivesAt: T0 + 22 * MIN, replyAt: T0 + 42 * MIN }, earthId: 'earth|a1',
    ...over,
  };
}

function message(a: Alert): EarthMessage {
  return { id: a.earthId!, kind: 'alert', about: { person: a.person, room: a.room, signal: a.signal, level: 3, stationWide: false }, ...a.earth!, delivered: false, reply: null, resolvedAt: null };
}

function input(a: Alert): ReportInput {
  const alarm = { room: 'q2', signal: 'co2', value: 6.1, over: 0.1, limit: 6, limitSource: 'NASA SMAC' } as unknown as RoomAlarm;
  return {
    alert: a, message: message(a), now: T0 + 2 * MIN,
    mission: { name: 'ship-mars-orbit', day: 12, lightDelaySeconds: 1200 },
    roomName: (id) => ({ q2: 'Quarters 2' } as Record<string, string>)[id] ?? null,
    personName: (id) => ({ reyes: 'Ana Reyes' } as Record<string, string>)[id] ?? null,
    signalName: (s) => t(`signal.${s}`, 'en'),
    roomRows: [
      { t: T0 + MIN, signal: 'co2', value: 6.2, unit: 'mmHg', kind: 'measured', source: 'chip:q2', person: null, room: 'q2' },
      { t: T0 + MIN, signal: 'temperature', value: 22.5, unit: '°C', kind: 'simulated', source: 'standin', person: null, room: 'q2' },
    ],
    bodyRows: [
      { t: T0 + MIN, signal: 'heart_rate', value: 92, unit: 'bpm', kind: 'measured', source: 'phone:reyes', person: 'reyes', room: null },
      { t: T0 + MIN, signal: 'checkin.mood', value: 2, text: 'my own words', unit: '', kind: 'reported', source: 'phone:reyes', person: 'reyes', room: null },
    ],
    alarms: [alarm],
    card: (id) => ({ id, title: 'High CO2', approvedBy: 'medical_lead', unverified: [] }),
    sources: [{ id: 'chip:q2', connected: true, room: 'q2', live: ['co2'], missing: [], lastSeen: T0 + MIN }],
    quietMs: 10 * MIN,
  };
}

test('a room-limit level 3: the reading with its kind and limit, the room\'s other readings, and a timeline in order', () => {
  const r = buildReport(input(alert()));
  assert.equal(r.report, 1);
  assert.equal(r.alert.reason, 'did not answer');
  assert.deepEqual(r.where, { room: 'q2', roomName: 'Quarters 2' });
  const co2 = r.readings[0];
  assert.equal(co2.signal, 'co2');
  assert.equal(co2.kind, 'measured');
  assert.equal(co2.limit, 6);
  assert.equal(co2.limitSource, 'NASA SMAC');
  assert.equal(r.readings.find((x) => x.signal === 'temperature')?.kind, 'simulated');
  assert.deepEqual(r.bodyReadings.map((x) => x.signal), ['heart_rate'], 'typed words never in it');
  assert.ok(!JSON.stringify(r).includes('my own words'));
  const times = r.timeline.map((e) => e.at);
  assert.deepEqual(times, [...times].sort((x, y) => x - y));
  assert.deepEqual(r.timeline.map((e) => e.event).slice(0, 4), [`${t('signal.co2', 'en')} crossed the limit`, 'question asked: "Are you OK?"', 'no answer', 'level 3']);
  assert.deepEqual(r.card, { id: 'high-co2', title: 'High CO2', approvedBy: 'medical_lead', unverified: [] });
  assert.deepEqual(r.crewTold, ['everyone']);
  assert.equal(r.summary, "Incident report: CO2 in Quarters 2, level 3, no answer, crew told.");
});

test('a privacy-restricted alert: no readings, no body readings, no card; only what its Earth message already says', () => {
  const r = buildReport(input(alert({ private: { card: null, medicalOfficerSeesCard: false }, signal: 'needs-someone', card: null, value: null, room: null })));
  assert.equal(r.restricted, true);
  assert.deepEqual(r.readings, []);
  assert.deepEqual(r.bodyReadings, []);
  assert.equal(r.card, null);
  assert.ok(!JSON.stringify(r).includes('heart_rate'));
});

test('the reply from a report names only the report\'s room and signal; the fallback says the report was received', async () => {
  const r = buildReport(input(alert()));
  const facts: ReplyFacts = { kind: 'alert', room: r.where.roomName, alertKind: r.alert.name, card: true, digest: reportDigest(r), report: true, minutes: 40 };
  const ctx = { rooms: ['Quarters 1', 'Quarters 2', 'Lab'], names: ['Ana Reyes', 'Reyes'] };
  const good = `Mission control here: we have your incident report on the ${r.alert.name.toLowerCase()} alert in Quarters 2. Keep following the steps card on your screen. We are watching the readings with you and will write again in about 40 minutes.`;
  assert.deepEqual(checkEarthReply(good, facts, ctx), { ok: true, text: good });
  assert.equal(checkEarthReply(good.replace('Quarters 2', 'Lab'), facts, ctx).ok, false);
  assert.equal(checkEarthReply(good.replace(r.alert.name.toLowerCase(), 'noise'), facts, ctx).ok, false);
  const f = fallbackReply(facts);
  assert.equal(t(f.key, 'en', f.vars), `Mission control here. We have your incident report for ${r.alert.name} in Quarters 2. Keep following the steps card on your screen. We will write again in about 40 minutes.`);
  assert.doesNotMatch(t(fallbackReply({ ...facts, card: false }).key, 'en', f.vars), /card/);
  // The model is handed the report's digest.
  let prompt = '';
  const m = { ...message(alert()), report: r };
  const replies = new EarthReplies({
    messages: () => [m], publish: () => {}, storyPlaying: () => false, restricted: () => false,
    facts: () => facts, delayMs: 20 * MIN, demoSeconds: null, rooms: ctx.rooms, names: ctx.names,
    model: { ready: () => true, chat: async (msgs) => { prompt = msgs.map((x) => x.content).join('\n'); return good; } },
    clock: () => m.replyAt, log: () => {},
  });
  replies.step();
  await new Promise((done) => setTimeout(done, 5));
  assert.match(prompt, /acknowledge the incident report about CO2 in Quarters 2/);
  assert.doesNotMatch(prompt, /Ana Reyes|Reyes/);
  assert.equal(replies.apply([m])[0].reply?.text, good);
});

test('a report is filed once and kept across a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'astrum-report-'));
  try {
    const file = join(dir, 'hub.db.earth-reports.json');
    const a = alert();
    let built = 0;
    const first = new EarthReports({ file, build: (al, m, now) => { built++; return buildReport({ ...input(al), message: m, now }); } });
    const listed = first.attach([message(a)], [a], T0 + 2 * MIN);
    first.attach([message(a)], [a], T0 + 3 * MIN);
    assert.equal(built, 1);
    const filedAt = listed[0].report!.filedAt;
    // After a restart the alert may be gone; the report stays on its message.
    const again = new EarthReports({ file, build: () => { throw new Error('must not build again'); } });
    const back = again.attach([message(a)], [], T0 + 5 * MIN);
    assert.equal(back[0].report?.filedAt, filedAt);
    assert.equal(again.get(a.earthId!)?.alert.id, 'a1');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- the live drill's defects (Mars base, reyes, Commons, "I need help") ----------

import { loadMission } from './missions.ts';
import { hubProfileOf } from '../engine/mission.ts';
import { cloudReplyModel } from './earth-cloud.ts';
import type { ReplyModel } from './earth-reply.ts';

const base = hubProfileOf(loadMission(new URL('../profiles/missions', import.meta.url).pathname, 'base-mars'), 'base-mars');
const baseRooms = base.rooms.map((r) => t(r.name, 'en'));
const commons = base.rooms.find((r) => r.id === 'commons')!;

function drillInput(): ReportInput {
  const a = alert({ room: 'commons', value: 4, unit: 'mmHg', kind: 'simulated', limit: 3, over: 1, answer: 'help', drill: true, card: 'high-co2' });
  const i = input(a);
  return {
    ...i,
    roomName: (id) => { const r = base.rooms.find((x) => x.id === id); return r ? t(r.name, 'en') : null; },
    // The room's stored replayed row is lower than the drill's value: the report must not take it for the trigger.
    roomRows: [{ t: T0 + MIN, signal: 'co2', value: 2.32, unit: 'mmHg', kind: 'replayed', source: 'nasa:osdr-rr1', person: null, room: 'commons' },
      { t: T0 + MIN, signal: 'temperature', value: 22, unit: '°C', kind: 'simulated', source: 'standin', person: null, room: 'commons' }],
  };
}

test('Mars base: the report names the room as screens do, the trigger is the drill\'s own 4 mmHg, and the message line is the summary', () => {
  const r = buildReport(drillInput());
  assert.equal(r.where.roomName, t(commons.name, 'en'));
  assert.doesNotMatch(JSON.stringify(r), /room\.commons/);
  assert.deepEqual({ value: r.readings[0].value, kind: r.readings[0].kind, limit: r.readings[0].limit, over: r.readings[0].over }, { value: 4, kind: 'simulated', limit: 3, over: 1 });
  assert.equal(r.readings.filter((x) => x.signal === 'co2').length, 1);
  assert.equal(r.summary, `Incident report: CO2 in ${t(commons.name, 'en')}, level 3, help requested, crew told.`);
  const store = new EarthReports({ file: null, build: () => r });
  const a = drillInput().alert;
  assert.equal(store.attach([message(a)], [a], T0)[0].text, r.summary);
});

const LIVE_PARROT = 'Mission control has the message about the alert, using only the alert and room words from the facts: CO2, room.commons, asked for help, top level, key moments include help requested and top level reached. Keep following the steps card on your screen. Earth is watching the readings and will write again in 40 minutes.';

function baseFacts(): ReplyFacts {
  const r = buildReport(drillInput());
  return { kind: 'alert', room: r.where.roomName, alertKind: r.alert.name, card: true, report: true, minutes: 40, place: 'a Mars base', reason: 'help requested', reading: { value: 4, unit: 'mmHg', kind: 'simulated', limit: 3 } };
}
const baseCtx = { rooms: baseRooms, names: base.crew.map((p) => p.name) };
const GOOD_BASE = () => `Mission control here: we have your incident report on the CO2 alert in ${t(commons.name, 'en')}. Keep following the steps card on your screen. We are watching the readings with you and will write again in about 40 minutes.`;

test('the parroted live reply is rejected; a natural reply with the report\'s room and alert once each passes', () => {
  const v = checkEarthReply(LIVE_PARROT, baseFacts(), baseCtx);
  assert.equal(v.ok, false);
  assert.ok(!v.ok && v.reasons.some((x) => /prompt|key or field|colon/.test(x)));
  assert.equal(checkEarthReply(GOOD_BASE(), baseFacts(), baseCtx).ok, true);
  assert.equal(checkEarthReply(GOOD_BASE().replace('readings with you', `readings with you in ${t(commons.name, 'en')}`), baseFacts(), baseCtx).ok, false, 'room twice');
  const brief = buildEarthReplyMessages(baseFacts()).map((x) => x.content).join('\n');
  assert.doesNotMatch(brief, /Reyes|room\.|my own words/);
  assert.match(brief, /4 mmHg \(simulated, limit 3 mmHg\)/);
});

function chain(over: { cloud?: ReplyModel | null; onboardText?: string; restricted?: boolean }) {
  let onboard = 0;
  const m = { ...message(alert({ room: 'commons' })) };
  const replies = new EarthReplies({
    messages: () => [m], publish: () => {}, storyPlaying: () => false, restricted: () => over.restricted === true,
    facts: () => baseFacts(), delayMs: 20 * MIN, demoSeconds: null, rooms: baseCtx.rooms, names: baseCtx.names,
    cloud: over.cloud ?? null,
    model: { ready: () => true, chat: async () => { onboard++; return over.onboardText ?? 'Not a reply.'; } },
    clock: () => m.replyAt, log: () => {},
  });
  return { replies, m, onboard: () => onboard };
}
const settle = () => new Promise((done) => setTimeout(done, 20));
function stubFetch(answer: () => Promise<Response>): { fetcher: typeof fetch; calls: () => number; body: () => string } {
  let calls = 0; let body = '';
  const fetcher = (async (_url: unknown, init?: RequestInit) => { calls++; body = String(init?.body ?? ''); return answer(); }) as typeof fetch;
  return { fetcher, calls: () => calls, body: () => body };
}
const okResponse = (text: string) => async () => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

test('cloud writer: success is used and marked "cloud"; the brief sent has no name and no typed words', async () => {
  const stub = stubFetch(okResponse(GOOD_BASE()));
  const c = chain({ cloud: cloudReplyModel({ key: 'test-key', fetcher: stub.fetcher }) });
  c.replies.step(); await settle();
  const out = c.replies.apply([c.m])[0];
  assert.equal(stub.calls(), 1);
  assert.equal(c.onboard(), 0);
  assert.equal(out.simulatedBy, 'cloud');
  assert.equal(out.reply?.text, GOOD_BASE());
  const sent = JSON.parse(stub.body()) as { model: string; temperature: number; max_completion_tokens: number };
  assert.equal(sent.model, 'qwen/qwen3.8-27b');
  assert.equal(sent.temperature, 0.3);
  assert.equal(sent.max_completion_tokens, 200);
  assert.doesNotMatch(stub.body(), /Reyes|test-key/);
});

test('cloud writer: a reply that fails a check falls to the on-board model, then to the fixed sentence marked "fixed"', async () => {
  const stub = stubFetch(okResponse(LIVE_PARROT));
  const c = chain({ cloud: cloudReplyModel({ key: 'k', fetcher: stub.fetcher }), onboardText: GOOD_BASE() });
  c.replies.step(); await settle();
  assert.equal(c.replies.apply([c.m])[0].simulatedBy, 'onboard');
  const d = chain({ cloud: cloudReplyModel({ key: 'k', fetcher: stubFetch(okResponse(LIVE_PARROT)).fetcher }) });
  d.replies.step(); await settle();
  const out = d.replies.apply([d.m])[0];
  assert.equal(out.simulatedBy, 'fixed');
  assert.match(out.reply!.text, /^Mission control here\. We have your incident report for CO2 in /);
});

test('cloud writer: a timeout falls back', async () => {
  const stub = stubFetch(() => new Promise<Response>(() => {}));
  const c = chain({ cloud: cloudReplyModel({ key: 'k', fetcher: (async (u: unknown, init?: RequestInit) => {
    stub.fetcher(u as string, init);
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('timeout'))));
  }) as typeof fetch, timeoutMs: 30 }), onboardText: GOOD_BASE() });
  c.replies.step(); await new Promise((done) => setTimeout(done, 120));
  assert.equal(stub.calls(), 1);
  assert.equal(c.replies.apply([c.m])[0].simulatedBy, 'onboard');
});

test('a restricted alert: no call to the cloud or the on-board model', async () => {
  const stub = stubFetch(okResponse(GOOD_BASE()));
  const c = chain({ cloud: cloudReplyModel({ key: 'k', fetcher: stub.fetcher }), restricted: true });
  c.replies.step(); await settle();
  assert.equal(stub.calls(), 0);
  assert.equal(c.onboard(), 0);
  assert.equal(c.replies.apply([c.m])[0].simulatedBy, 'fixed');
});
