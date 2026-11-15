import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAREER_LIMIT, doseFor, doseOfCrew, MIN_PROJECTION_BASIS_MS, plannedEndOf, rateSpans, rateUnit } from './dose.ts';
import { HOLD_MS } from './exposure.ts';
import type { Kind, Row, Stay } from './types.ts';

const MIN = 60_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** A rate row every `every` ms over [from, to). */
function rates(room: string, value: number, unit: string, from: number, to: number, kind: Kind = 'measured', source = 'sensor:rad-1', every = MIN): Row[] {
  const out: Row[] = [];
  for (let t = from; t < to; t += every) out.push({ t, signal: 'radiation', value, unit, kind, source, room });
  return out;
}

function stay(person: string, room: string, from: number, until: number | null, kind: Kind = 'measured'): Stay {
  return { person, room, from, until, kind, source: 'test' };
}

test('rate units: dose and time are read apart; anything else is not a dose rate', () => {
  assert.deepEqual(rateUnit('uGy/day'), { quantity: 'absorbed', dose: 'uGy', toBase: 1e-6, perMs: DAY });
  assert.deepEqual(rateUnit('mSv/day'), { quantity: 'equivalent', dose: 'mSv', toBase: 1e-3, perMs: DAY });
  assert.equal(rateUnit('uSv/h')!.perMs, HOUR);
  assert.equal(rateUnit('µSv/h')!.dose, 'uSv');
  assert.equal(rateUnit('cpm'), null);
  assert.equal(rateUnit('mSv'), null, 'a dose is not a rate');
});

test('rows become held spans: each holds until the next, at most 10 minutes, and equal neighbours join', () => {
  const rows = [...rates('lab', 1, 'mSv/day', 0, 5 * MIN), { t: 30 * MIN, signal: 'radiation', value: 2, unit: 'mSv/day', kind: 'measured' as Kind, source: 'sensor:rad-1', room: 'lab' }];
  const spans = rateSpans(rows);
  assert.equal(spans.length, 2);
  assert.deepEqual([spans[0].from, spans[0].until], [0, 4 * MIN + HOLD_MS]);
  assert.deepEqual([spans[1].from, spans[1].until], [30 * MIN, 30 * MIN + HOLD_MS]);
});

test('dose follows the person from room to room: rate times time, in the source unit', () => {
  const start = 0;
  const now = 2 * DAY;
  const spans = rateSpans([...rates('lab', 1.8, 'mSv/day', 0, now), ...rates('gym', 0.9, 'mSv/day', 0, now)]);
  const stays = [stay('ana', 'lab', 0, DAY), stay('ana', 'gym', DAY, null)];
  const d = doseFor('ana', { now, missionStart: start, plannedEnd: 10 * DAY, stays, spans })!;
  assert.equal(d.kind, 'estimated', 'a measured monitor\'s rate makes an estimate, never a measurement');
  assert.equal(d.amounts.length, 1);
  const a = d.amounts[0];
  assert.equal(a.unit, 'mSv');
  assert.ok(Math.abs(a.mission - 2.7) < 1e-9, `mission ${a.mission}`);
  assert.ok(Math.abs(a.today - 0.9) < 1e-9, 'today is the last 24 hours, in the gym');
  assert.ok(Math.abs(a.ratePerDay - 1.35) < 1e-9);
  assert.ok(Math.abs(a.projected! - (2.7 + 1.35 * 8)) < 1e-9, 'the rest of the mission at the average rate');
  assert.equal(d.mission.coveredMs, now);
  assert.equal(d.comparable, true);
  assert.equal(d.limit, CAREER_LIMIT);
  assert.ok(Math.abs(d.ofLimit!.mission - 2.7 / 600) < 1e-12);
});

test('gaps are unknown time, never filled: no stay, and a room with no rate', () => {
  const now = DAY;
  const spans = rateSpans(rates('lab', 2.4, 'mSv/day', 0, now));
  // Unplaced for the first 6 h, in the lab 6 h, then 12 h in a room with no rate.
  const stays = [stay('ana', 'lab', 6 * HOUR, 12 * HOUR), stay('ana', 'galley', 12 * HOUR, null)];
  const d = doseFor('ana', { now, missionStart: 0, plannedEnd: null, stays, spans })!;
  assert.ok(Math.abs(d.amounts[0].mission - 0.6) < 1e-9, 'only the 6 covered hours count');
  assert.equal(d.mission.unplacedMs, 6 * HOUR);
  assert.equal(d.mission.noRateMs, 12 * HOUR);
  assert.equal(d.mission.coveredMs, 6 * HOUR);
  assert.equal(d.amounts[0].projected, null, 'no planned end, no projection');
});

test('a monitor that goes quiet leaves a gap after 10 minutes', () => {
  const spans = rateSpans(rates('lab', 24, 'uSv/h', 0, HOUR, 'measured', 'sensor:rad-1', HOUR));
  const d = doseFor('ana', { now: HOUR, missionStart: 0, plannedEnd: null, stays: [stay('ana', 'lab', 0, null)], spans })!;
  assert.equal(d.mission.coveredMs, HOLD_MS);
  assert.equal(d.mission.noRateMs, HOUR - HOLD_MS);
  assert.equal(d.amounts[0].unit, 'uSv');
  assert.ok(Math.abs(d.amounts[0].mission - 4) < 1e-9, '24 uSv/h for 10 minutes');
});

test('absorbed dose stays in Gy and is never compared with the limit in mSv', () => {
  const now = DAY;
  const spans = rateSpans(rates('quarters', 300, 'uGy/day', 0, now, 'simulated', 'sim:hub'));
  const d = doseFor('ana', { now, missionStart: 0, plannedEnd: 2 * DAY, stays: [stay('ana', 'quarters', 0, null, 'simulated')], spans })!;
  assert.equal(d.kind, 'simulated');
  assert.equal(d.amounts[0].quantity, 'absorbed');
  assert.equal(d.amounts[0].unit, 'uGy');
  assert.ok(Math.abs(d.amounts[0].mission - 300) < 1e-9);
  assert.equal(d.comparable, false);
  assert.equal(d.reason, 'absorbed');
  assert.equal(d.limit, null);
  assert.equal(d.ofLimit, null);
});

test('absorbed and equivalent from different rooms are kept apart, and the whole is not comparable', () => {
  const now = 2 * DAY;
  const spans = rateSpans([...rates('a', 300, 'uGy/day', 0, now), ...rates('b', 1, 'mSv/day', 0, now)]);
  const d = doseFor('ana', { now, missionStart: 0, plannedEnd: null, stays: [stay('ana', 'a', 0, DAY), stay('ana', 'b', DAY, null)], spans })!;
  assert.deepEqual(d.amounts.map((a) => [a.quantity, a.unit]), [['equivalent', 'mSv'], ['absorbed', 'uGy']]);
  assert.equal(d.comparable, false);
  assert.equal(d.reason, 'mixed');
});

test('the kind follows the inputs: a simulated stay or a replayed rate makes the dose so', () => {
  const now = DAY;
  const measured = rateSpans(rates('lab', 1, 'mSv/day', 0, now));
  assert.equal(doseFor('ana', { now, missionStart: 0, plannedEnd: null, stays: [stay('ana', 'lab', 0, null, 'simulated')], spans: measured })!.kind, 'simulated');
  const replayed = rateSpans(rates('lab', 1, 'mSv/day', 0, now, 'replayed', 'nasa:x'));
  assert.equal(doseFor('ana', { now, missionStart: 0, plannedEnd: null, stays: [stay('ana', 'lab', 0, null)], spans: replayed })!.kind, 'replayed');
});

test('a real monitor wins over the stand-in in the same room', () => {
  const now = DAY;
  const spans = rateSpans([...rates('lab', 1, 'mSv/day', 0, now), ...rates('lab', 5, 'mSv/day', 0, now, 'simulated', 'sim:hub')]);
  const d = doseFor('ana', { now, missionStart: 0, plannedEnd: null, stays: [stay('ana', 'lab', 0, null)], spans })!;
  assert.equal(d.kind, 'estimated');
  assert.ok(Math.abs(d.amounts[0].mission - 1) < 1e-9);
});

test('no rate at all means no dose at all (production with no radiation source)', () => {
  const stays = [stay('ana', 'lab', 0, null)];
  assert.equal(doseFor('ana', { now: DAY, missionStart: 0, plannedEnd: null, stays, spans: [] }), null);
  assert.deepEqual(doseOfCrew(['ana', 'ben'], { now: DAY, missionStart: 0, plannedEnd: null, stays, spans: [] }), {});
});

test('a projection needs an hour of covered time; the planned end is start plus planned days', () => {
  const now = 30 * MIN;
  const spans = rateSpans(rates('lab', 1, 'mSv/day', 0, now));
  const d = doseFor('ana', { now, missionStart: 0, plannedEnd: DAY, stays: [stay('ana', 'lab', 0, null)], spans })!;
  assert.ok(d.amounts[0].coveredMs < MIN_PROJECTION_BASIS_MS);
  assert.equal(d.amounts[0].projected, null);
  assert.equal(plannedEndOf(1000, 2), 1000 + 2 * DAY);
  assert.equal(plannedEndOf(1000, undefined), null);
});

test('the limit is NASA\'s own sentence, career-wide, in mSv', () => {
  assert.equal(CAREER_LIMIT.value, 600);
  assert.equal(CAREER_LIMIT.unit, 'mSv');
  assert.match(CAREER_LIMIT.quote, /shall be less than 600 mSv\. This limit is universal for all ages and sexes\.$/);
  assert.match(CAREER_LIMIT.url, /^https:\/\/www\.nasa\.gov\//);
});

test('a mission start moved later leaves out what came before it; moved earlier, the extra time is unknown, never dose', () => {
  const now = 4 * DAY;
  const spans = rateSpans(rates('lab', 1, 'mSv/day', 0, now, 'measured', 'sensor:rad-1', 10 * MIN));
  const stays = [stay('ana', 'lab', 0, null)];
  const whole = doseFor('ana', { now, missionStart: 0, plannedEnd: null, stays, spans })!;
  const later = doseFor('ana', { now, missionStart: 2 * DAY, plannedEnd: null, stays, spans })!;
  assert.ok(Math.abs(whole.amounts[0].mission - 4) < 0.01);
  assert.ok(Math.abs(later.amounts[0].mission - 2) < 0.01, 'rows before the start are not counted');
  assert.equal(later.mission.from, 2 * DAY);
  // Started ten days before anything was stored: the dose is the same; the days before are unplaced, said as unknown.
  const earlier = doseFor('ana', { now, missionStart: -10 * DAY, plannedEnd: null, stays, spans })!;
  assert.ok(Math.abs(earlier.amounts[0].mission - 4) < 0.01);
  assert.equal(earlier.mission.unplacedMs, 10 * DAY);
  // A start after now is clamped to now: no mission time, so no dose.
  assert.equal(doseFor('ana', { now, missionStart: now + DAY, plannedEnd: null, stays, spans }), null);
});
