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
  clock?: () => number;
  tickMs?: number;
  log?: (line: string) => void;
}

/** How long the model has for one reply before the fallback is used. */
const MODEL_MS = 20_000;

export class EarthReplies {
  private replies = new Map<string, EarthMessage['reply']>();
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
      const reply = this.replies.get(m.id);
      return reply && !m.reply ? { ...out, reply, simulated: 'ai' } : out;
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

  /** The reply for one message: the model's if it passes, else the fixed fallback. */
  async make(m: EarthMessage, at: number): Promise<NonNullable<EarthMessage['reply']>> {
    const facts: ReplyFacts = { kind: m.kind, ...this.o.facts(m), minutes: replyMinutes(this.o.delayMs) };
    facts.card = this.cards.get(m.id) ?? facts.card;
    // The hub's fixed sentence is the default; the model's text replaces it only if it passes every check on its one try.
    const fallback = () => {
      const f = fallbackReply(facts);
      return withAiReply(m, { text: t(f.key, 'en', f.vars), key: f.key, vars: f.vars }, at).reply!;
    };
    if (this.fixedOnly.get(m.id)) { this.log('reply: fixed (not sent to the model)'); return fallback(); }
    if (!this.o.model || !this.o.model.ready()) { this.log('reply: fixed (model not ready)'); return fallback(); }
    let raw: string | null = null;
    try {
      raw = await Promise.race([
        this.o.model.chat(buildEarthReplyMessages(facts)),
        new Promise<null>((done) => setTimeout(() => done(null), MODEL_MS).unref()),
      ]);
    } catch { raw = null; }
    if (raw === null) { this.log('reply: fixed (no model answer in time)'); return fallback(); }
    const verdict = checkEarthReply(raw, facts, { rooms: this.o.rooms, names: this.o.names });
    if (!verdict.ok) { this.log(`reply: fixed (${verdict.reasons.length} check(s) failed)`); return fallback(); }
    this.log('reply: model, all checks passed');
    return withAiReply(m, { text: verdict.text }, at).reply!;
  }
}
