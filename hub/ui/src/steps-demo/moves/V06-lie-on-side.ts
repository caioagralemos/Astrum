// V06 lie on the side. Her description: "A character (unconscious) is turned
// onto their side by another: top knee bent, bottom arm stretched out." Her
// answers (14 Nov, videos-answers.md; gravity on; for a person who is
// unconscious but breathing): 4, either side; 5, the rescuer keeps one hand on
// the head and chin (chin lift) while the person lies on the side, and the
// person's arm stays beside the body (her choice); 6, the rescuer pulls the far
// shoulder and the far knee; 7, the head tilts back a little at the end.
//
// Drawn here: the person lies on their back on the floor, the near arm already
// stretched out on the floor at a right angle to the body, the far knee already
// bent up with the foot on the floor. The rescuer kneels on the near side,
// leaning over, one hand on the far shoulder and one on the far knee, and pulls
// both, rolling the person towards them onto their side. The bent far knee
// comes over and rests on the floor in front (the top knee bent), the near arm
// stays stretched out on the floor (the bottom arm), and the far arm stays
// beside the body. The rescuer's hand then goes from the shoulder to the chin
// and lifts it, and the head tilts back a little; the other hand stays on the
// knee.
//
// Not in her words, so taken from the guideline cited in `source` or left as
// the least added: the bottom arm lies at a right angle to the body, palm up
// (ERC); it is straight because she says "stretched out" (ERC bends the elbow:
// asked); the far knee is bent up before the roll, as ERC describes; the
// rescuer's second hand stays on the knee at the end (not stated: asked). The
// side shown is the person's right side (her answer: either side).
//
// The loop does not come back: the last half second dissolves into the next
// round.

import * as THREE from 'three';
import { CHEST, HEAD, PELVIS, THIGH, UPPER, gesture, plant, ramp, reach, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Move } from '../step.ts';
import { sample } from '../anim.ts';

const T = 4.2;
/** The roll (pull on shoulder and knee), the hand going to the chin, and the head tilting back. */
const ROLL_A = 0.4, ROLL_B = 2.0;
const CHIN_A = 2.05, CHIN_B = 2.65;
const TILT_A = 2.65, TILT_B = 3.15;
/** How far the person rolls (radians about the body's long axis). */
const ROLL = 1.5;

// The person lies along x, head towards -x, on the back; their right side (body -x: arm and leg 0) is
// towards +z, the rescuer's side. Rolling towards the rescuer turns the front from +y to +z.
const Q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));

/** The near (bottom) arm's hand on the floor, at a right angle out from the shoulder. */
const HAND_FLOOR = new THREE.Vector3(-0.44, 0.075, 0.66);

const person: Moves = {
  root: track([[0, [0, 0.09, 0]]]),
  turn: track([[0, [0, 0, 0]]]),
  // The head: in line, then tilted back a little at the end (her answer 7).
  head: track([[0, [0, 0, 0], 'still'], [TILT_A, [0, 0, 0], 'still'], [TILT_B, [-0.28, 0, 0], 'still'], [T, [-0.28, 0, 0], 'still']]),
  wrists: [null, track([[0, [0.2, 0, 0]]])],
  ankles: [track([[0, [0.7, 0, 0]]]), null],
};

// The rescuer kneels on the near side (+z), facing the person (-z), by their waist. Its own left
// side (arm 1) is towards the person's head (-x).
const RX = 0.08;
const rescuer: Moves = {
  root: track([[0, [RX - 0.04, 0.49, 0.5], 'still'], [ROLL_A, [RX - 0.04, 0.49, 0.5]], [ROLL_B, [RX - 0.06, 0.52, 0.58]], [CHIN_A, [RX - 0.06, 0.52, 0.58]], [CHIN_B, [RX - 0.23, 0.46, 0.54], 'still'], [T, [RX - 0.23, 0.46, 0.54], 'still']]),
  turn: track([[0, [Math.PI + 0.25, 0.9, 0], 'still'], [ROLL_A, [Math.PI + 0.25, 0.9, 0]], [ROLL_B, [Math.PI + 0.35, 0.72, 0]], [CHIN_A, [Math.PI + 0.35, 0.72, 0]], [CHIN_B, [Math.PI + 0.75, 0.86, 0], 'still'], [T, [Math.PI + 0.75, 0.86, 0], 'still']]),
  chest: track([[0, [0.35, 0, 0], 'still'], [ROLL_A, [0.35, 0, 0]], [ROLL_B, [0.2, 0, 0]], [CHIN_B, [0.32, 0.05, 0], 'still'], [T, [0.32, 0.05, 0], 'still']]),
  head: track([[0, [0.35, 0, 0]], [T, [0.35, 0, 0]]]),
  elbows: [track([[0, [-1, -0.3, -0.4]]]), track([[0, [1, -0.3, -0.4]]])],
  overlap: 0.3,
};

const roll = new THREE.Quaternion(), tiltQ = new THREE.Quaternion();
const xAxis = new THREE.Vector3(1, 0, 0), zAxis = new THREE.Vector3(0, 0, 1);
const p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), fingers = new THREE.Vector3(), into = new THREE.Vector3();
const spot = new THREE.Vector3(), floorDown = new THREE.Vector3(0, -1, 0);
const toesBack = new THREE.Vector3(0, 0, 1), palmUp = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const buf = [0, 0, 0];
/** The far arm stays beside the body (her answer 5): the wrist by the hip, in the body's frame; a little in front once on the side. */
const FAR_HAND = track([[0, [0.24, -0.44, -0.02], 'still'], [ROLL_A, [0.24, -0.44, -0.02]], [ROLL_B, [0.21, -0.4, 0.07], 'still'], [T, [0.21, -0.4, 0.07], 'still']]);

/** Points on the surface of the trunk and head (rest coordinates), to rest the body on the floor. */
const UPPER_PTS: [number, number, number, number][] = [
  [CHEST, 0, 1.3, -0.095], [CHEST, 0.17, 1.33, 0], [CHEST, -0.17, 1.33, 0], [CHEST, 0, 1.3, 0.095],
  [UPPER(0), -0.245, 1.36, 0], [UPPER(1), 0.245, 1.36, 0],
  [HEAD, 0, 1.68, -0.087], [HEAD, 0.103, 1.68, 0], [HEAD, -0.103, 1.68, 0],
];
const LOWER_PTS: [number, number, number, number][] = [
  [PELVIS, 0, 0.97, -0.085], [PELVIS, 0.15, 0.97, 0], [PELVIS, -0.15, 0.97, 0], [PELVIS, 0, 0.97, 0.085],
];
function lowest(f: Figure, pts: [number, number, number, number][]): number {
  let m = Infinity;
  for (const [b, x, y, z] of pts) m = Math.min(m, f.restPoint(b, x, y, z, tmp).y);
  return m;
}

/** The person at time t: rolled by the pull, the trunk resting on the floor (hips and shoulders both down). */
function lay(p: Figure, t: number) {
  const k = ramp(t, ROLL_A, ROLL_B);
  let psi = 0;
  p.root.set(0.0, 0.1, 0.13 * k);
  for (let i = 0; i < 4; i++) {
    roll.setFromAxisAngle(xAxis, ROLL * k);
    tiltQ.setFromAxisAngle(zAxis, psi);
    p.turn.copy(tiltQ).multiply(roll).multiply(Q0);
    p.solve();
    const lo = lowest(p, LOWER_PTS);
    p.root.y -= lo;
    p.solve();
    const hi = lowest(p, UPPER_PTS);
    // Head end too high: turn it down about the hips (positive psi lowers -x).
    psi += hi / 0.42;
  }
  roll.setFromAxisAngle(xAxis, ROLL * k);
  tiltQ.setFromAxisAngle(zAxis, psi);
  p.turn.copy(tiltQ).multiply(roll).multiply(Q0);
  p.solve();
  p.root.y -= lowest(p, LOWER_PTS) - 0.002;
  p.solve();
  // The near (bottom) leg: straight along the floor.
  p.body(-0.09, -0.86, 0.02, p1);
  p.legs[0].target.set(0.86, 0.075, p1.z);
  p.legs[0].weight = 0;
  p.bodyDir(0, 0, 1, p.legs[0].pole);
  // The far leg: knee up and foot flat on the floor at the start; it comes over with the roll and the
  // knee rests on the floor in front, bent (the top knee).
  const kn = ramp(t, ROLL_A + 0.15, ROLL_B);
  spot.set(0.5 - 0.1 * kn, 0.08 - 0.02 * kn, -0.11 + 0.52 * kn);
  p.legs[1].target.copy(spot);
  p.legs[1].weight = 0;
  p.legs[1].pole.set(0, 1 - kn, 1.2 * kn);
  // The near (bottom) arm: stretched out on the floor at a right angle to the body, palm up.
  fingers.set(0, 0, 1);
  reach(p, 0, HAND_FLOOR, fingers, palmUp, 1);
  p.bodyDir(-0.3, 0, 1, p.arms[0].pole);
  sample(FAR_HAND, t, buf);
  p.body(buf[0], buf[1], buf[2], p.arms[1].target);
  p.bodyDir(1, 0, -0.3, p.arms[1].pole);
  p.arms[1].weight = 0;
  // Solve with the limbs placed, so the rescuer's hands are laid on where they are now.
  p.solve();
}

export const v06: Move = {
  id: 'V06',
  name: 'V06-lie-on-side',
  summary: 'With gravity. A person lying unconscious is rolled onto their side by another, who pulls the far shoulder and the far knee: top knee bent, bottom arm stretched out; then one hand on the chin, head tilted back a little.',
  params: {},
  medical: true,
  reviewed: false,
  source: 'The medical lead\'s answers 4 to 7 (14 Nov 2026, videos-answers.md): either side; one hand on the head and chin (chin lift), the arm beside the body (her choice); pull the far shoulder and the far knee; tilt the head back a little at the end. The bottom arm\'s direction and the far knee bent up before the roll: European Resuscitation Council Guidelines 2021, Basic Life Support (Olasveengen et al., Resuscitation 2021;161:98-114), recovery position: "Place the arm nearest to you at right angles to the body, elbow bent, with the hand palm uppermost" and "grasp the far leg just above the knee and pull it up, keeping the foot on the ground". Her "stretched out" is followed over "elbow bent".',
  questions: [
    'V06: the bottom arm: you say "stretched out"; the ERC guideline says at a right angle to the body, elbow bent, palm up. The animation shows it at a right angle, straight, palm up. Is that right?',
    'V06: after the roll, the rescuer\'s other hand stays on the top knee. Is that right, or should it go somewhere else?',
  ],
  variants: {
    gravity: (world) => gesture(world, {
      duration: T,
      loop: 'seam',
      gravity: 'gravity',
      cast: [{ moves: rescuer, role: 'other' }, { moves: person, role: 'actor' }],
      marks: { contacts: 2 },
      act: (t, [r, p]: Figure[], _props, marks) => {
        lay(p, t);
        // Kneeling: knees and the tops of the feet on the floor, shins back.
        for (let l = 0; l < 2; l++) {
          const s = l === 0 ? 1 : -1;
          plant(r, l, spot.set(RX - 0.03 + s * 0.12, 0, 0.98), toesBack, floorDown, 1);
          r.legs[l].pole.set(0, -0.4, -1);
        }
        // The rescuer's left hand (arm 1): on the far shoulder (pulling), then on the chin, lifting it.
        const toChin = ramp(t, CHIN_A, CHIN_B);
        p.restPoint(UPPER(1), 0.215, 1.4, 0.05, p1);
        fingers.set(1, -0.3, -0.4).applyQuaternion(p.q[CHEST]);
        into.set(-0.6, -0.2, -0.5).applyQuaternion(p.q[CHEST]);
        reach(r, 1, p1, fingers, into, 1 - toChin);
        if (toChin > 0) {
          // Under the chin from the front, fingers along the jaw towards the far ear, lifting.
          p.restPoint(HEAD, 0.0, 1.565, 0.05, p2);
          fingers.set(1, 0.15, -0.35).applyQuaternion(p.q[HEAD]);
          into.set(0, 1, 0.15).applyQuaternion(p.q[HEAD]);
          reach(r, 1, p2, fingers, into, toChin);
        }
        // The right hand (arm 0): on the outside of the far knee, pulling, and it stays there.
        p.restPoint(THIGH(1), 0.15, 0.56, 0.02, p1);
        fingers.set(0, 0, -1).applyQuaternion(p.q[THIGH(1)]);
        into.set(-1, 0, 0).applyQuaternion(p.q[THIGH(1)]);
        reach(r, 0, p1, fingers, into, 1);
        if (marks) {
          const pull = ramp(t, ROLL_A - 0.2, ROLL_A) * (1 - ramp(t, ROLL_B, ROLL_B + 0.3));
          marks.contacts[0].show(p1, 0.05, 0.7 * pull);
          p.restPoint(HEAD, 0.0, 1.565, 0.05, p2);
          marks.contacts[1].show(p2, 0.04, 0.7 * ramp(t, CHIN_B - 0.1, CHIN_B + 0.1));
        }
      },
      camera: { target: [0.0, 0.25, 0.25], yaw: 2.45, pitch: 0.85, extent: 1.7, span: 1.9 },
      keys: [0.2, 1.4, 3.6],
    }),
  },
};
