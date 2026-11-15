import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from './db.ts';
import { Hub } from './server.ts';
import { SimulatedCrew } from './crew.ts';
import { NasaReplay } from './nasa.ts';
import { RoomAlarms } from './alarms.ts';
import { Baselines } from './baseline.ts';
import { CabinCo2, EvidenceCards, RESEND_MS, cardFingerprint, evidenceNow, evidenceRoute } from './evidence.ts';
import { windowAverage } from '../engine/cabin.ts';
import type { HubMessage, Profile, Row } from '../engine/types.ts';

const profile = JSON.parse(readFileSync(new URL('../profiles/mars-orbit.json', import.meta.url), 'utf8')) as Profile;
const ids = profile.crew.map((p) => p.id);
const rooms = profile.rooms.map((r) => r.id);
const NOW = Date.UTC(2026, 10, 15, 3, 30);

/** A hub with three days of crew and replayed cabin air, as the live hub has after startup. */
function station() {
  const store = new Store(':memory:');
  const hub = new Hub(store, profile, '/nonexistent');
  new SimulatedCrew(hub, store, ids, -180).catchUp(NOW);
  const nasa = new NasaReplay(hub, store, new URL('../data-nasa/osdr-rr1', import.meta.url).pathname, rooms);
  nasa.catchUp(NOW);
  const alarms = new RoomAlarms(hub, store, rooms);
  alarms.check(NOW);
  const deps = { store, profile, baselines: new Baselines(store, ids, -180), alarms, offsetMinutes: -180 };
  return { store, hub, nasa, deps };
}

test('cabin CO2 read a few minutes at a time gives the same card as reading the whole window', () => {
  const { store, hub, nasa, deps } = station();
  const cabin = new CabinCo2(store);
  evidenceNow('reyes', deps, NOW, cabin);
  for (let t = NOW + 4000; t <= NOW + 20 * 60_000; t += 4000) hub.ingest(nasa.at(t));
  const later = NOW + 20 * 60_000;
  const shared = evidenceNow('reyes', deps, later, cabin);
  const whole = evidenceNow('reyes', deps, later);
  assert.equal(JSON.stringify(shared), JSON.stringify(whole));
  store.close();
  hub.http.close();
});

test('cards are kept ready: the route answers from memory, the hub pushes changes and sends every card first', async (t) => {
  const { store, hub, deps } = station();
  const cards = new EvidenceCards(deps);
  let clock = NOW;
  cards.clock = () => clock;
  const pushed: string[] = [];
  cards.onChange = (person, card) => { pushed.push(person); hub.setEvidence(person, card); };
  hub.routes.push(evidenceRoute(profile, cards));
  await new Promise<void>((done) => hub.http.listen(0, '127.0.0.1', done));
  const { port } = hub.http.address() as { port: number };
  t.after(() => { cards.stop(); hub.http.closeAllConnections(); hub.http.close(); store.close(); });

  // Nothing yet: the first request works it out.
  const first = (await (await fetch(`http://127.0.0.1:${port}/api/evidence?person=reyes`)).json()) as { person: string; computedAt: number };
  assert.equal(first.person, 'reyes');
  assert.equal(first.computedAt, NOW);
  clock = NOW + 5000;
  const again = (await (await fetch(`http://127.0.0.1:${port}/api/evidence?person=reyes`)).json()) as { computedAt: number };
  assert.equal(again.computedAt, NOW, 'the second request is answered from memory');

  // One person per tick, in turn.
  for (let i = 0; i < ids.length; i++) cards.tick(NOW + 10_000);
  assert.deepEqual(pushed, ['reyes', ...ids.filter((p) => p !== 'reyes'), 'reyes'].slice(0, pushed.length));
  assert.deepEqual(Object.keys(cards.all()).sort(), [...ids].sort());

  // A tick that changes nothing in substance sends nothing; after RESEND_MS it is sent again.
  const before = pushed.length;
  cards.refresh('leo', NOW + 40_000);
  assert.equal(pushed.length, before, 'same card, nothing sent');
  cards.refresh('leo', NOW + 10_000 + RESEND_MS);
  assert.equal(pushed.length, before + 1, 'sent again after a while, so durations never fall far behind');

  // A new screen gets every card in its first message, then each change as it happens.
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const next = () => new Promise<HubMessage>((done) => socket.addEventListener('message', (e) => done(JSON.parse(String(e.data))), { once: true }));
  const state = await next();
  assert.equal(state.type, 'state');
  assert.deepEqual(Object.keys((state as Extract<HubMessage, { type: 'state' }>).evidence ?? {}).sort(), [...ids].sort());
  const heard: HubMessage[] = [];
  socket.addEventListener('message', (e) => heard.push(JSON.parse(String(e.data))));
  // Long enough after her last card that it is sent again, changed or not.
  clock = NOW + RESEND_MS;
  cards.refreshSoon('reyes');
  for (let i = 0; i < 100 && !heard.some((m) => m.type === 'evidence'); i++) await new Promise((done) => setTimeout(done, 20));
  socket.close();
  const evidence = heard.find((m) => m.type === 'evidence') as Extract<HubMessage, { type: 'evidence' }>;
  assert.ok(evidence, `heard ${heard.map((m) => m.type).join(', ')}`);
  assert.equal(evidence.person, 'reyes');
  assert.equal(evidence.evidence.computedAt, clock, 'worked out off the request path, just now');
});

test('a card is "the same" when it only aged; a new verdict or room is a change', () => {
  const { store, hub, deps } = station();
  const a = evidenceNow('reyes', deps, NOW);
  const b = evidenceNow('reyes', deps, NOW + 20_000);
  assert.equal(cardFingerprint(a), cardFingerprint(b));
  assert.notEqual(cardFingerprint(a), cardFingerprint({ ...a, pointsTo: a.pointsTo === 'room' ? 'person' : 'room' }));
  assert.notEqual(cardFingerprint(a), cardFingerprint({ ...a, focusRoom: 'lab' === a.focusRoom ? 'gym' : 'lab' }));
  store.close();
  hub.http.close();
});

test('stopping the cards clears the timer and anything waiting', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { store, hub, deps } = station();
  const cards = new EvidenceCards(deps);
  cards.clock = () => NOW;
  let made = 0;
  cards.onChange = () => made++;
  cards.start();
  t.mock.timers.tick(30_000);
  assert.equal(made, ids.length, 'every crewmate within one round');
  cards.refreshSoon('reyes');
  cards.stop();
  t.mock.timers.tick(60_000);
  assert.equal(made, ids.length, 'nothing after stop');
  store.close();
  hub.http.close();
});

test('the 1-hour average counts the reading in force when the window opens', () => {
  const co2 = (t: number, value: number): Row => ({ t, signal: 'co2', value, unit: 'mmHg', kind: 'replayed', source: 's', room: 'lab' });
  const now = 10 * 3600_000;
  // 3.0 from 50 minutes before the window, then 2.0 from 30 minutes into it.
  const rows = [co2(now - 3600_000 - 5 * 60_000, 3), co2(now - 30 * 60_000, 2)];
  // The opening reading holds for its 10 minutes (5 of them inside the window): 5 min of 3, 30 min of 2.
  assert.equal(windowAverage(rows, 'lab', 'co2', now, 3600_000), null, '35 minutes covered is not enough');
  // A reading every minute: 3.0 until half an hour ago, 2.0 since. The first one inside the window is 20 seconds in.
  const from = now - 3600_000;
  const minutely = Array.from({ length: 61 }, (_, i) => from - 40_000 + i * 60_000).map((t) => co2(t, t < now - 30 * 60_000 ? 3 : 2));
  const average = windowAverage(minutely, 'lab', 'co2', now, 3600_000)!;
  const threes = minutely.filter((r) => r.value === 3 && r.t >= from).length;
  assert.equal(threes, 30);
  // Without the opening reading the window would start 20 seconds in and lean towards 2.
  assert.ok(Math.abs(average.value - (3 * (20_000 + 30 * 60_000 - 20_000 + 20_000) + 2 * (30 * 60_000 - 20_000)) / 3600_000) < 1e-12, String(average.value));
});

test('the highest 1-hour average is on the card, and Reyes\'s answer says it stayed under NASA\'s limit', async () => {
  const { composeAnswer, renderItems, maxHourAverage } = await import('../engine/answer.ts');
  const { checkAnswer } = await import('../engine/prompt.ts');
  const { store, hub, deps } = station();
  const card = evidenceNow('reyes', deps, NOW);
  const long = card.whereBeen.windows.find((w) => w.ms === 72 * 3600_000)!;
  const reyes = long.people.find((p) => p.person === 'reyes')!;
  // NASA's record in Quarters 2 over these three days: the 1-hour average peaks at 2.93 (core/nasa.ts).
  assert.equal(reyes.maxHourAverage, 2.93);
  assert.ok(long.people.every((p) => p.maxHourAverage !== null && p.maxHourAverage < 3));
  const lines = renderItems(composeAnswer({ name: 'Reyes', question: 'Why do I keep waking up with a headache?', readings: null, evidence: card, passages: [], lang: 'en' }).items, 'en', { name: 'Reyes', pronouns: 'she', self: true });
  // Since 15 Nov the single readings above 3 mmHg and the 1-hour average share one sentence (engine/answer.ts 'answer.exposure.aboveHourUnder').
  assert.ok(lines.includes("In the same 72 hours you spent 0.3 hours with single CO2 readings above 3 mmHg, but the 1-hour average, which is what NASA's limit of 3 mmHg applies to, stayed under it; the highest was 2.9 mmHg. (CO2 replayed; location simulated)"), lines.join('\n'));
  // The output check: time "above the limit" is wrong when no hour was over it, which is what ai.ts passes from this field.
  const hourOverLimit = maxHourAverage(reyes)! > 3;
  assert.equal(hourOverLimit, false);
  const facts = 'Single CO2 readings above 3 mmHg: 0.3 h in total.';
  assert.equal(checkAnswer({ answer: 'You spent 0.3 h above the 3 mmHg limit in your quarters.', passageNames: [], facts, message: facts, hourOverLimit }).discarded, true);
  store.close();
  hub.http.close();
});

test('the many-moment 1-hour average gives windowAverage\'s answer at every moment', async () => {
  const { windowAverages } = await import('../engine/cabin.ts');
  // Two sources of different kinds, with gaps and a source that goes quiet, a reading every 1 to 7 minutes.
  let x = 7;
  const random = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const rows: Row[] = [];
  for (const [source, kind] of [['a', 'replayed'], ['b', 'measured']] as const) {
    for (let t = 0; t < 10 * 3600_000; t += (1 + Math.floor(random() * 7)) * 60_000) {
      if (source === 'b' && t > 4 * 3600_000 && t < 6 * 3600_000) continue;
      rows.push({ t, signal: 'co2', value: 2 + random(), unit: 'mmHg', kind, source, room: 'lab' });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  const times = Array.from({ length: 600 }, (_, i) => i * 60_000);
  const many = windowAverages(rows, 'lab', 'co2', times, 3600_000);
  times.forEach((t, i) => {
    const one = windowAverage(rows, 'lab', 'co2', t, 3600_000);
    assert.equal(many[i] === null, one === null, `at ${t / 60_000} min`);
    if (one && many[i]) {
      assert.equal(many[i]!.source, one.source);
      assert.equal(many[i]!.kind, one.kind);
      assert.ok(Math.abs(many[i]!.value - one.value) < 1e-9, `at ${t / 60_000} min: ${many[i]!.value} vs ${one.value}`);
    }
  });
});
