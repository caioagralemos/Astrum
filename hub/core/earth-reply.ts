// Demo mode only: Earth's simulated reply to each message, at its reply time
// (engine/earth-reply.ts says what it may be). main.ts makes one of these only
// when the hub is not in production, so production never invents a reply.
//
// Each second it looks at the messages listed. One that has reached its reply
// time with no reply gets one: the model's, if the model is ready and its text
// passes every check, otherwise the fixed fallback. Never while a recorded
// story plays (the story carries its own). A privacy-restricted alert, an alert
// the hub can no longer find, and a crisis message never reach the model.
//
// Replies are kept in memory: after a restart, a message past its reply time
// gets a new one. The log says what was shown and why, never the words.

import type { EarthMessage } from '../engine/alerts.ts';
import type { ChatMessage } from '../engine/prompt.ts';
import { buildEarthReplyMessages, checkEarthReply, fallbackReply, isCrisisMessage, replyMinutes, withAiReply } from '../engine/earth-reply.ts';
import type { ReplyFacts } from '../engine/earth-reply.ts';
import { t } from '../engine/strings.ts';

/** The one model process, as the hub's AiRuntime gives it. */
export interface ReplyModel {
  ready: () => boolean;
  chat: (messages: ChatMessage[]) => Promise<string>;
}

export interface EarthRepliesOptions {
  /** Every message listed now, before any reply this makes is put on it. */
  messages: (now: number) => EarthMessage[];
  /** Tells the screens the list changed (a reply came). */
  publish: () => void;
  storyPlaying: () => boolean;
  /** True for a message about a privacy-restricted alert, or one whose alert cannot be found. */
  restricted: (m: EarthMessage) => boolean;
  /** The hub's own facts about the message: the room's name, the kind of alert, and whether a steps card is on screen. */
  facts: (m: EarthMessage) => { room: string | null; alertKind: string | null; card: boolean; digest?: string | null; report?: boolean };
  /** The place's real one-way delay. */
  delayMs: number;
  /** demoEarthReplySeconds: when set, the reply comes this long after sending, and screens say "simulated delay". */
  demoSeconds: number | null;
  rooms: string[];
  names: string[];
  model: ReplyModel | null;
  /** Demo mode only, when GROQ_API_KEY is set: a cloud model tried before the on-board one (core/earth-cloud.ts). */
  cloud?: ReplyModel | null;
  clock?: () => number;
  tickMs?: number;
  log?: (line: string) => void;
}

/** How long the model has for one reply before the fallback is used. */
const MODEL_MS = 20_000;
/** The cloud model's own timeout is 6 s; this is the outer guard. */
const CLOUD_MS = 7_000;

export class EarthReplies {
  private replies = new Map<string, { reply: NonNullable<EarthMessage['reply']>; by: 'cloud' | 'onboard' | 'fixed' }>();
  private fixedOnly = new Map<string, boolean>();
  private working = new Set<string>();
  /** Whether each alert had a steps card, decided when first seen. */
  private cards = new Map<string, boolean>();
  private timer: NodeJS.Timeout | null = null;
  private o: EarthRepliesOptions;
  private clock: () => number;
  private log: (line: string) => void;

  constructor(options: EarthRepliesOptions) {
    this.o = options;
    this.clock = options.clock ?? Date.now;
    this.log = options.log ?? ((line) => console.log(`[earth] ${line}`));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), this.o.tickMs ?? 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** When the reply to a message is due: its real reply time, or the demo's shortened one. */
  dueAt(m: EarthMessage): number {
    return this.o.demoSeconds === null ? m.replyAt : m.sentAt + this.o.demoSeconds * 1000;
  }

  /** The list as screens get it: each simulated reply put on its message, and the demo's shortened delay when set. */
  apply(list: EarthMessage[], now = this.clock()): EarthMessage[] {
    return list.map((m) => {
      let out = m;
      if (this.o.demoSeconds !== null) {
        const replyAt = this.dueAt(m);
        const arrivesAt = m.sentAt + this.o.demoSeconds * 500;
        out = { ...out, arrivesAt, replyAt, delivered: now >= arrivesAt, simulatedDelay: true };
      }
      const made = this.replies.get(m.id);
      return made && !m.reply ? { ...out, reply: made.reply, simulated: 'ai', simulatedBy: made.by } : out;
    });
  }

  /** One look: start a reply for each message that is due and has none. */
  step(now = this.clock()): void {
    if (this.o.storyPlaying()) return;
    for (const m of this.o.messages(now)) {
      if (m.reply || this.replies.has(m.id) || this.working.has(m.id)) continue;
      // Decided when first seen, while its alert is still listed.
      // A crew message never reaches the model: the hub's fixed reply mentions no alert, room or card.
      if (!this.fixedOnly.has(m.id)) this.fixedOnly.set(m.id, m.kind !== 'alert' || this.o.restricted(m) || isCrisisMessage(m));
      if (!this.cards.has(m.id)) this.cards.set(m.id, this.o.facts(m).card);
      const at = this.dueAt(m);
      if (now < at) continue;
      this.working.add(m.id);
      void this.make(m, at).then((reply) => {
        this.working.delete(m.id);
        if (this.o.storyPlaying()) return;
        this.replies.set(m.id, reply);
        this.o.publish();
      });
    }
    // Forget what is no longer listed.
    const listed = new Set(this.o.messages(now).map((m) => m.id));
    for (const id of this.replies.keys()) if (!listed.has(id)) { this.replies.delete(id); this.fixedOnly.delete(id); this.cards.delete(id); }
  }

  /** The reply for one message: the cloud model's (demo, key set), else the on-board model's, else the fixed sentence. Each model's text must pass every check. */
  async make(m: EarthMessage, at: number): Promise<{ reply: NonNullable<EarthMessage['reply']>; by: 'cloud' | 'onboard' | 'fixed' }> {
    const facts: ReplyFacts = { kind: m.kind, ...this.o.facts(m), minutes: replyMinutes(this.o.delayMs) };
    facts.card = this.cards.get(m.id) ?? facts.card;
    // The hub's fixed sentence is the default; a model's text replaces it only if it passes every check on its one try.
    const fixed = (why: string) => {
      this.log(`reply: fixed (${why})`);
      const f = fallbackReply(facts);
      return { reply: withAiReply(m, { text: t(f.key, 'en', f.vars), key: f.key, vars: f.vars }, at).reply!, by: 'fixed' as const };
    };
    // Restricted, crisis and crew messages: nothing is sent anywhere.
    if (this.fixedOnly.get(m.id)) return fixed('not sent to any model');
    const writers: { by: 'cloud' | 'onboard'; model: ReplyModel | null; ms: number }[] = [
      { by: 'cloud', model: this.o.cloud ?? null, ms: CLOUD_MS },
      { by: 'onboard', model: this.o.model, ms: MODEL_MS },
    ];
    const messages = buildEarthReplyMessages(facts);
    for (const w of writers) {
      if (!w.model || !w.model.ready()) continue;
      let raw: string | null = null;
      try {
        raw = await Promise.race([w.model.chat(messages), new Promise<null>((done) => setTimeout(() => done(null), w.ms).unref())]);
      } catch { raw = null; }
      if (raw === null) { this.log(`reply: ${w.by} gave no answer in time`); continue; }
      const verdict = checkEarthReply(raw, facts, { rooms: this.o.rooms, names: this.o.names });
      if (!verdict.ok) { this.log(`reply: ${w.by} failed ${verdict.reasons.length} check(s)`); continue; }
      this.log(`reply: ${w.by}, all checks passed`);
      return { reply: withAiReply(m, { text: verdict.text }, at).reply!, by: w.by };
    }
    return fixed('no model text passed');
  }
}
