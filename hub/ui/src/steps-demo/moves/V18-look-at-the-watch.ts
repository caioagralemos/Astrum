// V18 look at the watch. Her description: "Lifts the wrist and looks at the
// watch." A wrist watch on the left forearm, face on the back of the wrist.
// The figure lifts the left forearm across the front of the chest, the head
// turns down to it and stays on it a moment, then the arm goes back.
//
// Weightless: the figure floats, arms drifting forward. With gravity:
// standing, arms hanging.

import { FORE, Prop, cycle, gesture } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { CLOSE, floatRoot, standFeet, standRoot } from './V17-kit.ts';

const T = 3.0;

/** The watch, in the forearm's rest frame relative to the elbow: a band round the wrist and a face on its back (-x). */
const AT: [number, number, number] = [-0.047, -0.2, 0];
function watch(world: World): Prop {
  return new Prop(world, (pen) => {
    pen.circle(0, 0.012, 0, 0.041, 'xz', 16).circle(0, -0.012, 0, 0.041, 'xz', 16);
    pen.box(-0.052, -0.022, -0.02, -0.04, 0.022, 0.02);
    pen.circle(-0.053, 0, 0, 0.013, 'yz', 14);
    pen.seg(-0.054, 0, 0, -0.054, 0.009, 0).seg(-0.054, 0, 0, -0.054, -0.002, 0.007);
  }, { strength: 1, width: 2, boxes: [[-0.052, -0.022, -0.02, -0.04, 0.022, 0.02]] });
}

function person(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  // The left wrist: down (or drifting forward), then up across the chest, held, and back.
  const down: [number, number, number] = floating ? [-0.3, 0.08, 0.25] : [-0.24, -0.16, 0.05];
  const up: [number, number, number] = [0.05, 0.34, 0.33];
  const near: [number, number, number] = [0.04, 0.35, 0.34];
  return {
    root: floating ? floatRoot(T) : standRoot(T),
    turn: cycle([[0, [0, 0, 0]], [T / 2, [-0.02, 0, 0]]], T),
    chest: cycle([[0, [0.02, 0, 0], 'still'], [0.85, [0.06, -0.06, 0]], [1.9, [0.07, -0.07, 0], 'still'], [2.6, [0.02, 0, 0], 'still']], T),
    head: cycle([[0, [0, 0, 0], 'still'], [0.55, [0.08, -0.08, 0]], [1.0, [0.42, -0.3, 0.06], 'still'], [1.85, [0.4, -0.28, 0.06], 'still'], [2.35, [0.06, -0.04, 0]], [2.7, [0, 0, 0], 'still']], T),
    hands: [
      cycle([[0, down, 'still'], [0.25, [down[0] - 0.01, down[1] - 0.015, down[2] - 0.01]], [0.85, up], [1.05, near, 'still'], [1.9, up, 'still'], [2.55, down, 'still']], T),
      floating ? cycle([[0, [0.3, 0.1, 0.27]], [T / 2, [0.305, 0.125, 0.29]]], T) : cycle([[0, [0.24, -0.16, 0.05]], [T / 2, [0.242, -0.158, 0.055]]], T),
    ],
    elbows: [
      cycle([[0, floating ? [-0.7, -0.5, -1] : [-0.3, 0, -1], 'still'], [0.85, [-0.9, -0.55, -0.15]], [1.9, [-0.9, -0.55, -0.15], 'still'], [2.55, floating ? [-0.7, -0.5, -1] : [-0.3, 0, -1], 'still']], T),
      cycle([[0, floating ? [0.7, -0.5, -1] : [0.3, 0, -1]]], T),
    ],
    wrists: [cycle([[0, [0, 0, 0], 'still'], [0.9, [0.15, 0, 0]], [1.9, [0.15, 0, 0], 'still'], [2.55, [0, 0, 0], 'still']], T), null],
    overlap: 0.4,
  };
}

function clip(world: World, gravity: Gravity) {
  return gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: person(gravity) }],
    props: (w) => [watch(w)],
    act: (_t, [f]: Figure[], [w]) => {
      if (gravity === 'gravity') standFeet(f);
      w.follow(f, FORE(0), AT);
    },
    camera: { target: CLOSE.target, yaw: -1.0, pitch: 0.14, extent: CLOSE.extent, span: CLOSE.span },
    keys: [0.1, 1.4],
  });
}


export const v18: Move = {
  id: 'V18',
  name: 'V18-look-at-the-watch',
  summary: 'Lifts the wrist and looks at the watch.',
  params: {},
  medical: false,
  reviewed: false,
  questions: [],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
