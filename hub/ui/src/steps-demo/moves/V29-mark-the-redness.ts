// V29 mark the redness. Her description: "Draws around a red area of skin with
// a pen." One figure. The left hand holds a pen, brings its tip down beside a
// red area on the skin, draws once round it, and lifts the pen away. The line
// it drew stays a moment, then fades, so the loop starts again clean.
//
// The red area is shown as a soft glow on the skin (the animation has no
// colour); the pen's line runs a little outside it. Not stated, so kept
// neutral and asked (questions): where on the body the red area is. The right
// forearm is a placeholder, as in V08 and V14. Nothing about how big, how
// often, or what is written beside the line is drawn.

import * as THREE from 'three';
import { Prop, cycle, gesture, ramp, reach, smooth } from '../gesture.ts';
import type { Figure } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { basis, standFeet } from './V17-kit.ts';
import { armMoves, forearmSpot, spot } from './V14-arm.ts';

const T = 3.2;
/** The pen comes down, draws round once, lifts, and the line fades. */
const DOWN_A = 0.15, DOWN_B = 0.55;
const DRAW_A = 0.55, DRAW_B = 2.05;
const UP_A = 2.05, UP_B = 2.45;
const FADE_A = 2.55, FADE_B = 3.05;
/** How high the pen hovers above the line before and after (metres, along the pen). */
const HOVER = 0.06;
/** The drawn line's radius, and how far past a full turn the pen goes. */
const RING = 0.037, OVER = 0.25;
/** The red area, inside the line. */
const RED = 0.017;
const N = 48;

/** A point of the line at angle `a`, on the forearm's flat top, in the line's own frame: y out of the skin, z along the arm. */
function linePoint(a: number, lift: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(RING * Math.cos(a), lift, RING * Math.sin(a));
}

/** The drawn line: a closed loop of N segments on the skin, revealed segment by segment. */
function ink(world: World): Prop {
  const v = new THREE.Vector3();
  return new Prop(world, (pen) => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= N; i++) { linePoint((i / N) * Math.PI * 2, 0.003, v); pts.push([v.x, v.y, v.z]); }
    pen.path(pts);
  }, { strength: 1, width: 2.6 });
}

/** The pen, along its own +y from the tip (y = 0) to the cap. */
const LEN = 0.135, PR = 0.0055;
function penProp(world: World): Prop {
  return new Prop(world, (pen) => {
    pen.seg(0, 0, 0, PR, 0.016, 0).seg(0, 0, 0, -PR, 0.016, 0).seg(0, 0, 0, 0, 0.016, PR).seg(0, 0, 0, 0, 0.016, -PR);
    for (const [x, z] of [[PR, 0], [-PR, 0], [0, PR], [0, -PR]]) pen.seg(x, 0.016, z, x, LEN, z);
    pen.circle(0, 0.016, 0, PR, 'xz', 10).circle(0, LEN, 0, PR, 'xz', 10).circle(0, LEN - 0.035, 0, PR, 'xz', 10);
  }, { strength: 1, width: 1.8, boxes: [[-PR * 0.8, 0.016, -PR * 0.8, PR * 0.8, LEN, PR * 0.8]] });
}

/** The pen's angle round the line: still before, once round while drawing, then a little back in the air so it ends where it began. */
function angle(t: number): number {
  if (t < DRAW_A) return 0;
  if (t < DRAW_B) return (Math.PI * 2 + OVER) * smooth((t - DRAW_A) / (DRAW_B - DRAW_A));
  return Math.PI * 2 + OVER * (1 - smooth((t - DRAW_B) / (T - DRAW_B)));
}

const s = spot(), q = new THREE.Quaternion(), pq = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
const tipL = new THREE.Vector3(), tip = new THREE.Vector3(), axis = new THREE.Vector3(), side = new THREE.Vector3();
const palm = new THREE.Vector3(), fingers = new THREE.Vector3(), into = new THREE.Vector3(), glow = new THREE.Vector3();

function clip(world: World, gravity: Gravity) {
  return gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: armMoves(gravity, T, { hand: cycle([[0, [0.16, 0.2, 0.36]]], T) }) }],
    props: (w) => [penProp(w), ink(w)],
    marks: { contacts: 1 },
    act: (t, [f]: Figure[], [p, line], marks) => {
      if (gravity === 'gravity') standFeet(f);
      forearmSpot(f, s);
      basis(q, s.up, s.along);
      // The line lies on the skin round the spot.
      line.object.position.copy(s.at);
      line.object.quaternion.copy(q);
      const a = angle(t);
      const drawn = Math.min(1, a / (Math.PI * 2));
      (line.object.children[0] as unknown as { geometry: { instanceCount: number } }).geometry.instanceCount = t < DRAW_A ? 0 : Math.ceil(drawn * N);
      line.shown = t < DRAW_A ? 0 : 1 - ramp(t, FADE_A, FADE_B);
      // The pen: tilted back towards the hand's side (the figure's left) and a little towards the elbow.
      axis.copy(s.up).addScaledVector(s.across, -0.6).addScaledVector(s.along, -0.25).normalize();
      const h = HOVER * (1 - ramp(t, DOWN_A, DOWN_B) + ramp(t, UP_A, UP_B));
      linePoint(a, 0.003, tipL).applyQuaternion(q).add(s.at);
      tip.copy(tipL).addScaledVector(axis, h);
      p.object.position.copy(tip);
      pq.setFromUnitVectors(yAxis, axis);
      p.object.quaternion.copy(pq);
      // The hand holds the pen two thirds up, the palm against it from the outside, fingers down the pen.
      side.copy(s.across).negate();
      side.addScaledVector(axis, -side.dot(axis)).normalize();
      palm.copy(tip).addScaledVector(axis, 0.07).addScaledVector(side, 0.016);
      fingers.copy(axis).negate().addScaledVector(s.along, 0.5).normalize();
      into.copy(side).negate();
      reach(f, 1, palm, fingers, into, 1);
      if (marks) {
        // The red area: a soft glow on the skin inside the line.
        glow.copy(s.at).addScaledVector(s.up, 0.003);
        marks.contacts[0].show(glow, RED, 0.42, 1);
      }
    },
    camera: { target: [-0.08, 1.14, 0.33], yaw: -1.5, pitch: 0.95, extent: 0.66, span: 0.66 },
    keys: [0.3, 1.3, 2.3],
  });
}

export const v29: Move = {
  id: 'V29',
  name: 'V29-mark-the-redness',
  summary: 'Draws around a red area of skin with a pen.',
  params: {},
  medical: true,
  reviewed: false,
  questions: [
    'V29: where on the body is the red area? (The animation uses the forearm as a placeholder, as in V08 and V14.)',
  ],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
