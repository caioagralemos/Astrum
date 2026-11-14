import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceFor } from './evidence.ts';
import type { EvidenceInputs } from './evidence.ts';
import { personSummary } from './baseline.ts';
import type { Judged, PersonSummary } from './baseline.ts';
import { USUAL, crewPeriod, crewStays } from './crew.ts';
import { occupants } from './timeline.ts';
import type { Row } from './types.ts';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const people = Object.keys(USUAL);
// Noon on the fourth day; station time is UTC in these tests.
const now = Date.UTC(2026, 10, 10) + 3 * DAY + 12 * HOUR;
const from = now - 3 * DAY;

/** Three days of cabin CO2 every 5 minutes. Quarters 2 sits near 2.9 mmHg at night, everything else lower. */
function cabin(): Row[] {
  const rows: Row[] = [];
  for (let t = from; t <= now; t += 5 * 60_000) {
    const hour = (t % DAY) / HOUR;
    for (const room of ['quarters-1', 'quarters-2', 'quarters-3', 'quarters-4', 'lab', 'galley', 'gym', 'command']) {
      const night = room === 'quarters-2' && (hour < 6 || hour >= 22);
      const value = Number(((night ? 2.9 : 2.2) + ((t / 300_000) % 3) / 100).toFixed(2));
      rows.push({ t, signal: 'co2', value, unit: 'mmHg', kind: 'replayed', source: 'nasa:osdr-rr1', room });
    }
  }
  return rows;
}

function reyesStory(): EvidenceInputs {
  const stays = crewStays(people, from, now, 0);
  const crewRows = crewPeriod(people, from, now, 300_000, 0).rows;
  const cabinRows = cabin();
  const latest = cabinRows.filter((r) => r.t === now);
  return {
    now, crew: people,
    summaries: people.map((p) => personSummary(crewRows, p, now)),
    occupantsNow: occupants(stays, now),
    stays, cabinRows,
    checkins: crewRows.filter((r) => r.signal.startsWith('checkin.')),
    latest, stuck: [], alarms: [],
  };
}

test('act 1: Reyes\'s nights in Quarters 2 stand out against her crewmates, and it points to the room', () => {
  const e = evidenceFor('reyes', reyesStory());
  assert.equal(e.pointsTo, 'room');
  assert.equal(e.focusRoom, 'quarters-2');
  const reason = e.reasons.find((r) => r.code === 'exposure-stands-out');
  assert.ok(reason && reason.code === 'exposure-stands-out');
  assert.equal(reason.level, 2.8);
  assert.equal(reason.crewmatesMaxMs, 0);
  assert.equal(reason.ms, 3 * 8 * HOUR, 'eight hours a night above 2.8 mmHg, three nights');
  assert.equal(reason.kind, 'replayed');

  // Where have they been: her numbers first, then each crewmate's, over 24 and 72 hours.
  assert.deepEqual(e.whereBeen.windows.map((w) => w.ms), [DAY, 3 * DAY]);
  const long = e.whereBeen.windows[1];
  assert.deepEqual(long.people.map((p) => p.person), ['reyes', 'leo', 'okafor', 'tanaka']);
  assert.deepEqual(e.whereBeen.onlyThem.map((r) => r.room), ['quarters-2'], 'only Reyes spends time in Quarters 2');
  const q2 = long.people[0].rooms.find((r) => r.room === 'quarters-2')!;
  assert.equal(q2.ms, 3 * 10 * HOUR);
  assert.equal(q2.stayKind, 'simulated');
  assert.equal(q2.kind, 'replayed');
  assert.ok(long.people[0].average! > long.people[1].average!, 'she breathed more CO2 than Leo');
  assert.ok(long.people.slice(1).every((p) => p.above.every((a) => a.ms === 0)));

  // What she reported: a headache, three mornings running, labelled simulated because nobody said it.
  assert.deepEqual(e.reported.runs, [{ signal: 'checkin.headache', count: 3, days: 3, lastAt: now - 6 * HOUR, kind: 'simulated' }]);
  assert.ok(e.reported.rows.every((r) => r.kind === 'simulated'));
});

test('the same story with an untrustworthy reading behind it points to the sensor', () => {
  const inputs = reyesStory();
  const nasa = inputs.latest.find((r) => r.room === 'quarters-2')!;
  // Another fresh source of the same kind that reads far apart.
  const contradicted = evidenceFor('reyes', { ...inputs, latest: [...inputs.latest, { ...nasa, source: 'nasa:other', value: 0.9 }] });
  assert.equal(contradicted.pointsTo, 'sensor');
  assert.ok(contradicted.reasons.some((r) => r.code === 'sensor' && r.problem.problem === 'contradicted'));
  assert.ok(contradicted.reasons.some((r) => r.code === 'exposure-stands-out'), 'the room reasons are still listed');

  const stuck = evidenceFor('reyes', { ...inputs, stuck: [{ room: 'quarters-2', signal: 'co2', source: nasa.source, kind: 'measured', value: 2.2, since: 0, lastAt: now, readings: 99 }] });
  assert.equal(stuck.pointsTo, 'sensor');
  const quiet = evidenceFor('reyes', { ...inputs, latest: inputs.latest.filter((r) => r.room !== 'quarters-2').concat({ ...nasa, t: now - HOUR }) });
  assert.equal(quiet.pointsTo, 'sensor');
});

/** A judged signal for a made-up summary. */
function judged(signal: string, unusual: boolean): Judged {
  return {
    status: 'judged', signal, mode: 'dense', state: 'rest', baselineCount: 400, kinds: { simulated: 412 },
    recent: unusual ? 84 : 63, usual: 63, spread: 3, z: unusual ? 7 : 0, unusual, direction: unusual ? 'high' : null, recentCount: 12, flat: false,
  };
}
const summary = (person: string, unusual: boolean): PersonSummary => ({ person, now, signals: [judged('heart_rate', unusual)], score: unusual ? 1 : 0, top: unusual ? ['heart_rate'] : [] });

test('Leo: unusual, crewmates in the same room judged and normal, no room stands out: it points to Leo', () => {
  const inputs: EvidenceInputs = {
    ...reyesStory(),
    summaries: [summary('leo', true), summary('reyes', false), summary('okafor', false), summary('tanaka', false)],
    occupantsNow: { lab: ['leo', 'reyes', 'okafor'], command: ['tanaka'] },
  };
  const e = evidenceFor('leo', inputs);
  assert.equal(e.pointsTo, 'person');
  assert.deepEqual(e.unusual.signals.map((s) => [s.signal, s.direction, s.z, s.kind, s.baselineCount]), [['heart_rate', 'high', 7, 'simulated', 400]]);
  assert.deepEqual(e.sameRoom.map((r) => [r.room, r.judged, r.same]), [['lab', ['reyes', 'okafor'], []]]);
  assert.ok(e.reasons.some((r) => r.code === 'crewmates-normal'));
  assert.deepEqual(e.reported.runs, []);
});

test('crewmates in the same room showing the same point to the room; nothing to go on is unknown', () => {
  const base = reyesStory();
  const shared = evidenceFor('leo', {
    ...base,
    summaries: [summary('leo', true), summary('okafor', true), summary('reyes', false), summary('tanaka', false)],
    occupantsNow: { lab: ['leo', 'okafor'], 'quarters-2': ['reyes'], command: ['tanaka'] },
  });
  assert.equal(shared.pointsTo, 'room');
  assert.equal(shared.focusRoom, 'lab');

  const calm = evidenceFor('tanaka', { ...base, summaries: people.map((p) => summary(p, false)) });
  assert.equal(calm.pointsTo, 'unknown');
  assert.deepEqual(calm.unusual.signals, []);
});
