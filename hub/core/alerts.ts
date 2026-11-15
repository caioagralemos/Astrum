// Runs the alert levels: looks at the station every two seconds, advances the
// alerts and the messages to Earth (engine/alerts.ts) and tells everyone
// connected what changed, including what each crewmate is doing (and so who is
// asleep: engine/activity.ts).

import { answerAlert, seeAlert, settleAlert, stepAlerts, stepEarth } from '../engine/alerts.ts';
import type { Alert, AlertEvent, DeclaredEvent, EarthMessage, Finding, Unusual } from '../engine/alerts.ts';
import { occupants } from '../engine/timeline.ts';
import type { Profile } from '../engine/types.ts';
import type { EarthReports } from './earth-report.ts';
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
  /**
   * A drill's person and room (core/drill.ts), or null. While set, the engine sees that person in
   * that room and nobody else there: the drill is about one person, wherever the others walk.
   */
  placed: () => { person: string; room: string } | null = () => null;
  /** Base-wide events a crewmate declared and nobody has ended (core/events.ts). */
  declared: (now: number) => DeclaredEvent[] = () => [];
  /** Messages to Earth listed by a drill's alerts: they stay marked after the drill ends. */
  private drillEarth = new Set<string>();
  /** Findings raised by a question (a card her signs picked, a crisis), each kept until its time ends. */
  private raised = new Map<string, { finding: Finding; until: number }>();

  /** Keeps a finding for `keepMs` (the same person and key again restarts it), and looks at the station now. */
  raise(finding: Finding, keepMs: number, now = Date.now()): void {
    this.raised.set(`${finding.person}|${finding.key}`, { finding, until: now + keepMs });
    this.saveRaised();
    this.check(now);
  }

  /**
   * Saved with the open alerts: a restart that forgot them resolved their alerts at its first
   * check, and the next answer raised them again with a new since, a new notice on the phone.
   */
  private saveRaised(): void {
    try {
      this.store.saveRaisedFindings([...this.raised].map(([key, r]) => ({ key, finding: r.finding, until: r.until })));
    } catch (err) {
      console.error('Could not save the raised findings:', err);
    }
  }

  private allFindings(now: number): Finding[] {
    let ended = false;
    for (const [key, r] of this.raised) if (now >= r.until) { this.raised.delete(key); ended = true; }
    if (ended) this.saveRaised();
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
    this.restore(Date.now());
  }

  /**
   * The alerts open before a restart, carried on as the same occurrences: the same since and
   * levelSince, who has seen them, the answer. The first check resolves any whose condition ended
   * meanwhile. Without this every restart raised them again with a new since, and the phones
   * (one notice per alert and since) told the person again.
   */
  private restore(now: number): void {
    for (const r of this.store.raisedFindings()) {
      const f = r.finding as Finding;
      if (f && typeof f === 'object' && typeof f.key === 'string' && typeof f.person === 'string' && typeof r.until === 'number') this.raised.set(r.key, { finding: f, until: r.until });
    }
    const saved = this.store.openAlerts().filter((a): a is Alert =>
      !!a && typeof a === 'object' && typeof (a as Alert).id === 'string' && typeof (a as Alert).since === 'number' && typeof (a as Alert).levelSince === 'number');
    if (!saved.length) return;
    this.alerts = saved;
    for (const a of saved) {
      if (a.drill && a.earthId) this.drillEarth.add(a.earthId);
      // The store closed this hold when it opened (core/db.ts): the alert is still open, so is its hold.
      this.store.holdRaw(`alert|${a.id}|${a.since}`, a.since - 2 * 3600_000, null);
    }
    // Their messages to Earth, listed again under the same ids.
    this.earth = stepEarth([], saved, saved.filter((a) => a.level === 3).map((alert) => ({ type: 'escalated', alert })), now);
    // The screens are told now: the next check finds nothing changed and would never publish them, leaving an
    // open emergency (and a declared event that blocks a new one) that no screen shows.
    this.hub.setAlerts(this.alerts);
  }

  private save(): void {
    try {
      this.store.saveOpenAlerts(this.alerts);
    } catch (err) {
      console.error('Could not save the open alerts:', err);
    }
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

  /** Every message to Earth still listed, the alerts' and the crew's, oldest first, as screens get them. */
  allEarth(now: number): EarthMessage[] {
    return this.decorateEarth(this.listedEarth(now), now);
  }

  /** The same list before demo mode's simulated replies are put on it (core/earth-reply.ts). */
  listedEarth(now: number): EarthMessage[] {
    const crew = this.crewMessages(now);
    const own = this.reports ? this.reports.attach(this.earth, this.alerts, now) : this.earth;
    return crew.length ? [...own, ...crew].sort((a, b) => a.sentAt - b.sentAt) : own;
  }

  /** The incident reports alert messages file with Earth (core/earth-report.ts). */
  reports: EarthReports | null = null;

  /** Demo mode only: puts the simulated replies on the list. Production leaves it as it is. */
  decorateEarth: (list: EarthMessage[], now: number) => EarthMessage[] = (list) => list;

  /** Tells the screens the list now (a crewmate just wrote, or a reply came). */
  publishEarth(now: number): void {
    this.hub.setEarthMessages(this.allEarth(now));
  }

  check(now: number): void {
    this.doing = settleActivity(this.doing, this.activity(now), now);
    this.hub.setActivity(this.doing);
    const asleep = sleepersOf(this.doing);
    const roomAlarms = this.roomAlarms.list();
    let here = occupants(this.store.stays(now, now), now);
    const placed = this.placed();
    if (placed) {
      here = Object.fromEntries(Object.entries(here).map(([room, ids]) => [room, ids.filter((id) => id !== placed.person)]));
      here[placed.room] = [placed.person];
    }
    const out = stepAlerts(this.alerts, {
      now,
      crew: this.profile.crew,
      delayToEarthMs: this.profile.delayToEarthSeconds * 1000,
      roomAlarms,
      roomAverages: this.roomAlarms.averages,
      occupants: here,
      unusual: this.unusual(now),
      asleep,
      actWithin: this.actWithin,
      cardFor: (signal) => this.cardFor(signal),
      findings: this.allFindings(now),
      declared: this.declared(now),
    });
    // An alert on a drill's alarm is a drill's, and so is the message to Earth it lists.
    const drillRoom = (a: Alert) => a.reason === 'room-limit' && roomAlarms.some((x) => x.drill && x.room === a.room && x.signal === a.signal && x.limitSource === a.limitSource);
    const mark = (a: Alert): Alert => (a.drill || !drillRoom(a) ? a : { ...a, drill: true });
    out.alerts = out.alerts.map(mark);
    out.events = out.events.map((e) => ({ ...e, alert: mark(e.alert) }));
    for (const a of out.alerts) if (a.drill && a.earthId) this.drillEarth.add(a.earthId);
    const changed = out.events.length > 0 || JSON.stringify(out.alerts) !== JSON.stringify(this.alerts);
    this.alerts = out.alerts;
    this.earth = stepEarth(this.earth, this.alerts, out.events, now).map((m) => (m.drill || !this.drillEarth.has(m.id) ? m : { ...m, drill: true }));
    for (const id of this.drillEarth) if (!this.earth.some((m) => m.id === id) && !this.alerts.some((a) => a.earthId === id)) this.drillEarth.delete(id);
    for (const event of out.events) {
      // The raw rows around an alert are never summarised (core/retention.ts): 2 hours either side.
      const key = `alert|${event.alert.id}|${event.alert.since}`;
      if (event.type === 'raised') this.store.holdRaw(key, event.alert.since - 2 * 3600_000, null);
      if (event.type === 'resolved') this.store.holdRaw(key, event.alert.since - 2 * 3600_000, now + 2 * 3600_000);
      this.onEvent(event);
    }
    if (changed) {
      this.hub.setAlerts(this.alerts);
      this.save();
    }
    this.hub.setEarthMessages(this.allEarth(now));
  }

  /** "I've seen it" on a level 3 alert. Returns false if there was no such alert left to see. */
  see(id: string, by: string | null, now = Date.now()): boolean {
    const out = seeAlert(this.alerts, id, by, now);
    if (!out.seen) return false;
    this.alerts = out.alerts;
    this.hub.setAlerts(this.alerts);
    this.save();
    return true;
  }

  /** "Emergency settled" on a level 3 alert. Returns false if there was no such alert left to settle. */
  settle(id: string, by: string | null, now = Date.now()): boolean {
    const out = settleAlert(this.alerts, id, by, now);
    if (!out.settled) return false;
    this.alerts = out.alerts;
    this.hub.setAlerts(this.alerts);
    this.save();
    // Settled also silences the board for it: its room's alarm (every room of a station-wide event) is
    // acknowledged, as POST /api/alarms/acknowledge does. The alarm stays shown over the limit.
    const alert = this.alerts.find((a) => a.id === id)!;
    const rooms = new Set<string>();
    if (alert.room) rooms.add(alert.room);
    if (alert.stationWide) {
      for (const a of this.alerts) if (a.stationWide && a.signal === alert.signal && a.room) rooms.add(a.room);
      for (const a of this.roomAlarms.list()) if (a.signal === alert.signal) rooms.add(a.room);
    }
    for (const room of rooms) this.roomAlarms.acknowledge(room);
    this.hub.soundBoard(true);
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
    this.save();
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
