// Shared by V14 and V08 (and later V16, V29): a "sore spot" on the right forearm
// (arm 0, the figure's -x side), held still out in front of the body, bent at
// the elbow, with the left hand (arm 1) working on it. The medical lead did
// not say which part of the body; the forearm is a neutral placeholder until
// she does (see each move's questions).
//
// Not a move: it exports no `Move`, so the library ignores it.

import * as THREE from 'three';
import { FORE, cycle } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Track } from '../anim.ts';
import type { Gravity } from '../step.ts';
import { floatRoot, standRoot } from './V17-kit.ts';

/** Where the sore spot is on the forearm, in rest coordinates: along it (height), and the forearm's half thickness there. */
const SPOT_Y = 0.95;
const RADIUS = 0.041;

/** The spot on the forearm's upper surface, and its frame: `up` out of the skin, `along` towards the wrist, `across` towards the body's -x. */
export interface Spot { at: THREE.Vector3; up: THREE.Vector3; along: THREE.Vector3; across: THREE.Vector3 }
export const spot = (): Spot => ({ at: new THREE.Vector3(), up: new THREE.Vector3(), along: new THREE.Vector3(), across: new THREE.Vector3() });

const e = new THREE.Vector3(), w = new THREE.Vector3();
/** Where the spot is now (after the tracks are posed and solved). `side` moves it round the arm (radians), `shift` along it (metres). */
export function forearmSpot(f: Figure, out: Spot, shift = 0): Spot {
  f.restPoint(FORE(0), -0.257, 1.07, 0, e);
  f.restPoint(FORE(0), -0.308, 0.82, 0, w);
  out.along.subVectors(w, e).normalize();
  const k = (1.07 - SPOT_Y) / 0.25;
  out.at.copy(e).lerp(w, k).addScaledVector(out.along, shift);
  f.bodyDir(0, 1, 0, out.up);
  out.up.addScaledVector(out.along, -out.up.dot(out.along)).normalize();
  out.across.crossVectors(out.up, out.along).normalize();
  // Make `across` point to the body's -x (the figure's right), whichever way the cross product came out.
  f.bodyDir(-1, 0, 0, e);
  if (out.across.dot(e) < 0) out.across.negate();
  out.at.addScaledVector(out.up, RADIUS);
  return out;
}

/**
 * The figure: the right forearm held still out in front of the body, the left arm free for the move
 * to drive (its hand is placed by `reach` in `act`, so the track here is only where it starts from).
 * The head looks down at the spot.
 */
export function armMoves(gravity: Gravity, T: number, right: { hand: Track; elbow?: Track }, head?: Track): Moves {
  const floating = gravity === 'weightless';
  return {
    root: floating ? floatRoot(T) : standRoot(T),
    turn: cycle([[0, [0.04, 0.03, 0]], [T / 2, [0.045, 0.03, 0]]], T),
    chest: cycle([[0, [0.1, 0.06, 0]], [T / 2, [0.11, 0.06, 0]]], T),
    head: head ?? cycle([[0, [0.45, -0.12, 0]], [T / 2, [0.47, -0.12, 0]]], T),
    hands: [cycle([[0, [-0.07, 0.11, 0.43]], [T / 2, [-0.07, 0.112, 0.432]]], T), right.hand],
    elbows: [cycle([[0, [-0.7, -1, -0.2]]], T), right.elbow ?? cycle([[0, [1, -0.5, -0.3]]], T)],
    wrists: [cycle([[0, [0, 0, 0]]], T), null],
    overlap: 0.3,
  };
}

/** The camera for these: from the figure's right side, a little above, the forearm sticking out towards the viewer's right. */
export const ARM_CAMERA = { target: [-0.06, 1.33, 0.27] as [number, number, number], yaw: -1.3, pitch: 0.3, extent: 0.92, span: 0.92 };
