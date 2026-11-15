// Records Astra's answers for the web demo's replay (hub/ui/src/panels/Ask.tsx,
// replay only). It asks a hub that is ALREADY RUNNING (demo mode, the ship's
// mission so the crew is Reyes, Leo, Okafor, Tanaka, and the real model) a few
// questions, the way the Ask sheet asks them (POST /api/ask as the person, with
// the thread's history), and saves exactly what the hub returned.
//
// The web demo's story cannot be asked about: while a recorded story plays, the
// hub's /api/ask still reads the live hub's own readings. So this puts the live
// hub in the same situation with its own drill (POST /api/drill/start, Reyes in
// Quarters 2, simulated CO2 over NASA's limit; core/drill.ts) and asks along it:
// before the drill, at level 2, and once it is level 3. The numbers are that
// run's, and the replay says so. Each entry keeps a note of the hub's state when
// it was asked, read from /api/drill and /api/state, not written by hand.
// A question whose answer did not arrive may be asked once more; nothing else is retried.
//
//   cd hub && ASTRUM_DATA=<new folder> ASTRUM_MISSION=ship-mars-orbit ASTRUM_MODEL=<gguf> node core/run.ts
//   node scripts/record-astra.ts           (writes ui/public/scenario/reyes-night.astra.json)
//
// It ends the drill it started. It never starts or stops the hub.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HUB = `http://${process.env.ASTRUM_HUB ?? '127.0.0.1:4310'}`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'public', 'scenario', 'reyes-night.astra.json');
const PERSON = 'reyes';
const ROOM = 'quarters-2';

type Phase = 'before' | 'level-2' | 'level-3';
const QUESTIONS: { phase: Phase; question: string }[] = [
  { phase: 'before', question: 'How is the air in my quarters?' },
  { phase: 'before', question: "What is NASA's CO2 limit, and why does it matter?" },
  { phase: 'level-2', question: 'Is the air in my quarters safe right now?' },
  { phase: 'level-3', question: "I have a bad headache and I'm breathing fast." },
  { phase: 'level-3', question: 'Is this CO2 poisoning? How much ibuprofen should I take?' },
];

const get = async (path: string) => (await fetch(HUB + path)).json() as Promise<any>;
const post = async (path: string, body: unknown) => (await fetch(HUB + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST /api/ask as the Ask sheet sends it; the last line that is not a status is the hub's response. */
async function ask(question: string, history: unknown[]): Promise<any | null> {
  const res = await fetch(`${HUB}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person: PERSON, question, lang: 'en', history }) });
  if (!res.ok) return null;
  let result: any = null;
  for (const line of (await res.text()).split('\n')) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.type !== 'status') result = msg;
  }
  return result && !('error' in result) ? result : null;
}

/** The hub's state for the note: the drill, Quarters 2's CO2 alarm, Reyes's alert, from the hub. */
async function stateNote(): Promise<{ note: string; drill: unknown; alarm: unknown; alert: unknown }> {
  const { drill } = await get('/api/drill');
  const state = await get('/api/state');
  const alarm = (state.alarms as any[]).find((a) => a.room === ROOM && a.signal === 'co2') ?? null;
  const alert = (state.alerts as any[]).find((a) => a.person === PERSON) ?? null;
  const stay = (state.stays as any[]).find((s) => s.person === PERSON && s.until === null);
  const parts = [drill ? `drill running: simulated CO2 in ${drill.room} at ${drill.value} ${drill.unit}` : `no drill; the hub has Reyes in ${stay?.room ?? 'an unknown room'}`];
  if (alarm) parts.push(`Quarters 2 CO2 alarm at ${alarm.value} ${alarm.unit} (1-hour average)`);
  parts.push(alert ? `Reyes's alert at level ${alert.level}` : 'no alert for Reyes');
  return { note: parts.join(', '), drill, alarm, alert };
}

async function waitForLevel(level: number, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const state = await get('/api/state');
    if ((state.alerts as any[]).some((a) => a.person === PERSON && a.level >= level)) return;
    await wait(2000);
  }
  throw new Error(`Reyes's alert did not reach level ${level}`);
}

const status = await get('/api/ask/status');
if (status.state !== 'ready') throw new Error(`the model is not ready: ${JSON.stringify(status)}`);
const crew = (await get('/api/state')).profile.crew.map((p: { name: string }) => p.name).join(', ');
if (crew !== 'Reyes, Leo, Okafor, Tanaka') throw new Error(`the crew is ${crew}, not the story's: start the hub with ASTRUM_MISSION=ship-mars-orbit`);

const entries: unknown[] = [];
const history: { question: string; route?: string; card?: string; understoodAs?: string }[] = [];
let drillAt: number | null = null;
try {
  for (const q of QUESTIONS) {
    if (q.phase !== 'before' && drillAt === null) {
      const started = await post('/api/drill/start', { person: PERSON, room: ROOM });
      if (!started.drill) throw new Error(`the drill did not start: ${JSON.stringify(started)}`);
      drillAt = started.drill.startedAt;
    }
    if (q.phase !== 'before') await waitForLevel(q.phase === 'level-2' ? 2 : 3, 3 * 60_000);
    const asked = await stateNote();
    const askedAt = Date.now();
    let response = await ask(q.question, history.slice(-6));
    let retried = false;
    if (!response) { retried = true; response = await ask(q.question, history.slice(-6)); }
    if (!response) throw new Error(`no answer to "${q.question}", twice`);
    const item: (typeof history)[number] = { question: q.question, route: response.route };
    if (response.card) item.card = response.card.id;
    if (response.understoodAs) item.understoodAs = response.understoodAs;
    history.push(item);
    entries.push({
      question: q.question, person: PERSON, phase: q.phase, retried,
      secondsIntoDrill: drillAt === null ? null : Math.round((askedAt - drillAt) / 1000),
      hubState: asked.note, drill: asked.drill, alarm: asked.alarm, alert: asked.alert,
      response,
    });
    console.log(`${q.phase} · ${asked.note}\n  Q: ${q.question}\n  ${response.by}/${response.route}${response.card ? ` card ${response.card.id}` : ''}${retried ? ' (retried)' : ''}: ${response.text}\n`);
  }
} finally {
  if (drillAt !== null) await post('/api/drill/stop', {});
}

writeFileSync(OUT, JSON.stringify({
  about: 'Asked on the live hub (demo mode, the ship, the real on-board model) during a drill of the same situation as "Reyes\'s night". The numbers are that run\'s. Written by hub/scripts/record-astra.ts.',
  recordedAt: new Date().toISOString(),
  model: status.model ?? null,
  answers: entries,
}, null, 2) + '\n');
console.log(`Wrote ${OUT}`);
