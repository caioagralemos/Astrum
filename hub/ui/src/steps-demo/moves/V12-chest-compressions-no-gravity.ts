// V12 chest compressions without gravity. Her description: "NO gravity,
// floating. The rescuer holds the other's body with the legs: left leg over
// their right shoulder, right leg around their chest, ankles crossed behind
// their back; both hands press the middle of the chest."
//
// This is the Evetts-Russomano method of the cited guideline (DGLRM / ESAM-SMG
// 2020, see `source`): "The rescuer places their left leg over the patient's
// right shoulder and the right leg around the patient's torso. By interlocking
// their ankles in the center of the patient's back, the rescuer attaches
// himself to the patient and can now generate force onto the patient's chest
// without being pushed away."
//
// Her answers (videos-answers.md, 14 Nov), all marked there as HER CHOICE, not
// in the guideline text and not sourced:
//   17  the rescuer's left leg over the patient's right shoulder; the rescuer in front, facing them;
//   18  the rescuer faces the patient's chest, the two face to face;
//   19  the right leg goes around the patient's chest over the arms (the arms inside the loop);
//   23  the rescuer's hips are level with the patient's chest;
//   24  the rescuer's back is upright;
//   25  rate and depth as V09: 120 a minute; depth as V09 (5.5 cm, from her card's 5 to 6 cm).
// Hands stacked on the lower half of the breastbone: her V09 answer 13, applied here.
//
// Drawn here: two people floating face to face. The rescuer's hips sit level
// with the patient's chest, the back upright; the left leg hooks over the
// patient's right shoulder, the right leg wraps round the left side outside the
// arm, and the ankles cross behind the patient's back. Both hands, stacked,
// press the breastbone with the arms almost straight; the press comes from the
// shoulders, and the legs hold the patient's back against it, so the two
// bodies rock a little towards each other on each press and nothing drifts.
// The patient's arms lie along the body, inside the loop of the right leg.

import * as THREE from 'three';
import { COM_HEIGHT, STERNUM_Y, STERNUM_Z, gesture, reach, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Move } from '../step.ts';

/** Her answer 25 (as V09): 120 a minute, 6 in the 3 s loop, 5.5 cm deep. */
const RATE = 120;
const COUNT = 6;
const T = (COUNT * 60) / RATE;
const PERIOD = 60 / RATE;
const DEPTH = 0.055;
const press = (u: number) => 0.5 - 0.5 * Math.cos(((((u / PERIOD) % 1) + 1) % 1) * Math.PI * 2);

/** The patient floats upright at the origin, facing +z; the rescuer faces them from +z. */
const STERNUM = new THREE.Vector3(0, STERNUM_Y, STERNUM_Z);
/** The rescuer's hip joints level with the patient's chest (her answer 23). */
const HIP_Y = 1.33;
const RESCUER_Z = 0.28;

const patient: Moves = {
  root: track([[0, [0, COM_HEIGHT, 0]]]),
  turn: track([[0, [0, 0, 0]]]),
  head: track([[0, [0.12, 0, 0]]]),
  // Arms along the body, inside the loop of the rescuer's right leg (her answer 19).
  hands: [track([[0, [-0.2, -0.17, 0.0]]]), track([[0, [0.2, -0.17, 0.0]]])],
  elbows: [track([[0, [-1, 0, -0.4]]]), track([[0, [1, 0, -0.4]]])],
  // Legs in the loose float of a body in orbit: hips and knees bent, feet below and ahead.
  feet: [track([[0, [-0.13, -0.66, 0.2]]]), track([[0, [0.13, -0.66, 0.2]]])],
  knees: [track([[0, [-0.15, 0, 1]]]), track([[0, [0.15, 0, 1]]])],
  ankles: [track([[0, [-0.2, 0, 0]]]), track([[0, [-0.2, 0, 0]]])],
};

const rescuer: Moves = {
  // Faces the patient (-z), hips level with their chest, back upright (her answers 18, 23, 24).
  root: track([[0, [0, HIP_Y + (COM_HEIGHT - 0.93), RESCUER_Z]]]),
  turn: track([[0, [Math.PI, 0, 0]]]),
  chest: track([[0, [0.05, 0, 0]]]),
  head: track([[0, [0.22, 0, 0]]]),
  elbows: [track([[0, [-1, -0.2, -0.2]]]), track([[0, [1, -0.2, -0.2]]])],
  // Toes pointed, so the feet hook behind the back instead of sticking out.
  ankles: [track([[0, [1.0, 0, 0]]]), track([[0, [1.0, 0, 0]]])],
};

const contact = new THREE.Vector3();
const point = new THREE.Vector3();
// The arms come down from shoulders above the chest (her answers 23 and 24), so the hands lie
// with the fingers pointing down the chest, one on the other, palms pressing in (-z). Asked of her.
const fingers = new THREE.Vector3(0, -1, 0);
const fingersTop = new THREE.Vector3(0.2, -1, 0).normalize();
const into = new THREE.Vector3(0, 0, -1);
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const lean = new THREE.Quaternion();

/** Where the ankles cross, behind the patient's back, and which way each knee points. */
const ANKLE_L = new THREE.Vector3(0.07, 1.25, -0.23);
const ANKLE_R = new THREE.Vector3(-0.06, 1.17, -0.27);
const POLE_L = new THREE.Vector3(-0.8, 1, 0);
const POLE_R = new THREE.Vector3(1, 0, -0.5);
const anchor = new THREE.Vector3();

export const v12: Move = {
  id: 'V12',
  name: 'V12-chest-compressions-no-gravity',
  summary: 'No gravity. The rescuer holds the other’s body with the legs, left leg over their right shoulder, right leg round their chest, ankles crossed behind their back, and presses the middle of the chest with both hands.',
  params: {},
  medical: true,
  reviewed: false,
  source: 'Leg hold: the Evetts-Russomano (ER) method, Hinkelbein J, et al. Cardiopulmonary resuscitation (CPR) during spaceflight – a guideline for CPR in microgravity from the German Society of Aerospace Medicine (DGLRM) and the European Society of Aerospace Medicine Space Medicine Group (ESAM-SMG). Scand J Trauma Resusc Emerg Med 2020;28:108, doi:10.1186/s13049-020-00793-y. Facing, the right leg over the arms, hips level with the chest, upright back, and rate and depth as V09: the medical lead’s answers 17, 18, 19, 23, 24 and 25 (14 Nov 2026), HER CHOICE, not in the guideline text and not sourced (the guideline reports about 104 a minute and about 45 mm measured with this method). Hands stacked on the lower half of the breastbone: her V09 answer 13.',
  questions: [
    'V12: with the hips level with the chest and the back upright, the shoulders are above the chest, so the arms reach down and the stacked hands lie with the fingers pointing down the chest. Is that right?',
  ],
  variants: {
    weightless: (world) => gesture(world, {
      duration: T,
      gravity: 'weightless',
      cast: [{ moves: rescuer, role: 'actor' }, { moves: patient, role: 'other' }],
      marks: { contacts: 1 },
      act: (t, [r, p]: Figure[], _props, marks) => {
        const c = press(t);
        const d = DEPTH * c;
        // Nothing to push against but each other: the push drives the chest in, and the two bodies
        // close a little on each other, the rescuer leaning in from the chest.
        p.press = d;
        p.root.z += 0.008 * c;
        r.root.z -= 0.006 * c;
        r.chest.multiply(lean.setFromEuler(euler.set(0.06 * c, 0, 0)));
        r.solve();
        p.solve();
        contact.copy(STERNUM);
        contact.z += 0.008 * c - d;
        reach(r, 0, contact, fingers, into, 1);
        point.copy(contact).addScaledVector(into, -0.088).y += 0.01;
        reach(r, 1, point, fingersTop, into, 1);
        // The legs: ankles crossed behind the patient's back, carried with it.
        const legs = r.legs;
        legs[1].target.copy(anchor.copy(ANKLE_L)).z += 0.008 * c;
        legs[1].pole.copy(POLE_L);
        legs[0].target.copy(anchor.copy(ANKLE_R)).z += 0.008 * c;
        legs[0].pole.copy(POLE_R);
        if (marks) marks.contacts[0].show(contact, 0.07, 0.9, c);
      },
      camera: { target: [0, 1.22, 0.1], yaw: -1.4, pitch: 0.3, extent: 2.5, span: 2.0 },
      keys: [0, PERIOD / 2],
    }),
  },
};
