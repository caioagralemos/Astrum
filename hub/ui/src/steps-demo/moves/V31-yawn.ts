// V31 yawn. Her description: "Yawns with a hand near the ear." One figure.
// The right hand (arm 0, the figure's -x side) comes up beside the right ear,
// palm towards it, a little off it; the figure yawns (a slow deep breath in:
// the chest lifts and opens and the head tips back, held, then out); the hand
// goes back down.
//
// The figures have no face, so the open mouth cannot be drawn: the yawn is
// carried by the breath and the head. That, and which hand and how near, are
// not stated, so kept neutral and asked (questions).

import * as THREE from 'three';
import { HEAD, cycle, gesture, ramp, reach } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { EAR, floatRoot, standFeet, standRoot } from './V17-kit.ts';

const T = 3.4;
type V3 = [number, number, number];
/** The hand comes up, stays by the ear through the yawn, and goes down. */
const UP_A = 0.2, UP_B = 0.8, DOWN_A = 2.55, DOWN_B = 3.15;
/** How far off the ear the palm stays (metres): near, not on it. */
const GAP = 0.05;

function person(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  const rest: V3 = floating ? [-0.3, 0.08, 0.25] : [-0.24, -0.16, 0.05];
  const byEar: V3 = [-0.2, 0.6, 0.04];
  // On the way down the hand goes out to the side, clear of the chest.
  const side: V3 = floating ? [-0.38, 0.28, 0.16] : [-0.36, 0.22, 0.08];
  return {
    root: floating ? floatRoot(T) : standRoot(T),
    turn: cycle([[0, [0, 0, 0]], [T / 2, [-0.01, 0, 0]]], T),
    // The yawn: a slow breath in, the chest lifting and opening, held, then out.
    chest: cycle([[0, [0.02, 0, 0], 'still'], [0.7, [0.02, 0, 0]], [1.5, [-0.12, 0, 0], 'still'], [2.0, [-0.13, 0, 0], 'still'], [2.7, [0.02, 0, 0], 'still']], T),
    head: cycle([[0, [0.03, 0, 0], 'still'], [0.7, [0.02, 0, 0]], [1.5, [-0.44, 0, 0], 'still'], [2.0, [-0.46, 0, 0], 'still'], [2.75, [0.03, 0, 0], 'still']], T),
    hands: [
      cycle([[0, rest, 'still'], [UP_A, rest], [UP_B, byEar, 'still'], [DOWN_A, byEar, 'still'], [(DOWN_A + DOWN_B) / 2, side], [DOWN_B, rest, 'still']], T),
      floating ? cycle([[0, [0.3, 0.1, 0.27]], [T / 2, [0.305, 0.12, 0.29]]], T) : cycle([[0, [0.24, -0.16, 0.05]], [T / 2, [0.242, -0.158, 0.055]]], T),
    ],
    elbows: [
      cycle([[0, floating ? [-0.7, -0.5, -1] : [-0.3, 0, -1], 'still'], [UP_B, [-0.6, -0.45, 0.8], 'still'], [DOWN_A, [-0.6, -0.45, 0.8], 'still'], [DOWN_B, floating ? [-0.7, -0.5, -1] : [-0.3, 0, -1], 'still']], T),
      cycle([[0, floating ? [0.7, -0.5, -1] : [0.3, 0, -1]]], T),
    ],
    overlap: 0.4,
  };
}

const [ex, ey, ez] = EAR(-1);
const near = new THREE.Vector3(), fingers = new THREE.Vector3(), into = new THREE.Vector3();

function clip(gravity: Gravity) {
  return (world: World) => gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: person(gravity) }],
    act: (t, [f]: Figure[]) => {
      if (gravity === 'gravity') standFeet(f);
      // The palm beside the right ear, a few centimetres off it, fingers up the side of the head; it moves with the head.
      f.restPoint(HEAD, ex - GAP, ey + 0.01, ez, near);
      fingers.set(0, 1, 0.15).applyQuaternion(f.q[HEAD]);
      into.set(1, 0, 0).applyQuaternion(f.q[HEAD]);
      const w = ramp(t, UP_A + 0.15, UP_B) * (1 - ramp(t, DOWN_A, DOWN_B - 0.15));
      reach(f, 0, near, fingers, into, w);
    },
    camera: { target: [-0.06, 1.42, 0.05], yaw: -0.8, pitch: 0.1, extent: 1.05, span: 1.05 },
    keys: [0.1, 1.8],
  });
}

export const v31: Move = {
  id: 'V31',
  name: 'V31-yawn',
  summary: 'Yawns with a hand near the ear.',
  params: {},
  medical: false,
  reviewed: false,
  questions: [
    'V31: the figures have no face, so the open mouth is not drawn: the yawn shows as a slow deep breath with the head tipping back, and the right hand stays beside the right ear without touching it. Is that enough, and is the hand right?',
  ],
  variants: {
    weightless: clip('weightless'),
    gravity: clip('gravity'),
  },
};
