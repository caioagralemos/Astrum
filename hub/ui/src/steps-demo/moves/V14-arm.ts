// Shared by V14, V16 and V29: a "sore spot" on the left forearm, held still in
// front of the body, with the right hand working on it. The medical lead did
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
  // Make `across` point to the body's -x (the figure's left), whichever way the cross product came out.
  f.bodyDir(-1, 0, 0, e);
  if (out.across.dot(e) < 0) out.across.negate();
  out.at.addScaledVector(out.up, RADIUS);
  return out;
}

/**
 * The figure: the left forearm held still in front of the body, the right arm free for the move
 * to drive (its hand is placed by `reach` in `act`, so the track here is only where it starts from).
 * The head looks down at the spot.
 */
export function armMoves(gravity: Gravity, T: number, right: { hand: Track; elbow?: Track }, head?: Track): Moves {
  const floating = gravity === 'weightless';
  return {
    root: floating ? floatRoot(T) : standRoot(T),
    turn: cycle([[0, [0.05, 0.02, 0]], [T / 2, [0.06, 0.025, 0]]], T),
    chest: cycle([[0, [0.12, 0.05, 0]], [T / 2, [0.13, 0.05, 0]]], T),
    head: head ?? cycle([[0, [0.42, -0.05, 0]], [T / 2, [0.45, -0.04, 0]]], T),
    hands: [cycle([[0, [-0.02, 0.17, 0.36]], [T / 2, [-0.02, 0.172, 0.362]]], T), right.hand],
    elbows: [cycle([[0, [-1, -0.7, -0.2]]], T), right.elbow ?? cycle([[0, [1, -0.6, -0.4]]], T)],
    wrists: [cycle([[0, [0, 0, 0]]], T), null],
    overlap: 0.3,
  };
}

/** The camera for these: from the front and the right, above, close on the forearm and the head. */
export const ARM_CAMERA = { target: [0.02, 1.32, 0.2] as [number, number, number], yaw: 0.55, pitch: 0.38, extent: 0.82, span: 0.82 };
