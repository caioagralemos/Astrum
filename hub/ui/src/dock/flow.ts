// How the smart dock moves when its row changes (SmartDock.tsx).
//
// A card that stays glides and resizes into its new place: its frame is drawn
// in pieces (a surface, the two bracket caps, the top and bottom edges) so it
// can change width with transforms alone and its corners and outline stay
// crisp. The surface and edges stretch sideways, which a flat tint and
// horizontal lines take without a trace; the caps only slide. Its content
// never stretches: it slides with the frame's left edge and, when the card
// changes size, the old layout fades out quickly while the new one fades in
// as the frame arrives.
//
// A card that comes rises a few pixels into its place and fades in, after the
// others have started making room (and after any leaving card is gone); a card
// that goes fades and drops, faster.
//
// Edges move on a critically damped spring, so a second change mid-move
// carries on from where the frame is, at the speed it has, without a jump.
// Fades follow the motion ease. Every duration comes from the tokens at the
// top of app.css (--motion-*). Only transform and opacity change while
// moving, written once a frame with no layout read. Under reduced motion the
// row changes at once and a new card only fades in briefly.

export interface Timing {
  /** A move's length, ms: the spring is 99% there by then. */
  move: number;
  /** A leaving card's fade, ms. */
  exit: number;
  /** An arriving card's fade and rise, ms. */
  enter: number;
  /** Delay per place along the row, ms. */
  stagger: number;
  /** How far an arriving card rises, px. */
  rise: number;
  ease: (t: number) => number;
}

/** Position of a critically damped spring heading to 0, `t` seconds after it was at `x` moving at `v`. */
export function spring(x: number, v: number, omega: number, t: number): { x: number; v: number } {
  const e = Math.exp(-omega * t);
  const b = v + omega * x;
  return { x: (x + b * t) * e, v: (v - omega * b * t) * e };
}

/** The spring's stiffness for a move that settles (to 1%) in `ms`. */
export const omegaFor = (ms: number) => 6.64 / (ms / 1000);

/** A CSS cubic-bezier as a function of progress. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  const slope = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s * s;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const d = slope(x1, x2, s);
      if (Math.abs(d) < 1e-6) break;
      s = Math.min(1, Math.max(0, s - (at(x1, x2, s) - t) / d));
    }
    return at(y1, y2, s);
  };
}

const ms = (value: string, fallback: number) => {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return value.trim().endsWith('ms') ? n : value.trim().endsWith('s') ? n * 1000 : n;
};

/** The timing tokens, as app.css sets them now. */
export function readTiming(): Timing {
  const css = getComputedStyle(document.documentElement);
  const curve = css.getPropertyValue('--motion-ease').match(/cubic-bezier\(([^)]+)\)/)?.[1].split(',').map(Number);
  return {
    move: ms(css.getPropertyValue('--motion-move'), 380),
    exit: ms(css.getPropertyValue('--motion-exit'), 200),
    enter: ms(css.getPropertyValue('--motion-enter'), 320),
    stagger: ms(css.getPropertyValue('--motion-stagger'), 30),
    rise: parseFloat(css.getPropertyValue('--motion-rise')) || 8,
    ease: curve?.length === 4 && curve.every(Number.isFinite) ? bezier(curve[0], curve[1], curve[2], curve[3]) : bezier(0.2, 0.8, 0.2, 1),
  };
}

/** A fade from one value to another, starting at `at` (ms), for `dur` ms. */
interface Tween { from: number; to: number; at: number; dur: number }
const still = (value: number): Tween => ({ from: value, to: value, at: 0, dur: 0 });

/** One edge's offset from where its card is laid out, px: at `x` with speed `v` (px/s) at time `at`, still until `hold`. */
interface Edge { x: number; v: number; at: number; hold: number }

interface Card {
  el: HTMLElement;
  left: Edge;
  right: Edge;
  /** 0 (away) to 1 (here): opacity, and the rise or drop. */
  presence: Tween;
  /** The current layout's opacity. */
  content: Tween;
  /** The previous layout's opacity, while it fades out. */
  was: Tween;
  /** Leaving: drops rather than rises, and is let go at the end. */
  leaving: boolean;
  /** Laid-out width, px, when the move began. */
  width: number;
  styled: boolean;
}

/** Where a card is drawn now, relative to the row, and how it is moving. */
export interface Box {
  left: number;
  right: number;
  vLeft: number;
  vRight: number;
  presence: number;
  content: number;
}

export interface Snapshot {
  /** By widget id. */
  boxes: Map<string, Box>;
  /** Each staying card's content as it looks now, to fade out if the card changes size. */
  bodies: Map<string, HTMLElement>;
}

const CAP = 18;

export class DockFlow {
  private cards = new Map<HTMLElement, Card>();
  private frame = 0;
  private omega = omegaFor(380);
  private timing: Timing | null = null;
  private onGone: (key: string) => void;

  constructor(onGone: (key: string) => void) {
    this.onGone = onGone;
  }

  private value(t: Tween, now: number): number {
    if (t.dur <= 0 || now >= t.at + t.dur) return now < t.at ? t.from : t.to;
    if (now <= t.at) return t.from;
    return t.from + (t.to - t.from) * (this.timing?.ease ?? ((p: number) => p))((now - t.at) / t.dur);
  }

  private edge(e: Edge, now: number): { x: number; v: number } {
    if (now <= e.hold) return { x: e.x, v: 0 };
    return spring(e.x, e.v, this.omega, (now - Math.max(e.at, e.hold)) / 1000);
  }

  /** Before the row changes: where every card is drawn, and a copy of each one's content. */
  capture(row: HTMLElement): Snapshot {
    const now = performance.now();
    const base = row.getBoundingClientRect().left - row.scrollLeft;
    const boxes = new Map<string, Box>();
    const bodies = new Map<string, HTMLElement>();
    for (const el of row.querySelectorAll<HTMLElement>(':scope > .dw')) {
      const id = el.dataset.widget;
      if (!id) continue;
      // A leaving copy only fades; it is never where a card comes back from.
      if (el.hasAttribute('data-leaving')) continue;
      const rect = el.getBoundingClientRect();
      const card = this.cards.get(el);
      const l = card ? this.edge(card.left, now) : { x: 0, v: 0 };
      const r = card ? this.edge(card.right, now) : { x: 0, v: 0 };
      boxes.set(id, {
        left: rect.left - base + l.x, right: rect.right - base + r.x, vLeft: l.v, vRight: r.v,
        presence: card ? this.value(card.presence, now) : 1,
        content: card ? this.value(card.content, now) : 1,
      });
      const body = el.querySelector<HTMLElement>(':scope > .dw-body');
      if (body) {
        const copy = body.cloneNode(true) as HTMLElement;
        copy.removeAttribute('style');
        bodies.set(id, copy);
      }
    }
    return { boxes, bodies };
  }

  /** After the row has changed (before paint): send every card from where it was to where it is. */
  play(row: HTMLElement, shot: Snapshot) {
    const now = performance.now();
    const timing = (this.timing = readTiming());
    this.omega = omegaFor(timing.move);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const base = row.getBoundingClientRect().left - row.scrollLeft;
    const els = [...row.querySelectorAll<HTMLElement>(':scope > .dw')];

    // Read everything first.
    const laid = els.map((el) => {
      const rect = el.getBoundingClientRect();
      return { el, left: rect.left - base, right: rect.right - base, width: rect.width };
    });
    for (const el of this.cards.keys()) if (!el.isConnected) this.cards.delete(el);

    const live = laid.filter((c) => !c.el.hasAttribute('data-leaving'));
    const leavingNew = laid.filter((c) => c.el.hasAttribute('data-leaving') && !this.cards.has(c.el));
    const exits = leavingNew.length > 0;
    // Whether any staying card has somewhere to go (an arriving one waits for them, not for nothing).
    const moves = live.some((c) => {
      const was = shot.boxes.get(c.el.dataset.widget ?? '');
      return was && (Math.abs(was.left - c.left) > 1 || Math.abs(was.right - c.right) > 1);
    });

    live.forEach((c, place) => {
      const id = c.el.dataset.widget ?? '';
      const was = shot.boxes.get(id);
      const old = this.cards.get(c.el);
      const zero: Edge = { x: 0, v: 0, at: now, hold: 0 };
      if (reduced) {
        // At once; only a new card fades in, briefly.
        this.cards.set(c.el, {
          el: c.el, left: zero, right: { ...zero }, leaving: false, width: c.width, styled: old?.styled ?? false,
          presence: was ? still(1) : { from: 0, to: 1, at: now, dur: Math.min(160, timing.exit) },
          content: still(1), was: still(0),
        });
        return;
      }
      const delay = place * timing.stagger;
      if (!was) {
        // Arriving: after the others start making room, and after anything leaving has gone.
        // (Once the neighbours are most of the way there, so it never lands on a frame still moving.)
        const start = now + delay + Math.max(exits ? timing.exit * 0.6 : 0, moves ? timing.move * 0.45 : 0);
        this.cards.set(c.el, {
          el: c.el, left: zero, right: { ...zero }, leaving: false, width: c.width, styled: false,
          presence: { from: 0, to: 1, at: start, dur: timing.enter }, content: still(1), was: still(0),
        });
        return;
      }
      const dl = was.left - c.left;
      const dr = was.right - c.right;
      const moving = Math.abs(was.vLeft) + Math.abs(was.vRight) > 1;
      const hold = moving ? 0 : now + delay;
      const resized = Math.abs((was.right - was.left) - c.width) > 1;
      const shrinking = was.right - was.left > c.width;
      const presenceNow = old ? this.value(old.presence, now) : was.presence;
      const card: Card = {
        el: c.el, width: c.width, leaving: false, styled: old?.styled ?? false,
        left: { x: dl, v: was.vLeft, at: now, hold },
        right: { x: dr, v: was.vRight, at: now, hold },
        presence: presenceNow >= 1 ? still(1) : { from: presenceNow, to: 1, at: now, dur: timing.enter * (1 - presenceNow) },
        content: still(1),
        was: still(0),
      };
      // Whatever was still fading carries on from where it is.
      if (old) {
        const c0 = this.value(old.content, now);
        const w0 = this.value(old.was, now);
        if (c0 < 1) card.content = { from: c0, to: 1, at: now, dur: timing.exit * (1 - c0) };
        if (w0 > 0) card.was = { from: w0, to: 0, at: now, dur: timing.exit * 0.55 * w0 };
      }
      if (resized) {
        // The old layout goes quickly; the new one comes in as the frame arrives.
        const holder = c.el.querySelector<HTMLElement>(':scope > .dw-was');
        const copy = shot.bodies.get(id);
        if (holder && copy) {
          holder.replaceChildren(copy);
          holder.style.width = `${was.right - was.left}px`;
          // Shrinking, the old (wider) layout would spill out of the frame: it goes quickly and the
          // new one, which fits, comes early. Growing, the old one fits and stays a little longer.
          card.was = { from: was.content, to: 0, at: now, dur: shrinking ? timing.exit * 0.5 : timing.move * 0.5 };
        }
        card.content = { from: 0, to: 1, at: (hold || now) + timing.move * (shrinking ? 0.1 : 0.35), dur: timing.exit };
      }
      this.cards.set(c.el, card);
    });

    for (const c of leavingNew) {
      const id = c.el.dataset.widget ?? '';
      const from = shot.boxes.get(id)?.presence ?? 1;
      if (reduced) { this.onGone(c.el.dataset.key ?? ''); continue; }
      this.cards.set(c.el, {
        el: c.el, width: c.width, leaving: true, styled: false,
        left: { x: 0, v: 0, at: now, hold: 0 }, right: { x: 0, v: 0, at: now, hold: 0 },
        presence: { from, to: 0, at: now, dur: timing.exit * from }, content: still(1), was: still(0),
      });
    }

    this.draw(now);
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  // The clock the moves were set on (a frame's own timestamp can run on another base).
  private tick = () => {
    this.frame = 0;
    if (this.draw(performance.now())) this.frame = requestAnimationFrame(this.tick);
  };

  /** Write every card's pieces for this moment. True while anything is still moving. */
  private draw(now: number): boolean {
    const dpr = window.devicePixelRatio || 1;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    const rise = this.timing?.rise ?? 8;
    let busy = false;
    for (const card of this.cards.values()) {
      const l = this.edge(card.left, now);
      const r = this.edge(card.right, now);
      const p = this.value(card.presence, now);
      const content = this.value(card.content, now);
      const was = this.value(card.was, now);
      const settled = Math.abs(l.x) < 0.25 && Math.abs(r.x) < 0.25 && Math.abs(l.v) < 4 && Math.abs(r.v) < 4
        && now >= card.left.hold && now >= card.presence.at + card.presence.dur
        && now >= card.content.at + card.content.dur && now >= card.was.at + card.was.dur;

      const [surface, capStart, edge, capEnd] = card.el.querySelectorAll<HTMLElement>(':scope > .dw-frame > i');
      const body = card.el.querySelector<HTMLElement>(':scope > .dw-body');
      const holder = card.el.querySelector<HTMLElement>(':scope > .dw-was');

      if (settled) {
        if (card.leaving) { this.cards.delete(card.el); this.onGone(card.el.dataset.key ?? ''); continue; }
        if (card.styled) {
          for (const piece of [surface, capStart, edge, capEnd, body, holder]) piece?.removeAttribute('style');
          holder?.replaceChildren();
        }
        this.cards.delete(card.el);
        continue;
      }
      busy = true;
      card.styled = true;
      const L = snap(l.x);
      const R = snap(r.x);
      // Arriving rises into place; leaving drops a little less far.
      const y = snap((1 - p) * (card.leaving ? rise * 0.75 : rise));
      const W = card.width;
      const at = (x: number, scale = 1) => `translate3d(${x}px, ${y}px, 0)${scale !== 1 ? ` scaleX(${scale})` : ''}`;
      const set = (piece: HTMLElement | undefined | null, transform: string, opacity: number) => {
        if (!piece) return;
        piece.style.transform = transform;
        piece.style.opacity = String(Math.round(opacity * 1000) / 1000);
        piece.style.willChange = 'transform, opacity';
      };
      set(surface, at(L, W > 0 ? Math.max(0, (W + R - L) / W) : 1), p);
      set(capStart, at(L), p);
      set(capEnd, at(R), p);
      set(edge, at(L, W > 2 * CAP ? Math.max(0, (W - 2 * CAP + R - L) / (W - 2 * CAP)) : 1), p);
      set(body, at(L), p * content);
      if (holder?.firstChild) set(holder, at(L), p * was);
    }
    return busy;
  }

  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
