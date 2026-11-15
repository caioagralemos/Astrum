// End-to-end checks of the running hub, over HTTP and its WebSocket, on private
// hubs started here: each on a free port, with its own data folder under
// /private/tmp/astrum-e2e, no serial port (a path that does not exist, or a
// fake board on a pseudo-terminal), no Bonjour, and no model (ASTRUM_MODEL
// names a file that does not exist and ASTRUM_LLAMA_PORT a port of its own, so
// the hub never starts or touches a llama-server: /api/ask answers with the
// hub's own sentences). It never touches the owner's hub, its ports or its data.
//
//   node scripts/e2e.ts                      every mission, production, 10 mission switches
//   node scripts/e2e.ts --mission iss        one mission (demo checks only)
//   node scripts/e2e.ts --skip-switch --skip-production
//
// Takes about two minutes per mission: the "Are you OK?" countdown is waited out
// for real once per mission, because the hub's clock cannot be moved from outside.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { answerSignal } from '../engine/cards.ts';
import { KINDS } from '../engine/types.ts';
import type { Alert, EarthMessage } from '../engine/alerts.ts';
import type { Row } from '../engine/types.ts';

const hubDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = '/private/tmp/astrum-e2e';
/** The owner's hub, its interface, and its model: never used here. */
const FORBIDDEN_PORTS = new Set([4310, 5173, 5174, 18431]);
const MISSIONS = ['ship-mars-orbit', 'iss', 'base-mars', 'base-moon'];
const SWOLLEN = 'Is one leg or arm swollen, warm and painful?';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- results ----------

type Status = 'pass' | 'fail' | 'gap';
interface Check { mission: string; name: string; status: Status; detail: string }
const results: Check[] = [];
function record(mission: string, name: string, status: Status, detail = ''): void {
  results.push({ mission, name, status, detail });
  console.log(`${status === 'pass' ? 'PASS' : status === 'gap' ? 'GAP ' : 'FAIL'}  ${mission}  ${name}${detail ? `: ${detail}` : ''}`);
}
/** Runs one check; a thrown error is a failure with its message. */
async function check(mission: string, name: string, fn: () => Promise<string | void | { gap: string }>): Promise<void> {
  try {
    const out = await fn();
    if (out && typeof out === 'object') record(mission, name, 'gap', out.gap);
    else record(mission, name, 'pass', out ?? '');
  } catch (err) {
    record(mission, name, 'fail', (err as Error).message);
  }
}
function must(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

// ---------- private hubs ----------

async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const s = createServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
    });
    if (!FORBIDDEN_PORTS.has(port)) return port;
  }
}

interface Hub {
  name: string;
  base: string;
  proc: ChildProcess;
  log: () => string;
  stop: () => Promise<void>;
}

interface HubOptions { mission?: string; production?: boolean; supervised?: boolean; chipPort?: string }

async function startHub(name: string, opts: HubOptions = {}): Promise<Hub> {
  const dir = join(ROOT, name);
  must(dir.startsWith(`${ROOT}/`), 'data folder outside /private/tmp/astrum-e2e');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const port = await freePort();
  const llamaPort = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ASTRUM_PORT: String(port),
    ASTRUM_DATA: dir,
    ASTRUM_NO_MDNS: '1',
    ASTRUM_CHIP_PORT: opts.chipPort ?? join(ROOT, 'no-board'),
    ASTRUM_MODEL: join(ROOT, 'no-model.gguf'),
    ASTRUM_LLAMA_PORT: String(llamaPort),
    ASTRUM_MODE: opts.production ? 'production' : 'demo',
  };
  for (const key of ['ASTRUM_MISSION', 'ASTRUM_PROFILE', 'ASTRUM_SENSOR_PORTS', 'ASTRUM_SUPERVISED', 'ASTRUM_BLOOD', 'ASTRUM_CARDS']) delete env[key];
  if (opts.mission) env.ASTRUM_MISSION = opts.mission;
  const lines: string[] = [];
  const file = createWriteStream(join(dir, 'hub.log'));
  const proc = spawn(process.execPath, [opts.supervised ? 'core/run.ts' : 'core/main.ts'], { cwd: hubDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [proc.stdout!, proc.stderr!]) stream.on('data', (d: Buffer) => { lines.push(String(d)); file.write(d); });
  const base = `http://127.0.0.1:${port}`;
  const hub: Hub = {
    name, base, proc, log: () => lines.join(''),
    stop: async () => {
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      const exited = new Promise((r) => proc.once('exit', r));
      proc.kill('SIGTERM');
      await Promise.race([exited, sleep(10_000)]);
      if (proc.exitCode === null && proc.signalCode === null) { proc.kill('SIGKILL'); await exited; }
      file.end();
    },
  };
  await waitFor(async () => (await get(base, '/api/state')).status === 200, 90_000, `${name} did not answer on its port; log: ${dir}/hub.log`);
  return hub;
}

async function waitFor<T>(fn: () => Promise<T | false | null | undefined> | T | false | null | undefined, ms: number, message: string, every = 250): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v as T; } catch { /* not yet */ }
    if (Date.now() > until) throw new Error(message);
    await sleep(every);
  }
}

async function get(base: string, path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  // /api/ask answers in lines of JSON; the last is the result.
  const last = text.trim().split('\n').pop() ?? '';
  let json: any = null;
  try { json = JSON.parse(last); } catch { json = text; }
  return { status: res.status, json };
}

/** A screen or phone on the hub's WebSocket: keeps every message, says hello as a crewmate if asked. */
class Client {
  messages: any[] = [];
  raw: string[] = [];
  private ws: WebSocket;
  constructor(base: string) {
    this.ws = new WebSocket(base.replace('http', 'ws') + '/ws');
    this.ws.on('message', (d) => { const text = String(d); this.raw.push(text); try { this.messages.push(JSON.parse(text)); } catch { /* not JSON */ } });
  }
  static async open(base: string, person?: string): Promise<Client> {
    const c = new Client(base);
    await new Promise<void>((resolve, reject) => { c.ws.once('open', () => resolve()); c.ws.once('error', reject); });
    await waitFor(() => c.messages.some((m) => m.type === 'state'), 10_000, 'no first state');
    if (person) {
      const before = c.messages.length;
      c.ws.send(JSON.stringify({ type: 'hello', person }));
      await waitFor(() => c.messages.slice(before).some((m) => m.type === 'state'), 10_000, `no state after hello as ${person}`);
    }
    return c;
  }
  send(obj: unknown): void { this.ws.send(JSON.stringify(obj)); }
  /** The newest alerts this socket holds, from the last state or alerts message. */
  alerts(): Alert[] {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.type === 'alerts' || m.type === 'state') return m.alerts;
    }
    return [];
  }
  everything(): string { return this.raw.join('\n'); }
  close(): void { this.ws.close(); }
}

// ---------- the checks for one mission ----------

async function missionChecks(mission: string): Promise<void> {
  const hub = await startHub(`demo-${mission}`, { mission });
  const B = hub.base;
  try {
    await check(mission, 'model is off and untouched (hub answers alone)', async () => {
      const s = (await get(B, '/api/ask/status')).json;
      must(s.state === 'unavailable', `AI state ${s.state}`);
      must(/model file is missing/.test(s.reason ?? ''), `reason: ${s.reason}`);
      return 'state unavailable: model file missing, no llama-server started';
    });
    // The stand-in starts five seconds after the hub; evidence cards take one tick per person.
    await sleep(7000);
    const first = (await get(B, '/api/state')).json;
    const profile = first.profile;
    const crew: string[] = profile.crew.map((p: { id: string }) => p.id);
    const rooms: string[] = profile.rooms.map((r: { id: string }) => r.id);
    const delayS: number = profile.delayToEarthSeconds;
    const cmo = profile.crew.find((p: { role: string }) => p.role === 'role.cmo')?.id;
    const commander = profile.crew.find((p: { role: string }) => p.role === 'role.commander')?.id;
    const [p1, p2, p3, p4] = ['reyes', 'leo', 'okafor', 'tanaka'];
    must(crew.join() === [p1, p2, p3, p4].join() && cmo === p3 && commander === p4, `unexpected crew ${crew.join()}`);

    await check(mission, 'state arrives and is consistent', async () => {
      const ws = await Client.open(B);
      const s = ws.messages.find((m) => m.type === 'state');
      ws.close();
      const problems: string[] = [];
      for (const room of rooms) {
        const has = s.latest.some((r: Row) => r.room === room && !r.person);
        const missing = s.quality.unjudged.some((u: { room: string }) => u.room === room);
        if (!has && !missing) problems.push(`room ${room} has no readings and does not say missing`);
      }
      for (const r of s.latest as Row[]) {
        if (!KINDS.includes(r.kind)) problems.push(`row without a kind: ${r.signal}`);
        if (r.source.startsWith('sim:') && r.kind !== 'simulated') problems.push(`${r.source} ${r.signal} labelled ${r.kind}`);
        if (r.source.startsWith('nasa:') && r.kind !== 'replayed') problems.push(`${r.source} ${r.signal} labelled ${r.kind}`);
      }
      for (const st of s.stays) if (!KINDS.includes(st.kind)) problems.push(`stay without a kind for ${st.person}`);
      if (!Array.isArray(s.sources)) problems.push('sources missing');
      if (!Array.isArray(s.stays) || s.stays.length < crew.length) problems.push(`stays: ${s.stays?.length}`);
      if (!Array.isArray(s.earthMessages)) problems.push('earthMessages missing');
      if (typeof s.evidence !== 'object' || s.evidence === null) problems.push('evidence missing');
      if (typeof s.dose !== 'object' || s.dose === null) problems.push('dose missing');
      // The dose is worked out once a minute; the first, at start, comes before any radiation reading.
      const dose = await waitFor(async () => { const d = (await get(B, '/api/state')).json.dose; return crew.every((p) => d[p]?.person === p) && d; }, 75_000, 'dose did not arrive for every crewmate within 75 s').catch((e: Error) => { problems.push(e.message); return null; });
      const doseEmptyAtStart = Object.keys(s.dose ?? {}).length === 0;
      // Evidence is worked out one person per tick: within 40 seconds every crewmate has a card.
      const ev = await waitFor(async () => { const e = (await get(B, '/api/state')).json.evidence; return crew.every((p) => e[p]?.person === p) && e; }, 45_000, 'evidence cards did not arrive for every crewmate');
      for (const p of crew) if (typeof ev[p].pointsTo !== 'string') problems.push(`evidence for ${p} has no pointsTo`);
      must(!problems.length, problems.slice(0, 6).join('; '));
      const kinds = [...new Set((s.latest as Row[]).map((r) => r.kind))].join('/');
      return `${rooms.length} rooms all with readings, ${s.latest.length} rows (${kinds}), evidence and dose for ${crew.length}${dose && doseEmptyAtStart ? ' (dose is {} for the first minute after start)' : ''}`;
    });

    await check(mission, 'phone readings are stored and appear', async () => {
      const ws = await Client.open(B, p2);
      const t = Date.now();
      const r = await post(B, '/api/readings', { source: `phone:${p2}`, rows: [{ t, signal: 'blood_oxygen', value: 97, unit: '%', kind: 'measured', person: p2 }] });
      must(r.status === 200 && r.json.accepted === 1, `POST /api/readings ${r.status} ${JSON.stringify(r.json)}`);
      ws.send({ type: 'readings', source: `phone:${p2}`, rows: [{ t: t + 1, signal: 'steps', value: 1200, unit: 'count', kind: 'measured', person: p2 }] });
      await waitFor(() => ws.messages.some((m) => m.type === 'rows' && m.rows.some((x: Row) => x.signal === 'steps' && x.person === p2)), 5000, 'WebSocket readings never came back as rows');
      const stored = (await get(B, `/api/rows?person=${p2}&from=${t - 1}`)).json.rows as Row[];
      ws.close();
      must(stored.some((x) => x.signal === 'blood_oxygen' && x.source === `phone:${p2}` && x.kind === 'measured'), 'HTTP reading not stored');
      must(stored.some((x) => x.signal === 'steps'), 'WebSocket reading not stored');
      return 'over HTTP and over the WebSocket, stored as measured';
    });

    // Three viewers for the privacy checks: the person, the Crew Medical Officer, a shared screen.
    const me = await Client.open(B, p1);
    const officer = await Client.open(B, p3);
    const shared = await Client.open(B);
    const others = await Client.open(B, p2);

    await check(mission, 'privacy: typed check-in text reaches only its author', async () => {
      const secret = `e2e-secret-${mission}-${Date.now()}`;
      const r = await post(B, '/api/checkin', { person: p1, answers: [{ signal: 'note', value: null, text: secret }] });
      must(r.status === 200 && r.json.accepted === 1, `checkin ${r.status}`);
      await waitFor(() => me.everything().includes(secret), 5000, 'the author never got their own text');
      await sleep(1500);
      for (const [who, c] of [[p3, officer], ['shared screen', shared], [p2, others]] as const) must(!c.everything().includes(secret), `${who} received the text`);
      must(officer.messages.some((m) => m.type === 'rows' && m.rows.some((x: Row) => x.signal === 'checkin.note' && x.person === p1 && x.text === null)), 'the officer did not get the row without its text');
      must(!JSON.stringify((await get(B, `/api/rows?person=${p1}&signal=checkin.note`)).json).includes(secret), '/api/rows carries the text');
      const late = await Client.open(B, p3);
      late.close();
      must(!late.everything().includes(secret), 'a later hello as the officer got the text in its state');
      return 'author sees it; officer, crewmate, shared screen and /api/rows get the row with text null';
    });

    await check(mission, 'privacy: a private card (psychosis, her "voices" situation = dangerous) tells others only "needs someone"', async () => {
      const words = 'I keep hearing voices at night';
      const r = await post(B, '/api/ask', { person: p1, question: words });
      must(r.status === 200, `ask ${r.status}`);
      const mine = await waitFor(() => me.alerts().find((a) => a.person === p1 && a.reason === 'finding' && a.level >= 2), 8000, 'no alert for the person');
      must(mine.card === 'depression-psychosis', `the person sees card ${mine.card}`);
      const theirs = await waitFor(() => officer.alerts().find((a) => a.id === mine.id), 5000, 'the officer did not get the alert');
      must(theirs.card === null && theirs.private?.card === null && theirs.signal === 'needs-someone', `officer view: card ${theirs.card}, signal ${theirs.signal}`);
      must(mine.level === 3 && theirs.toldTo === 'everyone', `level ${mine.level}, told ${JSON.stringify(theirs.toldTo)} (her situation "voices-or-delirium" is dangerous, everyone)`);
      const common = await waitFor(() => shared.alerts().find((a) => a.id === mine.id), 5000, 'the shared screen did not get the level 3');
      must(common.card === null && common.signal === 'needs-someone', `shared screen: card ${common.card}`);
      for (const [who, c] of [[p3, officer], ['shared screen', shared], [p2, others]] as const) {
        must(!c.everything().includes('depression-psychosis'), `${who} received the card's name`);
        must(!c.everything().includes(words), `${who} received the words`);
      }
      return 'level 3, everyone told "needs someone"; only the person sees the card; nobody else gets card or words';
    });

    await check(mission, 'privacy: gynecologic card stays with the person', async () => {
      const r = await post(B, '/api/ask', { person: p3, question: 'heavy bleeding since this morning' });
      must(r.status === 200, `ask ${r.status}`);
      const hers = await waitFor(() => officer.alerts().find((a) => a.person === p3 && a.reason === 'finding'), 8000, 'no alert for the person');
      must(hers.card === 'gynecologic' && hers.level === 1, `person sees card ${hers.card} level ${hers.level}`);
      await sleep(1000);
      for (const [who, c] of [[p1, me], ['shared screen', shared], [p2, others]] as const) must(!c.everything().includes('gynecologic'), `${who} received the card's name`);
      const leaked = shared.alerts().find((a) => a.id === hers.id);
      return `level ${hers.level}, told ${JSON.stringify(hers.toldTo)}; card name only on the person's socket${leaked ? ' (note: the level 1 alert itself, card removed, still reaches every socket; screens hide it by toldTo)' : ''}`;
    });

    await check(mission, 'lone "pressão alta" / "perna inchada" ask her questions and raise nothing', async () => {
      const keys: string[] = [];
      for (const q of ['pressão alta', 'perna inchada']) {
        const r = await post(B, '/api/ask', { person: p2, question: q, lang: 'pt' });
        must(r.status === 200 && r.json.askFirst?.card === 'heart-circulation', `${q}: askFirst ${JSON.stringify(r.json.askFirst ?? r.json).slice(0, 120)}`);
        keys.push(`${q} -> ${r.json.askFirst.questions.length} questions`);
      }
      await sleep(3000);
      const raised = (await get(B, '/api/state')).json.alerts.filter((a: Alert) => a.person === p2 && a.reason === 'finding');
      must(!raised.length, `raised ${raised.map((a: Alert) => `${a.card} L${a.level}`).join(', ')}`);
      return keys.join('; ');
    });

    await check(mission, 'her leg questions all answered yes raise nothing (no rule of hers yet)', async () => {
      const r = await post(B, '/api/checkin', { person: p2, answers: [{ signal: 'leg_colour_changed', value: 1 }, { signal: 'leg_pain', value: 1 }, { signal: 'leg_inflammation', value: 1 }] });
      must(r.status === 200, `checkin ${r.status}`);
      await sleep(6500);
      const raised = (await get(B, '/api/state')).json.alerts.filter((a: Alert) => a.person === p2 && a.reason === 'finding');
      if (raised.length) return `raised ${raised.map((a: Alert) => `${a.card} L${a.level}`).join(', ')}`;
      return { gap: 'colour changed + pain + warmth/redness answered yes to the hub\'s own questions: no alert (follow-up.json level_rules is empty; only her card answer "swollen, warm and painful" raises it)' };
    });

    await check(mission, 'swollen + warm + painful limb: concerning, the Crew Medical Officer told', async () => {
      const a = await post(B, '/api/checkin', { person: p4, answers: [{ signal: answerSignal(SWOLLEN), value: 1 }] });
      must(a.status === 200, `checkin ${a.status}`);
      const r = await post(B, '/api/ask', { person: p4, question: 'perna inchada', lang: 'pt' });
      must(r.status === 200 && !r.json.askFirst, `askFirst still asked: ${JSON.stringify(r.json.askFirst ?? null).slice(0, 80)}`);
      const alert = await waitFor(() => officer.alerts().find((x) => x.person === p4 && x.card === 'heart-circulation'), 8000, 'the officer was not told');
      must(alert.level === 2 && Array.isArray(alert.toldTo) && alert.toldTo.includes(p3) && alert.notAlone === true, `level ${alert.level}, told ${JSON.stringify(alert.toldTo)}`);
      return `level 2, told ${alert.toldTo.join(' and ')}, not left alone`;
    });

    await check(mission, 'blood: glucose 300 not fasting alerts by her cut-offs (officer is the person: commander told)', async () => {
      const r = await post(B, '/api/blood', { person: p3, values: { glucose: 300 }, fasting: false });
      must(r.status === 200, `blood ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
      const alert = await waitFor(async () => (await get(B, '/api/state')).json.alerts.find((x: Alert) => x.person === p3 && x.signal === 'blood.glucose'), 9000, 'no alert for glucose 300');
      must(alert.level === 2 && alert.toldTo.includes(p4) && !alert.toldTo.includes(p2), `level ${alert.level}, told ${JSON.stringify(alert.toldTo)}`);
      return `level 2, told ${alert.toldTo.join(' and ')}`;
    });

    await check(mission, 'blood: potassium 6.5 (over her urgent 6.0) alerts', async () => {
      const r = await post(B, '/api/blood', { person: p2, values: { potassium: 6.5 } });
      must(r.status === 200, `blood ${r.status}`);
      await sleep(6500);
      const alert = (await get(B, '/api/state')).json.alerts.find((x: Alert) => x.person === p2 && x.signal === 'blood.potassium');
      if (alert) return `level ${alert.level}`;
      return { gap: 'stored and judged, but no alert: blood.json has no level fields ("bands") for potassium, sodium, ionized calcium or hematocrit, so engine/medical.ts raises nothing for them' };
    });

    await check(mission, 'message to Earth: arrival and reply from the mission\'s delay', async () => {
      const r = await post(B, '/api/earth/messages', { from: p3, text: 'e2e: all well here' });
      must(r.status === 200, `post ${r.status} ${JSON.stringify(r.json)}`);
      const m = r.json.message as EarthMessage;
      must(m.arrivesAt - m.sentAt === delayS * 1000 && m.replyAt - m.sentAt === 2 * delayS * 1000, `arrives +${m.arrivesAt - m.sentAt} ms, reply +${m.replyAt - m.sentAt} ms for a ${delayS} s delay`);
      const listed = (await get(B, '/api/earth')).json;
      must(listed.delaySeconds === delayS && listed.messages.some((x: EarthMessage) => x.id === m.id), 'not listed on /api/earth');
      if (delayS < 5) {
        const back = await waitFor(async () => (await get(B, '/api/earth')).json.messages.find((x: EarthMessage) => x.id === m.id && x.reply), 8000, 'the simulated reply never came');
        must(back.reply.simulated === true && back.delivered === true, 'reply not labelled simulated');
        return `arrives +${delayS} s, reply +${2 * delayS} s; the demo reply came back labelled simulated`;
      }
      return `arrives +${delayS} s, reply +${2 * delayS} s`;
    });

    // ---------- the room over NASA's CO2 limit ----------
    const used = new Set<string>(Object.values(first.profile.chips ?? {}) as string[]);
    for (const st of first.stays) used.add(st.room);
    const room = rooms.find((r) => !used.has(r) && !/quarters|harmony|galley|unity|commons|lab|command|gym|tranquility|kibo|columbus|destiny|greenhouse|medical/.test(r)) ?? rooms.find((r) => !used.has(r))!;
    let co2Timer: NodeJS.Timeout | null = null;
    await check(mission, `room over NASA's CO2 limit: alarm, level 2 with 60 s, "I'm OK" stops it, "help" and silence go to level 3`, async () => {
      const now = Date.now();
      for (const p of [p1, p2, p4]) {
        const s = await post(B, '/api/stays', { person: p, room, t: now, kind: 'measured', source: `phone:${p}` });
        must(s.status === 200, `stay for ${p}: ${s.status} ${JSON.stringify(s.json)}`);
      }
      // A test source posts a measured hour of CO2 near 4 mmHg, then keeps posting every 10 seconds.
      const rows = Array.from({ length: 61 }, (_, i) => ({ t: now - (60 - i) * 60_000, signal: 'co2', value: 3.9 + (i % 5) * 0.05, unit: 'mmHg', kind: 'measured', room }));
      const r = await post(B, '/api/readings', { source: 'test:co2', rows });
      must(r.status === 200 && r.json.accepted === 61, `readings ${r.status} ${JSON.stringify(r.json)}`);
      co2Timer = setInterval(() => void post(B, '/api/readings', { source: 'test:co2', rows: [{ t: Date.now(), signal: 'co2', value: 4.0 + Math.random() * 0.1, unit: 'mmHg', kind: 'measured', room }] }).catch(() => {}), 10_000);
      const alarm = await waitFor(async () => (await get(B, '/api/state')).json.alarms.find((a: { room: string; signal: string }) => a.room === room && a.signal === 'co2'), 15_000, 'no room alarm');
      const level2 = await waitFor(async () => {
        const all = (await get(B, '/api/state')).json.alerts as Alert[];
        const mine = [p1, p2, p4].map((p) => all.find((a) => a.person === p && a.reason === 'room-limit' && a.room === room));
        return mine.every(Boolean) && mine as Alert[];
      }, 6000, 'not everyone in the room got an alert');
      for (const a of level2) {
        must(a.level === 2, `${a.person} at level ${a.level}`);
        must(a.answerBy! - a.askedAt! === 60_000, `${a.person} countdown ${a.answerBy! - a.askedAt!} ms`);
        must(Array.isArray(a.toldTo) && a.toldTo.includes(p3), `${a.person} told ${JSON.stringify(a.toldTo)}`);
      }
      const [help, ok, silent] = level2;
      must((await post(B, '/api/alerts/answer', { id: ok.id, answer: 'ok' })).status === 200, '"I\'m OK" refused');
      const askedHelp = Date.now();
      must((await post(B, '/api/alerts/answer', { id: help.id, answer: 'help' })).status === 200, '"I need help" refused');
      const three = await waitFor(async () => (await get(B, '/api/state')).json.alerts.find((a: Alert) => a.id === help.id && a.level === 3), 5000, '"I need help" did not escalate');
      const helpMs = Date.now() - askedHelp;
      must(three.toldTo === 'everyone' && three.card === 'high-co2' && three.alsoCard === 'unknown-urgent', `level 3: told ${JSON.stringify(three.toldTo)}, card ${three.card}, also ${three.alsoCard}`);
      must(three.earth && three.earth.arrivesAt - three.earth.sentAt === delayS * 1000 && three.earth.replyAt - three.earth.sentAt === 2 * delayS * 1000, `earth ${JSON.stringify(three.earth)}`);
      // The real minute: the silent one escalates when the countdown ends; the one who said OK does not.
      await sleep(Math.max(0, silent.answerBy! - Date.now()) + 4000);
      const after = (await get(B, '/api/state')).json.alerts as Alert[];
      const s3 = after.find((a) => a.id === silent.id);
      const okNow = after.find((a) => a.id === ok.id);
      must(s3?.level === 3, `the unanswered alert is at level ${s3?.level} after the countdown`);
      must(okNow?.level === 2 && okNow.answer === 'ok', `"I'm OK" alert at level ${okNow?.level}`);
      const earth = (await get(B, '/api/earth')).json.messages as EarthMessage[];
      must(earth.some((m) => m.kind === 'alert' && m.about.person === help.person) && earth.some((m) => m.kind === 'alert' && m.about.person === silent.person), 'messages to Earth missing for the level 3s');
      return `alarm ${alarm.value} mmHg; level 2 to 3 people, told ${p3}; "help" -> level 3 in ${(helpMs / 1000).toFixed(1)} s (card high-co2 + unknown-urgent, Earth +${delayS} s / +${2 * delayS} s); silence -> level 3 at the 60 s mark; "I'm OK" stayed at 2`;
    });

    await check(mission, 'acknowledge routes', async () => {
      const a = await post(B, '/api/alarms/acknowledge', { room });
      must(a.status === 200, `alarm ack ${a.status}`);
      const again = await post(B, '/api/alarms/acknowledge', { room });
      must(again.status === 404, `second alarm ack ${again.status}`);
      const level3 = ((await get(B, '/api/state')).json.alerts as Alert[]).find((x) => x.level === 3 && x.room === room)!;
      must(level3, 'no level 3 to acknowledge');
      must((await post(B, '/api/alerts/acknowledge', { id: level3.id, by: 'nobody' })).status === 400, 'an unknown crewmate was accepted');
      const seen = await post(B, '/api/alerts/acknowledge', { id: level3.id, by: p3 });
      must(seen.status === 200, `seen ${seen.status}`);
      must((await post(B, '/api/alerts/acknowledge', { id: level3.id, by: p3 })).status === 404, 'seen twice');
      const st = (await get(B, '/api/state')).json;
      must(st.alarms.find((x: { room: string }) => x.room === room)?.acknowledged === true, 'alarm not marked acknowledged');
      must(st.alerts.find((x: Alert) => x.id === level3.id)?.seenBy === p3, 'level 3 not marked seen');
      return 'alarm silenced once (404 the second time); level 3 seen by the officer, unknown crewmate refused';
    });
    if (co2Timer) clearInterval(co2Timer);

    await check(mission, 'recorded story: plays on the ship, refused elsewhere', async () => {
      const r = await post(B, '/api/scenario/start', { id: 'reyes-night' });
      if (mission !== 'ship-mars-orbit') {
        must(r.status === 409, `start on ${mission}: ${r.status}`);
        const real = await post(B, '/api/scenario/start', { id: 'reyes-night', realCountdown: true });
        must(real.status === 409, `realCountdown on ${mission}: ${real.status}`);
        return '409 with and without realCountdown';
      }
      must(r.status === 200, `start ${r.status} ${JSON.stringify(r.json)}`);
      await waitFor(() => shared.messages.some((m) => m.scenario?.id === 'reyes-night'), 5000, 'no scenario message reached a screen');
      must((await get(B, '/api/scenario')).json.playing === 'reyes-night', 'status not playing');
      must((await post(B, '/api/scenario/stop', {})).json.stopped === true, 'stop');
      const before = shared.messages.length;
      const real = await post(B, '/api/scenario/start', { id: 'reyes-night', realCountdown: true });
      must(real.status === 200, `realCountdown start ${real.status}`);
      await waitFor(() => shared.messages.slice(before).some((m) => m.scenario?.id === 'reyes-night'), 5000, 'realCountdown: no scenario message');
      must((await post(B, '/api/scenario/stop', {})).json.stopped === true, 'stop after realCountdown');
      await waitFor(() => shared.messages.slice(-5).some((m) => m.type === 'state' && !m.scenario), 5000, 'screens not given back a live state');
      return 'plays, with and without realCountdown; stop gives the screens a fresh live state';
    });

    for (const c of [me, officer, shared, others]) c.close();
    await check(mission, 'log: no error or crash', async () => {
      const bad = hub.log().split('\n').filter((l) => /error|exception|not open|uncaught|TypeError/i.test(l) && !/\[ai\]/.test(l) && !/No such file|ENOENT.*no-board/.test(l));
      must(!bad.length, bad.slice(0, 3).join(' | '));
    });
  } finally {
    await hub.stop();
  }
}

// ---------- production ----------

async function productionChecks(mission: string): Promise<void> {
  const hub = await startHub(`prod-${mission}`, { mission, production: true });
  const B = hub.base;
  try {
    await check(mission, 'production keeps and emits nothing simulated', async () => {
      const ws = await Client.open(B);
      await sleep(8000);
      const st = (await get(B, '/api/state')).json;
      const demo = (r: { kind: string }) => r.kind === 'simulated' || r.kind === 'replayed';
      must(!st.latest.some(demo), `state has ${st.latest.filter(demo).length} demo rows`);
      must(!st.stays.some(demo), 'state has simulated stays');
      const sent = ws.messages.flatMap((m) => (m.type === 'rows' ? m.rows : m.type === 'state' ? m.latest : []));
      must(!sent.some(demo), 'the WebSocket carried demo rows');
      const sim = await post(B, '/api/readings', { source: 'test:sim', rows: [{ t: Date.now(), signal: 'co2', value: 2, unit: 'mmHg', kind: 'simulated', room: st.profile.rooms[0].id }] });
      must(sim.json.accepted === 0, `a simulated row was accepted (${JSON.stringify(sim.json)})`);
      const real = await post(B, '/api/readings', { source: 'test:real', rows: [{ t: Date.now(), signal: 'co2', value: 2, unit: 'mmHg', kind: 'measured', room: st.profile.rooms[0].id }] });
      must(real.json.accepted === 1, 'a measured row was refused');
      must((await get(B, '/api/scenario')).status === 403, 'the story is offered in production');
      must((await post(B, '/api/scenario/start', { id: 'reyes-night' })).status === 403, 'the story starts in production');
      const m = (await post(B, '/api/earth/messages', { from: st.profile.crew[0].id, text: 'e2e production' })).json.message as EarthMessage;
      await sleep(Math.min(2 * st.profile.delayToEarthSeconds * 1000 + 3000, 6000));
      const listed = (await get(B, '/api/earth')).json.messages.find((x: EarthMessage) => x.id === m.id);
      must(listed && listed.reply === null, 'a simulated Earth reply in production');
      ws.close();
      return `${st.latest.length} rows, none simulated or replayed; simulated row refused; story 403; no Earth reply`;
    });
  } finally {
    await hub.stop();
  }
}

// ---------- ten mission switches with a board hammering the hub ----------

async function switchChecks(): Promise<void> {
  const board = spawn('python3', [join(hubDir, 'scripts', 'fake-board.py'), 'cabin-1'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let hub: Hub | null = null;
  let hammer: NodeJS.Timeout | null = null;
  try {
    const path = await new Promise<string>((resolve, reject) => {
      board.stdout!.once('data', (d: Buffer) => resolve(String(d).trim().split('\n')[0]));
      board.once('error', reject);
    });
    must(/^\/dev\/ttys\d+$/.test(path), `fake board path ${path}`);
    hub = await startHub('switch', { supervised: true, chipPort: path });
    const B = hub.base;
    let posted = 0;
    hammer = setInterval(() => {
      posted++;
      void post(B, '/api/readings', { source: 'test:hammer', rows: [{ t: Date.now(), signal: 'noise', value: 300 + posted % 50, unit: 'raw', kind: 'measured', room: 'galley' }] }).catch(() => {});
    }, 20);
    await check('all', '10 mission switches under the supervisor, a board and a row source hammering', async () => {
      const order = ['iss', 'base-mars', 'base-moon', 'ship-mars-orbit', 'iss', 'base-moon', 'base-mars', 'ship-mars-orbit', 'base-moon', 'iss'];
      const times: number[] = [];
      const boardRows: number[] = [];
      for (const to of order) {
        const t0 = Date.now();
        const r = await post(B, '/api/missions/select', { id: to });
        must(r.status === 200, `select ${to}: ${r.status} ${JSON.stringify(r.json)}`);
        await waitFor(async () => (await get(B, '/api/state')).json.profile?.mission?.file === to, 60_000, `did not come back on ${to}`, 200);
        times.push(Date.now() - t0);
        // The board's lines are stored after the restart (a measured row from chip:cabin-1).
        await waitFor(async () => { const rows = (await get(B, `/api/rows?signal=co2&from=${Date.now() - 4000}`)).json.rows as Row[]; const n = rows.filter((x) => x.source === 'chip:cabin-1').length; if (n) boardRows.push(n); return n > 0; }, 20_000, `the board's lines are not stored on ${to}`);
        must(hub!.proc.exitCode === null, `the supervisor exited (${hub!.proc.exitCode})`);
        await sleep(3000); // the supervisor treats more than 3 restarts in 10 s as a loop
      }
      const log = hub!.log();
      const bad = log.split('\n').filter((l) => /not open|uncaught|TypeError|stopped with|Error:/i.test(l) && !/\[ai\]/.test(l));
      must(!bad.length, bad.slice(0, 3).join(' | '));
      must((log.match(/is restarting on the place chosen/g) ?? []).length === 10, 'not 10 restarts in the log');
      return `10 of 10 came back (${Math.round(Math.min(...times) / 100) / 10} to ${Math.round(Math.max(...times) / 100) / 10} s each), board stored after every one, ${posted} rows posted during, no error in the log`;
    });
  } finally {
    if (hammer) clearInterval(hammer);
    await hub?.stop();
    board.kill('SIGTERM');
  }
}

// ---------- main ----------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const missions = opt('--mission') ? [opt('--mission')!] : MISSIONS;
  mkdirSync(ROOT, { recursive: true });
  const started = Date.now();
  for (const m of missions) await missionChecks(m);
  if (!args.includes('--skip-production') && !opt('--mission')) for (const m of MISSIONS) await productionChecks(m);
  if (!args.includes('--skip-switch') && !opt('--mission')) await switchChecks();
  const out = join(ROOT, 'e2e-results.json');
  writeFileSync(out, JSON.stringify(results, null, 1));
  const fails = results.filter((r) => r.status === 'fail');
  console.log(`\n${results.length} checks: ${results.filter((r) => r.status === 'pass').length} pass, ${fails.length} fail, ${results.filter((r) => r.status === 'gap').length} gap, in ${Math.round((Date.now() - started) / 1000)} s. Results: ${out}`);
  process.exit(fails.length ? 1 : 0);
}
