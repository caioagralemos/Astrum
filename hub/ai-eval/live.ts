// The /api/ask context built from a hub database, exactly as core/main.ts
// wires it, for the eval's live section. Opens a COPY of the database: never
// the running hub's own file.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../core/db.ts';
import { Baselines } from '../core/baseline.ts';
import { evidenceNow } from '../core/evidence.ts';
import type { RoomAlarms } from '../core/alarms.ts';
import type { AiRuntime, AskContext } from '../core/ai.ts';
import { detectorLine } from '../engine/baseline.ts';
import { LIMITS, windowAverage } from '../engine/cabin.ts';
import { parseCards } from '../engine/cards.ts';
import type { Reading } from '../engine/prompt.ts';
import type { SearchIndex } from '../engine/search.ts';
import { t } from '../engine/strings.ts';
import { KIND_RANK } from '../engine/types.ts';
import type { Kind, Profile } from '../engine/types.ts';

export function liveContext(ai: AiRuntime, index: SearchIndex, dbFile: string, hubDir: string): { ctx: AskContext; close: () => void } {
  const profile = JSON.parse(readFileSync(join(hubDir, 'profiles', 'mars-orbit.json'), 'utf8')) as Profile;
  const store = new Store(dbFile);
  const baselines = new Baselines(store, profile.crew.map((p) => p.id));
  // The alarm watcher needs a running hub; the eval has none, so no alarms and no stuck sensors.
  const alarms = { stuck: [], list: () => [] } as unknown as RoomAlarms;

  const nameOf = (signal: string) => { const n = t(`signal.${signal}`, 'en'); return n === n.toUpperCase() ? n : n.toLowerCase(); };
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const summaryOf = (person: string) => baselines.all(Date.now()).find((s) => s.person === person) ?? null;
  const roomOf = (person: string) => store.stays(Date.now(), Date.now(), person).find((s) => s.until === null)?.room ?? null;

  const ctx: AskContext = {
    ai, index, cards: () => parseCards([]),
    readingsFor: (person) => {
      const p = profile.crew.find((c) => c.id === person);
      if (!p) return null;
      const now = Date.now();
      const readings: Reading[] = [];
      for (const s of summaryOf(person)?.signals ?? []) {
        if (s.status !== 'judged') continue;
        const label = (Object.keys(s.kinds) as Kind[]).sort((a, b) => KIND_RANK[b] - KIND_RANK[a])[0] ?? 'simulated';
        const unit = store.rows({ person, signal: s.signal, limit: 1 })[0]?.unit ?? '';
        readings.push({ type: 'normal', name: nameOf(s.signal), value: round1(s.recent), unit, label, normal: round1(s.usual), judged: s.unusual ? (s.direction === 'high' ? 'above' : 'below') : 'inside' });
      }
      const room = roomOf(person);
      if (room) for (const limit of LIMITS) {
        const avg = windowAverage(store.rows({ room, signal: limit.signal, from: now - limit.windowMs }), room, limit.signal, now, limit.windowMs);
        if (avg) readings.push({ type: 'limit', name: `cabin ${nameOf(limit.signal)}`, value: round1(avg.value), unit: limit.unit, label: avg.kind, window: '1-hour average', limit: limit.max });
      }
      return { name: p.name, readings };
    },
    detectorLineFor: (person) => { const s = summaryOf(person); return s ? detectorLine(s, Object.fromEntries(s.signals.map((x) => [x.signal, nameOf(x.signal)]))) : null; },
    facts: () => ({ readings: [], answers: [] }),
    onCrisis: () => false,
    // The three new lines for main.ts:
    evidenceFor: (person) => evidenceNow(person, { store, profile, baselines, alarms }),
    roomName: (id) => { const r = profile.rooms.find((x) => x.id === id); return r ? t(r.name, 'en') : id; },
    personName: (id) => profile.crew.find((p) => p.id === id)?.name ?? id,
    // And this one, for pronouns:
    pronounsOf: (id) => profile.crew.find((p) => p.id === id)?.pronouns,
  };
  return { ctx, close: () => store.close() };
}
