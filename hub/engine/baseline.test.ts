import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, Z_CAP, detectorLine, median, personSummary, plainSignalName, robust, roomOrPerson, signalBaseline, stateWithSleep, summaryReadings } from './baseline.ts';
import type { Judged, PersonSummary } from './baseline.ts';
import { USUAL, crewPeriod, crewStays } from './crew.ts';
import { occupants } from './timeline.ts';
import type { Row } from './types.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const start = Date.UTC(2026, 10, 1); // midnight, station time = UTC in these tests
const people = Object.keys(USUAL);
const withSleep = { stateOf: stateWithSleep(0) };

// Fifteen days of one person, heart rate every 5 minutes, ending at `now`.
const history = (person: string, now: number) => crewPeriod([person], now - 15 * DAY, now, 5 * MIN, 0).rows;
const raise = (rows: Row[], person: string, signal: string, from: number, to: number, by: number) =>
  rows.map((r) => (r.person === person && r.signal === signal && r.t > from && r.t <= to ? { ...r, value: r.value! + by } : r));
const judged = (x: ReturnType<typeof signalBaseline>): Judged => {
  assert.equal(x.status, 'judged', `expected a judgement, got ${x.status}`);
  return x as Judged;
};

test('median and scaled MAD', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  const r = robust([1, 2, 3, 4, 100]);
  assert.equal(r.usual, 3);
  assert.ok(Math.abs(r.spread - 1.4826) < 1e-9);
});

test('heart rate 15 above her usual at rest is flagged high; her normal exercise heart rate is not', () => {
  const now = start + 15 * DAY + 10 * HOUR; // 10:00, Reyes in the lab
  const rows = raise(history('reyes', now), 'reyes', 'heart_rate', now - HOUR, now, 15);
  const rest = judged(signalBaseline(rows, 'heart_rate', now, withSleep));
  assert.equal(rest.state, 'rest');
  assert.equal(rest.mode, 'dense');
  assert.ok(rest.unusual && rest.direction === 'high', `z ${rest.z}`);
  assert.ok(Math.abs(rest.recent - rest.usual - 15) <= 2);

  const inGym = start + 15 * DAY + 18 * HOUR; // 18:00, Reyes on the treadmill since 17:00
  const gym = judged(signalBaseline(history('reyes', inGym), 'heart_rate', inGym, withSleep));
  assert.equal(gym.state, 'exercise');
  assert.ok(gym.recent > USUAL.reyes.heartRate + 40, 'exercise heart rate is high in absolute terms');
  assert.equal(gym.unusual, false, `z ${gym.z}`);
  assert.equal(gym.direction, null);
});

test('the default state keeps the gym apart from everything else', () => {
  assert.equal(DEFAULTS.stateOf({ t: 0, signal: 'heart_rate', value: 1, unit: 'bpm', kind: 'simulated', source: 's', room: 'gym' }), 'exercise');
  assert.equal(DEFAULTS.stateOf({ t: 0, signal: 'heart_rate', value: 1, unit: 'bpm', kind: 'simulated', source: 's', room: 'lab' }), 'rest');
  const sleepState = stateWithSleep(0);
  const at = (h: number, room = 'quarters-2') => sleepState({ t: start + h * HOUR, signal: 'heart_rate', value: 1, unit: 'bpm', kind: 'simulated', source: 's', room });
  assert.deepEqual([at(23), at(3), at(6), at(10, 'lab'), at(17, 'gym')], ['sleep', 'sleep', 'rest', 'rest', 'exercise']);
  // Station time two hours ahead of UTC: 21:00 UTC is 23:00 on the station.
  assert.equal(stateWithSleep(120)({ t: start + 21 * HOUR, signal: 'x', value: 1, unit: '', kind: 'simulated', source: 's', room: 'lab' }), 'sleep');
});

test('normal days do not cry wolf on heart rate', () => {
  const end = start + 17 * DAY;
  const rows = crewPeriod(['okafor'], start, end, 5 * MIN, 0).rows;
  let flags = 0;
  let checks = 0;
  for (let now = start + 15 * DAY; now <= end; now += 2 * HOUR) {
    const r = signalBaseline(rows, 'heart_rate', now, withSleep);
    if (r.status === 'judged') { checks++; if (r.unusual) flags++; }
  }
  assert.ok(checks >= 20);
  assert.equal(flags, 0);
});

test('a single bad night does not shift the baseline', () => {
  const now = start + 15 * DAY + 7 * HOUR;
  const rows = history('reyes', now);
  const sleepRows = rows.filter((r) => r.signal === 'sleep_duration');
  const badNight = sleepRows[sleepRows.length - 5];
  const worse = rows.map((r) => (r === badNight ? { ...r, value: 60 } : r));
  const a = judged(signalBaseline(rows, 'sleep_duration', now));
  const b = judged(signalBaseline(worse, 'sleep_duration', now));
  assert.equal(a.mode, 'daily');
  assert.ok(Math.abs(a.usual - b.usual) <= 15, `usual moved from ${a.usual} to ${b.usual}`);
  assert.equal(b.unusual, false);

  // A night of heart rate 30 higher four nights ago leaves tonight's sleeping heart rate baseline almost where it was.
  const night = start + 11 * DAY;
  const hot = raise(rows, 'reyes', 'heart_rate', night - 2 * HOUR, night + 6 * HOUR, 30);
  const tonight = now - 4 * HOUR; // 03:00
  const c = judged(signalBaseline(rows, 'heart_rate', tonight, withSleep));
  const d = judged(signalBaseline(hot, 'heart_rate', tonight, withSleep));
  assert.equal(c.state, 'sleep');
  assert.ok(Math.abs(c.usual - d.usual) <= 1, `usual moved from ${c.usual} to ${d.usual}`);
  assert.equal(d.unusual, false);
});

test('not enough history is reported with how much there is, not a score', () => {
  const now = start + 2 * DAY + 7 * HOUR;
  const rows = crewPeriod(['leo'], start, now, 5 * MIN, 0).rows;
  const sleep = signalBaseline(rows, 'sleep_duration', now);
  assert.equal(sleep.status, 'not-enough-history');
  if (sleep.status === 'not-enough-history') {
    assert.equal(sleep.baselineCount, 2); // three nights so far: the latest plus two earlier
    assert.equal(sleep.needed, 3);
    assert.equal('z' in sleep, false);
  }

  const early = start + 1.5 * HOUR;
  const hr = signalBaseline(rows, 'heart_rate', early);
  assert.equal(hr.status, 'not-enough-history');
  if (hr.status === 'not-enough-history') assert.equal(hr.needed, 30);

  const summary = personSummary(rows, 'leo', early);
  assert.equal(summary.score, 0);
  assert.equal(detectorLine(summary), 'Detector: normal.');
});

test('a gap in a dense signal is not judged, and never flagged', () => {
  const now = start + 15 * DAY + 10 * HOUR;
  const rows = history('tanaka', now).filter((r) => !(r.signal === 'heart_rate' && r.t > now - 3 * HOUR));
  const r = signalBaseline(rows, 'heart_rate', now);
  assert.equal(r.status, 'no-recent');
  if (r.status === 'no-recent') assert.equal(r.lastSeen, now - 3 * HOUR);
  // A daily value older than a day and a half is stale.
  assert.equal(signalBaseline(rows, 'sleep_duration', now + 2 * DAY).status, 'no-recent');
});

test('a zero spread gives finite numbers', () => {
  const now = start + 15 * DAY + 20 * HOUR;
  const rows = history('reyes', now);
  const same = judged(signalBaseline(rows, 'exercise_minutes', now));
  assert.equal(same.spread, 0);
  assert.equal(same.z, 0);
  assert.equal(same.flat, true);
  assert.equal(same.unusual, false);

  const skipped = rows.map((r, i) => (r.signal === 'exercise_minutes' && i === rows.findLastIndex((x) => x.signal === 'exercise_minutes') ? { ...r, value: 0 } : r));
  const low = judged(signalBaseline(skipped, 'exercise_minutes', now));
  assert.ok(Number.isFinite(low.z) && Number.isFinite(low.spread));
  assert.equal(low.z, -Z_CAP);
  assert.equal(low.direction, 'low');

  // More than half identical, but not all: the MAD is 0 and the mean deviation takes over.
  const r = robust([5, 5, 5, 5, 5, 6, 4]);
  assert.equal(r.usual, 5);
  assert.ok(r.spread > 0 && Number.isFinite(r.spread));

  const summary = personSummary(skipped, 'reyes', now);
  assert.ok(Number.isFinite(summary.score) && summary.score <= 1);
});

test('the kind mix says what the baseline was built from', () => {
  const now = start + 15 * DAY + 10 * HOUR;
  const rows = history('reyes', now).map((r) => (r.signal === 'heart_rate' && r.t > now - HOUR ? { ...r, kind: 'measured' as const, source: 'watch:reyes' } : r));
  const r = judged(signalBaseline(rows, 'heart_rate', now, withSleep));
  assert.equal(r.kinds.measured, r.recentCount);
  assert.equal(r.kinds.simulated, r.baselineCount);
});

test('the summary sorts by |z|, scores from the largest, and the detector line has the expected shape', () => {
  const now = start + 15 * DAY + 10 * HOUR;
  let rows = raise(history('reyes', now), 'reyes', 'heart_rate', now - HOUR, now, 15);
  const lastSleep = rows.findLast((r) => r.signal === 'sleep_duration')!;
  rows = rows.map((r) => (r === lastSleep ? { ...r, value: 120 } : r));
  const s = personSummary(rows, 'reyes', now, withSleep);
  const zs = s.signals.filter((x) => x.status === 'judged').map((x) => Math.abs((x as Judged).z));
  assert.deepEqual(zs, [...zs].sort((a, b) => b - a));
  assert.equal(s.score, Number(Math.min(1, zs[0] / 6).toFixed(2)));
  assert.ok(s.top.includes('heart_rate') && s.top.includes('sleep_duration'));
  assert.match(detectorLine(s, { heart_rate: 'heart rate', sleep_duration: 'sleep' }), /^Detector: anomaly (0\.\d\d|1\.00)\. Main signals: (heart rate, sleep|sleep, heart rate)\.$/);

  const fake = (top: string[], score: number): PersonSummary => ({ person: 'x', now, signals: [], score, top });
  assert.equal(detectorLine(fake(['heart_rate', 'hrv', 'co2'], 0.91), { heart_rate: 'heart rate', hrv: 'HRV', co2: 'CO2' }), 'Detector: anomaly 0.91. Main signals: heart rate, HRV, CO2.');
  assert.equal(detectorLine(fake(['hrv'], 0.66), { hrv: 'HRV' }), 'Detector: anomaly 0.66. Main signal: HRV.');
  assert.equal(detectorLine(fake([], 0.2)), 'Detector: normal.');
});

test('a shared drift points to the room; a lone one points to the person', () => {
  const lunch = start + 15 * DAY + 12.75 * HOUR; // everyone in the galley
  const all = crewPeriod(people, lunch - 15 * DAY, lunch, 5 * MIN, 0).rows;
  const here = occupants(crewStays(people, lunch - HOUR, lunch, 0), lunch);
  assert.equal(here.galley?.length, 4);
  const summaries = (rows: Row[], at: number) => people.map((p) => personSummary(rows, p, at, withSleep));

  const both = raise(raise(all, 'reyes', 'heart_rate', lunch - HOUR, lunch, 15), 'leo', 'heart_rate', lunch - HOUR, lunch, 15);
  const shared = roomOrPerson(summaries(both, lunch), here).filter((x) => x.signal === 'heart_rate');
  assert.deepEqual(shared.map((x) => [x.person, x.pointsTo, x.room]).sort(), [['leo', 'room', 'galley'], ['reyes', 'room', 'galley']]);
  assert.deepEqual(shared.find((x) => x.person === 'reyes')!.same, ['leo']);

  const alone = raise(all, 'reyes', 'heart_rate', lunch - HOUR, lunch, 15);
  const lone = roomOrPerson(summaries(alone, lunch), here).filter((x) => x.signal === 'heart_rate');
  assert.equal(lone.length, 1);
  assert.equal(lone[0].pointsTo, 'person');
  assert.equal(lone[0].direction, 'high');
  assert.deepEqual(lone[0].judged.sort(), ['leo', 'okafor', 'tanaka']);
  assert.deepEqual(lone[0].same, []);

  // At night everyone is in their own quarters: nobody to compare with.
  const night = start + 15 * DAY + 3 * HOUR;
  const nightRows = raise(crewPeriod(people, night - 15 * DAY, night, 5 * MIN, 0).rows, 'okafor', 'heart_rate', night - HOUR, night, 15);
  const nightNow = occupants(crewStays(people, night - HOUR, night, 0), night);
  const solo = roomOrPerson(summaries(nightRows, night), nightNow).filter((x) => x.signal === 'heart_rate');
  assert.equal(solo.length, 1);
  assert.equal(solo[0].pointsTo, 'unknown');
  assert.equal(solo[0].room, 'quarters-3');
});

// A phone's sparse blood oxygen: one reading every few hours for two weeks, as an Apple Watch sends it.
const spo2 = (person: string, now: number, last: { ago: number; value: number }): Row[] => {
  const rows: Row[] = [];
  for (let t = now - 14 * DAY; t < now - last.ago - 4 * HOUR; t += 4 * HOUR) rows.push({ t, signal: 'blood_oxygen', value: 98, unit: '%', kind: 'measured', source: 'phone', person });
  rows.push({ t: now - last.ago, signal: 'blood_oxygen', value: last.value, unit: '%', kind: 'measured', source: 'phone', person });
  return rows;
};

test('a vital sign older than an hour is a gap, never "the latest": the live hub judged a blood oxygen 885 minutes old', () => {
  const now = start + 15 * DAY + 23 * HOUR;
  const stale = signalBaseline(spo2('reyes', now, { ago: 885 * MIN, value: 89 }), 'blood_oxygen', now);
  assert.equal(stale.status, 'no-recent');
  const summary = personSummary(spo2('reyes', now, { ago: 885 * MIN, value: 89 }), 'reyes', now);
  assert.deepEqual(summary.top, [], 'nothing unusual from an old reading');
  assert.equal(detectorLine(summary), 'Detector: normal.');
  // The same reading 30 minutes old is current, and judged on its own value.
  const fresh = judged(signalBaseline(spo2('reyes', now, { ago: 30 * MIN, value: 89 }), 'blood_oxygen', now));
  assert.equal(fresh.mode, 'daily');
  assert.equal(fresh.direction, 'low');
  assert.equal(DEFAULTS.liveFreshMs, HOUR);
  // A daily value, last night's sleep, is still judged 14 hours later: it is a daily value, not a vital sign.
  const sleepRows: Row[] = Array.from({ length: 10 }, (_, i) => ({ t: now - (14 + 24 * i) * HOUR, signal: 'sleep_duration', value: i === 0 ? 449 : 320 + (i % 3), unit: 'min', kind: 'simulated', source: 'sim', person: 'reyes' }));
  assert.equal(judged(signalBaseline(sleepRows, 'sleep_duration', now)).mode, 'daily');
});

test('the readings handed to Astra: only fresh ones, code names in words, a daily value named with its time', () => {
  const now = start + 15 * DAY + 23 * HOUR;
  const sleepRows: Row[] = Array.from({ length: 10 }, (_, i) => ({ t: now - (14 + 24 * i) * HOUR, signal: 'sleep_duration', value: i === 0 ? 449 : 320 + (i % 3), unit: 'min', kind: 'simulated', source: 'sim', person: 'reyes' }));
  const steps: Row[] = Array.from({ length: 10 }, (_, i) => ({ t: now - (10 + 24 * i) * HOUR, signal: 'steps', value: 3500 + i, unit: 'count', kind: 'measured', source: 'phone', person: 'reyes' }));
  const rows = [...spo2('reyes', now, { ago: 885 * MIN, value: 89 }), ...sleepRows, ...steps];
  const names: Record<string, string> = { sleep_duration: 'sleep last night', steps: 'signal.steps', blood_oxygen: 'signal.blood_oxygen' };
  const readings = summaryReadings(personSummary(rows, 'reyes', now), (s) => names[s] ?? s, (s) => rows.find((r) => r.signal === s)?.unit ?? '');
  assert.deepEqual(readings.map((r) => r.name).sort(), ['sleep last night', 'steps, latest daily value']);
  assert.equal(readings.some((r) => /blood|oxygen/.test(r.name)), false, 'the 885-minute-old blood oxygen is not handed on');
  assert.equal(plainSignalName('blood_oxygen', 'signal.blood_oxygen'), 'blood oxygen');
  assert.equal(plainSignalName('hrv', 'signal.hrv'), 'HRV');
  assert.equal(plainSignalName('heart_rate', 'Heart rate'), 'Heart rate');
});
