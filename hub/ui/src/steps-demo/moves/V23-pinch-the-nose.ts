// V23 pinch the nose. Her description: "Sits leaning forward and pinches the
// soft part of the nose; collects the blood with gauze." One figure, leaning
// forward, the right hand (arm 0) held on the soft part of the nose, below
// the bony bridge, the whole loop; the left hand (arm 1) holds a gauze pad
// under the chin and dabs it up to just under the nose and back. Two rings mark the
// two sides of the soft part where the pinch presses. No blood is drawn.
// The pinch is held, so the loop is the held pose with its breathing and the
// gauze's dabs, and it comes back to where it started.
//
// With gravity: sitting on a stool, feet on the floor. Weightless: there is
// no sitting, so the figure floats in the neutral float, knees up, leaning
// forward the same way. (Her V02 answer puts a still person's feet in a foot
// loop or a hand on a handrail; here both hands are busy, and she did not say
// for V23, so no hold is drawn.)
//
// Not stated, so kept neutral: which hand pinches (the right), how far forward
// the lean is (a moderate lean of the trunk, head a little down), and where
// the gauze is held (under the chin). The hands are mitts, so the thumb and
// finger of the pinch are not drawn apart: the hand lies across the front of
// the soft part of the nose.

import * as THREE from 'three';
import { HEAD, Prop, cycle, gesture, plant, reach, sample1 } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { basis } from './V17-kit.ts';

const T = 3.2;
const SEAT = 0.46;

/** The gauze pad, a small folded square, in its own frame: flat in x-z, y up. */
const G = 0.05, GT = 0.01;
function gauze(world: World): Prop {
  return new Prop(world, (pen) => {
    pen.box(-G, 0, -G, G, GT, G);
    pen.seg(-G, GT, 0, G, GT, 0);
  }, { strength: 1, width: 1.8, boxes: [[-G, 0, -G, G, GT, G]] });
}

function stool(world: World): Prop {
  return new Prop(world, (pen) => {
    pen.box(-0.2, SEAT - 0.04, -0.3, 0.2, SEAT, 0.08);
    for (const [x, z] of [[-0.17, -0.27], [0.17, -0.27], [-0.17, 0.05], [0.17, 0.05]]) pen.seg(x, 0, z, x, SEAT - 0.04, z);
  }, { strength: 0.55, boxes: [[-0.2, SEAT - 0.04, -0.3, 0.2, SEAT, 0.08]] });
}

/** The soft part of the nose, in rest coordinates: the front of the nose, below the bony bridge. */
const SOFT: [number, number, number] = [0, 1.648, 0.098];
/** Its two sides, where the pinch presses (for the rings). */
const SIDE = (s: number): [number, number, number] => [s * 0.016, 1.649, 0.09];

/** The gauze: 0 under the chin, 1 up at the upper lip; two dabs a loop. */
const dab = cycle([[0, 0, 'still'], [0.45, 0, 'still'], [0.8, 1, 'still'], [1.05, 1, 'still'], [1.4, 0, 'still'], [2.05, 0, 'still'], [2.4, 1, 'still'], [2.65, 1, 'still'], [3.0, 0, 'still']], T);

function person(gravity: Gravity): Moves {
  const sitting = gravity === 'gravity';
  return {
    // Breathing, slow and small, while the pose is held.
    root: sitting ? cycle([[0, [0, 0.585, -0.06]], [0.8, [0, 0.592, -0.06]], [1.6, [0, 0.585, -0.06]], [2.4, [0, 0.592, -0.06]]], T) : cycle([[0, [0, 0.98, 0]], [0.8, [0, 0.987, 0.002]], [1.6, [0, 0.98, 0.004]], [2.4, [0, 0.987, 0.002]]], T),
    // Leaning forward: the trunk tips forward at the hips, the head a little down.
    turn: cycle([[0, [0, sitting ? 0.22 : 0.18, 0]]], T),
    chest: cycle([[0, [0.22, 0, 0]], [T / 2, [0.24, 0, 0]]], T),
    head: cycle([[0, [0.12, 0, 0], 'still'], [0.8, [0.14, 0.02, 0]], [1.6, [0.12, 0, 0], 'still'], [2.4, [0.14, -0.02, 0]]], T),
    elbows: [cycle([[0, [-0.8, -1, -0.2]]], T), cycle([[0, [0.9, -1, -0.1]]], T)],
    overlap: 0.3,
  };
}

const q = new THREE.Quaternion(), yb = new THREE.Vector3(), zb = new THREE.Vector3();
const soft = new THREE.Vector3(), fingers = new THREE.Vector3(), into = new THREE.Vector3();
const low = new THREE.Vector3(), high = new THREE.Vector3(), at = new THREE.Vector3(), grip = new THREE.Vector3();
const ring = new THREE.Vector3(), spot = new THREE.Vector3(), toes = new THREE.Vector3(0, 0, 1), floorUp = new THREE.Vector3(0, 1, 0);

function clip(world: World, gravity: Gravity) {
  const sitting = gravity === 'gravity';
  return gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: person(gravity) }],
    props: (w) => sitting ? [gauze(w), stool(w)] : [gauze(w)],
    marks: { contacts: 2 },
    act: (t, [f]: Figure[], [pad, seat], marks) => {
      if (sitting) {
        for (let l = 0; l < 2; l++) plant(f, l, spot.set((l === 0 ? -1 : 1) * 0.12, 0, 0.22), toes, floorUp, 1);
        seat.at(0, 0, 0);
      }
      // The right hand across the front of the soft part of the nose: palm to the nose, fingers across towards the left.
      f.restPoint(HEAD, SOFT[0], SOFT[1], SOFT[2], soft);
      fingers.set(1, 0.2, 0).applyQuaternion(f.q[HEAD]);
      into.set(0, 0, -1).applyQuaternion(f.q[HEAD]);
      reach(f, 0, soft, fingers, into, 1);
      // The gauze, flat, under the chin; dabbing up to just under the pinching hand and back.
      const k = sample1(dab, t);
      f.restPoint(HEAD, 0, 1.535, 0.13, low);
      f.restPoint(HEAD, 0, 1.578, 0.125, high);
      at.copy(low).lerp(high, k);
      yb.set(0, 1, 0).applyQuaternion(f.q[HEAD]);
      zb.set(0, 0, 1).applyQuaternion(f.q[HEAD]);
      basis(q, yb, zb);
      pad.object.position.copy(at);
      pad.object.quaternion.copy(q);
      // The left hand holds the pad from below, fingers forward under it.
      grip.set(0.01, -0.001, -0.02).applyQuaternion(q).add(at);
      fingers.set(-0.35, 0, 1).applyQuaternion(q);
      into.set(0, 1, 0).applyQuaternion(q);
      reach(f, 1, grip, fingers, into, 1);
      if (!marks) return;
      for (let i = 0; i < 2; i++) {
        const s = SIDE(i === 0 ? -1 : 1);
        f.restPoint(HEAD, s[0], s[1], s[2], ring);
        marks.contacts[i].show(ring, 0.014, 0.75, 0.5 + 0.5 * Math.cos((t / T) * Math.PI * 4));
      }
    },
    camera: sitting
      ? { target: [0.0, 0.86, 0.1], yaw: 1.2, pitch: 0.12, extent: 1.6, span: 1.6 }
      : { target: [0.0, 1.22, 0.15], yaw: 1.2, pitch: 0.12, extent: 1.2, span: 1.2 },
    keys: [0.2, 0.9],
  });
}

export const v23: Move = {
  id: 'V23',
  name: 'V23-pinch-the-nose',
  summary: 'Sits leaning forward and pinches the soft part of the nose; collects the blood with gauze.',
  params: {},
  medical: true,
  reviewed: false,
  questions: [],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
