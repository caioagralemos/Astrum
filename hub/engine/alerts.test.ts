import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASKED_HELP, COUNTDOWN_MS, EARTH_KEEP_MS, RESCUER_COUNTDOWN_MS, URGENT_CARD_ID, answerAlert, askedHelpFinding, boardSounds, isSettled, seeAlert, settleAlert, stepAlerts, stepEarth, visibleTo } from './alerts.ts';
import type { Alert, AlertInputs, EarthMessage } from './alerts.ts';
import type { RoomAlarm } from './cabin.ts';
import { overBy } from './cabin.ts';

const crew = [
  { id: 'reyes', name: 'Reyes', role: 'role.engineer' },
  { id: 'okafor', name: 'Okafor', role: 'role.cmo' },
  { id: 'leo', name: 'Leo', role: 'role.scientist' },
];
const alarm: RoomAlarm = { room: 'quarters-2', signal: 'co2', value: 3.4, unit: 'mmHg', limit: 3, limitSource: 'NASA', kind: 'replayed', source: 'nasa', since: 0, acknowledged: false };
const at = (now: number, over: Partial<AlertInputs> = {}): AlertInputs => ({
  now, crew, delayToEarthMs: 1200_000, roomAlarms: [alarm], occupants: { 'quarters-2': ['reyes'], lab: ['leo', 'okafor'] }, unusual: [], asleep: [], ...over,
});

test('a room over the limit asks the person in it and tells the medical officer, not the crew', () => {
  const { alerts, events } = stepAlerts([], at(1000));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].level, 2);
  assert.deepEqual(alerts[0].toldTo, ['reyes', 'okafor']);
  assert.equal(alerts[0].answerBy, 1000 + COUNTDOWN_MS);
  assert.equal(alerts[0].card, null);
  assert.deepEqual(events.map((e) => e.type), ['raised']);
  assert.equal(visibleTo(alerts, 'leo').length, 0);
  assert.equal(visibleTo(alerts, 'common').length, 0);
  assert.equal(visibleTo(alerts, 'okafor').length, 1);
});

test('no answer before the countdown ends: everyone is told, the card is shown, Earth is messaged', () => {
  let alerts: Alert[] = stepAlerts([], at(1000)).alerts;
  alerts = stepAlerts(alerts, at(1000 + COUNTDOWN_MS - 1)).alerts;
  assert.equal(alerts[0].level, 2);
  const out = stepAlerts(alerts, at(1000 + COUNTDOWN_MS));
  assert.equal(out.alerts[0].level, 3);
  assert.equal(out.alerts[0].toldTo, 'everyone');
  assert.equal(out.alerts[0].card, 'high-co2');
  assert.deepEqual(out.alerts[0].earth, { sentAt: 61_000, arrivesAt: 1261_000, replyAt: 2461_000 });
  assert.deepEqual(out.events.map((e) => e.type), ['escalated']);
  assert.equal(visibleTo(out.alerts, 'common').length, 1);
  assert.equal(stepAlerts(out.alerts, at(200_000)).events.length, 0, 'it does not escalate twice');
});

test('"I am OK" stops the escalation; "help" escalates at once', () => {
  const raised = stepAlerts([], at(1000)).alerts;
  const ok = answerAlert(raised, raised[0].id, 'ok');
  assert.equal(ok.event?.type, 'answered');
  assert.equal(stepAlerts(ok.alerts, at(1000 + COUNTDOWN_MS * 5)).alerts[0].level, 2);
  const help = answerAlert(raised, raised[0].id, 'help');
  assert.equal(stepAlerts(help.alerts, at(2000)).alerts[0].level, 3);
  assert.equal(answerAlert(ok.alerts, raised[0].id, 'help').event, null, 'an answer is given once');
});

test('the alert ends when the person leaves or the room recovers', () => {
  const raised = stepAlerts([], at(1000)).alerts;
  const left = stepAlerts(raised, at(2000, { occupants: { lab: ['reyes', 'leo', 'okafor'] } }));
  assert.deepEqual(left.alerts, []);
  assert.deepEqual(left.events.map((e) => e.type), ['resolved']);
  assert.deepEqual(stepAlerts(raised, at(2000, { roomAlarms: [] })).alerts, []);
});

test('an unusual reading tells only the person, and waits while they sleep', () => {
  const unusual = [{ person: 'leo', signal: 'heart_rate', direction: 'high' as const, z: 4.2, kind: 'simulated' as const }, { person: 'leo', signal: 'hrv', direction: 'low' as const, z: -3.1, kind: 'simulated' as const }];
  const asleep = stepAlerts([], at(1000, { roomAlarms: [], unusual, asleep: ['leo'] }));
  assert.equal(asleep.alerts.length, 1, 'one alert per person, for the strongest signal');
  assert.equal(asleep.alerts[0].signal, 'heart_rate');
  assert.equal(asleep.alerts[0].held, true);
  assert.equal(asleep.events.length, 0);
  assert.equal(visibleTo(asleep.alerts, 'leo').length, 0);
  const awake = stepAlerts(asleep.alerts, at(9000, { roomAlarms: [], unusual }));
  assert.equal(awake.alerts[0].held, false);
  assert.deepEqual(awake.events.map((e) => e.type), ['raised']);
  assert.deepEqual(awake.alerts[0].toldTo, ['leo']);
  assert.equal(visibleTo(awake.alerts, 'okafor').length, 0, 'level 1 is private');
});

test('the same limit broken in two rooms is one station-wide event: level 3 at once, one message to Earth', () => {
  const second: RoomAlarm = { ...alarm, room: 'lab', value: 3.2 };
  const inputs = at(1000, { roomAlarms: [alarm, second], roomAverages: { co2: { 'quarters-2': 3.4, lab: 3.2, galley: 2.6, gym: 2.4 } } });
  const { alerts, events } = stepAlerts([], inputs);
  assert.equal(alerts.length, 3, 'everyone in an affected room');
  assert.ok(alerts.every((a) => a.level === 3 && a.stationWide && a.toldTo === 'everyone' && a.answerBy !== null));
  assert.ok(alerts.every((a) => a.card === 'high-co2'));
  assert.equal(new Set(alerts.map((a) => JSON.stringify(a.earth))).size, 1, 'one message to Earth, not three');
  assert.deepEqual(alerts[0].lowestRoom, { room: 'gym', value: 2.4 });
  assert.equal(events.filter((e) => e.type === 'escalated').length, 3);

  const later = stepAlerts(alerts, at(90_000, { roomAlarms: [alarm, second], roomAverages: { co2: { 'quarters-2': 3.4, lab: 3.2 } } }));
  assert.deepEqual(later.alerts[0].earth, alerts[0].earth, 'the message is not sent again');
  assert.equal(later.alerts[0].lowestRoom, null, 'no room under the limit is said plainly');
  assert.equal(later.events.length, 0);
});

test('a person already asked "Are you OK?" joins the station-wide event when a second room goes over', () => {
  const one = stepAlerts([], at(1000)).alerts;
  assert.equal(one[0].level, 2);
  const two = stepAlerts(one, at(5000, { roomAlarms: [alarm, { ...alarm, room: 'lab' }] }));
  assert.ok(two.alerts.every((a) => a.level === 3 && a.stationWide));
  const back = stepAlerts(two.alerts, at(9000));
  assert.equal(back.alerts.length, 1);
  assert.equal(back.alerts[0].stationWide, false, 'one room again: no longer station-wide, but it stays at level 3');
  assert.equal(back.alerts[0].level, 3);
});

test('at level 3 the alert says whether Earth can answer before the card\'s time runs out, and never invents that time', () => {
  // Delay 20 minutes each way: a reply can be back 40 minutes after level 3.
  const raised = stepAlerts([], at(1000)).alerts;
  const escalate = (actWithin?: Record<string, number>) => stepAlerts(raised, at(1000 + COUNTDOWN_MS, { actWithin })).alerts[0];
  const unknown = escalate();
  assert.equal(unknown.level, 3);
  assert.equal(unknown.actWithinSeconds, null);
  assert.equal(unknown.earthInTime, null, 'no time from the card: unknown, not a guess');
  const tooLate = escalate({ 'high-co2': 600 });
  assert.equal(tooLate.actWithinSeconds, 600);
  assert.equal(tooLate.earthInTime, false);
  assert.equal(escalate({ 'high-co2': 3 * 3600 }).earthInTime, true);
  assert.equal(escalate({ 'other-card': 60 }).earthInTime, null);
  // The card's time can arrive after the alert did.
  const later = stepAlerts([unknown], at(200_000, { actWithin: { 'high-co2': 600 } })).alerts[0];
  assert.equal(later.earthInTime, false);
  assert.equal(stepAlerts([], at(1000, { actWithin: { 'high-co2': 600 } })).alerts[0].earthInTime, undefined, 'only level 3 carries it');
});

/** Steps the alerts and the messages to Earth together, as the hub does. */
function run(alerts: Alert[], earth: EarthMessage[], inputs: AlertInputs) {
  const out = stepAlerts(alerts, inputs);
  return { ...out, earth: stepEarth(earth, out.alerts, out.events, inputs.now) };
}

test('the message to Earth outlives the alert: listed after it ends, with the reply pending, then dropped', () => {
  let s = run([], [], at(1000));
  assert.deepEqual(s.earth, []);
  s = run(s.alerts, s.earth, at(1000 + COUNTDOWN_MS));
  assert.equal(s.alerts[0].level, 3);
  assert.equal(s.earth.length, 1);
  const message = s.earth[0];
  assert.equal(s.alerts[0].earthId, message.id, 'the alert refers to its message');
  assert.deepEqual(message.about, { person: 'reyes', room: 'quarters-2', signal: 'co2', level: 3, stationWide: false });
  assert.deepEqual([message.sentAt, message.arrivesAt, message.replyAt, message.resolvedAt], [61_000, 1261_000, 2461_000, null]);

  // Reyes leaves: her alert ends long before Earth's reply can be back.
  s = run(s.alerts, s.earth, at(200_000, { occupants: { galley: ['reyes'] } }));
  assert.deepEqual(s.alerts, []);
  assert.equal(s.earth.length, 1, 'still listed');
  assert.equal(s.earth[0].resolvedAt, 200_000);
  assert.ok(s.earth[0].replyAt > 200_000, 'the reply is still on its way');

  const away = { occupants: { galley: ['reyes'] } };
  s = run(s.alerts, s.earth, at(message.replyAt + EARTH_KEEP_MS - 1, away));
  assert.equal(s.earth.length, 1, 'kept for a while after the reply can be back');
  assert.equal(s.earth[0].resolvedAt, 200_000, 'resolvedAt does not move');
  assert.deepEqual(run(s.alerts, s.earth, at(message.replyAt + EARTH_KEEP_MS, away)).earth, [], 'then dropped');
});

test('a message to Earth is never sent twice for the same alert, and stays while its alert lasts', () => {
  let s = run([], [], at(1000));
  s = run(s.alerts, s.earth, at(1000 + COUNTDOWN_MS));
  const id = s.earth[0].id;
  for (const now of [100_000, 3_000_000, 9_000_000]) s = run(s.alerts, s.earth, at(now));
  assert.deepEqual(s.earth.map((m) => [m.id, m.resolvedAt]), [[id, null]], 'one message, still open, long after the reply time');
});

test('a station-wide event sends one message to Earth, not one per person', () => {
  const second: RoomAlarm = { ...alarm, room: 'lab', value: 3.2 };
  const s = run([], [], at(1000, { roomAlarms: [alarm, second] }));
  assert.equal(s.alerts.length, 3);
  assert.equal(s.earth.length, 1);
  assert.ok(s.alerts.every((a) => a.earthId === s.earth[0].id));
  assert.equal(s.earth[0].about.stationWide, true);
  // One alert ends: the message is still about the others.
  const later = run(s.alerts, s.earth, at(5000, { roomAlarms: [alarm, second], occupants: { 'quarters-2': ['reyes'], galley: ['leo', 'okafor'] } }));
  assert.equal(later.earth[0].resolvedAt, null);
});

test('a level 3 already raised alone is the message a second room joins', () => {
  let s = run([], [], at(1000));
  s = run(s.alerts, s.earth, at(1000 + COUNTDOWN_MS));
  const wide = run(s.alerts, s.earth, at(70_000, { roomAlarms: [alarm, { ...alarm, room: 'lab' }] }));
  assert.equal(wide.earth.length, 1, 'no second message for the same event');
  assert.ok(wide.alerts.every((a) => a.earthId === s.earth[0].id));
});

test('someone who walks into a room with a level 3 for someone else is asked, with a longer countdown and their own words', () => {
  let alerts = stepAlerts([], at(1000)).alerts;
  alerts = stepAlerts(alerts, at(1000 + COUNTDOWN_MS)).alerts;
  assert.equal(alerts[0].askKey, 'alert.areYouOk');
  const inRoom = { occupants: { 'quarters-2': ['reyes', 'okafor'], lab: ['leo'] } };
  const entered = stepAlerts(alerts, at(100_000, inRoom));
  const helper = entered.alerts.find((a) => a.person === 'okafor')!;
  assert.equal(helper.level, 2);
  assert.equal(helper.answerBy, 100_000 + RESCUER_COUNTDOWN_MS);
  assert.equal(helper.askKey, 'alert.enteredOverLimit');
  // Her rule: the medical officer is the person, so the commander is told; this crew has none, so the rest of the crew.
  assert.deepEqual(helper.toldTo, ['okafor', 'reyes', 'leo']);
  const working = stepAlerts(entered.alerts, at(100_000 + COUNTDOWN_MS * 2, inRoom));
  assert.equal(working.alerts.find((a) => a.person === 'okafor')!.level, 2, 'not a second emergency while they work');
  assert.equal(stepAlerts(working.alerts, at(100_000 + RESCUER_COUNTDOWN_MS, inRoom)).alerts.find((a) => a.person === 'okafor')!.level, 3, 'no answer at all: the usual rule');
  // Walking into a room where the alert is only at level 2 is the usual question.
  const early = stepAlerts(stepAlerts([], at(1000)).alerts, at(2000, inRoom)).alerts.find((a) => a.person === 'okafor')!;
  assert.equal(early.answerBy, 2000 + COUNTDOWN_MS);
  assert.equal(early.askKey, 'alert.areYouOk');
});

test('"I\'ve seen it" records who and when on a level 3 and leaves the level alone', () => {
  const two = stepAlerts([], at(1000)).alerts;
  assert.equal(seeAlert(two, two[0].id, 'leo', 2000).seen, false, 'only a level 3');
  const three = stepAlerts(two, at(1000 + COUNTDOWN_MS)).alerts;
  const seen = seeAlert(three, three[0].id, 'leo', 70_000);
  assert.equal(seen.seen, true);
  assert.equal(seen.alerts[0].level, 3);
  assert.deepEqual([seen.alerts[0].seenBy, seen.alerts[0].seenAt], ['leo', 70_000]);
  assert.equal(seeAlert(seen.alerts, three[0].id, 'okafor', 80_000).seen, false, 'once');
  assert.equal(stepAlerts(seen.alerts, at(90_000)).alerts[0].seenBy, 'leo', 'kept from step to step');
});

test('the board\'s buzzer: its own room\'s alarm, or any level 3, each silenced on its own', () => {
  const galley: RoomAlarm = { ...alarm, room: 'galley' };
  const board = ['galley'];
  const three = stepAlerts(stepAlerts([], at(1000)).alerts, at(1000 + COUNTDOWN_MS)).alerts;
  const seen = seeAlert(three, three[0].id, 'leo', 70_000).alerts;
  const two = stepAlerts([], at(1000)).alerts;

  assert.equal(boardSounds(board, [], []), false, 'nothing: silent');
  assert.equal(boardSounds(board, [alarm], two), false, 'an alarm in another room, level 2: silent');
  assert.equal(boardSounds(board, [galley], []), true, 'its own room over the limit');
  assert.equal(boardSounds(board, [{ ...galley, acknowledged: true }], []), false, 'its own room, acknowledged');
  assert.equal(boardSounds(board, [alarm], three), true, 'a level 3 in a room with no board sounds the galley board');
  assert.equal(boardSounds(board, [alarm], seen), false, '"I\'ve seen it" silences it');
  assert.equal(boardSounds(board, [galley], seen), true, 'the alert is seen, the board\'s own room still sounds');
  assert.equal(boardSounds(board, [{ ...galley, acknowledged: true }], three), true, 'the room is acknowledged, the level 3 still sounds');
  assert.equal(boardSounds(board, [], [{ ...three[0], answer: 'ok' }]), false, 'answered "I am OK"');
  assert.equal(boardSounds(board, [], [{ ...three[0], answer: 'help' }]), true, '"help" is what raised it');
  assert.equal(boardSounds(board, [alarm], []), false, 'the alert ended');
  assert.equal(boardSounds([], [galley], three), false, 'no board, nothing to sound');
});

test('how far over the limit is rounded up, never to 0', () => {
  assert.equal(overBy(3.004, 3), 0.01);
  assert.equal(overBy(3.0000001, 3), 0.01);
  assert.equal(overBy(3.1, 3), 0.1);
  assert.equal(overBy(3.456, 3), 0.46);
  assert.equal(overBy(3.45, 3), 0.45);
});

test('a crew level broken in a room alerts like a NASA limit, worded as the crew\'s, with no card unless hers covers it', () => {
  const crewAlarm: RoomAlarm = { ...alarm, signal: 'radiation', value: 25, unit: 'uSv/h', limit: 20, limitSource: 'crew', kind: 'measured', source: 'sensor:rad-1', direction: 'above', textKey: 'alarm.crewLevel.above' };
  // Both a NASA alarm and a crew alarm in the same room: two alerts, never merged.
  let s = run([], [], at(1000, { roomAlarms: [alarm, crewAlarm] }));
  assert.deepEqual(s.alerts.map((a) => [a.signal, a.limitSource, a.level, a.textKey]), [['co2', 'NASA', 2, undefined], ['radiation', 'crew', 2, 'alert.crewLevel.above']]);
  assert.deepEqual(s.alerts[1].toldTo, ['reyes', 'okafor'], 'the same order of telling');
  s = run(s.alerts, s.earth, at(1000 + COUNTDOWN_MS, { roomAlarms: [alarm, crewAlarm] }));
  const [nasaAlert, crewAlert] = s.alerts;
  assert.equal(nasaAlert.card, 'high-co2');
  assert.equal(crewAlert.level, 3);
  assert.equal(crewAlert.card, null, 'no steps card of her own for this signal');
  assert.ok(crewAlert.earth, 'Earth is messaged at level 3');
  assert.equal(s.earth.length, 2, 'one message per alert, not one merged event');
  const withCard = run([], [], at(1000, { roomAlarms: [crewAlarm], cardFor: (signal) => (signal === 'radiation' ? 'her-radiation-card' : null) }));
  assert.equal(run(withCard.alerts, withCard.earth, at(1000 + COUNTDOWN_MS, { roomAlarms: [crewAlarm], cardFor: () => 'her-radiation-card' })).alerts[0].card, 'her-radiation-card');
  // Two rooms past the crew's level is the crew's station-wide event, counted apart from NASA's.
  const other: RoomAlarm = { ...crewAlarm, room: 'lab' };
  const wide = run([], [], at(1000, { roomAlarms: [alarm, crewAlarm, other] }));
  assert.deepEqual(wide.alerts.map((a) => [a.signal, a.room, a.level, a.stationWide]), [['co2', 'quarters-2', 2, false], ['radiation', 'quarters-2', 3, true], ['radiation', 'lab', 3, true], ['radiation', 'lab', 3, true]]);
  assert.equal(boardSounds(['quarters-2'], [crewAlarm], []), true, 'it sounds the board in its room under the same rule');
});

test('messages to Earth from alerts carry their kind and whether they have arrived', () => {
  let s = run([], [], at(1000));
  s = run(s.alerts, s.earth, at(1000 + COUNTDOWN_MS));
  assert.deepEqual([s.earth[0].kind, s.earth[0].delivered, s.earth[0].reply], ['alert', false, null]);
  s = run(s.alerts, s.earth, at(s.earth[0].arrivesAt));
  assert.equal(s.earth[0].delivered, true);
  assert.equal(s.earth[0].reply, null, 'an alert message never gets a reply from the hub');
});

test('"Call for help" in the chat: the same level 3 as "help", everyone told, her urgent card, one message to Earth', () => {
  const { alerts, events } = stepAlerts([], at(1000, { roomAlarms: [], findings: [askedHelpFinding('reyes')] }));
  assert.equal(alerts.length, 1);
  const a = alerts[0];
  assert.deepEqual([a.person, a.level, a.toldTo, a.signal, a.card, a.alsoCard, a.private], ['reyes', 3, 'everyone', ASKED_HELP, null, URGENT_CARD_ID, null]);
  assert.deepEqual(events.map((e) => e.type), ['raised']);
  assert.equal(stepEarth([], alerts, events, 1000).length, 1);
  assert.equal(visibleTo(alerts, 'common').length, 1);
});

test('"Emergency settled" records who and when on a level 3 only, keeps the alert, and is for this occurrence only', () => {
  const two = stepAlerts([], at(1000)).alerts;
  assert.equal(settleAlert(two, two[0].id, 'leo', 2000).settled, false, 'only a level 3');
  const three = stepAlerts(two, at(1000 + COUNTDOWN_MS)).alerts;
  const out = settleAlert(three, three[0].id, null, 70_000);
  assert.equal(out.settled, true);
  assert.deepEqual([out.alerts[0].settledBy, out.alerts[0].settledAt, out.alerts[0].level], [null, 70_000, 3], 'shared screen: no name; the level stays');
  assert.equal(isSettled(out.alerts[0]), true);
  assert.equal(settleAlert(out.alerts, three[0].id, 'leo', 80_000).settled, false, 'once');
  const later = stepAlerts(out.alerts, at(90_000)).alerts;
  assert.equal(later.length, 1, 'the alert stays listed');
  assert.equal(isSettled(later[0]), true, 'kept from step to step');
  assert.equal(boardSounds(['galley'], [], later), false, 'the buzzer stops as for "seen"');
  // The same alert reaching level 3 again (a new levelSince) is a new occurrence.
  assert.equal(isSettled({ ...later[0], levelSince: 100_000 }), false, 'a new occurrence is not settled');
  // It ends and comes back: a new alert, not settled.
  const ended = stepAlerts(later, { ...at(100_000), roomAlarms: [] }).alerts;
  assert.equal(ended.length, 0, 'ended');
  const back = stepAlerts(stepAlerts(ended, at(200_000)).alerts, at(200_000 + COUNTDOWN_MS)).alerts;
  assert.equal(back[0].level, 3);
  assert.equal(isSettled(back[0]), false, 'came back: not settled');
});
