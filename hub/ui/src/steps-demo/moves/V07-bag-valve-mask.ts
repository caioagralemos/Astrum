// V07 bag-valve mask. Her description: "Two characters: one lies on their back,
// the other fits the bag-valve mask on the face and squeezes the bag twice."
//
// Her answers (videos-answers.md, 14 Nov):
//    8  tilt the head back with the chin lifted a little before the mask (a small tilt, no number);
//    9  ONE person does both: one hand holds the mask (thumb and index finger in a C over
//       the mask, the other fingers lifting the jaw), the other hand squeezes the bag;
//       no second person (this replaces the earlier two-person draft);
//   10  each squeeze about 1 second, with a short pause for the chest to fall between the two.
//
// Drawn here: the person lies on their back on the floor (as in V09). The rescuer
// kneels at the top of their head, facing their feet, holding the device (mask,
// valve and bag in one piece). The mask hand brings the mask down over the nose
// and mouth while the head tilts back a little; the hand stays on the mask (a
// mitt, so the C of thumb and index finger and the fingers under the jaw are
// only suggested). The other hand squeezes the bag over about a second, lets go
// for half a second as the chest falls, squeezes again, and lets go; the chest
// rises a little with each squeeze. Where the rescuer kneels is not in her
// answers (asked); the hands are mitts, so the grip is asked to be checked.

import * as THREE from 'three';
import { COM_HEIGHT, HEAD, Prop, STERNUM_Y, gesture, plant, ramp, reach, smooth, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Move } from '../step.ts';

const T = 4.6;
/** The mask comes down and the head tilts back; then two squeezes of about a second, each followed by a pause. */
const MASK_FROM = 0.3, MASK_AT = 1.05;
const SQUEEZES: [number, number][] = [[1.25, 2.25], [2.85, 3.85]];
/** How far the bag is squeezed (0 to 1) at loop time t: in over about 0.6 s, out again by the end of the second. */
function squeeze(t: number): number {
  for (const [a, b] of SQUEEZES) if (t >= a && t <= b + 0.1) return smooth(ramp(t, a, a + 0.6)) * (1 - smooth(ramp(t, b - 0.35, b + 0.1)));
  return 0;
}
/** The chest rises behind the squeeze and falls in the pause. */
function breath(t: number): number {
  let v = 0;
  for (const [a, b] of SQUEEZES) v = Math.max(v, smooth(ramp(t, a + 0.15, b - 0.2)) * (1 - smooth(ramp(t, b - 0.1, b + 0.45))));
  return v;
}

const LYING = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
const BACK = 0.095;

const patient: Moves = {
  root: track([[0, [STERNUM_Y - COM_HEIGHT, BACK, 0]]]),
  turn: track([[0, [0, 0, 0]]]),
  orient: LYING,
  // A small tilt back, chin up a little, as the mask comes on (her answer 8).
  head: track([[0, [-0.05, 0, 0], 'still'], [MASK_FROM + 0.1, [-0.05, 0, 0], 'still'], [MASK_AT, [-0.3, 0, 0], 'still'], [T, [-0.3, 0, 0], 'still']]),
  hands: [track([[0, [-0.3, -0.22, -0.04]]]), track([[0, [0.3, -0.22, -0.04]]])],
  elbows: [track([[0, [-1, 0, -0.3]]]), track([[0, [1, 0, -0.3]]])],
  feet: [track([[0, [-0.1, -0.87, -0.02]]]), track([[0, [0.1, -0.87, -0.02]]])],
  ankles: [track([[0, [-0.5, 0, 0]]]), track([[0, [-0.5, 0, 0]]])],
};

// Kneeling at the top of the head, facing the feet (+x); its right side (arm 0) towards +z.
const KNEEL_X = -1.02;
const rescuer: Moves = {
  root: track([[0, [KNEEL_X + 0.06, 0.48, 0], 'still'], [MASK_FROM, [KNEEL_X + 0.06, 0.48, 0]], [MASK_AT, [KNEEL_X + 0.12, 0.42, 0], 'still'], [T, [KNEEL_X + 0.12, 0.42, 0], 'still']]),
  turn: track([[0, [Math.PI / 2, 0.35, 0], 'still'], [MASK_FROM, [Math.PI / 2, 0.35, 0]], [MASK_AT, [Math.PI / 2, 0.62, 0], 'still'], [T, [Math.PI / 2, 0.62, 0], 'still']]),
  chest: track([[0, [0.15, 0, 0]], [MASK_AT, [0.25, 0, 0]], [T, [0.25, 0, 0]]]),
  head: track([[0, [0.35, 0, 0]]]),
  elbows: [track([[0, [-0.6, -0.6, -0.5]]]), track([[0, [0.6, -0.6, -0.5]]])],
  overlap: 0.3,
};

const dev = new THREE.Vector3();
const n = new THREE.Vector3();
const along = new THREE.Vector3();
const side = new THREE.Vector3();
const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p1 = new THREE.Vector3();
const fingers = new THREE.Vector3();
const into = new THREE.Vector3();
const spot = new THREE.Vector3();
const toesBack = new THREE.Vector3(-1, 0, 0);
const floorDown = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
/** Where the mask is held before it goes on: above the face, towards the rescuer (in the world). */
const HELD = new THREE.Vector3(-0.58, 0.42, 0);
/** The bag in the device's frame (y towards the top of the head, z out of the face): from the valve, back and up. */
const BAG_AXIS = new THREE.Vector3(-0.5, 0.75, 0.45).normalize();
const VALVE = 0.07;
const BAG_R = 0.065;
const BAG_L = 0.27;

/** The mask and valve: a rounded triangle on the face (narrow over the nose, +y), a dome, the valve. */
function maskProp(w: Parameters<typeof gesture>[0]) {
  return new Prop(w, (pen) => {
    const rim: [number, number, number][] = [[0, 0.06, 0], [0.035, 0.035, 0], [0.048, -0.01, 0], [0.04, -0.045, 0], [0, -0.058, 0], [-0.04, -0.045, 0], [-0.048, -0.01, 0], [-0.035, 0.035, 0], [0, 0.06, 0]];
    pen.path(rim);
    for (const [x, y] of [[0, 0.06], [0.048, -0.01], [0, -0.058], [-0.048, -0.01]]) pen.seg(x, y, 0, x * 0.35, y * 0.35, 0.035);
    pen.circle(0, 0, 0.035, 0.016, 'xy');
    pen.seg(-0.014, 0, 0.035, -0.014, 0, VALVE).seg(0.014, 0, 0.035, 0.014, 0, VALVE);
    pen.circle(0, 0, VALVE, 0.016, 'xy');
  }, { strength: 1, width: 2.2 });
}

/** The bag, along its own +y from the valve: rings and four long lines, squeezed by scaling x and z. */
function bagProp(w: Parameters<typeof gesture>[0]) {
  return new Prop(w, (pen) => {
    const prof = (y: number) => BAG_R * Math.sin(Math.PI * Math.min(1, 0.15 + (0.85 * y) / BAG_L)) + 0.012;
    for (const y of [0.04, 0.1, 0.17, 0.23]) pen.circle(0, y, 0, prof(y), 'xz');
    for (const [cx, cz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 8; i++) { const y = (BAG_L * i) / 8; pts.push([cx * prof(y), y, cz * prof(y)]); }
      pen.path(pts);
    }
  }, { strength: 1, width: 2.2 });
}

export const v07: Move = {
  id: 'V07',
  name: 'V07-bag-valve-mask',
  summary: 'One person: tilts the head of the person lying down back a little, fits the bag-valve mask on the face with one hand and squeezes the bag twice with the other.',
  params: {},
  medical: true,
  reviewed: false,
  source: 'Head tilt, one-person grip (mask hand and bag hand) and the timing of the squeezes: the medical lead’s answers 8, 9 and 10 (14 Nov 2026). Nothing else is taken from a guideline.',
  questions: [
    'V07: where does the rescuer kneel to use the bag-valve mask alone: at the top of the head, or at the side? (The animation shows the top of the head.)',
    'V07, no gravity: where is the person and how does the rescuer hold on? (On the strapped stretcher as in V13, with the rescuer’s feet in a foot loop?)',
  ],
  variants: {
    gravity: (world) => gesture(world, {
      duration: T,
      loop: 'seam',
      gravity: 'gravity',
      cast: [{ moves: rescuer, role: 'actor' }, { moves: patient, role: 'other' }],
      props: (w) => [maskProp(w), bagProp(w)],
      act: (t, [r, p]: Figure[], [mask, bag]) => {
        if (bag.object.parent !== mask.object) mask.object.add(bag.object);
        p.press = -0.012 * breath(t);
        p.root.y += 0.004 * breath(t);
        p.solve();
        // Kneeling: knees down, the tops of the feet on the floor behind.
        for (let l = 0; l < 2; l++) {
          const s = l === 0 ? 1 : -1;
          plant(r, l, spot.set(KNEEL_X - 0.42, 0, s * 0.13), toesBack, floorDown, 1);
          r.legs[l].pole.set(1, -0.5, 0);
        }
        // The mask on the face: over nose and mouth, its normal out of the face; held above it before.
        const on = smooth(ramp(t, MASK_FROM, MASK_AT));
        p.restPoint(HEAD, 0, 1.635, 0.098, p1);
        n.set(0, 0, 1).applyQuaternion(p.q[HEAD]);
        along.set(0, 1, 0).applyQuaternion(p.q[HEAD]);
        dev.lerpVectors(HELD, p1, on);
        side.crossVectors(along, n);
        m.makeBasis(side, along, n);
        q.setFromRotationMatrix(m);
        mask.object.position.copy(dev);
        mask.object.quaternion.copy(q);
        // The bag, from the valve, squeezed by the other hand.
        const s = squeeze(t);
        bag.object.position.set(0, 0, VALVE);
        bag.object.quaternion.setFromUnitVectors(along.set(0, 1, 0), BAG_AXIS);
        bag.object.scale.set(1 - 0.45 * s, 1, 1 - 0.45 * s);
        // Mask hand (left, arm 1): palm over the mask, fingers down the face towards the chin and jaw.
        p1.set(-0.012, -0.008, 0.035 + 0.04).applyQuaternion(q).add(dev);
        fingers.set(0, -1, -0.5).applyQuaternion(q);
        into.set(0, 0, -1).applyQuaternion(q);
        reach(r, 1, p1, fingers, into, 1);
        // Bag hand (right, arm 0): round the top of the bag's middle, pressing in as it squeezes.
        along.copy(BAG_AXIS).applyQuaternion(q);
        p1.set(0, 0, VALVE).applyQuaternion(q).add(dev).addScaledVector(along, 0.13);
        fingers.set(0, 0, -1);
        into.copy(along).multiplyScalar(-along.y).add(UP).normalize().negate();
        p1.addScaledVector(into, -(BAG_R * 0.95 * (1 - 0.45 * s) + 0.012));
        reach(r, 0, p1, fingers, into, 1);
      },
      camera: { target: [-0.45, 0.35, 0], yaw: 0.6, pitch: 0.55, extent: 1.7, span: 1.7 },
      keys: [0.1, 1.7, 2.6],
    }),
  },
};
