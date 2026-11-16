// Scroll-scrubbed scenes on desktop. The page keeps native scrolling (wheel,
// trackpad inertia, scrollbar, keys, links); the scroll position drives the scene
// changes. Each scene holds still for a stretch, then hands over to the next:
// unframed scenes slide (the next rises with the scroll, the last drifts up and
// dims); a framed scene closes its four corner brackets to a small square at the
// centre on the way out and opens them out to its corners on the way in.
// Scrolling back plays it in reverse. Ticks at the right edge jump to a scene.
// Off (the ordinary scrolling page) below 1024x640, on touch or coarse pointers,
// under reduced motion, and whenever anything in here throws.

const QUERY = '(min-width: 1024px) and (min-height: 640px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
const FRAMED = '.parts, .demo-scene, .fits-scene, .get';
const HOLD = 0.2, HOLD_FIRST = 0.12; // how long a scene holds still, in viewport heights
const SLIDE = 0.6, BRACKETS = 0.62;   // how long a handover takes, in viewport heights (short: the owner found it took too much scrolling)
const C = 18;                        // corner size, as in .frame
const FAR = 'translateY(200vh)', NEAR = 'translateY(calc(100vh + 40px))';

/** Starts the scroll scenes; returns a teardown. Never throws: on failure the page stays the plain page. */
export function initDeck(): () => void {
  let stop: (() => void) | null = null;
  let mq: MediaQueryList | null = null;
  const sync = () => {
    stop?.(); stop = null;
    if (!mq?.matches) return;
    try { stop = start(() => { stop?.(); stop = null; mq?.removeEventListener('change', sync); }); }
    catch (err) { console.error('scroll scenes off:', err); off(); }
  };
  try { mq = matchMedia(QUERY); sync(); mq.addEventListener('change', sync); }
  catch (err) { console.error('scroll scenes off:', err); off(); }
  return () => { mq?.removeEventListener('change', sync); stop?.(); stop = null; };
}

const root = document.documentElement;
function off() {
  root.classList.remove('deck');
  document.querySelectorAll('.deck-ticks, .deck-brackets').forEach((n) => n.remove());
  document.querySelectorAll<HTMLElement>('.deck-scene').forEach((s) => { s.classList.remove('deck-scene', 'deck-leaving'); s.style.transform = s.style.opacity = s.style.zIndex = s.style.pointerEvents = ''; });
  const main = document.getElementById('main');
  if (main) main.style.height = '';
}

type Seg = { a: number; b: number; over: number }; // hold from a to b (px of scroll); `over`: content taller than the window

function start(fail: () => void): () => void {
  const main = document.getElementById('main')!;
  const footerEl = document.querySelector<HTMLElement>('#root > footer');
  const scenes = [...main.querySelectorAll<HTMLElement>(':scope > .scene')];
  if (scenes.length < 3 || !footerEl) throw new Error('no scenes');
  const n = scenes.length;
  const all = [...scenes, footerEl];
  const framed = scenes.map((s) => s.matches(FRAMED));
  const frames = scenes.map((s) => s.querySelector<HTMLElement>(':scope > .frame'));

  // Which scene is on screen now (or named by the hash), before the layout changes.
  const mid = innerHeight / 2;
  let startAt = scenes.findIndex((s) => { const r = s.getBoundingClientRect(); return r.top <= mid && r.bottom > mid; });
  const t0 = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  if (t0 && t0 !== main) { const k = all.findIndex((s) => s.contains(t0)); if (k >= 0) startAt = k; }

  root.classList.add('deck');
  all.forEach((s) => s.classList.add('deck-scene'));

  // Overlay corners for the bracket handovers, the weight and colour of .frame's.
  const layer = document.createElement('div');
  layer.className = 'deck-brackets';
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = true;
  const marks = [0, 1, 2, 3].map((k) => { const m = document.createElement('i'); m.className = `c${k}`; layer.append(m); return m; });
  document.body.append(layer);

  // Ticks.
  const ticks = document.createElement('nav');
  ticks.className = 'deck-ticks';
  ticks.setAttribute('aria-label', 'Scenes');
  const buttons = scenes.map((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', document.getElementById(s.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() || `Scene ${i + 1}`);
    b.addEventListener('click', () => goTo(i));
    ticks.append(b);
    return b;
  });
  document.body.append(ticks);

  // ---- Layout, cached; recomputed on resize ----
  let vh = innerHeight, segs: Seg[] = [], rects: (DOMRect | null)[] = [], footH = 0, end = 0;
  const last = new Map<HTMLElement, string>();
  function layout() {
    vh = innerHeight;
    all.forEach((s) => { s.style.transform = 'none'; });
    footH = footerEl!.offsetHeight;
    rects = scenes.map((s, i) => {
      const f = frames[i];
      if (!f) return null;
      const r = f.getBoundingClientRect(), top = r.top - s.getBoundingClientRect().top;
      return new DOMRect(r.left, top, r.width, Math.min(r.height, vh - top));
    });
    let y = 0;
    segs = scenes.map((s, i) => {
      const over = Math.max(0, s.offsetHeight - vh);
      const a = y, b = a + (i ? HOLD : HOLD_FIRST) * vh + over;
      y = b + (i < n - 1 ? (framed[i] || framed[i + 1] ? BRACKETS : SLIDE) * vh : footH);
      return { a, b, over };
    });
    end = y;
    main.style.height = `${end + vh}px`;
    last.clear();
  }

  // Style writes only when a value changes.
  function put(el: HTMLElement, tf: string, op = 1, z = 1) {
    const key = `${tf}|${op}|${z}`;
    if (last.get(el) === key) return;
    last.set(el, key);
    el.style.transform = tf;
    el.style.opacity = op >= 1 ? '' : String(Math.max(0, op));
    el.style.zIndex = String(z);
    el.style.pointerEvents = op < 0.5 ? 'none' : '';
  }

  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const spots = (r: DOMRect) => [[r.left - 1, r.top - 1], [r.right + 1 - C, r.top - 1], [r.left - 1, r.bottom + 1 - C], [r.right + 1 - C, r.bottom + 1 - C]];
  const square = () => { const s = 44; return new DOMRect(innerWidth / 2 - s / 2, vh / 2 - s / 2, s, s); };
  /** Corners from `from`'s corners (t = 0) to the closed square at the centre (t = 1). */
  function bracketsAt(from: DOMRect | null, t: number, alpha: number) {
    if (!from || alpha <= 0) { layer.hidden = true; return; }
    const p0 = spots(from), p1 = spots(square()), e = ease(t);
    marks.forEach((m, k) => { m.style.transform = `translate(${p0[k][0] + (p1[k][0] - p0[k][0]) * e}px, ${p0[k][1] + (p1[k][1] - p0[k][1]) * e}px)`; });
    layer.style.opacity = alpha >= 1 ? '' : String(alpha);
    layer.hidden = false;
  }

  let current = -1, leaving: HTMLElement | null = null;
  function setCurrent(i: number) {
    if (i === current) return;
    current = i;
    buttons.forEach((b, k) => b.toggleAttribute('aria-current', k === i));
  }
  // A scene on its way out stops drawing its 3D (scene3d.ts checks this class).
  function setLeaving(el: HTMLElement | null) {
    if (el === leaving) return;
    leaving?.classList.remove('deck-leaving');
    leaving = el;
    el?.classList.add('deck-leaving');
  }

  // The current scene's neighbours wait just below the fold once the page is idle, so their 3D and clips warm up a step ahead.
  let warmFor = -1;
  const near = new Set<number>();
  function warm(i: number) {
    if (warmFor === i) return;
    warmFor = i;
    const go = () => { if (warmFor !== i) return; near.clear(); [i - 1, i + 1].forEach((k) => { if (k >= 0 && k < n) near.add(k); }); frame(); };
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1200 }); else setTimeout(go, 300);
  }

  /** Places everything for the current scroll position. */
  function frame() {
    const y = Math.min(Math.max(scrollY, 0), end);
    let i = segs.findIndex((_, k) => k === n - 1 || y < segs[k + 1].a);
    if (i < 0) i = n - 1;
    const s = segs[i];
    const shown = new Set<number>();

    if (y <= s.b) {
      // Holding scene i; a tall scene moves its content up during the hold.
      const shift = s.over ? -s.over * clamp((y - s.a) / (s.b - s.a)) : 0;
      put(scenes[i], shift ? `translateY(${shift}px)` : 'none', 1, 2); shown.add(i);
      put(footerEl!, 'translateY(110%)', 1, 0);
      layer.hidden = true; setLeaving(null); setCurrent(i);
    } else if (i === n - 1) {
      // Into the footer: it rises under the last scene, which moves up to make room.
      const t = clamp((y - s.b) / footH);
      put(scenes[i], `translateY(${-s.over - footH * t}px)`, 1, 2); shown.add(i);
      put(footerEl!, `translateY(${(1 - t) * 100}%)`, 1, 4);
      layer.hidden = true; setLeaving(null); setCurrent(i);
    } else {
      const j = i + 1, t = clamp((y - s.b) / (segs[j].a - s.b));
      const A = scenes[i], B = scenes[j];
      shown.add(i); shown.add(j);
      put(footerEl!, 'translateY(110%)', 1, 0);
      setCurrent(t < 0.5 ? i : j);
      setLeaving(t < 0.5 ? null : A);
      if (!framed[i] && !framed[j]) {
        // Slide: the next scene rises with the scroll; this one drifts up and dims.
        put(A, `translateY(${-s.over - 0.3 * t * vh}px)`, 1 - 0.75 * t, 2);
        put(B, `translateY(${(1 - t) * vh}px)`, 1, 3);
        layer.hidden = true;
      } else {
        const u = clamp(t * 2), v = clamp(t * 2 - 1);
        // First half: this scene closes its frame, or slides away.
        if (framed[i]) put(A, s.over ? `translateY(${-s.over}px)` : 'none', clamp(1 - u / 0.7), 2);
        else put(A, `translateY(${-s.over - 0.3 * u * vh}px)`, 1 - u, 2);
        // Second half: the next scene opens its frame, or rises in.
        if (framed[j]) put(B, 'none', clamp((v - 0.3) / 0.7), 3);
        else put(B, `translateY(${(1 - ease(v)) * vh}px)`, v > 0 ? 1 : 0, 3);
        // The corners close on A's frame, then open on B's; a lone closed square fades in or out.
        if (t < 0.5) bracketsAt(framed[i] ? rects[i] : rects[j], framed[i] ? u : 1, framed[i] ? 1 : u);
        else bracketsAt(framed[j] ? rects[j] : rects[i], framed[j] ? 1 - v : 1, framed[j] ? 1 : 1 - v);
      }
    }
    scenes.forEach((sc, k) => { if (!shown.has(k)) put(sc, near.has(k) ? NEAR : FAR, 1, 0); });
    warm(current);
  }

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; try { frame(); } catch (err) { console.error('scroll scenes off:', err); fail(); } });
  };
  const onResize = () => { const r = end ? scrollY / end : 0; layout(); scrollTo({ top: r * end, behavior: 'instant' as ScrollBehavior }); frame(); };

  /** Scrolls to scene i's hold (the footer: the very end). */
  function goTo(i: number, smooth = true) {
    const top = i >= n ? end : segs[i].a + Math.min(4, segs[i].b - segs[i].a);
    scrollTo({ top, behavior: smooth ? 'smooth' : ('instant' as ScrollBehavior) });
  }

  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element).closest?.('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const id = decodeURIComponent(a.getAttribute('href')!.slice(1));
    const t = id ? document.getElementById(id) : null;
    if (!t || t === main) return;
    const i = all.findIndex((s) => s.contains(t));
    if (i < 0) return;
    e.preventDefault();
    history.replaceState(null, '', `#${id}`);
    goTo(i);
  };
  // Keyboard focus landing in another scene brings that scene on screen.
  const onFocus = (e: FocusEvent) => {
    const i = all.findIndex((s) => s.contains(e.target as Node));
    if (i >= 0 && i < n && i !== current) goTo(i, false);
    if (i === n) goTo(n, false);
  };

  layout();
  if (startAt > 0) goTo(startAt, false);
  frame();
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onResize);
  document.addEventListener('click', onClick);
  document.addEventListener('focusin', onFocus);

  return () => {
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onResize);
    document.removeEventListener('click', onClick);
    document.removeEventListener('focusin', onFocus);
    const at = scenes[Math.max(0, current)];
    setLeaving(null);
    off();
    at.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
  };
}
