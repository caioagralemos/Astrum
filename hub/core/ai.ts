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
  agreesWithDanger, buildMessages, buildUrgentMessages, buildUserMessage, checkAnswer, dangerCheck, FIXED_TEXTS, isComplaint, modelReadingsBlock, parseUrgentLabel,
  readingLine, readingsBlock, screenInput, URGENT_FORMAT,
} from '../engine/prompt.ts';
import { asksAdviceOrDiagnosis, asksAmountOrTreatment, composeAnswer, evidenceLines, maxHourAverage, namesTreatment, replyText, TIRED, tirednessReadings } from '../engine/answer.ts';
import type { Who } from '../engine/answer.ts';
import { LIMITS } from '../engine/cabin.ts';
import type { HubAnswer } from '../engine/answer.ts';
import type { Evidence } from '../engine/evidence.ts';
import type { ChatMessage, CheckResult, PersonReadings, PromptPassage, Reading, ReadingLabel } from '../engine/prompt.ts';
import { NO_CARD_FITS, cardView, pickCard } from '../engine/cards.ts';
import type { CardLang, CardView, Facts, ParsedCards, Picked } from '../engine/cards.ts';
import { search } from '../engine/search.ts';
import { CARD_FINDING_KEEP_MS, FOLLOW_UP_QUESTION, FOLLOW_UP_SIGNAL, cardFinding } from '../engine/medical.ts';
import type { LevelOverride } from '../engine/medical.ts';
import { askFirstFinding, pickWithFollowUp } from '../engine/followup.ts';
import type { AskFirst, FollowUpRow, Given } from '../engine/followup.ts';
import { t } from '../engine/strings.ts';
import {
  AFTER_CRISIS, GREETING_LEAD, GREETING_NEXT, MAX_HISTORY, REMARK_NEXT, THREAD_IDLE_MS, YES_NO, HELP_OPTION, OFFER_HELP, conversationText, earlierLine, interpretReply, looksLikeReply, offerText,
  parseHistory, pickLine, previousFromHistory, remarkKind, remarkReply, remarkTopic, remember, resolveFollowUp, smallTalkKind, smallTalkReply, standaloneQuestion,
  topicOf, topicOptions, TOPICS, messageLang,
} from '../engine/conversation.ts';
import { buildGlueMessages, checkGlue, dayPart } from '../engine/glue.ts';
import type { GlueKind } from '../engine/glue.ts';
import type { CrewName, HistoryItem, Pending, Previous, Remark, SmallTalk, Thread, Threads, Topic } from '../engine/conversation.ts';
import { answerSignal } from '../engine/cards.ts';
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

/**
 * Where an answer ends: the small model sometimes writes a stray end-of-thinking
 * marker and then a second answer. It stops there; every check still runs on what came before.
 */
const ANSWER_STOP = ['</think>', '<think>'];

/** The crew gets the fallback when the first word takes longer than 8 s or the whole answer longer than 25 s. */
export const FIRST_TOKEN_MS = 8_000;
export const ANSWER_MS = 25_000;
const URGENT_MS = 8_000;
const READY_MS = 180_000;
/**
 * How long the warm-up may take before the server is taken for stuck. Long on purpose: a slow computer (an
 * Intel build run by emulation on an ARM PC reads 3 to 16 tokens a second) needs minutes to read the fixed
 * prompts once, and killing it at one minute only made it start over, for ever. A working Mac takes under a second.
 */
const WARM_MS = 600_000;
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
  /** Where the server stops writing (llama-server's `stop`). */
  stop?: string[];
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
          ...(req.stop ? { stop: req.stop } : {}),
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
      this.client.chat({ messages: buildMessages(blank), maxTokens: 1, firstTokenMs: WARM_MS, totalMs: WARM_MS }),
      this.client.chat({ messages: buildUrgentMessages(blank), maxTokens: 1, responseFormat: URGENT_FORMAT, firstTokenMs: WARM_MS, totalMs: WARM_MS }),
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
  /** "Call for help" in the chat (POST /api/ask/help): raises the level 3 an answer of "help" brings. True once raised. */
  onHelp?: (person: string) => boolean;
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
  /** Each crewmate's conversation (engine/conversation.ts). Unset: every question stands alone, as before. */
  threads?: Threads;
  /** The crew, to know who "what about Leo?" means. */
  crew?: () => CrewName[];
  /**
   * Stores a reply to one of her questions as a reported check-in answer, the
   * same row POST /api/checkin makes (engine/checkin.ts). True when stored.
   */
  storeCheckin?: (person: string, answer: { signal: string; value: number | null; text: string | null; unit?: string }) => boolean;
  /** The hub's local hour (0-23), for greetings by time of day. Default: this computer's clock. */
  hour?: () => number;
  /** False: Astra's conversational sentences are always the hub's scripted lines (engine/glue.ts is not asked). Default true. */
  glue?: boolean;
  /**
   * Whether a body signal has a current reading for a person: 'none' (never), 'stale' with the time of the
   * last one, or 'fresh'. Unset: the hub cannot tell, and a question about it is answered as before.
   */
  signalState?: (person: string, signal: string) => { state: 'none' } | { state: 'stale'; at: number; live: boolean } | { state: 'fresh' };
  /** The station's rooms, for the shared screen's room questions (askShared). Unset: rooms are not named, and every room question gets the choose-a-person line. */
  rooms?: () => { id: string; name: string }[];
}

/** A question Astra asked and waits on: her follow-up and card questions, "Did it get better?", or "which one?". */
export interface PendingQuestion {
  purpose: Pending['purpose'];
  kind: Pending['kind'];
  text: string;
  /** The answers a screen may offer as buttons; typed words are read against them too. */
  options: { value: string; label: string }[];
  unit?: string;
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
  key: keyof typeof FIXED_TEXTS | 'ai.urgentNoCard' | 'ai.conversation' | 'ai.noRecent' | 'ai.choosePerson' | null;
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
  /** The complete question the hub made of a message that leaned on the one before ("and yesterday?"), shown under the reply. */
  understoodAs?: string;
  /** A question Astra asks back and waits on. The next message is read against it first. */
  pendingQuestion?: PendingQuestion;
  /** A typed "yes" to "Do you want to call for help?": a screen offers "Call for help" (confirmed first) under this reply. */
  offerHelp?: true;
  /** Set when the message was small talk, answered by the hub's own sentence. */
  smallTalk?: SmallTalk;
  /** Set when the message was a remark on the previous answer, answered by the hub's own sentence (a plain bubble). */
  remark?: Remark;
  /**
   * Why the reply reads as it does, for a screen's "About this answer":
   * model (the model's text, checked), setAside (the model's text failed the checks; the hub's facts instead),
   * hub (the hub's facts; no model text), smallTalk, remark, conversation (a reply to Astra's question),
   * fixed (a fixed text), card, crisis, unavailable, fallback.
   */
  reason?: 'model' | 'setAside' | 'hub' | 'smallTalk' | 'remark' | 'conversation' | 'fixed' | 'card' | 'crisis' | 'unavailable' | 'fallback';
  /**
   * Astra's own sentence that opens this reply, and who wrote it: the model (engine/glue.ts, every check passed)
   * or the hub's scripted line. Already at the start of `text`. A screen that draws the hub's facts instead of
   * `text` (by 'hub') shows it above them.
   */
  lead?: { text: string; by: 'model' | 'fixed' };
  /**
   * The quiet line kept under every reply after a crisis phrase earlier in the conversation: help is one tap away.
   * Already at the end of `text`; a screen that draws facts or its own fixed text instead of `text` shows it under them.
   */
  aside?: string;
  /** The shared screen (askShared): the question needs a person chosen first; a screen opens its "Asking as" picker. */
  choosePerson?: true;
}

/** The reason a screen shows under a reply. Never "set aside" unless a model answer was in fact set aside. */
export function replyReason(r: AskResult): NonNullable<AskResult['reason']> {
  if (r.smallTalk) return 'smallTalk';
  if (r.remark) return 'remark';
  if (r.key === 'ai.conversation') return 'conversation';
  if (r.route !== 'answer') return r.route;
  if (r.by === 'model') return 'model';
  return r.check?.discarded ? 'setAside' : 'hub';
}

/** Shown when a message is urgent and none of the medical lead's approved cards fits: the checklist, a person, Earth. */
export const URGENT_NO_CARD =
  "No steps card fits this, and I won't guess a treatment. Use your onboard emergency checklist, call your Crew Medical Officer now, and message Earth.";

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
  if (url.pathname === '/api/ask/help') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    const h = (await readJson(req)) as { person?: unknown; lang?: unknown } | undefined;
    if (typeof h?.person !== 'string' || !ctx.readingsFor(h.person)) return send(res, 400, { error: 'needs a crewmate id as person' });
    let told = false;
    try { told = ctx.onHelp?.(h.person) ?? false; } catch { /* the hub's side failed */ }
    if (!told) return send(res, 503, { error: 'the hub could not raise the alert' });
    const lang = h.lang === 'pt' ? 'pt' : 'en';
    return send(res, 200, { ok: true, text: `${t('alert.toldTo', lang, { who: t('alert.everyone', lang) })}.` });
  }
  if (url.pathname !== '/api/ask') return false;
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

  const b = (await readJson(req)) as { person?: unknown; about?: unknown; question?: unknown; lang?: unknown; history?: unknown; stepsDone?: unknown; shared?: unknown } | undefined;
  if (!b || typeof b !== 'object') return send(res, 400, { error: 'body must be JSON: { person, question, about?, lang?, history?, stepsDone? } or { shared: true, question, lang? }' });
  // The shared screen: no person, rooms and NASA's text only (askShared). Nothing is kept, raised or stored.
  if (b.shared === true) {
    if (b.person !== undefined || b.about !== undefined || b.stepsDone !== undefined) return send(res, 400, { error: 'a shared question has no person' });
    if (typeof b.question !== 'string') return send(res, 400, { error: 'needs a question' });
    const shared = askShared(ctx, { question: b.question, lang: b.lang === 'pt' ? 'pt' : 'en' });
    shared.reason = replyReason(shared);
    return stream(res).end(shared);
  }
  // The person went through a card's steps (the phone's "Done"): Astra's next message, no question typed.
  if (b.stepsDone !== undefined) {
    if (typeof b.person !== 'string' || !b.person || typeof b.stepsDone !== 'string') return send(res, 400, { error: 'stepsDone needs a person and a card id' });
    const done = afterSteps(ctx, { person: b.person, card: b.stepsDone, lang: b.lang === 'pt' ? 'pt' : 'en' });
    if ('error' in done) return send(res, 404, done);
    return stream(res).end(done);
  }
  const history = parseHistory(b.history);
  if (history === null) return send(res, 400, { error: `history must be a list of at most ${MAX_HISTORY} { question, route?, card?, understoodAs? }, each text at most 600 characters` });
  if (b.about !== undefined && (typeof b.about !== 'string' || !b.about)) return send(res, 400, { error: 'about must be a crewmate id' });
  if (typeof b.person !== 'string' || !b.person) return send(res, 400, { error: 'needs a person' });
  if (typeof b.question !== 'string') return send(res, 400, { error: 'needs a question' });

  const out = stream(res);
  const abort = new AbortController();
  res.once('close', () => { if (!res.writableFinished) abort.abort(); });
  const result = await askInConversation(ctx, { person: b.person, about: b.about as string | undefined, question: b.question, lang: b.lang === 'pt' ? 'pt' : 'en', history }, {
    onEvent: (e) => out.line(e), signal: abort.signal,
  });
  if (result === null) return out.end(null);
  if ('error' in result) return out.end(result, 404);
  result.reason = replyReason(result);
  return out.end(result);
}

/** Words that make a message about a person: the asker, their body, or how they feel. Any of them sends a shared question to the choose-a-person line. */
const PERSONAL = /\b(i|i'm|im|i've|i'd|me|my|mine|myself|we|us|our|you|your|he|she|him|her|his|they|them|their|feel\w*|felt|hurt\w*|pain\w*|ache\w*|sick|ill|unwell|dizz\w*|faint\w*|nause\w*|vomit\w*|tired\w*|sleep\w*|slept|heart|pulse|blood|temperature of|fever\w*|breath\w*|headache\w*|symptom\w*|medic\w*|doctor|drug\w*|dose\w*|pill\w*|reading\w* of|eu|meu|minha|meus|minhas|me|mim|comigo|voc[eê]s?|sinto|senti|estou|tenho|dor|tontur\w*|enjo\w*|cansad\w*|sono|febre|cora[cç][aã]o|rem[eé]dio\w*)\b/iu;
/** A room or NASA question: the cabin's air and the station's limits. */
const ROOM_TOPIC = /\b(air|co2|c02|carbon dioxide|oxygen|o2|humidity|pressure|cabin|room|rooms|module|station|limit\w*|nasa|ar|umidade|press[aã]o|sala|salas|m[oó]dulo|esta[cç][aã]o|limite\w*)\b/iu;

/** True for a question the shared screen may answer: about rooms or NASA's text, and about no one. Unsure: false. */
export function sharedAnswerable(question: string, rooms: { id: string; name: string }[], crew: CrewName[] = []): boolean {
  const q = question.toLowerCase();
  if (!q.trim() || PERSONAL.test(q) || isComplaint(question)) return false;
  if (crew.some((p) => q.includes(p.id.toLowerCase()) || q.includes(p.name.toLowerCase()))) return false;
  if (asksAmountOrTreatment(question) || asksAdviceOrDiagnosis(question)) return false;
  return ROOM_TOPIC.test(q) || rooms.some((r) => q.includes(r.name.toLowerCase()) || q.includes(r.id.toLowerCase()));
}

/**
 * A question on the shared screen, asked as no one: the hub's own sentences from the rooms' readings and NASA's
 * passages, never the model, a person's readings, a card, a finding, a follow-up or a stored answer. A crisis
 * phrase still gets the crisis text at once (no one can be named, so no one is told: it sends the reader to a
 * person). Anything not clearly about rooms or NASA gets the fixed "Choose who is asking" line.
 */
export function askShared(ctx: AskContext, q: { question: string; lang: CardLang }): AskResult {
  const started = Date.now();
  const lang = messageLang(q.question, q.lang);
  const empty = { type: 'result' as const, source: null, passages: [], readings: [], card: null, check: null, facts: null };
  if (screenInput(q.question).route === 'crisis') {
    return { ...empty, route: 'crisis', by: 'fixed', text: FIXED_TEXTS['ai.crisis'], key: 'ai.crisis', urgent: true, ms: Date.now() - started };
  }
  const rooms = ctx.rooms?.() ?? [];
  const choose = (): AskResult => ({ ...empty, route: 'fixed', by: 'fixed', text: t('ai.choosePerson', lang), key: 'ai.choosePerson', urgent: false, choosePerson: true, ms: Date.now() - started });
  if (!sharedAnswerable(q.question, rooms, ctx.crew?.() ?? [])) return choose();
  const ql = q.question.toLowerCase();
  const named = rooms.filter((r) => ql.includes(r.name.toLowerCase()) || ql.includes(r.id.toLowerCase()));
  const roomReadings = (named.length ? named : rooms).flatMap((r) => (ctx.roomReadings?.(r.id) ?? []).map((x) => ({ ...x, room: r.id, here: false })));
  const readings: PersonReadings = { name: '', pronoun: 'their', readings: roomReadings };
  const passages: AskPassage[] = search(ctx.index, q.question, { readings: [], limit: 2 }).hits
    .map((hit) => ({ id: hit.id, name: hit.name, url: hit.passage.url, heading: hit.passage.heading, text: hit.passage.text }));
  const who: Who = { name: '', pronouns: 'they', self: false };
  const answer = composeAnswer({
    name: '', who, question: q.question, readings, evidence: null, lang, roomName: ctx.roomName, personName: ctx.personName,
    passages: passages.map((p) => ({ name: p.name, url: p.url, text: p.text })), gravity: ctx.gravity ?? null, gravityMatters: false, quarters: null,
  });
  if (!answer.relevant) return choose();
  return {
    ...empty, route: 'answer', by: 'hub', text: replyText(answer, lang), key: null, passages,
    readings: roomReadings.map((r) => ({ line: readingLine(r, 'their'), label: r.label })), facts: answer, urgent: false, ms: Date.now() - started,
  };
}

export type AskEvent = { type: 'status'; state: 'queued'; position: number } | { type: 'status'; state: 'thinking'; ms: number };

export interface AskOptions {
  onEvent?: (e: AskEvent) => void;
  signal?: AbortSignal;
  /** For the eval only: hears the model's raw answer before the checks. */
  onRaw?: (raw: { answer: string; urgent: 'URGENT' | 'ROUTINE' | null }) => void;
  /** For the eval only: the passages to send instead of the search's. */
  passages?: AskPassage[];
  /** Hub-written lines about the conversation so far (askInConversation), for the model's message. */
  earlier?: string[];
  /** For the eval only: hears each conversational sentence the model was asked for, and the checks' verdict. */
  onGlue?: (g: { kind: GlueKind; raw: string | null; ok: boolean; reasons: string[] }) => void;
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
  // A message that asks nothing: no card is looked for, nothing is raised, nothing is asked back.
  if (result.key === 'ai.greeting') return result;
  const about = q.about ?? q.person;
  const { picked, askFirst, finding } = applyHerRules(ctx, about, q.question);
  const out: AskResult = { ...result };
  if (picked?.otherGravity) out.otherGravity = picked.otherGravity;
  if (askFirst) {
    const questions = askFirst.questions.map((x) => {
      const one: NonNullable<AskResult['askFirst']>['questions'][number] = { signal: x.signal, kind: x.kind, en: t(x.stringKey, 'en'), pt: t(x.stringKey, 'pt') };
      if (x.unit) one.unit = x.unit;
      return one;
    });
    out.askFirst = { card: askFirst.card, intro: { en: t('followup.intro', 'en'), pt: t('followup.intro', 'pt') }, questions };
    if (questions[0]) out.followUp = { question: q.lang === 'pt' ? questions[0].pt : questions[0].en, signal: questions[0].signal };
  } else if (!finding && (isComplaint(q.question) || result.route === 'card')) {
    // Her rule f: "Did it get better?" follows a real complaint that no card of hers fits; never a plain question or a greeting.
    out.followUp = { question: FOLLOW_UP_QUESTION, signal: FOLLOW_UP_SIGNAL };
  }
  return out;
}

/**
 * One message in a crewmate's conversation with Astra (tracker item 533). The
 * hub keeps the thread (engine/conversation.ts Threads: per person asking, 30
 * minutes of quiet); a screen's `history` only stands in for the topic when the
 * hub has none (after a restart), and its words go nowhere. In this order:
 *   1. a crisis phrase in this message or anywhere in the history: the crisis path, at once;
 *   2. a reply to the question Astra asked: stored as her check-in answer, then her rules
 *      give the next question, the card or the level; an unclear reply gets the question again;
 *   3. small talk: the hub's own sentence;
 *   4. a message that leans on the one before: the hub makes a complete question of it
 *      (or asks which one it means), then
 *   5. the single-question pipeline (askQuestion), with every screen and check.
 * Without ctx.threads every message stands alone, as before.
 */
export async function askInConversation(
  ctx: AskContext, q: { person: string; question: string; lang: CardLang; about?: string; history?: HistoryItem[] }, opts: AskOptions = {},
): Promise<AskResult | { error: string } | null> {
  // A plainly Portuguese message ("como eu dormi?") is answered in Portuguese, whatever the screen's language.
  q = { ...q, lang: messageLang(q.question, q.lang) };
  const threads = ctx.threads;
  if (!threads) return askQuestion(ctx, q, opts);
  const started = Date.now();
  const { person, lang } = q;
  const thread = threads.get(person, started);
  thread.turn++;
  const save = () => threads.save(person, thread, Date.now());

  // 1. A crisis phrase in this message goes to a person, now. The words are never repeated.
  if (screenInput(q.question).route === 'crisis') {
    thread.pending = null;
    thread.previous = null;
    thread.crisisAt = started;
    save();
    return askQuestion(ctx, { person, question: q.question, lang }, opts);
  }
  // A crisis phrase earlier in the conversation (the screen's history, or this thread): the medical officer is
  // told exactly as before, the words still go nowhere, and this ordinary message is answered, with a quiet line
  // under it that help is one tap away. Astra's own sentences are then always the hub's scripted ones.
  const crisisBefore = (q.history ?? []).some((h) => screenInput(h.question).route === 'crisis');
  if (crisisBefore) {
    try { ctx.onCrisis?.(person); } catch { /* the hub's side failed; the answer still goes out */ }
    thread.crisisAt = thread.crisisAt ?? started;
  }
  const afterCrisis = crisisBefore || (thread.crisisAt != null && started - thread.crisisAt <= THREAD_IDLE_MS);
  const out = await converse(ctx, thread, q, opts, started, afterCrisis);
  if (out && !('error' in out)) {
    if (afterCrisis && out.route !== 'crisis') {
      out.aside = AFTER_CRISIS[lang];
      out.text = `${out.text}\n\n${out.aside}`;
    }
    remember(thread, out.lead?.text ?? out.text.split('\n')[0].slice(0, 300));
  }
  save();
  return out;
}

/** How long Astra's own sentence may take before the hub's scripted line is shown instead. */
const GLUE_MS = 2500;

/**
 * Astra's own sentence for one turn (engine/glue.ts): the model's, when the AI is ready and free, it answers
 * within GLUE_MS and every check passes; otherwise the hub's scripted line. Never throws.
 */
async function speak(
  ctx: AskContext, thread: Thread, g: { kind: GlueKind; lang: CardLang; message: string; topic: string | null; shows: string | null; remark?: Remark; afterCrisis: boolean; first?: boolean },
  scripted: string, opts: AskOptions,
): Promise<{ text: string; by: 'model' | 'fixed' }> {
  const fallback = { text: scripted, by: 'fixed' as const };
  // A Portuguese asker gets the hub's own Portuguese line: no model call, and nothing in the wrong language.
  if (g.lang === 'pt' || ctx.glue === false || g.afterCrisis || ctx.ai.state !== 'ready' || ctx.ai.status().waiting > 0) return fallback;
  let late = false;
  const timer = new Promise<null>((r) => setTimeout(() => { late = true; r(null); }, GLUE_MS));
  const hour = (() => { try { return ctx.hour?.() ?? new Date().getHours(); } catch { return new Date().getHours(); } })();
  const t0 = Date.now();
  const raw = await Promise.race([
    ctx.ai.enqueue(() => ctx.ai.client.chat({
      messages: buildGlueMessages({ kind: g.kind, lang: g.lang, message: g.message, topic: g.topic, shows: g.shows, remark: g.remark, dayPart: dayPart(hour), first: g.first }),
      maxTokens: 48, firstTokenMs: GLUE_MS, totalMs: GLUE_MS, signal: opts.signal, stop: ['\n\n', '</think>', '<think>'],
    }), () => {}, () => late || opts.signal?.aborted === true).catch(() => null),
    timer,
  ]);
  const names = (ctx.crew?.() ?? []).map((c) => c.name);
  const verdict = raw === null ? { ok: false as const, reasons: [late ? 'too slow' : 'no answer'] } : checkGlue(raw, {
    lang: g.lang, message: g.message, names, recent: thread.said ?? [], topicWords: g.topic ?? '', kind: g.kind,
  });
  opts.onGlue?.({ kind: g.kind, raw, ok: verdict.ok, reasons: verdict.ok ? [] : verdict.reasons });
  // One line per sentence: kind, time and the verdict, never the words.
  ctx.ai.logLine(`glue ${g.kind} ${verdict.ok ? 'shown' : `scripted (${verdict.reasons.length} check(s) failed)`} in ${Date.now() - t0} ms`);
  return verdict.ok ? { text: verdict.text, by: 'model' } : fallback;
}

/** The hub's lines that open its own answer about a topic; the model may write one instead. */
const LEAD_LINES = {
  en: ['Here is what the hub has on {topic}.', "Let's look at {topic}.", "Here are the hub's numbers for {topic}."],
  pt: ['Aqui está o que o hub tem sobre {topic}.', 'Vamos olhar {topic}.', 'Estes são os números do hub para {topic}.'],
} as const;

/** One turn of the conversation, after the crisis rule: steps 2 to 5 of askInConversation. */
async function converse(
  ctx: AskContext, thread: Thread, q: { person: string; question: string; lang: CardLang; about?: string; history?: HistoryItem[] }, opts: AskOptions,
  started: number, afterCrisis: boolean,
): Promise<AskResult | { error: string } | null> {
  const { person, lang } = q;
  const crew = ctx.crew?.() ?? [];
  if (!ctx.readingsFor(q.about ?? person)) return { error: 'unknown person' };

  const fixed = (text: string, extra: Partial<AskResult> = {}): AskResult => ({
    type: 'result', route: 'fixed', by: 'fixed', text, key: 'ai.conversation', source: null, passages: [], readings: [], card: null,
    urgent: false, check: null, facts: null, ms: Date.now() - started, ...extra,
  });

  // 2. A reply to the question Astra asked. A goodbye or thanks is never read as taking up the hub's offer
  // ("valeu, vou dormir, boa noite" names sleep, but it is a goodbye); her own questions are read as before.
  const pending = thread.pending;
  const smallTalkNow = smallTalkKind(q.question);
  if (pending && (pending.purpose === 'clarify' || pending.purpose === 'note' || pending.purpose === 'offerHelp') && smallTalkNow && smallTalkNow !== 'greeting') thread.pending = null;
  if (thread.pending) {
    const pending = thread.pending;
    const reply = interpretReply(q.question, pending);
    if (reply) {
      thread.pending = null;
      return answerPending(ctx, thread, pending, reply, q, opts, fixed, afterCrisis);
    }
    // Small talk ("thanks", "good night") is never taken for an attempt at the hub's offer; her own questions are asked again.
    const offerOnly = pending.purpose === 'clarify' || pending.purpose === 'note' || pending.purpose === 'offerHelp';
    // A new symptom ("I have a headache") is a new message, never an unclear answer: it is handled as one, and the question is dropped as before.
    if (looksLikeReply(q.question) && !isComplaint(q.question) && pending.asked < 3 && !remarkKind(q.question) && !(offerOnly && smallTalkKind(q.question))) {
      pending.asked++;
      const view = pendingView(pending, lang);
      return fixed(conversationText('again', lang, { question: view.text }), { pendingQuestion: view });
    }
    thread.pending = null; // a new message: the question is dropped
  }

  // 3. Small talk: the human part may be the model's, checked; what Astra can do and the next step are the hub's.
  const kind = smallTalkKind(q.question);
  if (kind && screenInput(q.question).route !== 'card') {
    const said = thread.said ?? [];
    const talk = (text: string, lead: { text: string; by: 'model' | 'fixed' }) =>
      fixed(text, { key: 'ai.greeting', smallTalk: kind, by: lead.by === 'model' ? 'model' : 'fixed', lead });
    if (kind === 'who' || kind === 'abilities') return fixed(smallTalkReply(kind, lang, thread.turn - 1, said), { key: 'ai.greeting', smallTalk: kind });
    const hour = (() => { try { return ctx.hour?.() ?? new Date().getHours(); } catch { return new Date().getHours(); } })();
    const first = said.length === 0 && (q.history ?? []).length === 0;
    const glue = (scripted: string, shows: string | null) => speak(ctx, thread, { kind, lang, message: q.question, topic: null, shows, afterCrisis, first }, scripted, opts);
    if (kind === 'greeting') {
      const lead = await glue(pickLine(GREETING_LEAD[dayPart(hour)][lang], thread.turn - 1, said), null);
      return talk(`${lead.text} ${GREETING_NEXT[first ? 'first' : 'again'][lang]}`, lead);
    }
    if (kind === 'howAreYou') {
      const scripted = smallTalkReply(kind, lang, thread.turn - 1, said).replace(/\s*(What would you like to look at\?|O que você quer olhar\?)$/, '');
      const lead = await glue(scripted, 'what can be asked');
      return talk(`${lead.text} ${GREETING_NEXT.again[lang]}`, lead);
    }
    const lead = await glue(smallTalkReply(kind, lang, thread.turn - 1, said), null);
    return talk(lead.text, lead);
  }

  // 4. A remark on the previous answer ("I really did sense something weird", "that makes sense"): Astra's sentence, then one honest next step.
  const remark = screenInput(q.question).route === 'model' ? remarkKind(q.question) : null;
  if (remark) return answerRemark(ctx, thread, remark, q, crew, fixed, opts, afterCrisis);

  // 5. A message that leans on the one before.
  const previous = thread.previous ?? previousFromHistory(q.history ?? [], crew, person);
  const about0 = q.about ?? previous?.topic.about ?? person;
  const candidates = topicsInReadings(ctx, about0);
  const resolved = screenInput(q.question).route === 'model' ? resolveFollowUp(q.question, previous, crew, person, lang, candidates) : { kind: 'standalone' as const };
  if (resolved.kind === 'clarify') {
    thread.pending = {
      purpose: 'clarify', kind: 'choice', text: { en: resolved.text, pt: resolved.text }, options: topicOptions(resolved.options), about: about0,
      shape: resolved.base, topic: { signals: resolved.options, about: about0, window: topicOf(q.question, crew, person, about0).window }, asked: 1,
    };
    return fixed(resolved.text, { pendingQuestion: pendingView(thread.pending, lang) });
  }
  const question = resolved.kind === 'rewritten' ? resolved.question : q.question;
  const about = resolved.kind === 'rewritten' ? resolved.topic.about : q.about ?? person;
  const out = await runQuestion(ctx, thread, { person, about, question, lang }, opts, previous, resolved.kind === 'rewritten' ? resolved.topic : null, q.question, afterCrisis);
  if (out && !('error' in out) && resolved.kind === 'rewritten') out.understoodAs = question;
  return out;
}

/**
 * A remark: one sentence that acknowledges it, in relation to the previous
 * topic, then ONE next step, by what exists: her questions for the previous
 * complaint (follow-up.json, else the card her signs pick); for something they
 * noticed, an offer to save it as a check-in note (typed text reaches only its
 * author: engine/privacy.ts); else an offer of what the hub can show about the
 * previous topic. The acknowledging sentence may be the model's (engine/glue.ts,
 * checked), except after a complaint, where it is always the hub's. No facts, nothing raised.
 */
async function answerRemark(
  ctx: AskContext, thread: Thread, remark: Remark, q: { person: string; question: string; lang: CardLang; about?: string; history?: HistoryItem[] },
  crew: CrewName[], fixed: (text: string, extra?: Partial<AskResult>) => AskResult, opts: AskOptions, afterCrisis: boolean,
): Promise<AskResult> {
  const { person, lang } = q;
  const last = q.history?.[q.history.length - 1];
  // The previous message's words are read by rule here only; they are never sent anywhere.
  const prevText = thread.previous?.question ?? (last ? last.understoodAs ?? last.question : null);
  const plainReply = (text: string, extra: Partial<AskResult> = {}) => fixed(text, { key: 'ai.greeting', remark, ...extra });
  if (!prevText) return plainReply(REMARK_NEXT.noTopic[lang]);
  const about = q.about ?? thread.previous?.topic.about ?? person;
  const signals = thread.previous?.topic.signals.length ? thread.previous.topic.signals : topicOf(prevText, crew, person, about).signals;
  const topic = remarkTopic(prevText, signals, lang);
  const complaint = isComplaint(prevText);
  const scripted = remarkReply(remark, lang, thread.turn - 1, topic, thread.said ?? []);
  const sayLead = async (shows: string) => (complaint ? { text: scripted, by: 'fixed' as const }
    : speak(ctx, thread, { kind: 'remark', remark, lang, message: q.question, topic: remarkTopic(prevText, signals, 'en'), shows, afterCrisis }, scripted, opts));
  const ask = async (next: Pending, shows: string, extra: Partial<AskResult> = {}) => {
    thread.pending = next;
    const view = pendingView(next, lang);
    const lead = await sayLead(shows);
    return plainReply(`${lead.text} ${view.text}`, { pendingQuestion: view, lead, ...(lead.by === 'model' ? { by: 'model' as const } : {}), ...extra });
  };

  // (a) Her questions for the complaint before: picked by her rules, nothing raised.
  if (complaint) {
    const cards = ctx.cards().cards;
    const given = ctx.followUpAnswers?.(about) ?? {};
    const { picked, askFirst } = pickWithFollowUp(cards, { ...ctx.facts(about), text: prevText }, ctx.gravity ?? null, ctx.followUps?.() ?? [], given);
    const first = askFirst?.questions[0];
    if (first) {
      const next: Pending = { purpose: 'askFirst', kind: first.kind, signal: first.signal, text: { en: t(first.stringKey, 'en'), pt: t(first.stringKey, 'pt') }, options: first.kind === 'yes_no' ? YES_NO : [], about, complaint: prevText, asked: 1 };
      if (first.unit) next.unit = first.unit;
      return ask(next, 'a question from the medical lead');
    }
    const card = picked && !picked.fallback && picked.card.id !== NO_CARD_FITS ? picked.card : null;
    const cq = card ? cardQuestion(ctx, card.id, about, prevText) : null;
    if (cq) return ask(cq, 'a question from the medical lead');
  }
  // (c) Something they noticed: save it as their own check-in note, if the hub can store it.
  if (remark === 'noticed' && ctx.storeCheckin && about === person) {
    return ask({ purpose: 'note', kind: 'yes_no', signal: NOTE_SIGNAL, text: { en: REMARK_NEXT.note.en, pt: REMARK_NEXT.note.pt }, options: YES_NO, about: person, note: q.question.slice(0, 600), asked: 1 },
      'an offer to save what they noticed as a private note');
  }
  // (b) What the hub can show next: when the previous answer already showed its topic, the person's other
  // readings (offering the same one again reads like a machine); else the previous topic's own signals, else sleep and air.
  const have = topicsInReadings(ctx, about);
  const shown = thread.previous && thread.previous.topic.signals.length > 0 && !complaint;
  const others = have.filter((s) => !signals.includes(s));
  const options = (shown ? others : signals.length ? signals.filter((s) => have.includes(s)) : ['sleep', 'co2'].filter((s) => have.includes(s))).slice(0, 2);
  if (options.length) {
    return ask({ purpose: 'clarify', kind: 'choice', text: { en: offerText(options, 'en'), pt: offerText(options, 'pt') }, options: topicOptions(options), about, shape: 'how', topic: { signals: options, about, window: null }, asked: 1 },
      `an offer to show ${options.map((o) => remarkTopic(null, [o], 'en')).join(' or ')}`);
  }
  const lead = await sayLead('an invitation to ask about a reading');
  return plainReply(`${lead.text} ${REMARK_NEXT.noTopic[lang]}`, { lead, ...(lead.by === 'model' ? { by: 'model' as const } : {}) });
}

/** The check-in signal a saved remark goes to (stored as "checkin.note"; its words reach only its author). */
const NOTE_SIGNAL = 'note';

/** The single-question pipeline for one turn, then what the thread keeps: the topic, and the question Astra asks back. */
async function runQuestion(
  ctx: AskContext, thread: Thread, q: { person: string; about: string; question: string; lang: CardLang }, opts: AskOptions,
  previous: Previous | null, topic: Topic | null, typed: string = q.question, afterCrisis = false,
): Promise<AskResult | { error: string } | null> {
  const crew = ctx.crew?.() ?? [];
  const result = await askQuestion(ctx, { person: q.person, about: q.about === q.person ? undefined : q.about, question: q.question, lang: q.lang }, { ...opts, earlier: earlierLine(previous) });
  if (!result || 'error' in result) return result;
  if (result.route === 'crisis') { thread.previous = null; thread.pending = null; return result; }
  if (result.key === 'ai.greeting') return result;
  const complaint = isComplaint(q.question);
  thread.previous = { question: q.question, topic: topic ?? topicOf(q.question, crew, q.person, q.about), complaint };
  // What she asks back: her follow-up questions first, then a card's own yes/no questions, then "Did it get better?".
  let next: Pending | null = null;
  const first = result.askFirst?.questions[0];
  if (result.askFirst && first) {
    next = { purpose: 'askFirst', kind: first.kind, signal: first.signal, text: { en: first.en, pt: first.pt }, options: first.kind === 'yes_no' ? YES_NO : [], about: q.about, complaint: q.question, asked: 1 };
    if (first.unit) next.unit = first.unit;
  } else if (result.card && result.card.id !== NO_CARD_FITS && complaint) {
    next = cardQuestion(ctx, result.card.id, q.about, q.question);
  } else if (result.followUp?.signal === FOLLOW_UP_SIGNAL) {
    next = { purpose: 'better', kind: 'yes_no', signal: FOLLOW_UP_SIGNAL, text: { en: FOLLOW_UP_QUESTION, pt: BETTER_PT }, options: YES_NO, about: q.about, complaint: q.question, asked: 1 };
  }
  thread.pending = next;
  if (next) result.pendingQuestion = pendingView(next, q.lang);
  if (result.key === 'ai.cardCalm' || result.key === 'ai.cardCalmAsk') {
    result.key = next ? 'ai.cardCalmAsk' : 'ai.cardCalm';
    result.text = t(result.key, q.lang);
  }
  // A card that is not urgent waits for its questions: first the questions, one at a time, then the card
  // (answerPending). Her rules on the message (a level raised, the medical officer told) already ran in askQuestion.
  if (next && (next.purpose === 'card' || next.purpose === 'askFirst') && result.card && !isUrgentReply(result)) {
    const held = next.purpose === 'card' ? cardQuestionsLeft(ctx, result.card.id, q.about) : (result.askFirst?.questions.length ?? 1);
    result.card = null;
    result.route = 'fixed';
    result.key = 'ai.conversation';
    result.text = conversationText(held > 1 ? 'fewFirst' : 'oneFirst', q.lang);
    delete result.askFirst;
  }
  // The hub's own answer (the model's was set aside, or not asked) opens with Astra's sentence: never for a
  // complaint, a card, an urgent message, her questions, or a fixed text.
  const signals = (topic ?? thread.previous.topic).signals;
  if (result.route === 'answer' && result.by === 'hub' && result.facts?.relevant && !result.card && !result.urgent && !complaint && !result.askFirst && signals.length) {
    const name = remarkTopic(null, signals.slice(0, 1), q.lang);
    const scripted = pickLine(LEAD_LINES[q.lang].map((l) => l.replace('{topic}', name)), thread.turn - 1, thread.said ?? []);
    // The hub's own line, not the model's: in the eval the model's opening lines read as filler ("Let me know if…",
    // "I am fine…") and said nothing about the question. engine/glue.ts still has the 'lead' kind for a later try.
    const lead = { text: scripted, by: 'fixed' as const };
    void typed;
    void afterCrisis;
    result.lead = lead;
    // A shortened reply opens with its answer; the lead line stays in `lead` for the screen.
    if (result.text === result.facts.text) result.text = `${lead.text} ${result.text}`;
  }
  return result;
}

/** Safety first: an urgent reply, or one whose card is dangerous, is never held back for questions. */
function isUrgentReply(r: { urgent: boolean; card: CardView | null }): boolean {
  return r.urgent || r.card?.level === 'dangerous';
}

/** Her "Did it get better?" (engine/medical.ts FOLLOW_UP_QUESTION) in Portuguese. */
const BETTER_PT = 'Melhorou?';

/**
 * Astra's message after the person went through a card's steps: one yes/no question. Her data asks "Did it get
 * better?" only where no card of hers fits (medical/README.md, cases.json): after that card her question waits, read
 * as before (a "no" tells the medical officer by her rule). After any other card the interface asks "Are you feeling
 * better?": nothing is stored for it and nothing is raised; a "no" only offers "Call for help" (answerPending).
 * Provisional until her answer to PERGUNTAS-ABERTAS.md question 13. Nothing is stored and nothing is raised here.
 */
export function afterSteps(ctx: AskContext, q: { person: string; card: string; lang: CardLang }): AskResult | { error: string } {
  if (!ctx.readingsFor(q.person)) return { error: 'unknown person' };
  if (!ctx.cards().cards.some((c) => c.id === q.card)) return { error: 'unknown card' };
  const now = Date.now();
  const out: AskResult = {
    type: 'result', route: 'fixed', by: 'fixed', text: t('ai.stepsDone', q.lang), key: 'ai.conversation', source: null, passages: [], readings: [],
    card: null, urgent: false, check: null, facts: null, ms: 0,
  };
  const thread = ctx.threads?.get(q.person, now);
  if (q.card === NO_CARD_FITS) {
    const next: Pending = {
      purpose: 'better', kind: 'yes_no', signal: FOLLOW_UP_SIGNAL, text: { en: FOLLOW_UP_QUESTION, pt: BETTER_PT }, options: YES_NO,
      about: q.person, complaint: thread?.previous?.question ?? '', asked: 1,
    };
    out.pendingQuestion = pendingView(next, q.lang);
    out.text = out.pendingQuestion.text;
    if (thread) thread.pending = next;
  } else {
    const next: Pending = {
      purpose: 'feeling', kind: 'yes_no', text: { en: conversationText('feeling', 'en'), pt: conversationText('feeling', 'pt') }, options: YES_NO, about: q.person, asked: 1,
    };
    out.pendingQuestion = pendingView(next, q.lang);
    out.text = out.pendingQuestion.text;
    if (thread) thread.pending = next;
  }
  if (thread) ctx.threads!.save(q.person, thread, now);
  out.reason = replyReason(out);
  return out;
}

/** How many of a card's own yes/no questions are not yet answered in the last hour. */
function cardQuestionsLeft(ctx: AskContext, cardId: string, about: string): number {
  const card = ctx.cards().cards.find((c) => c.id === cardId);
  const answered = new Set(ctx.facts(about).answers.map((a) => a.question));
  return new Set(card?.signs.answers.filter((a) => (a.answer === 'yes' || a.answer === 'no') && !answered.has(a.question)).map((a) => a.question)).size;
}

/** The first of a card's own yes/no questions not yet answered in the last hour, as the hub asks it. Null when none is left. */
function cardQuestion(ctx: AskContext, cardId: string, about: string, complaint: string): Pending | null {
  const card = ctx.cards().cards.find((c) => c.id === cardId);
  const answered = new Set(ctx.facts(about).answers.map((a) => a.question));
  const sign = card?.signs.answers.find((a) => (a.answer === 'yes' || a.answer === 'no') && !answered.has(a.question));
  if (!sign) return null;
  // Her card questions are written in English only; both languages show her words.
  return { purpose: 'card', kind: 'yes_no', signal: answerSignal(sign.question), text: { en: sign.question, pt: sign.question }, options: YES_NO, about, complaint, asked: 1 };
}

/** A reply to her question: stored as her check-in answer, then her rules on the complaint again (no model). */
async function answerPending(
  ctx: AskContext, thread: Thread, pending: Pending, reply: { value: number | null; text: string | null; option?: string },
  q: { person: string; question: string; lang: CardLang }, opts: AskOptions, fixed: (text: string, extra?: Partial<AskResult>) => AskResult,
  afterCrisis = false,
): Promise<AskResult | { error: string } | null> {
  const lang = q.lang;
  const crew = ctx.crew?.() ?? [];
  if (pending.purpose === 'clarify') {
    if (!reply.option) return fixed(REMARK_NEXT.declined[lang]);
    const topic = { ...(pending.topic ?? { about: pending.about, window: null, signals: [] }), signals: [reply.option!] };
    const question = standaloneQuestion(pending.shape ?? 'how', reply.option!, topic, q.person, crew, lang);
    const out = await runQuestion(ctx, thread, { person: q.person, about: topic.about, question, lang }, opts, thread.previous, topic, q.question, afterCrisis);
    if (out && !('error' in out)) out.understoodAs = question;
    return out;
  }
  if (pending.purpose === 'note') {
    if (reply.value !== 1 || !pending.note) return fixed(REMARK_NEXT.notSaved[lang]);
    let ok = false;
    try { ok = ctx.storeCheckin?.(pending.about, { signal: NOTE_SIGNAL, value: null, text: pending.note }) ?? false; } catch { /* the hub's side failed */ }
    return fixed(ok ? REMARK_NEXT.saved[lang] : REMARK_NEXT.notSaved[lang]);
  }
  if (pending.signal) {
    try { ctx.storeCheckin?.(pending.about, { signal: pending.signal, value: reply.value, text: reply.text, ...(pending.unit ? { unit: pending.unit } : {}) }); } catch { /* the hub's side failed; the conversation goes on */ }
  }
  if (pending.purpose === 'better') return fixed(conversationText(reply.value === 0 ? 'betterNo' : 'betterYes', lang));
  // After any other card's steps: a "no" only offers the call; nothing is stored and nothing is raised.
  if (pending.purpose === 'feeling') {
    if (reply.value !== 0) return fixed(conversationText('feelingYes', lang));
    const next: Pending = { purpose: 'offerHelp', kind: 'choice', text: { en: conversationText('offerHelp', 'en'), pt: conversationText('offerHelp', 'pt') }, options: OFFER_HELP, about: pending.about, asked: 1 };
    thread.pending = next;
    const view = pendingView(next, lang);
    return fixed(view.text, { pendingQuestion: view });
  }
  if (pending.purpose === 'offerHelp') {
    return reply.option === HELP_OPTION ? fixed(conversationText('helpTap', lang), { offerHelp: true }) : fixed(conversationText('notNow', lang));
  }
  // Her rules again on the complaint, with the answer just given.
  const { picked, askFirst } = applyHerRules(ctx, pending.about, pending.complaint ?? '');
  const cards = ctx.cards().cards;
  if (pending.purpose === 'askFirst' && askFirst) {
    const nextQ = askFirst.questions[0];
    if (nextQ) {
      const next: Pending = { purpose: 'askFirst', kind: nextQ.kind, signal: nextQ.signal, text: { en: t(nextQ.stringKey, 'en'), pt: t(nextQ.stringKey, 'pt') }, options: nextQ.kind === 'yes_no' ? YES_NO : [], about: pending.about, complaint: pending.complaint, asked: 1 };
      if (nextQ.unit) next.unit = nextQ.unit;
      thread.pending = next;
      const view = pendingView(next, lang);
      return fixed(conversationText('next', lang, { question: view.text }), { pendingQuestion: view });
    }
    const card = cards.find((c) => c.id === askFirst.card);
    return fixed(conversationText(askFirst.rule ? 'notedCard' : 'notedNoRule', lang), { card: card ? cardView(card, lang) : null });
  }
  // A card's own question: the card her signs now pick (its level may have changed with the answer), and its next question.
  const card = picked && !picked.fallback ? picked.card : null;
  const next = card && pending.purpose === 'card' ? cardQuestion(ctx, card.id, pending.about, pending.complaint ?? '') : null;
  thread.pending = next;
  const view = next ? pendingView(next, lang) : undefined;
  const shown = card ? cardView(card, lang) : null;
  // A card that is not urgent waits until its last question is answered, then comes with the calm line.
  const calm = pending.purpose === 'card' && shown !== null && shown.level !== 'dangerous';
  if (calm && view) return fixed(conversationText('next', lang, { question: view.text }), { pendingQuestion: view });
  return fixed(view ? conversationText('next', lang, { question: view.text }) : calm ? t('ai.cardCalm', lang) : conversationText(card ? 'notedCard' : 'noted', lang), {
    card: shown, ...(view ? { pendingQuestion: view } : {}),
  });
}

/** A waiting question as a screen shows it, in one language. */
function pendingView(p: Pending, lang: CardLang): PendingQuestion {
  const view: PendingQuestion = { purpose: p.purpose, kind: p.kind, text: p.text[lang], options: p.options.map((o) => ({ value: o.value, label: o.label[lang] })) };
  if (p.unit) view.unit = p.unit;
  return view;
}

/** The hub's topics among a person's readings, for "Do you mean …?" when nothing earlier says what "that" is. */
function topicsInReadings(ctx: AskContext, about: string): string[] {
  const readings = ctx.readingsFor(about)?.readings ?? [];
  const names = readings.map((r) => (r.type === 'note' ? '' : r.name));
  return TOPICS.filter((topic) => names.some((n) => topic.re.test(n))).map((topic) => topic.id);
}

/**
 * Her rules on what a person typed, with the answers they have given: the card
 * her signs pick raises the alert its level gives; a card picked only by her
 * lone-symptom words waits for her questions (raised only once a rule of hers
 * is met by the answers). No model.
 */
function applyHerRules(ctx: AskContext, about: string, text: string): { picked: Picked | null; askFirst: AskFirst | null; finding: Finding | null } {
  const cards = ctx.cards().cards;
  const given = ctx.followUpAnswers?.(about) ?? {};
  const { picked, askFirst } = pickWithFollowUp(cards, { ...ctx.facts(about), text }, ctx.gravity ?? null, ctx.followUps?.() ?? [], given);
  const finding = cardFinding(picked, about, cards, 'reported', ctx.levelOverrides?.() ?? []);
  const raise = (f: Finding) => { try { ctx.onFinding?.(f, CARD_FINDING_KEEP_MS); } catch { /* the hub's side failed; the answer still goes out */ } };
  if (finding) raise(finding);
  if (askFirst) {
    // Only a lone symptom: nothing is raised for this card until a rule of hers is met by the answers.
    try { ctx.onAskFirst?.(about, askFirst); } catch { /* the hub's side failed; the answer still goes out */ }
    const ruled = askFirstFinding(askFirst, about);
    if (ruled) raise(ruled);
  }
  return { picked, askFirst, finding };
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
  // "How is my heart rate?" asks for the reading, not for NASA's research on it: no passage is searched for, so the
  // answer stays on the reading (a card already open for the person still brings its own NASA source).
  const hits = opts.passages ?? (statusQuestion(question) ? [] : search(ctx.index, question, { readings: readings.readings.map((r) => (r.type === 'note' ? r.text : r.name)), limit: 2 }).hits
    .map((hit) => ({ id: hit.id, name: hit.name, url: hit.passage.url, heading: hit.passage.heading, text: hit.passage.text })));
  for (const hit of hits) {
    if (passages.length >= 3 || passages.some((p) => p.name === hit.name && p.text === hit.text)) continue;
    passages.push(hit);
  }

  const base = { type: 'result' as const, source: null, passages, readings: readingList, check: null, facts: null };
  const viewOf = (text?: string, noCardFits = true) => {
    // As askQuestion picks: a card picked only by her lone-symptom words gives way to another card that fits, else it is shown (its steps are hers) with no level.
    const { picked, askFirst } = pickWithFollowUp(cards, { ...facts, text }, gravity, ctx.followUps?.() ?? []);
    // Her "no card fits" card only where a rule asked for one (an urgent word, or a complaint the urgent check marked); never for a plain question.
    if (picked?.fallback && !noCardFits) return null;
    const card = picked?.card ?? cards.find((c) => c.id === askFirst?.card) ?? null;
    return card ? cardView(card, lang) : null;
  };

  // Her ask-first rule (engine/followup.ts): a lone symptom of hers, with no other card fitting, is not a card yet,
  // and not a question for the model either. Her questions come first (askQuestion adds them); nothing is raised
  // until her answers meet a rule of hers.
  const lone = screen.route === 'fixed' ? null : pickWithFollowUp(cards, { ...facts, text: question }, gravity, ctx.followUps?.() ?? []);
  if (lone?.askFirst && !lone.picked && lone.askFirst.questions.length) {
    return { ...base, passages: [], route: 'fixed', by: 'fixed', text: t('followup.intro', lang), key: null, card: null, urgent: false, ms: Date.now() - started };
  }
  // A complaint her signs fit (her own words, e.g. "cut"): her card, word for word, instead of the model's answer or a refusal.
  // Also what happened to them, told in the first person in Portuguese ("cortei o dedo", "machuquei a mão"), never a question.
  const toldPt = !question.includes('?') && /(^|\s)(\p{L}{2,}ei|estou|sinto|senti)(\s|[,.!]|$)/u.test(question.toLowerCase()) && !/\b(sei|rei|lei)\b/.test(question.toLowerCase());
  if (screen.route !== 'card' && lone?.picked && !lone.picked.fallback && lone.picked.signs?.words.length && (isComplaint(question) || toldPt)) {
    const card = cardView(lone.picked.card, lang);
    // Not urgent: a calm line, never the emergency sentence. Whether a question follows is settled again where the thread picks it.
    const calm = lone.askFirst?.questions.length ? 'ai.cardCalmAsk' as const : 'ai.cardCalm' as const;
    if (card) return { ...base, route: 'card', by: 'fixed', text: t(calm, lang), key: calm, card, urgent: false, ms: Date.now() - started };
  }
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
      ? { by: 'hub' as const, text: replyText(answer, lang), key: null, facts: answer }
      : { by: 'fixed' as const, text: FIXED_TEXTS[key], key, facts: answer };
  };

  if (screen.route === 'fixed') {
    // A greeting gets who Astra is and nothing else: no readings, no passages, no facts.
    if (screen.reason === 'greeting') return { ...base, passages: [], readings: [], route: 'fixed', by: 'fixed', text: FIXED_TEXTS[screen.key], key: screen.key, card: null, urgent: false, ms: Date.now() - started };
    return { ...withFacts, route: 'fixed', by: 'fixed', text: FIXED_TEXTS[screen.key], key: screen.key, card: null, urgent: false, ms: Date.now() - started };
  }
  // A question about a body reading the hub has no current value for: a plain sentence that says so, and when the
  // last one was, instead of the model or a NASA passage that has nothing to do with it.
  const noRecent = noRecentText(ctx, question, readings, about, about === person, lang);
  if (noRecent) return { ...base, passages: [], route: 'fixed', by: 'fixed', text: noRecent, key: 'ai.noRecent', card: null, urgent: false, ms: Date.now() - started };
  if (ctx.ai.state !== 'ready') {
    return { ...withFacts, route: 'unavailable', ...hubOr('ai.unavailable'), card: null, urgent: false, ms: Date.now() - started };
  }

  // "How is my heart rate?": the model gets that reading only, so it answers that and not every other number.
  // The checks and the facts it may quote are built from the same list. The screen's readings card keeps them all.
  const modelReadings = focusReadings(readings, question);
  const prompt = {
    readings: modelReadings, detectorLine: detector, passages: passages.map((p): PromptPassage => ({ name: p.name, text: p.text })), question,
    // Asked about themself, the person is "you" in every line the model reads, and never named.
    evidence: evidence ? evidenceLines(evidence, who.self ? 'you' : readings.name, roomName) : [],
    asker: { ...who, askerName: ctx.personName?.(person) ?? person },
    earlier: opts.earlier ?? [],
  };
  // Was any 1-hour average over NASA's CO2 limit? Only the evidence card can say; without its field, no.
  const longest = evidence ? [...evidence.whereBeen.windows].sort((a, b) => b.ms - a.ms)[0] : undefined;
  const maxHour = maxHourAverage(longest?.people.find((p) => p.person === about));
  const co2Limit = LIMITS.find((l) => l.signal === 'co2')?.max ?? Infinity;
  const hourOverLimit = maxHour !== null && maxHour > co2Limit;
  const message = buildUserMessage(prompt);
  // The facts exactly as the model saw them: the only places a number may come from.
  const factsAll = [modelReadingsBlock(modelReadings, detector, prompt.evidence, who.self) ?? '', ...prompt.passages.map((p) => p.text)].join('\n');
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
          ctx.ai.client.chat({ messages, maxTokens: 300, signal, stop: ANSWER_STOP, firstTokenMs: ctx.ai.firstTokenMs, totalMs: ctx.ai.answerMs, onTimings: (t) => { timings = t; } })
            .then((text) => ({ text, error: null as unknown }), (error: unknown) => ({ text: '', error })),
        ]);
        return { label, answer };
      } finally {
        clearInterval(ticker);
      }
    }, (position) => emit({ type: 'status', state: 'queued', position }), () => signal.aborted);
    opts.onRaw?.({ answer: result.answer.text, urgent: result.label });

    // The urgent check can only add urgency, and only to what was typed: a reading alone never marks a message urgent
    // or brings her "no card fits" card. A card her rules pick for this person is shown either way it was asked for.
    const complaint = isComplaint(question);
    const card = result.label === 'URGENT' ? viewOf(question, complaint) : null;
    const urgent = result.label === 'URGENT' && (complaint || card !== null);
    if (result.answer.error) {
      // A slow or failed answer never takes the runtime down; it only makes the watcher look now.
      if (!signal.aborted) void ctx.ai.checkNow();
      const key = result.answer.error instanceof AiTimeout ? 'ai.slow' : 'ai.unavailable';
      return done({ ...withFacts, route: 'fallback', ...hubOr(key), card, urgent, ms: Date.now() - started });
    }
    const checked = checkAnswer({
      answer: result.answer.text, passageNames: prompt.passages.map((p) => p.name), facts: factsAll, message,
      subject: { name: who.name, pronouns: who.pronouns, self: who.self }, hourOverLimit, readings: modelReadings.readings,
    });
    // A danger question: the hub's under/over verdict decides, and a model answer that disagrees, or doesn't answer, goes.
    if (danger && (checked.by !== 'model' || !agreesWithDanger(checked.text, danger))) {
      const reasons = checked.by === 'model' ? [`it disagrees with the hub: the reading is ${danger.side} the NASA limit`, ...checked.reasons] : checked.reasons;
      return done({ ...withFacts, route: 'answer', by: 'hub', text: replyText(hubAnswer, lang), key: null, card, urgent, check: { discarded: checked.by === 'model' || checked.discarded, reasons, dropped: checked.dropped }, ms: Date.now() - started });
    }
    if (checked.fixed === 'fallback') {
      return done({ ...withFacts, route: 'fallback', ...hubOr('ai.slow'), card, urgent, check: pickCheck(checked), ms: Date.now() - started });
    }
    // "Should I…?" and "Am I ill?": the hub states the facts and the verdict and says plainly it does not
    // recommend or diagnose. A model's words there are never shown, however careful they are.
    // "…compared to yesterday?" with no value from yesterday: the hub says so plainly; the model would answer with today's only.
    const noYesterday = hubAnswer.items.some((i) => i.key === 'answer.noYesterday');
    if ((asksAdviceOrDiagnosis(question) && (hubAnswer.relevant || hubAnswer.items.length > 0)) || noYesterday) {
      // At most two readings beside the hub's fixed line: never a dump.
      return done({ ...withFacts, route: 'answer', by: 'hub', text: replyText(hubAnswer, lang, 1), key: null, card, urgent, check: { discarded: checked.by === 'model', reasons: [noYesterday ? 'no value from yesterday: the hub says so' : 'an advice or diagnosis question: the hub answers it', ...checked.reasons], dropped: checked.dropped }, ms: Date.now() - started });
    }
    // A Portuguese asker: the model writes English and every check reads English only, so its words are never shown.
    // The urgent check above still ran; the hub's own Portuguese sentences answer.
    if (lang === 'pt' && checked.by === 'model') {
      return done({ ...withFacts, route: 'answer', ...hubOr('ai.refusal'), card, urgent, check: { discarded: true, reasons: ['asker-not-english', ...checked.reasons], dropped: checked.dropped }, ms: Date.now() - started });
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

/**
 * A plain question about how one of the person's own readings is ("How is my heart rate?", "How did I sleep?",
 * "Como está a minha frequência cardíaca?"): it names one of the hub's topics and asks nothing about NASA, a cause or a limit.
 */
export function statusQuestion(question: string): boolean {
  const q = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[‘’]/g, "'").trim();
  // "Is it ok / too high / dangerous?" keeps its search: NASA's limit is the source of the hub's verdict.
  if (/\b(nasa|limit\w*|why|por ?que|cause\w*|causa\w*|astronaut\w*|ok|okay|fine|safe|dangerous|high|low|normal|seguro|perigos\w*|alt[oa]|baix[oa])\b/.test(q)) return false;
  if (!TOPICS.some((topic) => topic.re.test(q))) return false;
  return /^(and |e )?(how('s| is| was| are| were| has| have| did i sleep)|how about my|what about my|como (esta|estava|foi|estao|eu dormi)|e (o|a) (meu|minha))\b/.test(q);
}

/**
 * For a plain status question naming one topic, only the readings of that topic; for a tiredness question
 * ("Why am I so tired today?"), only the two or three readings that bear on it; otherwise all of them.
 */
export function focusReadings(readings: PersonReadings, question: string): PersonReadings {
  if (TIRED.test(question) && !/\b(co2|air|room|cabin)\b/i.test(question)) {
    const tired = tirednessReadings(readings.readings);
    if (tired.length) return { ...readings, readings: tired };
  }
  if (!statusQuestion(question)) return readings;
  const q = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const topics = TOPICS.filter((topic) => topic.re.test(q));
  if (topics.length !== 1) return readings;
  const kept = readings.readings.filter((r) => r.type !== 'note' && topics[0].re.test(r.name));
  return kept.length ? { ...readings, readings: kept } : readings;
}

/** The hub's signals behind each body topic a question can name. */
const TOPIC_SIGNALS: Record<string, string[]> = {
  blood_oxygen: ['blood_oxygen'], heart_rate: ['heart_rate', 'resting_heart_rate'], hrv: ['hrv'], sleep: ['sleep_duration'], steps: ['steps'],
};

const NO_RECENT = {
  stale: { en: 'I have no {signal} reading{who} {window}; the last one was {when}.', pt: 'Não tenho leitura de {signal}{who} {window}; a última foi {when}.' },
  none: { en: 'I have no {signal} reading{who} yet.', pt: 'Ainda não tenho leitura de {signal}{who}.' },
  live: { en: 'from the last hour', pt: 'da última hora' },
  daily: { en: 'from the last day and a half', pt: 'do último dia e meio' },
} as const;

/** "at 02:14" today, "on 14 Nov at 02:14" before, in the hub's local time. */
function whenText(at: number, lang: CardLang, now = Date.now()): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (new Date(now).toDateString() === d.toDateString()) return lang === 'pt' ? `às ${hm}` : `at ${hm}`;
  const months = lang === 'pt' ? ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return lang === 'pt' ? `em ${d.getDate()} de ${months[d.getMonth()]} às ${hm}` : `on ${d.getDate()} ${months[d.getMonth()]} at ${hm}`;
}

/**
 * The hub's sentence for a question about one body reading it holds no current value for, or null.
 * Only when the hub can tell (ctx.signalState), the question names exactly one such reading and is not
 * about NASA's text or limits, no current reading of it was handed over, and none of its signals is fresh.
 */
export function noRecentText(ctx: Pick<AskContext, 'signalState' | 'personName'>, question: string, readings: PersonReadings, about: string, self: boolean, lang: CardLang, now = Date.now()): string | null {
  if (!ctx.signalState) return null;
  const q = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\b(nasa|limit\w*|limite\w*|astronaut\w*|in general|em geral|normal range|faixa|why|por ?que)\b/.test(q)) return null;
  const topics = TOPICS.filter((topic) => topic.re.test(q) && TOPIC_SIGNALS[topic.id]);
  if (topics.length !== 1) return null;
  const topic = topics[0];
  if (readings.readings.some((r) => r.type !== 'note' && topic.re.test(r.name))) return null;
  const states = TOPIC_SIGNALS[topic.id].map((signal) => { try { return ctx.signalState!(about, signal); } catch { return { state: 'fresh' as const }; } });
  if (states.some((x) => x.state === 'fresh')) return null;
  const stale = states.filter((x): x is { state: 'stale'; at: number; live: boolean } => x.state === 'stale').sort((a, b) => b.at - a.at)[0];
  const name = ctx.personName?.(about) ?? about;
  const vars: Record<string, string> = {
    signal: lang === 'pt' ? topic.pt.noun : topic.en,
    who: self ? '' : lang === 'pt' ? ` de ${name}` : ` for ${name}`,
    window: stale ? NO_RECENT[stale.live ? 'live' : 'daily'][lang] : '',
    when: stale ? whenText(stale.at, lang, now) : '',
  };
  return NO_RECENT[stale ? 'stale' : 'none'][lang].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
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
