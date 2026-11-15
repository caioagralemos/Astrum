// V30 stretch. Her description: "Does a light back stretch." One figure.
// Both arms rise slowly, past the front, to above the head; the back
// lengthens a little and the chest opens slightly; held a moment, then the
// arms come back down.
//
// Not stated, so kept neutral and asked (questions): which stretch. She did
// not name one; this is a gentle reach overhead, the plainest stretch that
// reads, with no bending, twisting or lying down. Nothing about how long to
// hold or how many times is drawn.
//
// Weightless: floating, the arms start from the neutral float (forward), the
// knees up. With gravity: standing on the floor, the arms start hanging.

import { cycle, gesture } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { floatRoot, standFeet, standRoot } from './V17-kit.ts';

const T = 3.4;
type V3 = [number, number, number];

function person(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  // Wrists in the body frame: at rest, in front on the way up, overhead.
  const rest = (s: number): V3 => (floating ? [s * 0.3, 0.1, 0.27] : [s * 0.24, -0.17, 0.04]);
  const front = (s: number): V3 => [s * 0.22, 0.4, 0.45];
  const high = (s: number): V3 => [s * 0.22, 0.8, 0.36];
  const top = (s: number): V3 => [s * 0.2, 1.0, 0.04];
  const arm = (s: number) => cycle([[0, rest(s), 'still'], [0.35, rest(s)], [0.8, front(s)], [1.1, high(s)], [1.45, top(s), 'still'], [2.05, top(s), 'still'], [2.4, high(s)], [2.7, front(s)], [3.1, rest(s), 'still']], T);
  const elbow = (s: number) => cycle([[0, floating ? [s * 0.7, -0.5, -1] : [s * 0.3, 0, -1], 'still'], [0.85, [s * 1, -0.6, -0.3]], [1.35, [s * 1, 0, -0.2], 'still'], [2.05, [s * 1, 0, -0.2], 'still'], [2.55, [s * 1, -0.6, -0.3]], [3.05, floating ? [s * 0.7, -0.5, -1] : [s * 0.3, 0, -1], 'still']], T);
  return {
    root: floating ? floatRoot(T) : standRoot(T),
    turn: cycle([[0, [0, 0, 0]], [T / 2, [-0.01, 0, 0]]], T),
    // The back lengthens and the chest opens a little at the top; no bending.
    chest: cycle([[0, [0.02, 0, 0], 'still'], [0.5, [0.02, 0, 0]], [1.4, [-0.07, 0, 0], 'still'], [2.05, [-0.08, 0, 0], 'still'], [2.9, [0.02, 0, 0], 'still']], T),
    head: cycle([[0, [0.02, 0, 0], 'still'], [0.5, [0.02, 0, 0]], [1.45, [-0.08, 0, 0], 'still'], [2.05, [-0.09, 0, 0], 'still'], [2.95, [0.02, 0, 0], 'still']], T),
    hands: [arm(-1), arm(1)],
    elbows: [elbow(-1), elbow(1)],
    wrists: [cycle([[0, [0, 0, 0], 'still'], [1.35, [-0.25, 0, 0], 'still'], [2.05, [-0.25, 0, 0], 'still'], [3.05, [0, 0, 0], 'still']], T), cycle([[0, [0, 0, 0], 'still'], [1.35, [-0.25, 0, 0], 'still'], [2.05, [-0.25, 0, 0], 'still'], [3.05, [0, 0, 0], 'still']], T)],
    overlap: 0.4,
  };
}

function clip(gravity: Gravity) {
  return (world: World) => gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: person(gravity) }],
    act: (_t, [f]: Figure[]) => {
      if (gravity === 'gravity') standFeet(f);
    },
    camera: { target: [0, 1.07, 0.05], yaw: 0.6, pitch: 0.1, extent: 2.3, span: 2.3 },
    keys: [0.1, 1.7],
  });
}

export const v30: Move = {
  id: 'V30',
  name: 'V30-stretch',
  summary: 'Does a light back stretch.',
  params: {},
  medical: true,
  reviewed: false,
  questions: [
    'V30: which stretch do you mean? (The animation shows both arms reaching slowly up above the head, standing or floating, with no bending or twisting.)',
  ],
  variants: {
    weightless: clip('weightless'),
    gravity: clip('gravity'),
  },
};
