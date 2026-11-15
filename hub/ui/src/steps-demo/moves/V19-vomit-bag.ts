// V19 vomit bag. Her description: "Vomits into a bag and closes it." One
// figure holds an open bag by both sides in front of the chest, brings it up
// under the mouth, heaves twice into it (the chest and head go forward and
// down; a short arrow goes from the mouth into the bag), lowers it, and
// closes it: the opening is pressed shut and its top folded down. Nothing
// coming out is drawn: the arrow carries it.
//
// To loop back to the start, the closed bag fades out at the end as an open
// one fades in, in the same hands.
//
// Not stated, so kept neutral: how the bag is held (both hands, one each side
// of the opening), and how it closes (pressed shut and folded over once).
//
// The bag is the master: its pose is worked out first and both hands are laid
// on its sides with `reach`, so the grip never slips.

import * as THREE from 'three';
import { HEAD, Prop, cycle, gesture, reach, sample1 } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { MOUTH, basis, floatRoot, standFeet, standRoot } from './V17-kit.ts';

const T = 3.4;

// The bag, in its own frame: the opening at the top (y = 0), the bag below it; x across, z front to back.
const HW = 0.085, HD = 0.05, BOT = -0.22, BD = 0.03, FOLD = 0.035;

function openBag(world: World): Prop {
  return new Prop(world, (pen) => {
    // The opening, an oval.
    const n = 20;
    const rim: [number, number, number][] = [];
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; rim.push([HW * Math.cos(a), 0, HD * Math.sin(a)]); }
    pen.path(rim);
    // The sides down to a flat bottom.
    pen.box(-HW, BOT - 0.001, -BD, HW, BOT, BD);
    pen.seg(-HW, 0, 0, -HW, BOT, -BD).seg(-HW, 0, 0, -HW, BOT, BD).seg(HW, 0, 0, HW, BOT, -BD).seg(HW, 0, 0, HW, BOT, BD);
    pen.seg(0, 0, HD, 0, BOT, BD).seg(0, 0, -HD, 0, BOT, -BD);
  }, { strength: 1, width: 2, boxes: [[-HW * 0.85, BOT, -BD * 0.8, HW * 0.85, -0.02, BD * 0.8]] });
}

function closedBag(world: World): Prop {
  return new Prop(world, (pen) => {
    // Pressed flat: front and back faces meet at the top; the top is folded down once.
    pen.box(-HW, BOT, -BD, HW, -FOLD, BD);
    pen.box(-HW, -FOLD, -0.012, HW, 0, 0.012);
    pen.seg(-HW, -FOLD * 0.5, 0.012, HW, -FOLD * 0.5, 0.012);
  }, { strength: 1, width: 2, boxes: [[-HW, BOT, -BD, HW, 0, BD]] });
}

/** 0: the bag held in front of the chest; 1: under the mouth. */
const lift = cycle([[0, 0, 'still'], [0.45, 0, 'still'], [0.95, 1, 'still'], [1.85, 1, 'still'], [2.3, 0, 'still']], T);
/** The heaves: two pushes forward and down while the bag is under the mouth. */
const heave = cycle([[0, 0, 'still'], [1.0, 0, 'still'], [1.18, 1], [1.38, 0.25], [1.56, 1], [1.82, 0, 'still']], T);
/** Shut: 0 open, 1 closed (and folded); it goes back to an open bag at the end. */
const shutA = 2.2, shutB = 2.5, swapA = 2.85, swapB = 3.25;

function person(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  return {
    root: floating ? floatRoot(T) : standRoot(T),
    turn: cycle([[0, [0, 0, 0]], [T / 2, [0, 0.01, 0]]], T),
    // Chest and head forward and down with each heave.
    chest: cycle([[0, [0.04, 0, 0], 'still'], [0.95, [0.08, 0, 0]], [1.18, [0.3, 0, 0]], [1.38, [0.14, 0, 0]], [1.56, [0.3, 0, 0]], [1.85, [0.1, 0, 0]], [2.4, [0.06, 0, 0]], [2.9, [0.04, 0, 0], 'still']], T),
    head: cycle([[0, [0.3, 0, 0], 'still'], [0.6, [0.18, 0, 0]], [0.95, [0.22, 0, 0]], [1.18, [0.45, 0, 0]], [1.38, [0.28, 0, 0]], [1.56, [0.45, 0, 0]], [1.85, [0.25, 0, 0]], [2.3, [0.38, 0, 0], 'still'], [2.9, [0.32, 0, 0], 'still']], T),
    elbows: [cycle([[0, [-0.8, -1, -0.3]]], T), cycle([[0, [0.8, -1, -0.3]]], T)],
    overlap: 0.4,
  };
}

const q = new THREE.Quaternion(), qRest = new THREE.Quaternion(), qUp = new THREE.Quaternion();
const yb = new THREE.Vector3(), zb = new THREE.Vector3(), rest = new THREE.Vector3();
const high = new THREE.Vector3(), at = new THREE.Vector3(), fwd = new THREE.Vector3();
const grip = new THREE.Vector3(), into = new THREE.Vector3(), fingers = new THREE.Vector3();
const from = new THREE.Vector3(), to = new THREE.Vector3();

function clip(world: World, gravity: Gravity) {
  return gesture(world, {
    duration: T,
    gravity,
    cast: [{ moves: person(gravity) }],
    props: (w) => [openBag(w), closedBag(w)],
    marks: { arrows: 1 },
    act: (t, [f]: Figure[], [open, closed], marks) => {
      if (gravity === 'gravity') standFeet(f);
      const k = sample1(lift, t);
      // Shut between shutA and shutB; at the end the closed bag gives way to a new open one.
      const shut = Math.min(1, Math.max(0, (t - shutA) / (shutB - shutA)));
      const swap = Math.min(1, Math.max(0, (t - swapA) / (swapB - swapA)));
      const closedness = shut * (1 - swap);
      open.shown = 1 - closedness;
      closed.shown = closedness;
      // At rest: upright in front of the lower chest. Under the mouth: the opening tipped towards the face.
      f.bodyDir(0, 1, 0, yb);
      f.bodyDir(0, 0, 1, zb);
      basis(qRest, yb, zb);
      f.bodyDir(0, Math.cos(0.55), -Math.sin(0.55), yb);
      f.bodyDir(0, Math.sin(0.55), Math.cos(0.55), zb);
      basis(qUp, yb, zb);
      q.copy(qRest).slerp(qUp, k);
      f.body(0, 0.24, 0.33, rest);
      // Under the mouth, about 16 cm down and 16 cm out, fixed to the body: the head comes down to it with each heave.
      f.body(0, 0.5, 0.25, high);
      at.copy(rest).lerp(high, k);
      f.bodyDir(0, 0, 1, fwd);
      at.addScaledVector(fwd, 0.04 * Math.sin(Math.PI * k));
      for (const p of [open, closed]) {
        p.object.position.copy(at);
        p.object.quaternion.copy(q);
      }
      // Both hands on the sides, halfway down the bag, fingers forward round it, pressing in.
      for (let a = 0; a < 2; a++) {
        const s = a === 0 ? -1 : 1;
        grip.set(s * HW, -0.12, -0.005).applyQuaternion(q).add(at);
        into.set(-s, 0, 0).applyQuaternion(q);
        fingers.set(0, 0.25, 1).applyQuaternion(q);
        reach(f, a, grip, fingers, into, 1);
      }
      if (!marks) return;
      // Into the bag: a short arrow from the mouth down into the opening at each heave.
      const h = sample1(heave, t);
      f.restPoint(HEAD, MOUTH[0], MOUTH[1], MOUTH[2], from);
      f.bodyDir(0, -0.015, 0.045, to);
      from.add(to);
      to.set(0, 0.005, 0).applyQuaternion(q).add(at);
      marks.arrows[0].show(from, to, 0.032, h);
    },
    camera: { target: [0.0, 1.36, 0.2], yaw: -0.8, pitch: 0.3, extent: 0.95, span: 0.95 },
    keys: [0.2, 1.2, 2.6],
  });
}

export const v19: Move = {
  id: 'V19',
  name: 'V19-vomit-bag',
  summary: 'Vomits into a bag and closes it.',
  params: {},
  medical: false,
  reviewed: false,
  questions: [],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
