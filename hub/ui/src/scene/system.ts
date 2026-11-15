// The sky of a ship in transit, between bodies: no planet below, only the solar
// system seen from somewhere in the middle of it. The Sun is a small bright
// disc; Earth and Mars, where the ship comes from and goes to, are small
// low-polygon globes (planet.ts, the same drawing as the planet under an
// orbiting ship), lit from the Sun's side so each shows a phase; Venus and
// Jupiter are single pale points. All of it far off and quiet: a backdrop,
// not a planetarium. It does not say where the ship is: the places are set
// against the default view, round the station's edges (the Sun and Venus
// upper left, Mars upper right, Earth right, Jupiter low left), so none sits
// behind the station or the top bar. They are fixed in the sky, so turning the
// view swings them round with the stars.
//
// backdrop.ts calls place() with the default view's axes, and update() before
// each frame. The bodies sway very slowly about their places and the globes
// turn; with reduced motion they stand still.

import * as THREE from 'three';
import { createPlanet } from './planet.ts';
import type { Planet } from './planet.ts';
import type { Body } from '../../../engine/mission.ts';

export interface DistantSystem {
  /** Lay the bodies out against the default view: the way it looks, and its up and right on screen, in the world. */
  place: (forward: THREE.Vector3, up: THREE.Vector3, right: THREE.Vector3, aspect: number) => void;
  update: (camera: THREE.PerspectiveCamera, clock: number, strength: number, block: number, viewport: THREE.Vector2) => void;
  dispose: () => void;
}

/** How far off the bodies are drawn: inside the camera's far plane, like the planet below an orbiting ship. */
const DISTANCE = 200;
/** Radians per second the globes turn, as the planet below does. */
const SPIN = 0.002;
/** The slow sway about each body's place: degrees, and seconds per cycle. */
const SWAY = 1.2;
const SWAY_PERIOD = 900;

/**
 * Where each body sits in the default view: right and up from its middle, as the tangent of the
 * angle (0.27 is the top edge of the view, whose half-height is 15 degrees); angular radius in degrees.
 */
const SUN = { x: -0.27, y: 0.135, core: 0.42, halo: 2.2 };
const GLOBES: { body: Body; x: number; y: number; size: number; phase: number }[] = [
  { body: 'earth', x: 0.35, y: -0.07, size: 0.75, phase: 0 },
  { body: 'mars', x: 0.25, y: 0.12, size: 0.5, phase: 2.1 },
];
const POINTS: { colour: [string, string]; x: number; y: number; phase: number }[] = [
  { colour: ['--scene-venus', '#d9d2bf'], x: -0.19, y: 0.105, phase: 4.2 },
  { colour: ['--scene-jupiter', '#c9b89c'], x: -0.33, y: -0.085, phase: 1.3 },
];

/** A disc that always faces the camera: a bright core and, for the Sun, a soft glow round it, stepped in the pixel look. */
const DISC_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Behind the planet slice and the station, in front of the stars (stars.ts) and the sky.
  clip.z = clip.w * 0.99995;
  gl_Position = clip;
}`;

const DISC_FRAGMENT = /* glsl */ `
uniform vec3 tint;
uniform float core;
uniform float strength;
uniform float cells;
uniform float glow;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  #ifdef PIXEL
    // Snapped to whole chunky pixels, so the disc reads as part of the 8-bit sky.
    p = (floor(vUv * cells) + 0.5) / cells - 0.5;
  #endif
  float d = length(p) * 2.0;
  float a;
  #ifdef PIXEL
    // The glow: one quiet ring, then a sparse checker that thins out, all stepped.
    float checker = step(0.5, fract((floor(vUv.x * cells) + floor(vUv.y * cells)) * 0.5));
    a = d < core ? 1.0 : glow * (d < core * 1.6 ? 0.14 : d < 0.7 ? 0.06 * checker : 0.0);
  #else
    a = d < core ? 1.0 : glow * 0.25 * exp(-6.0 * (d - core) / max(1.0 - core, 0.001)) * (1.0 - smoothstep(0.8, 1.0, d));
  #endif
  a *= strength;
  if (a < 0.01) discard;
  gl_FragColor = vec4(tint, a);
  #include <colorspace_fragment>
}`;

interface Disc {
  mesh: THREE.Mesh;
  uniforms: { tint: { value: THREE.Color }; core: { value: number }; strength: { value: number }; cells: { value: number }; glow: { value: number } };
  /** Angular radius of the quad (the glow's edge), radians. */
  radius: number;
  rest: [number, number];
  phase: number;
  /** How bright it is against the others: the Sun above 1, so it reaches full white before the rest. */
  level: number;
  /** A point: drawn three cells across, each two of the sky's chunky pixels, whatever its angular size. */
  point: boolean;
}

function cssColour(name: string, fallback: string): THREE.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(value || fallback);
}


export function createDistantSystem(scene: THREE.Scene, style: 'pixel' | 'soft', background: THREE.Color): DistantSystem {
  const pixel = style === 'pixel';
  const quad = new THREE.PlaneGeometry(1, 1);
  const discs: Disc[] = [];
  const disc = (tint: THREE.Color, core: number, halo: number, x: number, y: number, phase: number, level: number, glow: number) => {
    const uniforms = { tint: { value: tint }, core: { value: core / halo }, strength: { value: 0 }, cells: { value: 8 }, glow: { value: glow } };
    const material = new THREE.ShaderMaterial({
      vertexShader: DISC_VERTEX, fragmentShader: DISC_FRAGMENT, uniforms,
      defines: pixel ? { PIXEL: '' } : {}, transparent: true, depthWrite: false,
    });
    const mesh = new THREE.Mesh(quad, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -8;
    mesh.visible = false;
    scene.add(mesh);
    discs.push({ mesh, uniforms, radius: THREE.MathUtils.degToRad(halo), rest: [x, y], phase, level, point: glow === 0 });
  };
  // The Sun: warm white, the brightest thing in the sky but small.
  disc(cssColour('--scene-sun', '#fff1d6'), SUN.core, SUN.halo, SUN.x, SUN.y, 0, 1.4, 1);
  // Venus and Jupiter: a point each, no glow; the quad is three chunky pixels across, lit only in the middle.
  for (const p of POINTS) disc(cssColour(p.colour[0], p.colour[1]), 1, 3, p.x, p.y, p.phase, 0.7, 0);

  const globes: { planet: Planet; rest: [number, number]; size: number; phase: number }[] = GLOBES.map((g) => {
    const planet = createPlanet(style, g.body, background);
    scene.add(planet.mesh);
    return { planet, rest: [g.x, g.y], size: THREE.MathUtils.degToRad(g.size), phase: g.phase };
  });

  const forward = new THREE.Vector3(0, 0, -1);
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3(1, 0, 0);
  /** On a screen narrower than a laptop's, the bodies come in from the sides by as much. */
  let narrow = 1;
  /** The globes turn about the view's up, so their poles stay top and bottom on screen. */
  const tilt = new THREE.Quaternion();
  const at = new THREE.Vector3();
  const light = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const spin = new THREE.Quaternion();

  /** Where a body is now, in the world: its place in the default view, swayed a little. */
  const where = (out: THREE.Vector3, [x, y]: [number, number], phase: number, clock: number) => {
    const k = Math.tan(THREE.MathUtils.degToRad(SWAY));
    const w = (clock / SWAY_PERIOD) * Math.PI * 2 + phase;
    return out.copy(forward)
      .addScaledVector(right, x * narrow + Math.sin(w * 0.7) * k * 0.5)
      .addScaledVector(up, y + Math.sin(w) * k * 0.5)
      .normalize();
  };

  const place = (f: THREE.Vector3, u: THREE.Vector3, r: THREE.Vector3, aspect: number) => {
    narrow = Math.min(1, aspect / 1.6);
    forward.copy(f);
    up.copy(u);
    right.copy(r);
    tilt.setFromUnitVectors(yAxis, up);
  };

  const update = (camera: THREE.PerspectiveCamera, clock: number, strength: number, block: number, viewport: THREE.Vector2) => {
    const pxPerRadian = viewport.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    for (const d of discs) {
      d.mesh.visible = strength > 0.002;
      where(at, d.rest, d.phase, clock);
      d.mesh.position.copy(at).multiplyScalar(DISTANCE).add(camera.position);
      d.mesh.quaternion.copy(camera.quaternion);
      d.uniforms.strength.value = Math.min(1, strength * d.level);
      if (d.point) {
        // Lit only in its middle cell: one point two chunky pixels wide, like a larger star.
        d.mesh.scale.setScalar((DISTANCE * 3 * 2 * block) / pxPerRadian);
        d.uniforms.cells.value = 3;
      } else {
        d.mesh.scale.setScalar(2 * DISTANCE * Math.tan(d.radius));
        // The quad's width in the sky's chunky pixels (the nebula's size, backdrop.ts).
        d.uniforms.cells.value = Math.max(3, Math.round((2 * d.radius * pxPerRadian) / (block * 1.5)));
      }
    }
    const sun = where(light, [SUN.x, SUN.y], 0, clock);
    for (const g of globes) {
      const { planet } = g;
      planet.mesh.visible = strength > 0.002;
      where(at, g.rest, g.phase, clock);
      planet.mesh.position.copy(at).multiplyScalar(DISTANCE).add(camera.position);
      planet.mesh.scale.setScalar(DISTANCE * Math.sin(g.size));
      planet.mesh.quaternion.copy(tilt).multiply(spin.setFromAxisAngle(yAxis, (clock * SPIN + g.phase) % (Math.PI * 2)));
      // Lit from the Sun's side of the sky, so the near half of each globe faces it: a phase, not a full disc.
      planet.uniforms.sun.value.copy(sun).sub(at).normalize();
      planet.uniforms.strength.value = strength;
      planet.uniforms.near.value = DISTANCE * (1 - Math.sin(g.size) * 1.08);
      planet.uniforms.span.value = DISTANCE * (Math.cos(g.size) + Math.sin(g.size) * 1.08) - planet.uniforms.near.value;
    }
  };

  const dispose = () => {
    for (const d of discs) {
      scene.remove(d.mesh);
      (d.mesh.material as THREE.Material).dispose();
    }
    quad.dispose();
    for (const g of globes) {
      scene.remove(g.planet.mesh);
      g.planet.dispose();
    }
  };

  return { place, update, dispose };
}
