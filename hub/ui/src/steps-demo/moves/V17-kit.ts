// Shared pieces for the one-person moves V14 to V31 (a figure and one small
// prop, mostly hand-to-face gestures): points on the head, a basis helper for
// props held in a hand, feet planted on the floor, and the two framings
// (the upper body close up, and the whole figure).
//
// Not a move: it exports no `Move`, so the library ignores it.

import * as THREE from 'three';
import { cycle, plant } from '../gesture.ts';
import type { Figure } from '../gesture.ts';
import type { Track } from '../anim.ts';

type V3 = [number, number, number];

/** Points on the head, in avatar rest coordinates (feet at 0, facing +z). The head has no face drawn: these are where a face would be. */
export const MOUTH: V3 = [0, 1.638, 0.088];
export const NOSE: V3 = [0, 1.66, 0.09];
export const EYES: V3 = [0, 1.7, 0.086];
/** The ear on side s (-1: the figure's -x side, arm 0; +1: arm 1). */
export const EAR = (s: number): V3 => [s * 0.112, 1.66, 0];

/** A turn whose local +y goes to `y` and local +z to `z` (z is squared to y first). */
export function basis(out: THREE.Quaternion, y: THREE.Vector3, z: THREE.Vector3): THREE.Quaternion {
  by.copy(y).normalize();
  bz.copy(z).addScaledVector(by, -bz.copy(z).dot(by)).normalize();
  bx.crossVectors(by, bz);
  bm.makeBasis(bx, by, bz);
  return out.setFromRotationMatrix(bm);
}
const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3();
const bm = new THREE.Matrix4();

const toes = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0), spot = new THREE.Vector3();
/** With gravity: both feet flat on the floor (y = 0), a little apart, toes ahead (+z, turned by `yaw`). */
export function standFeet(f: Figure, x = 0, z = 0, yaw = 0) {
  toes.set(Math.sin(yaw), 0, Math.cos(yaw));
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let l = 0; l < 2; l++) {
    const lx = (l === 0 ? -1 : 1) * 0.11;
    spot.set(x + lx * c, 0, z - lx * s);
    plant(f, l, spot, toes, up, 1);
  }
}

/** Standing with gravity: the root over the feet, with a slow, small sway and breath over loop T (seamless). */
export function standRoot(T: number, x = 0, z = 0): Track {
  return cycle([[0, [x, 0.975, z]], [T * 0.25, [x + 0.006, 0.979, z + 0.004]], [T * 0.5, [x, 0.975, z + 0.006]], [T * 0.75, [x - 0.006, 0.978, z + 0.002]]], T);
}

/** Floating: the same height (no floor), a very slow bob over loop T. The scene's own drift is added by the gesture. */
export function floatRoot(T: number, x = 0, z = 0): Track {
  return cycle([[0, [x, 0.98, z]], [T * 0.5, [x, 0.986, z + 0.006]]], T);
}

/** The two framings. Close: the upper body, from the hips to above the head, for hand-and-face gestures. */
export const CLOSE = { target: [0.02, 1.43, 0.1] as V3, extent: 0.95, span: 0.95 };
export const WHOLE = { target: [0, 0.92, 0.05] as V3, extent: 2.05, span: 2.05 };
