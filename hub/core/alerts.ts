// Runs the alert levels: looks at the station every two seconds, advances the
// alerts and the messages to Earth (engine/alerts.ts) and tells everyone
// connected what changed, including who is asleep.

import { answerAlert, seeAlert, stepAlerts, stepEarth } from '../engine/alerts.ts';
import type { Alert, AlertEvent, EarthMessage, Unusual } from '../engine/alerts.ts';
import { occupants } from '../engine/timeline.ts';
import type { Profile } from '../engine/types.ts';
import type { RoomAlarms } from './alarms.ts';
import type { Store } from './db.ts';
import type { Hub } from './server.ts';

export class AlertWatcher {
  private alerts: Alert[] = [];
  private earth: EarthMessage[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** Set by whoever knows: crew ids asleep now, and readings unusual for a person. */
  asleep: (now: number) => string[] = () => [];
  unusual: (now: number) => Unusual[] = () => [];
  /** How soon each steps card says to act, in seconds, by card id. Empty until the medical lead's card file gives times. */
  actWithin: Record<string, number> = {};
  /** Called for every change, for anything that wants to react (logs, the scenario recorder). */
  onEvent: (event: AlertEvent) => void = () => {};

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

  /** Messages to Earth still listed. */
  earthMessages(): EarthMessage[] {
    return this.earth;
  }

  check(now: number): void {
    const asleep = this.asleep(now);
    this.hub.setAsleep(asleep);
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
    });
    const changed = out.events.length > 0 || JSON.stringify(out.alerts) !== JSON.stringify(this.alerts);
    this.alerts = out.alerts;
    this.earth = stepEarth(this.earth, this.alerts, out.events, now);
    for (const event of out.events) this.onEvent(event);
    if (changed) this.hub.setAlerts(this.alerts);
    this.hub.setEarthMessages(this.earth);
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
