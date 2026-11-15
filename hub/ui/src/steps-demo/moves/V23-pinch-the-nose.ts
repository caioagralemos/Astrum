// V23 pinch the nose. Her description: "Sits leaning forward and pinches the
// soft part of the nose; collects the blood with gauze." She has not answered
// anything more for V23, so only that is drawn:
//
// - Sits, leaning forward: the trunk tips forward and the head goes forward,
//   chin towards the chest (never back). With gravity she sits; no seat is
//   drawn, because the camera is close on the head, shoulders and pinching arm.
//   Weightless: there is no sitting, so the body floats in the neutral float
//   with the same lean; the legs are out of the picture.
// - Pinches the soft part of the nose: the rig's hand is a single mitt, so the
//   thumb and forefinger are two short finger segments (V23Finger, below) from
//   the right hand (arm 0) that close on the two sides of the soft lower part
//   of the nose, below the bridge. Two small rings mark where they press, and
//   two small arrows show them closing.
// - Collects the blood with gauze: the one prop, a gauze pad held by the left
//   hand just under the nostrils, clear of the pinching hand. No blood is drawn.
//
// The loop: the hand comes the last few centimetres up, the fingers close,
// they hold for most of the loop, then open a little and the hand eases back
// to where it started. Calm, with slow breathing.
//
// Not stated, so kept neutral: which hand pinches (the right), how far forward
// the lean is (moderate), and where the gauze is held (under the nostrils).

import * as THREE from 'three';
import { HEAD, Prop, cycle, gesture, plant, reach, sample1 } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { basis } from './V17-kit.ts';

const T = 3.2;

/** The gauze pad, a small folded square, in its own frame: flat in x-z, y up. */
const G = 0.04, GT = 0.008;
function gauze(world: World): Prop {
  return new Prop(world, (pen) => {
    pen.box(-G, 0, -G, G, GT, G);
    pen.seg(-G, GT, 0, G, GT, 0);
  }, { strength: 1, width: 1.8, boxes: [[-G, 0, -G, G, GT, G]] });
}

/** One finger of the pinch: a slim block 1 m long along +z, scaled to length each frame. */
const FW = 0.009;
function V23Finger(world: World): Prop {
  return new Prop(world, (pen) => {
    pen.box(-FW, -FW, 0, FW, FW, 1);
  }, { strength: 1, width: 1.8, boxes: [[-FW, -FW, 0, FW, FW, 1]] });
}

/** The pinch: 0 open (hand a few cm off), 1 closed on the nose. Held for most of the loop. */
const pinch = cycle([[0, 0, 'still'], [0.55, 1, 'still'], [2.55, 1, 'still']], T);

function person(gravity: Gravity): Moves {
  const sitting = gravity === 'gravity';
  return {
    // Breathing, slow and small, while the pose is held.
    root: sitting
      ? cycle([[0, [0, 0.585, -0.06]], [0.8, [0, 0.59, -0.06]], [1.6, [0, 0.585, -0.06]], [2.4, [0, 0.59, -0.06]]], T)
      : cycle([[0, [0, 0.98, 0]], [0.8, [0, 0.985, 0]], [1.6, [0, 0.98, 0]], [2.4, [0, 0.985, 0]]], T),
    // Leaning forward: the trunk tips forward at the hips, the head forward, chin to the chest.
    turn: cycle([[0, [0, 0.3, 0]]], T),
    chest: cycle([[0, [0.18, 0, 0]], [T / 2, [0.2, 0, 0]]], T),
    head: cycle([[0, [0.26, 0, 0]]], T),
    elbows: [cycle([[0, [-1, -1, -0.3]]], T), cycle([[0, [1, -1, -0.2]]], T)],
    overlap: 0.3,
  };
}

const q = new THREE.Quaternion(), yb = new THREE.Vector3(), zb = new THREE.Vector3();
const palm = new THREE.Vector3(), fingers = new THREE.Vector3(), into = new THREE.Vector3();
const at = new THREE.Vector3(), grip = new THREE.Vector3(), base = new THREE.Vector3(), tip = new THREE.Vector3();
const from = new THREE.Vector3(), dir = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1);
const spot = new THREE.Vector3(), toes = new THREE.Vector3(0, 0, 1), floorUp = new THREE.Vector3(0, 1, 0);

/** Lay a finger from `a` to `b`. */
function lay(finger: Prop, a: THREE.Vector3, b: THREE.Vector3) {
  dir.subVectors(b, a);
  const len = dir.length();
  finger.object.position.copy(a);
  finger.object.quaternion.setFromUnitVectors(zAxis, dir.multiplyScalar(1 / len));
  finger.object.scale.set(1, 1, len);
}

/** The soft part of the nose, in rest coordinates (head): the lower part, below the bony bridge. */
const NOSE_Y = 1.642, NOSE_Z = 0.092;

function clip(world: World, gravity: Gravity) {
  const sitting = gravity === 'gravity';
  return gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: person(gravity) }],
    props: (w) => [gauze(w), V23Finger(w), V23Finger(w)],
    marks: { contacts: 2, arrows: 2 },
    act: (t, [f]: Figure[], [pad, thumb, index], marks) => {
      if (sitting) for (let l = 0; l < 2; l++) plant(f, l, spot.set((l === 0 ? -1 : 1) * 0.12, 0, 0.22), toes, floorUp, 1);
      const p = sample1(pinch, t);
      // The right hand beside the nose on its own side, palm in, fingers forward; a few cm lower and out when open.
      f.restPoint(HEAD, -0.062 - 0.02 * (1 - p), NOSE_Y - 0.03 * (1 - p), 0.15, palm);
      fingers.set(0.25, 0.1, 1).applyQuaternion(f.q[HEAD]);
      into.set(1, 0, 0).applyQuaternion(f.q[HEAD]);
      reach(f, 0, palm, fingers, into, 1);
      // Thumb and forefinger from the hand's front edge to the two sides of the soft part.
      const gap = 0.017 + 0.022 * (1 - p);
      f.restPoint(HEAD, -0.056 - 0.02 * (1 - p), NOSE_Y - 0.014 - 0.03 * (1 - p), 0.13, base);
      f.restPoint(HEAD, -gap, NOSE_Y, NOSE_Z - 0.008, tip);
      lay(thumb, base, tip);
      f.restPoint(HEAD, -0.05 - 0.02 * (1 - p), NOSE_Y + 0.008 - 0.03 * (1 - p), 0.178, base);
      f.restPoint(HEAD, gap, NOSE_Y, NOSE_Z - 0.008, tip);
      lay(index, base, tip);
      // The gauze, flat, just under the nostrils; the left hand holds it from below.
      f.restPoint(HEAD, 0.02, NOSE_Y - 0.05, 0.13, at);
      yb.set(0, 1, 0).applyQuaternion(f.q[HEAD]);
      zb.set(0, 0, 1).applyQuaternion(f.q[HEAD]);
      basis(q, yb, zb);
      pad.object.position.copy(at);
      pad.object.quaternion.copy(q);
      grip.set(0.02, -0.001, 0.0).applyQuaternion(q).add(at);
      fingers.set(-0.6, 0, 1).applyQuaternion(q);
      into.set(0, 1, 0).applyQuaternion(q);
      reach(f, 1, grip, fingers, into, 1);
      if (!marks) return;
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? -1 : 1;
        f.restPoint(HEAD, s * 0.017, NOSE_Y, NOSE_Z - 0.008, at);
        marks.contacts[i].show(at, 0.012, 0.8 * p, p);
        f.restPoint(HEAD, s * 0.06, NOSE_Y, NOSE_Z - 0.008, from);
        f.restPoint(HEAD, s * 0.032, NOSE_Y, NOSE_Z - 0.008, tip);
        // The arrows show the closing, then fade while the pinch is held.
        const closing = Math.max(0, Math.min(1, t / 0.3)) * Math.max(0, 1 - Math.max(0, t - 1.0) / 0.5);
        marks.arrows[i].show(from, tip, 0.012, 0.85 * closing);
      }
    },
    camera: sitting
      ? { target: [0, 1.04, 0.2], yaw: -0.55, pitch: -0.12, extent: 0.7, span: 0.7 }
      : { target: [0, 1.435, 0.26], yaw: -0.55, pitch: -0.12, extent: 0.7, span: 0.7 },
    keys: [1.4],
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
