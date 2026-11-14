// The star field of the sky behind the station: a few dozen stars on screen at
// a time, most of them single points, a few a little larger, a few small
// plus-shaped sparkles, and a small share that shine up and down slowly, each
// on its own rhythm.
//
// Two looks: 'pixel' snaps every star to a coarse grid of square pixels and lets
// the twinkle jump between four brightness steps, like an 8-bit game; 'soft' draws
// small round points that brighten and dim smoothly. Same stars, same places,
// same brightness either way: they differ in character, not in loudness.
//
// The positions are seeded, so the sky is the same every time. One draw call.

import * as THREE from 'three';

export type SkyStyle = 'pixel' | 'soft' | 'off';

export interface Stars {
  points: THREE.Points;
  uniforms: {
    time: { value: number };
    ratio: { value: number };
    block: { value: number };
    viewport: { value: THREE.Vector2 };
  };
  dispose: () => void;
}

const COUNT = 900;
/** How far off the stars are drawn; anything the station or the planet draws covers them. */
const RADIUS = 100;
/** The depth they are drawn at: behind the planet, in front of the grid. */
const DEPTH = 0.99997;

const VERTEX = /* glsl */ `
attribute vec3 tint;
attribute vec4 look;
attribute float rate;
uniform float time;
uniform float ratio;
uniform float block;
uniform vec2 viewport;
varying vec3 vTint;
varying float vAlpha;
varying float vSize;

void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  float size = look.x;
  #ifdef PIXEL
    // Onto the coarse pixel grid: odd sizes centre on a pixel, even ones on a corner.
    vec2 p = (clip.xy / clip.w * 0.5 + 0.5) * viewport;
    p = mod(size, 2.0) > 0.5 ? (floor(p / block) + 0.5) * block : floor(p / block + 0.5) * block;
    clip.xy = (p / viewport * 2.0 - 1.0) * clip.w;
    gl_PointSize = size * block;
  #else
    gl_PointSize = (1.4 + 0.8 * size) * ratio;
  #endif
  clip.z = clip.w * ${DEPTH};
  // Two slow waves out of step make an uneven rhythm; look.z is how much this star shines up and down (0 for most).
  float wave = sin(time * rate + look.w) + sin(time * rate * 1.618 + look.w * 2.3);
  float v = clamp(0.5 + 0.25 * wave, 0.0, 1.0);
  #ifdef PIXEL
    v = floor(v * 3.999) / 3.0;
  #endif
  vAlpha = look.y * (1.0 - look.z * (1.0 - v));
  vTint = tint;
  vSize = size;
  gl_Position = clip;
}`;

const FRAGMENT = /* glsl */ `
varying vec3 vTint;
varying float vAlpha;
varying float vSize;

void main() {
  float a = vAlpha;
  #ifdef PIXEL
    if (vSize > 2.5) {
      // A sparkle: a plus three pixels across, its arms dimmer than its middle.
      vec2 c = floor(gl_PointCoord * 3.0);
      if (c.x != 1.0 && c.y != 1.0) discard;
      if (c.x != 1.0 || c.y != 1.0) a *= 0.45;
    }
  #else
    a *= 1.0 - smoothstep(0.25, 0.5, length(gl_PointCoord - 0.5));
  #endif
  if (a < 0.01) discard;
  gl_FragColor = vec4(vTint, a);
  #include <colorspace_fragment>
}`;

/** A seeded random number between 0 and 1, so the sky is the same every time. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createStars(style: 'pixel' | 'soft', ink: THREE.Color): Stars {
  const random = seeded(11);
  const positions = new Float32Array(COUNT * 3);
  const tints = new Float32Array(COUNT * 3);
  const looks = new Float32Array(COUNT * 4);
  const rates = new Float32Array(COUNT);
  const warm = new THREE.Color(1, 0.9, 0.78);
  const cool = new THREE.Color(0.8, 0.9, 1);
  const tint = new THREE.Color();
  for (let i = 0; i < COUNT; i++) {
    const u = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    positions.set([Math.cos(a) * s * RADIUS, u * RADIUS, Math.sin(a) * s * RADIUS], i * 3);
    const hue = random();
    tint.copy(ink);
    if (hue < 0.15) tint.multiply(warm);
    else if (hue > 0.85) tint.multiply(cool);
    tints.set([tint.r, tint.g, tint.b], i * 3);
    // Mostly single points; some a step larger; a few sparkles, which always shine a little.
    const kind = random();
    const size = kind < 0.06 ? 3 : kind < 0.2 ? 2 : 1;
    const level = size === 3 ? 0.95 : [0.45, 0.65, 0.9][Math.floor(random() * random() * 3)];
    const twinkles = size === 3 || random() < 0.15;
    looks.set([size, level, twinkles ? 0.55 : 0, random() * Math.PI * 2], i * 4);
    rates[i] = 0.35 + random() * 0.55;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('tint', new THREE.BufferAttribute(tints, 3));
  geometry.setAttribute('look', new THREE.BufferAttribute(looks, 4));
  geometry.setAttribute('rate', new THREE.BufferAttribute(rates, 1));
  const uniforms = {
    time: { value: 0 },
    ratio: { value: 1 },
    block: { value: 2 },
    viewport: { value: new THREE.Vector2(1, 1) },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    defines: style === 'pixel' ? { PIXEL: '' } : {},
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -9;
  const dispose = () => {
    geometry.dispose();
    material.dispose();
  };
  return { points, uniforms, dispose };
}
