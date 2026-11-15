// V15 clean with gauze. Her description: "Cleans the skin with gauze and
// collects the liquid with another gauze (nothing floats)." One figure. The
// right hand (arm 0) wipes a short stroke along the skin with one gauze pad;
// the left hand (arm 1) holds a second pad pressed on the skin at the end of
// the stroke, where the liquid goes. Two strokes per loop; between strokes the
// wiping pad lifts a little and goes back. Both pads stay in the hands the
// whole time, and no liquid is drawn.
//
// Not stated, so kept neutral and asked (questions): which part of the body
// (the front of the right thigh here, because both hands are needed and the
// forearm placeholder of V08/V14 leaves only one free), and whether the second
// gauze is held at the end of the wipe while wiping (drawn) or used after it.
// Nothing about which way to wipe relative to a wound is drawn: no wound is
// drawn, only skin.
//
// Weightless: floating, knees up, the thigh in front. With gravity: standing,
// bent forward a little; the collecting pad is below the stroke.

import * as THREE from 'three';
import { Prop, THIGH, cycle, gesture, ramp, reach, sample1 } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { basis, floatRoot, standFeet } from './V17-kit.ts';

const T = 3.2;

/** The skin spot: the front of the right thigh, in rest coordinates, and the thigh's half thickness. */
const SPOT = new THREE.Vector3(-0.096, 0.715, 0.0);
const RADIUS = 0.072;

/** A folded gauze pad, in its own frame: y out of the skin, z along the stroke, bent over the thigh. */
const HX = 0.05, HZ = 0.05, TH = 0.012, SAG = 1 / (2 * RADIUS);
const sag = (x: number) => -SAG * x * x;
function gauze(world: World): Prop {
  return new Prop(world, (pen) => {
    const n = 6;
    for (const y0 of [0, TH]) for (const z of [-HZ, HZ]) {
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= n; i++) { const x = -HX + (2 * HX * i) / n; pts.push([x, y0 + sag(x), z]); }
      pen.path(pts);
    }
    for (const x of [-HX, HX]) for (const y0 of [0, TH]) pen.seg(x, y0 + sag(x), -HZ, x, y0 + sag(x), HZ);
    for (const x of [-HX, HX]) for (const z of [-HZ, HZ]) pen.seg(x, sag(x), z, x, TH + sag(x), z);
    // The weave on top, so it reads as gauze and not as part of the body.
    for (let i = 1; i < 5; i++) {
      const z = -HZ + (2 * HZ * i) / 5;
      const pts: [number, number, number][] = [];
      for (let j = 0; j <= n; j++) { const x = -HX + (2 * HX * j) / n; pts.push([x, TH + sag(x) + 0.001, z]); }
      pen.path(pts);
      const x = -HX + (2 * HX * i) / 5;
      pen.seg(x, TH + sag(x) + 0.001, -HZ, x, TH + sag(x) + 0.001, HZ);
    }
  }, { strength: 1, width: 2, boxes: [[-HX * 0.6, -0.004, -HZ, HX * 0.6, TH, HZ]] });
}

/** Where the wiping pad is along the thigh (metres from the spot, + towards the knee), and how far it is off the skin. */
const A0 = -0.085, A1 = 0.0;
const along = cycle([[0, A0, 'still'], [0.75, A1, 'still'], [1.6, A0, 'still'], [2.35, A1, 'still']], T);
const lift = cycle([[0, 0, 'still'], [0.8, 0, 'still'], [1.0, 0.025], [1.4, 0.02], [1.6, 0, 'still'], [2.4, 0, 'still'], [2.6, 0.025], [3.0, 0.02]], T);
/** The collecting pad sits just past the end of the stroke; it presses a little as the stroke arrives. */
const B_AT = A1 + 2 * HZ + 0.008;
const press = cycle([[0, 0, 'still'], [0.75, 0.003, 'still'], [1.2, 0, 'still'], [1.6, 0, 'still'], [2.35, 0.003, 'still'], [2.8, 0, 'still']], T);

function person(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  return {
    root: floating ? floatRoot(T) : cycle([[0, [0, 0.962, 0]], [T / 2, [0.004, 0.965, 0.004]]], T),
    turn: floating ? cycle([[0, [0, 0.1, 0]], [T / 2, [0, 0.105, 0]]], T) : cycle([[0, [0, 0.2, 0]], [T / 2, [0, 0.205, 0]]], T),
    chest: floating ? cycle([[0, [0.4, -0.3, 0]], [T / 2, [0.41, -0.3, 0]]], T) : cycle([[0, [0.62, -0.3, 0]], [T / 2, [0.63, -0.3, 0]]], T),
    head: cycle([[0, [0.5, 0.1, 0]], [T / 2, [0.52, 0.1, 0]]], T),
    hands: [cycle([[0, [-0.15, -0.2, 0.3]]], T), cycle([[0, [0.05, -0.25, 0.32]]], T)],
    elbows: [cycle([[0, [-1, 0.2, -0.2]]], T), cycle([[0, [1, -0.3, -0.4]]], T)],
    // Weightless: the right knee comes up a little, so the front of the thigh faces forward and up.
    feet: floating ? [cycle([[0, [-0.13, -0.66, 0.2]]], T), cycle([[0, [0.13, -0.72, 0.06]]], T)] : undefined,
    overlap: 0.3,
  };
}

const hip = new THREE.Vector3(), knee = new THREE.Vector3(), front = new THREE.Vector3();
const dir = new THREE.Vector3(), out = new THREE.Vector3(), side = new THREE.Vector3(), base = new THREE.Vector3();
const q = new THREE.Quaternion(), at = new THREE.Vector3(), palm = new THREE.Vector3();
const fingers = new THREE.Vector3(), into = new THREE.Vector3();
const a0 = new THREE.Vector3(), a1 = new THREE.Vector3();
/** 0..1..0 over one stroke that starts at `s`: up as the pad starts moving, down once it has arrived. */
const stroke = (t: number, s: number) => ramp(t, s - 0.05, s + 0.2) * (1 - ramp(t, s + 0.7, s + 1.0));

function place(f: Figure, a: number, p: Prop, shift: number, off: number, grip: number) {
  at.copy(base).addScaledVector(dir, shift).addScaledVector(out, RADIUS + off);
  basis(q, out, dir);
  p.object.position.copy(at);
  p.object.quaternion.copy(q);
  // The palm flat on the pad's outer end, fingers across the thigh, so the inner half of the pad shows.
  palm.set(0, TH + 0.002, grip).applyQuaternion(q).add(at);
  fingers.copy(side).multiplyScalar(a === 0 ? 1 : -1).addScaledVector(dir, 0.2);
  into.copy(out).negate();
  reach(f, a, palm, fingers, into, 1);
}

function clip(world: World, gravity: Gravity) {
  const floating = gravity === 'weightless';
  return gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: person(gravity) }],
    props: (w) => [gauze(w), gauze(w)],
    marks: { arrows: 1 },
    act: (t, [f]: Figure[], [wipe, collect], marks) => {
      if (!floating) standFeet(f);
      // The thigh's frame now: `dir` towards the knee, `out` out of its front, `side` across it.
      f.restPoint(THIGH(0), -0.088, 0.93, 0, hip);
      f.restPoint(THIGH(0), -0.106, 0.54, 0, knee);
      dir.subVectors(knee, hip).normalize();
      f.restPoint(THIGH(0), SPOT.x, SPOT.y, SPOT.z, base);
      f.restPoint(THIGH(0), SPOT.x, SPOT.y, SPOT.z + 1, front);
      out.subVectors(front, base);
      out.addScaledVector(dir, -out.dot(dir)).normalize();
      side.crossVectors(out, dir).normalize();
      place(f, 0, wipe, sample1(along, t), sample1(lift, t), -HZ + 0.02);
      place(f, 1, collect, B_AT, -sample1(press, t), HZ - 0.02);
      if (!marks) return;
      // A thin arrow beside the thigh, along the stroke, shown while the pad wipes towards the other one.
      const k = Math.max(stroke(t, 0), stroke(t, 1.6));
      a0.copy(base).addScaledVector(out, RADIUS + 0.03).addScaledVector(side, -0.11).addScaledVector(dir, A0 - 0.01);
      a1.copy(base).addScaledVector(out, RADIUS + 0.03).addScaledVector(side, -0.11).addScaledVector(dir, A1 + 0.05);
      marks.arrows[0].show(a0, a1, 0.025, 0.85 * k);
    },
    camera: floating
      ? { target: [-0.05, 0.98, 0.12], yaw: -0.55, pitch: 0.3, extent: 1.5, span: 1.5 }
      : { target: [-0.03, 0.86, 0.12], yaw: -0.55, pitch: 0.15, extent: 1.75, span: 1.75 },
    keys: [0.4, 1.2, 2.0],
  });
}

export const v15: Move = {
  id: 'V15',
  name: 'V15-clean-with-gauze',
  summary: 'Cleans the skin with gauze and collects the liquid with another gauze.',
  params: {},
  medical: true,
  reviewed: false,
  questions: [
    'V15: on which part of the body is the skin cleaned, and is the second gauze held at the end of the wipe while wiping, or used after it? (The animation uses the front of the thigh and holds it there while wiping.)',
  ],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
