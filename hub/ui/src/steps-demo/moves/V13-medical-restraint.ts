// V13 medical restraint. Her description: "NO gravity. The character lies on
// their back, strapped to a stretcher; the rescuer puts their feet on the
// opposite wall and presses the chest with both hands."
//
// This is the handstand method of the cited guideline (DGLRM / ESAM-SMG 2020,
// see `source`): "The patient is placed with their back on a solid surface of
// the spacecraft. The rescuer then places their feet on an adequate surface on
// the opposite wall, arms stretched out above the head. With both hands placed
// in the correct position on the patient's sternum, the rescuer flexes and
// extends their hips and knees to generate the force for compressing the
// patient's chest."
//
// Her answers (videos-answers.md, 14 Nov), all marked there as HER CHOICE, not
// in the guideline text and not sourced:
//   20  the patient's arms are strapped down, close to the body;
//   21  the rescuer's knees are bent, and the force comes from the legs;
//   22  feet on the opposite wall; the push goes into the patient's back, against the stretcher;
//   26  feet on the opposite wall, knees bent, arms straight to the patient's chest, both
//       hands on the breastbone, the push from the hips and legs.
// Rate and depth are her V09 answers (12: 120 a minute; 11 and her card: 5 to 6 cm),
// applied here because her V12 answer 25 asks the same of the other weightless method;
// that is asked of her for V13 (`questions`).
//
// Drawn here: the stretcher on one wall, the opposite wall above; the rescuer
// upside down between them, feet planted on the opposite wall, knees bent,
// arms straight from the shoulders to the chest, hands stacked on the
// breastbone; each press comes from the hips and knees opening (the feet never
// move), and the chest goes in under the hands. The patient's arms lie close
// to the body under a strap across the wrists and hips; two more straps hold
// the legs. The rescuer's head is tipped back, out from between the arms.

import * as THREE from 'three';
import { Prop, STERNUM_Y, STERNUM_Z, COM_HEIGHT, gesture, plant, reach, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Move } from '../step.ts';

/** Two presses a second (her V09 answer 12, until she says otherwise for V13): 6 in the 3 s loop. */
const RATE = 120;
const COUNT = 6;
const T = (COUNT * 60) / RATE;
const PERIOD = 60 / RATE;
/** How far the chest goes in: 5.5 cm, as V09 (her card's 5 to 6 cm), until she says otherwise for V13. */
const DEPTH = 0.055;
const press = (u: number) => 0.5 - 0.5 * Math.cos(((((u / PERIOD) % 1) + 1) % 1) * Math.PI * 2);

/** The stretcher's top, the patient's back on it, and the opposite wall. */
const BOARD = 0.06;
const BACK = 0.095;
const STERNUM = new THREE.Vector3(0, BOARD + BACK + STERNUM_Z, 0);
/** The rescuer's arm from shoulder to wrist, kept just short of locked. */
const ARM = (0.333 + 0.255) * 0.96;
const ACROSS = 0.185;
/** Leg reach from hip joint to ankle at the top of a press: knees clearly bent (her answer 21). */
const LEG_TOP = 0.6;
const SHOULDER_TOP = STERNUM.y + 0.042 + Math.sqrt(ARM * ARM - ACROSS * ACROSS);
const ROOT_TOP = SHOULDER_TOP + (1.395 - COM_HEIGHT);
const HIP_TOP = ROOT_TOP - (0.93 - COM_HEIGHT);
/** The opposite wall, where the soles are. */
const WALL = HIP_TOP + LEG_TOP + 0.085;

// Lying on the back along x, head towards -x, face up (+y).
const LYING = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
// Upside down between the walls, facing +x (so the knees bend across the view).
const HANDSTAND = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0)));

const patient: Moves = {
  root: track([[0, [STERNUM_Y - COM_HEIGHT, BOARD + BACK, 0]]]),
  turn: track([[0, [0, 0, 0]]]),
  orient: LYING,
  head: track([[0, [-0.1, 0, 0]]]),
  // Arms strapped down close to the body (her answer 20): wrists beside the hips, under the strap.
  hands: [track([[0, [-0.215, -0.2, -0.03]]]), track([[0, [0.215, -0.2, -0.03]]])],
  elbows: [track([[0, [-1, 0, -0.6]]]), track([[0, [1, 0, -0.6]]])],
  feet: [track([[0, [-0.1, -0.87, -0.02]]]), track([[0, [0.1, -0.87, -0.02]]])],
  ankles: [track([[0, [-0.5, 0, 0]]]), track([[0, [-0.5, 0, 0]]])],
};

const rescuer: Moves = {
  root: track([[0, [0, ROOT_TOP, 0]]]),
  turn: track([[0, [0, 0, 0]]]),
  orient: HANDSTAND,
  chest: track([[0, [0, 0, 0]]]),
  // Head tipped back, out from between the straight arms, towards the patient's chest.
  head: track([[0, [-0.55, 0, 0]]]),
  // Elbows (straight) point out to the sides; knees bend towards +x.
  elbows: [track([[0, [-1, 0, 0]]]), track([[0, [1, 0, 0]]])],
  knees: [track([[0, [0, 0, 1]]]), track([[0, [0, 0, 1]]])],
};

const contact = new THREE.Vector3();
const point = new THREE.Vector3();
const across = new THREE.Vector3(0, 0, -1);
const acrossTop = new THREE.Vector3(0.35, 0, -1).normalize();
const down = new THREE.Vector3(0, -1, 0);
const wallNormal = new THREE.Vector3(0, -1, 0);
const toes = new THREE.Vector3(1, 0, 0);
const spot = new THREE.Vector3();

export const v13: Move = {
  id: 'V13',
  name: 'V13-medical-restraint',
  summary: 'No gravity. Lying on the back, strapped to a stretcher; the rescuer puts their feet on the opposite wall and presses the chest with both hands.',
  params: {},
  medical: true,
  reviewed: false,
  source: 'Body position: the handstand (HS) method, Hinkelbein J, et al. Cardiopulmonary resuscitation (CPR) during spaceflight – a guideline for CPR in microgravity from the German Society of Aerospace Medicine (DGLRM) and the European Society of Aerospace Medicine Space Medicine Group (ESAM-SMG). Scand J Trauma Resusc Emerg Med 2020;28:108, doi:10.1186/s13049-020-00793-y. Arms strapped down, knees bent, push from the hips and legs into the stretcher, arms straight to the chest: the medical lead’s answers 20, 21, 22 and 26 (14 Nov 2026), HER CHOICE, not in the guideline text and not sourced. Rate 120 a minute and depth 5.5 cm: her V09 answers and card, applied here until she confirms.',
  questions: [
    'V13: should the presses be the same as V09, 2 a second and 5 to 6 cm deep? (The animation uses that.)',
    'V13: does the rescuer face the patient’s feet or head? (The animation shows the rescuer facing the patient’s feet.)',
    'V13: where else do straps go besides the arms? (The animation shows one strap across the wrists and hips, and two across the legs, none on the chest.)',
    'V13: the rescuer is upside down between the walls, so the straight arms go from the shoulders, past the head, to the chest (the guideline’s "arms stretched out above the head"). Is that what you mean by "not above the head"?',
  ],
  variants: {
    weightless: (world) => gesture(world, {
      duration: T,
      gravity: 'weightless',
      cast: [{ moves: rescuer, role: 'actor' }, { moves: patient, role: 'other' }],
      props: (w) => [
        // The stretcher: a board with two straps over the legs, and the wall it is fixed to.
        new Prop(w, (pen) => {
          pen.box(-1.15, 0, -0.32, 1.0, BOARD, 0.32);
          pen.seg(-1.5, -0.06, -0.5, 1.4, -0.06, -0.5).seg(-1.5, -0.06, 0.5, 1.4, -0.06, 0.5);
          for (const x of [0.62, 1.06]) pen.path([[x, BOARD, -0.33], [x, 0.22, -0.2], [x, 0.24, 0], [x, 0.22, 0.2], [x, BOARD, 0.33]]);
          // Across the wrists and hips: the arms strapped down (her answer 20).
          for (const x of [0.47, 0.53]) pen.path([[x, BOARD, -0.33], [x, 0.21, -0.3], [x, 0.25, -0.2], [x, 0.26, 0], [x, 0.25, 0.2], [x, 0.21, 0.3], [x, BOARD, 0.33]]);
        }, { strength: 0.6, boxes: [[-1.15, 0, -0.32, 1.0, BOARD, 0.32]] }),
        // The opposite wall: a panel the feet press on.
        new Prop(w, (pen) => {
          pen.rectXZ(-0.9, -0.5, 0.9, 0.5, 0);
          pen.seg(-0.9, 0.04, -0.5, 0.9, 0.04, -0.5);
        }, { strength: 0.45 }),
      ],
      marks: { contacts: 2 },
      act: (t, [r, p]: Figure[], props, marks) => {
        const c = press(t);
        const d = DEPTH * c;
        p.press = d;
        // The whole body goes down with the hands: the hips and knees open, the feet stay on the wall.
        r.root.y = ROOT_TOP - d;
        contact.copy(STERNUM);
        contact.y -= d;
        reach(r, 0, point.copy(contact).addScaledVector(across, 0.03), across, down, 1);
        reach(r, 1, point.copy(contact).addScaledVector(across, 0.035).setY(contact.y + 0.088), acrossTop, down, 1);
        for (let l = 0; l < 2; l++) {
          const s = l === 0 ? 1 : -1;
          plant(r, l, spot.set(0.04, WALL, s * 0.11), toes, wallNormal, 1);
        }
        props[1].at(0, WALL, 0);
        if (marks) {
          marks.contacts[0].show(contact, 0.075, 0.9, c);
          marks.contacts[1].show(spot.set(0.1, WALL, 0), 0.09, 0.35, 0);
        }
      },
      camera: { target: [0.1, WALL / 2, 0], yaw: 0.85, pitch: 0.14, extent: WALL + 0.6, span: 2.2 },
      keys: [0, PERIOD / 2],
    }),
  },
};
