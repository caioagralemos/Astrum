// V14 cold or warm cloth. Her description: "Puts a cloth on the sore spot."
// The right hand brings a folded cloth down onto a sore spot, holds it there
// with the palm flat, then lifts it again; the loop repeats the placing.
//
// Not stated, so kept neutral and asked (questions): which part of the body
// (the left forearm here is a placeholder), and whether the hand stays on the
// cloth. Weightless, a cloth let go of would drift off, so the hand never lets
// go in either variant; nothing about cold or warm is drawn.

import * as THREE from 'three';
import { Prop, cycle, gesture, ramp, reach, sample1 } from '../gesture.ts';
import type { Figure } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { standFeet, basis } from './V17-kit.ts';
import { ARM_CAMERA, armMoves, forearmSpot, spot } from './V14-arm.ts';

const T = 3.2;

/** The folded cloth, in its own frame: y out of the skin, z along the forearm, x across it; it bends a little over the arm. */
const HX = 0.06, HZ = 0.07, TH = 0.014, SAG = 4.5;
const sag = (x: number) => -SAG * x * x;
function cloth(world: World): Prop {
  return new Prop(world, (pen) => {
    const n = 8;
    for (const y0 of [0, TH]) for (const z of [-HZ, HZ]) {
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= n; i++) { const x = -HX + (2 * HX * i) / n; pts.push([x, y0 + sag(x), z]); }
      pen.path(pts);
    }
    for (const x of [-HX, HX]) for (const y0 of [0, TH]) pen.seg(x, y0 + sag(x), -HZ, x, y0 + sag(x), HZ);
    for (const x of [-HX, HX]) for (const z of [-HZ, HZ]) pen.seg(x, sag(x), z, x, TH + sag(x), z);
    // The fold, a line across the top.
    pen.seg(-HX * 0.4, TH + sag(HX * 0.4) + 0.001, -HZ, -HX * 0.4, TH + sag(HX * 0.4) + 0.001, HZ);
  }, { strength: 1, width: 2, boxes: [[-HX * 0.6, -0.004, -HZ, HX * 0.6, TH, HZ]] });
}

/** How far above the spot the cloth is (metres): held up, brought down, held on, lifted. */
const lift = cycle([[0, 0.12, 'still'], [0.4, 0.115], [1.0, 0, 'still'], [2.2, 0, 'still'], [2.85, 0.11]], T);
/** A gentle press while it is on (palm into the arm by a few millimetres). */
const press = cycle([[0, 0], [1.0, 0], [1.25, 0.004], [1.9, 0.003], [2.2, 0]], T);

const s = spot(), q = new THREE.Quaternion(), at = new THREE.Vector3(), palm = new THREE.Vector3(), fingers = new THREE.Vector3(), into = new THREE.Vector3();
const ring = new THREE.Vector3();

function clip(world: World, gravity: Gravity) {
  return gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: armMoves(gravity, T, { hand: cycle([[0, [0.2, 0.25, 0.32]]], T) }) }],
    props: (w) => [cloth(w)],
    marks: { contacts: 1 },
    act: (t, [f]: Figure[], [c], marks) => {
      if (gravity === 'gravity') standFeet(f);
      forearmSpot(f, s);
      const h = sample1(lift, t);
      const p = sample1(press, t);
      // Comes in from above and from the right (the hand's side), not straight down.
      at.copy(s.at).addScaledVector(s.up, h - p).addScaledVector(s.across, -0.5 * h).addScaledVector(s.along, -0.15 * h);
      basis(q, s.up, s.along);
      // Tipped a little while in the air, flat as it lands.
      q.multiply(tip.setFromAxisAngle(zAxis, -2.2 * h));
      c.object.position.copy(at);
      c.object.quaternion.copy(q);
      // The palm flat on top of the cloth, fingers across the arm.
      palm.set(0, TH + 0.002, 0).applyQuaternion(q).add(at);
      fingers.set(-1, 0, 0.25).applyQuaternion(q);
      into.set(0, -1, 0).applyQuaternion(q);
      reach(f, 1, palm, fingers, into, 1);
      if (marks) {
        ring.copy(s.at).addScaledVector(s.up, 0.004);
        const on = ramp(t, 0.85, 1.05);
        marks.contacts[0].show(ring, 0.05, 0.55 * (1 - on) + 0.5 * on * (1 - ramp(t, 1.3, 1.9)), on * (1 - ramp(t, 1.05, 1.5)));
      }
    },
    camera: ARM_CAMERA,
    keys: [0.2, 1.4],
  });
}
const tip = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);

export const v14: Move = {
  id: 'V14',
  name: 'V14-cold-or-warm-cloth',
  summary: 'Puts a cloth on the sore spot.',
  params: {},
  medical: true,
  reviewed: false,
  questions: [
    'V14: on which part of the body should the cloth go? (The animation uses the forearm as a placeholder.)',
    'V14: in no gravity a cloth floats away if let go. Should the hand keep holding the cloth on the spot the whole time?',
  ],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
