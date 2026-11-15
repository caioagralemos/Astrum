// V16 bandage. Her description: "Covers a cut with a bandage." One figure.
// A ring marks the cut on the forearm. The left hand (arm 1) brings a sticky
// bandage strip down onto it, lays it along the arm over the cut, runs the palm
// along it once to press it on, and lifts away. To close the loop the strip on
// the arm fades out (the ring shows the cut again) while a new one fades in
// under the hand, which is back where it started.
//
// Not stated, so kept neutral and asked (questions): where the cut is (the
// forearm placeholder of V08 and V14), and what kind of bandage (a sticky strip
// here; a roll bandage wrapped round would be another gesture). Nothing about
// cleaning first, or about not touching the pad, is drawn.
//
// Weightless: floating. With gravity: standing on the floor.

import * as THREE from 'three';
import { Prop, cycle, gesture, ramp, reach, sample1 } from '../gesture.ts';
import type { Figure } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { basis, standFeet } from './V17-kit.ts';
import { ARM_CAMERA, armMoves, forearmSpot, spot } from './V14-arm.ts';

const T = 3.2;

/** The strip, in its own frame: y out of the skin, z along the forearm, x across it; it bends over the arm. */
const HX = 0.03, HZ = 0.06, TH = 0.006, PAD = 0.022, SAG = 1 / (2 * 0.05);
const sag = (x: number) => -SAG * x * x;
function strip(world: World): Prop {
  return new Prop(world, (pen) => {
    const n = 6;
    const across = (z: number, y0: number) => {
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= n; i++) { const x = -HX + (2 * HX * i) / n; pts.push([x, y0 + sag(x), z]); }
      pen.path(pts);
    };
    for (const z of [-HZ, HZ]) { across(z, 0); across(z, TH); }
    for (const x of [-HX, HX]) for (const y0 of [0, TH]) pen.seg(x, y0 + sag(x), -HZ, x, y0 + sag(x), HZ);
    // The pad in the middle: a smaller box on top, with a cross-hatch so it reads as a dressing.
    for (const z of [-PAD, PAD]) across(z, TH + 0.001);
    for (const x of [-HX * 0.6, HX * 0.6]) pen.seg(x, TH + sag(x) + 0.001, -PAD, x, TH + sag(x) + 0.001, PAD);
    for (let i = 1; i < 4; i++) { const z = -PAD + (2 * PAD * i) / 4; pen.seg(-HX * 0.6, TH + sag(HX * 0.6) + 0.001, z, HX * 0.6, TH + sag(HX * 0.6) + 0.001, z); }
  }, { strength: 1, width: 2, boxes: [[-HX * 0.6, -0.003, -HZ, HX * 0.6, TH, HZ]] });
}

/** How high the strip (and the hand) is over the cut: down onto it, held, then the hand lifts back up. */
const height = cycle([[0, 0.11, 'still'], [0.35, 0.105], [1.0, 0, 'still'], [1.75, 0, 'still'], [2.35, 0.11, 'still']], T);
/** The palm runs along the strip once to press it on (metres along the arm), then comes back to the middle as it lifts. */
const slide = cycle([[0, 0, 'still'], [1.05, 0, 'still'], [1.3, -0.03], [1.7, 0.03, 'still'], [2.35, 0, 'still']], T);
/** The strip is in the hand until it touches down (t < LAND), on the arm after. */
const LAND = 1.0;
/** The arm's surface sits a little above the spot's radius here: the strip lies on it, not in it. */
const LIFT = 0.007;

const s = spot(), q = new THREE.Quaternion(), at = new THREE.Vector3(), skin = new THREE.Vector3();
const palm = new THREE.Vector3(), fingers = new THREE.Vector3(), into = new THREE.Vector3(), ring = new THREE.Vector3();

function clip(world: World, gravity: Gravity) {
  return gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: armMoves(gravity, T, { hand: cycle([[0, [0.05, 0.25, 0.4]]], T) }) }],
    props: (w) => [strip(w)],
    marks: { contacts: 1 },
    act: (t, [f]: Figure[], [p], marks) => {
      if (gravity === 'gravity') standFeet(f);
      forearmSpot(f, s);
      const h = sample1(height, t);
      // The strip: carried under the palm while it comes down, then stuck on the arm over the cut.
      skin.copy(s.at).addScaledVector(s.up, LIFT);
      at.copy(skin).addScaledVector(s.up, t < LAND ? h : 0);
      basis(q, s.up, s.along);
      p.object.position.copy(at);
      p.object.quaternion.copy(q);
      p.shown = ramp(t, 0, 0.3) * (1 - ramp(t, 2.5, 2.85));
      // The palm: flat on the strip, fingers along the arm towards the wrist; it presses along it, then lifts.
      palm.copy(skin).addScaledVector(s.up, h + TH + 0.002).addScaledVector(s.along, sample1(slide, t));
      fingers.copy(s.along).addScaledVector(s.across, -0.2);
      into.copy(s.up).negate();
      reach(f, 1, palm, fingers, into, 1);
      if (!marks) return;
      // The cut: a ring on the skin, seen until the strip covers it and again as the strip fades.
      ring.copy(s.at).addScaledVector(s.up, 0.004);
      const k = Math.max(1 - ramp(t, 0.75, 0.95), ramp(t, 2.55, 2.9));
      marks.contacts[0].show(ring, 0.03, 0.75 * k, 0);
    },
    // The forearm camera of V08 and V14, a little closer: the strip is small.
    camera: { ...ARM_CAMERA, target: [-0.06, 1.38, 0.28], extent: 0.84, span: 0.84 },
    keys: [0.3, 1.4, 2.2],
  });
}

export const v16: Move = {
  id: 'V16',
  name: 'V16-bandage',
  summary: 'Covers a cut with a bandage.',
  params: {},
  medical: true,
  reviewed: false,
  questions: [
    'V16: what kind of bandage, and where is the cut? (The animation lays a sticky strip over a cut on the forearm, the same placeholder as V08.)',
  ],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
