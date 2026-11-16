// The product page, drawn in the hub's own Projection look: near-black ground,
// white line-drawn models, corner-bracket frames over a faint grid. Each part
// of the system gets a full scene. Detail lives in docs/about.md in the repo.

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { LogoLight } from './Orbit.tsx';
import type { Footage, Kind } from './scene3d.ts';
import { initDeck } from './deck.ts';

const REPO = 'https://github.com/caioagralemos/Astrum';
const RELEASES = `${REPO}/releases`;
const ABOUT = `${REPO}/blob/main/docs/about.md`;
const MAC = `${RELEASES}/latest/download/Astrum-1.0.0-mac.zip`;
const WIN = `${RELEASES}/latest/download/Astrum-1.0.0-win-x64.zip`;
const PHONE = `${REPO}/tree/main/phone`;
const CHIP = `${REPO}/tree/main/chip`;
const FIRMWARE = `${RELEASES}/latest/download/Astrum-board-firmware-0.3-esp32.bin`;
// The hub's own interface, built into public/demo/ by `npm run demo`, playing
// the recorded story from static files. A plain link, not an iframe.
const DEMO = './demo/index.html?replay=random';

const DOES = [
  { title: 'It knows your normal.', body: 'Each reading is compared with that crewmate’s own usual range.', video: './media/normal.mp4', label: 'A crewmate’s readings shown against their own usual range' },
  { title: 'It tells the right person.', body: 'First you, then the Crew Medical Officer, then everyone.', video: './media/tells.mp4', label: 'An alert stepping up from the crewmate to the medical officer to the crew' },
  { title: 'It stays until it’s over.', body: 'First-aid steps, approved by our medical lead.', video: './media/steps.mp4', label: 'First-aid steps shown one at a time on the hub' },
  { title: 'It answers on board.', body: 'Astra answers from the hub’s readings and NASA’s text.', video: './media/astra.mp4', label: 'Astra answering a question on the hub' },
];

// The sheets behind "Learn more". Owner-approved text, verbatim.
type SheetContent = { title: string; body: string[]; links?: { label: string; href: string; note: string }[]; fine?: string; sources?: boolean; video?: string; label?: string };

const ARTICLES: SheetContent[] = [
  { title: "It knows your normal.", body: [
    "Astrum keeps a baseline for every crewmate: their own usual range for each reading, built from their own history, asleep and awake.",
    "A reading is flagged only when it leaves that person's range and stays out for at least 20 minutes. Then the hub shows what the flag is based on: the reading, the person's history, the air in the room, who else was there, and what they reported. It says where the evidence points: the room, the person or a sensor.",
    "Where the readings come from: the iPhone app reads Apple Health on the crewmate's own phone, through Apple's HealthKit, with their permission. That includes what an Apple Watch records: heart rate, resting heart rate, heart rate variability, blood oxygen, breathing rate, sleep, steps, exercise minutes and sound level. The app sends them to the hub over the ship's Wi-Fi. The cabin board sends the room's readings by USB, and the daily check-in adds what the person reports.",
    "In the demo the crew is simulated, and every simulated value is labelled on screen.",
  ] },
  { title: "It tells the right person.", body: [
    "There are three levels.",
    "Level 1 tells only the person, and never while they sleep.",
    'Level 2 asks "Are you OK?" on their phone and tells the Crew Medical Officer. If the medical officer is the one affected, the commander is told instead.',
    'Level 3 comes with "I need help" or 60 seconds without an answer. Everyone is told: on the hub, on every phone, and by the cabin board\'s buzzer.',
    "In a psychological crisis the hub says only that the person needs someone with them. Their words are never shown.",
  ] },
  { title: "It stays until it's over.", body: [
    'The emergency screen shows who, where, the reading against NASA\'s limit, and the first thing to do. "Start help" opens a card one step at a time, with the gesture drawn beside it and a page of what not to do.',
    "There are 42 cards. Each was drafted with an AI tool, then reviewed, corrected and approved line by line by our medical lead. The on-board AI never writes a step. Most steps are not yet checked against a published source, and each card lists what is unchecked.",
    "A top-level emergency files a report to Earth, and the hub counts the delay until a reply can arrive.",
  ] },
  { title: "It answers on board.", body: [
    "Astra is a small language model, LFM3 with 1.7 billion parameters, running on the hub's own computer through llama.cpp. It needs no internet.",
    "It answers from two things only: the facts the hub writes from its readings, and 90 passages from 26 NASA pages, quoted word for word with their source. Its own wording is shown only when it passes the hub's checks; otherwise the crew sees the hub's sentence.",
    "In our test of 96 questions, no unsafe answer was shown. 84 passed, 6 were shown incomplete, and 6 were discarded and replaced with a fixed refusal. Astra answers in English only.",
  ] },
].map((a, i) => ({ ...a, sources: true, video: DOES[i].video, label: DOES[i].label }));

const BUILD_BOARD: SheetContent = {
  title: 'Build your board.',
  body: ['The board is an ESP32 DevKit with a few sensors and a buzzer. Wire it from the blueprint, flash the firmware, plug it into the hub by USB.'],
  links: [
    { label: 'Wiring blueprint (PDF)', href: `${REPO}/blob/main/chip/wiring-blueprint.pdf`, note: 'Every part, pin by pin.' },
    { label: 'Firmware, ready to flash', href: FIRMWARE, note: 'One file for the ESP32.' },
    { label: 'Source and instructions', href: CHIP, note: "The firmware's code and the steps." },
  ],
};

// In the scene with the three parts: the Mars base on a calm day.
const HUB_CLIP: Footage[] = [{ src: './media/hub-base.mp4', poster: './media/hub-base-poster.jpg' }];
// The hub's own scene shows a different moment: the exercise bay, two crewmates at work in it.
const HUB_GYM: Footage[] = [{ src: './media/hub-gym.mp4', poster: './media/hub-gym-poster.jpg' }];
const PHONE_CLIPS: Footage[] = [{ src: ['./media/phone-heart.mp4', './media/phone-areyouok.mp4'] }];

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A silent recording. Plays only while on screen; under reduced motion it holds a still with controls. */
function Clip({ src, label, poster, className = 'clip', w = 1600, h = 900, decor = false, always = false }: { src: string; label?: string; poster?: string; className?: string; w?: number; h?: number; decor?: boolean; always?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const still = poster ?? src.replace(/\.mp4$/, '-poster.jpg');
  const [slow] = useState(slowLink);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (slow) return;                                  // its still picture only: the clip is not fetched
    const stop = () => { v.pause(); v.removeAttribute('autoplay'); };
    window.addEventListener('astrum-lite', stop);
    if (lite) { stop(); return () => window.removeEventListener('astrum-lite', stop); }
    if (reducedMotion()) {
      v.removeAttribute('autoplay');
      v.pause();
      v.controls = !decor;
      if (!poster) v.addEventListener('loadedmetadata', () => { v.currentTime = Math.min(2, v.duration / 2); }, { once: true });
      return;
    }
    if (always) {
      // In a sheet: it exists only while the sheet is open, so it simply plays, and keeps trying until it does
      // (the on-screen check below proved unreliable inside a dialog: the clip sat on its first frame).
      const go = () => { if (v.paused) v.play().catch(() => {}); };
      v.preload = 'auto';
      go();
      v.addEventListener('loadeddata', go); v.addEventListener('canplay', go);
      const timer = window.setInterval(go, 400);
      return () => { window.clearInterval(timer); v.removeEventListener('loadeddata', go); v.removeEventListener('canplay', go); window.removeEventListener('astrum-lite', stop); };
    }
    const io = new IntersectionObserver(([e]) => (e.isIntersecting && !lite ? v.play().catch(() => {}) : v.pause()), { threshold: 0.1 });
    io.observe(v);
    return () => { io.disconnect(); window.removeEventListener('astrum-lite', stop); };
  }, [poster, decor, slow]);
  if (slow) return <img className={className} src={still} alt={decor ? '' : label ?? ''} aria-hidden={decor || undefined} width={w} height={h} decoding="async" loading="lazy" />;
  return <video ref={ref} className={className} src={src} poster={still} aria-label={label} aria-hidden={decor || undefined} tabIndex={decor ? -1 : undefined} autoPlay muted loop playsInline preload="metadata" width={w} height={h} />;
}

/** A slow or metered connection (the browser says so): the page then keeps to pictures. */
const slowLink = () => {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return Boolean(c && (c.saveData || /(^|-)2g$|^3g$/.test(c.effectiveType ?? '')));
};
let lite = false;
/** Pictures instead of motion from now on: clips stop where they are, nothing new is fetched. */
const goLite = () => { if (lite) return; lite = true; window.dispatchEvent(new Event('astrum-lite')); };
const STILL: Record<Kind, string> = { hub: './media/model-hub.jpg', app: './media/model-app.jpg', board: './media/model-board.jpg' };

/**
 * A line-drawn model. A still picture of it (taken from the 3D itself, facing front) shows first; the 3D code
 * loads only when the scene comes near and then takes over. The picture stays, with no 3D at all, when there is
 * no WebGL, on a slow or metered connection, or when the computer cannot keep up even at the lightest setting.
 */
function Model({ kind, className, speed, footage }: { kind: Kind; className?: string; speed?: number; footage?: Footage[]; fallback?: ReactNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'still' | 'live' | 'off'>('still');
  const clips = JSON.stringify(footage ?? []);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    if (slowLink()) { setState('off'); return; }
    let dispose: (() => void) | undefined;
    let dead = false;
    const giveUp = () => { dispose?.(); dispose = undefined; if (!dead) setState('off'); goLite(); };
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      import('./scene3d.ts')
        .then(({ mount }) => mount(c, kind, { speed, footage: JSON.parse(clips) as Footage[], onSlow: giveUp }))
        .then((m) => { if (dead) m?.dispose(); else if (m) { dispose = m.dispose; setState('live'); } else setState('off'); })
        .catch(() => setState('off'));
    }, { rootMargin: '600px 0px' });
    io.observe(c);
    return () => { dead = true; io.disconnect(); dispose?.(); };
  }, [kind, speed, clips]);
  const cls = `model${className ? ' ' + className : ''}`;
  return (
    <>
      {state !== 'live' && <img className={`${cls} model-still`} src={STILL[kind]} alt="" aria-hidden="true" decoding="async" loading="lazy" />}
      <canvas ref={ref} className={cls} aria-hidden="true" hidden={state === 'off'} />
    </>
  );
}

/** The Projection frame: corner brackets over a faint grid. */
function Frame({ children, className = '', as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'figure' }) {
  return <Tag className={`frame ${className}`}><i aria-hidden="true" />{children}</Tag>;
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="actions">{children}</div>;
}

type Node = { x: number; y: number; name: string; via: string; model?: 'app' | 'board'; glyph?: 'screen' | 'earth'; w: number; h: number; dashed?: boolean; light?: boolean; t?: number };

/** The Earth button's icon from the hub's top bar (hub/ui/src/panels/MainPanels.tsx), on a 24-unit grid. */
const EARTH_PATH = 'M8.2 4.4c.3 1.3-.6 2-1.5 2.7-.9.7-1.2 1.7-.5 2.6.7.9 2 .7 2.8 1.5.8.8.3 2 .9 2.9.5.8 1.6.9 1.8 1.9.2 1-.6 1.8-.5 2.8.1.6.4 1.1.9 1.6M14.6 3.9c-.7.9-.3 1.9.6 2.4.9.5 2 .2 2.7 1 .6.7.2 1.7.9 2.4.4.4 1 .5 1.5.4M15.2 13.2c.9-.5 2-.2 2.5.6.5.8.1 1.8-.6 2.4-.5.4-.8.9-.8 1.6';

/** Where the hub sits among the other parts: the line models on the nodes, thin links, small tags. */
function Fits({ narrow = false, art }: { narrow?: boolean; art: Record<string, string> | null }) {
  // Wide: the hub in the middle, two parts each side. Narrow (phones): a taller sheet, bigger words.
  const W = narrow ? 600 : 1100, H = narrow ? 1120 : 580, f = narrow ? 1.5 : 1;
  const C = narrow ? { x: 300, y: 440, w: 500, h: 340 } : { x: 550, y: 280, w: 450, h: 312 };
  const ends: Node[] = narrow ? [
    { x: 130, y: 150, name: 'iPhones', via: 'Wi-Fi', model: 'app', w: 130, h: 160 },
    { x: 470, y: 150, name: 'Other screens', via: 'Same view', glyph: 'screen', w: 84, h: 68, light: true },
    { x: 130, y: 960, name: 'Cabin boards', via: 'USB', model: 'board', w: 200, h: 145, t: 0.72 },
    { x: 470, y: 990, name: 'Earth', via: 'Messages, with the delay counted', glyph: 'earth', w: 90, h: 90, dashed: true, t: 0.7 },
  ] : [
    { x: 170, y: 150, name: 'iPhones', via: 'Wi-Fi', model: 'app', w: 140, h: 175 },
    { x: 170, y: 440, name: 'Cabin boards', via: 'USB', model: 'board', w: 210, h: 150 },
    { x: 930, y: 150, name: 'Other screens', via: 'Same view', glyph: 'screen', w: 70, h: 56, light: true },
    { x: 940, y: 440, name: 'Earth', via: 'Messages, with the delay counted', glyph: 'earth', w: 76, h: 76, dashed: true, t: 0.6 },
  ];
  return (
    <svg className={narrow ? 'fits narrow' : 'fits wide'} viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={narrow ? 'fits-alt-n' : 'fits-alt'}>
      <title id={narrow ? 'fits-alt-n' : 'fits-alt'}>The hub in the centre, drawn as a ship’s console: a Mac or Windows app. iPhones connect to it over Wi-Fi, each bringing its owner’s Apple Watch readings through HealthKit, and cabin boards over USB; other screens can show the same view. A dashed link to Earth carries messages, with the delay counted. Everything is stored and decided on the hub; nothing depends on a link to Earth.</title>
      {/* The models' stills are thin translucent lines: their strength is raised to match the drawn glyphs and links. */}
      <defs><filter id={narrow ? 'fits-boost-n' : 'fits-boost'} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB"><feComponentTransfer><feFuncA type="linear" slope="2.4" /></feComponentTransfer></filter></defs>
      {ends.map((e) => {
        // Trim each link so it runs from the console's edge to the part's edge.
        const dx = e.x - C.x, dy = e.y - C.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
        const a = Math.min(C.w * 0.4, C.h * 0.62 / Math.abs(uy || 1e-6), C.w * 0.42 / Math.abs(ux || 1e-6));
        const b = Math.max(e.w, e.h) * 0.55;
        const x1 = C.x + ux * a, y1 = C.y + uy * a, x2 = e.x - ux * b, y2 = e.y - uy * b;
        const t = e.t ?? 0.5, w = (e.via.length * 7.4 + 22) * f;
        const mx = Math.min(Math.max(x1 + (x2 - x1) * t, w / 2 + 4), W - w / 2 - 4), my = y1 + (y2 - y1) * t;
        return (
          <g key={e.name} className={e.light ? 'fits-light' : undefined}>
            <line className={e.dashed ? 'fits-link dashed' : 'fits-link'} x1={x1} y1={y1} x2={x2} y2={y2} />
            <g transform={`translate(${mx} ${my})`}>
              <rect className="fits-via" x={-w / 2} y={-13 * f} width={w} height={26 * f} rx={3} />
              <text className="fits-via-text" textAnchor="middle" y={5 * f} fontSize={13 * f}>{e.via}</text>
            </g>
            <g transform={`translate(${e.x} ${e.y})`}>
              {e.model && art?.[e.model]
                ? <image filter={`url(#${narrow ? 'fits-boost-n' : 'fits-boost'})`} href={art[e.model]} x={-e.w / 2} y={-e.h / 2} width={e.w} height={e.h} />
                : e.model === 'app' ? <rect className="fits-glyph" x={-e.h * 0.25} y={-e.h * 0.5} width={e.h * 0.5} height={e.h} rx={10} />
                : e.model === 'board' ? <rect className="fits-glyph" x={-e.w * 0.4} y={-e.h * 0.3} width={e.w * 0.8} height={e.h * 0.6} rx={4} />
                : e.glyph === 'screen' ? <path className="fits-glyph" d={`M${-e.w / 2} ${-e.h / 2}h${e.w}v${e.h * 0.72}h${-e.w}Z M0 ${e.h * 0.22}v${e.h * 0.2} M${-e.w * 0.22} ${e.h / 2}h${e.w * 0.44}`} />
                : <g className="fits-glyph" transform={`scale(${e.w / 24}) translate(-12 -12)`}><circle cx="12" cy="12" r="8.5" vectorEffect="non-scaling-stroke" /><path d={EARTH_PATH} vectorEffect="non-scaling-stroke" /></g>}
              <text className="fits-name" textAnchor="middle" y={e.y < C.y ? -e.h / 2 - 14 * f : e.h / 2 + 30 * f} fontSize={(e.light ? 18 : 22) * f}>{e.name}</text>
            </g>
          </g>
        );
      })}
      {(() => {
        // The Apple Watch reaches the hub through its owner's iPhone (Apple Health, HealthKit): drawn beside the phones.
        const phone = ends[0];
        const wx = narrow ? phone.x + 150 : phone.x + 144, wy = narrow ? phone.y - 6 : phone.y - 82, k = narrow ? 1.25 : 1;
        // The link: level on the narrow drawing; on the wide one the watch sits up and to the right of the phone, so it runs at a slant.
        const from = phone.x + phone.w * 0.36, to = wx - 26 * k;
        const y1 = narrow ? wy : phone.y - 34, y2 = narrow ? wy : wy + 14;
        return (
          <g>
            <line className="fits-link" x1={from} y1={y1} x2={to} y2={y2} />
            <g transform={`translate(${wx} ${wy}) scale(${k})`}>
              <path className="fits-glyph" d="M-11 -18h22a6 6 0 0 1 6 6v24a6 6 0 0 1-6 6h-22a6 6 0 0 1-6-6v-24a6 6 0 0 1 6-6Z M-9 -18l2-12h14l2 12 M-9 18l2 12h14l2-12 M17 -6h3v8h-3" vectorEffect="non-scaling-stroke" />
            </g>
            <text className="fits-name" textAnchor="middle" x={wx} y={wy - 44 * k} fontSize={18 * f}>Apple Watch</text>
            <text className="fits-via-text" textAnchor="middle" x={wx} y={wy + 52 * k} fontSize={13 * f}>HealthKit</text>
          </g>
        );
      })()}
      <g transform={`translate(${C.x} ${C.y})`}>
        {art?.hub
          ? <image filter={`url(#${narrow ? 'fits-boost-n' : 'fits-boost'})`} href={art.hub} x={-C.w / 2} y={-C.h / 2} width={C.w} height={C.h} />
          : <rect className="fits-glyph" x={-C.w * 0.3} y={-C.h * 0.25} width={C.w * 0.6} height={C.h * 0.5} rx={10} />}
        <text className="fits-hub-text" textAnchor="middle" y={C.h / 2 + 26 * f} fontSize={26 * f}>The hub</text>
        <g transform={`translate(0 ${C.h / 2 + 52 * f})`}>
          <rect className="fits-via" x={-77 * f} y={-13 * f} width={154 * f} height={26 * f} rx={3} />
          <text className="fits-via-text" textAnchor="middle" y={5 * f} fontSize={13 * f}>Mac or Windows app</text>
        </g>
      </g>
    </svg>
  );
}

/** The diagram scene. The three models are rendered once, as stills, when the scene comes near. */
function FitsScene() {
  const ref = useRef<HTMLElement>(null);
  const [art, setArt] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let dead = false;
    if (slowLink() || lite) return;                    // plain outlines stand in for the models; no 3D is fetched
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      import('./scene3d.ts')
        .then(({ stills }) => stills([
          { kind: 'hub', w: 900, h: 624, yaw: 0.32 },
          { kind: 'app', w: 280, h: 350, yaw: -0.5 },
          { kind: 'board', w: 420, h: 300, yaw: -0.6 },
        ]))
        .then((img) => { if (!dead && img) setArt({ hub: img[0], app: img[1], board: img[2] }); })
        .catch(() => {});
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => { dead = true; io.disconnect(); };
  }, []);
  return (
    <section ref={ref} className="scene fits-scene" aria-labelledby="fits-title">
      <Frame className="fits-frame">
        <h2 id="fits-title">How it fits together.</h2>
        <Fits art={art} />
        <Fits narrow art={art} />
        <p className="fits-line">Everything is stored and decided on the hub. Nothing depends on a link to Earth.</p>
      </Frame>
    </section>
  );
}

/** The in-page sheet behind "Learn more": a modal dialog in the hub's frame look. */
function Sheet({ content: a, onClose }: { content: SheetContent | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || !a) return;
    opener.current = document.activeElement;
    d.showModal();
    d.querySelector<HTMLElement>('.sheet-close')?.focus();
    document.documentElement.classList.add('locked');
    return () => {
      document.documentElement.classList.remove('locked');
      if (d.open) d.close();
      (opener.current as HTMLElement | null)?.focus();
    };
  }, [a]);
  // Keep Tab inside the sheet.
  const trap = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab') return;
    const f = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button')];
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <dialog ref={ref} className={a?.video ? 'sheet wide' : 'sheet'} aria-modal="true" aria-labelledby="sheet-title" onCancel={(e) => { e.preventDefault(); onClose(); }} onKeyDown={trap}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {a && (
        <Frame className="sheet-frame">
          <button className="sheet-close" type="button" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7L7 17" /></svg>
          </button>
          <div className="sheet-body">
            {a.video && <figure className="sheet-media"><Clip key={a.video} src={a.video} label={a.label} always /></figure>}
            <div className="sheet-text">
              <h2 id="sheet-title">{a.title}</h2>
              {a.body.map((p) => <p key={p}>{p}</p>)}
              {a.links && (
                <ul className="sheet-links">
                  {a.links.map((l) => <li key={l.href}><a href={l.href} {...(l.href === FIRMWARE ? {} : { target: '_blank', rel: 'noopener' })}>{l.label}</a><span>{l.note}</span></li>)}
                </ul>
              )}
              {a.fine && <p className="fine">{a.fine}</p>}
              {a.sources && <a className="sheet-link" href={ABOUT} target="_blank" rel="noopener">Results, limits and sources</a>}
            </div>
          </div>
        </Frame>
      )}
    </dialog>
  );
}

/** What it does: four rows, a large clip each, lightly told; the depth is behind "Learn more". */
function Does() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="scene does" aria-labelledby="does-title">
      <h2 id="does-title">What it does.</h2>
      <ol className="does-rows">
        {DOES.map((d, i) => (
          <li key={d.title} className="does-row">
            <Frame as="figure" className="does-clip"><Clip src={d.video} label={d.label} /></Frame>
            <div className="does-copy">
              <span className="tag">{String(i + 1).padStart(2, '0')}</span>
              <h3 id={`does-${i}`}>{d.title}</h3>
              <p>{d.body}</p>
              <div className="actions">
                <button type="button" className="btn" aria-describedby={`does-${i}`} aria-haspopup="dialog" onClick={() => setOpen(i)}>Learn more</button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <Sheet content={open === null ? null : ARTICLES[open]} onClose={() => setOpen(null)} />
    </section>
  );
}

/** The board's two buttons; "Build your board" opens its sheet. */
function BoardActions() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Actions>
        <button type="button" className="btn fill" aria-haspopup="dialog" onClick={() => setOpen(true)}>Build your board</button>
        <a className="btn" href={DEMO}>Run the demo</a>
      </Actions>
      <Sheet content={open ? BUILD_BOARD : null} onClose={() => setOpen(false)} />
    </>
  );
}

/** What Astrum is: the three parts on one canvas, the hub and the phone with their footage. */
function Parts() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const boxes = useRef<(HTMLDivElement | null)[]>([]);
  const [off, setOff] = useState(false);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (slowLink()) { setOff(true); return; }
    let dispose: (() => void) | undefined;
    let dead = false;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const [hub, app, board] = boxes.current as HTMLDivElement[];
      import('./scene3d.ts')
        .then(({ mountGroup }) => mountGroup(c, [
          { kind: 'hub', el: hub, speed: 1.4, footage: HUB_CLIP },
          { kind: 'app', el: app, speed: 1.4, footage: PHONE_CLIPS },
          { kind: 'board', el: board, speed: 1.4 },
        ]))
        .then((m) => { if (dead) m?.dispose(); else if (m) dispose = m.dispose; else setOff(true); })
        .catch(() => setOff(true));
    }, { rootMargin: '600px 0px' });
    io.observe(c);
    return () => { dead = true; io.disconnect(); dispose?.(); };
  }, []);
  const names = ['The hub', 'The app', 'The board'];
  return (
    <section className="scene parts" aria-labelledby="parts-title">
      <Frame className="parts-frame">
        <h2 id="parts-title" className="sr-only">What Astrum is</h2>
        <div className="parts-stage">
          <canvas ref={canvas} className="parts-canvas" aria-hidden="true" hidden={off} />
          <ul className="parts-row">
            {names.map((n, i) => <li key={n}><div className="part-model" ref={(el) => { boxes.current[i] = el; }}>{off && <img className="part-still" src={STILL[(['hub', 'app', 'board'] as Kind[])[i]]} alt="" decoding="async" />}</div><span className="part-name">{n}</span></li>)}
          </ul>
        </div>
        <p className="parts-line">A hub on board, an app for each crewmate, and a board in every cabin. No link to Earth needed.</p>
      </Frame>
    </section>
  );
}

/** The opening: the ship circling, seen clearly first; then the words arrive. */
function Opening() {
  const ref = useRef<HTMLElement>(null);
  // The words are there from the start (the owner tried a delayed reveal and preferred it all at once).
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    if (!intro) return;
    const v = ref.current?.querySelector('video');
    const timers: number[] = [];
    const reveal = () => setIntro(false);
    const started = () => { timers.push(window.setTimeout(reveal, 0)); };
    // If the clip has not started in 2.5 s, the words come anyway.
    timers.push(window.setTimeout(() => { if (!v || v.paused || v.readyState < 3) reveal(); }, 0));
    if (v && !v.paused && v.readyState >= 3) started();
    else v?.addEventListener('playing', started, { once: true });
    return () => { timers.forEach(clearTimeout); v?.removeEventListener('playing', started); };
  }, [intro]);
  return (
    <section ref={ref} className={`scene opening${intro ? ' intro' : ''}`} id="top" aria-labelledby="h1" onFocus={() => setIntro(false)}>
      <div className="opening-bg" aria-hidden="true">
        <Clip src="./media/opening.mp4" poster="./media/opening-poster.jpg" className="opening-video" decor />
      </div>
      <div className="stars" aria-hidden="true" />
      <div className="opening-copy">
        <h1 id="h1">The nearest doctor is a planet away.</h1>
        <p className="lead">Crew health that runs on board.</p>
        <Actions>
          <a className="btn fill" href={DEMO}>Run the demo</a>
          <a className="btn" href="#get">Download</a>
        </Actions>
      </div>
      <span className="tag opening-tag">NASA Space Apps Challenge 2026</span>
    </section>
  );
}

export function App() {
  useEffect(() => initDeck(), []);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>

      <header className="nav">
        <a className="brand" href="#top" aria-label="Astrum, back to top">
          <LogoLight className="brand-logo" label="" width={112} />
        </a>
        <nav aria-label="Main">
          <a href={DEMO}>Run the demo</a>
          <a className="nav-fill" href="#get">Download</a>
        </nav>
      </header>

      <main id="main">
        {/* 1 · Opening */}
        <Opening />

        {/* 2 · What Astrum is */}
        <Parts />

        {/* 3 · The hub */}
        <section className="scene pillar hub" aria-labelledby="hub-title">
          <Model kind="hub" className="pillar-model" footage={HUB_GYM} fallback={
            <Frame as="figure" className="pillar-screen">
              <Clip src="./media/hub-gym.mp4" poster="./media/hub-gym-poster.jpg" label="The Astrum hub: the ship's exercise bay with two crewmates exercising, and the room's readings" />
            </Frame>
          } />
          <div className="pillar-copy">
            <span className="tag">01</span>
            <h2 id="hub-title">The hub.</h2>
            <p>One screen for the whole crew: every reading, every room, every alert. It runs on a Mac or Windows computer on board, and any screen can open it.</p>
            <Actions>
              <a className="btn fill" href="#get">Get the hub</a>
              <a className="btn" href={DEMO}>Run the demo</a>
            </Actions>
          </div>
          <p className="sr-only">Drawing: a ship’s console with one large angled screen, two smaller screens, a seat and a hand rail. Its main screen plays the hub: a wireframe spacecraft with the crew, their CO2 exposure and alerts.</p>
        </section>

        {/* 4 · The app */}
        <section className="scene pillar app" aria-labelledby="app-title">
          <Model kind="app" className="pillar-model" footage={PHONE_CLIPS} fallback={
            <div className="phones">
              <figure className="phone-frame"><Clip src="./media/phone-heart.mp4" label="The iPhone app showing a crewmate their own readings" w={480} h={1044} /></figure>
            </div>
          } />
          <div className="pillar-copy">
            <span className="tag">02</span>
            <h2 id="app-title">The app.</h2>
            <p>On every crewmate’s iPhone. It sends their readings, asks if they’re OK, and walks them through first aid.</p>
            <Actions>
              <a className="btn fill" href={PHONE} target="_blank" rel="noopener">Test the app</a>
              <a className="btn" href={DEMO}>Run the demo</a>
            </Actions>
            <p className="fine">It reads Apple Health and the Apple Watch through HealthKit. Build it from Xcode onto your iPhone.</p>
          </div>
          <p className="sr-only">Drawing: an iPhone swaying gently. Its screen plays the app showing a crewmate their own readings, then asking “Are you OK?”.</p>
        </section>

        {/* 5 · The board */}
        <section className="scene pillar board" aria-labelledby="board-title">
          <Model kind="board" className="pillar-model" />
          <div className="pillar-copy">
            <span className="tag">03</span>
            <h2 id="board-title">The board.</h2>
            <p>An ESP32 in the cabin, measuring pressure, temperature, humidity, light, noise and vibration. Its buzzer is the room alarm.</p>
            <BoardActions />
          </div>
          <p className="sr-only">Drawing: the cabin board turning slowly: a breadboard with sensor modules, an ESP32 on its expansion board, a buzzer and looping jumper wires.</p>
        </section>

        {/* The demo, asked for outright: one full scene between the three parts and what it does. */}
        <section className="scene demo-scene" aria-labelledby="demo-title">
          <a className="demo-card frame" href={DEMO} aria-label="Run the demo">
            <i />
            <Clip src="./media/tells.mp4" className="demo-clip" decor />
            <span className="demo-shade" aria-hidden="true" />
            <span className="demo-copy">
              <span className="tag">In your browser · nothing to install</span>
              <span id="demo-title" className="demo-title">See it run.</span>
              <span className="demo-line">A night on a ship, a dust storm on Mars, a fire on the station. Astrum picks one.</span>
              <span className="btn fill demo-btn">Run the demo</span>
            </span>
          </a>
        </section>

        {/* 6 · What it does */}
        <Does />

        {/* 7 · How it fits together */}
        <FitsScene />

        {/* 8 · Get Astrum */}
        <section className="scene get" id="get" aria-labelledby="get-title">
          <Frame className="get-frame">
            <LogoLight className="get-logo" label="Astrum" />
            <h2 id="get-title">Get Astrum.</h2>
            <ul className="options">
              <li><a className="option fill" href={MAC}><b>Download for Mac</b><span>Apple silicon · 1.7 GB</span></a></li>
              <li><a className="option" href={WIN}><b>Download for Windows</b><span>64-bit · 1.7 GB</span></a></li>
              <li><a className="option" href={DEMO}><b>Run the demo</b><span>In your browser</span></a></li>
            </ul>
            <p className="fine">iPhone app and board firmware: build them from <a href={REPO} target="_blank" rel="noopener">the source</a>.</p>
            <p className="fine">The apps are not signed by a store. On a Mac choose Open Anyway in Privacy &amp; Security; on Windows choose More info, then Run anyway.</p>
          </Frame>
        </section>
      </main>

      <footer>
        <p>Real: the software on all three devices, the board’s own readings, and NASA’s data. Simulated, and labelled on screen: the demo crew and most body readings. Astrum does not diagnose or treat; it is not a medical device.</p>
        <nav aria-label="Project">
          <a href={ABOUT} target="_blank" rel="noopener">Results, limits and sources</a>
          <a href={REPO} target="_blank" rel="noopener">Source on GitHub</a>
          <a href={RELEASES} target="_blank" rel="noopener">All releases</a>
        </nav>
        <p>Caio Agra Lemos, design and engineering · Leticia Alves Barbosa Leite, medical lead</p>
        <p>NASA Space Apps Challenge 2026</p>
      </footer>
    </>
  );
}
