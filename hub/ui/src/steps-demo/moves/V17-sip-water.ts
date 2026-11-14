// V17 sip water. Her description: "Drinks from a pouch with a straw, small
// sips." One figure holds a drink pouch in the right hand, brings it up until
// the straw is at the mouth, takes one small sip, lowers it a little and
// swallows; the loop repeats the sip. The pouch never leaves the hand, and no
// liquid is drawn.
//
// The pouch is the master: its pose is worked out first (at rest in front of
// the chest, or with the straw's tip exactly on the mouth), and the hand is
// laid on its side with `reach`, so the grip never slips.
//
// Weightless: the figure floats, the free arm drifting up a little in front.
// With gravity: standing on the floor, the free arm hangs.

import * as THREE from 'three';
import { HEAD, Prop, cycle, gesture, reach, sample1 } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { CLOSE, MOUTH, basis, floatRoot, standFeet, standRoot } from './V17-kit.ts';

const T = 3.2;

/** The pouch, in its own frame: broad faces towards ±x, top +y, straw bending back towards -z (the face). */
const W = 0.016, H0 = -0.085, H1 = 0.06, D = 0.05;
const TIP = new THREE.Vector3(0, 0.15, -0.055);

function pouch(world: World): Prop {
  return new Prop(world, (pen) => {
    pen.box(-W, H0, -D, W, H1, D);
    pen.seg(-W, H1 - 0.012, -D, -W, H1 - 0.012, D).seg(W, H1 - 0.012, -D, W, H1 - 0.012, D);
    pen.box(-0.007, H1, -0.008, 0.007, H1 + 0.012, 0.008);
    pen.path([[0, H1 + 0.012, -0.002], [0, 0.128, -0.008], [TIP.x, TIP.y, TIP.z]]);
    pen.path([[0.004, H1 + 0.012, -0.002], [0.004, 0.128, -0.008], [TIP.x + 0.004, TIP.y, TIP.z]]);
  }, { strength: 1, width: 2, boxes: [[-W, H0, -D, W, H1, D]] });
}

/** How far into the sip (0: pouch at rest in front of the chest, 1: straw on the mouth). */
const sip = cycle([[0, 0, 'still'], [0.78, 1, 'still'], [1.62, 1, 'still'], [2.25, 0.08], [2.7, 0, 'still']], T);
/** The pouch's tilt (top towards the face) while sipping: a little more as the sip is taken. */
const tilt = cycle([[0, -0.06, 'still'], [0.78, 0.26], [1.2, 0.33, 'still'], [1.62, 0.3], [2.25, 0.0], [2.7, -0.06, 'still']], T);

function person(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  return {
    root: floating ? floatRoot(T) : standRoot(T),
    turn: cycle([[0, [0, 0.02, 0]], [T / 2, [0, 0.03, 0]]], T),
    chest: cycle([[0, [0.03, 0, 0], 'still'], [0.7, [0.07, 0.03, 0]], [1.5, [0.06, 0.03, 0], 'still'], [2.4, [0.03, 0, 0], 'still']], T),
    // Leans in to the straw (anticipation), stays for the sip, then a small nod as it swallows.
    head: cycle([[0, [0.02, 0, 0], 'still'], [0.6, [0.08, 0.02, 0]], [0.85, [0.05, 0.02, 0], 'still'], [1.6, [0.04, 0.02, 0]], [1.95, [0.12, 0, 0]], [2.3, [0.0, 0, 0]], [2.75, [0.02, 0, 0], 'still']], T),
    hands: [
      floating ? cycle([[0, [-0.3, 0.06, 0.24]], [T / 2, [-0.305, 0.085, 0.26]]], T) : cycle([[0, [-0.23, -0.15, 0.05]], [T / 2, [-0.232, -0.148, 0.055]]], T),
      cycle([[0, [0.12, 0.2, 0.3]]], T),
    ],
    elbows: [floating ? cycle([[0, [-0.7, -0.5, -1]]], T) : cycle([[0, [-0.3, 0, -1]]], T), cycle([[0, [0.9, -1, -0.3]]], T)],
    overlap: 0.4,
  };
}

const q = new THREE.Quaternion(), yb = new THREE.Vector3(), zb = new THREE.Vector3();
const mouth = new THREE.Vector3(), rest = new THREE.Vector3(), at = new THREE.Vector3(), fwd = new THREE.Vector3();
const grip = new THREE.Vector3(), into = new THREE.Vector3(), fingers = new THREE.Vector3();

function clip(world: World, gravity: Gravity) {
  return gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: person(gravity) }],
    props: (w) => [pouch(w)],
    act: (t, [f]: Figure[], [p]) => {
      if (gravity === 'gravity') standFeet(f);
      const k = sample1(sip, t);
      const a = sample1(tilt, t);
      // The pouch's turn: upright, its top tipped towards the face by a, turned with the body.
      f.bodyDir(0, Math.cos(a), -Math.sin(a), yb);
      f.bodyDir(0, Math.sin(a), Math.cos(a), zb);
      basis(q, yb, zb);
      // At rest: in front of the lower chest. Sipping: the straw's tip on the mouth.
      f.body(0.07, 0.2, 0.33, rest);
      f.restPoint(HEAD, MOUTH[0], MOUTH[1], MOUTH[2], mouth);
      at.copy(TIP).applyQuaternion(q);
      mouth.sub(at);
      at.copy(rest).lerp(mouth, k);
      // A small arc on the way up and down, not a straight slide.
      f.bodyDir(0, 0, 1, fwd);
      at.addScaledVector(fwd, 0.035 * Math.sin(Math.PI * k));
      p.object.position.copy(at);
      p.object.quaternion.copy(q);
      // The right hand holds it by its outer face, fingers along it.
      grip.set(W, -0.012, 0.004).applyQuaternion(q).add(at);
      into.set(-1, 0, 0).applyQuaternion(q);
      fingers.set(0, -0.15, 1).applyQuaternion(q);
      reach(f, 1, grip, fingers, into, 1);
    },
    camera: { target: CLOSE.target, yaw: -1.15, pitch: 0.08, extent: CLOSE.extent, span: CLOSE.span },
    keys: [0.2, 1.2, 2.0],
  });
}

export const v17: Move = {
  id: 'V17',
  name: 'V17-sip-water',
  summary: 'Drinks from a pouch with a straw, small sips.',
  params: {},
  medical: false,
  reviewed: false,
  questions: [],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
