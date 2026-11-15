// V25b seizure: protect the head. Her line (V25): "Moves hard objects away and
// protects the other's head with the hands without holding them down; then
// turns them onto their side." The owner split it into one loop per gesture;
// this is the second: protecting the head with the hands.
//
// Drawn here: a person lies on their back on the floor with a very slight
// tremor (not animated in detail, so the loop stays calm). The helper kneels
// at the top of the head, brings both hands in from the thighs, rests the
// palms lightly on the two sides of the head, holds, lifts them off a few
// centimetres and takes them back. The
// rest of the body is not touched and is not held down.
//
// Not in her words, so the most neutral depiction: where exactly the hands
// go (the palms cupped on the sides of the head, not pressing) and nothing
// placed under the head. Asked in `questions`.

import * as THREE from 'three';
import { HEAD, THIGH, cycle, gesture, plant, ramp, reach, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Move } from '../step.ts';

const T = 3.0;
const IN_A = 0.4, IN_B = 1.1, OUT_A = 2.2, OUT_B = 2.85;

const LYING = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));

/** A very slight tremor: a few millimetres, closing on the loop. */
const tremor = (n: number, a: number) => cycle(Array.from({ length: n }, (_, i) => [i * T / n, [0, 0.09 + (i % 2 ? a : -a), (i % 3 - 1) * a * 0.6]] as [number, [number, number, number]]), T);

const person: Moves = {
  orient: LYING,
  root: tremor(18, 0.0025),
  turn: track([[0, [0, 0, 0]]]),
  head: track([[0, [-0.03, 0, 0]]]),
  hands: [track([[0, [-0.27, -0.43, -0.045]]]), track([[0, [0.27, -0.43, -0.045]]])],
  elbows: [track([[0, [-1, 0, -0.3]]]), track([[0, [1, 0, -0.3]]])],
  feet: [track([[0, [-0.1, -0.86, -0.035]]]), track([[0, [0.1, -0.86, -0.035]]])],
  knees: [track([[0, [-0.1, 0, 1]]]), track([[0, [0.1, 0, 1]]])],
  ankles: [track([[0, [0.5, 0, 0]]]), track([[0, [0.5, 0, 0]]])],
};

// The helper kneels upright at the top of the head (-x), close, facing the person (+x): yaw pi/2.
const KX = -0.92, Y0 = 0.42, FACE = Math.PI / 2;
const helper: Moves = {
  root: cycle([[0, [KX, Y0, 0], 'still'], [IN_A, [KX, Y0, 0]], [IN_B, [KX + 0.08, Y0 - 0.15, 0], 'still'], [OUT_A + 0.25, [KX + 0.08, Y0 - 0.15, 0], 'still'], [OUT_B, [KX, Y0, 0], 'still']], T),
  turn: cycle([[0, [FACE, 0, 0], 'still'], [IN_A, [FACE, 0, 0]], [IN_B, [FACE, 0, 0], 'still'], [OUT_A + 0.25, [FACE, 0, 0], 'still'], [OUT_B, [FACE, 0, 0], 'still']], T),
  chest: cycle([[0, [0.05, 0, 0], 'still'], [IN_B, [0.85, 0, 0], 'still'], [OUT_A + 0.25, [0.85, 0, 0], 'still'], [OUT_B, [0.05, 0, 0], 'still']], T),
  head: cycle([[0, [0.35, 0, 0], 'still'], [IN_B, [0.45, 0, 0], 'still'], [OUT_A, [0.45, 0, 0], 'still'], [OUT_B, [0.35, 0, 0], 'still']], T),
  elbows: [track([[0, [-1, -0.3, -0.3]]]), track([[0, [1, -0.3, -0.3]]])],
  overlap: 0.3,
};

const spot = new THREE.Vector3(), toesBack = new THREE.Vector3(-1, 0, 0), floorDown = new THREE.Vector3(0, -1, 0);
const lap = new THREE.Vector3(), fingers = new THREE.Vector3(), into = new THREE.Vector3(), p1 = new THREE.Vector3();

export const v25b: Move = {
  id: 'V25b',
  name: 'V25b-seizure-protect-the-head',
  summary: 'With gravity. The helper kneels at the head of a person lying on the floor and rests both palms on the sides of the head, without holding them down.',
  params: {},
  medical: true,
  reviewed: false,
  questions: [
    'V25b: the animation shows the helper kneeling at the top of the head with both palms resting lightly on the sides of the head, nothing under the head. Is that right, or should the hands go under the head, or something soft be placed under it?',
  ],
  variants: {
    gravity: (world) => gesture(world, {
      duration: T,
      gravity: 'gravity',
      cast: [{ moves: helper, role: 'actor' }, { moves: person, role: 'other' }],
      marks: { contacts: 2 },
      act: (t, [h, p]: Figure[], _props, marks) => {
        for (let l = 0; l < 2; l++) {
          const s = l === 0 ? 1 : -1;
          plant(h, l, spot.set(KX - 0.44, 0, s * 0.12), toesBack, floorDown, 1);
          h.legs[l].pole.set(1, -0.4, 0);
        }
        const w = ramp(t, IN_A, IN_B) * (1 - ramp(t, OUT_A + 0.25, OUT_B));
        const lift = 0.035 * ramp(t, OUT_A, OUT_A + 0.25);
        for (let a = 0; a < 2; a++) {
          const s = a === 0 ? -1 : 1;
          h.restPoint(THIGH(a), s * 0.09, 0.72, 0.075, lap);
          fingers.set(0, -1, 0).applyQuaternion(h.q[THIGH(a)]);
          reach(h, a, lap, fingers, floorDown, 1);
          // The palm on the side of the head, fingers towards the jaw, resting (not pressing).
          // Facing +x, the helper's arm 0 is towards world +z, the person's body -x side.
          const side = a === 0 ? -1 : 1;
          p.restPoint(HEAD, side * 0.108, 1.75, 0.0, p1);
          p1.y += lift;
          fingers.set(0, -1, 0.15).applyQuaternion(p.q[HEAD]);
          into.set(-side, 0, 0).applyQuaternion(p.q[HEAD]);
          reach(h, a, p1, fingers, into, w);
          if (marks) marks.contacts[a].show(p1, 0.04, 0.6 * ramp(t, IN_B - 0.15, IN_B + 0.1) * (1 - ramp(t, OUT_A - 0.1, OUT_A + 0.15)));
        }
      },
      camera: { target: [-0.55, 0.42, 0], yaw: 0.6, pitch: 0.22, extent: 1.15, span: 2.0 },
      keys: [0.2, 1.6],
    }),
  },
};
