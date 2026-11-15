// V08 press with a cloth. Her description: "Presses a cloth on a wound without
// letting go." One figure. The free hand brings a folded cloth down onto the
// wound, presses it flat with the palm, and keeps pressing: the hand never
// lifts. An arrow over the hand shows the press going in; a ring marks the
// wound under the cloth.
//
// Not stated, so kept neutral and asked (questions): where the wound is (the
// forearm here, as in V14), and whether it is the person's own wound or
// someone else's (her list draws one character unless it says otherwise, so
// it is the person's own). Nothing about how hard, how long, or raising the
// limb is drawn.
//
// The loop does not come back (the hand does not let go): the last half
// second dissolves into the next round.

import * as THREE from 'three';
import { Prop, cycle, gesture, ramp, reach, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { basis, floatRoot, standFeet, standRoot } from './V17-kit.ts';
import { forearmSpot, spot } from './V14-arm.ts';

const T = 3.2;
/** The cloth lands, then the press goes in and is held. */
const DOWN_A = 0.2, DOWN_B = 0.95;
const PRESS_A = 1.0, PRESS_B = 1.3;
/** How far the palm presses in (metres): the cloth and the skin give a little. */
const DEPTH = 0.006;

/** The folded cloth, in its own frame: y out of the skin, z along the forearm, x across it; it bends over the arm. */
const HX = 0.065, HZ = 0.075, TH = 0.016, SAG = 4.5;
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
    pen.seg(-HX * 0.4, TH + sag(HX * 0.4) + 0.001, -HZ, -HX * 0.4, TH + sag(HX * 0.4) + 0.001, HZ);
  }, { strength: 1, width: 2, boxes: [[-HX * 0.6, -0.004, -HZ, HX * 0.6, TH, HZ]] });
}

const s = spot(), q = new THREE.Quaternion(), tip = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
const at = new THREE.Vector3(), palm = new THREE.Vector3(), fingers = new THREE.Vector3(), into = new THREE.Vector3();
const ring = new THREE.Vector3(), from = new THREE.Vector3(), to = new THREE.Vector3();

/** The figure: the hurt forearm (arm 0, the right) held out in front, bent at the elbow; the other hand is laid on by `reach`. */
function person(gravity: Gravity): Moves {
  return {
    root: gravity === 'weightless' ? floatRoot(T) : standRoot(T),
    turn: cycle([[0, [0.04, 0.03, 0]]], T),
    chest: track([[0, [0.1, 0.06, 0], 'still'], [PRESS_A, [0.1, 0.06, 0]], [PRESS_B, [0.14, 0.08, 0], 'still'], [T, [0.14, 0.08, 0], 'still']]),
    // The head looks at the wound throughout; a small nod as the press goes in.
    head: track([[0, [0.45, -0.12, 0], 'still'], [PRESS_A, [0.46, -0.12, 0]], [PRESS_B + 0.2, [0.5, -0.12, 0], 'still'], [T, [0.5, -0.12, 0], 'still']]),
    hands: [cycle([[0, [-0.07, 0.11, 0.43]], [T / 2, [-0.07, 0.112, 0.432]]], T), track([[0, [0.2, 0.25, 0.32]]])],
    elbows: [cycle([[0, [-0.7, -1, -0.2]]], T), cycle([[0, [1, -0.5, -0.3]]], T)],
    overlap: 0.3,
  };
}

function clip(world: World, gravity: Gravity) {
  return gesture(world, {
    duration: T,
    loop: 'seam',
    gravity,
    cast: [{ moves: person(gravity) }],
    props: (w) => [cloth(w)],
    marks: { contacts: 1, arrows: 1 },
    act: (t, [f]: Figure[], [c], marks) => {
      if (gravity === 'gravity') standFeet(f);
      forearmSpot(f, s);
      const h = 0.12 * (1 - ramp(t, DOWN_A, DOWN_B));
      const p = DEPTH * ramp(t, PRESS_A, PRESS_B);
      // Comes in from above and from the hand's side, tipped, and lands flat.
      at.copy(s.at).addScaledVector(s.up, h - p).addScaledVector(s.across, -0.5 * h).addScaledVector(s.along, -0.15 * h);
      basis(q, s.up, s.along);
      q.multiply(tip.setFromAxisAngle(zAxis, -2.2 * h));
      c.object.position.copy(at);
      c.object.quaternion.copy(q);
      // The palm flat on top of the cloth, fingers along the arm towards the wrist; it never lets go.
      palm.set(0, TH + 0.002, 0).applyQuaternion(q).add(at);
      fingers.set(-0.2, 0, 1).applyQuaternion(q);
      into.set(0, -1, 0).applyQuaternion(q);
      reach(f, 1, palm, fingers, into, 1);
      if (!marks) return;
      const on = ramp(t, DOWN_B - 0.1, DOWN_B + 0.1);
      ring.copy(s.at).addScaledVector(s.up, 0.004);
      marks.contacts[0].show(ring, 0.055, 0.6 * on, on * (1 - ramp(t, DOWN_B + 0.1, DOWN_B + 0.5)));
      // The press: an arrow above the back of the hand, pointing into the arm, pulsing slowly.
      const beat = 0.75 + 0.25 * Math.cos(((t - PRESS_A) / 1.0) * Math.PI * 2);
      from.copy(s.at).addScaledVector(s.up, 0.27);
      to.copy(s.at).addScaledVector(s.up, 0.135 + 0.015 * (1 - beat));
      marks.arrows[0].show(from, to, 0.03, ramp(t, PRESS_A - 0.1, PRESS_A + 0.2) * beat);
    },
    camera: { target: [-0.06, 1.33, 0.27], yaw: -1.3, pitch: 0.3, extent: 0.92, span: 0.92 },
    keys: [0.2, 1.6],
  });
}

export const v08: Move = {
  id: 'V08',
  name: 'V08-press-with-a-cloth',
  summary: 'Presses a cloth on a wound without letting go.',
  params: {},
  medical: true,
  reviewed: false,
  questions: [
    'V08: where is the wound? (The animation uses the forearm as a placeholder.)',
    'V08: is it the person pressing on their own wound, or someone pressing on another person\'s wound? (The animation shows one person, their own forearm.)',
  ],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
