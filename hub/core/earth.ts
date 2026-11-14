// Contact Earth: messages a crewmate writes by hand (engine/earth.ts), kept
// beside the ones level 3 alerts send, and GET /api/earth with
// POST /api/earth/messages.
//
// Each message is stored as one "reported" row, so it survives a restart, and
// it is listed for 24 hours. Its words go nowhere else: not to the model, not
// to the console.
//
// Demo mode only: when a message's reply time passes, it gets the fixed
// simulated reply. In production `simulatedReply` is null, and nothing is
// ever scheduled to make one.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EarthMessage } from '../engine/alerts.ts';
import { CREW_KEEP_MS, EARTH_SIGNAL, crewMessage, crewMessageRow, crewMessagesFromRows, messageProblem, stepCrewMessages, withSimulatedReply } from '../engine/earth.ts';
import type { Store } from './db.ts';

export interface EarthMailOptions {
  store: Store;
  /** The place's one-way delay to Earth. */
  delayMs: number;
  /** The fixed reply text, demo mode only. Null in production: no reply is ever made. */
  simulatedReply: string | null;
  clock?: () => number;
}

export class EarthMail {
  private messages: EarthMessage[] = [];
  private timers = new Map<string, NodeJS.Timeout>();
  private store: Store;
  private delayMs: number;
  private simulatedReply: string | null;
  private clock: () => number;
  /** Called when the list changes between the alert watcher's looks (a new message, a reply). */
  onChange: () => void = () => {};

  constructor(options: EarthMailOptions) {
    this.store = options.store;
    this.delayMs = options.delayMs;
    this.simulatedReply = options.simulatedReply;
    this.clock = options.clock ?? Date.now;
  }

  /** Reads back the messages of the last 24 hours from their stored rows. */
  load(now = this.clock()): void {
    const rows = this.store.rows({ signal: EARTH_SIGNAL, from: now - CREW_KEEP_MS, to: now, limit: 5000 });
    this.messages = crewMessagesFromRows(rows, this.delayMs, now);
    for (const m of this.messages) this.scheduleReply(m);
  }

  /** Stores and lists one message. The caller has checked the body (messageProblem). */
  post(from: string, text: string, now = this.clock()): EarthMessage {
    const message = crewMessage(from, text.trim(), now, this.delayMs, now);
    this.store.addRows([crewMessageRow(message)]);
    this.messages = [...this.messages.filter((m) => m.id !== message.id), message];
    this.scheduleReply(message);
    this.onChange();
    return message;
  }

  /** The crew messages still listed, with what has reached Earth by now. */
  list(now = this.clock()): EarthMessage[] {
    this.messages = stepCrewMessages(this.messages, now);
    return this.messages;
  }

  /** How many simulated replies are waiting to be made. Always 0 in production. */
  pendingReplies(): number {
    return this.timers.size;
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Demo mode only: the fixed reply, made when the reply time passes. */
  private scheduleReply(message: EarthMessage): void {
    const text = this.simulatedReply;
    if (text === null || message.reply || this.timers.has(message.id)) return;
    const timer = setTimeout(() => {
      this.timers.delete(message.id);
      this.messages = this.messages.map((m) => (m.id === message.id ? withSimulatedReply(m, text) : m));
      this.onChange();
    }, Math.max(0, message.replyAt - this.clock()));
    this.timers.set(message.id, timer);
  }
}

export interface EarthRouteContext {
  mail: EarthMail;
  crew: string[];
  delaySeconds: number;
  /** Every message to Earth listed now, alert and crew alike, as the screens get them. */
  messages: () => EarthMessage[];
}

/** GET /api/earth and POST /api/earth/messages, for Hub.routes. */
export function earthRoute(ctx: EarthRouteContext) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== '/api/earth' && url.pathname !== '/api/earth/messages') return false;
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return true;
    };
    if (url.pathname === '/api/earth') {
      if (req.method !== 'GET') return json(405, { error: 'method not allowed' });
      return json(200, { delaySeconds: ctx.delaySeconds, messages: ctx.messages() });
    }
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
    const body = await readJson(req);
    const problem = messageProblem(body, ctx.crew);
    if (problem) return json(400, { error: problem });
    const b = body as { from: string; text: string };
    return json(200, { message: ctx.mail.post(b.from, b.text) });
  };
}

const MAX_BODY = 20_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return undefined;
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}
