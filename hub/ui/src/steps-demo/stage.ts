// The animation stage, on its own: give it any element and it fills it (a square
// card, a wide panel, a phone-width block), framing each move to the box's own
// shape. It brings its canvas, the name labels, and the one label medical
// moves must carry while they are not reviewed. Nothing here depends on the
// page around it.
//
//   const stage = createStage(element);
//   stage.show('rouse-lead-out', 'weightless', { room: 'quarters-2' });
//   stage.draw(loopTime);            // or stage.play() for its own clock

import * as THREE from 'three';
import { World } from './world.ts';
import { MOVES } from './moves/index.ts';
import type { Clip, Gravity, Params } from './step.ts';

export const UNREVIEWED = 'Animation demo. Steps not yet reviewed by the medical lead.';
export const COMPRESSIONS_SOURCE = 'Rate 100 to 120 a minute, depth about 5 cm (not more than 6 cm), lower half of the sternum, full recoil: ILCOR 2020 Adult Basic Life Support CoSTR (Olasveengen et al., Resuscitation 2020;156:A35–A79). Shown at 110 a minute, 5 cm.';

export interface Stage {
  show(move: string, gravity: Gravity, params?: Params): Clip;
  /** Draw loop time u of the move shown. */
  draw(u: number, still?: boolean): void;
  /** Its own clock (requestAnimationFrame); returns a stop function. */
  play(): () => void;
  readonly clip: Clip | null;
  readonly element: HTMLElement;
  dispose(): void;
}

export function createStage(element: HTMLElement, options: { ratio?: number; labels?: boolean } = {}): Stage {
  const labels = options.labels !== false;
  if (getComputedStyle(element).position === 'static') element.style.position = 'relative';
  element.style.overflow = 'hidden';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
  const tagsEl = document.createElement('div');
  Object.assign(tagsEl.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  tagsEl.setAttribute('aria-hidden', 'true');
  const note = document.createElement('div');
  note.className = 'stage-note';
  Object.assign(note.style, { position: 'absolute', left: '12px', bottom: '10px', right: '12px', font: '12px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif', color: '#9aa0a8', pointerEvents: 'none' });
  element.append(canvas, tagsEl, note);
  const world = new World(canvas, options.ratio ?? Math.min(devicePixelRatio, 2));
  const clips = new Map<string, Clip>();
  let clip: Clip | null = null;
  let tagEls: HTMLElement[] = [];
  const projected = new THREE.Vector3();

  const size = () => {
    const w = Math.max(1, element.clientWidth), h = Math.max(1, element.clientHeight);
    if (w !== world.size.x || h !== world.size.y) world.resize(w, h);
    world.stage = { x: 0, y: 0, w, h };
  };

  const stage: Stage = {
    element,
    get clip() { return clip; },
    show(name, gravity, params = {}) {
      const move = MOVES[name];
      const make = move?.variants[gravity];
      if (!move || !make) throw new Error(`No ${gravity} variant of ${name}`);
      const key = `${name}|${gravity}|${JSON.stringify(params)}`;
      let c = clips.get(key);
      if (!c) {
        c = make(world, { ...move.params, ...params });
        world.scene.add(c.group);
        clips.set(key, c);
      }
      for (const other of clips.values()) other.group.visible = other === c;
      world.shipRoot.visible = c.ship;
      clip = c;
      tagsEl.innerHTML = c.tags.map((t) => `<span style="position:absolute;left:0;top:0;white-space:nowrap;font:${t.kind === 'person' ? '600 13px' : '500 12px'}/1.2 ui-sans-serif,system-ui,-apple-system,sans-serif;color:${t.kind === 'person' ? '#f2f3f5' : '#9aa0a8'};${t.kind === 'person' ? 'padding:3px 8px;border:1px solid rgba(242,243,245,.22);border-radius:8px;background:rgba(11,12,14,.82);' : ''}">${t.text}</span>`).join('');
      tagEls = [...tagsEl.children] as HTMLElement[];
      note.innerHTML = labels && move.medical && !move.reviewed ? `<strong style="color:#f2f3f5;font-weight:600">${UNREVIEWED}</strong><br>${move.source ?? (name === 'compressions' ? COMPRESSIONS_SOURCE : '')}` : '';
      tagsEl.style.display = labels ? '' : 'none';
      return c;
    },
    draw(u, still = false) {
      if (!clip) return;
      size();
      clip.frame(u, still);
      for (let i = 0; i < clip.tags.length; i++) {
        const t = clip.tags[i];
        world.project(t.at, projected);
        const el = tagEls[i];
        el.style.opacity = String(t.shown);
        el.style.transform = `translate(${projected.x.toFixed(1)}px, ${projected.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
      world.render(u);
    },
    play() {
      let raf = 0;
      let last = performance.now();
      let u = 0;
      const loop = (now: number) => {
        u += Math.min(0.1, (now - last) / 1000);
        last = now;
        if (clip) stage.draw(u % clip.duration);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(raf);
    },
    dispose() {
      world.renderer.dispose();
      element.replaceChildren();
    },
  };
  return stage;
}
