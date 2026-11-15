// V11 defibrillator pads. Her description: "Sticks two pads on the chest of the
// character lying down; then everyone lifts their hands and moves away."
//
// Her answers (videos-answers.md, 14 Nov):
//   15  one pad below the right collarbone, one on the left side below the armpit
//       ("in real life the device's own picture decides");
//   16  after the pads are on, everyone stays back with hands up; no one kneels again
//       until the device says it is safe.
//
// Drawn here: the person lies on their back on the floor (as in V09); the rescuer
// kneels at their right side holding the two pads, sticks one below the right
// collarbone and, reaching across, one on the left side below the armpit, presses
// them on, then lifts both hands clear, stands up and steps back, hands up. Only
// the pads are drawn (no device or cables, her one-prop rule). There is only one
// rescuer, so "everyone" is this one person. The variant without gravity is not
// drawn: where the rescuer holds on while stepping back is not stated (asked).

import * as THREE from 'three';
import { CHEST, COM_HEIGHT, HAND, Prop, STERNUM_Y, gesture, palmOf, plant, ramp, reach, smooth, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Move } from '../step.ts';

const T = 4.4;
/** Hands onto the chest, pressing, and off again. */
const ON_FROM = 0.25, ON_AT = 0.8, ON2_FROM = 0.5, ON2_AT = 1.05, OFF_FROM = 1.4, OFF_AT = 1.75;
/** Getting up: the right foot forward, standing, then that foot back beside the other. */
const STEP_FROM = 1.7, STEP_AT = 2.2, UP_AT = 2.85, BACK_FROM = 2.85, BACK_AT = 3.35;

// On the back along x, head towards -x, face up; their right side (body -x) towards +z.
const LYING = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
const BACK = 0.095;

const patient: Moves = {
  root: track([[0, [STERNUM_Y - COM_HEIGHT, BACK, 0]]]),
  turn: track([[0, [0, 0, 0]]]),
  orient: LYING,
  head: track([[0, [-0.1, 0, 0]]]),
  // The left arm lies out from the body, so the left side of the chest is free for the pad.
  hands: [track([[0, [-0.27, -0.22, -0.04]]]), track([[0, [0.52, -0.05, -0.05]]])],
  elbows: [track([[0, [-1, 0, -0.3]]]), track([[0, [0.6, -0.6, -0.4]]])],
  feet: [track([[0, [-0.1, -0.87, -0.02]]]), track([[0, [0.1, -0.87, -0.02]]])],
  ankles: [track([[0, [-0.5, 0, 0]]]), track([[0, [-0.5, 0, 0]]])],
};

// The rescuer faces the person (-z). Leans over to place the pads; then upright, hands up, and up on the feet.
const rescuer: Moves = {
  root: track([
    [0, [0, 0.5, 0.52], 'still'], [ON_AT, [0, 0.4, 0.42]], [ON2_AT, [0, 0.38, 0.4]], [OFF_FROM, [0, 0.38, 0.4], 'still'], [OFF_AT + 0.1, [0, 0.52, 0.55]],
    [STEP_AT, [0, 0.5, 0.62], 'still'], [UP_AT, [0, 0.9, 0.74]], [BACK_AT + 0.1, [0, 0.95, 0.95], 'still'], [T, [0, 0.95, 0.95], 'still'],
  ]),
  turn: track([
    [0, [Math.PI, 0.25, 0], 'still'], [ON_AT, [Math.PI, 0.72, 0]], [ON2_AT, [Math.PI, 0.8, 0]], [OFF_FROM, [Math.PI, 0.8, 0], 'still'], [OFF_AT + 0.1, [Math.PI, 0.08, 0]],
    [STEP_AT, [Math.PI, 0.12, 0]], [UP_AT, [Math.PI, 0.04, 0]], [BACK_AT, [Math.PI, -0.03, 0]], [T, [Math.PI, -0.03, 0], 'still'],
  ]),
  chest: track([[0, [0.1, 0, 0], 'still'], [ON_AT, [0.3, 0, 0]], [OFF_FROM, [0.3, 0, 0], 'still'], [OFF_AT + 0.1, [0, 0, 0]], [T, [0, 0, 0], 'still']]),
  head: track([[0, [0.4, 0, 0], 'still'], [ON_AT, [0.3, 0, 0]], [OFF_FROM, [0.3, 0, 0]], [UP_AT, [0.3, 0, 0]], [T, [0.25, 0, 0], 'still']]),
  // Pads held in front at the start; hands up, open, once clear.
  hands: [
    track([[0, [-0.16, 0.0, 0.36], 'still'], [OFF_FROM, [-0.2, 0.15, 0.3]], [OFF_AT + 0.15, [-0.3, 0.58, 0.26], 'still'], [T, [-0.3, 0.58, 0.26], 'still']]),
    track([[0, [0.16, 0.0, 0.36], 'still'], [OFF_FROM, [0.2, 0.15, 0.3]], [OFF_AT + 0.15, [0.3, 0.58, 0.26], 'still'], [T, [0.3, 0.58, 0.26], 'still']]),
  ],
  elbows: [track([[0, [-1, -0.5, -0.4]], [OFF_FROM, [-1, -0.5, -0.4]], [OFF_AT + 0.15, [-1, -1, 0]]]), track([[0, [1, -0.5, -0.4]], [OFF_FROM, [1, -0.5, -0.4]], [OFF_AT + 0.15, [1, -1, 0]]])],
  wrists: [track([[0, [0, 0, 0]], [OFF_FROM, [0, 0, 0]], [OFF_AT + 0.15, [-0.5, 0, 0]], [T, [-0.5, 0, 0]]]), track([[0, [0, 0, 0]], [OFF_FROM, [0, 0, 0]], [OFF_AT + 0.15, [-0.5, 0, 0]], [T, [-0.5, 0, 0]]])],
  overlap: 0.5,
};

const v = new THREE.Vector3();
const n = new THREE.Vector3();
const f1 = new THREE.Vector3();
const kneelR = new THREE.Vector3(), standR = new THREE.Vector3(), kneelL = new THREE.Vector3(), standL = new THREE.Vector3();
const tA = new THREE.Vector3();
const qA = new THREE.Quaternion();
const m = new THREE.Matrix4();
const side = new THREE.Vector3();
const floorUp = new THREE.Vector3(0, 1, 0);
const floorDown = new THREE.Vector3(0, -1, 0);
const toesBack = new THREE.Vector3(0, 0, 1);
const toesFwd = new THREE.Vector3(0, 0, -1);
/** Pad 1, below the right collarbone: on the front of the chest, fingers across it. Pad 2, on the left side below the armpit: fingers towards the floor. */
const PAD1 = { fingers: new THREE.Vector3(0, 0, -1), into: new THREE.Vector3(0, -1, 0), at: new THREE.Vector3() };
const PAD2 = { fingers: new THREE.Vector3(0, -1, 0), into: new THREE.Vector3(0, 0, 1), at: new THREE.Vector3() };

/** A foot moving from one placement (A) to another (B) by w, lifted by `lift` metres at the middle. */
function step(fig: Figure, l: number, w: number, lift: number, a: [THREE.Vector3, THREE.Vector3, THREE.Vector3], b: [THREE.Vector3, THREE.Vector3, THREE.Vector3]) {
  plant(fig, l, a[0], a[1], a[2], 1);
  tA.copy(fig.legs[l].target);
  qA.copy(fig.legs[l].world);
  if (w <= 0) return;
  plant(fig, l, b[0], b[1], b[2], 1);
  const leg = fig.legs[l];
  leg.target.lerpVectors(tA, leg.target, w).y += lift * Math.sin(Math.PI * w);
  leg.world.slerpQuaternions(qA, leg.world, w);
}

/** A pad in lines (a rounded rectangle, 15 by 10 cm, about an adult pad's size) in its own frame: its face in x-y, facing +z. */
function pad(w: Parameters<typeof gesture>[0]) {
  return new Prop(w, (pen) => {
    const a = 0.075, b = 0.05, r = 0.015;
    pen.path([[-a + r, -b, 0], [a - r, -b, 0], [a, -b + r, 0], [a, b - r, 0], [a - r, b, 0], [-a + r, b, 0], [-a, b - r, 0], [-a, -b + r, 0], [-a + r, -b, 0]]);
    pen.path([[-a + 0.02, 0, 0.002], [a - 0.02, 0, 0.002]]);
  }, { strength: 1, width: 3, boxes: [[-0.075, -0.05, -0.004, 0.075, 0.05, 0]] });
}

/** Place a pad on a point with its face's normal `out` and its long side along `along`. */
function placePad(p: Prop, at: THREE.Vector3, out: THREE.Vector3, along: THREE.Vector3) {
  side.crossVectors(out, along).normalize();
  m.makeBasis(along, side, out);
  p.object.quaternion.setFromRotationMatrix(m);
  p.object.position.copy(at).addScaledVector(out, 0.003);
}

export const v11: Move = {
  id: 'V11',
  name: 'V11-defibrillator-pads',
  summary: 'Sticks two pads on the chest of the person lying down, one below the right collarbone and one on the left side below the armpit; then lifts the hands, stands up and steps back, hands up.',
  params: {},
  medical: true,
  reviewed: false,
  source: 'Pad positions and staying back with hands up: the medical lead’s answers 15 and 16 (14 Nov 2026). They match the usual anterolateral placement in resuscitation guidance (ERC, AHA), which was not opened for this move.',
  questions: [
    'V11, no gravity: after the pads are on, how does the rescuer stay back without gravity? Push off and hold a handrail, with the hands up?',
    'V11: the rescuer kneels on the person’s right side to place both pads, then stands and steps back. Is that right?',
  ],
  variants: {
    gravity: (world) => gesture(world, {
      duration: T,
      loop: 'seam',
      gravity: 'gravity',
      cast: [{ moves: rescuer, role: 'actor' }, { moves: patient, role: 'other' }],
      props: (w) => [pad(w), pad(w)],
      marks: { contacts: 2 },
      act: (t, [r, p]: Figure[], [pad1, pad2], marks) => {
        // The two spots on the person.
        p.restPoint(CHEST, -0.085, 1.36, 0.092, PAD1.at);
        p.restPoint(CHEST, 0.166, 1.25, 0.0, PAD2.at);
        // Legs: kneeling (knees down, tops of the feet on the floor), then the right foot forward,
        // standing, and that foot back beside the other.
        const fwd = smooth(ramp(t, STEP_FROM, STEP_AT));
        const back = smooth(ramp(t, BACK_FROM, BACK_AT));
        const rise = smooth(ramp(t, STEP_AT, UP_AT));
        if (back > 0) step(r, 0, back, 0.08, [kneelR.set(0.14, 0, 0.5), toesFwd, floorUp], [standR.set(0.13, 0, 0.98), toesFwd, floorUp]);
        else step(r, 0, fwd, 0.1, [kneelR.set(0.13, 0, 0.92), toesBack, floorDown], [standR.set(0.14, 0, 0.5), toesFwd, floorUp]);
        step(r, 1, rise, 0, [kneelL.set(-0.13, 0, 0.92), toesBack, floorDown], [standL.set(-0.13, 0, 0.98), toesFwd, floorUp]);
        // Hands: on with the pads, pressing, then off and up.
        // One pad, then the other (reaching across), both pressed on, then both hands off.
        const off = 1 - smooth(ramp(t, OFF_FROM, OFF_AT));
        reach(r, 1, PAD1.at, PAD1.fingers, PAD1.into, smooth(ramp(t, ON_FROM, ON_AT)) * off);
        reach(r, 0, PAD2.at, PAD2.fingers, PAD2.into, smooth(ramp(t, ON2_FROM, ON2_AT)) * off);
        r.solve();
        // The pads: in the hands until pressed on, then stuck.
        for (let k = 0; k < 2; k++) {
          const pd = k === 1 ? pad1 : pad2, spec = k === 1 ? PAD1 : PAD2;
          if (t >= (k === 1 ? ON_AT : ON2_AT)) placePad(pd, spec.at, n.copy(spec.into).negate(), spec.fingers);
          else {
            // Held flat against the palm, its sticky face out.
            palmOf(r, k, v);
            const s = k === 0 ? -1 : 1;
            n.set(-s, 0, 0).applyQuaternion(r.q[HAND(k)]);
            f1.set(0, -1, 0).applyQuaternion(r.q[HAND(k)]);
            placePad(pd, v.addScaledVector(n, 0.006), n.negate(), f1);
          }
        }
        if (marks) {
          const fade = 1 - ramp(t, OFF_AT, OFF_AT + 0.4);
          marks.contacts[0].show(PAD1.at, 0.08, 0.8 * ramp(t, ON_AT - 0.1, ON_AT) * fade, 0);
          marks.contacts[1].show(PAD2.at, 0.08, 0.8 * ramp(t, ON2_AT - 0.1, ON2_AT) * fade, 0);
        }
      },
      camera: { target: [0.05, 0.72, 0.45], yaw: 2.45, pitch: 0.36, extent: 2.6, span: 2.4 },
      keys: [0.1, 1.1, 3.8],
    }),
  },
};
