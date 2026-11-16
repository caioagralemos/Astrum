// The page's line-drawn models, in the hub's Projection look: thin white lines
// over dark solids that hide what is behind them, on a slow turntable.
// Loaded lazily (see Model.tsx), so the first paint is the logo and headline.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type Kind = 'hub' | 'app' | 'board';

const BG = 0x0b0c0e;
const LINE = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.62 });
const FAINT = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 });
const SOLID = new THREE.MeshBasicMaterial({ color: BG, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });

/** A shape drawn as its edges, with a dark body that hides the lines behind it. */
function solid(g: THREE.BufferGeometry, parent: THREE.Object3D, mat = LINE, angle = 20) {
  parent.add(new THREE.Mesh(g, SOLID));
  parent.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, angle), mat));
}
function box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat = LINE) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  solid(g, parent, mat);
}
function polyline(parent: THREE.Object3D, pts: THREE.Vector3[], mat = LINE) {
  parent.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
}
function roundRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** A ship's console: a desk under the hull, one large angled screen, two smaller ones, a seat and a rail. */
function hub() {
  const root = new THREE.Group();
  // Deck plate with a few panel seams.
  box(root, 6, 0.08, 4, 0, -0.04, 0, FAINT);
  for (const x of [-1.5, 0, 1.5]) polyline(root, [new THREE.Vector3(x, 0.01, -2), new THREE.Vector3(x, 0.01, 2)], FAINT);
  // Hull ribs arching over the station.
  for (const z of [-1.7, -0.6]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) { const a = Math.PI * (i / 40); pts.push(new THREE.Vector3(-2.9 * Math.cos(a), 2.9 * Math.sin(a) * 0.95, z)); }
    polyline(root, pts, FAINT);
  }
  // Desk: a sloped console body, drawn from its side profile.
  const p = new THREE.Shape();
  p.moveTo(-0.55, 0); p.lineTo(0.5, 0); p.lineTo(0.5, 0.78); p.lineTo(0.05, 0.92); p.lineTo(-0.6, 0.98); p.lineTo(-0.6, 0.86); p.lineTo(-0.55, 0.8); p.lineTo(-0.55, 0);
  const desk = new THREE.ExtrudeGeometry(p, { depth: 2.6, bevelEnabled: false });
  desk.rotateY(Math.PI / 2); desk.translate(-1.3, 0, -0.85);
  solid(desk, root);
  // Control rows on the sloped top.
  for (let i = 0; i < 9; i++) box(root, 0.16, 0.03, 0.1, -1.0 + i * 0.25, 0.93, -0.55, FAINT);
  for (let i = 0; i < 5; i++) box(root, 0.3, 0.03, 0.14, -0.8 + i * 0.4, 0.86, -0.25, FAINT);
  // The large screen on an arm, tilted back.
  const main = new THREE.Group();
  main.position.set(0, 1.75, -1.15); main.rotation.x = -0.18;
  box(main, 2.1, 1.22, 0.06, 0, 0, 0);
  box(main, 1.96, 1.08, 0.01, 0, 0, 0.035, FAINT);
  root.add(main);
  // Where footage goes: just in front of the screen's inner outline, 16:9.
  const screen = new THREE.Group();
  screen.position.z = 0.043;
  main.add(screen);
  box(root, 0.08, 0.6, 0.08, 0, 1.0, -1.15);
  // Two smaller side screens, turned in toward the seat.
  for (const s of [-1, 1]) {
    const side = new THREE.Group();
    side.position.set(s * 1.72, 1.45, -0.85); side.rotation.y = -s * 0.55; side.rotation.x = -0.15;
    box(side, 0.95, 0.62, 0.05, 0, 0, 0);
    for (let i = 0; i < 4; i++) polyline(side, [new THREE.Vector3(-0.38, 0.2 - i * 0.12, 0.03), new THREE.Vector3(-0.38 + 0.25 + (i % 3) * 0.18, 0.2 - i * 0.12, 0.03)], FAINT);
    root.add(side);
    box(root, 0.06, 0.95, 0.06, s * 1.72, 0.5, -0.85);
  }
  // The seat: pedestal, cushion, back and arm rests.
  const seat = new THREE.Group();
  seat.position.set(0, 0, 0.85);
  const ped = new THREE.CylinderGeometry(0.07, 0.22, 0.5, 10); ped.translate(0, 0.25, 0);
  solid(ped, seat, LINE, 30);
  box(seat, 0.7, 0.1, 0.62, 0, 0.55, 0);
  const back = new THREE.BoxGeometry(0.66, 0.85, 0.09); back.translate(0, 0.45, 0); back.rotateX(0.18); back.translate(0, 0.55, 0.32);
  solid(back, seat);
  for (const s of [-1, 1]) box(seat, 0.07, 0.05, 0.45, s * 0.4, 0.78, -0.02);
  root.add(seat);
  // A hand rail along the hull.
  const rail = new THREE.CatmullRomCurve3([new THREE.Vector3(-2.6, 1.15, -1.6), new THREE.Vector3(-2.2, 1.2, 0.3), new THREE.Vector3(-1.9, 1.15, 1.6)]);
  polyline(root, rail.getPoints(30));
  polyline(root, rail.getPoints(30).map((v) => v.clone().setX(-v.x)));
  root.position.y = -1.2;
  return { root, fov: 30, distance: 9.6, height: 1.8, sway: 0.49, screens: [{ at: screen, w: 1.92, h: 1.08 }] as Screen[] };
}

const PW = 0.716, PH = 1.476;

/** An iPhone: rounded slab, screen outline, the island and its buttons, the camera block on its back. */
function phone() {
  const root = new THREE.Group();
  const W = PW, H = PH, D = 0.08, R = 0.11;
  const slab = new THREE.ExtrudeGeometry(roundRect(W, H, R), { depth: D, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 10 });
  slab.translate(0, 0, -D / 2);
  solid(slab, root, LINE, 30);
  const front = D / 2 + 0.014;
  const screen = new THREE.BufferGeometry().setFromPoints(roundRect(W - 0.05, H - 0.05, R - 0.025).getPoints(10).map((v) => new THREE.Vector3(v.x, v.y, front)));
  root.add(new THREE.LineLoop(screen, FAINT));
  const island = new THREE.BufferGeometry().setFromPoints(roundRect(0.2, 0.06, 0.03).getPoints(8).map((v) => new THREE.Vector3(v.x, v.y + H / 2 - 0.08, front + 0.001)));
  root.add(new THREE.LineLoop(island, LINE));
  // Side buttons.
  box(root, 0.015, 0.16, 0.035, W / 2 + 0.013, 0.28, 0);
  for (const y of [0.4, 0.22, 0.04]) box(root, 0.015, y === 0.4 ? 0.06 : 0.12, 0.035, -W / 2 - 0.013, y, 0);
  // Camera block on the back.
  const cam = new THREE.ExtrudeGeometry(roundRect(0.3, 0.3, 0.07), { depth: 0.02, bevelEnabled: false, curveSegments: 8 });
  cam.translate(-W / 2 + 0.2, H / 2 - 0.2, -D / 2 - 0.032);
  solid(cam, root, LINE, 30);
  for (const [x, y] of [[-0.06, 0.06], [0.06, -0.06], [-0.06, -0.06]]) {
    const ring = new THREE.BufferGeometry().setFromPoints(new THREE.Path().absarc(0, 0, 0.045, 0, Math.PI * 2, false).getPoints(24).map((v) => new THREE.Vector3(v.x - W / 2 + 0.2 + x, v.y + H / 2 - 0.2 + y, -D / 2 - 0.034)));
    root.add(new THREE.LineLoop(ring, FAINT));
  }
  // The screen face, for footage: the screen outline's own shape, just behind the outline.
  const face = new THREE.ShapeGeometry(roundRect(W - 0.05, H - 0.05, R - 0.025), 10);
  const uv = face.attributes.uv, pos = face.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / (W - 0.05) + 0.5, pos.getY(i) / (H - 0.05) + 0.5);
  face.translate(0, 0, front - 0.0005);
  return { root, face };
}

function app(): Built {
  const { root, face } = phone();
  root.rotation.z = 0.06;
  const at = new THREE.Group();
  root.add(at);
  return { root, fov: 30, distance: 3.1, height: 0.1, sway: SWAY, swayPeriod: SWAY_PERIOD, rest: 0, screens: [{ at, w: 0, h: 0, geometry: face }] };
}

type Screen = { at: THREE.Object3D; w: number; h: number; geometry?: THREE.BufferGeometry };

/** The phone only sways through the front half, so its screen always faces you: ±32° on a sine, about 8.5 s a sway. */
const SWAY = THREE.MathUtils.degToRad(32), SWAY_PERIOD = 8.5;
/** Seconds a model takes to turn back to front after a drag. */
const BACK = 1.2;

/** The cabin board: the hub's own model (astrum-chip.glb, exported from the hub's chip preview), redrawn in site lines. */
async function board() {
  const gltf = await new GLTFLoader().loadAsync('./media/astrum-chip.glb');
  const root = new THREE.Group();
  const model = gltf.scene;
  model.traverse((o) => {
    const any = o as THREE.Mesh & THREE.LineSegments & THREE.Points;
    if ((any as THREE.LineSegments).isLineSegments || (any as THREE.Line).isLine) any.material = LINE;
    else if ((any as THREE.Points).isPoints) any.material = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.3 });
    else if ((any as THREE.Mesh).isMesh) any.material = SOLID;
  });
  // Centre it, and scale millimetres to the scene.
  const b = new THREE.Box3().setFromObject(model);
  const c = b.getCenter(new THREE.Vector3());
  const size = b.getSize(new THREE.Vector3());
  model.position.sub(c);
  root.add(model);
  root.scale.setScalar(3 / Math.max(size.x, size.y, size.z));
  return { root, fov: 30, distance: 7, height: 2.8, sway: 0 } as Built;
}

type Built = { root: THREE.Object3D; fov: number; distance: number; height: number; sway: number; screens?: Screen[]; minWidth?: number; swayPeriod?: number; rest?: number };

export type Mounted = { dispose(): void };
/** A clip, or several played one after another on the same screen. */
export type Footage = { src: string | string[]; poster?: string };

/** Muted, looping footage drawn onto a screen face. Shows the poster (or the first frame) until it plays. */
function footage(f: Footage, screen: Screen, reduced: boolean, redraw: () => void) {
  const video = document.createElement('video');
  const list = Array.isArray(f.src) ? f.src : [f.src];
  let at = 0;
  video.muted = true; video.loop = list.length === 1; video.playsInline = true;
  video.setAttribute('muted', ''); video.setAttribute('playsinline', '');
  video.preload = 'auto';
  video.src = list[0];
  // A playlist: when one clip ends, cut to the next.
  if (list.length > 1) video.addEventListener('ended', () => { at = (at + 1) % list.length; video.src = list[at]; video.play().catch(() => {}); });
  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  // The footage is drawn much smaller than it is: mipmaps and anisotropy keep its fine lines from shimmering.
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const geo = screen.geometry ?? new THREE.PlaneGeometry(screen.w, screen.h);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  screen.at.add(mesh);
  let poster: THREE.Texture | undefined;
  const show = (t: THREE.Texture) => { mat.map = t; mat.needsUpdate = true; mesh.visible = true; redraw(); };
  if (f.poster) {
    new THREE.TextureLoader().load(f.poster, (t) => { t.colorSpace = THREE.SRGBColorSpace; poster = t; if (!mat.map) show(t); });
  }
  const frameReady = () => { tex.needsUpdate = true; if (!poster || !video.paused) show(tex); else redraw(); };
  video.addEventListener('playing', () => show(tex));
  if (reduced) {
    // A still: the poster if there is one, else a frame from the clip.
    if (!f.poster) {
      video.addEventListener('loadedmetadata', () => { video.currentTime = Math.min(2, video.duration / 2); }, { once: true });
      video.addEventListener('seeked', frameReady, { once: true });
    }
  } else if (!f.poster) {
    video.addEventListener('loadeddata', frameReady, { once: true });
  }
  return {
    play() { if (!reduced) video.play().catch(() => {}); },
    pause() { video.pause(); },
    dispose() { video.pause(); video.removeAttribute('src'); video.load(); tex.dispose(); poster?.dispose(); mat.dispose(); },
  };
}

async function build(kind: Kind): Promise<Built> {
  return kind === 'hub' ? hub() : kind === 'app' ? app() : await board();
}

/** One model with its camera, footage and motion. Shared by the single and the grouped canvases. */
async function view(kind: Kind, opts: { speed?: number; footage?: Footage[] }, reduced: boolean, redraw: () => void) {
  const built = await build(kind);
  const scene = new THREE.Scene();
  scene.add(built.root);
  const camera = new THREE.PerspectiveCamera(built.fov, 1, 0.01, 100);
  const speed = opts.speed ?? 1;
  const clips = (opts.footage ?? []).flatMap((f, i) => (built.screens?.[i] ? [footage(f, built.screens[i], reduced, redraw)] : []));
  // Motion: 'auto' sways (or turns), 'held' follows a drag, 'back' eases to front after one.
  const rest = built.rest ?? (built.sway ? 0.2 : -0.6);
  const target = reduced ? rest : 0;
  const w = built.swayPeriod ? (Math.PI * 2) / built.swayPeriod : 0.18 * speed;
  let mode: 'auto' | 'held' | 'back' = 'auto', held = 0, backFrom = 0, backStart = 0, phase0 = 0, offset = 0;
  const auto = (s: number) => reduced ? (built.sway ? rest : -0.6 + offset)
    : built.sway ? Math.sin((s - phase0) * w) * built.sway : s * 0.22 * speed - 0.4 + offset;
  return {
    scene, camera, clips,
    fit(w: number, h: number) {
      camera.aspect = w / h;
      // Keep the whole model in frame on tall, narrow canvases.
      const fit = Math.max(1, 1.1 / camera.aspect);
      const span = 2 * Math.tan(THREE.MathUtils.degToRad(built.fov / 2)) * camera.aspect;
      const d = Math.max(built.distance * fit, built.minWidth ? built.minWidth / span : 0);
      camera.position.set(0, built.height, d);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    },
    tick(s: number) {
      const yaw = (() => {
        if (mode === 'held') return held;
        if (mode === 'back') {
          const f = (s - backStart) / BACK;
          if (f < 1) { const e = f * f * (3 - 2 * f); return backFrom + (target - backFrom) * e; }
          // Facing front again: the sway resumes from the centre of its range.
          mode = 'auto'; phase0 = backStart + BACK;
        }
        return auto(s);
      })();
      built.root.rotation.y = yaw;
    },
    /** A drag: the motion pauses and the model follows the hand. */
    grab() { held = built.root.rotation.y; mode = 'held'; },
    turn(dx: number) { held += dx; },
    /** Let go: a swaying model turns the short way back to front; the turntable carries on from here. */
    release(s: number) {
      if (built.sway || reduced) {
        const d = Math.atan2(Math.sin(held - target), Math.cos(held - target));
        backFrom = target + d; backStart = s; mode = 'back';
      } else {
        offset = held - (s * 0.22 * speed - 0.4); mode = 'auto';
      }
    },
    busy() { return mode !== 'auto'; },
    dispose() {
      clips.forEach((c) => c.dispose());
      scene.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g) g.dispose(); });
    },
  };
}

type Item = { kind: Kind; speed?: number; footage?: Footage[]; el?: HTMLElement };

/** Runs one renderer on `canvas`: one model filling it, or several, each in the box of its `el`. Plays only on screen. */
async function run(canvas: HTMLCanvasElement, items: Item[], interactive: boolean): Promise<Mounted | null> {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = false, ready = false;
  const group = items.length > 1;
  const start = performance.now();
  const redraw = () => { if (ready && (!visible || reduced)) frame(performance.now()); };
  const views = await Promise.all(items.map((it) => view(it.kind, it, reduced, redraw)));
  ready = true;

  const size = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    // Drawn at one and a half times the screen's own density (at most 3) and scaled down by the browser: one-pixel lines come out smooth.
    renderer.setPixelRatio(Math.min(devicePixelRatio * 1.5, 3));
    renderer.setSize(w, h, false);
    if (!group) views[0].fit(w, h);
  };
  size();

  // Drag to turn it by hand. Let go and a swaying model turns back to front; the turntable carries on.
  let dragging = false, lastX = 0;
  const now = () => (performance.now() - start) / 1000;
  const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); views[0].grab(); };
  const move = (e: PointerEvent) => { if (!dragging) return; views[0].turn((e.clientX - lastX) * 0.01); lastX = e.clientX; if (reduced) frame(performance.now()); };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    views[0].release(now());
    // Under reduced motion the loop is off; run it just for the return.
    if (reduced) renderer.setAnimationLoop(loop);
  };
  if (interactive) {
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  function frame(t: number) {
    const s = (t - start) / 1000;
    if (!group) {
      views[0].tick(s); renderer.render(views[0].scene, views[0].camera);
      if (reduced && !views[0].busy()) renderer.setAnimationLoop(null);
      return;
    }
    // Several models on one canvas: each drawn into its own box.
    const c = canvas.getBoundingClientRect();
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    views.forEach((v, i) => {
      const r = items[i].el!.getBoundingClientRect();
      const x = r.left - c.left, y = c.bottom - r.bottom;
      if (r.width < 2 || r.height < 2) return;
      v.fit(r.width, r.height);
      renderer.setViewport(x, y, r.width, r.height);
      renderer.setScissor(x, y, r.width, r.height);
      v.tick(s);
      renderer.render(v.scene, v.camera);
    });
  }

  // In deck mode (deck.ts) a scene on its way out stops drawing at once, so two canvases never render during a step.
  const loop = (t: number) => { if (!canvas.closest('.deck-leaving')) frame(t); };
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    views.forEach((v) => v.clips.forEach((c) => (visible ? c.play() : c.pause())));
    if (reduced) { frame(start); return; }
    renderer.setAnimationLoop(visible ? loop : null);
  });
  io.observe(canvas);
  const ro = new ResizeObserver(() => { size(); if (!visible || reduced) frame(performance.now()); });
  ro.observe(canvas);
  if (reduced) frame(start);

  return {
    dispose() {
      io.disconnect(); ro.disconnect();
      renderer.setAnimationLoop(null);
      views.forEach((v) => v.dispose());
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      renderer.dispose();
    },
  };
}

/** Draws `kind` into `canvas`. Resolves to null when WebGL is unavailable. */
export function mount(canvas: HTMLCanvasElement, kind: Kind, opts: { speed?: number; footage?: Footage[] } = {}) {
  return run(canvas, [{ kind, ...opts }], true);
}

/** Draws several models on one canvas, each into the box of its element. Resolves to null without WebGL. */
export function mountGroup(canvas: HTMLCanvasElement, items: (Item & { el: HTMLElement })[]) {
  return run(canvas, items, false);
}

/** One still of each model, as images, for the diagram. One short-lived WebGL context; null without WebGL. */
export async function stills(list: { kind: Kind; w: number; h: number; yaw: number }[]): Promise<string[] | null> {
  const canvas = document.createElement('canvas');
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  const out: string[] = [];
  try {
    for (const { kind, w, h, yaw } of list) {
      const built = await build(kind);
      built.root.rotation.y = yaw;
      const scene = new THREE.Scene();
      scene.add(built.root);
      const camera = new THREE.PerspectiveCamera(built.fov, w / h, 0.01, 100);
      camera.position.set(0, built.height, built.distance * Math.max(1, 1.1 / camera.aspect));
      camera.lookAt(0, 0, 0);
      renderer.setPixelRatio(Math.min(devicePixelRatio * 1.5, 3));
      renderer.setSize(w, h, false);
      renderer.render(scene, camera);
      out.push(canvas.toDataURL('image/png'));
      scene.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g) g.dispose(); });
    }
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}
