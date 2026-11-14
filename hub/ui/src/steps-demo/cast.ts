// A character in a step: a rig plus the keyframe tracks that move it. This is
// the authoring format. A step writes, for each person:
//
//   root   [x, y, z]            the centre of mass, in the world (metres)
//   turn   [yaw, pitch, roll]   the body's turn about its centre of mass (radians)
//   chest  [pitch, yaw, roll]   the chest on the hips (pitch > 0 bends forward)
//   head   [pitch, yaw, roll]   the head on the chest (pitch > 0 nods down)
//   hands  [x, y, z] per arm    the wrist, in the body's own frame (origin at the
//                               centre of mass, +z ahead, +y towards the head)
//   feet   [x, y, z] per leg    the ankle, the same way
//   elbows / knees [x, y, z]    which way the joint points, in the body's frame
//   wrists / ankles [pitch, yaw, roll]  the hand or foot on its forearm or shin
//
// Anything not written takes the body's neutral float (knees up, arms
// forward). Contacts (a hand on someone's shoulder, toes under a bar) are laid
// on top by the step itself, in the world, after the tracks: see `reach`.
//
// Weight and its absence come from the tracks, not from code: in orbit a body
// only changes speed between a push and a catch, so glides are written as
// straight ('lin') keys; with gravity the step solves the body from the ground
// up. Secondary motion is added here from the root's acceleration, sampled
// from the same tracks (so it stays a pure function of time and loops cleanly):
// a stopping body's head and free hands carry on a little and settle.

import * as THREE from 'three';
import { Figure, HAND } from './rig.ts';
import type { FigureLook } from './rig.ts';
import { sample } from './anim.ts';
import type { Track } from './anim.ts';

export interface Moves {
  root: Track;
  turn: Track;
  chest?: Track;
  head?: Track;
  hands?: [Track | null, Track | null];
  feet?: [Track | null, Track | null];
  elbows?: [Track | null, Track | null];
  knees?: [Track | null, Track | null];
  wrists?: [Track | null, Track | null];
  ankles?: [Track | null, Track | null];
  /** How much the head and free hands lag the body's changes of speed (0 for none). */
  overlap?: number;
  /** A fixed turn applied before `turn` (lying down, for one). */
  orient?: THREE.Quaternion;
}

export const NEUTRAL = {
  hand: (s: number): [number, number, number] => [s * 0.3, 0.17, 0.3],
  elbow: (s: number): [number, number, number] => [s * 0.7, -0.5, -1],
  foot: (s: number): [number, number, number] => [s * 0.12, -0.72, 0.1],
  knee: (s: number): [number, number, number] => [s * 0.15, 0, 1],
};

const buf = new Float64Array(3);
const acc = new Float64Array(9);
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const local = new THREE.Vector3();
const accel = new THREE.Vector3();
const inverse = new THREE.Quaternion();

export class Character {
  readonly fig: Figure;
  moves: Moves;
  /** The root's acceleration in the body's frame at the last pose (for secondary motion). */
  readonly drag = new THREE.Vector3();

  constructor(look: FigureLook, moves: Moves, width = 2) {
    this.fig = new Figure(look, width);
    this.moves = moves;
  }

  /** Pose the rig from the tracks at time t (contacts are applied after this, then `fig.solve()`). */
  pose(t: number, root?: THREE.Vector3, turn?: THREE.Quaternion) {
    const f = this.fig;
    const m = this.moves;
    sample(m.root, t, buf);
    f.root.set(buf[0], buf[1], buf[2]);
    sample(m.turn, t, buf);
    f.turn.setFromEuler(euler.set(buf[1], buf[0], buf[2]));
    if (m.orient) f.turn.premultiply(m.orient);
    // A move may place the body itself (along a route, say) and leave only the limbs to the tracks.
    if (root) f.root.copy(root);
    if (turn) f.turn.copy(turn);
    // The body's acceleration, from the root track either side of t, in the body's frame.
    const h = 1 / 30;
    sample(m.root, t - h, acc, 0);
    sample(m.root, t, acc, 3);
    sample(m.root, t + h, acc, 6);
    accel.set((acc[0] - 2 * acc[3] + acc[6]) / (h * h), (acc[1] - 2 * acc[4] + acc[7]) / (h * h), (acc[2] - 2 * acc[5] + acc[8]) / (h * h));
    inverse.copy(f.turn).invert();
    this.drag.copy(accel).applyQuaternion(inverse);
    const k = m.overlap ?? 0;
    // A body slowing down (acceleration backwards) tips its head and free hands forward, and the other way.
    const lean = THREE.MathUtils.clamp(-this.drag.z * k * 0.05, -0.25, 0.25);
    const side = THREE.MathUtils.clamp(this.drag.x * k * 0.05, -0.2, 0.2);
    this.euler3(m.chest, t, f.chest, 0, 0);
    this.euler3(m.head, t, f.head, lean, side);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const arm = f.arms[i];
      this.point(m.hands?.[i], t, NEUTRAL.hand(s), local);
      local.z -= this.drag.z * k * 0.012;
      local.y -= this.drag.y * k * 0.012;
      f.body(local.x, local.y, local.z, arm.target);
      this.point(m.elbows?.[i], t, NEUTRAL.elbow(s), local);
      f.bodyDir(local.x, local.y, local.z, arm.pole);
      this.euler3(m.wrists?.[i], t, arm.local, 0, 0);
      arm.weight = 0;
      const leg = f.legs[i];
      this.point(m.feet?.[i], t, NEUTRAL.foot(s), local);
      local.z -= this.drag.z * k * 0.008;
      f.body(local.x, local.y, local.z, leg.target);
      this.point(m.knees?.[i], t, NEUTRAL.knee(s), local);
      f.bodyDir(local.x, local.y, local.z, leg.pole);
      this.euler3(m.ankles?.[i], t, leg.local, 0, 0);
      leg.weight = 0;
    }
  }

  private point(tr: Track | null | undefined, t: number, fallback: [number, number, number], out: THREE.Vector3) {
    if (!tr) out.set(fallback[0], fallback[1], fallback[2]);
    else {
      sample(tr, t, buf);
      out.set(buf[0], buf[1], buf[2]);
    }
  }

  private euler3(tr: Track | null | undefined, t: number, out: THREE.Quaternion, addPitch: number, addRoll: number) {
    if (!tr) buf[0] = buf[1] = buf[2] = 0;
    else sample(tr, t, buf);
    out.setFromEuler(euler.set(buf[0] + addPitch, buf[1], buf[2] + addRoll));
  }
}

// ---- Contacts ----

const fingersRest = new THREE.Vector3();
const palmRest = new THREE.Vector3();
const m1 = new THREE.Matrix4();
const m2 = new THREE.Matrix4();
const x1 = new THREE.Vector3();
const y1 = new THREE.Vector3();
const z1 = new THREE.Vector3();
const want = new THREE.Quaternion();
const restInv = new THREE.Quaternion();
const fingersW = new THREE.Vector3();
const palmW = new THREE.Vector3();

/** Half the hand's thickness (palm to back) and the palm's middle from the wrist, in metres. */
const PALM_OFFSET = 0.042;
const PALM_ALONG = 0.075;

/**
 * Put a hand (arm a) on a point of something, by `weight` (0: where the tracks put it, 1: on it).
 * `fingers` is where the fingers point, `into` the way the palm presses (both world directions).
 * The wrist goes where the palm's middle lands exactly on `contact`.
 */
export function reach(fig: Figure, a: number, contact: THREE.Vector3, fingers: THREE.Vector3, into: THREE.Vector3, weight: number) {
  if (weight <= 0) return;
  const arm = fig.arms[a];
  const s = a === 0 ? -1 : 1;
  fingersW.copy(fingers).normalize();
  palmW.copy(into).addScaledVector(fingersW, -into.dot(fingersW)).normalize();
  // The hand at rest: fingers down (-y), palm towards the body's middle (-side).
  fingersRest.set(0, -1, 0);
  palmRest.set(-s, 0, 0);
  basisOf(fingersRest, palmRest, m1);
  restInv.setFromRotationMatrix(m1).invert();
  basisOf(fingersW, palmW, m2);
  want.setFromRotationMatrix(m2).multiply(restInv);
  // The wrist sits back from the palm's middle along the fingers, and off the surface by the hand's half thickness.
  x1.copy(contact).addScaledVector(fingersW, -PALM_ALONG).addScaledVector(palmW, -PALM_OFFSET);
  const w = Math.min(1, weight);
  arm.target.lerp(x1, w);
  // The hand's own orientation turns over a little earlier than the wrist arrives.
  arm.world.copy(want);
  arm.weight = Math.min(1, w * 1.25);
}

function basisOf(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Matrix4) {
  y1.copy(a);
  z1.copy(b).addScaledVector(y1, -b.dot(y1)).normalize();
  x1.crossVectors(y1, z1);
  out.makeBasis(x1, y1, z1);
}

/** Where a hand's palm middle is now (after solve), for checking contacts. */
export function palmOf(fig: Figure, a: number, out: THREE.Vector3): THREE.Vector3 {
  const s = a === 0 ? -1 : 1;
  return fig.point(HAND(a), 0, -PALM_ALONG, 0, out).add(local.set(-s * PALM_OFFSET, 0, 0).applyQuaternion(fig.q[HAND(a)]));
}

const toesW = new THREE.Vector3();
const soleW = new THREE.Vector3();
const toesRest = new THREE.Vector3(0, 0, 1);
const soleRest = new THREE.Vector3(0, -1, 0);
const footRestInv = new THREE.Quaternion();
const footWant = new THREE.Quaternion();
const m3 = new THREE.Matrix4();
const m4 = new THREE.Matrix4();
/** How high the ankle joint sits above the sole, in metres (the avatar's). */
export const ANKLE_HEIGHT = 0.085;

/**
 * Plant a foot (leg l) by `weight`: its sole flat on a surface whose outward normal is `up`,
 * the ankle over `spot` (a point on the surface), toes towards `toes`.
 */
export function plant(fig: Figure, l: number, spot: THREE.Vector3, toes: THREE.Vector3, up: THREE.Vector3, weight: number) {
  if (weight <= 0) return;
  const leg = fig.legs[l];
  soleW.copy(up).negate().normalize();
  toesW.copy(toes).addScaledVector(soleW, -toes.dot(soleW)).normalize();
  basisOf(toesRest, soleRest, m3);
  footRestInv.setFromRotationMatrix(m3).invert();
  basisOf(toesW, soleW, m4);
  footWant.setFromRotationMatrix(m4).multiply(footRestInv);
  x1.copy(spot).addScaledVector(soleW, -ANKLE_HEIGHT);
  const w = Math.min(1, weight);
  leg.target.lerp(x1, w);
  leg.world.copy(footWant);
  leg.weight = Math.min(1, w * 1.4);
}
