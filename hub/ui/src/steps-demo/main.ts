// A plain viewer for the move library: pick a move and its gravity, pause, step.
// Every picture is a pure function of the loop time, so any moment can be drawn
// on its own; with ?capture=1 the time is set from outside (the video is made
// that way, frame by frame, by capture.mjs):
//   ?capture=1&move=rouse-lead-out&t=1.5     one move, loop time t
//   ?capture=1&film=1&t=12.5                 the film: each demo step in turn, captioned
//   &box=600x600                             the stage in a box of that size (any container works)
//   &still=1                                 as with reduced motion (key poses only)

import '../app.css';
import './style.css';
import { createStage } from './stage.ts';
import { BROKEN, MOVES, movesReady } from './moves/index.ts';
import { CARDS } from './cards.ts';
import { CAPTION } from './step.ts';
import type { CardStep, Gravity } from './step.ts';
import { MISSES } from './rig.ts';

const params = new URLSearchParams(location.search);
const capture = params.get('capture') === '1';
const film = params.get('film') === '1';
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const still = () => params.get('still') === '1' || reduce.matches;

const root = document.getElementById('root')!;
root.innerHTML = `
<div class="viewer"${capture ? ' data-capture' : ''}>
  <div class="viewer-stage"></div>
  <div class="viewer-caption" hidden></div>
  <p class="viewer-status" data-status></p>
  <div class="viewer-bar">
    <label>Move <select data-move></select></label>
    <label>Gravity <select data-gravity></select></label>
    <button data-pause>Pause</button>
    <button data-step>Next key pose</button>
  </div>
</div>`;
const stageEl = root.querySelector<HTMLElement>('.viewer-stage')!;
// The stage is square by default (her spec), as large as the window allows; ?box=WxH sets any size, ?full=1 fills the window.
const box = params.get('box');
const squareStage = () => {
  if (params.get('full') === '1' || params.get('film') === '1') return;
  stageEl.dataset.box = '';
  if (box) {
    const [w, h] = box.split('x').map(Number);
    Object.assign(stageEl.style, { width: `${w}px`, height: `${h}px` });
  } else {
    const side = Math.max(120, Math.min(innerWidth, innerHeight - (capture ? 0 : 90)));
    Object.assign(stageEl.style, { width: `${side}px`, height: `${side}px` });
  }
};
squareStage();
addEventListener('resize', squareStage);
const captionEl = root.querySelector<HTMLElement>('.viewer-caption')!;
const moveEl = root.querySelector<HTMLSelectElement>('[data-move]')!;
const gravityEl = root.querySelector<HTMLSelectElement>('[data-gravity]')!;
const pauseEl = root.querySelector<HTMLButtonElement>('[data-pause]')!;
const stepEl = root.querySelector<HTMLButtonElement>('[data-step]')!;
const statusEl = root.querySelector<HTMLElement>('[data-status]')!;

// Captures of a single move have no text at all (her rule: no text inside the video); &labels=1 keeps them.
const stage = createStage(stageEl, { ratio: Number(params.get('dpr')) || undefined, labels: !(capture && params.get('move')) || params.get('labels') === '1' });

/** The demo cards' steps, in order: what the film plays. */
const STEPS: CardStep[] = CARDS.flatMap((c) => c.steps);
const ROUNDS = (s: CardStep) => (s.move === 'compressions' ? 2 : 2);

function pick(name: string, gravity?: Gravity) {
  const move = MOVES[name];
  const variants = Object.keys(move.variants) as Gravity[];
  gravityEl.innerHTML = (['weightless', 'gravity'] as Gravity[]).map((g) => `<option${variants.includes(g) ? '' : ' disabled'}>${g}</option>`).join('');
  const g = gravity && variants.includes(gravity) ? gravity : variants[0];
  gravityEl.value = g;
  moveEl.value = name;
  const step = STEPS.find((s) => s.move === name);
  stage.show(name, g, step?.params ?? {});
  key = 0;
  statusEl.textContent = `${CAPTION} · ${move.reviewed ? 'reviewed by the medical lead' : 'not yet reviewed by the medical lead'}${move.questions?.length ? ` · ${move.questions.length} open question${move.questions.length > 1 ? 's' : ''}` : ''}`;
}

let key = 0;
let paused = false;
moveEl.addEventListener('change', () => pick(moveEl.value));
gravityEl.addEventListener('change', () => pick(moveEl.value, gravityEl.value as Gravity));
pauseEl.addEventListener('click', () => { paused = !paused; pauseEl.textContent = paused ? 'Play' : 'Pause'; });
stepEl.addEventListener('click', () => { key++; });

function filmAt(t: number) {
  let left = t;
  for (const s of STEPS) {
    const d = MOVES[s.move].variants[s.gravity]!;
    void d;
    const clip = stage.show(s.move, s.gravity, s.params ?? {});
    const span = clip.duration * ROUNDS(s);
    if (left < span || s === STEPS[STEPS.length - 1]) {
      captionEl.hidden = false;
      captionEl.textContent = `${s.move} · ${s.gravity}`;
      stage.draw(left % clip.duration);
      return;
    }
    left -= span;
  }
}

function filmLength() {
  return STEPS.reduce((sum, s) => sum + stage.show(s.move, s.gravity, s.params ?? {}).duration * ROUNDS(s), 0);
}

declare global {
  interface Window { __steps: { at: (t: number) => Promise<number>; length: () => number; misses: () => { worst: number; bone: number }; resetMisses: () => void; broken: () => Record<string, string>; moves: () => string[]; ready: boolean } }
}

async function start() {
  await movesReady;
  moveEl.innerHTML = Object.keys(MOVES).sort().map((m) => `<option>${m}</option>`).join('');
if (capture) {
  const one = params.get('move');
  if (one) pick(one, (params.get('gravity') as Gravity) ?? undefined);
  const at = (t: number) => (film ? filmAt(t) : stage.draw(t % stage.clip!.duration, still()));
  window.__steps = {
    at: async (t) => { at(t); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return t; },
    length: () => (film ? filmLength() : stage.clip!.duration),
    misses: () => MISSES,
    resetMisses: () => { MISSES.worst = 0; MISSES.bone = -1; },
    broken: () => BROKEN,
    moves: () => Object.keys(MOVES).sort(),
    ready: false,
  };
  void document.fonts.ready.then(() => {
    at(Number(params.get('t') ?? 0));
    window.__steps.ready = true;
  });
} else {
  pick(params.get('move') ?? Object.keys(MOVES).sort()[0]);
  let last = performance.now();
  let u = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const clip = stage.clip!;
    if (still()) stage.draw(clip.keys[key % clip.keys.length], true);
    else {
      if (!paused) u += dt;
      stage.draw(u % clip.duration);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
}
void start();
