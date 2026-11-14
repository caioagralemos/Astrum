// GET /api/evidence?person=<id>: the evidence card for one crewmate
// (engine/evidence.ts), computed on request from the store, the cached
// baseline summaries and the alarm watcher's latest findings.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { evidenceFor, WINDOWS_MS } from '../engine/evidence.ts';
import { CHECKIN_PREFIX } from '../engine/checkin.ts';
import { occupants } from '../engine/timeline.ts';
import type { Profile } from '../engine/types.ts';
import type { RoomAlarms } from './alarms.ts';
import type { Baselines } from './baseline.ts';
import type { Store } from './db.ts';

export interface EvidenceDeps {
  store: Store;
  profile: Profile;
  baselines: Baselines;
  alarms: RoomAlarms;
  offsetMinutes?: number;
}

/** One cabin row a minute per source is enough: a reading holds for up to 10 minutes. */
const SAMPLE_MS = 60_000;

export function evidenceNow(person: string, deps: EvidenceDeps, now = Date.now()) {
  const longest = Math.max(...WINDOWS_MS);
  const from = now - longest;
  return evidenceFor(person, {
    now,
    crew: deps.profile.crew.map((p) => p.id),
    summaries: deps.baselines.all(now),
    occupantsNow: occupants(deps.store.stays(now, now), now),
    stays: deps.store.stays(from, now),
    cabinRows: deps.store.sampled('co2', from, now, SAMPLE_MS),
    checkins: deps.store.rows({ person, signalPrefix: CHECKIN_PREFIX, from, to: now, limit: 5000 }),
    latest: deps.store.recent(now - 24 * 3600_000).filter((r) => r.signal === 'co2' && !r.person),
    stuck: deps.alarms.stuck,
    alarms: deps.alarms.list(),
    offsetMinutes: deps.offsetMinutes ?? -new Date(now).getTimezoneOffset(),
  });
}

/** The route, for Hub.routes. Returns true when it handled the request. */
export function evidenceRoute(deps: EvidenceDeps) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== '/api/evidence' || req.method !== 'GET') return false;
    const person = url.searchParams.get('person');
    const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (!person || !deps.profile.crew.some((p) => p.id === person)) {
      json(400, { error: 'person must be a crewmate in the profile' });
      return true;
    }
    json(200, evidenceNow(person, deps));
    return true;
  };
}
