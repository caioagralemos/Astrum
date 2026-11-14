// The crew figure as a jointed rig. The body is the hub's crew avatar (the same
// bevelled rings, drawn the same way: white outline over a fill in the
// background colour, so a figure hides what is behind it), cut into fifteen
// rigid pieces that turn about real joints: hips (the root, at the centre of
// mass), chest, head; for each arm the upper arm, forearm and hand; for each
// leg the thigh, shin and foot.
//
// Arms and legs are placed by two-bone inverse kinematics: the step says where
// the wrist (or ankle) must be and which way the elbow (or knee) points, and the
// rig finds the joint angles, so a hand put on a chest, a bar or someone's arm
// lands exactly there and stays there however the body moves. Hands and feet
// either follow their forearm and shin, or are given a world orientation (a palm
// flat on a chest, toes hooked under a bar).
//
// Each frame the posed vertices are written into one line object and one fill
// mesh per figure (two draw calls), from buffers made once: nothing is
// allocated while animating.

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

type Ring = [number, number, number, number]; // height, half-width, half-depth, sideways offset

export const PELVIS = 0;
export const CHEST = 1;
export const HEAD = 2;
/** Arm a (0: the figure's -x side, 1: its +x side): upper arm, forearm, hand. */
export const UPPER = (a: number) => 3 + a * 3;
export const FORE = (a: number) => 4 + a * 3;
export const HAND = (a: number) => 5 + a * 3;
/** Leg l: thigh, shin, foot. */
export const THIGH = (l: number) => 9 + l * 3;
export const SHIN = (l: number) => 10 + l * 3;
export const FOOT = (l: number) => 11 + l * 3;
const BONES = 15;
const sideOf = (i: number) => (i === 0 ? -1 : 1);

/** Where each joint is in the avatar's rest pose (standing, feet at y = 0, facing +z). */
const REST: [number, number, number][] = [
  [0, 0.98, 0], [0, 1.075, 0], [0, 1.5, 0],
  [-0.185, 1.395, 0], [-0.257, 1.07, 0], [-0.308, 0.82, 0],
  [0.185, 1.395, 0], [0.257, 1.07, 0], [0.308, 0.82, 0],
  [-0.088, 0.93, 0], [-0.106, 0.54, 0], [-0.119, 0.085, 0],
  [0.088, 0.93, 0], [0.106, 0.54, 0], [0.119, 0.085, 0],
];
const PARENT = [-1, PELVIS, CHEST, CHEST, 3, 4, CHEST, 6, 7, PELVIS, 9, 10, PELVIS, 12, 13];

/** The centre of mass in the rest pose: the root turns about it. */
export const COM_HEIGHT = REST[PELVIS][1];
export const UPPER_ARM = Math.hypot(REST[4][0] - REST[3][0], REST[4][1] - REST[3][1]);
export const FOREARM = Math.hypot(REST[5][0] - REST[4][0], REST[5][1] - REST[4][1]);
export const THIGH_LEN = Math.hypot(REST[10][0] - REST[9][0], REST[10][1] - REST[9][1]);
export const SHIN_LEN = Math.hypot(REST[11][0] - REST[10][0], REST[11][1] - REST[10][1]);

/** The avatar's rings (from the hub's crew avatar), and the bone each piece belongs to. */
function pieces(): { bone: number; rings: Ring[]; z: number }[] {
  const out: { bone: number; rings: Ring[]; z: number }[] = [];
  const add = (bone: number, rings: Ring[], z = 0) => out.push({ bone, rings, z });
  for (const side of [-1, 1]) add(HEAD, [[1.635, 0.018, 0.022, side * 0.108], [1.685, 0.018, 0.022, side * 0.108]]);
  add(HEAD, [[1.57, 0.068, 0.065, 0], [1.6, 0.096, 0.083, 0], [1.73, 0.103, 0.087, 0], [1.79, 0.077, 0.069, 0]]);
  add(HEAD, [[1.49, 0.049, 0.047, 0], [1.58, 0.049, 0.047, 0]]);
  add(CHEST, [[1.075, 0.118, 0.075, 0], [1.27, 0.169, 0.095, 0], [1.4, 0.183, 0.088, 0], [1.46, 0.145, 0.073, 0], [1.5, 0.081, 0.058, 0]]);
  add(PELVIS, [[0.91, 0.095, 0.067, 0], [0.97, 0.151, 0.085, 0], [1.075, 0.118, 0.075, 0]]);
  for (let i = 0; i < 2; i++) {
    const side = sideOf(i);
    add(UPPER(i), [[1.07, 0.047, 0.048, side * 0.257], [1.34, 0.062, 0.06, side * 0.214], [1.41, 0.052, 0.052, side * 0.18]]);
    add(FORE(i), [[0.82, 0.031, 0.035, side * 0.308], [0.99, 0.044, 0.044, side * 0.282], [1.07, 0.047, 0.048, side * 0.257]]);
    add(HAND(i), [[0.68, 0.028, 0.026, side * 0.318], [0.705, 0.044, 0.03, side * 0.328], [0.775, 0.047, 0.033, side * 0.321], [0.82, 0.031, 0.035, side * 0.308]]);
    add(HAND(i), [[0.715, 0.016, 0.02, side * 0.275], [0.77, 0.02, 0.026, side * 0.279]], 0.012);
    add(THIGH(i), [[0.54, 0.056, 0.058, side * 0.106], [0.77, 0.074, 0.073, side * 0.091], [0.965, 0.077, 0.073, side * 0.079]]);
    add(SHIN(i), [[0.1, 0.036, 0.039, side * 0.119], [0.34, 0.054, 0.057, side * 0.113], [0.45, 0.057, 0.057, side * 0.108], [0.54, 0.056, 0.058, side * 0.106]]);
    add(FOOT(i), [[0.025, 0.047, 0.095, side * 0.119], [0.065, 0.047, 0.095, side * 0.119], [0.105, 0.037, 0.057, side * 0.119]], 0.043);
  }
  return out;
}

const PROFILE = [[-0.65, -1], [0.65, -1], [1, -0.65], [1, 0.65], [0.65, 1], [-0.65, 1], [-1, 0.65], [-1, -0.65]];

// Scratch, shared by every figure (solving is single-threaded and never re-entrant).
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const dir = new THREE.Vector3();
const pole = new THREE.Vector3();
const elbow = new THREE.Vector3();
const nT = new THREE.Vector3();
const crossT = new THREE.Vector3();
const basis = new THREE.Matrix4();
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

/** One limb's goal for this frame. */
export interface Limb {
  /** Where the wrist (ankle) should be, in the world. */
  target: THREE.Vector3;
  /** Which way the elbow (knee) points, in the world (need not be unit length). */
  pole: THREE.Vector3;
  /** The hand (foot) follows its forearm (shin), turned by `local`; by `weight` (0 to 1) it takes the world orientation `world` instead. */
  world: THREE.Quaternion;
  weight: number;
  local: THREE.Quaternion;
  /** How far the last solve fell short of the target (0 when reached), for checking contacts. */
  miss: number;
}

const limb = (): Limb => ({ target: new THREE.Vector3(), pole: new THREE.Vector3(0, 0, 1), world: new THREE.Quaternion(), weight: 0, local: new THREE.Quaternion(), miss: 0 });

export interface FigureLook {
  ink: THREE.Color;
  bg: THREE.Color;
}

export class Figure {
  readonly lines: LineSegments2;
  readonly fill: THREE.Mesh;
  readonly lineMaterial: LineMaterial;
  readonly fillMaterial: THREE.MeshBasicMaterial;
  /** The centre of mass in the world, and the body's turn about it. */
  readonly root = new THREE.Vector3();
  readonly turn = new THREE.Quaternion();
  /** The chest's turn on the hips, and the head's on the chest. */
  readonly chest = new THREE.Quaternion();
  readonly head = new THREE.Quaternion();
  readonly arms: [Limb, Limb] = [limb(), limb()];
  readonly legs: [Limb, Limb] = [limb(), limb()];
  /** Posed joints, in the world. */
  readonly at: THREE.Vector3[] = Array.from({ length: BONES }, () => new THREE.Vector3());
  readonly q: THREE.Quaternion[] = Array.from({ length: BONES }, () => new THREE.Quaternion());
  /** Chest press (CPR): how far the front of the lower chest is pushed in, in metres. */
  press = 0;

  private readonly rest: Float32Array;
  private readonly boneOf: Uint8Array;
  private readonly posed: Float32Array;
  private readonly edges: Uint16Array;
  private readonly segs: Float32Array;
  private readonly segBuffer: THREE.InterleavedBuffer;
  private readonly fillPos: THREE.BufferAttribute;
  private readonly m = new Float32Array(BONES * 9);
  private readonly look: FigureLook;
  private strength = 1;
  private alpha = 1;

  constructor(look: FigureLook, width = 2) {
    this.look = look;
    const verts: number[] = [];
    const bones: number[] = [];
    const tris: number[] = [];
    const edges: number[] = [];
    for (const { bone, rings, z } of pieces()) {
      const base = verts.length / 3;
      const [px, py, pz] = REST[bone];
      for (const [y, w, d, x] of rings) {
        for (const [ux, uz] of PROFILE) {
          verts.push(x + ux * w - px, y - py, z + uz * d - pz);
          bones.push(bone);
        }
      }
      for (let r = 0; r < rings.length - 1; r++) {
        for (let i = 0; i < 8; i++) {
          const a = base + r * 8 + i, b = base + r * 8 + ((i + 1) % 8), c = base + (r + 1) * 8 + i, d = base + (r + 1) * 8 + ((i + 1) % 8);
          tris.push(a, c, b, b, c, d);
        }
      }
      for (let i = 1; i < 7; i++) tris.push(base, base + i + 1, base + i);
      const end = base + (rings.length - 1) * 8;
      for (let i = 1; i < 7; i++) tris.push(end, end + i, end + i + 1);
      for (let r = 0; r < rings.length; r++) for (let i = 0; i < 8; i++) edges.push(base + r * 8 + i, base + r * 8 + ((i + 1) % 8));
      // Four lengthwise edges keep the silhouette readable without a dense cage.
      for (let r = 0; r < rings.length - 1; r++) for (const i of [0, 2, 4, 6]) edges.push(base + r * 8 + i, base + (r + 1) * 8 + i);
    }
    this.rest = new Float32Array(verts);
    this.boneOf = new Uint8Array(bones);
    this.posed = new Float32Array(verts.length);
    this.edges = new Uint16Array(edges);

    const lineGeometry = new LineSegmentsGeometry();
    lineGeometry.setPositions(new Float32Array(edges.length * 3));
    const start = lineGeometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute;
    this.segBuffer = start.data;
    this.segs = this.segBuffer.array as Float32Array;
    this.segBuffer.setUsage(THREE.DynamicDrawUsage);
    this.lineMaterial = new LineMaterial({ color: look.ink.getHex(), linewidth: width, transparent: true });
    this.lineMaterial.fog = true;
    this.lines = new LineSegments2(lineGeometry, this.lineMaterial);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 2;

    const fillGeometry = new THREE.BufferGeometry();
    this.fillPos = new THREE.BufferAttribute(this.posed, 3);
    this.fillPos.setUsage(THREE.DynamicDrawUsage);
    fillGeometry.setAttribute('position', this.fillPos);
    fillGeometry.setIndex(tris);
    this.fillMaterial = new THREE.MeshBasicMaterial({ color: look.bg, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 });
    this.fill = new THREE.Mesh(fillGeometry, this.fillMaterial);
    this.fill.frustumCulled = false;

    this.reset();
  }

  addTo(parent: THREE.Object3D) {
    parent.add(this.fill, this.lines);
  }

  /** Back to a neutral float: arms and legs placed by the default targets in the body's frame. */
  reset() {
    this.turn.identity();
    this.chest.identity();
    this.head.identity();
    this.press = 0;
    for (const l of [...this.arms, ...this.legs]) { l.weight = 0; l.local.identity(); }
  }

  /** How strong the figure's line is (0 to 1 of the ink), its width in pixels, and how present it is (0 to 1). */
  style(strength: number, width: number, alpha = 1) {
    if (strength !== this.strength) {
      this.strength = strength;
      this.lineMaterial.color.copy(this.look.bg).lerp(this.look.ink, strength);
    }
    this.lineMaterial.linewidth = width;
    if (alpha !== this.alpha) {
      this.alpha = alpha;
      this.lineMaterial.opacity = alpha;
      const solid = alpha >= 0.999;
      this.fillMaterial.transparent = !solid;
      this.fillMaterial.opacity = alpha;
      this.fillMaterial.depthWrite = alpha > 0.5;
      this.fill.visible = alpha > 0.01;
      this.lines.visible = alpha > 0.01;
    }
  }

  /** A point in the body's frame (origin at the centre of mass, facing +z, up +y) into the world. */
  body(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(x, y, z).applyQuaternion(this.turn).add(this.root);
  }

  /** A direction in the body's frame into the world. */
  bodyDir(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(x, y, z).applyQuaternion(this.turn);
  }

  /** A point given in a bone's rest frame (avatar metres, relative to that joint), where it is now. */
  point(bone: number, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(x, y, z).applyQuaternion(this.q[bone]).add(this.at[bone]);
  }

  /** A point given in avatar rest coordinates (feet at 0, facing +z), carried by its bone. */
  restPoint(bone: number, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const r = REST[bone];
    return this.point(bone, x - r[0], y - r[1], z - r[2], out);
  }

  /** Place every bone from the root, the chest and head turns and the limb goals. */
  solve() {
    const { at, q } = this;
    q[PELVIS].copy(this.turn);
    at[PELVIS].copy(this.root);
    this.fk(CHEST, this.chest);
    this.fk(HEAD, this.head);
    for (let i = 0; i < 2; i++) {
      this.joint(UPPER(i));
      this.ik(UPPER(i), FORE(i), HAND(i), this.arms[i], UPPER_ARM, FOREARM, ARM_REST[i]);
      this.joint(THIGH(i));
      this.ik(THIGH(i), SHIN(i), FOOT(i), this.legs[i], THIGH_LEN, SHIN_LEN, LEG_REST[i]);
    }
  }

  /** Where a bone's joint is, carried from its parent. */
  private joint(bone: number) {
    const p = PARENT[bone];
    const r = REST[bone];
    const rp = REST[p];
    this.at[bone].set(r[0] - rp[0], r[1] - rp[1], r[2] - rp[2]).applyQuaternion(this.q[p]).add(this.at[p]);
  }

  private fk(bone: number, local: THREE.Quaternion) {
    this.joint(bone);
    this.q[bone].copy(this.q[PARENT[bone]]).multiply(local);
  }

  private ik(a: number, b: number, c: number, goal: Limb, l1: number, l2: number, rest: LimbRest) {
    const s = this.at[a];
    dir.subVectors(goal.target, s);
    let d = dir.length();
    const max = (l1 + l2) * 0.9995;
    const min = Math.abs(l1 - l2) + 1e-3;
    goal.miss = d > max ? d - max : 0;
    if (goal.weight > 0.5 && goal.miss > MISSES.worst) { MISSES.worst = goal.miss; MISSES.bone = c; }
    d = Math.min(max, Math.max(min, d));
    dir.normalize();
    pole.copy(goal.pole).addScaledVector(dir, -goal.pole.dot(dir));
    if (pole.lengthSq() < 1e-8) pole.set(0, 0, 1).applyQuaternion(this.turn).addScaledVector(dir, -dir.z);
    pole.normalize();
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    elbow.copy(s).addScaledVector(dir, along).addScaledVector(pole, h);
    // The bend's axis, the same for both segments: pole x direction.
    nT.crossVectors(pole, dir).normalize();
    v1.subVectors(elbow, s).normalize();
    frame(v1, nT, this.q[a]).multiply(rest.upper);
    this.at[b].copy(elbow);
    v2.copy(s).addScaledVector(dir, d);
    v1.subVectors(v2, elbow).normalize();
    frame(v1, nT, this.q[b]).multiply(rest.lower);
    // The wrist (ankle) joint, from the forearm (shin) as built: exactly where the solve put it.
    this.joint(c);
    this.q[c].copy(this.q[b]).multiply(goal.local);
    if (goal.weight > 0) this.q[c].slerp(goal.world, Math.min(1, goal.weight));
  }

  /** Write the posed body into the line and fill buffers. */
  draw() {
    const { m, q, at, rest, posed, boneOf } = this;
    for (let b = 0; b < BONES; b++) {
      const { x, y, z, w } = q[b];
      const o = b * 9;
      m[o] = 1 - 2 * (y * y + z * z); m[o + 1] = 2 * (x * y + z * w); m[o + 2] = 2 * (x * z - y * w);
      m[o + 3] = 2 * (x * y - z * w); m[o + 4] = 1 - 2 * (x * x + z * z); m[o + 5] = 2 * (y * z + x * w);
      m[o + 6] = 2 * (x * z + y * w); m[o + 7] = 2 * (y * z - x * w); m[o + 8] = 1 - 2 * (x * x + y * y);
    }
    const press = this.press;
    const chestY = REST[CHEST][1];
    for (let i = 0, n = boneOf.length; i < n; i++) {
      const b = boneOf[i];
      let x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
      if (press !== 0 && b === CHEST && z > 0) {
        // The lower half of the breastbone goes in under the hands; the sides and the top much less.
        const dy = (y + chestY - STERNUM_Y) / 0.12;
        const wy = Math.exp(-dy * dy);
        const wx = Math.exp(-(x * x) / (0.16 * 0.16));
        z -= press * wy * (0.35 + 0.65 * wx) * Math.min(1, z / 0.06);
      }
      const o = b * 9;
      const p = at[b];
      posed[i * 3] = m[o] * x + m[o + 3] * y + m[o + 6] * z + p.x;
      posed[i * 3 + 1] = m[o + 1] * x + m[o + 4] * y + m[o + 7] * z + p.y;
      posed[i * 3 + 2] = m[o + 2] * x + m[o + 5] * y + m[o + 8] * z + p.z;
    }
    const { edges, segs } = this;
    for (let e = 0, n = edges.length / 2; e < n; e++) {
      const a = edges[e * 2] * 3, b = edges[e * 2 + 1] * 3;
      segs[e * 6] = posed[a]; segs[e * 6 + 1] = posed[a + 1]; segs[e * 6 + 2] = posed[a + 2];
      segs[e * 6 + 3] = posed[b]; segs[e * 6 + 4] = posed[b + 1]; segs[e * 6 + 5] = posed[b + 2];
    }
    this.segBuffer.needsUpdate = true;
    this.fillPos.needsUpdate = true;
  }
}

/** The worst a hand or foot in contact fell short of its target since last reset (for checking). */
export const MISSES = { worst: 0, bone: -1 };

/** The lower half of the breastbone, in the avatar's rest frame (height, and the front of the chest there). */
export const STERNUM_Y = 1.28;
export const STERNUM_Z = 0.095;

/** A segment's rest orientation, for turning it onto a solved direction. */
interface LimbRest { upper: THREE.Quaternion; lower: THREE.Quaternion }

/** Orientation whose x axis is `aim` and y axis is `n` (made square to aim), written into out. */
function frame(aim: THREE.Vector3, n: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  v3.copy(n).addScaledVector(aim, -n.dot(aim)).normalize();
  crossT.crossVectors(aim, v3);
  basis.makeBasis(aim, v3, crossT);
  return out.setFromRotationMatrix(basis);
}

function limbRest(a: number, b: number, c: number, bendFront: number): LimbRest {
  const ra = new THREE.Vector3(...REST[a]);
  const rb = new THREE.Vector3(...REST[b]);
  const rc = new THREE.Vector3(...REST[c]);
  const aim1 = rb.clone().sub(ra).normalize();
  const aim2 = rc.clone().sub(rb).normalize();
  // The bend axis at rest: an elbow folds the forearm forward (+z), a knee the shin back (-z).
  const n = new THREE.Vector3().crossVectors(aim1, new THREE.Vector3(0, 0, bendFront)).normalize();
  const upper = frame(aim1, n, qa.clone()).invert();
  const lower = frame(aim2, n, qb.clone()).invert();
  return { upper, lower };
}

const ARM_REST: [LimbRest, LimbRest] = [limbRest(3, 4, 5, 1), limbRest(6, 7, 8, 1)];
const LEG_REST: [LimbRest, LimbRest] = [limbRest(9, 10, 11, -1), limbRest(12, 13, 14, -1)];

/** Rest joint position (avatar frame), for steps that need body measurements. */
export function restJoint(bone: number): [number, number, number] {
  return REST[bone];
}
