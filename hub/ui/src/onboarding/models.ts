// The setup's live 3D models: the app's own ship, ISS, Mars base and planets
// (scene/build.ts, scene/planet.ts), each drawn into the box of a placeholder
// element. One WebGL canvas covers the window behind nothing it can catch
// (pointer-events none) and every model is drawn into its element's rectangle
// with a scissor, so the page holds one context however many models it shows.
// It stops while the tab is hidden and is let go when the last model leaves.
//
// Each model starts at a random angle and turns a random way, so the setup
// looks a little different each time it opens; with reduced motion they stand
// still. The data shown beside them is never random.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildShip } from '../scene/build.ts';
import { layoutOf } from '../scene/layout.ts';
import { createPlanet } from '../scene/planet.ts';
import { MISSIONS } from '../scene/missions.ts';
import type { MissionName } from '../scene/demo.ts';
import type { Body } from '../../../engine/mission.ts';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export type ModelName = 'ship' | 'iss' | 'base-mars' | 'base-moon' | 'mars' | 'moon' | 'earth';

interface View {
  el: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Moves the model for this frame (time in ms); `moving` is false with reduced motion. */
  animate: (time: number, moving: boolean) => void;
  /** A wide, flat model (the ISS) framed to its width at the view's own aspect: half-width, half-height, and the way to the camera. */
  fitWidth?: { r: number; h: number; dir: THREE.Vector3; fill: number; target: THREE.Vector3 };
  lines: LineMaterial[];
  dispose: () => void;
}

function cssColour(name: string, fallback: string): THREE.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(value || fallback);
}

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer: THREE.WebGLRenderer | null = null;
let frame = 0;
const views = new Set<View>();

function draw(time: number) {
  frame = 0;
  if (!renderer || document.hidden) return;
  const canvas = renderer.domElement;
  const w = window.innerWidth, h = window.innerHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.setScissorTest(true);
  const moving = !still();
  for (const v of views) {
    const r = v.el.getBoundingClientRect();
    if (r.width < 2 || r.bottom < 0 || r.top > h || r.right < 0 || r.left > w) continue;
    v.animate(time, moving);
    const y = h - r.bottom;
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.setScissor(r.left, y, r.width, r.height);
    v.camera.aspect = r.width / r.height;
    if (v.fitWidth) {
      const { r, h, dir, fill, target } = v.fitWidth;
      const tanV = Math.tan(THREE.MathUtils.degToRad(v.camera.fov / 2));
      const d = Math.max(r / (tanV * v.camera.aspect * fill), h / (tanV * fill));
      v.camera.position.copy(dir).multiplyScalar(d).add(target);
      v.camera.near = Math.max(0.01, d - r * 2);
      v.camera.far = d + r * 2;
      v.camera.lookAt(target);
    }
    v.camera.updateProjectionMatrix();
    // Fat lines measure their width against the resolution: the preview's real pixels, so a line is one device pixel wide.
    const pr = renderer.getPixelRatio();
    for (const m of v.lines) m.resolution.set(r.width * pr, r.height * pr);
    renderer.render(v.scene, v.camera);
  }
  frame = requestAnimationFrame(draw);
}

function wake() {
  if (!frame && renderer && !document.hidden) frame = requestAnimationFrame(draw);
}

function ensureRenderer(): THREE.WebGLRenderer | null {
  if (renderer) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  const c = renderer.domElement;
  c.className = 'ob-gl';
  c.setAttribute('aria-hidden', 'true');
  document.body.appendChild(c);
  document.addEventListener('visibilitychange', wake);
  return renderer;
}

function release() {
  if (views.size || !renderer) return;
  cancelAnimationFrame(frame);
  frame = 0;
  document.removeEventListener('visibilitychange', wake);
  renderer.domElement.remove();
  renderer.dispose();
  renderer = null;
}

/** Frames a box so it fills about `fill` of the view, seen from a little above. */
function fit(camera: THREE.PerspectiveCamera, box: THREE.Box3, fill: number, pitch: number) {
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) / fill;
  camera.position.set(0, Math.sin(pitch) * distance, Math.cos(pitch) * distance).add(sphere.center);
  camera.near = Math.max(0.01, distance - sphere.radius * 3);
  camera.far = distance + sphere.radius * 3;
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
}

function planetView(body: Body, bg: THREE.Color): Omit<View, 'el'> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const planet = createPlanet('soft', body, bg);
  planet.mesh.visible = true;
  planet.uniforms.strength.value = 1;
  planet.uniforms.sun.value.set(-0.6, 0.45, 0.65).normalize();
  const spin = new THREE.Group();
  spin.rotation.z = 0.25;
  const turn = new THREE.Group();
  turn.add(planet.mesh);
  spin.add(turn);
  scene.add(spin);
  turn.rotation.y = Math.random() * Math.PI * 2;
  fit(camera, new THREE.Box3(new THREE.Vector3(-1.05, -1.05, -1.05), new THREE.Vector3(1.05, 1.05, 1.05)), 1.55, 0.15);
  const d = camera.position.length();
  planet.uniforms.near.value = d - 1.1;
  planet.uniforms.span.value = 2.2;
  const speed = (Math.random() < 0.5 ? -1 : 1) * 0.18;
  return { scene, camera, animate: (_t, moving) => { if (moving) turn.rotation.y += speed * 0.016; }, lines: [], dispose: planet.dispose };
}

/**
 * Each place rests at the angle where it reads at a glance (the ship along its length, the ISS with its truss
 * and arrays broadside, the base three-quarter) and sways a little about it; the random part is only a small
 * offset and the sway's direction. `travel`, for the ship on the Earth to Mars arc, gives the screen angle of the
 * way it is going: it then points along it, nose first, and does not turn.
 */
function placeView(name: MissionName, ink: THREE.Color, bg: THREE.Color, travel?: () => number, whole = false): Omit<View, 'el'> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
  const base = name.startsWith('base');
  // A base's solar field (the arrays and their posts) stands off behind it and pulls it off centre: the preview shows the habitat.
  const mission = base ? { ...MISSIONS[name], solarArrays: [], trusses: (MISSIONS[name].trusses ?? []).filter((t) => !t.id?.startsWith('post-')) } : MISSIONS[name];
  const layout = layoutOf(mission);
  const ship = buildShip(scene, mission, layout.modules, layout.places, [], ink, bg);
  ship.stars.visible = false;
  // Drawn for the big scene, the lines pile up at this size: about one device pixel each, a little see-through,
  // so overlapping edges stay lines instead of a white mass.
  for (const m of new Set(ship.lines)) {
    m.linewidth = m === ship.structure ? 1.1 : 0.8;
    m.transparent = true;
    m.opacity = 0.72;
    m.fog = false;
  }
  // The ground plain is a dark square at this size: the base stands alone.
  if (ship.ground) ship.ground.mesh.visible = false;
  // Centred on what is drawn.
  const box = new THREE.Box3();
  ship.root.updateMatrixWorld(true);
  ship.root.traverse((o) => {
    if (o === ship.ground?.mesh || !o.visible || !(o as THREE.Mesh).geometry) return;
    const g = (o as THREE.Mesh).geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (g.boundingBox && Number.isFinite(g.boundingBox.min.x)) box.union(g.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  scene.remove(ship.root);
  ship.root.position.sub(centre);
  const pivot = new THREE.Group();
  pivot.add(ship.root);
  const roll = new THREE.Group();
  roll.add(pivot);
  scene.add(roll);
  const jitter = (Math.random() - 0.5) * 0.2;
  const side = Math.random() < 0.5 ? -1 : 1;
  const sway = (Math.random() < 0.5 ? -1 : 1) * 0.00022;
  const phase = Math.random() * Math.PI * 2;
  if (travel) {
    // Nose (-x) to the right, toward Mars, turned a little toward the viewer to show its length.
    pivot.rotation.y = Math.PI - 0.3;
    const r = size.x / 2;
    fit(camera, new THREE.Box3(new THREE.Vector3(-r, -r * 0.5, -r * 0.5), new THREE.Vector3(r, r * 0.5, r * 0.5)), 1.25, 0.1);
    return { scene, camera, animate: () => { roll.rotation.z = travel(); }, lines: ship.lines, dispose: ship.dispose };
  }
  // The station is seen three-quarter from above, like the base, on its own step and on the summary.
  const rest = name === 'ship' ? side * 0.55 + jitter : name === 'iss' ? Math.PI / 4 + jitter * 0.5 : 0.6 + jitter;
  pivot.rotation.y = rest;
  const r = Math.max(size.x, size.z) / 2;
  fit(camera, new THREE.Box3(new THREE.Vector3(-r, -size.y / 2, -r), new THREE.Vector3(r, size.y / 2, r)), whole ? 1.15 : name === 'ship' ? 1.55 : name === 'iss' ? 1.6 : 1.6, base || name === 'iss' ? 0.55 : 0.32);
  return {
    scene, camera, lines: ship.lines, dispose: ship.dispose,
    animate: (time, moving) => { pivot.rotation.y = moving ? rest + 0.3 * Math.sin(time * sway + phase) : rest; },
  };
}

/** A ref for an element that shows one live model. The element needs a size; the model is drawn into its box. */
/** `whole`: the whole model fits its box (the summary); otherwise the ISS is zoomed on its modules and cropped (its own step). */
export function useModel<T extends HTMLElement>(name: ModelName, travel?: () => number, whole = false) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !ensureRenderer()) return;
    const ink = cssColour('--scene-line', '#f2f3f5');
    const bg = cssColour('--bg', '#0b0c0e');
    const made = name === 'mars' || name === 'moon' || name === 'earth' ? planetView(name, bg) : placeView(name, ink, bg, travel, whole);
    const view: View = { ...made, el };
    views.add(view);
    wake();
    return () => {
      views.delete(view);
      view.dispose();
      release();
    };
  }, [name, whole]);
  return ref;
}
