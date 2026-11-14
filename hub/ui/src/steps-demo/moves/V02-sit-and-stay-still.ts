// V02 sit and stay still (her description: "Sits down and stays still, hands on
// the lap"). With gravity: from standing beside a seat, the figure sits down
// (hips back, trunk forward to keep balance over the feet, then down), puts
// both hands on the thighs and stays still, breathing. The loop dissolves into
// the next round. Weightless: not built, waiting on her answer (see questions).
//
// This is also the worked example in AUTHORING.md.

import { THIGH, Prop, cycle, gesture, plant, ramp, reach, sample1, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import * as THREE from 'three';
import type { Move } from '../step.ts';

const T = 3.4;
const SEAT = 0.46;

// Standing at x = 0.25 (in front of the seat), facing +z; then down onto the seat at x = 0.
const person: Moves = {
  root: track([[0, [0, 0.972, 0.18], 'still'], [0.35, [0, 0.95, 0.17], 'still'], [0.85, [0, 0.82, 0.1]], [1.35, [0, 0.6, -0.02]], [1.6, [0, 0.585, -0.03], 'still'], [T, [0, 0.585, -0.03], 'still']]),
  turn: track([[0, [0, 0, 0], 'still'], [0.35, [0, 0.04, 0]], [0.95, [0, 0.42, 0]], [1.4, [0, 0.12, 0]], [1.75, [0, 0.03, 0], 'still'], [T, [0, 0.03, 0], 'still']]),
  chest: track([[0, [0, 0, 0]], [0.9, [0.12, 0, 0]], [1.6, [0.04, 0, 0]], [T, [0.04, 0, 0]]]),
  head: track([[0, [0.05, 0, 0]], [0.9, [-0.25, 0, 0]], [1.6, [0.08, 0, 0]], [T, [0.1, 0, 0]]]),
  hands: [track([[0, [-0.27, -0.42, 0.02]], [0.9, [-0.3, -0.2, 0.28]], [1.45, [-0.12, -0.02, 0.2]]]), track([[0, [0.27, -0.42, 0.02]], [0.9, [0.3, -0.2, 0.28]], [1.45, [0.12, -0.02, 0.2]]])],
  elbows: [track([[0, [-1, 0, -1]]]), track([[0, [1, 0, -1]]])],
  overlap: 0.6,
};

/** Breathing while still: the chest rises a little, twice a loop (closes on itself). */
const breath = cycle([[0, 0], [0.85, 0.012], [1.7, 0], [2.55, 0.012]], T);

const into = new THREE.Vector3(0, -1, 0);
const fingers = new THREE.Vector3();
const lap = new THREE.Vector3();
const toes = new THREE.Vector3(0, 0, 1);
const up = new THREE.Vector3(0, 1, 0);
const spot = new THREE.Vector3();

export const v02: Move = {
  id: 'V02',
  name: 'V02-sit-and-stay-still',
  summary: 'Sits down and stays still, hands on the lap.',
  params: {},
  medical: false,
  reviewed: false,
  questions: ['V02, no gravity: in orbit there is no sitting. Should the person hold still with the feet under a foot bar, or be strapped to a seat?'],
  variants: {
    gravity: (world) => gesture(world, {
      duration: T,
      loop: 'seam',
      gravity: 'gravity',
      cast: [{ moves: person }],
      // A plain stool: four legs and a top, in lines, solid so it hides what is behind it.
      props: (w) => [new Prop(w, (pen) => {
        pen.box(-0.2, SEAT - 0.04, -0.3, 0.2, SEAT, 0.08);
        for (const [x, z] of [[-0.17, -0.27], [0.17, -0.27], [-0.17, 0.05], [0.17, 0.05]]) pen.seg(x, 0, z, x, SEAT - 0.04, z);
      }, { strength: 0.55, boxes: [[-0.2, SEAT - 0.04, -0.3, 0.2, SEAT, 0.08]] })],
      act: (t, [f]: Figure[]) => {
        // Feet stay planted the whole time.
        plant(f, 0, spot.set(-0.11, 0, 0.2), toes, up, 1);
        plant(f, 1, spot.set(0.11, 0, 0.2), toes, up, 1);
        // Once down, both hands on the thighs, palms down, fingers towards the knees.
        const w = ramp(t, 1.45, 1.8);
        for (let a = 0; a < 2; a++) {
          const s = a === 0 ? -1 : 1;
          f.restPoint(THIGH(a), s * 0.09, 0.72, 0.075, lap);
          fingers.set(0, -1, 0).applyQuaternion(f.q[THIGH(a)]);
          reach(f, a, lap, fingers, into, w);
        }
        // Breathing, once still.
        f.root.y += sample1(breath, t) * ramp(t, 1.6, 2.0);
      },
      camera: { target: [0, 0.9, 0.05], yaw: 0.85, pitch: 0.12, extent: 2.2, span: 1.7 },
      keys: [0.2, 1.0, 2.4],
    }),
  },
};
