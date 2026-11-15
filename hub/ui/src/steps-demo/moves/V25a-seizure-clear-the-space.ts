// V25a seizure: clear the space. Her line (V25): "Moves hard objects away and
// protects the other's head with the hands without holding them down; then
// turns them onto their side." The owner split it into one loop per gesture;
// this is the first: moving a hard object away.
//
// Drawn here: a person lies on their back on the floor with a very slight
// tremor (the seizure is not animated in detail, so the loop stays calm). The
// helper kneels at the top of the person's head, reaches to a hard box on the
// floor beside the head, slides it away along the floor (a small arrow shows
// the direction), and the hand comes back to the thigh. The person is not
// touched. The box fades out where it was pushed to and fades back in at its
// start, so the loop returns to its start pose.
//
// Not in her words: what the object is (a plain box), where it is (beside the
// head), and where the helper kneels (beside the head, on the person's left).

import * as THREE from 'three';
import { Prop, THIGH, cycle, gesture, plant, ramp, reach, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Move } from '../step.ts';

const T = 3.0;
const REACH_A = 0.35, REACH_B = 0.95, PUSH_B = 1.75, BACK_B = 2.4;

// On the back along x, head towards -x, face up (as V27).
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

// The helper kneels upright on the person's left (-z), level with the head and shoulder, facing them (+z).
// Their right arm (arm 0) is towards -x, the box's side.
const KX = -0.8, KZ = -0.52, Y0 = 0.46;
const helper: Moves = {
  root: cycle([[0, [KX, Y0, KZ], 'still'], [REACH_A, [KX, Y0, KZ]], [REACH_B, [KX - 0.05, Y0 - 0.15, KZ + 0.1]], [PUSH_B, [KX - 0.08, Y0 - 0.15, KZ + 0.1]], [BACK_B, [KX, Y0, KZ], 'still']], T),
  turn: cycle([[0, [0, 0.08, 0], 'still'], [REACH_A, [0, 0.08, 0]], [REACH_B, [-0.3, 0.32, 0]], [PUSH_B, [-0.4, 0.32, 0]], [BACK_B, [0, 0.08, 0], 'still']], T),
  chest: cycle([[0, [0.05, 0, 0], 'still'], [REACH_B, [0.12, -0.1, 0]], [PUSH_B, [0.12, -0.15, 0]], [BACK_B, [0.05, 0, 0], 'still']], T),
  head: cycle([[0, [0.4, 0, 0], 'still'], [REACH_B, [0.4, -0.2, 0]], [PUSH_B, [0.4, -0.3, 0]], [BACK_B, [0.4, 0, 0], 'still']], T),
  elbows: [track([[0, [-1, -0.4, -0.3]]]), track([[0, [1, -0.4, -0.3]]])],
  overlap: 0.3,
};

/** The box: a hard object on the floor beside the head, on the helper's side; slid out along -x, away from the head. */
const BW = 0.16, BH = 0.24, BD = 0.16;
const BOX_Z = -0.36, BOX_X0 = -0.9, BOX_X1 = -1.1;

const spot = new THREE.Vector3(), toesBack = new THREE.Vector3(0, 0, -1), floorDown = new THREE.Vector3(0, -1, 0);
const lap = new THREE.Vector3(), fingers = new THREE.Vector3(), into = new THREE.Vector3(), p1 = new THREE.Vector3();
const from = new THREE.Vector3(), to = new THREE.Vector3();

export const v25a: Move = {
  id: 'V25a',
  name: 'V25a-seizure-clear-the-space',
  summary: 'With gravity. Beside a person lying on the floor, the helper slides a hard object away from their head, without touching the person.',
  params: {},
  medical: true,
  reviewed: false,
  questions: [],
  variants: {
    gravity: (world) => gesture(world, {
      duration: T,
      gravity: 'gravity',
      cast: [{ moves: helper, role: 'actor' }, { moves: person, role: 'other' }],
      props: (w) => [new Prop(w, (pen) => {
        pen.box(-BW / 2, 0, -BD / 2, BW / 2, BH, BD / 2);
      }, { strength: 0.75, boxes: [[-BW / 2, 0, -BD / 2, BW / 2, BH, BD / 2]] })],
      marks: { arrows: 1 },
      act: (t, [h]: Figure[], [box], marks) => {
        // Kneeling: knees and the tops of the feet on the floor, shins back (towards -z).
        for (let l = 0; l < 2; l++) {
          const s = l === 0 ? 1 : -1;
          plant(h, l, spot.set(KX + s * 0.12, 0, KZ - 0.44), toesBack, floorDown, 1);
          h.legs[l].pole.set(0, -0.4, 1);
        }
        // Hands rest on the thighs.
        for (let a = 0; a < 2; a++) {
          const s = a === 0 ? -1 : 1;
          h.restPoint(THIGH(a), s * 0.09, 0.72, 0.075, lap);
          fingers.set(0, -1, 0).applyQuaternion(h.q[THIGH(a)]);
          reach(h, a, lap, fingers, floorDown, 1);
        }
        // The box slides out while the hand pushes it, then fades and comes back at its start.
        const k = ramp(t, REACH_B, PUSH_B);
        const fadeBack = t > BACK_B;
        const x = fadeBack ? BOX_X0 + (BOX_X1 - BOX_X0) * (1 - ramp(t, 2.6, 2.61)) : BOX_X0 + (BOX_X1 - BOX_X0) * k;
        box.at(x, 0, BOX_Z);
        box.shown = t < 2.0 ? 1 : t < 2.6 ? 1 - ramp(t, 2.0, 2.55) : ramp(t, 2.62, T - 0.02);
        // The right hand (arm 0, towards -x): flat on the head side of the box, pushing it out (-x).
        const w = ramp(t, REACH_A, REACH_B) * (1 - ramp(t, PUSH_B, BACK_B));
        p1.set(x + BW / 2, BH * 0.8, BOX_Z);
        fingers.set(0, -0.3, 1).normalize();
        into.set(-1, 0, 0);
        reach(h, 0, p1, fingers, into, w);
        if (marks) {
          from.set(BOX_X0 - 0.02, BH + 0.08, BOX_Z);
          to.set(BOX_X1 - 0.06, BH + 0.08, BOX_Z);
          marks.arrows[0].show(from, to, 0.045, 0.85 * ramp(t, REACH_B - 0.1, REACH_B + 0.15) * (1 - ramp(t, PUSH_B, PUSH_B + 0.3)));
        }
      },
      camera: { target: [-0.65, 0.42, -0.15], yaw: 0.35, pitch: 0.22, extent: 1.15, span: 2.0 },
      keys: [0.2, 1.3, 1.8],
    }),
  },
};
