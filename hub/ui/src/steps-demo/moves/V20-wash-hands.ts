// V20 wash hands. Her description: "Washes the hands." One figure rubs the
// palms together in front of the body: the palms stay flat against each other
// and slide back and forth along the fingers, with a small circle. Five rubs
// per loop. No water, soap, sink or wipe is drawn: her line names none, and
// how hands are washed without gravity (no running water) is not stated.
//
// The rub is taken from a named public guideline: World Health Organization,
// "How to Handwash?" (WHO poster, 2009), step 2: "Rub hands palm to palm".
// Only that step is drawn (one gesture per animation); the other steps of the
// poster (backs of the hands, between the fingers, thumbs, fingertips) are not.
//
// Weightless: floating, knees up. With gravity: standing on the floor.

import * as THREE from 'three';
import { cycle, gesture, reach } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { floatRoot, standFeet, standRoot } from './V17-kit.ts';

const T = 3.2;
/** Rubs per loop (a whole number, so the loop closes). */
const RUBS = 5;
/** How far each palm slides along the fingers, and the small circle across them (metres). */
const SLIDE = 0.035, CIRCLE = 0.012;

function person(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  return {
    root: floating ? floatRoot(T) : standRoot(T),
    turn: cycle([[0, [0, 0.02, 0]], [T / 2, [0, 0.025, 0]]], T),
    chest: cycle([[0, [0.1, 0, 0]], [T / 2, [0.11, 0, 0]]], T),
    // Looks down at the hands.
    head: cycle([[0, [0.42, 0, 0]], [T / 2, [0.44, 0, 0]]], T),
    hands: [cycle([[0, [-0.05, 0.12, 0.3]]], T), cycle([[0, [0.05, 0.12, 0.3]]], T)],
    elbows: [cycle([[0, [-1, -0.8, 0]]], T), cycle([[0, [1, -0.8, 0]]], T)],
    overlap: 0.2,
  };
}

const mid = new THREE.Vector3(), fwd = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3();
const p = new THREE.Vector3(), fingers = new THREE.Vector3(), into = new THREE.Vector3();

function clip(world: World, gravity: Gravity) {
  return gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: person(gravity) }],
    act: (t, [f]: Figure[]) => {
      if (gravity === 'gravity') standFeet(f);
      // Where the palms meet: in front of the lower chest, in the body's middle plane.
      f.body(0, 0.25, 0.38, mid);
      // The fingers point forward and up; the palms face across (the body's x).
      f.bodyDir(0, 0.45, 0.89, fwd).normalize();
      f.bodyDir(1, 0, 0, right);
      up.crossVectors(fwd, right).negate();
      const w = (t / T) * Math.PI * 2 * RUBS;
      const s = SLIDE * Math.sin(w), c = CIRCLE * Math.cos(w);
      for (let a = 0; a < 2; a++) {
        // The two palms slide opposite ways along the fingers; both stay in the same plane.
        const k = a === 0 ? 1 : -1;
        p.copy(mid).addScaledVector(fwd, k * s).addScaledVector(up, k * c);
        fingers.copy(fwd);
        into.copy(right).multiplyScalar(a === 0 ? 1 : -1);
        reach(f, a, p, fingers, into, 1);
      }
    },
    camera: { target: [0, 1.4, 0.24], yaw: -1.1, pitch: 0.12, extent: 0.84, span: 0.84 },
    keys: [0, T / 4, T / 2],
  });
}

export const v20: Move = {
  id: 'V20',
  name: 'V20-wash-hands',
  summary: 'Washes the hands: rubs the palms together.',
  params: {},
  medical: false,
  reviewed: false,
  source: 'World Health Organization, "How to Handwash?" (poster, 2009), step 2: "Rub hands palm to palm". Only that step is drawn.',
  questions: [],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
