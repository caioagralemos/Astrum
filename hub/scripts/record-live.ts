// Records a web-demo scenario from a hub that is ALREADY RUNNING in demo mode,
// for the browser replay (ui/src/data.ts RecordedSource). It connects as a
// shared screen (the hub's WebSocket, as LiveSource does), keeps the first
// "state" and every message after it with its moment on the hub's clock, and
// performs a short script through the hub's own HTTP API: a crewmate declares a
// base-wide event (core/events.ts), another taps "I've seen it", someone ends
// it. Everything on screen is the real hub's logic on its simulated demo data;
// nothing is written by hand and no sensor detects anything (the event is
// declared, and the screen says by whom). Every message is flagged as a
// simulated scenario. It plays at real time (meta.speed [[startsAt, 1]]).
//
// The hub must run the scenario's mission (hub-place.sh <mission> restarts the
// filming hub on one):
//
//   node scripts/record-live.ts dust-storm     (base-mars)
//   node scripts/record-live.ts station-fire   (iss)
//
// Writes ui/public/scenario/<id>.json. Ends the event it declared even if
// something fails. It never starts or stops the hub.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HUB = process.env.HUB ?? 'localhost:4310';
const S = 1000;
/** A reading is kept at most this often per signal and place (a screen counts one current for 30 s). */
const KEEP_MS = 15 * S;

type Json = Record<string, any>;
interface Plan {
  mission: string;
  title: string;
  kind: string;
  /** Seconds from the start: declare (with a warning stage of `warnS` seconds if set), see, end, stop. */
  declareS: number; warnS?: number; seeS: number; endS: number; stopS: number;
  intro: { title: { en: string; pt: string }; lines: { en: string; pt: string }[] };
}

const PLANS: Record<string, Plan> = {
  'dust-storm': {
    mission: 'base-mars', title: 'Dust storm on Mars', kind: 'dust_storm',
    declareS: 4, warnS: 16, seeS: 42, endS: 78, stopS: 86,
    intro: {
      title: { en: 'A dust storm reaches the Mars base.', pt: 'Uma tempestade de poeira chega à base em Marte.' },
      lines: [
        { en: 'Four crew are inside. One of them sees it coming.', pt: 'Quatro tripulantes estão lá dentro. Um deles a vê chegando.' },
        { en: 'They tell Astrum.', pt: 'E avisa o Astrum.' },
      ],
    },
  },
  'station-fire': {
    mission: 'iss', title: 'Fire on the station', kind: 'fire',
    declareS: 4, seeS: 32, endS: 70, stopS: 78,
    intro: {
      title: { en: 'A fire on the space station.', pt: 'Um incêndio na estação espacial.' },
      lines: [
        { en: 'Someone smells smoke in one of the modules.', pt: 'Alguém sente cheiro de fumaça em um dos módulos.' },
        { en: 'They tell Astrum.', pt: 'E avisa o Astrum.' },
      ],
    },
  },
};

const id = process.argv[2] ?? '';
const plan = PLANS[id];
if (!plan) { console.error(`Usage: node scripts/record-live.ts <${Object.keys(PLANS).join('|')}>`); process.exit(1); }

const post = async (path: string, body: unknown): Promise<Json> => {
  const res = await fetch(`http://${HUB}${path}`, { method: 'POST', body: JSON.stringify(body) });
  const out = (await res.json()) as Json;
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(out)}`);
  return out;
};

const state = (await (await fetch(`http://${HUB}/api/state`)).json()) as Json;
const mission = state.profile?.mission?.id ?? state.profile?.mission;
const crew: { id: string; name: string }[] = state.profile.crew;
const rooms: string[] = state.profile.rooms.map((r: Json) => r.id);
if (typeof mission === 'string' && mission !== plan.mission) { console.error(`The hub runs "${mission}"; this scenario needs "${plan.mission}" (hub-place.sh ${plan.mission}).`); process.exit(1); }
if (!rooms.length || crew.length < 2) { console.error('The hub has no rooms or too few crew.'); process.exit(1); }
const declarer = crew[0];
// PHONE_CREW: the crewmate a phone filmed in the same take is signed in as; someone else taps "I've seen it",
// so the phone never shows a tap it did not make.
const phoneCrew = process.env.PHONE_CREW ?? '';
const seer = crew.find((c) => c !== declarer && c.id !== phoneCrew) ?? crew[1];

const raw: { at: number; message: Json }[] = [];
const moments: { at: number; what: string }[] = [];
let offset = 0; // hub clock minus this machine's
const hubNow = () => Date.now() + offset;
// Each line also prints this machine's wall clock, so a take filmed beside it (a phone) can be lined up.
const say = (what: string) => { moments.push({ at: hubNow(), what }); console.log(`+${((hubNow() - startsAt) / S).toFixed(1)} s  wall ${Date.now()}  ${what}`); };
let startsAt = 0;
let alerts: Json[] = [];
const lastRow = new Map<string, { t: number; value: unknown }>();
const lastEvidence = new Map<string, string>();
const keyOf = (r: Json) => `${r.room ?? ''}|${r.person ?? ''}|${r.signal}|${r.source}`;

const socket = new WebSocket(`ws://${HUB}/ws`);
const ready = new Promise<void>((resolve, reject) => {
  socket.onerror = () => reject(new Error(`could not connect to ws://${HUB}/ws`));
  socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', role: 'screen' }));
  socket.onmessage = (event) => {
    const m = JSON.parse(String(event.data)) as Json;
    if (m.scenario) return; // a story the hub is playing is not this recording
    if (m.type === 'state') {
      offset = m.now - Date.now();
      if (!startsAt) { startsAt = m.now; for (const r of m.latest) lastRow.set(keyOf(r), { t: r.t, value: r.value }); raw.push({ at: m.now, message: m }); alerts = m.alerts ?? []; resolve(); return; }
    }
    if (!startsAt || m.type === 'clock' || m.type === 'followUp') return;
    const at = hubNow();
    if (m.type === 'rows') {
      const rows = (m.rows as Json[]).filter((r) => {
        const held = lastRow.get(keyOf(r));
        const keep = !held || r.t - held.t >= KEEP_MS || (r.kind === 'replayed' && r.value !== held.value);
        if (keep) lastRow.set(keyOf(r), { t: r.t, value: r.value });
        return keep;
      });
      if (rows.length) raw.push({ at, message: { type: 'rows', rows } });
      return;
    }
    if (m.type === 'evidence') {
      const { computedAt: _, ...card } = m.evidence ?? {};
      const text = JSON.stringify(card);
      if (lastEvidence.get(m.person) === text) return;
      lastEvidence.set(m.person, text);
    }
    if (m.type === 'alerts') alerts = m.alerts;
    raw.push({ at, message: m });
  };
});
await ready;
console.log(`START hub ${startsAt} wall ${startsAt - offset} offset ${offset}`);

const wait = (s: number) => new Promise((r) => setTimeout(r, Math.max(0, startsAt + s * S - hubNow())));
let eventId: string | null = null;
try {
  await wait(plan.declareS);
  const body: Json = { kind: plan.kind, by: declarer.id };
  if (plan.warnS) body.expectedAt = hubNow() + plan.warnS * S;
  eventId = ((await post('/api/events/declare', body)).event as Json).id;
  say(plan.warnS ? `${declarer.name} declares a ${plan.kind} expected in ${plan.warnS} s` : `${declarer.name} declares a ${plan.kind}`);

  await wait(plan.seeS);
  const three = alerts.find((a) => a.level === 3 && a.declared);
  if (!three) throw new Error('no level 3 for the declared event by now');
  await post('/api/alerts/acknowledge', { id: three.id, by: seer.id });
  say(`${seer.name} taps "I've seen it"`);

  await wait(plan.endS);
  await post('/api/events/end', { id: eventId, by: declarer.id });
  eventId = null;
  say(`${declarer.name} ends the event`);
  await wait(plan.stopS);
  say('The end');
} finally {
  if (eventId) await post('/api/events/end', { id: eventId, by: declarer.id }).catch(() => {});
  socket.close();
}

const endsAt = hubNow();
const messages = raw.map(({ at, message }) => ({ at, message: { ...message, scenario: { id, label: 'scenario.simulated', at, speed: 1 } } }));
const recording = {
  meta: {
    id, title: plan.title, startsAt, endsAt, speed: [[startsAt, 1]],
    labels: { scenario: 'scenario.simulated', title: `scenario.${id}` },
    moments, intro: plan.intro, mission: plan.mission,
    notes: [
      'Simulated scenario, recorded from the real hub in demo mode: every message is what the hub sent a shared screen.',
      'The crew, their bodies and readings are the demo hub\'s simulated data. No sensor detected the event: a crewmate declared it.',
      `Thinned for size: each signal of each room and person is kept at most once every ${KEEP_MS / S} seconds, a replayed value also whenever it changes; evidence cards only when they change. Clock ticks are left out.`,
    ],
  },
  messages,
};
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'public', 'scenario', `${id}.json`);
const text = JSON.stringify(recording);
writeFileSync(out, text);
console.log(`Wrote ${out} (${(Buffer.byteLength(text) / 1e6).toFixed(2)} MB, ${messages.length} messages)`);
