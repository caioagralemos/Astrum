// V26 look inside the mouth. Her description: "Opens the mouth of the
// character lying down and looks inside."
//
// The figures have no faces, so the mouth is hidden by design: the camera sits
// behind the helper, whose head and shoulders cover the person's face. The
// viewer sees the helper kneel beside the person's head, lean in over it and
// look, then sit back up. How the mouth is opened is not drawn (asked: see the
// V26 question in QUESTIONS-FOR-MEDICAL-LEAD.md). Which side the helper kneels
// on is not stated: the person's right, as in V27.

import * as THREE from 'three';
import { THIGH, cycle, gesture, plant, reach, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Move } from '../step.ts';

const T = 3.0;
const IN_A = 0.35, IN_B = 1.05, OUT_A = 2.15, OUT_B = 2.85;

const LYING = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));

const person: Moves = {
  orient: LYING,
  root: track([[0, [0, 0.09, 0]]]),
  turn: track([[0, [0, 0, 0]]]),
  head: track([[0, [-0.03, 0, 0]]]),
  hands: [track([[0, [-0.27, -0.43, -0.045]]]), track([[0, [0.27, -0.43, -0.045]]])],
  elbows: [track([[0, [-1, 0, -0.3]]]), track([[0, [1, 0, -0.3]]])],
  feet: [track([[0, [-0.1, -0.86, -0.035]]]), track([[0, [0.1, -0.86, -0.035]]])],
  knees: [track([[0, [-0.1, 0, 1]]]), track([[0, [0.1, 0, 1]]])],
  ankles: [track([[0, [0.5, 0, 0]]]), track([[0, [0.5, 0, 0]]])],
};

// The helper kneels at the person's right (+z), level with the head, facing them (-z).
const KX = -0.72, KZ = 0.56;
const helper: Moves = {
  root: cycle([[0, [KX, 0.5, KZ], 'still'], [IN_A, [KX, 0.5, KZ]], [IN_B, [KX, 0.44, KZ - 0.03], 'still'], [OUT_A, [KX, 0.44, KZ - 0.03], 'still'], [OUT_B, [KX, 0.5, KZ], 'still']], T),
  turn: cycle([[0, [Math.PI, 0.15, 0], 'still'], [IN_A, [Math.PI, 0.15, 0]], [IN_B, [Math.PI, 0.75, 0], 'still'], [OUT_A, [Math.PI, 0.75, 0], 'still'], [OUT_B, [Math.PI, 0.15, 0], 'still']], T),
  chest: cycle([[0, [0.15, 0, 0], 'still'], [IN_B, [0.5, 0, 0], 'still'], [OUT_A, [0.45, 0, 0], 'still'], [OUT_B, [0.15, 0, 0], 'still']], T),
  // Looks down at the face, closer while leaning in.
  head: cycle([[0, [0.45, 0, 0], 'still'], [IN_B, [0.6, 0, 0], 'still'], [1.6, [0.62, 0.06, 0], 'still'], [OUT_A, [0.6, 0, 0], 'still'], [OUT_B, [0.45, 0, 0], 'still']], T),
  elbows: [track([[0, [-1, -0.4, -0.3]]]), track([[0, [1, -0.4, -0.3]]])],
  overlap: 0.3,
};

const spot = new THREE.Vector3(), toesBack = new THREE.Vector3(0, 0, 1), floorDown = new THREE.Vector3(0, -1, 0);
const lap = new THREE.Vector3(), fingers = new THREE.Vector3();

export const v26: Move = {
  id: 'V26',
  name: 'V26-look-inside-the-mouth',
  summary: 'With gravity. The helper kneels beside the head of a person lying on their back, leans in over their face and looks into the mouth. The mouth is hidden by design: the figures have no faces.',
  params: {},
  medical: true,
  reviewed: false,
  questions: [
    'V26: the figures have no face, so an open mouth cannot be seen. How is the mouth opened (for example, the thumb pressing the chin down), and is a hand at the chin with the helper looking in enough? (Not animated until you answer.)',
  ],
  variants: {
    gravity: (world) => gesture(world, {
      duration: T,
      gravity: 'gravity',
      cast: [{ moves: helper, role: 'actor' }, { moves: person, role: 'other' }],
      act: (t, [h]: Figure[]) => {
        void t;
        for (let l = 0; l < 2; l++) {
          const s = l === 0 ? 1 : -1;
          plant(h, l, spot.set(KX + s * 0.12, 0, KZ + 0.48), toesBack, floorDown, 1);
          h.legs[l].pole.set(0, -0.4, -1);
        }
        for (let a = 0; a < 2; a++) {
          const s = a === 0 ? -1 : 1;
          h.restPoint(THIGH(a), s * 0.09, 0.72, 0.075, lap);
          fingers.set(0, -1, 0).applyQuaternion(h.q[THIGH(a)]);
          reach(h, a, lap, fingers, floorDown, 1);
        }
      },
      camera: { target: [-0.6, 0.35, 0.35], yaw: 0.3, pitch: 1.1, extent: 1.3, span: 1.8 },
      keys: [0.2, 1.6],
    }),
  },
};
