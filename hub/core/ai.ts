// The local AI on the hub: the llama-server sidecar, one question at a time,
// and POST /api/ask. The prompts and every check live in engine/prompt.ts;
// the cards and how one is picked in engine/cards.ts. Spec: AI-CORE-SPEC.md.
//
// Nothing leaves the machine: the only requests are to llama-server on
// 127.0.0.1. Nothing the crew types is written to disk or to the console.
//
// If the model file or the server binary is missing, or the port is held by a
// program this file can't identify as its own llama-server, the hub runs on
// and /api/ask answers plainly that the AI is not available.
//
// POST /api/ask streams newline-delimited JSON (application/x-ndjson), one
// object per line:
//   {"type":"status","state":"queued","position":1}   while another question runs
//   {"type":"status","state":"thinking","ms":1000}     about once a second while the model works
//   {"type":"result", ...AskResult}                    always last, exactly once
// The model's words are never streamed: the whole answer is checked first.

import { spawn, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  agreesWithDanger, buildMessages, buildUrgentMessages, buildUserMessage, checkAnswer, dangerCheck, FIXED_TEXTS, parseUrgentLabel, readingLine,
  readingsBlock, screenInput, URGENT_FORMAT,
} from '../engine/prompt.ts';
import { asksAdviceOrDiagnosis, asksAmountOrTreatment, composeAnswer, evidenceLines, maxHourAverage, namesTreatment } from '../engine/answer.ts';
import type { Who } from '../engine/answer.ts';
import { LIMITS } from '../engine/cabin.ts';
import type { HubAnswer } from '../engine/answer.ts';
import type { Evidence } from '../engine/evidence.ts';
import type { ChatMessage, CheckResult, PersonReadings, PromptPassage, Reading, ReadingLabel } from '../engine/prompt.ts';
import { cardView, pickCard } from '../engine/cards.ts';
import type { CardLang, CardView, Facts, ParsedCards } from '../engine/cards.ts';
import { search } from '../engine/search.ts';
import { CARD_FINDING_KEEP_MS, FOLLOW_UP_QUESTION, FOLLOW_UP_SIGNAL, cardFinding } from '../engine/medical.ts';
import type { LevelOverride } from '../engine/medical.ts';
import { askFirstFinding, pickWithFollowUp } from '../engine/followup.ts';
import type { AskFirst, FollowUpRow, Given } from '../engine/followup.ts';
import { t } from '../engine/strings.ts';
import type { Finding } from '../engine/alerts.ts';
import type { SearchIndex } from '../engine/search.ts';

/** llama-server's port. Two hubs on one computer need two ports: set ASTRUM_LLAMA_PORT. */
export const AI_PORT = Number(process.env.ASTRUM_LLAMA_PORT) || 18431;
export const DEFAULT_MODEL = join(homedir(), 'Desktop', 'NASA', 'astrum-model-test', 'gguf', 'LFM3-1.7B-Q8_0.gguf');
/** Homebrew's build on Apple Silicon, then Intel. Set ASTRUM_LLAMA to use another. */
export const DEFAULT_LLAMA = ['/opt/homebrew/bin/llama-server', '/usr/local/bin/llama-server'].find((p) => existsSync(p)) ?? '/opt/homebrew/bin/llama-server';

/** llama-server's flags: 8192 tokens of context over 2 slots, thinking off, temperature 0. Settings first chosen in the 9 Nov planning tests. */
export function serverArgs(model: string, port: number): string[] {
  return ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-c', '8192', '-np', '2', '--reasoning-budget', '0', '--temp', '0', '--no-webui'];
}

/** The crew gets the fallback when the first word takes longer than 8 s or the whole answer longer than 25 s. */
export const FIRST_TOKEN_MS = 8_000;
export const ANSWER_MS = 25_000;
const URGENT_MS = 8_000;
const READY_MS = 180_000;
const MAX_QUEUE = 8;
const MAX_RESTARTS = 4;
/** How often a ready server is checked, and how many missed checks in a row mean it is gone. */
const WATCH_MS = 2000;
const WATCH_MISSES = 2;

// ---------- the model behind a small interface ----------

export interface ChatRequest {
  messages: ChatMessage[];
  maxTokens: number;
  /** A JSON schema the answer must follow (the urgent check). */
  responseFormat?: unknown;
  signal?: AbortSignal;
  firstTokenMs?: number;
  totalMs?: number;
  /** Hears how long the server took, once the answer is complete. */
  onTimings?: (t: ChatTimings) => void;
}

/** What llama-server reports about one answer. No text in here. */
export interface ChatTimings {
  firstWordMs: number | null;
  promptTokens: number | null;
  cachedTokens: number | null;
  promptMs: number | null;
  answerTokens: number | null;
}

export class AiTimeout extends Error {
  readonly which: 'first-token' | 'total';
  constructor(which: 'first-token' | 'total') {
    super(which === 'first-token' ? 'no first word in time' : 'no full answer in time');
    this.which = which;
  }
}

export interface ModelClient {
  /** ok: ready. loading: the server is up and loading the model. down: nothing answers. other: something else answers. */
  health(): Promise<'ok' | 'loading' | 'down' | 'other'>;
  /** What the server says about itself, or null if it isn't a llama-server. */
  props(): Promise<{ modelPath: string | null } | null>;
  chat(req: ChatRequest): Promise<string>;
}

/** llama-server's OpenAI-style API on 127.0.0.1. */
export class LlamaClient implements ModelClient {
  readonly base: string;
  constructor(port: number) {
    this.base = `http://127.0.0.1:${port}`;
  }

  async health(): Promise<'ok' | 'loading' | 'down' | 'other'> {
    try {
      const res = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(1500) });
      const body = await res.text();
      if (res.status === 200 && /"status"\s*:\s*"ok"/.test(body)) return 'ok';
      if (res.status === 503 && /loading/i.test(body)) return 'loading';
      return 'other';
    } catch {
      return 'down';
    }
  }

  async props(): Promise<{ modelPath: string | null } | null> {
    try {
      const res = await fetch(`${this.base}/props`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return null;
      const body = (await res.json()) as Record<string, unknown>;
      if (!body || typeof body !== 'object' || !('default_generation_settings' in body || 'build_info' in body)) return null;
      return { modelPath: typeof body.model_path === 'string' ? body.model_path : null };
    } catch {
      return null;
    }
  }

  async chat(req: ChatRequest): Promise<string> {
    const stop = new AbortController();
    const onAbort = () => stop.abort();
    req.signal?.addEventListener('abort', onAbort);
    let timedOut: AiTimeout | null = null;
    const fail = (which: 'first-token' | 'total') => { timedOut = new AiTimeout(which); stop.abort(); };
    const first = setTimeout(() => fail('first-token'), req.firstTokenMs ?? FIRST_TOKEN_MS);
    const total = setTimeout(() => fail('total'), req.totalMs ?? ANSWER_MS);
    try {
      const res = await fetch(`${this.base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: stop.signal,
        body: JSON.stringify({
          messages: req.messages, max_tokens: req.maxTokens, temperature: 0, stream: true, cache_prompt: true,
          chat_template_kwargs: { enable_thinking: false },
          ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`the model server answered ${res.status}`);
      const sent = Date.now();
      let firstWordMs: number | null = null;
      let timings: Record<string, number> | null = null;
      let text = '';
      let buffer = '';
      const decoder = new TextDecoder();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const msg = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; timings?: Record<string, number> };
            const delta = msg.choices?.[0]?.delta?.content;
            if (delta) {
              text += delta;
              clearTimeout(first);
              if (firstWordMs === null) firstWordMs = Date.now() - sent;
            }
            if (msg.timings) timings = msg.timings;
          } catch { /* a line that isn't JSON is skipped */ }
        }
      }
      req.onTimings?.({
        firstWordMs, promptTokens: timings?.prompt_n ?? null, cachedTokens: timings?.cache_n ?? null,
        promptMs: timings?.prompt_ms ? Math.round(timings.prompt_ms) : null, answerTokens: timings?.predicted_n ?? null,
      });
      return text;
    } catch (err) {
      if (timedOut) throw timedOut;
      throw err;
    } finally {
      clearTimeout(first);
      clearTimeout(total);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }
}

// ---------- the runtime ----------

export type AiState = 'loading' | 'ready' | 'unavailable';

export interface AiOptions {
  model?: string;
  binary?: string;
  port?: number;
  /** For tests: a stand-in for the server. With it, no process is started. */
  client?: ModelClient;
  /** Where the PID of the server this hub started is kept, so the next run can recognise it. */
  pidFile?: string;
  readyMs?: number;
  /** Fill the server's prompt cache once it is ready. Default true. */
  warm?: boolean;
  firstTokenMs?: number;
  answerMs?: number;
  /** How often a ready server is checked. */
  watchMs?: number;
  /** Where runtime events and timings go (never question text). Default: the console. */
  log?: (line: string) => void;
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 3000 }, (err, out) => resolve(err ? '' : String(out))));
}

/** The PID listening on the port and its program name, where the system can tell (macOS, Linux). */
async function listener(port: number): Promise<{ pid: number; name: string } | null> {
  if (process.platform === 'win32') return null;
  const pid = Number((await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])).trim().split('\n')[0]);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const name = (await run('ps', ['-p', String(pid), '-o', 'comm='])).trim();
  return { pid, name: basename(name) };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class AiRuntime {
  state: AiState = 'loading';
  /** Why the AI is not ready, in plain words. Kept true at every moment by the watcher. */
  reason: string | null = 'starting';
  readonly client: ModelClient;
  readonly model: string;
  readonly binary: string;
  readonly port: number;
  readonly firstTokenMs: number;
  readonly answerMs: number;
  private manage: boolean;
  private pidFile: string;
  private readyMs: number;
  private warmUp: boolean;
  private watchMs: number;
  private child: ChildProcess | null = null;
  private stopping = false;
  private booting = false;
  private restarts = 0;
  private misses = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private watcher: NodeJS.Timeout | null = null;
  private stderrTail: string[] = [];
  private queue: { run: () => Promise<void>; reject: (err: Error) => void }[] = [];
  private busy = false;
  private log: (line: string) => void;

  constructor(opts: AiOptions = {}) {
    this.port = opts.port ?? AI_PORT;
    this.model = opts.model ?? process.env.ASTRUM_MODEL ?? DEFAULT_MODEL;
    this.binary = opts.binary ?? process.env.ASTRUM_LLAMA ?? DEFAULT_LLAMA;
    this.client = opts.client ?? new LlamaClient(this.port);
    this.manage = !opts.client;
    this.pidFile = opts.pidFile ?? join(tmpdir(), `astrum-llama-${this.port}.pid`);
    this.readyMs = opts.readyMs ?? READY_MS;
    this.warmUp = opts.warm ?? true;
    this.watchMs = opts.watchMs ?? WATCH_MS;
    this.firstTokenMs = opts.firstTokenMs ?? FIRST_TOKEN_MS;
    this.answerMs = opts.answerMs ?? ANSWER_MS;
    this.log = opts.log ?? ((line) => console.log(`[ai] ${line}`));
  }

  private off(reason: string): void {
    this.state = 'unavailable';
    this.reason = reason;
    this.log(`unavailable: ${reason}`);
  }

  /** Starts (or adopts) the server and keeps watching it. Never throws: a problem leaves the AI off and says why. */
  async start(): Promise<void> {
    this.stopping = false;
    if (!this.watcher) {
      this.watcher = setInterval(() => void this.watch(), this.watchMs);
      this.watcher.unref();
    }
    await this.boot();
  }

  private async boot(): Promise<void> {
    if (this.booting || this.stopping) return;
    this.booting = true;
    this.state = 'loading';
    this.reason = 'starting the model server';
    try {
      if (!this.manage) return await this.waitReady(null);
      if (!existsSync(this.model)) return this.off(`the model file is missing (${basename(this.model)})`);
      if (!existsSync(this.binary)) return this.off('the llama-server program is missing');
      if (await portInUse(this.port)) {
        const next = await this.adoptOrReplace();
        if (next !== 'replaced') return;
      }
      await this.spawnServer();
    } catch (err) {
      this.retry(`could not start: ${(err as Error).message}`);
    } finally {
      this.booting = false;
    }
  }

  /**
   * Something already listens on the port.
   *   - A llama-server this hub started in an earlier run (the PID file and the
   *     process name both say so) is replaced, never reused: it may be in the
   *     middle of being stopped by that run.
   *   - Someone else's llama-server with this model is reused, and watched.
   *   - Anything else is left alone, and the AI stays off.
   */
  private async adoptOrReplace(): Promise<'adopted' | 'replaced' | 'refused'> {
    const who = await listener(this.port);
    let savedPid = 0;
    try { savedPid = Number(readFileSync(this.pidFile, 'utf8').trim()); } catch { /* no earlier run */ }
    if (who && who.pid === savedPid && /llama-server/.test(who.name)) {
      this.log(`replacing the llama-server an earlier run left on port ${this.port}`);
      try { process.kill(who.pid, 'SIGTERM'); } catch { /* already gone */ }
      for (let i = 0; i < 40 && (await portInUse(this.port)); i++) await sleep(250);
      if (await portInUse(this.port)) {
        this.retry(`the old llama-server on port ${this.port} did not stop`);
        return 'refused';
      }
      return 'replaced';
    }
    const props = await this.client.props();
    if (!props) {
      this.retry(`port ${this.port} is used by another program`);
      return 'refused';
    }
    if (props.modelPath && basename(props.modelPath) === basename(this.model)) {
      this.log(`reusing a llama-server already on port ${this.port}`);
      await this.waitReady(null);
      return 'adopted';
    }
    this.off(`another llama-server with a different model is on port ${this.port}; it was left running`);
    return 'refused';
  }

  private async spawnServer(): Promise<void> {
    this.state = 'loading';
    this.reason = 'loading the model';
    this.stderrTail = [];
    const t0 = Date.now();
    const child = spawn(this.binary, serverArgs(this.model, this.port), { stdio: ['ignore', 'ignore', 'pipe'] });
    this.child = child;
    // The server's own log, kept in memory only until it is ready, to explain a failed start.
    child.stderr?.on('data', (d: Buffer) => {
      if (this.state === 'ready') return;
      this.stderrTail.push(...String(d).split('\n').filter(Boolean));
      this.stderrTail = this.stderrTail.slice(-8);
    });
    child.once('error', (err) => {
      if (this.child !== child) return;
      this.child = null;
      this.retry(`could not start llama-server: ${err.message}`);
    });
    child.once('exit', (code) => this.onExit(child, code));
    if (child.pid) writeFileSync(this.pidFile, String(child.pid));
    this.log(`started llama-server (pid ${child.pid}) on port ${this.port}`);
    await this.waitReady(child);
    if ((this.state as AiState) === 'ready') this.log(`ready ${Date.now() - t0} ms after start`);
  }

  private onExit(child: ChildProcess, code: number | null): void {
    if (this.child !== child) return;
    this.child = null;
    try { rmSync(this.pidFile, { force: true }); } catch { /* nothing to remove */ }
    if (this.stopping) return;
    const last = this.stderrTail.slice(-2).join(' ').slice(0, 300);
    this.retry(`llama-server stopped (code ${code})${last ? `: ${last}` : ''}`);
  }

  /** If the server dies, restart it, with a growing wait, a few times. The fallback is served meanwhile. */
  private retry(reason: string): void {
    if (this.stopping) return;
    if (this.restartTimer) return;
    if (this.restarts >= MAX_RESTARTS) return this.off(`${reason}; gave up after ${MAX_RESTARTS} restarts`);
    const wait = 1000 * 2 ** this.restarts;
    this.restarts++;
    this.state = 'loading';
    this.reason = `${reason}; restarting (attempt ${this.restarts} of ${MAX_RESTARTS})`;
    this.log(this.reason);
    this.restartTimer = setTimeout(() => { this.restartTimer = null; void this.boot(); }, wait);
  }

  /** The server is gone or not answering. Ours is stopped (its exit restarts it); anything else is retried. */
  private lost(reason: string): void {
    if (this.stopping || this.state !== 'ready') return;
    this.state = 'loading';
    this.reason = reason;
    this.misses = 0;
    const child = this.child;
    if (child && child.exitCode === null) {
      this.log(`${reason}; stopping pid ${child.pid} to restart it`);
      child.kill('SIGKILL');
    } else {
      this.child = null;
      this.retry(reason);
    }
  }

  /** The watcher: a ready server that misses two health checks in a row is treated as gone. */
  private async watch(): Promise<void> {
    if (this.stopping || this.booting || this.state !== 'ready') return;
    if ((await this.client.health()) === 'ok') { this.misses = 0; return; }
    if (++this.misses >= WATCH_MISSES) this.lost('the model server stopped answering');
  }

  /** Writes one line to the runtime's log. */
  logLine(line: string): void {
    this.log(line);
  }

  /** Checks the server at once, after an answer failed. */
  async checkNow(): Promise<void> {
    if (this.stopping || this.booting || this.state !== 'ready') return;
    if ((await this.client.health()) !== 'ok') this.lost('the model server stopped answering');
  }

  /** Polls /health until the model is loaded, then warms it. With `child`, gives up as soon as that process is gone. */
  private async waitReady(child: ChildProcess | null): Promise<void> {
    const until = Date.now() + this.readyMs;
    for (;;) {
      if (this.stopping) return;
      if (child && this.child !== child) return; // it exited or failed; onExit or the error handler decided what's next
      const h = await this.client.health();
      if (h === 'ok') break;
      if (h === 'other') return this.retry(`port ${this.port} answers, but not as llama-server`);
      if (!child && h === 'down') return this.retry('the model server is not answering');
      if (Date.now() > until) {
        this.restarts = MAX_RESTARTS;
        child?.kill('SIGTERM');
        return this.off('the model took too long to load');
      }
      await sleep(250);
    }
    if (this.stopping) return;
    // Ready means a question works: the warm-up must come back, or it isn't ready.
    if (this.warmUp) {
      const t0 = Date.now();
      const warmed = await this.warm();
      if (!warmed) {
        if (child && this.child === child) {
          this.log('the warm-up failed; restarting the server');
          child.kill('SIGKILL');
        } else this.retry('the model server did not answer its warm-up');
        return;
      }
      this.log(`warmed up in ${Date.now() - t0} ms`);
    }
    if (child && this.child !== child) return;
    this.state = 'ready';
    this.reason = null;
    this.restarts = 0;
    this.misses = 0;
    this.stderrTail = [];
  }

  /**
   * Warm the server: ask each fixed prompt prefix for a single token, so the
   * prefix stays in the server's cache. Both at once, so each of the server's two slots holds one of them,
   * as they will be used: the urgent check and the answer side by side.
   */
  private async warm(): Promise<boolean> {
    const blank = { readings: null, detectorLine: null, passages: [], question: 'Hello.' };
    const results = await Promise.allSettled([
      this.client.chat({ messages: buildMessages(blank), maxTokens: 1, firstTokenMs: 60_000, totalMs: 60_000 }),
      this.client.chat({ messages: buildUrgentMessages(blank), maxTokens: 1, responseFormat: URGENT_FORMAT, firstTokenMs: 60_000, totalMs: 60_000 }),
    ]);
    return results.every((r) => r.status === 'fulfilled');
  }

  /** Stops the server this hub started. Never touches a server it only reused. Safe to call twice. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = null;
    for (const job of this.queue.splice(0)) job.reject(new Error('cancelled'));
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((r) => child.once('exit', () => r()));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(timer);
      try { rmSync(this.pidFile, { force: true }); } catch { /* nothing to remove */ }
    }
    this.state = 'unavailable';
    this.reason = 'stopped';
  }

  status(): { state: AiState; reason: string | null; waiting: number } {
    return { state: this.state, reason: this.reason, waiting: this.queue.length + (this.busy ? 1 : 0) };
  }

  /**
   * Runs one job at a time. `onWait` hears the place in line while waiting.
   * Throws 'busy' when too many are waiting, 'cancelled' if the asker left.
   */
  enqueue<T>(job: () => Promise<T>, onWait: (position: number) => void, cancelled: () => boolean = () => false): Promise<T> {
    if (this.queue.length >= MAX_QUEUE) return Promise.reject(new Error('busy'));
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        reject,
        run: async () => {
          if (cancelled()) return reject(new Error('cancelled'));
          try { resolve(await job()); } catch (err) { reject(err); }
        },
      });
      if (this.busy) onWait(this.queue.length);
      void this.next();
    });
  }

  private async next(): Promise<void> {
    if (this.busy) return;
    const item = this.queue.shift();
    if (!item) return;
    this.busy = true;
    try { await item.run(); } finally {
      this.busy = false;
      void this.next();
    }
  }
}

// ---------- POST /api/ask ----------

export interface AskContext {
  ai: AiRuntime;
  /** The NASA passage index, built once with buildIndex(passages). */
  index: SearchIndex;
  /** That person's current readings, as the hub has judged them. Null for an unknown person. */
  readingsFor: (person: string) => PersonReadings | null;
  /** The "Detector: ..." line from engine/baseline.ts detectorLine(), or null. */
  detectorLineFor: (person: string) => string | null;
  /** Her cards, parsed with parseCards(). */
  cards: () => ParsedCards;
  /** What the hub knows about that person now: broken limits, check-in answers. */
  facts: (person: string) => Facts;
  /** Called with the person's id when a message looks like a crisis. Return true once a crewmate has been told. */
  onCrisis?: (person: string) => boolean;
  /**
   * Called when her signs pick a card for the question (engine/medical.ts
   * cardFinding), with how long to keep it: the hub raises the alert her level
   * gives. Never called for "no card fits", nor with any of the words.
   */
  onFinding?: (finding: Finding, keepMs: number) => void;
  /** Her levels per situation (medical/level-overrides.json, engine/medical.ts cardLevel). Unset: each card's own level. */
  levelOverrides?: () => LevelOverride[];
  /** Her ask-first questions (medical/follow-up.json, engine/followup.ts). Unset: none, as before. */
  followUps?: () => FollowUpRow[];
  /** That person's stored answers to them, by key ("checkin.<key>" rows). */
  followUpAnswers?: (person: string) => Record<string, Given>;
  /** Called when a card waits for her questions, so the hub can raise its level once a rule of hers is met by the answers. */
  onAskFirst?: (person: string, askFirst: AskFirst) => void;
  /** That person's evidence card (engine/evidence.ts), or null. */
  evidenceFor?: (person: string) => Evidence | null;
  /** How rooms and crewmates are named in the hub's sentences. Default: their ids. */
  roomName?: (id: string) => string;
  personName?: (id: string) => string;
  /** The profile's pronouns for a crewmate. Unset means they/them. */
  pronounsOf?: (id: string) => 'she' | 'he' | 'they' | undefined;
  /** The place's gravity, in g, from the mission. Cards written for another gravity are never picked. Unknown: null. */
  gravity?: number | null;
  /** A crewmate's quarters, so the hub calls a room "your cabin" only when it is theirs. */
  quartersOf?: (id: string) => string | null;
  /** Current readings against NASA's limits in one room, for the room the evidence card points to. */
  roomReadings?: (room: string) => Extract<Reading, { type: 'limit' }>[];
}

export interface AskPassage {
  id: string;
  /** The short name the model cites. */
  name: string;
  url: string;
  heading: string;
  text: string;
}

export interface AskResult {
  type: 'result';
  /**
   * answer: the model answered (text is checked, or the refusal replaced it).
   * crisis: a person is needed; the model was not used and the words are not repeated.
   * card: the hub's urgent rules matched; the card, not the model.
   * fixed: the hub answered with fixed text (medicine questions, odd input).
   * unavailable: the AI is off. fallback: it was too slow or failed; the readings card.
   */
  route: 'answer' | 'crisis' | 'card' | 'fixed' | 'unavailable' | 'fallback';
  /**
   * Whose words `text` is: the model's (after the checks), the hub's own
   * sentences and NASA's quotes ('hub', see `facts`), or a fixed text.
   */
  by: 'model' | 'hub' | 'fixed';
  /** English. For fixed text, `key` names it in the string table. */
  text: string;
  key: keyof typeof FIXED_TEXTS | 'ai.urgentNoCard' | null;
  /** The cited passage, when the answer cites one. */
  source: string | null;
  /** Every passage sent to the model (or that would have been), with its source. */
  passages: AskPassage[];
  /** The hub's own lines for the readings used, each with its label. Also the readings card. */
  readings: { line: string; label: ReadingLabel | 'detector' }[];
  card: CardView | null;
  /** The urgent check or the word list marked the message urgent. */
  urgent: boolean;
  check: Pick<CheckResult, 'discarded' | 'reasons' | 'dropped'> | null;
  /** The hub-written answer (engine/answer.ts), always, except on the crisis and card routes. */
  facts: HubAnswer | null;
  ms: number;
  /**
   * No card of hers fits: the question to ask later, in her words, and the
   * check-in answer the hub understands for it (1 yes, 0 no). A "no" tells the
   * medical officer (engine/medical.ts followUpFinding).
   */
  followUp?: { question: string; signal: string };
  /** Her signs matched only cards written for another gravity: their ids, for the screen to name as a choice. */
  otherGravity?: string[];
  /**
   * Her ask-first rule (engine/followup.ts): only a lone symptom picked this
   * card, so its level is not raised. The questions to ask the person, in both
   * languages, each with the check-in signal its answer goes to (POST
   * /api/checkin; 1 yes, 0 no, or the value typed). `followUp` carries the
   * first of them, the same way it carries "Did it get better?".
   */
  askFirst?: { card: string; intro: { en: string; pt: string }; questions: { signal: string; kind: 'yes_no' | 'value'; unit?: string; en: string; pt: string }[] };
}

/** Shown when a message is urgent and none of the medical lead's approved cards fits: the checklist, a person, Houston. */
export const URGENT_NO_CARD =
  "No steps card fits this, and I won't guess a treatment. Use your onboard emergency checklist, call your Crew Medical Officer now, and message Houston.";

function send(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  return true;
}

const MAX_BODY = 10_000;

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

/** Handles GET /api/ask/status and POST /api/ask. Returns false for any other path. */
export async function handleAsk(req: IncomingMessage, res: ServerResponse, url: URL, ctx: AskContext): Promise<boolean> {
  if (url.pathname === '/api/ask/status') {
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    return send(res, 200, ctx.ai.status());
  }
  if (url.pathname !== '/api/ask') return false;
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

  const b = (await readJson(req)) as { person?: unknown; about?: unknown; question?: unknown; lang?: unknown } | undefined;
  if (!b || typeof b !== 'object') return send(res, 400, { error: 'body must be JSON: { person, question, about?, lang? }' });
  if (b.about !== undefined && (typeof b.about !== 'string' || !b.about)) return send(res, 400, { error: 'about must be a crewmate id' });
  if (typeof b.person !== 'string' || !b.person) return send(res, 400, { error: 'needs a person' });
  if (typeof b.question !== 'string') return send(res, 400, { error: 'needs a question' });

  const out = stream(res);
  const abort = new AbortController();
  res.once('close', () => { if (!res.writableFinished) abort.abort(); });
  const result = await askQuestion(ctx, { person: b.person, about: b.about as string | undefined, question: b.question, lang: b.lang === 'pt' ? 'pt' : 'en' }, {
    onEvent: (e) => out.line(e), signal: abort.signal,
  });
  if (result === null) return out.end(null);
  if ('error' in result) return out.end(result, 404);
  return out.end(result);
}

export type AskEvent = { type: 'status'; state: 'queued'; position: number } | { type: 'status'; state: 'thinking'; ms: number };

export interface AskOptions {
  onEvent?: (e: AskEvent) => void;
  signal?: AbortSignal;
  /** For the eval only: hears the model's raw answer before the checks. */
  onRaw?: (raw: { answer: string; urgent: 'URGENT' | 'ROUTINE' | null }) => void;
  /** For the eval only: the passages to send instead of the search's. */
  passages?: AskPassage[];
}

/**
 * The whole path for one question, then her rules on it: the card her signs
 * pick raises the alert its level gives (ctx.onFinding); with no card, the
 * "Did it get better?" follow-up. Null if the asker left.
 */
export async function askQuestion(
  ctx: AskContext, q: { person: string; question: string; lang: CardLang; about?: string }, opts: AskOptions = {},
): Promise<AskResult | { error: string } | null> {
  const result = await answerQuestion(ctx, q, opts);
  if (!result || 'error' in result || result.route === 'crisis') return result;
  const about = q.about ?? q.person;
  const cards = ctx.cards().cards;
  const given = ctx.followUpAnswers?.(about) ?? {};
  const { picked, askFirst } = pickWithFollowUp(cards, { ...ctx.facts(about), text: q.question }, ctx.gravity ?? null, ctx.followUps?.() ?? [], given);
  const overrides = ctx.levelOverrides?.() ?? [];
  const finding = cardFinding(picked, about, cards, 'reported', overrides);
  const raise = (f: Finding) => { try { ctx.onFinding?.(f, CARD_FINDING_KEEP_MS); } catch { /* the hub's side failed; the answer still goes out */ } };
  if (finding) raise(finding);
  const out: AskResult = { ...result };
  if (picked?.otherGravity) out.otherGravity = picked.otherGravity;
  if (askFirst) {
    // Only a lone symptom: nothing is raised for this card until a rule of hers is met by the answers.
    try { ctx.onAskFirst?.(about, askFirst); } catch { /* the hub's side failed; the answer still goes out */ }
    const ruled = askFirstFinding(askFirst, about);
    if (ruled) raise(ruled);
    const questions = askFirst.questions.map((x) => {
      const one: NonNullable<AskResult['askFirst']>['questions'][number] = { signal: x.signal, kind: x.kind, en: t(x.stringKey, 'en'), pt: t(x.stringKey, 'pt') };
      if (x.unit) one.unit = x.unit;
      return one;
    });
    out.askFirst = { card: askFirst.card, intro: { en: t('followup.intro', 'en'), pt: t('followup.intro', 'pt') }, questions };
    if (questions[0]) out.followUp = { question: q.lang === 'pt' ? questions[0].pt : questions[0].en, signal: questions[0].signal };
  } else if (!finding) out.followUp = { question: FOLLOW_UP_QUESTION, signal: FOLLOW_UP_SIGNAL };
  return out;
}

/**
 * The answer to one question: input screen, readings, passages, the model
 * (one question at a time), the output check. Null if the asker left.
 */
async function answerQuestion(
  ctx: AskContext, q: { person: string; question: string; lang: CardLang; about?: string }, opts: AskOptions = {},
): Promise<AskResult | { error: string } | null> {
  const started = Date.now();
  // `person` is who asks (a crisis is theirs); `about` is who the question is about, by default the same.
  const { person, question, lang } = q;
  const about = q.about ?? person;
  const screen = screenInput(question);

  // A crisis goes to a person. Nothing else runs, and the words go nowhere.
  if (screen.route === 'crisis') {
    let told = false;
    try { told = ctx.onCrisis?.(person) === true; } catch { /* the hub's side failed; the answer still goes out */ }
    const key = told ? 'ai.crisisTold' : 'ai.crisis';
    return { type: 'result', route: 'crisis', by: 'fixed', text: FIXED_TEXTS[key], key, source: null, passages: [], readings: [], card: null, urgent: true, check: null, facts: null, ms: Date.now() - started };
  }

  const found = ctx.readingsFor(about);
  if (!found) return { error: 'unknown person' };
  const pronouns = ctx.pronounsOf?.(about) ?? 'they';
  const readings: PersonReadings = { ...found, pronoun: pronouns === 'she' ? 'her' : pronouns === 'he' ? 'his' : 'their' };
  const who: Who = { name: readings.name, pronouns, self: about === person };
  const detector = ctx.detectorLineFor(about);
  const facts = ctx.facts(about);
  const cards = ctx.cards().cards;
  const readingList: AskResult['readings'] = readings.readings.map((r) => ({ line: readingLine(r, readings.pronoun ?? 'their'), label: r.label }));
  const detectorLine = readingsBlock(null, detector);
  if (detectorLine) readingList.push({ line: detectorLine.split('\n')[1], label: 'detector' });

  // Passages: the card already open for this person comes first, then the search.
  const passages: AskPassage[] = [];
  const gravity = ctx.gravity ?? null;
  const open = pickCard(cards, { readings: facts.readings, answers: facts.answers }, gravity);
  if (open && !open.fallback) {
    for (const s of open.card.sources) if (s.is_nasa && s.quote && s.name) passages.push({ id: `card:${open.card.id}`, name: s.name, url: s.url, heading: open.card.title.en, text: s.quote });
  }
  const hits = opts.passages ?? search(ctx.index, question, { readings: readings.readings.map((r) => (r.type === 'note' ? r.text : r.name)), limit: 2 }).hits
    .map((hit) => ({ id: hit.id, name: hit.name, url: hit.passage.url, heading: hit.passage.heading, text: hit.passage.text }));
  for (const hit of hits) {
    if (passages.length >= 3 || passages.some((p) => p.name === hit.name && p.text === hit.text)) continue;
    passages.push(hit);
  }

  const base = { type: 'result' as const, source: null, passages, readings: readingList, check: null, facts: null };
  const viewOf = (text?: string) => {
    // As askQuestion picks: a card picked only by her lone-symptom words gives way to another card that fits, else it is shown (its steps are hers) with no level.
    const { picked, askFirst } = pickWithFollowUp(cards, { ...facts, text }, gravity, ctx.followUps?.() ?? []);
    const card = picked?.card ?? cards.find((c) => c.id === askFirst?.card) ?? null;
    return card ? cardView(card, lang) : null;
  };

  if (screen.route === 'card') {
    const card = viewOf(question);
    return { ...base, route: 'card', by: 'fixed', text: card ? FIXED_TEXTS['ai.card'] : URGENT_NO_CARD, key: card ? 'ai.card' : 'ai.urgentNoCard', card, urgent: true, ms: Date.now() - started };
  }
  // From here on the hub has its own answer, built from its numbers and NASA's words only.
  const evidenceCard = (() => { try { return ctx.evidenceFor?.(about) ?? null; } catch { return null; } })();
  // What another person reported (their check-ins) is theirs: a question about them gets their readings, not their reports.
  const evidence = evidenceCard && about !== person ? { ...evidenceCard, reported: { rows: [], runs: [] } } : evidenceCard;
  const roomName = ctx.roomName ?? ((id: string) => id);
  const danger = dangerCheck(question, readings);
  const quoted = passages.map((p) => ({ name: p.name, url: p.url, text: p.text }));
  // A card for this person that was written for one gravity makes the place's gravity worth stating.
  const gravityMatters = !!open?.card.applies_in || open?.reason === 'no-card-for-this-gravity';
  const compose = (extra: { notExact?: boolean; noPassages?: boolean } = {}) => composeAnswer({
    name: readings.name, who, question, readings, evidence, lang, roomName, personName: ctx.personName, danger,
    passages: extra.noPassages ? [] : quoted, notExact: extra.notExact,
    gravity, gravityMatters, quarters: ctx.quartersOf?.(about) ?? null, roomReadings: ctx.roomReadings,
  });
  const hubAnswer = compose();
  const withFacts = { ...base, facts: hubAnswer };
  // An amount, dose or treatment question whose passages name treatments: NASA's text near the
  // question must not read as the answer. The fixed refusal, and the readings facts only.
  const treatmentTrap = asksAmountOrTreatment(question) && quoted.some((p) => namesTreatment(p.text));
  /**
   * The hub's answer as the main text when it has something that bears on the question, else the
   * fixed text. `notExact` opens it with the line that NASA's text does not answer this exactly.
   */
  const hubOr = (key: keyof typeof FIXED_TEXTS, notExact = false) => {
    if (treatmentTrap) return { by: 'fixed' as const, text: FIXED_TEXTS['ai.refusal'], key: 'ai.refusal' as const, facts: compose({ noPassages: true }) };
    const answer = notExact ? compose({ notExact: true }) : hubAnswer;
    return answer.relevant
      ? { by: 'hub' as const, text: answer.text, key: null, facts: answer }
      : { by: 'fixed' as const, text: FIXED_TEXTS[key], key, facts: answer };
  };

  if (screen.route === 'fixed') {
    return { ...withFacts, route: 'fixed', by: 'fixed', text: FIXED_TEXTS[screen.key], key: screen.key, card: null, urgent: false, ms: Date.now() - started };
  }
  if (ctx.ai.state !== 'ready') {
    return { ...withFacts, route: 'unavailable', ...hubOr('ai.unavailable'), card: null, urgent: false, ms: Date.now() - started };
  }

  const prompt = {
    readings, detectorLine: detector, passages: passages.map((p): PromptPassage => ({ name: p.name, text: p.text })), question,
    evidence: evidence ? evidenceLines(evidence, readings.name, roomName) : [],
    asker: { ...who, askerName: ctx.personName?.(person) ?? person },
  };
  // Was any 1-hour average over NASA's CO2 limit? Only the evidence card can say; without its field, no.
  const longest = evidence ? [...evidence.whereBeen.windows].sort((a, b) => b.ms - a.ms)[0] : undefined;
  const maxHour = maxHourAverage(longest?.people.find((p) => p.person === about));
  const co2Limit = LIMITS.find((l) => l.signal === 'co2')?.max ?? Infinity;
  const hourOverLimit = maxHour !== null && maxHour > co2Limit;
  const message = buildUserMessage(prompt);
  const factsAll = [readingsBlock(readings, detector, prompt.evidence) ?? '', ...prompt.passages.map((p) => p.text)].join('\n');
  const signal = opts.signal ?? new AbortController().signal;
  const emit = opts.onEvent ?? (() => {});
  let timings: ChatTimings | null = null;
  let waited = 0;
  const messages = buildMessages(prompt);
  // One line per answer: sizes and times, never the question or the answer.
  const logTiming = (r: AskResult) => ctx.ai.logLine(
    `answer ${r.route}/${r.by}${r.check?.discarded ? ' (discarded by check)' : ''} in ${r.ms} ms (queued ${waited} ms); `
    + `prompt ${messages.reduce((n, m) => n + m.content.length, 0)} chars, crew message ${message.length} chars, ${prompt.passages.length} passage(s), ${readings.readings.length} reading line(s); `
    + `server: ${timings?.promptTokens ?? '?'} tokens read (${timings?.cachedTokens ?? '?'} from cache) in ${timings?.promptMs ?? '?'} ms, `
    + `first word ${timings?.firstWordMs ?? '?'} ms, ${timings?.answerTokens ?? '?'} tokens written`);
  const done = (r: AskResult): AskResult => { logTiming(r); return r; };

  try {
    const queuedAt = Date.now();
    const result = await ctx.ai.enqueue(async () => {
      const t0 = Date.now();
      waited = t0 - queuedAt;
      const ticker = setInterval(() => emit({ type: 'status', state: 'thinking', ms: Date.now() - t0 }), 1000);
      emit({ type: 'status', state: 'thinking', ms: 0 });
      try {
        // The urgent check and the answer run side by side on the server's two slots.
        const [label, answer] = await Promise.all([
          ctx.ai.client.chat({ messages: buildUrgentMessages(prompt), maxTokens: 16, responseFormat: URGENT_FORMAT, signal, firstTokenMs: URGENT_MS, totalMs: URGENT_MS })
            .then(parseUrgentLabel, () => null),
          ctx.ai.client.chat({ messages, maxTokens: 300, signal, firstTokenMs: ctx.ai.firstTokenMs, totalMs: ctx.ai.answerMs, onTimings: (t) => { timings = t; } })
            .then((text) => ({ text, error: null as unknown }), (error: unknown) => ({ text: '', error })),
        ]);
        return { label, answer };
      } finally {
        clearInterval(ticker);
      }
    }, (position) => emit({ type: 'status', state: 'queued', position }), () => signal.aborted);
    opts.onRaw?.({ answer: result.answer.text, urgent: result.label });

    const urgent = result.label === 'URGENT';
    const card = urgent ? viewOf(question) : null;
    if (result.answer.error) {
      // A slow or failed answer never takes the runtime down; it only makes the watcher look now.
      if (!signal.aborted) void ctx.ai.checkNow();
      const key = result.answer.error instanceof AiTimeout ? 'ai.slow' : 'ai.unavailable';
      return done({ ...withFacts, route: 'fallback', ...hubOr(key), card, urgent, ms: Date.now() - started });
    }
    const checked = checkAnswer({
      answer: result.answer.text, passageNames: prompt.passages.map((p) => p.name), facts: factsAll, message,
      subject: { name: who.name, pronouns: who.pronouns, self: who.self }, hourOverLimit,
    });
    // A danger question: the hub's under/over verdict decides, and a model answer that disagrees, or doesn't answer, goes.
    if (danger && (checked.by !== 'model' || !agreesWithDanger(checked.text, danger))) {
      const reasons = checked.by === 'model' ? [`it disagrees with the hub: the reading is ${danger.side} the NASA limit`, ...checked.reasons] : checked.reasons;
      return done({ ...withFacts, route: 'answer', by: 'hub', text: hubAnswer.text, key: null, card, urgent, check: { discarded: checked.by === 'model' || checked.discarded, reasons, dropped: checked.dropped }, ms: Date.now() - started });
    }
    if (checked.fixed === 'fallback') {
      return done({ ...withFacts, route: 'fallback', ...hubOr('ai.slow'), card, urgent, check: pickCheck(checked), ms: Date.now() - started });
    }
    // "Should I…?" and "Am I ill?": the hub states the facts and the verdict and says plainly it does not
    // recommend or diagnose. A model's words there are never shown, however careful they are.
    if (asksAdviceOrDiagnosis(question) && hubAnswer.relevant) {
      return done({ ...withFacts, route: 'answer', by: 'hub', text: hubAnswer.text, key: null, card, urgent, check: { discarded: checked.by === 'model', reasons: ['an advice or diagnosis question: the hub answers it', ...checked.reasons], dropped: checked.dropped }, ms: Date.now() - started });
    }
    // Thrown away by a check, or the model said it doesn't know: the hub's own answer, not the
    // refusal, when the hub has something to say (a passage, or a fact that bears on the question).
    // When the model declined, the hub says first that NASA's text does not answer it exactly.
    if (checked.discarded || checked.fixed === 'ai.refusal') {
      const declined = !checked.discarded && checked.fixed === 'ai.refusal';
      return done({ ...withFacts, route: 'answer', ...hubOr('ai.refusal', declined), card, urgent, check: pickCheck(checked), ms: Date.now() - started });
    }
    return done({
      ...withFacts, route: 'answer', by: checked.by, text: checked.text, key: checked.fixed === 'ai.refusal' ? 'ai.refusal' : null, source: checked.source,
      card, urgent, check: pickCheck(checked), ms: Date.now() - started,
    });
  } catch (err) {
    if ((err as Error).message === 'cancelled') return null;
    const key = (err as Error).message === 'busy' ? 'ai.busy' : 'ai.unavailable';
    return { ...withFacts, route: 'fallback', ...hubOr(key), card: null, urgent: false, ms: Date.now() - started };
  }
}

function pickCheck(c: CheckResult): AskResult['check'] {
  return { discarded: c.discarded, reasons: c.reasons, dropped: c.dropped };
}

/** Newline-delimited JSON. The header goes out with the first line. */
function stream(res: ServerResponse) {
  let started = false;
  const head = (status = 200) => {
    if (started) return;
    started = true;
    res.writeHead(status, { 'content-type': status === 200 ? 'application/x-ndjson' : 'application/json', 'cache-control': 'no-store' });
  };
  return {
    line(obj: unknown): void {
      if (res.writableEnded || res.destroyed) return;
      head();
      res.write(`${JSON.stringify(obj)}\n`);
    },
    end(obj: AskResult | { error: string } | null, status = 200): true {
      if (res.writableEnded || res.destroyed) return true;
      if (obj === null) { head(); res.end(); return true; }
      if (status !== 200 && !started) { head(status); res.end(JSON.stringify(obj)); return true; }
      head();
      res.end(`${JSON.stringify(obj)}\n`);
      return true;
    },
  };
}
