// V01 call everyone (her description: "Raises one arm and waves to call the
// others, then points to the side (defibrillator or restraint)").
//
// One figure. The left arm (arm 1, the figure's +x side) goes up, waves twice
// above the head, then comes down into a straight arm pointing to the figure's
// left, the head following
// it; it holds the point, then the arm comes back down and the loop closes.
// What is pointed at is off screen and not drawn (her line names two possible
// things; see questions).
//
// With gravity: standing, feet planted; the weight goes a little onto the
// right foot as the arm goes up, and the body turns slightly towards the point.
// Weightless: the right hand holds a rail (the only prop) so the body has
// something to react against; the knees float up in the neutral posture and
// the body sways a little against the waving arm, about its centre of mass.

import { Prop, cycle, gesture, plant, reach } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import * as THREE from 'three';
import type { Move } from '../step.ts';

const T = 3.2;

// The calling arm (arm 1, the figure's +x side): up, two waves, point, hold, down.
const callKeys = (rest: [number, number, number], lift: [number, number, number], down: [number, number, number]) => cycle([
  [0, rest, 'still'],
  [0.22, lift],
  [0.55, [0.4, 0.86, 0.1]],
  [0.8, [0.3, 0.93, 0.14]],
  [1.05, [0.6, 0.8, 0.1]],
  [1.3, [0.3, 0.93, 0.14]],
  [1.55, [0.58, 0.81, 0.1]],
  [1.92, [0.745, 0.45, 0.17]],
  [2.08, [0.73, 0.42, 0.2], 'still'],
  [2.55, [0.73, 0.425, 0.2], 'still'],
  [2.95, down],
], T);
const callHand = callKeys([0.21, -0.14, 0.05], [0.25, -0.06, 0.12], [0.25, -0.07, 0.09]);
// Weightless, the arm starts and ends in the neutral float (forward, a little out).
const callFloat = callKeys([0.3, 0.12, 0.28], [0.34, 0.25, 0.3], [0.33, 0.14, 0.3]);
const callElbow = cycle([
  [0, [0.3, 0, -1]],
  [0.3, [0.8, -0.2, -0.6]],
  [0.6, [1, -0.3, 0.2]],
  [1.6, [1, -0.3, 0.2]],
  [2.0, [0, -1, -0.3]],
  [2.6, [0, -1, -0.3]],
  [2.95, [0.3, -0.3, -1]],
], T);
// The hand rocks on the wrist with each wave, a beat behind the forearm.
const callWrist = cycle([
  [0, [0, 0, 0]],
  [0.55, [0, 0, 0.1]],
  [0.85, [0, 0, -0.35]],
  [1.1, [0, 0, 0.35]],
  [1.35, [0, 0, -0.35]],
  [1.62, [0, 0, 0.3]],
  [2.0, [0, 0, 0]],
], T);
// The head: up and forward to call, then round to the right with the point.
const head = cycle([
  [0, [0.04, 0, 0]],
  [0.5, [-0.1, -0.08, 0]],
  [1.5, [-0.08, -0.05, 0]],
  [2.0, [0.02, 0.75, 0]],
  [2.6, [0.02, 0.72, 0], 'still'],
  [3.0, [0.04, 0.05, 0]],
], T);

const standing: Moves = {
  root: cycle([
    [0, [0, 0.965, 0], 'still'],
    [0.25, [0.005, 0.955, 0.005]],
    [0.6, [-0.018, 0.97, 0]],
    [1.6, [-0.02, 0.968, 0]],
    [2.1, [0.005, 0.962, 0.01], 'still'],
    [2.6, [0.005, 0.962, 0.01], 'still'],
  ], T),
  turn: cycle([
    [0, [0, 0, 0], 'still'],
    [0.6, [-0.04, 0.0, 0]],
    [1.6, [-0.03, 0.0, 0]],
    [2.1, [0.2, 0.0, 0], 'still'],
    [2.6, [0.2, 0.0, 0], 'still'],
  ], T),
  chest: cycle([
    [0, [0, 0, 0]],
    [0.6, [-0.05, 0, -0.06]],
    [0.85, [-0.05, 0.03, -0.05]],
    [1.1, [-0.05, -0.03, -0.07]],
    [1.35, [-0.05, 0.03, -0.05]],
    [1.6, [-0.04, -0.02, -0.06]],
    [2.1, [0.02, 0.12, 0.02]],
    [2.6, [0.02, 0.12, 0.02]],
  ], T),
  head,
  hands: [
    cycle([[0, [-0.21, -0.15, 0.04]], [0.7, [-0.22, -0.14, 0.07]], [2.1, [-0.2, -0.13, 0.1]], [2.6, [-0.2, -0.14, 0.08]]], T),
    callHand,
  ],
  elbows: [cycle([[0, [-0.3, 0, -1]]], T), callElbow],
  wrists: [null, callWrist],
  overlap: 0.4,
};

const floating: Moves = {
  root: cycle([[0, [0, 1.0, 0]]], T),
  // Held by one hand, the body answers the arm a little: it rolls away from the wave and turns with the point.
  turn: cycle([
    [0, [0, 0, 0], 'still'],
    [0.6, [-0.03, 0.02, 0.04]],
    [0.85, [-0.04, 0.02, 0.06]],
    [1.1, [-0.02, 0.02, 0.02]],
    [1.35, [-0.04, 0.02, 0.06]],
    [1.6, [-0.02, 0.02, 0.03]],
    [2.1, [0.12, 0.0, 0], 'still'],
    [2.6, [0.12, 0.0, 0], 'still'],
  ], T),
  chest: cycle([[0, [0.02, 0, 0]], [0.6, [-0.04, 0, -0.04]], [1.6, [-0.03, 0, -0.04]], [2.1, [0.02, 0.1, 0.02]], [2.6, [0.02, 0.1, 0.02]]], T),
  head,
  hands: [null, callFloat],
  elbows: [null, callElbow],
  wrists: [null, callWrist],
  overlap: 0.4,
};

// The rail, in the world: upright, to the figure's -x side, level with the waist.
const RAIL_X = -0.5, RAIL_Z = 0.12, RAIL_R = 0.016;

const toes = new THREE.Vector3(0, 0, 1);
const up = new THREE.Vector3(0, 1, 0);
const spot = new THREE.Vector3();
const grip = new THREE.Vector3(RAIL_X + RAIL_R, 1.02, RAIL_Z);
const gripFingers = new THREE.Vector3(0, -0.2, 1);
const gripInto = new THREE.Vector3(-1, 0, 0);

export const v01: Move = {
  id: 'V01',
  name: 'V01-call-everyone',
  summary: 'Raises one arm and waves to call the others, then points to the side.',
  params: {},
  medical: false,
  reviewed: false,
  questions: [
    'V01: should the thing the person points at (the defibrillator or the restraint) be drawn, or is pointing off to the side enough?',
  ],
  variants: {
    weightless: (world) => gesture(world, {
      duration: T,
      gravity: 'weightless',
      cast: [{ moves: floating }],
      props: (w) => [new Prop(w, (pen) => {
        pen.seg(RAIL_X, 0.55, RAIL_Z, RAIL_X, 1.55, RAIL_Z);
        pen.seg(RAIL_X, 0.6, RAIL_Z, RAIL_X - 0.09, 0.6, RAIL_Z);
        pen.seg(RAIL_X, 1.5, RAIL_Z, RAIL_X - 0.09, 1.5, RAIL_Z);
      }, { strength: 0.85, width: 2.6 })],
      act: (_t, [f]: Figure[]) => {
        reach(f, 0, grip, gripFingers, gripInto, 1);
      },
      camera: { target: [0.1, 1.05, 0.05], yaw: 0.3, pitch: 0.08, extent: 2.25, span: 2.25 },
      keys: [0.2, 1.05, 2.3],
    }),
    gravity: (world) => gesture(world, {
      duration: T,
      gravity: 'gravity',
      cast: [{ moves: standing }],
      act: (_t, [f]: Figure[]) => {
        plant(f, 0, spot.set(-0.12, 0, 0.0), toes, up, 1);
        plant(f, 1, spot.set(0.12, 0, 0.02), toes, up, 1);
      },
      camera: { target: [0.12, 1.1, 0.05], yaw: 0.3, pitch: 0.1, extent: 2.3, span: 2.3 },
      keys: [0.2, 1.05, 2.3],
    }),
  },
};
