// V21 saline nose spray. Her description: "Sprays saline into the nose." One
// figure holds a small spray bottle in the left hand (arm 1) in front of the
// chest, brings it up until the nozzle is at one nostril, gives one press (the
// bottle's body goes up onto the nozzle, which stays at the nostril), and
// lowers it again. The loop comes back to where it started. No mist is drawn.
//
// Not stated, so kept neutral and not drawn: which nostril (one, the left),
// how the head is held (upright, no tilt), the nozzle's aim (along the
// nostril, straight up and a little back), whether the other nostril is
// closed (it is not), and how many presses (one per loop).
//
// The bottle is the master: the nozzle's pose is worked out first, and the
// hand is laid on the bottle's side with `reach`, so the grip never slips.

import * as THREE from 'three';
import { HEAD, Prop, cycle, gesture, reach, sample1 } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { basis, floatRoot, standFeet, standRoot } from './V17-kit.ts';

const T = 3.0;

// The bottle, in its own frame: the nozzle points along +y; the nozzle's tip is at the origin.
const R = 0.017, BODY0 = -0.135, BODY1 = -0.05, COLLAR = -0.038, NOZ0 = -0.034;
/** How far the body goes up onto the nozzle when pressed (metres). */
const STROKE = 0.007;

function bottleBody(world: World): Prop {
  return new Prop(world, (pen) => {
    pen.circle(0, BODY0, 0, R, 'xz', 16).circle(0, BODY1, 0, R, 'xz', 16);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      pen.seg(R * Math.cos(a), BODY0, R * Math.sin(a), R * Math.cos(a), BODY1, R * Math.sin(a));
    }
    // The shoulder and the collar of the pump.
    pen.circle(0, COLLAR, 0, 0.011, 'xz', 14);
    pen.seg(-R, BODY1, 0, -0.011, COLLAR, 0).seg(R, BODY1, 0, 0.011, COLLAR, 0);
    pen.seg(0, BODY1, -R, 0, COLLAR, -0.011).seg(0, BODY1, R, 0, COLLAR, 0.011);
  }, { strength: 1, width: 2, boxes: [[-R * 0.75, BODY0, -R * 0.75, R * 0.75, BODY1, R * 0.75]] });
}

function bottleNozzle(world: World): Prop {
  return new Prop(world, (pen) => {
    // A short tapered nozzle, its wide end resting on the collar.
    pen.circle(0, NOZ0, 0, 0.008, 'xz', 12).circle(0, -0.004, 0, 0.0035, 'xz', 10);
    pen.seg(-0.008, NOZ0, 0, -0.0035, -0.004, 0).seg(0.008, NOZ0, 0, 0.0035, -0.004, 0);
    pen.seg(0, NOZ0, -0.008, 0, -0.004, -0.0035).seg(0, NOZ0, 0.008, 0, -0.004, 0.0035);
  }, { strength: 1, width: 1.8 });
}

/** The left nostril (the figure's +x side), in rest coordinates: under the tip of the nose. */
const NOSTRIL: [number, number, number] = [0.011, 1.646, 0.084];
/** The nozzle's tip goes this far in along its axis. */
const IN = 0.006;

/** 0: the bottle at rest in front of the chest; 1: the nozzle at the nostril. */
const up = cycle([[0, 0, 'still'], [0.25, 0.02], [0.95, 1, 'still'], [1.85, 1, 'still'], [2.55, 0, 'still']], T);
/** The press: the body goes up onto the nozzle and comes back. */
const press = cycle([[0, 0, 'still'], [1.2, 0, 'still'], [1.36, 1, 'still'], [1.5, 1, 'still'], [1.66, 0, 'still']], T);

function person(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  return {
    root: floating ? floatRoot(T) : standRoot(T),
    turn: cycle([[0, [0, 0.02, 0]], [T / 2, [0, 0.03, 0]]], T),
    chest: cycle([[0, [0.03, 0, 0], 'still'], [0.9, [0.05, 0.02, 0]], [1.85, [0.05, 0.02, 0], 'still'], [2.5, [0.03, 0, 0], 'still']], T),
    // The head stays upright; it only settles a little as the nozzle arrives and as the press is given.
    head: cycle([[0, [0.03, 0, 0], 'still'], [0.9, [0.0, 0, 0]], [1.15, [0.01, 0, 0], 'still'], [1.36, [0.025, 0, 0]], [1.7, [0.01, 0, 0], 'still'], [2.5, [0.03, 0, 0], 'still']], T),
    hands: [
      floating ? cycle([[0, [-0.3, 0.06, 0.24]], [T / 2, [-0.305, 0.085, 0.26]]], T) : cycle([[0, [-0.23, -0.15, 0.05]], [T / 2, [-0.232, -0.148, 0.055]]], T),
      cycle([[0, [0.12, 0.2, 0.3]]], T),
    ],
    elbows: [floating ? cycle([[0, [-0.7, -0.5, -1]]], T) : cycle([[0, [-0.3, 0, -1]]], T), cycle([[0, [1, -1, -0.2]]], T)],
    overlap: 0.4,
  };
}

const q = new THREE.Quaternion(), yb = new THREE.Vector3(), zb = new THREE.Vector3();
const nostril = new THREE.Vector3(), rest = new THREE.Vector3(), tipAt = new THREE.Vector3(), fwd = new THREE.Vector3();
const bodyAt = new THREE.Vector3(), grip = new THREE.Vector3(), into = new THREE.Vector3(), fingers = new THREE.Vector3();
const ring = new THREE.Vector3(), restY = new THREE.Vector3(), restZ = new THREE.Vector3(), qRest = new THREE.Quaternion(), qUp = new THREE.Quaternion();

function clip(world: World, gravity: Gravity) {
  return gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: person(gravity) }],
    props: (w) => [bottleBody(w), bottleNozzle(w)],
    marks: { contacts: 1 },
    act: (t, [f]: Figure[], [body, nozzle], marks) => {
      if (gravity === 'gravity') standFeet(f);
      const k = sample1(up, t);
      const p = sample1(press, t);
      // At the nose: the nozzle along the nostril, up and a little back, turned with the head.
      f.restPoint(HEAD, NOSTRIL[0], NOSTRIL[1], NOSTRIL[2], nostril);
      yb.set(0, 0.94, -0.34).applyQuaternion(f.q[HEAD]);
      zb.set(0, 0.34, 0.94).applyQuaternion(f.q[HEAD]);
      basis(qUp, yb, zb);
      // At rest: upright in front of the lower chest, a little to the left.
      f.bodyDir(0, 1, 0, restY);
      f.bodyDir(0, 0, 1, restZ);
      basis(qRest, restY, restZ);
      q.copy(qRest).slerp(qUp, k);
      f.body(0.07, 0.3, 0.3, rest);
      tipAt.copy(nostril).addScaledVector(yb, IN);
      tipAt.lerp(rest, 1 - k);
      // A small arc outwards on the way up and down.
      f.bodyDir(0, 0, 1, fwd);
      tipAt.addScaledVector(fwd, 0.04 * Math.sin(Math.PI * k));
      nozzle.object.position.copy(tipAt);
      nozzle.object.quaternion.copy(q);
      // The body goes up onto the nozzle by the stroke when pressed.
      fwd.set(0, 1, 0).applyQuaternion(q);
      bodyAt.copy(tipAt).addScaledVector(fwd, STROKE * p);
      body.object.position.copy(bodyAt);
      body.object.quaternion.copy(q);
      // The left hand holds the body by its outer (+x) side, fingers up along it.
      grip.set(R, -0.1, 0).applyQuaternion(q).add(bodyAt);
      into.set(-1, 0, 0).applyQuaternion(q);
      fingers.set(0, 1, 0.35).applyQuaternion(q);
      reach(f, 1, grip, fingers, into, 1);
      if (!marks) return;
      ring.copy(nostril);
      marks.contacts[0].show(ring, 0.018, 0.75 * p, p);
    },
    camera: { target: [0.04, 1.46, 0.14], yaw: -1.4, pitch: 0.08, extent: 0.78, span: 0.78 },
    keys: [0.2, 1.4, 2.2],
  });
}

export const v21: Move = {
  id: 'V21',
  name: 'V21-saline-nose-spray',
  summary: 'Sprays saline into the nose.',
  params: {},
  medical: true,
  reviewed: false,
  questions: [],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
