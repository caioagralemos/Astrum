// V33 look at the pressure. Illustrates the ground tremor and meteoroid impact
// cards' step: "Check the pressure on the screen. If it drops, follow the
// pressure loss card."
// Gesture named and described by the app's developer for the medical lead's step; awaiting her review.
//
// One person turns to a wall screen (the one prop: a plain panel with a single
// horizontal gauge bar, no text or numbers), looks at it and points to it with
// the near hand, holds a moment, and turns back. Only the looking is shown;
// nothing about what the reading means.
//
// With gravity: standing, feet planted, the hips and chest turn. Weightless:
// floating beside the screen with a slight drift; the head and chest turn
// (the body itself barely turns, as nothing is pushed).

import { Prop, cycle, gesture } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { floatRoot, standFeet, standRoot } from './V17-kit.ts';

const T = 3.2;

/** The screen: a panel on the wall at x = SX, its face towards -x (towards the person). */
const SX = 0.85;
const SY = 1.52;
const SZ = 0.12;
function screen(world: World): Prop {
  return new Prop(world, (pen) => {
    pen.rectYZ(-0.24, -0.34, 0.24, 0.34, 0);
    pen.rectYZ(-0.2, -0.3, 0.2, 0.3, 0);
    // One gauge: a horizontal bar and the level marked on it.
    pen.rectYZ(-0.025, -0.22, 0.025, 0.22, -0.002);
    pen.seg(-0.002, -0.06, -0.08, -0.002, 0.06, -0.08);
  }, { strength: 0.9, width: 1.8, boxes: [[0, -0.24, -0.34, 0.04, 0.24, 0.34]] });
}

function person(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  // Facing a little to the camera's side, then turned to the screen (+x), and back.
  const yaw0 = floating ? 0.3 : 0.35;
  const yaw1 = floating ? 0.55 : 0.95;
  const down: [number, number, number] = floating ? [-0.3, 0.08, 0.25] : [-0.24, -0.16, 0.05];
  const point: [number, number, number] = [-0.02, 0.5, 0.48];
  return {
    root: floating ? floatRoot(T) : standRoot(T),
    turn: cycle([[0, [yaw0, 0, 0], 'still'], [0.45, [yaw0, 0, 0]], [1.05, [yaw1, 0, 0], 'still'], [2.1, [yaw1, 0, 0], 'still'], [2.75, [yaw0, 0, 0], 'still']], T),
    chest: cycle([[0, [0.02, -0.25, 0], 'still'], [0.4, [0.02, -0.2, 0]], [1.0, [0.0, floating ? 0.35 : 0.25, 0], 'still'], [2.1, [0.0, floating ? 0.35 : 0.25, 0], 'still'], [2.75, [0.02, -0.25, 0], 'still']], T),
    // The head leads the turn and lifts a little to the screen.
    head: cycle([[0, [0.04, -0.15, 0], 'still'], [0.3, [0.02, -0.05, 0]], [0.8, [-0.06, floating ? 0.45 : 0.3, 0], 'still'], [2.05, [-0.06, floating ? 0.45 : 0.3, 0], 'still'], [2.6, [0.04, -0.15, 0], 'still']], T),
    hands: [
      // The near hand points to the screen while looking, then comes back.
      cycle([[0, down, 'still'], [0.55, down], [1.15, point, 'still'], [1.95, point, 'still'], [2.6, down, 'still']], T),
      floating ? cycle([[0, [0.3, 0.1, 0.27]], [T / 2, [0.305, 0.125, 0.29]]], T) : cycle([[0, [0.24, -0.16, 0.05]], [T / 2, [0.242, -0.158, 0.055]]], T),
    ],
    elbows: [
      cycle([[0, floating ? [-0.7, -0.5, -1] : [-0.3, 0, -1], 'still'], [1.15, [-0.6, -0.8, 0.0], 'still'], [1.95, [-0.6, -0.8, 0.0], 'still'], [2.6, floating ? [-0.7, -0.5, -1] : [-0.3, 0, -1], 'still']], T),
      cycle([[0, floating ? [0.7, -0.5, -1] : [0.3, 0, -1]]], T),
    ],
    overlap: 0.4,
  };
}

function clip(world: World, gravity: Gravity) {
  return gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: person(gravity) }],
    props: (w) => [screen(w)],
    act: (_t, [f]: Figure[], [s]) => {
      if (gravity === 'gravity') standFeet(f, 0, 0, 0.6);
      s.at(SX, SY, SZ);
    },
    camera: { target: [0.3, gravity === 'gravity' ? 1.05 : 1.15, 0.05], yaw: -0.62, pitch: 0.1, extent: gravity === 'gravity' ? 2.2 : 1.9, span: 2.2 },
    keys: [0.1, 1.5],
  });
}

export const v33: Move = {
  id: 'V33',
  name: 'V33-look-at-the-pressure',
  summary: 'Turns to a wall screen, looks at it and points to it, then turns back.',
  params: {},
  medical: false,
  reviewed: false,
  source: 'Illustrates the ground tremor and meteoroid impact cards\' step "Check the pressure on the screen. If it drops, follow the pressure loss card." Gesture named and described by the app\'s developer for the medical lead\'s step; awaiting her review.',
  questions: [],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
