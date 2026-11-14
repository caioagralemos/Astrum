// The backdrop behind the station: a faint grid on a floor below and a ceiling
// above, both receding to a horizon, drifting slowly towards the viewer so the
// station reads as cruising through space.
//
// It belongs to the screen, not to the station: turning or zooming the station
// does not swing it round. A band across the middle, where the station is on
// screen, is always left empty, so no grid line runs behind the hull, the rooms
// or their labels. With the station stood upright (a tall screen) the grid
// becomes two walls either side of it instead.
//
// The whole thing is one triangle covering the screen and drawn by a small
// shader: one draw call, nothing to load. It dims when a room is over a limit,
// all but vanishes while something is selected, stands still with reduced
// motion, and is not drawn at all when its strength is 0.
//
// Tune it in app.css: --scene-grid (its colour) and --scene-grid-strength (how
// strong it is at its brightest, 0 turns it off).

import * as THREE from 'three';
import { OUTLINE } from './layout.ts';

export type GridSwitch = 'off' | 'on' | 'strong' | null;

/** A label over the drawing, as the station view places it: its box in CSS pixels, [left, top, right, bottom]. */
export interface Label {
  show: boolean;
  box: readonly number[];
}

export interface Backdrop {
  /** Call before every frame is drawn. */
  update: (dt: number, still: boolean, portrait: boolean, labels: readonly Label[]) => void;
  /** React to the station's state: a room over a limit, something selected. */
  mood: (over: boolean, selected: boolean) => void;
  dispose: () => void;
}

/** How deep the floor's cells are against its height below the eye: lower is a finer grid. */
const DEPTH = 0.8;
/** Cells per second the floor slides towards the viewer. */
const SPEED = 0.22;
/** Room kept clear round the station and its labels on screen, in CSS pixels. */
const MARGIN = 14;
/** How far from the horizon the grid takes to reach full strength, as a share of half the screen. */
const SOFT = 0.15;
const STRONG = 0.6;
const FALLBACK_COLOUR = '#cfd6df';
const FALLBACK_STRENGTH = 0.06;

const VERTEX = /* glsl */ `
void main() {
  // Straight onto the screen, at the far plane: anything the station draws covers it.
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

// Each plane's horizon is the edge of the empty band, so the floor recedes into the dark around
// the station and nothing is drawn inside the band at all.
const FRAGMENT = /* glsl */ `
uniform vec3 colour;
uniform float strength;
uniform vec2 size;
uniform float ratio;
uniform float portrait;
uniform vec2 band;
uniform float offset;
uniform float depth;
uniform float soft;

float lines(float w) {
  float f = fwidth(w);
  float d = abs(fract(w - 0.5) - 0.5) / f;
  // About one CSS pixel wide; too dense to resolve (near the horizon) fades out instead of shimmering.
  return (1.0 - smoothstep(0.0, ratio, d)) * (1.0 - smoothstep(0.2, 0.5, f));
}

void main() {
  vec2 p = gl_FragCoord.xy - 0.5 * size;
  // across: towards or away from the horizons (-1..1); along: parallel to them, in the same units.
  float half_ = portrait > 0.5 ? 0.5 * size.x : 0.5 * size.y;
  float across = (portrait > 0.5 ? p.x : p.y) / half_;
  float along = (portrait > 0.5 ? p.y : p.x) / half_;
  float v = max(band.x - across, across - band.y);
  if (v <= 0.0) discard;
  float z = depth / v;
  float grid = max(lines(z + offset), lines(along * z + 0.5));
  float a = grid * smoothstep(0.0, soft, v) * strength;
  if (a < 0.002) discard;
  gl_FragColor = vec4(colour, a);
  #include <colorspace_fragment>
}`;

function cssValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function createBackdrop(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  root: THREE.Object3D,
  setting: GridSwitch,
): Backdrop {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const uniforms = {
    colour: { value: new THREE.Color(cssValue('--scene-grid') || FALLBACK_COLOUR) },
    strength: { value: 0 },
    size: { value: new THREE.Vector2(1, 1) },
    ratio: { value: 1 },
    portrait: { value: 0 },
    band: { value: new THREE.Vector2(-1, 1) },
    offset: { value: 0 },
    depth: { value: DEPTH },
    soft: { value: SOFT },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.visible = false;
  scene.add(mesh);

  const read = parseFloat(cssValue('--scene-grid-strength'));
  const base = setting === 'off' ? 0 : setting === 'strong' ? STRONG
    : setting === 'on' ? (read > 0 ? read : FALLBACK_STRENGTH)
    : Number.isFinite(read) ? Math.max(0, read) : FALLBACK_STRENGTH;

  // The station's hull, engines and antenna (not the solar arrays, which reach far out): the band
  // that stays empty is wherever these land on screen.
  const hull = OUTLINE.filter(([, y]) => Math.abs(y) < 5).map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const point = new THREE.Vector3();
  const pixels = new THREE.Vector2();
  let goal = base;
  let shown = 0;
  let travelled = 0;

  const update = (dt: number, still: boolean, portrait: boolean, labels: readonly Label[]) => {
    shown = still ? goal : shown + (goal - shown) * (1 - Math.exp(-dt * 3));
    if (base <= 0 || shown < 0.002) {
      mesh.visible = false;
      return;
    }
    renderer.getDrawingBufferSize(pixels);
    const ratio = renderer.getPixelRatio();
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < hull.length; i++) {
      root.localToWorld(point.copy(hull[i])).project(camera);
      const across = portrait ? point.x : point.y;
      if (across < lo) lo = across;
      if (across > hi) hi = across;
    }
    // The labels too (from the last frame): room names sit outside the hull.
    const span = (portrait ? pixels.x : pixels.y) / ratio;
    for (let i = 0; i < labels.length; i++) {
      const { show, box } = labels[i];
      if (!show) continue;
      const a = portrait ? (2 * box[0]) / span - 1 : 1 - (2 * box[3]) / span;
      const b = portrait ? (2 * box[2]) / span - 1 : 1 - (2 * box[1]) / span;
      if (a < lo) lo = a;
      if (b > hi) hi = b;
    }
    const margin = (2 * MARGIN) / span;
    lo -= margin;
    hi += margin;
    // The station fills the screen (zoomed in): nothing left to draw.
    if (lo <= -1 && hi >= 1) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    if (!still) travelled = (travelled + dt * SPEED) % 1;
    uniforms.strength.value = shown;
    uniforms.size.value.copy(pixels);
    uniforms.ratio.value = ratio;
    uniforms.portrait.value = portrait ? 1 : 0;
    uniforms.band.value.set(lo, hi);
    uniforms.offset.value = travelled;
  };

  const mood = (over: boolean, selected: boolean) => {
    goal = base * (over ? 0.5 : 1) * (selected ? 0.06 : 1);
    const colour = cssValue('--scene-grid');
    if (colour) uniforms.colour.value.set(colour);
  };

  const dispose = () => {
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  };

  return { update, mood, dispose };
}
