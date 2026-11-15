// Runs the alert levels: looks at the station every two seconds, advances the
// alerts and the messages to Earth (engine/alerts.ts) and tells everyone
// connected what changed, including what each crewmate is doing (and so who is
// asleep: engine/activity.ts).

import { answerAlert, seeAlert, stepAlerts, stepEarth } from '../engine/alerts.ts';
import type { Alert, AlertEvent, EarthMessage, Finding, Unusual } from '../engine/alerts.ts';
import { occupants } from '../engine/timeline.ts';
import type { Profile } from '../engine/types.ts';
import { REAL_WITHIN_MS, decideActivity, settleActivity, sleepersOf } from '../engine/activity.ts';
import type { Activity, Decided } from '../engine/activity.ts';
import { stationHour } from '../engine/crew.ts';
import type { Places } from '../engine/crew.ts';
import type { RoomAlarms } from './alarms.ts';
import type { Store } from './db.ts';
import type { Hub } from './server.ts';

export class AlertWatcher {
  private alerts: Alert[] = [];
  private doing: Record<string, Activity> = {};
  private earth: EarthMessage[] = [];
  private timer: NodeJS.Timeout | null = null;
  /**
   * Set by whoever knows: what each crewmate is doing now (crewActivity below), and readings
   * unusual for a person. Who is asleep is only ever the sleepers of the activity.
   */
  activity: (now: number) => Record<string, Decided> = () => ({});
  unusual: (now: number) => Unusual[] = () => [];
  /** How soon each steps card says to act, in seconds, by card id. Empty until the medical lead's card file gives times. */
  actWithin: Record<string, number> = {};
  /** Called for every change, for anything that wants to react (logs, the scenario recorder). */
  onEvent: (event: AlertEvent) => void = () => {};
  /** For a level the crew set: her steps card for that signal, if she has one. */
  cardFor: (signal: string) => string | null = () => null;
  /** Messages crewmates wrote to Earth (core/earth.ts), listed with the alerts' own. */
  crewMessages: (now: number) => EarthMessage[] = () => [];
  /** What the medical lead's rules find now from the hub's records (engine/medical.ts): SpO2, blood, "did not get better". */
  findings: (now: number) => Finding[] = () => [];
  /** Findings raised by a question (a card her signs picked, a crisis), each kept until its time ends. */
  private raised = new Map<string, { finding: Finding; until: number }>();

  /** Keeps a finding for `keepMs` (the same person and key again restarts it), and looks at the station now. */
  raise(finding: Finding, keepMs: number, now = Date.now()): void {
    this.raised.set(`${finding.person}|${finding.key}`, { finding, until: now + keepMs });
    this.check(now);
  }

  private allFindings(now: number): Finding[] {
    for (const [key, r] of this.raised) if (now >= r.until) this.raised.delete(key);
    return [...this.findings(now), ...[...this.raised.values()].map((r) => r.finding)];
  }

  private hub: Hub;
  private store: Store;
  private profile: Profile;
  private roomAlarms: RoomAlarms;

  constructor(hub: Hub, store: Store, profile: Profile, roomAlarms: RoomAlarms) {
    this.hub = hub;
    this.store = store;
    this.profile = profile;
    this.roomAlarms = roomAlarms;
  }

  start(): void {
    this.timer = setInterval(() => this.check(Date.now()), 2000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  list(): Alert[] {
    return this.alerts;
  }

  /** Messages to Earth sent by alerts, still listed. */
  earthMessages(): EarthMessage[] {
    return this.earth;
  }

  /** Every message to Earth still listed, the alerts' and the crew's, oldest first. */
  allEarth(now: number): EarthMessage[] {
    const crew = this.crewMessages(now);
    return crew.length ? [...this.earth, ...crew].sort((a, b) => a.sentAt - b.sentAt) : this.earth;
  }

  /** Tells the screens the list now (a crewmate just wrote, or a reply came). */
  publishEarth(now: number): void {
    this.hub.setEarthMessages(this.allEarth(now));
  }

  check(now: number): void {
    this.doing = settleActivity(this.doing, this.activity(now), now);
    this.hub.setActivity(this.doing);
    const asleep = sleepersOf(this.doing);
    const out = stepAlerts(this.alerts, {
      now,
      crew: this.profile.crew,
      delayToEarthMs: this.profile.delayToEarthSeconds * 1000,
      roomAlarms: this.roomAlarms.list(),
      roomAverages: this.roomAlarms.averages,
      occupants: occupants(this.store.stays(now, now), now),
      unusual: this.unusual(now),
      asleep,
      actWithin: this.actWithin,
      cardFor: (signal) => this.cardFor(signal),
      findings: this.allFindings(now),
    });
    const changed = out.events.length > 0 || JSON.stringify(out.alerts) !== JSON.stringify(this.alerts);
    this.alerts = out.alerts;
    this.earth = stepEarth(this.earth, this.alerts, out.events, now);
    for (const event of out.events) this.onEvent(event);
    if (changed) this.hub.setAlerts(this.alerts);
    this.hub.setEarthMessages(this.allEarth(now));
  }

  /** "I've seen it" on a level 3 alert. Returns false if there was no such alert left to see. */
  see(id: string, by: string | null, now = Date.now()): boolean {
    const out = seeAlert(this.alerts, id, by, now);
    if (!out.seen) return false;
    this.alerts = out.alerts;
    this.hub.setAlerts(this.alerts);
    return true;
  }

  /** The person's answer to "Are you OK?". Returns false if there was nothing to answer. */
  answer(id: string, answer: 'ok' | 'help', now = Date.now()): boolean {
    const out = answerAlert(this.alerts, id, answer);
    if (!out.event) return false;
    this.alerts = out.alerts;
    this.onEvent(out.event);
    this.check(now);
    this.hub.setAlerts(this.alerts);
    return true;
  }
}

/** Measured exercise minutes this far back are enough to find today's rises. */
const EXERCISE_LOOKBACK_MS = 26 * 3600_000;

/**
 * Everyone's activity now, from the hub's own records (engine/activity.ts decides): where each
 * person is, whether their own devices are sending (a real person), their measured exercise
 * minutes, and, in demo mode, the simulated crew's day on a station clock `offsetMinutes` from UTC.
 */
export function crewActivity(store: Store, people: string[], now: number, simulated: { places: Record<string, Places>; offsetMinutes: number } | null): Record<string, Decided> {
  const here = occupants(store.stays(now, now), now);
  const roomOf = new Map<string, string>();
  for (const [room, ids] of Object.entries(here)) for (const id of ids) roomOf.set(id, room);
  return decideActivity(people, (person) => ({
    room: roomOf.get(person) ?? null,
    real: store.rows({ person, kind: 'measured', from: now - REAL_WITHIN_MS, to: now, limit: 1 }).length > 0,
    exercise: store.rows({ person, signal: 'exercise_minutes', kind: 'measured', from: now - EXERCISE_LOOKBACK_MS, to: now }),
  }), now, simulated ? { hour: stationHour(now, simulated.offsetMinutes), places: simulated.places } : null);
}
