// Contact Earth: a crewmate's own message, its delay, the demo's simulated
// reply (never in production), and the stored row that brings it back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from './db.ts';
import { Hub } from './server.ts';
import { EarthMail, earthRoute } from './earth.ts';
import { AlertWatcher } from './alerts.ts';
import { RoomAlarms } from './alarms.ts';
import { CREW_KEEP_MS, EARTH_SIGNAL, crewMessagesFromRows, messageProblem, stepCrewMessages } from '../engine/earth.ts';
import { t } from '../engine/strings.ts';
import type { EarthMessage } from '../engine/alerts.ts';
import type { HubMessage, Profile } from '../engine/types.ts';

const profile = JSON.parse(readFileSync(new URL('../profiles/mars-orbit.json', import.meta.url), 'utf8')) as Profile;
const crew = profile.crew.map((p) => p.id);
const REPLY = t('earth.simReply', 'en');
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A hub with the alert watcher and the mail wired as main.ts wires them. */
async function station(delayMs: number, production: boolean, store = new Store(':memory:')) {
  const hub = new Hub(store, profile, '/nonexistent', production);
  const alarms = new RoomAlarms(hub, store, profile.rooms.map((r) => r.id));
  const alerts = new AlertWatcher(hub, store, profile, alarms);
  const mail = new EarthMail({ store, delayMs, simulatedReply: production ? null : REPLY });
  mail.load();
  alerts.crewMessages = (now) => mail.list(now);
  mail.onChange = () => alerts.publishEarth(Date.now());
  hub.routes.push(earthRoute({ mail, crew, delaySeconds: delayMs / 1000, messages: () => alerts.allEarth(Date.now()) }));
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  const close = () => { mail.stop(); hub.http.closeAllConnections(); hub.http.close(); };
  return { hub, store, alerts, mail, port, close };
}

const post = (port: number, body: unknown) => fetch(`http://127.0.0.1:${port}/api/earth/messages`, { method: 'POST', body: JSON.stringify(body) });

test('a crewmate\'s message: sent, delayed by the place\'s delay, listed with the others, stored as one reported row', async () => {
  const s = await station(1200_000, false);
  try {
    const before = Date.now();
    const res = await post(s.port, { from: 'reyes', text: '  Headache again this morning.  ' });
    assert.equal(res.status, 200);
    const { message } = (await res.json()) as { message: EarthMessage };
    assert.equal(message.kind, 'crew');
    assert.equal(message.from, 'reyes');
    assert.equal(message.text, 'Headache again this morning.');
    assert.ok(message.sentAt >= before);
    assert.equal(message.arrivesAt, message.sentAt + 1200_000);
    assert.equal(message.replyAt, message.sentAt + 2400_000);
    assert.equal(message.delivered, false);
    assert.equal(message.reply, null);
    assert.deepEqual(message.about, { person: 'reyes', room: null, signal: EARTH_SIGNAL, level: null, stationWide: false });

    const earth = (await (await fetch(`http://127.0.0.1:${s.port}/api/earth`)).json()) as { delaySeconds: number; messages: EarthMessage[] };
    assert.equal(earth.delaySeconds, 1200);
    assert.deepEqual(earth.messages.map((m) => m.id), [message.id]);
    const state = s.hub.state() as Extract<HubMessage, { type: 'state' }>;
    assert.deepEqual(state.earthMessages?.map((m) => m.id), [message.id], 'screens get it in the same list as alert messages');

    const rows = s.store.rows({ signal: EARTH_SIGNAL });
    assert.equal(rows.length, 1);
    assert.deepEqual({ ...rows[0], id: undefined }, { id: undefined, t: message.sentAt, signal: 'earth.message', value: null, text: 'Headache again this morning.', unit: '', kind: 'reported', source: 'earth:reyes', person: 'reyes', room: null });
  } finally {
    s.close();
    s.store.close();
  }
});

test('bad messages are refused in plain words', async () => {
  const s = await station(1000, false);
  try {
    for (const body of [{ from: 'nobody', text: 'hi' }, { from: 'reyes', text: '   ' }, { from: 'reyes' }, { from: 'reyes', text: 'x'.repeat(2001) }, null]) {
      const res = await post(s.port, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok(((await res.json()) as { error: string }).error.length > 0);
    }
    assert.equal(messageProblem({ from: 'reyes', text: 'x'.repeat(2000) }, crew), null, '2000 characters is allowed');
    assert.equal(s.store.rows({ signal: EARTH_SIGNAL }).length, 0, 'nothing stored');
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/api/earth`, { method: 'DELETE' })).status, 405);
  } finally {
    s.close();
    s.store.close();
  }
});

test('demo mode: the fixed simulated reply arrives when the reply time passes, and screens hear it', async () => {
  const s = await station(40, false);
  try {
    const heard: HubMessage[] = [];
    s.hub.onBroadcast = (m) => void heard.push(m);
    const { message } = (await (await post(s.port, { from: 'okafor', text: 'Status report.' })).json()) as { message: EarthMessage };
    assert.equal(s.mail.pendingReplies(), 1);
    await wait(200);
    const [now] = s.mail.list();
    assert.deepEqual(now.reply, { text: REPLY, at: message.replyAt, simulated: true, key: 'earth.simReply' });
    assert.equal(now.delivered, true);
    assert.equal(s.mail.pendingReplies(), 0);
    const last = heard.filter((m) => m.type === 'earth').at(-1);
    assert.ok(last?.type === 'earth' && last.earthMessages[0].reply?.simulated === true, 'broadcast with the reply');
    assert.match(REPLY, /Simulated reply/);
    assert.match(t('earth.simReply', 'pt'), /Resposta simulada/);
  } finally {
    s.close();
    s.store.close();
  }
});

test('production: no reply is ever made, and nothing is scheduled to make one', async () => {
  const s = await station(10, true);
  try {
    const res = await post(s.port, { from: 'okafor', text: 'Status report.' });
    assert.equal(res.status, 200);
    assert.equal(s.mail.pendingReplies(), 0, 'no timer at all');
    await wait(100);
    const [m] = s.mail.list();
    assert.equal(m.reply, null);
    assert.equal(m.delivered, true, 'it still reaches Earth');
    assert.equal(s.store.rows({ signal: EARTH_SIGNAL }).length, 1, 'a person\'s own message is kept in production');
  } finally {
    s.close();
    s.store.close();
  }
});

test('messages survive a restart from their stored rows, and drop after 24 hours', async () => {
  const store = new Store(':memory:');
  const first = await station(1200_000, false, store);
  const { message } = (await (await post(first.port, { from: 'leo', text: 'Sample results attached.' })).json()) as { message: EarthMessage };
  first.close();
  const second = await station(1200_000, false, store);
  try {
    const listed = second.mail.list();
    assert.deepEqual(listed.map((m) => [m.id, m.text, m.sentAt, m.replyAt]), [[message.id, 'Sample results attached.', message.sentAt, message.replyAt]]);
    assert.equal(second.mail.pendingReplies(), 1, 'its reply is scheduled again in demo mode');
    assert.deepEqual(stepCrewMessages(listed, message.sentAt + CREW_KEEP_MS), [], 'gone after 24 hours');
    // Only the hub's own rows count: a device posting earth.message under another source is not a message.
    const forged = { t: message.sentAt, signal: EARTH_SIGNAL, value: null, text: 'x', unit: '', kind: 'reported' as const, source: 'phone:leo', person: 'leo', room: null };
    assert.equal(crewMessagesFromRows([forged], 1000, message.sentAt).length, 0);
  } finally {
    second.close();
    store.close();
  }
});
