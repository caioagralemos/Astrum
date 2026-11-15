// V34 watch over someone. Illustrates two event cards' steps:
// ground tremor, "Anyone who hit their head: watch them for 24 hours.";
// meteoroid impact, "Anyone who was near the impact: watch them for 24 hours."
// Gesture named and described by the app's developer for the medical lead's step; awaiting her review.
//
// Two people. One sits calm and upright, resting. The other sits beside them,
// turned towards them, and watches them; once a loop the watcher lifts the
// wrist and looks at the watch (the pose of V18), then looks back at the
// person, to say "over time". The watch is the one prop. Nobody touches
// anyone: no examination, no treatment.
//
// With gravity: the person sits on the floor, legs out ahead, hands on the
// thighs; the watcher kneels beside them (the kneel of V27), one hand on the
// thigh. Weightless: both float upright in the neutral posture, a little apart,
// with a slight drift.

import * as THREE from 'three';
import { FORE, THIGH, Prop, cycle, gesture, plant, ramp, reach, sample1 } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';

const T = 3.4;

/** The watch, as in V18: in the forearm's rest frame relative to the elbow, its face on the back of the wrist (-x). */
const AT: [number, number, number] = [-0.047, -0.2, 0];
function watch(world: World): Prop {
  return new Prop(world, (pen) => {
    pen.circle(0, 0.012, 0, 0.041, 'xz', 16).circle(0, -0.012, 0, 0.041, 'xz', 16);
    pen.box(-0.052, -0.022, -0.02, -0.04, 0.022, 0.02);
    pen.circle(-0.053, 0, 0, 0.013, 'yz', 14);
    pen.seg(-0.054, 0, 0, -0.054, 0.009, 0).seg(-0.054, 0, 0, -0.054, -0.002, 0.007);
  }, { strength: 1, width: 2, boxes: [[-0.052, -0.022, -0.02, -0.04, 0.022, 0.02]] });
}

/** Where each is (x, z) and which way each faces (yaw): the person resting at the left, the watcher at the right turned to them. */
const PX = -0.3, PZ = 0, PYAW = 0.3;
const WX = 0.52, WZ = 0.22, WYAW = -1.27;
/** With gravity: the person sits on the floor, legs out ahead; the watcher kneels, sitting back a little. */
const SIT_Y = 0.15;
const KNEEL_Y = 0.5;

const breath = cycle([[0, 0], [0.85, 0.006], [1.7, 0], [2.55, 0.006]], T);

function resting(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  if (floating) return {
    root: cycle([[0, [PX - 0.1, 1.0, PZ]], [T / 2, [PX - 0.1, 1.004, PZ + 0.006]]], T),
    turn: cycle([[0, [PYAW, 0, 0]]], T),
    chest: cycle([[0, [0.06, 0, 0]], [T / 2, [0.07, 0, 0]]], T),
    head: cycle([[0, [0.08, 0.05, 0]], [T / 2, [0.1, 0.05, 0]]], T),
    hands: [cycle([[0, [-0.26, 0.1, 0.3]], [T / 2, [-0.265, 0.12, 0.31]]], T), cycle([[0, [0.26, 0.1, 0.3]], [T / 2, [0.265, 0.12, 0.31]]], T)],
    elbows: [cycle([[0, [-1, -0.4, -0.6]]], T), cycle([[0, [1, -0.4, -0.6]]], T)],
    overlap: 0.3,
  };
  return {
    root: cycle([[0, [PX, SIT_Y, PZ]]], T),
    turn: cycle([[0, [PYAW, -0.06, 0]]], T),
    chest: cycle([[0, [0.1, 0, 0]], [T / 2, [0.11, 0, 0]]], T),
    head: cycle([[0, [0.06, 0.05, 0]], [T / 2, [0.08, 0.05, 0]]], T),
    hands: [cycle([[0, [-0.14, -0.1, 0.3]]], T), cycle([[0, [0.14, -0.1, 0.3]]], T)],
    elbows: [cycle([[0, [-1, -0.2, -0.6]]], T), cycle([[0, [1, -0.2, -0.6]]], T)],
    // Legs out ahead, knees a little bent, heels on the floor.
    feet: [cycle([[0, [-0.11, -0.08, 0.8]]], T), cycle([[0, [0.11, -0.08, 0.8]]], T)],
    knees: [cycle([[0, [-0.05, 1, 0.2]]], T), cycle([[0, [0.05, 1, 0.2]]], T)],
    overlap: 0.3,
  };
}

function watcher(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  // Looking at the person (to the watcher's -x side), then down at the watch, then back.
  const atPerson: [number, number, number] = floating ? [0.08, -0.45, 0] : [0.35, -0.45, 0];
  const atWatch: [number, number, number] = [0.45, -0.25, 0.05];
  const rest: [number, number, number] = floating ? [-0.28, 0.04, 0.26] : [-0.12, -0.22, 0.2];
  const up: [number, number, number] = [0.05, 0.34, 0.33];
  const near: [number, number, number] = [0.04, 0.35, 0.34];
  return {
    root: cycle([[0, [WX + (floating ? 0.1 : 0), floating ? 1.02 : KNEEL_Y, WZ]], [T / 2, [WX + (floating ? 0.1 : 0), (floating ? 1.02 : KNEEL_Y) + 0.003, WZ]]], T),
    turn: cycle([[0, [WYAW, floating ? 0.04 : 0, 0]]], T),
    chest: cycle([[0, [0.12, -0.2, 0], 'still'], [0.8, [0.13, -0.12, 0]], [1.3, [0.14, -0.08, 0], 'still'], [1.95, [0.14, -0.08, 0], 'still'], [2.55, [0.12, -0.2, 0], 'still']], T),
    head: cycle([[0, atPerson, 'still'], [0.6, atPerson], [1.05, atWatch, 'still'], [1.85, atWatch, 'still'], [2.35, atPerson, 'still']], T),
    hands: [
      cycle([[0, rest, 'still'], [0.45, rest], [0.95, up], [1.1, near, 'still'], [1.9, up, 'still'], [2.5, rest, 'still']], T),
      floating ? cycle([[0, [0.28, 0.04, 0.27]], [T / 2, [0.285, 0.06, 0.29]]], T) : cycle([[0, [0.12, -0.22, 0.2]]], T),
    ],
    elbows: [
      cycle([[0, [-1, -0.4, -0.6], 'still'], [0.95, [-0.9, -0.55, -0.15]], [1.9, [-0.9, -0.55, -0.15], 'still'], [2.55, [-1, -0.4, -0.6], 'still']], T),
      cycle([[0, [1, -0.4, -0.6]]], T),
    ],
    wrists: [cycle([[0, [0, 0, 0], 'still'], [0.95, [0.15, 0, 0]], [1.9, [0.15, 0, 0], 'still'], [2.55, [0, 0, 0], 'still']], T), null],
    overlap: 0.4,
  };
}

const spot = new THREE.Vector3(), toesBack = new THREE.Vector3(), floorDown = new THREE.Vector3(0, -1, 0);
const lap = new THREE.Vector3(), fingers = new THREE.Vector3();

/** Kneeling: knees and the tops of the feet on the floor, shins back (as in V27). */
function kneel(f: Figure, x: number, z: number, yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  toesBack.set(-s, 0, -c);
  for (let l = 0; l < 2; l++) {
    const lx = (l === 0 ? -1 : 1) * 0.12;
    spot.set(x + lx * c - 0.42 * s, 0, z - lx * s - 0.42 * c);
    plant(f, l, spot, toesBack, floorDown, 1);
    // The knees point ahead (a world direction).
    f.legs[l].pole.set(s, -0.4, c);
  }
}

/** A hand resting on its own thigh, palm down, fingers towards the knee. */
function handOnThigh(f: Figure, a: number, weight: number) {
  const s = a === 0 ? -1 : 1;
  f.restPoint(THIGH(a), s * 0.09, 0.72, 0.075, lap);
  fingers.set(0, -1, 0).applyQuaternion(f.q[THIGH(a)]);
  reach(f, a, lap, fingers, floorDown, weight);
}

function clip(world: World, gravity: Gravity) {
  const floating = gravity === 'weightless';
  return gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: watcher(gravity), role: 'actor' }, { moves: resting(gravity), role: 'actor' }],
    props: (w) => [watch(w)],
    act: (t, [w, p]: Figure[], [wt]) => {
      p.root.y += sample1(breath, t);
      if (!floating) {
        kneel(w, WX, WZ, WYAW);
        handOnThigh(p, 0, 1);
        handOnThigh(p, 1, 1);
        handOnThigh(w, 1, 1);
        // The watch hand leaves the thigh for the look at the watch, and comes back.
        handOnThigh(w, 0, 1 - ramp(t, 0.42, 0.75) + ramp(t, 2.15, 2.5));
      }
      wt.follow(w, FORE(0), AT);
    },
    camera: floating
      ? { target: [0.05, 1.0, 0.1], yaw: 0.3, pitch: 0.1, extent: 2.1, span: 2.1 }
      : { target: [0.05, 0.55, 0.3], yaw: 0.3, pitch: 0.2, extent: 1.45, span: 1.9 },
    keys: [0.2, 1.4, 2.8],
  });
}

export const v34: Move = {
  id: 'V34',
  name: 'V34-watch-over-someone',
  summary: 'Sits beside a person who is resting, watches them, looks at the watch, and looks back at them.',
  params: {},
  medical: false,
  reviewed: false,
  source: 'Illustrates the ground tremor card step "Anyone who hit their head: watch them for 24 hours." and the meteoroid impact card step "Anyone who was near the impact: watch them for 24 hours." Gesture named and described by the app\'s developer for the medical lead\'s step; awaiting her review.',
  questions: [],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
