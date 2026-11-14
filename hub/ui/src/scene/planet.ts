// The body below the station (or, from the Moon, Earth above the horizon): a
// low-polygon globe whose faces are raised in whole steps (low plains,
// plateaus, higher ground, craters, pale polar caps), each face one flat colour
// from a small palette, lit in two or three steps. No textures: the terrain
// comes from a seeded function, built once. Kept dim and desaturated on purpose:
// red on this screen means a room over its limit, and the planet must never
// read as an alarm.
//
// Three bodies, same style, small palettes from app.css: Mars (dusty browns,
// a pale cap, a few craters), the Moon (greys, darker seas, many craters) and
// Earth (dim oceans, muted land, pale caps, no craters).
//
// 'pixel' style is coarser (bigger faces, taller steps, three light steps);
// 'soft' has finer faces and a gentler light.

import * as THREE from 'three';
import type { Body } from '../../../engine/mission.ts';

export interface Planet {
  mesh: THREE.Mesh;
  uniforms: {
    strength: { value: number };
    sun: { value: THREE.Vector3 };
    near: { value: number };
    span: { value: number };
  };
  dispose: () => void;
}

/**
 * The slice of the depth range the planet is drawn in: behind everything in the scene (the station is
 * never further off than about 85, which is 0.9981), in front of the stars (0.99997) and the sky (1).
 * Within it the planet keeps its own near-to-far order, so its faces never fight over the same depth.
 */
const DEPTH_FROM = 0.999;
const DEPTH_SPAN = 0.0009;

const VERTEX = /* glsl */ `
attribute vec3 tone;
uniform float near;
uniform float span;
varying vec3 vTone;
varying vec3 vNormal;

void main() {
  vTone = tone;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 seen = viewMatrix * modelMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * seen;
  // How far this point is, mapped into the planet's own slice of the depth range.
  float far = clamp((length(seen.xyz) - near) / span, 0.0, 1.0);
  clip.z = clip.w * (${DEPTH_FROM} + ${DEPTH_SPAN} * far);
  gl_Position = clip;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 sun;
uniform vec3 background;
uniform float strength;
varying vec3 vTone;
varying vec3 vNormal;

void main() {
  float l = dot(normalize(vNormal), sun);
  #ifdef PIXEL
    float light = l > 0.35 ? 1.0 : l > -0.05 ? 0.74 : 0.52;
  #else
    float light = 0.52 + 0.48 * smoothstep(-0.25, 0.65, l);
  #endif
  gl_FragColor = vec4(mix(background, vTone * light, strength), 1.0);
  #include <colorspace_fragment>
}`;

function hash(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/** Smooth value noise, 0..1. */
function noise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const plane = (k: number) => lerp(
    lerp(hash(ix, iy, k), hash(ix + 1, iy, k), sx),
    lerp(hash(ix, iy + 1, k), hash(ix + 1, iy + 1, k), sx), sy);
  return lerp(plane(iz), plane(iz + 1), sz);
}

const CRATERS: [number, number, number, number][] = [
  // direction (unnormalised) and angular radius
  [0.6, 0.15, 0.78, 0.12],
  [-0.5, -0.3, 0.8, 0.17],
  [0.1, 0.55, -0.82, 0.14],
  [-0.7, 0.2, -0.4, 0.1],
  [0.3, -0.6, -0.5, 0.15],
];

function cssColour(name: string, fallback: string): THREE.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(value || fallback);
}

/** The Moon's extra craters, on top of the shared ones. */
const MOON_CRATERS: [number, number, number, number][] = [
  [0.2, -0.1, 0.95, 0.09], [-0.85, 0.45, 0.2, 0.13], [0.7, 0.6, -0.3, 0.08], [-0.2, -0.85, 0.4, 0.11], [0.45, 0.3, 0.55, 0.06],
];

export function createPlanet(style: 'pixel' | 'soft', body: Body, background: THREE.Color): Planet {
  const pixel = style === 'pixel';
  const earth = body === 'earth';
  const moon = body === 'moon';
  const base = earth ? cssColour('--scene-earth-land', '#353a2e') : moon ? cssColour('--scene-moon', '#4a4a4c') : cssColour('--scene-planet', '#3b322b');
  const cap = earth ? cssColour('--scene-earth-cap', '#767c82') : cssColour('--scene-planet-cap', '#6e6a65');
  const ocean = cssColour('--scene-earth-ocean', '#1c2735');
  const geometry = new THREE.IcosahedronGeometry(1, pixel ? 12 : 14);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const step = pixel ? 0.02 : 0.012;
  const craters = (earth ? [] : moon ? [...CRATERS, ...MOON_CRATERS] : CRATERS)
    .map(([x, y, z, r]) => ({ dir: new THREE.Vector3(x, y, z).normalize(), cos: Math.cos(r), rim: Math.cos(r * 1.3) }));
  const p = new THREE.Vector3();
  // What each point of the ground is: its height in whole steps, and whether it is sea, a crater floor or a cap.
  const ground = (v: THREE.Vector3) => {
    const n = 0.6 * noise(v.x * 4 + 5, v.y * 4, v.z * 4) + 0.4 * noise(v.x * 9 + 9, v.y * 9, v.z * 9);
    let level = n < 0.42 ? 0 : n < 0.58 ? 1 : 2;
    // Earth's oceans lie flat at the lowest step; the Moon's dark seas too.
    const sea = (earth && n < 0.5) || (moon && n < 0.4);
    if (sea) level = 0;
    let crater = false;
    for (const c of craters) {
      const d = v.dot(c.dir);
      if (d > c.cos) { level = 0; crater = true; }
      else if (d > c.rim) level = Math.min(level + 1, 3);
    }
    return { level, crater, sea, capped: !moon && Math.abs(v.y) > (earth ? 0.9 : 0.86) };
  };
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).normalize();
    const { level, capped } = ground(p);
    p.multiplyScalar(1 + (capped ? 2 : level) * step);
    position.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();

  // One colour per face, from the ground at its middle.
  const palette = [0.55, 0.78, 1, 1.12].map((k) => base.clone().multiplyScalar(k));
  const crust = base.clone().multiplyScalar(0.45);
  const sea = earth ? ocean : base.clone().multiplyScalar(0.62);
  const tones = new Float32Array(position.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 3) {
    p.fromBufferAttribute(position, i).add(a.fromBufferAttribute(position, i + 1)).add(b.fromBufferAttribute(position, i + 2)).normalize();
    const g = ground(p);
    const colour = g.capped ? cap : g.crater ? crust : g.sea ? sea : palette[g.level];
    for (let k = 0; k < 3; k++) tones.set([colour.r, colour.g, colour.b], (i + k) * 3);
  }
  geometry.setAttribute('tone', new THREE.BufferAttribute(tones, 3));

  const uniforms = {
    strength: { value: 0 },
    sun: { value: new THREE.Vector3(0, 1, 0) },
    background: { value: background.clone() },
    near: { value: 0 },
    span: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    defines: pixel ? { PIXEL: '' } : {},
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  const dispose = () => {
    geometry.dispose();
    material.dispose();
  };
  return { mesh, uniforms, dispose };
}
