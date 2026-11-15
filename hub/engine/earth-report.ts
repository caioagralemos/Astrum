// The incident report a level 3 alert files with its message to Earth: a plain
// JSON export of what the hub already knows at that moment, every value with
// its kind label. Pure; core/earth-report.ts gathers the inputs and keeps the
// reports. Nothing here is invented: a field the hub does not know is null or
// left out, and the steps' own text is never in it (card id and title only).
//
// Privacy (engine/privacy.ts): the Earth message every screen already gets
// carries the alert's person, signal, room and level, never a crewmate's typed
// words. The report never adds typed words (rows keep no text). For a
// privacy-restricted alert (a private card: mood, psychosis, gynecologic, or a
// crisis) the report keeps to that message's facts: who, the level, the times.
// No readings, no body readings and no card, and `restricted` says so.

import type { Alert, EarthMessage } from './alerts.ts';
import type { RoomAlarm } from './cabin.ts';
import type { Kind, Row, SourceStatus } from './types.ts';

export interface ReportReading {
  signal: string;
  name: string;
  value: number | null;
  unit: string;
  kind: Kind;
  limit: number | null;
  limitSource: string | null;
  /** How far over the limit (the alert's own figure), or null when not over or not known. */
  over: number | null;
  at: number;
  /** No reading from it for longer than the hub's quiet time (cabin.ts QUIET_MS). */
  stale: boolean;
}

export interface IncidentReport {
  report: 1;
  mission: string;
  missionDay: number | null;
  filedAt: number;
  lightDelaySeconds: number;
  drill: boolean;
  /** A privacy-restricted alert: the report keeps to the facts its Earth message already carries. */
  restricted: boolean;
  /** One line, built from the fields below. */
  summary: string;
  alert: { id: string; name: string; level: number; reason: 'did not answer' | 'asked for help' | 'several rooms' | 'declared' | 'room limit' | 'unusual reading' | 'finding'; since: number; levelSince: number; stationWide: boolean };
  where: { room: string | null; roomName: string | null };
  who: { person: string; name: string | null };
  readings: ReportReading[];
  bodyReadings: ReportReading[];
  timeline: { at: number; event: string }[];
  card: { id: string; title: string; approvedBy: string; unverified: string[] } | null;
  crewTold: string[];
  sources: { id: string; connected: boolean; lastSeen: number | null }[];
}

export interface ReportInput {
  alert: Alert;
  message: EarthMessage;
  now: number;
  mission: { name: string; day: number | null; lightDelaySeconds: number };
  roomName: (id: string) => string | null;
  personName: (id: string) => string | null;
  signalName: (signal: string) => string;
  /** The room's rows of the last while (any order). */
  roomRows: Row[];
  /** The person's body rows of the last while (any order). */
  bodyRows: Row[];
  alarms: RoomAlarm[];
  card: (id: string) => { id: string; title: string; approvedBy: string; unverified: string[] } | null;
  sources: SourceStatus[];
  quietMs: number;
}

/** How far past the limit, by the reading and the limit themselves (2 decimals, rounded up), or null when not past it. */
export function overBy(value: number | null, limit: number | null, direction: 'high' | 'low' | null): number | null {
  if (value === null || limit === null) return null;
  const d = direction === 'low' ? limit - value : value - limit;
  return d > 0 ? Math.ceil(d * 100 - 1e-9) / 100 : null;
}

/** Why it reached level 3, in a few plain words, or null for a plain limit or finding. */
export function reasonPhrase(reason: IncidentReport['alert']['reason']): string | null {
  return reason === 'asked for help' ? 'help requested' : reason === 'did not answer' ? 'no answer' : reason === 'several rooms' ? 'several rooms' : reason === 'declared' ? 'declared' : null;
}

function reasonOf(a: Alert): IncidentReport['alert']['reason'] {
  if (a.declared) return 'declared';
  if (a.answer === 'help' || a.signal === 'asked-help') return 'asked for help';
  if (a.stationWide) return 'several rooms';
  if (a.askedAt !== null && a.answer === null && a.answerBy !== null && a.levelSince >= a.answerBy) return 'did not answer';
  return a.reason === 'room-limit' ? 'room limit' : a.reason === 'unusual' ? 'unusual reading' : 'finding';
}

/** The newest numeric row per signal, without any typed words. */
function latest(rows: Row[], input: ReportInput): ReportReading[] {
  const by = new Map<string, Row>();
  for (const r of rows) if (r.value !== null && !r.text && (!by.has(r.signal) || by.get(r.signal)!.t < r.t)) by.set(r.signal, r);
  return [...by.values()].sort((a, b) => a.signal.localeCompare(b.signal)).map((r) => {
    const alarm = input.alarms.find((x) => x.room === r.room && x.signal === r.signal);
    return {
      signal: r.signal, name: input.signalName(r.signal), value: r.value, unit: r.unit, kind: r.kind,
      limit: alarm?.limit ?? null, limitSource: alarm?.limitSource ?? null, over: overBy(r.value, alarm?.limit ?? null, alarm?.direction === 'below' ? 'low' : 'high'), at: r.t, stale: input.now - r.t > input.quietMs,
    };
  });
}

export function buildReport(input: ReportInput): IncidentReport {
  const a = input.alert;
  const restricted = Boolean(a.private);
  const name = input.signalName(a.signal);
  const roomName = a.room ? input.roomName(a.room) : null;
  let readings: ReportReading[] = [];
  let bodyReadings: ReportReading[] = [];
  if (!restricted) {
    // The triggering reading is the alert's own (a drill's simulated value stays the drill's), never a newer stored row.
    const own: ReportReading | null = a.value === null ? null : {
      signal: a.signal, name, value: a.value, unit: a.unit ?? '', kind: a.kind, limit: a.limit, limitSource: a.limitSource,
      over: overBy(a.value, a.limit, a.direction), at: a.levelSince, stale: false,
    };
    const fresh = latest(input.roomRows.filter((r) => !a.room || r.room === a.room), input).filter((r) => r.signal !== a.signal);
    readings = [...(own ? [own] : []), ...fresh];
    bodyReadings = latest(input.bodyRows.filter((r) => r.person === a.person), input);
  }
  const timeline: { at: number; event: string }[] = [];
  timeline.push({ at: a.since, event: a.reason === 'room-limit' ? `${name} crossed the limit` : `alert raised: ${name}` });
  if (a.askedAt !== null) timeline.push({ at: a.askedAt, event: 'question asked: "Are you OK?"' });
  if (a.answer === 'help') timeline.push({ at: a.levelSince, event: 'help requested' });
  else if (a.answer === 'ok') timeline.push({ at: a.levelSince, event: 'answered OK' });
  else if (a.answerBy !== null && a.askedAt !== null && a.levelSince >= a.answerBy) timeline.push({ at: a.answerBy, event: 'no answer' });
  timeline.push({ at: a.levelSince, event: 'level 3' });
  if (a.seenAt) timeline.push({ at: a.seenAt, event: `seen by ${a.seenBy ? input.personName(a.seenBy) ?? a.seenBy : 'a shared screen'}` });
  if (a.settledAt) timeline.push({ at: a.settledAt, event: 'marked settled' });
  timeline.push({ at: input.message.sentAt, event: 'message sent to Earth' });
  timeline.sort((x, y) => x.at - y.at);
  const crewTold = a.toldTo === 'everyone' ? ['everyone'] : a.toldTo.map((id) => input.personName(id) ?? id);
  const card = !restricted && a.card ? input.card(a.card) : null;
  const reason = reasonOf(a);
  const why = reasonPhrase(reason);
  const summary = `Incident report: ${name}${roomName ? ` in ${roomName}` : ''}, level ${a.level}${why ? `, ${why}` : ''}, crew told.`;
  return {
    report: 1, mission: input.mission.name, missionDay: input.mission.day, filedAt: input.now, lightDelaySeconds: input.mission.lightDelaySeconds,
    drill: Boolean(a.drill || input.message.drill), restricted, summary,
    alert: { id: a.id, name, level: a.level, reason, since: a.since, levelSince: a.levelSince, stationWide: a.stationWide },
    where: { room: a.room, roomName },
    who: { person: a.person, name: input.personName(a.person) },
    readings, bodyReadings, timeline, card, crewTold,
    sources: input.sources.map((s) => ({ id: s.id, connected: s.connected, lastSeen: s.lastSeen })),
  };
}

/** The compact, hub-written digest of a report the model may write a reply from. Names, room and signal are the report's own. */
export function reportDigest(r: IncidentReport): string {
  const key = r.timeline.filter((e) => /help requested|no answer|level 3/.test(e.event)).map((e) => (e.event === 'level 3' ? 'top level reached' : e.event)).join(', ');
  return [
    `alert: ${r.alert.name}`,
    r.where.roomName ? `room: ${r.where.roomName}` : null,
    `why it reached the top level: ${r.alert.reason}`,
    key ? `key moments: ${key}` : null,
    `steps card on screen: ${r.card ? 'yes' : 'no'}`,
  ].filter(Boolean).join('. ');
}
