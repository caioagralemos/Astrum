// The ground a surface base stands on: a quiet faceted plain in the planet's
// low-polygon style, flat round the base and rising in whole steps towards the
// horizon, with a few rocks and a crater rim. Each face is one flat colour from
// a small palette (grey regolith on the Moon, dusty dark browns on Mars, from
// app.css), lit in three steps like the pixel planet, and it fades towards the
// background with distance so the horizon is soft and the base reads first.
// Kept dark and desaturated: red on this screen means a room over its limit.
//
// It is real geometry in the place's frame, drawn with the scene's own depth
// (pushed back a hair so floor lines and leg pads drawn on it never fight it),
// so modules sink into it and people stand on it. One draw call, built once.

import * as THREE from 'three';
import type { Body, Ground } from '../../../engine/mission.ts';

export interface GroundMesh {
  mesh: THREE.Mesh;
  uniforms: { strength: { value: number } };
  dispose: () => void;
}

const VERTEX = /* glsl */ `
attribute vec3 tone;
varying vec3 vTone;
varying vec3 vNormal;
varying float vFar;
void main() {
  vTone = tone;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vFar = length(position.xz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 sun;
uniform vec3 background;
uniform float strength;
uniform float reach;
varying vec3 vTone;
varying vec3 vNormal;
varying float vFar;
void main() {
  float l = dot(normalize(vNormal), sun);
  float light = l > 0.75 ? 1.0 : l > 0.45 ? 0.8 : 0.6;
  // Full near the base, a quarter at the horizon.
  float fade = 1.0 - 0.75 * smoothstep(30.0, reach, vFar);
  gl_FragColor = vec4(mix(background, vTone * light, strength * fade), 1.0);
  #include <colorspace_fragment>
}`;

function hash(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function cssColour(name: string, fallback: string): THREE.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(value || fallback);
}

export function createGround(ground: Ground, body: Body, background: THREE.Color): GroundMesh {
  const base = body === 'moon' ? cssColour('--scene-ground-moon', '#3d3d3f') : cssColour('--scene-ground-mars', '#33291f');
  const read = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scene-ground-strength'));
  const strength = Number.isFinite(read) ? Math.max(0, read) : 0.6;
  const crater = ground.crater;

  // How high the ground is here, in whole steps: flat where the base stands, rolling further out.
  const height = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    const rolling = THREE.MathUtils.smoothstep(r, 16, 90) * 0.9 + THREE.MathUtils.smoothstep(r, 120, ground.radius) * 14;
    let h = Math.floor(noise(x / 23 + 3, z / 23) * 3) / 3 * rolling + noise(x / 140, z / 140 + 7) * rolling;
    if (crater) {
      const d = Math.hypot(x - crater.at[0], z - crater.at[2]) / crater.radius;
      if (d < 0.85) h -= 1.4 * (1 - d / 0.85);
      else if (d < 1.35) h += 0.9 * (1 - Math.abs(d - 1.05) / 0.3);
    }
    return Math.max(-2, h);
  };

  // A ring grid that is fine near the base and coarse towards the horizon, its corners nudged so
  // the facets are irregular.
  const rings: number[] = [0];
  for (let r = 3; r < ground.radius; r = r * 1.18 + 1.5) rings.push(r);
  rings.push(ground.radius);
  const around = 44;
  const grid: THREE.Vector3[][] = rings.map((r, k) => Array.from({ length: around }, (_, i) => {
    const a = ((i + (k % 2) * 0.5 + (hash(i, k) - 0.5) * 0.4) / around) * Math.PI * 2;
    const rr = k === 0 ? 0 : r * (1 + (hash(k, i) - 0.5) * 0.12);
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    return new THREE.Vector3(x, height(x, z), z);
  }));

  const positions: number[] = [];
  const normals: number[] = [];
  const tones: number[] = [];
  const palette = [0.78, 0.92, 1.04].map((k) => base.clone().multiplyScalar(k));
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const face = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, tone?: THREE.Color) => {
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    if (n.y < 0) {
      n.negate();
      [b, c] = [c, b];
    }
    const colour = tone ?? palette[Math.floor(hash(a.x + c.z, b.z - a.x) * 3)];
    for (const p of [a, b, c]) {
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
      tones.push(colour.r, colour.g, colour.b);
    }
  };
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < around; i++) {
      const j = (i + 1) % around;
      const a = grid[k][i], b = grid[k][j], c = grid[k + 1][i], d = grid[k + 1][j];
      if (k === 0) face(a, c, d);
      else {
        face(a, c, d);
        face(a, d, b);
      }
    }
  }
  // Rocks: a few squat, many-faced lumps, a step darker.
  const rock = base.clone().multiplyScalar(0.62);
  const lump = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
  const lp = lump.getAttribute('position') as THREE.BufferAttribute;
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const r of ground.rocks ?? []) {
    const y = height(r.at[0], r.at[2]);
    for (let i = 0; i < lp.count; i += 3) {
      for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(lp, i + k).multiply(new THREE.Vector3(r.size, r.size * 0.55, r.size * 0.8)).add(new THREE.Vector3(r.at[0], y + r.size * 0.2, r.at[2]));
      n.crossVectors(e1.subVectors(p[1], p[0]), e2.subVectors(p[2], p[0])).normalize();
      for (const q of p) {
        positions.push(q.x, q.y, q.z);
        normals.push(n.x, n.y, n.z);
        tones.push(rock.r, rock.g, rock.b);
      }
    }
  }
  lump.dispose();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('tone', new THREE.Float32BufferAttribute(tones, 3));
  const uniforms = {
    strength: { value: strength },
    sun: { value: new THREE.Vector3(-0.35, 0.85, -0.4).normalize() },
    background: { value: background.clone() },
    reach: { value: ground.radius * 0.8 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData.groundStrength = strength;
  const dispose = () => {
    geometry.dispose();
    material.dispose();
  };
  return { mesh, uniforms, dispose };
}
