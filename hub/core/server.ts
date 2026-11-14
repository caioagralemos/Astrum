// The hub's local server. Phones, common screens and the hub's own window all
// talk to it: HTTP for questions and for devices posting readings, a WebSocket
// for everything live. It also serves the built interface, so a common screen
// is any browser on the station's network.

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { Store } from './db.ts';
import { rowProblem, FRESH_MS } from '../engine/timeline.ts';
import type { ClientMessage, HubMessage, Kind, Profile, Quality, Rejected, Row, SourceStatus } from '../engine/types.ts';
import { KINDS, isDemoOnly } from '../engine/types.ts';
import type { RoomAlarm, Unjudged } from '../engine/cabin.ts';
import { boardSounds } from '../engine/alerts.ts';
import type { Alert, EarthMessage } from '../engine/alerts.ts';
import { impossible } from '../engine/quality.ts';
import type { Stuck } from '../engine/quality.ts';
import { checkinRows } from '../engine/checkin.ts';
import { occupants } from '../engine/timeline.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary',
  '.mp4': 'video/mp4', '.ico': 'image/x-icon',
};

const MAX_BODY = 2_000_000;
/** The source name of the hub's own stand-in values (core/standin.ts). */
export const STAND_IN = 'sim:hub';
/** How far back the first screenful looks for each signal's newest reading. */
const STATE_WINDOW_MS = 24 * 3600_000;
/** How often the hub tells screens its clock, so they can follow it. */
export const CLOCK_EVERY_MS = 10_000;

export class Hub {
  readonly http: Server;
  private wss: WebSocketServer;
  private sources = new Map<string, SourceStatus>();
  private store: Store;
  private profile: Profile;
  private uiDir: string;
  /** In production the hub keeps no simulated value, whatever sends it. */
  private production: boolean;

  constructor(store: Store, profile: Profile, uiDir: string, production = false) {
    this.production = production;
    this.store = store;
    this.profile = profile;
    this.uiDir = uiDir;
    this.http = createServer((req, res) => void this.onRequest(req, res).catch(() => send(res, 500, { error: 'hub error' })));
    this.wss = new WebSocketServer({ server: this.http, path: '/ws', maxPayload: MAX_BODY });
    this.wss.on('connection', (socket) => this.onSocket(socket));
    // The socket server repeats the HTTP server's errors; main.ts handles those there.
    this.wss.on('error', () => {});
  }

  /** Extra API routes, each returning true when it handled the request. */
  routes: ((req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>)[] = [];

  private alerts: Alert[] = [];
  /** Set by the alert watcher: records an answer to "Are you OK?". */
  answerAlert: (id: string, answer: 'ok' | 'help') => boolean = () => false;
  /** Set by the alert watcher: "I've seen it" on a level 3, from anyone (a crew id, or null from a shared screen). */
  seeAlert: (id: string, by: string | null) => boolean = () => false;

  setAlerts(alerts: Alert[]): void {
    this.alerts = alerts;
    this.broadcast({ type: 'alerts', alerts });
    this.soundBoard();
  }

  private earthMessages: EarthMessage[] = [];

  /** Messages to Earth, kept apart from the alerts so they outlive them. */
  setEarthMessages(earthMessages: EarthMessage[]): void {
    if (JSON.stringify(earthMessages) === JSON.stringify(this.earthMessages)) return;
    this.earthMessages = earthMessages;
    this.broadcast({ type: 'earth', earthMessages });
  }

  private asleep: string[] = [];

  /** Crew ids asleep now. Screens draw them asleep from this, not from their own clock. */
  setAsleep(asleep: string[]): void {
    if (JSON.stringify(asleep) === JSON.stringify(this.asleep)) return;
    this.asleep = asleep;
    this.broadcast({ type: 'asleep', asleep });
  }

  private clockTimer: NodeJS.Timeout | null = null;

  /** Tells every screen the hub's clock every 10 seconds. */
  startClock(): void {
    this.stopClock();
    this.clockTimer = setInterval(() => this.broadcast({ type: 'clock', now: Date.now() }), CLOCK_EVERY_MS);
  }

  stopClock(): void {
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
  }

  private alarms: RoomAlarm[] = [];
  private unjudged: Unjudged[] = [];
  private stuck: Stuck[] = [];
  /** Set by the alarm watcher: silences one room's buzzer. */
  acknowledgeAlarm: (room: string) => boolean = () => false;

  setAlarms(alarms: RoomAlarm[], unjudged: Unjudged[] = this.unjudged, stuck: Stuck[] = this.stuck): void {
    this.alarms = alarms;
    this.unjudged = unjudged;
    this.stuck = stuck;
    this.broadcast({ type: 'alarms', alarms, unjudged, stuck });
    this.soundBoard();
  }

  /** The rooms that have a sensor board, from the profile. */
  private boardRooms(): string[] {
    return [...new Set(Object.values(this.profile.chips))];
  }

  private sounding = false;

  /**
   * The only place that decides whether the board sounds (the rule is
   * engine/alerts.ts boardSounds). It looks at what the screens are shown:
   * the live alarms and alerts, or a playing scenario's.
   */
  soundBoard(): void {
    const shown = this.scenarioState?.();
    const [alarms, alerts] = shown?.type === 'state' ? [shown.alarms, shown.alerts] : [this.alarms, this.alerts];
    const should = boardSounds(this.boardRooms(), alarms, alerts);
    if (should === this.sounding) return;
    this.sounding = should;
    this.buzz(should ? 'alarm' : 'off');
  }

  /** Readings refused at the door because no working sensor could give them, counted by source, signal and bound. */
  private rejected = new Map<string, Rejected>();

  /** Everything the hub knows is wrong with its readings. */
  quality(): Quality {
    return { rejected: [...this.rejected.values()], unjudged: this.unjudged, stuck: this.stuck };
  }

  /** Drops impossible rows and counts each one. Returns the rest. */
  private refuseImpossible(rows: Row[]): Row[] {
    const kept: Row[] = [];
    for (const row of rows) {
      const bound = impossible(row);
      if (!bound) { kept.push(row); continue; }
      const key = `${row.source}|${row.signal}|${row.unit}`;
      const held = this.rejected.get(key);
      this.rejected.set(key, { source: row.source, signal: row.signal, unit: row.unit, min: bound.min, max: bound.max, count: (held?.count ?? 0) + 1, lastValue: row.value!, lastAt: row.t });
    }
    return kept;
  }

  /** Set by whoever owns the chip: sends it one command, returns false if no chip is connected. */
  chipCommand: (command: Record<string, unknown>) => boolean = () => false;
  private alarmTimer: NodeJS.Timeout | null = null;

  /**
   * Sounds the chip's buzzer. "beep" is one short beep. "alarm" repeats until
   * "off": the chip stops by itself after 60 seconds as a safeguard, so the
   * hub sends it again every 20.
   */
  buzz(mode: 'beep' | 'alarm' | 'off'): boolean {
    if (this.alarmTimer) clearInterval(this.alarmTimer);
    this.alarmTimer = null;
    const sent = this.chipCommand({ buzz: mode });
    if (mode === 'alarm' && sent) this.alarmTimer = setInterval(() => this.chipCommand({ buzz: 'alarm' }), 20_000);
    return sent;
  }

  /** When each room's signal last arrived from a source other than the stand-in simulator. */
  private heard = new Map<string, number>();

  /** True if some real or replayed source gave this room's signal in the last few seconds. */
  hasSource(room: string, signal: string, now: number, withinMs = 5000): boolean {
    return now - (this.heard.get(`${room}|${signal}`) ?? 0) <= withinMs;
  }

  /** Takes rows from any source, stores them and tells everyone connected. */
  ingest(rows: Row[]): Row[] {
    if (this.production) rows = rows.filter((r) => !isDemoOnly(r.kind));
    rows = this.refuseImpossible(rows);
    if (!rows.length) return [];
    for (const r of rows) if (r.room && !r.person && r.source !== STAND_IN) this.heard.set(`${r.room}|${r.signal}`, r.t);
    const saved = this.store.addRows(rows);
    this.broadcast({ type: 'rows', rows: saved });
    return saved;
  }

  move(person: string, room: string, t: number, kind: Kind, source: string): void {
    if (this.production && isDemoOnly(kind)) return;
    const changed = this.store.moveTo(person, room, t, kind, source);
    if (changed.length) this.broadcast({ type: 'stay', stays: changed });
  }

  setSource(status: SourceStatus): void {
    const before = JSON.stringify(this.sources.get(status.id));
    this.sources.set(status.id, status);
    // lastSeen changes every second; only tell screens when something else did.
    const strip = (s: string | undefined) => s?.replace(/"lastSeen":\d+/, '');
    if (strip(before) !== strip(JSON.stringify(status))) this.broadcast({ type: 'sources', sources: [...this.sources.values()] });
  }

  state(now = Date.now()): HubMessage {
    return {
      type: 'state',
      now,
      profile: this.profile,
      latest: this.store.recent(now - STATE_WINDOW_MS),
      stays: this.store.stays(now - FRESH_MS, now),
      sources: [...this.sources.values()],
      alarms: this.alarms,
      alerts: this.alerts,
      quality: this.quality(),
      asleep: this.asleep,
      earthMessages: this.earthMessages,
    };
  }

  /** Hears every message the hub broadcasts (the scenario recorder listens here). */
  onBroadcast: (message: HubMessage) => void = () => {};

  /** While a scenario plays: what a screen that connects is sent first. Null when live. */
  private scenarioState: (() => HubMessage) | null = null;

  /**
   * A scenario takes the screens and phones: until it gives them back, the
   * hub's own live messages are dropped (not queued; the fresh state sent at
   * the end brings every screen up to date). Nothing is stored either way.
   */
  takeScreens(firstMessage: () => HubMessage): void {
    this.scenarioState = firstMessage;
    this.soundBoard();
  }

  /** Gives the screens back to the live hub, with a fresh live state. */
  releaseScreens(now = Date.now()): void {
    this.scenarioState = null;
    this.sendToScreens(this.state(now));
    this.soundBoard();
  }

  /** Sends one message to every screen and phone, whoever holds them. */
  sendToScreens(message: HubMessage): void {
    const text = JSON.stringify(message);
    for (const client of this.wss.clients) if (client.readyState === 1) client.send(text);
  }

  private broadcast(message: HubMessage): void {
    this.onBroadcast(message);
    if (!this.scenarioState) this.sendToScreens(message);
  }

  private onSocket(socket: WebSocket): void {
    socket.send(JSON.stringify(this.scenarioState ? this.scenarioState() : this.state()));
    socket.on('message', (data) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (msg?.type === 'readings') {
        const result = this.acceptReadings(msg);
        if ('error' in result) socket.send(JSON.stringify({ type: 'error', error: result.error }));
      }
    });
    socket.on('error', () => socket.terminate());
  }

  /** The one door for readings from outside: phones, scripts, other devices. */
  private acceptReadings(body: unknown): { accepted: number; rejected?: number } | { error: string } {
    const b = body as { source?: unknown; rows?: unknown };
    if (typeof b?.source !== 'string' || !/^[a-z0-9:._-]{1,64}$/.test(b.source)) return { error: 'source must be a short id like "phone:reyes"' };
    if (!Array.isArray(b.rows) || b.rows.length > 5000) return { error: 'rows must be a list of at most 5000' };
    const rows: Row[] = [];
    for (const [i, raw] of b.rows.entries()) {
      const problem = rowProblem(raw);
      if (problem) return { error: `row ${i}: ${problem}` };
      const r = raw as Row;
      rows.push({ t: r.t, signal: r.signal, value: r.value, text: r.text ?? null, unit: r.unit, kind: r.kind, source: b.source, person: r.person ?? null, room: r.room ?? null });
    }
    const refused = rows.filter((r) => impossible(r)).length;
    const accepted = this.ingest(rows).length;
    return refused ? { accepted, rejected: refused } : { accepted };
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://hub');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();

    if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, this.state());

    if (url.pathname === '/api/rows' && req.method === 'GET') {
      const num = (k: string) => (url.searchParams.has(k) ? Number(url.searchParams.get(k)) : undefined);
      return send(res, 200, {
        rows: this.store.rows({
          signal: url.searchParams.get('signal') ?? undefined,
          person: url.searchParams.get('person') ?? undefined,
          room: url.searchParams.get('room') ?? undefined,
          from: num('from'), to: num('to'), limit: num('limit'),
        }),
      });
    }

    if (url.pathname === '/api/stays' && req.method === 'GET') {
      const now = Date.now();
      const from = Number(url.searchParams.get('from') ?? now - 24 * 3600_000);
      const to = Number(url.searchParams.get('to') ?? now);
      return send(res, 200, { stays: this.store.stays(from, to, url.searchParams.get('person') ?? undefined) });
    }

    if (url.pathname === '/api/readings' && req.method === 'POST') {
      const body = await readJson(req);
      if (body === undefined) return send(res, 400, { error: 'body must be JSON under 2 MB' });
      const result = this.acceptReadings(body);
      return send(res, 'error' in result ? 400 : 200, result);
    }

    if (url.pathname === '/api/checkin' && req.method === 'POST') {
      const body = await readJson(req);
      if (body === undefined) return send(res, 400, { error: 'body must be JSON under 2 MB' });
      const now = Date.now();
      const here = occupants(this.store.stays(now, now), now);
      const roomOf = (person: string) => Object.entries(here).find(([, people]) => people.includes(person))?.[0] ?? null;
      const result = checkinRows(body, this.profile.crew.map((p) => p.id), now, roomOf);
      if ('error' in result) return send(res, 400, result);
      return send(res, 200, { accepted: this.ingest(result.rows).length });
    }

    if (url.pathname === '/api/quality' && req.method === 'GET') return send(res, 200, this.quality());

    if (url.pathname === '/api/alerts/answer' && req.method === 'POST') {
      const b = (await readJson(req)) as { id?: string; answer?: string } | undefined;
      if (typeof b?.id !== 'string' || (b.answer !== 'ok' && b.answer !== 'help')) return send(res, 400, { error: 'needs an alert id and an answer of ok or help' });
      return this.answerAlert(b.id, b.answer) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'no question waiting on that alert' });
    }

    if (url.pathname === '/api/alerts/acknowledge' && req.method === 'POST') {
      const b = (await readJson(req)) as { id?: string; by?: string } | undefined;
      if (typeof b?.id !== 'string') return send(res, 400, { error: 'needs an alert id' });
      if (b.by !== undefined && !this.profile.crew.some((p) => p.id === b.by)) return send(res, 400, { error: 'by must be a crew id, or left out on a shared screen' });
      return this.seeAlert(b.id, b.by ?? null) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'no level 3 alert waiting to be seen with that id' });
    }

    if (url.pathname === '/api/alarms/acknowledge' && req.method === 'POST') {
      const b = (await readJson(req)) as { room?: string } | undefined;
      if (typeof b?.room !== 'string') return send(res, 400, { error: 'needs a room' });
      return this.acknowledgeAlarm(b.room) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'no alarm to acknowledge in that room' });
    }

    if (url.pathname === '/api/buzz' && req.method === 'POST') {
      const b = (await readJson(req)) as { mode?: string } | undefined;
      if (b?.mode !== 'beep' && b?.mode !== 'alarm' && b?.mode !== 'off') return send(res, 400, { error: 'mode must be beep, alarm or off' });
      return this.buzz(b.mode) ? send(res, 200, { ok: true }) : send(res, 503, { error: 'no chip connected' });
    }

    if (url.pathname === '/api/stays' && req.method === 'POST') {
      const b = (await readJson(req)) as { person?: string; room?: string; t?: number; kind?: Kind; source?: string } | undefined;
      const known = b && this.profile.crew.some((p) => p.id === b.person) && this.profile.rooms.some((r) => r.id === b.room);
      if (!b || !known || typeof b.t !== 'number' || !KINDS.includes(b.kind as Kind) || typeof b.source !== 'string') {
        return send(res, 400, { error: 'needs a known person and room, t, kind and source' });
      }
      this.move(b.person!, b.room!, b.t, b.kind!, b.source);
      return send(res, 200, { ok: true });
    }

    for (const route of this.routes) if (await route(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    return this.serveFile(url.pathname, res);
  }

  private async serveFile(pathname: string, res: ServerResponse): Promise<void> {
    const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(this.uiDir, clean === '/' || !extname(clean) ? 'index.html' : clean);
    if (!file.startsWith(this.uiDir)) return send(res, 403, { error: 'forbidden' });
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(data);
    } catch {
      send(res, 404, { error: 'The interface is not built yet. Run "npm run build" in hub/, or use "npm run dev".' });
    }
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) return undefined;
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}
