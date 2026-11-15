// V32 take off the dusty suit. Illustrates the dust storm card's step:
// "Take off clothes or suit with dust before going to the common area."
// Gesture named and described by the app's developer for the medical lead's step; awaiting her review.
//
// With gravity only (dust storms happen on a surface base). One person stands
// just inside a doorway (the one prop: the door frame, the outside beyond it
// on the person's +x side). Both hands take the suit top by its shoulders,
// lift it forward off the body, and the right hand holds it out at arm's
// length through the door, away from the room; a small arrow points from the
// garment further out. The garment is left outside (it fades), the arm comes
// back, and the next round starts with the suit top on again.
//
// The garment is drawn as a plain vest outline that leaves the torso. Nothing
// else is shown: no cleaning, no dust, nothing medical.

import * as THREE from 'three';
import { CHEST, Prop, cycle, gesture, ramp, reach, smooth } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Move } from '../step.ts';
import { standFeet, standRoot } from './V17-kit.ts';

const T = 3.4;

/** The door: a frame in a wall at x = DX (the wall runs along z), the opening 0.9 m wide and 2.0 m high. */
const DX = 0.44;
const DW = 0.5;
const DH = 2.0;
const J = 0.05;

/** The vest, in its own frame: the origin at the middle of the collar (rest point 0, 1.40, 0), front at +z. */
const COLLAR_Y = 1.4;
const F = 0.118;
const B = -0.105;
const VW = 0.168;
const VB = -0.42;
function vest(pen: Parameters<ConstructorParameters<typeof Prop>[1]>[0]) {
  pen.path([[-0.055, 0, F], [-0.15, -0.012, F], [-VW, -0.15, F], [-VW, VB, F], [VW, VB, F], [VW, -0.15, F], [0.15, -0.012, F], [0.055, 0, F], [0, -0.15, F], [-0.055, 0, F]]);
  pen.path([[-0.055, 0, B], [-0.15, -0.012, B], [-VW, -0.15, B], [-VW, VB, B], [VW, VB, B], [VW, -0.15, B], [0.15, -0.012, B], [0.055, 0, B], [-0.055, 0, B]]);
  for (const x of [-1, 1]) {
    pen.seg(x * 0.15, -0.012, F, x * 0.15, -0.012, B).seg(x * 0.055, 0, F, x * 0.055, 0, B);
    pen.seg(x * VW, VB, F, x * VW, VB, B).seg(x * VW, -0.15, F, x * VW, -0.15, B);
  }
}

// Where the vest is held: in front of the chest (both hands), then out through the door (the right hand).
const FRONT = new THREE.Vector3(0.0, 1.3, 0.36);
const OUT = new THREE.Vector3(0.6, 1.3, -0.02);
const UPRIGHT = new THREE.Quaternion();
const OUT_FINGERS = new THREE.Vector3(0.6, -0.8, 0);
const OUT_INTO = new THREE.Vector3(-0.3, -0.9, 0);

const person: Moves = {
  root: standRoot(T),
  turn: cycle([[0, [0, 0, 0], 'still'], [1.5, [0.04, 0.02, 0]], [2.1, [0.1, 0.02, 0], 'still'], [2.55, [0.1, 0.02, 0], 'still'], [3.1, [0, 0, 0], 'still']], T),
  chest: cycle([[0, [0.02, 0, 0], 'still'], [0.8, [0.1, 0, 0]], [1.4, [0.06, 0, 0]], [2.1, [0.03, 0.1, -0.03], 'still'], [2.55, [0.03, 0.1, -0.03], 'still'], [3.1, [0.02, 0, 0], 'still']], T),
  // Looks down at the suit top as the hands take it, then out at it, held through the door.
  head: cycle([[0, [0.05, 0, 0], 'still'], [0.7, [0.38, 0, 0]], [1.35, [0.3, 0, 0]], [2.05, [0.12, 0.6, 0], 'still'], [2.6, [0.12, 0.6, 0], 'still'], [3.15, [0.05, 0, 0], 'still']], T),
  hands: [
    cycle([[0, [-0.24, -0.16, 0.05], 'still'], [0.6, [-0.12, 0.3, 0.2]], [1.5, [-0.12, 0.25, 0.35]], [2.15, [-0.24, -0.16, 0.05], 'still']], T),
    cycle([[0, [0.24, -0.16, 0.05], 'still'], [0.6, [0.12, 0.3, 0.2]], [1.5, [0.14, 0.25, 0.35]], [2.05, [0.58, 0.3, 0.05], 'still'], [2.6, [0.58, 0.3, 0.05]], [3.15, [0.24, -0.16, 0.05], 'still']], T),
  ],
  elbows: [cycle([[0, [-0.3, 0, -1]], [1.0, [-1, -0.4, -0.4]], [2.1, [-0.3, 0, -1]]], T), cycle([[0, [0.3, 0, -1]], [1.0, [1, -0.4, -0.4]], [2.1, [0.3, -0.6, -0.4]], [3.1, [0.3, 0, -1]]], T)],
  overlap: 0.4,
};

const onBody = new THREE.Vector3(), pos = new THREE.Vector3(), quat = new THREE.Quaternion();
const grip = new THREE.Vector3(), fingers = new THREE.Vector3(), into = new THREE.Vector3();
const from = new THREE.Vector3(), to = new THREE.Vector3();

/** A point on the vest (its own frame) in the world, from where it is now. */
function onVest(x: number, y: number, z: number, out: THREE.Vector3) {
  return out.set(x, y, z).applyQuaternion(quat).add(pos);
}

export const v32: Move = {
  id: 'V32',
  name: 'V32-take-off-dusty-suit',
  summary: 'Standing just inside a door, takes the suit top off and holds it out through the door, away from the room.',
  params: {},
  medical: false,
  reviewed: false,
  source: 'Illustrates the dust storm card step "Take off clothes or suit with dust before going to the common area." Gesture named and described by the app\'s developer for the medical lead\'s step; awaiting her review.',
  questions: [],
  variants: {
    gravity: (world) => gesture(world, {
      duration: T,
      gravity: 'gravity',
      cast: [{ moves: person }],
      props: (w) => {
        const frame: [number, number, number, number, number, number][] = [
          [DX - J, 0, DW, DX + J, DH, DW + 0.08],
          [DX - J, 0, -DW - 0.08, DX + J, DH, -DW],
          [DX - J, DH, -DW - 0.08, DX + J, DH + 0.08, DW + 0.08],
        ];
        return [
          new Prop(w, (pen) => { for (const b of frame) pen.box(...b); }, { strength: 0.75, width: 1.6, boxes: frame }),
          new Prop(w, vest, { strength: 0.95, width: 1.8, boxes: [[-VW, VB, B, VW, -0.01, F]] }),
        ];
      },
      marks: { arrows: 1 },
      act: (t, [f]: Figure[], [, v], marks) => {
        standFeet(f);
        // Where the vest is: on the body, lifted off to the front, then out through the door.
        f.restPoint(CHEST, 0, COLLAR_Y, 0, onBody);
        const gone = t >= 2.8;
        const k1 = gone ? 0 : smooth(ramp(t, 0.85, 1.45));
        const k2 = gone ? 0 : smooth(ramp(t, 1.5, 2.05));
        pos.copy(onBody).lerp(FRONT, k1).lerp(OUT, k2);
        // Lifted a little as it comes off the shoulders.
        pos.y += 0.06 * Math.sin(Math.PI * k1);
        quat.copy(f.q[CHEST]).slerp(UPRIGHT, k1);
        v.object.position.copy(pos);
        v.object.quaternion.copy(quat);
        // Left outside: it fades while held out; the next round's starts on the body.
        v.shown = t < 2.5 ? 1 : t < 2.8 ? 1 - ramp(t, 2.5, 2.75) : ramp(t, 3.0, 3.4);

        // Both hands take it by the shoulders; the left lets go once it is off; the right holds it out.
        const take = ramp(t, 0.3, 0.75);
        const w0 = take * (1 - ramp(t, 1.5, 1.8));
        const w1 = take * (1 - ramp(t, 2.6, 2.95));
        fingers.set(0, -1, 0).applyQuaternion(quat);
        into.set(0, 0, -1).applyQuaternion(quat);
        reach(f, 0, onVest(-0.105, -0.02, F, grip), fingers, into, w0);
        // Held out at arm's length, the right hand takes it from above, by the shoulder seam.
        fingers.set(0, -1, 0).lerp(OUT_FINGERS, k2).normalize();
        into.set(0, 0, -1).lerp(OUT_INTO, k2).normalize();
        reach(f, 1, onVest(0.105, -0.02 + 0.04 * k2, F + (0.006 - F) * k2, grip), fingers.applyQuaternion(quat), into.applyQuaternion(quat), w1);

        if (!marks) return;
        // Held out: an arrow from the garment, away from the room.
        const a = ramp(t, 2.0, 2.2) * (1 - ramp(t, 2.5, 2.7));
        onVest(VW + 0.06, -0.24, 0, from);
        to.copy(from); to.x += 0.36;
        marks.arrows[0].show(from, to, 0.08, 0.9 * a);
      },
      camera: { target: [0.38, 1.06, 0.0], yaw: -0.22, pitch: 0.12, extent: 2.45, span: 2.45 },
      keys: [0.2, 1.3, 2.3],
    }),
  },
};
