// V24 stroke test. Her description: "One smiles, raises both arms and speaks;
// the other watches the face and the arms." Two figures facing each other. The
// first raises both arms straight out in front to shoulder height, holds them
// there, and lowers them; the second watches the first's face, then looks
// along the raised arms from one to the other, then back at the face.
//
// The arm height comes from a named public guideline: the Cincinnati
// Prehospital Stroke Scale (Kothari et al., Ann Emerg Med 1999;33:373-378),
// arm drift: the person "extends both arms straight out" and holds them for 10
// seconds. Here they are held about 1.2 s, so the loop stays about 3 s. Palms
// are left neutral: the guideline wording does not settle it.
//
// Not drawn, and asked (questions): the smile and the speech. The figures have
// no face, so neither can be seen; no mark or sign is invented for them.
//
// Weightless: both float facing each other, a little apart. With gravity: both
// stand on the floor.

import { cycle, gesture } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import { floatRoot, standFeet, standRoot } from './V17-kit.ts';

const T = 3.2;
/** How far apart they stand (metres, along z), the second facing back towards the first. */
const GAP = 1.35;

/** When the arms go up, are held, and come down. */
const UP_A = 0.35, UP_B = 1.0, DOWN_A = 2.25, DOWN_B = 2.9;

function tester(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  const down = (s: number): [number, number, number] => (floating ? [s * 0.26, -0.3, 0.12] : [s * 0.24, -0.43, 0.04]);
  const up = (s: number): [number, number, number] => [s * 0.16, 0.4, 0.57];
  const arm = (s: number) => cycle([[0, down(s), 'still'], [UP_A, down(s), 'still'], [UP_B, up(s), 'still'], [DOWN_A, up(s), 'still'], [DOWN_B, down(s), 'still']], T);
  const elbow = (s: number) => cycle([[0, [s * 0.4, 0, -1], 'still'], [UP_A, [s * 0.4, 0, -1], 'still'], [UP_B, [s * 0.5, -1, 0], 'still'], [DOWN_A, [s * 0.5, -1, 0], 'still'], [DOWN_B, [s * 0.4, 0, -1], 'still']], T);
  return {
    root: floating ? floatRoot(T) : standRoot(T),
    turn: cycle([[0, [0, 0, 0]], [T / 2, [0, 0.01, 0]]], T),
    chest: cycle([[0, [0, 0, 0], 'still'], [UP_A, [0, 0, 0], 'still'], [UP_B, [-0.04, 0, 0], 'still'], [DOWN_A, [-0.04, 0, 0], 'still'], [DOWN_B, [0, 0, 0], 'still']], T),
    head: cycle([[0, [0.02, 0, 0]], [T / 2, [0.03, 0, 0]]], T),
    hands: [arm(-1), arm(1)],
    elbows: [elbow(-1), elbow(1)],
    overlap: 0.5,
  };
}

function watcher(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  return {
    root: floating ? floatRoot(T, 0, GAP) : standRoot(T, 0, GAP),
    turn: cycle([[0, [Math.PI, 0, 0]], [T / 2, [Math.PI, 0.01, 0]]], T),
    chest: cycle([[0, [0.03, 0, 0]], [T / 2, [0.04, 0, 0]]], T),
    // At the face; down to the arms as they rise, along from one to the other; back up to the face.
    head: cycle([
      [0, [-0.04, 0, 0], 'still'], [0.7, [-0.04, 0, 0], 'still'], [1.1, [0.24, -0.2, 0], 'still'],
      [1.55, [0.24, 0.2, 0], 'still'], [2.0, [0.24, -0.05, 0], 'still'], [2.45, [-0.04, 0, 0], 'still'],
    ], T),
    hands: floating ? undefined : [cycle([[0, [-0.23, -0.43, 0.03]]], T), cycle([[0, [0.23, -0.43, 0.03]]], T)],
    elbows: floating ? undefined : [cycle([[0, [-0.3, 0, -1]]], T), cycle([[0, [0.3, 0, -1]]], T)],
    overlap: 0.5,
  };
}

/** From the first person's left side, a little in front: both bodies side by side, the raised arms across the view. */
const CAMERA = { target: [0, 0.98, GAP / 2] as [number, number, number], yaw: 1.05, pitch: 0.38, extent: 2.25, span: 2.25 };

export const v24: Move = {
  id: 'V24',
  name: 'V24-stroke-test',
  summary: 'One raises both arms; the other watches the face and the arms.',
  params: {},
  medical: true,
  reviewed: false,
  source: 'Cincinnati Prehospital Stroke Scale (Kothari et al., Ann Emerg Med 1999;33:373-378), arm drift: "extends both arms straight out". Arm height only.',
  questions: [
    'V24: the figures have no face, so the smile and the speech cannot be seen. Is it enough to show both arms raised and the other person looking at the face, then at the arms?',
  ],
  variants: {
    weightless: (world) => gesture(world, {
      duration: T,
      gravity: 'weightless',
      cast: [{ moves: tester('weightless') }, { moves: watcher('weightless') }],
      camera: CAMERA,
      keys: [0.2, 1.6, 2.6],
    }),
    gravity: (world) => gesture(world, {
      duration: T,
      gravity: 'gravity',
      cast: [{ moves: tester('gravity') }, { moves: watcher('gravity') }],
      act: (_t, [a, b]: Figure[]) => {
        standFeet(a);
        standFeet(b, 0, GAP, Math.PI);
      },
      camera: CAMERA,
      keys: [0.2, 1.6, 2.6],
    }),
  },
};
