// The emergency's steps, one per page, over the blurred station: the card's own text,
// word for word and in order, under a live drawing of the gesture (the steps rig in
// steps-demo, on a clear canvas) when the medical lead's list maps one to that step.
// A step with no mapped gesture shows its text alone. A "do not" list, if the card
// has one, is its own last page. Left and Right page. It closes only by Done on the last
// page (the owner's rule): no Escape, no tap outside; the blurred backdrop is inert.

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Alert } from '../../../engine/alerts.ts';
import type { CardView } from '../../../engine/cards.ts';
import type { Lang } from '../../../engine/strings.ts';
import { hubAddress, isReplay } from '../data.ts';
import { createStage } from '../steps-demo/stage.ts';
import type { Stage } from '../steps-demo/stage.ts';
import { MOVES, movesReady } from '../steps-demo/moves/index.ts';
import type { Gravity } from '../steps-demo/step.ts';
import { moveFor, variantFor } from './stepMoves.ts';
import './steps.css';

type S = (key: string, vars?: Record<string, string | number>) => string;

interface Props {
  /** The alert whose card is shown; null with `cardId` alone (the dev switch). */
  alert: Alert | null;
  cardId: string;
  /** The mission's gravity in g; null when not known. */
  gravity: number | null;
  lang: Lang;
  s: S;
  onClose: () => void;
}

/** The card as the hub sends it; from the bundled file when the hub cannot be reached (a recorded story). */
export async function loadCard(id: string, lang: Lang): Promise<CardView | null> {
  try {
    if (isReplay()) throw new Error('no hub');
    const res = await fetch(`http://${hubAddress()}/api/cards?lang=${lang}`);
    if (res.ok) {
      const body = (await res.json()) as { cards: CardView[] };
      return body.cards.find((c) => c.id === id) ?? null;
    }
  } catch { /* no hub: read the same file the hub reads */ }
  const [{ parseCards, cardView }, file] = await Promise.all([import('../../../engine/cards.ts'), import('../../../medical/cards.json')]);
  const card = parseCards(file.default).cards.find((c) => c.id === id);
  return card ? cardView(card, lang) : null;
}

/**
 * Centre what is drawn, not the move's scene origin: draw a few times across the loop, find the
 * box of the figures (the bright ink; the floor grid is drawn much fainter) in the canvas, and move
 * and scale the canvas so that box sits in the middle of the area, inside its central 84%, clear of
 * the faded rim. Local to this screen: the move's own camera is untouched.
 */
function centreFigures(st: Stage, duration: number, still: boolean) {
  const canvas = st.element.querySelector('canvas');
  if (!canvas) return;
  canvas.style.transform = '';
  delete st.element.dataset.cropped;
  const W = st.element.clientWidth, H = st.element.clientHeight;
  if (!W || !H) return;
  const k = Math.min(1, 240 / W);
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const probe = document.createElement('canvas');
  probe.width = w; probe.height = h;
  const g = probe.getContext('2d', { willReadFrequently: true });
  if (!g) return;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  const times = still ? [duration / 2] : [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (duration * i) / 8);
  for (const u of times) {
    st.draw(u, still);
    g.clearRect(0, 0, w, h);
    g.drawImage(canvas, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3] > 128 && (px[i] + px[i + 1] + px[i + 2]) / 3 > 140) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return;
  const [bx0, by0, bx1, by1] = [x0 / k, y0 / k, (x1 + 1) / k, (y1 + 1) / k];
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  // A close-up the move frames cut at the bottom (the body runs out of the picture): keep that cut on the
  // area's bottom edge, unfaded, and centre it across only; anything else fits whole in the middle.
  const cropped = y1 >= h - 2;
  const s = cropped ? Math.min(1, (0.84 * W) / (bx1 - bx0)) : Math.min(1, (0.84 * W) / (bx1 - bx0), (0.84 * H) / (by1 - by0));
  const ty = cropped ? H - s * H : H / 2 - s * cy;
  if (cropped) st.element.dataset.cropped = '';
  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = `translate(${(W / 2 - s * cx).toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
}

const reduceQuery = () => matchMedia('(prefers-reduced-motion: reduce)');

/** A step's text cut at its sentence ends, nothing reworded: "A. B (c). D" gives three lines. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9"“])/u).map((t) => t.trim()).filter(Boolean);
}

export function Steps({ alert, cardId, gravity, lang, s, onClose }: Props) {
  const [card, setCard] = useState<CardView | null | 'loading' | 'failed'>('loading');
  const [page, setPage] = useState(0);
  const [ready, setReady] = useState(false);
  const [reduce, setReduce] = useState(() => reduceQuery().matches);
  const [playing, setPlaying] = useState(false);
  const art = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const before = useRef<Element | null>(null);

  useEffect(() => {
    let live = true;
    setCard('loading');
    loadCard(cardId, lang).then((c) => { if (live) setCard(c ?? 'failed'); }, () => { if (live) setCard('failed'); });
    return () => { live = false; };
  }, [cardId, lang]);

  useEffect(() => { void movesReady.then(() => setReady(true)); }, []);
  useEffect(() => {
    const q = reduceQuery();
    const on = () => setReduce(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);

  // Focus goes into the screen when it opens, and back where it was when it closes.
  useEffect(() => {
    before.current = document.activeElement;
    return () => { const back = before.current; if (back instanceof HTMLElement) back.focus({ preventScroll: true }); };
  }, []);

  const view = typeof card === 'object' ? card : null;
  const steps = view?.steps ?? [];
  const doNot = view?.doNot ?? [];
  const total = steps.length + (doNot.length ? 1 : 0);
  const onDoNot = view !== null && page === steps.length && doNot.length > 0;
  const last = page >= total - 1;

  // The move for this page, and the variant for the mission.
  const moveName = view && !onDoNot ? moveFor(view.id, page) : null;
  const move = ready && moveName ? MOVES[moveName] : undefined;
  const variant: Gravity | null = move ? variantFor((['weightless', 'gravity'] as Gravity[]).filter((g) => move.variants[g]), gravity) : null;
  const showArt = Boolean(move && variant);

  // One rig per screen; disposed (and its drawing context released) when the screen closes.
  useEffect(() => {
    if (!showArt || !art.current || stage.current) return;
    stage.current = createStage(art.current, { labels: false, transparent: true });
  }, [showArt]);
  useEffect(() => () => {
    const st = stage.current;
    if (!st) return;
    const canvas = st.element.querySelector('canvas');
    st.dispose();
    (canvas?.getContext('webgl2') ?? canvas?.getContext('webgl'))?.getExtension('WEBGL_lose_context')?.loseContext();
    stage.current = null;
  }, []);

  // Draw: a loop at its own pace, paused while the tab is hidden; a still mid-loop pose under reduced motion.
  useEffect(() => {
    const st = stage.current;
    if (!st || !moveName || !variant) return;
    let clip;
    try { clip = st.show(moveName, variant); } catch { return; }
    const duration = clip.duration;
    centreFigures(st, duration, reduce && !playing);
    const refit = new ResizeObserver(() => centreFigures(st, duration, reduce && !playing));
    refit.observe(st.element);
    if (reduce && !playing) { st.draw(duration / 2, true); return () => refit.disconnect(); }
    let raf = 0;
    let lastT = performance.now();
    let u = 0;
    const tick = (now: number) => {
      u += Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      if (reduce && u >= duration) { setPlaying(false); return; }
      st.draw(u % duration);
      raf = requestAnimationFrame(tick);
    };
    const start = () => { cancelAnimationFrame(raf); if (!document.hidden) { lastT = performance.now(); raf = requestAnimationFrame(tick); } };
    start();
    document.addEventListener('visibilitychange', start);
    return () => { cancelAnimationFrame(raf); refit.disconnect(); document.removeEventListener('visibilitychange', start); };
  }, [moveName, variant, reduce, playing, showArt]);

  // A calm cross-fade between pages, and focus on the step's words.
  const first = useRef(true);
  useEffect(() => {
    setPlaying(false);
    if (!view) return;
    if (!first.current && !reduce) {
      const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-enter')) || 320;
      for (const el of [art.current, text.current]) el?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }
    first.current = false;
    text.current?.focus({ preventScroll: true });
  }, [page, view, reduce]);

  const go = (to: number) => { if (to >= 0 && to < total) setPage(to); };
  const next = () => (last ? onClose() : go(page + 1));

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } // not dismissible: only Done closes it
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (!last) go(page + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(page - 1); }
    else if (e.key === 'Tab') {
      // Keep focus inside the screen.
      const all = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]') ?? [])];
      if (!all.length) return;
      const [a, z] = [all[0], all[all.length - 1]];
      if (e.shiftKey && (document.activeElement === a || document.activeElement === text.current)) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  };

  const title = view?.title ?? '';
  // A title that already names its gravity (her "Cardiac arrest (gravity on)") is not followed by it again.
  const titleSaysGravity = /gravity|gravidade/i.test(title);
  const gravityLine = gravity === null || titleSaysGravity ? null : s(gravity > 0 ? 'steps.gravityOn' : 'steps.gravityOff');
  const label = onDoNot ? s('bench.card.doNot') : s('steps.stepOf', { n: page + 1, total });
  const words = onDoNot ? doNot : view ? [steps[page]] : [];
  const drill = alert?.drill ? s('drill.badge') : null;

  return (
    <div className="steps" ref={dialog} role="dialog" aria-modal="true" aria-label={title || s('steps.loading')} onKeyDown={onKey}>
      <div className="steps-frame frame">
        {view && <p className="steps-top">{[drill, title, gravityLine].filter(Boolean).join(' · ')}</p>}
        <div className="steps-art" data-shown={showArt ? '' : undefined} aria-hidden="true">
          <div ref={art} className="steps-canvas" />
        </div>
        {/* The web demo leaves the review caption out (the owner's decision, 15 Nov); the app itself always shows it. */}
        {showArt && (!isReplay() || (reduce && !playing)) && (
          <p className="steps-caption">
            {!isReplay() && s('steps.caption')}
            {reduce && !playing && <> <button type="button" className="steps-play" onClick={() => setPlaying(true)}>{s('steps.playOnce')}</button></>}
          </p>
        )}
        <div ref={text} className="steps-text" tabIndex={-1} aria-live="polite" aria-atomic="true" data-art={showArt ? '' : undefined} data-donot={onDoNot ? '' : undefined}>
          {card === 'loading' && <p className="steps-line">{s('steps.loading')}</p>}
          {card === 'failed' && <p className="steps-line">{s('steps.failed')}</p>}
          {view && (
            <>
              {onDoNot ? (
                <>
                  <h2 id="steps-donot-title" className="steps-donot-title">
                    <svg className="steps-nosign" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M4.6 4.6L19.4 19.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    {label}
                  </h2>
                  <ul className="steps-donot" aria-labelledby="steps-donot-title">
                    {words.map((w, i) => (
                      <li key={i}>
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M8.25 8.25l7.5 7.5M15.75 8.25l-7.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <p className="steps-label">{label}<span className="steps-sr">. </span></p>
                  {sentences(words[0] ?? '').length > 2 ? (
                    // A long step: the card's own sentences, in order and word for word, one to a line,
                    // so nobody has to read a paragraph in an emergency.
                    <ul className="steps-lines">
                      {sentences(words[0] ?? '').map((line, i) => <li key={i}>{line}</li>)}
                    </ul>
                  ) : (
                    <p className="steps-line">{words[0]}</p>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <div className="steps-nav">
          <button type="button" className="steps-btn" disabled={page === 0 || !view} onClick={() => go(page - 1)}>{s('steps.previous')}</button>
          <button type="button" className="steps-btn steps-btn-solid" onClick={view ? next : onClose}>{view && !last ? s('steps.next') : s('steps.done')}</button>
        </div>
      </div>
    </div>
  );
}
