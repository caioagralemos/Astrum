// V04 sealed mask. Her description: "Puts a mask on the face and adjusts the
// edges with both hands to seal it." Her answers (14 Nov): the thumbs go on
// the nose bridge and the fingers along the sides of the mask (answer 2); the
// mask is held round the head by an elastic strap (answer 3).
//
// One figure. The strap is already behind the head and the mask is held out in
// front of the face by both hands, one on each side. The hands bring it onto
// the nose and mouth (the strap follows), then press it: the thumb side of each
// hand at the nose bridge, the fingers along the mask's sides, pressing in
// towards the face. Rings mark where the hands press. The figure's hands are
// mitts (no separate thumb), so the thumb is shown by the side of the hand that
// carries it, at the top of the mask.
//
// The mask is the master: its pose comes first (held out, or on the face), the
// strap is drawn from it to the back of the head, and both hands are laid on
// it with `reach`, so nothing slips.
//
// The loop does not come back (the mask stays on): the last half second
// dissolves into the next round.

import * as THREE from 'three';
import { HEAD, Prop, gesture, ramp, reach, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { standFeet } from './V17-kit.ts';

const T = 3.3;
/** The mask comes onto the face, then the hands press its edges. */
const ON_A = 0.25, ON_B = 1.3;
const PRESS_A = 1.45, PRESS_B = 1.8;
/** How far out in front of the face the mask is held at the start. */
const OUT = 0.17;
/** And how far below the face. */
const DOWN = 0.14;

// Everything below is in the head's rest frame (avatar metres, facing +z), measured from the
// head's joint (y = 1.5), so a prop can follow the head.
const HJ = 1.5;
/** The mask: its rim sits on the face round the nose and mouth; it bulges out to a rounded front. */
const CY = 1.648, RIM_Z = 0.09, RX = 0.056, RY = 0.06, FRONT_Z = 0.145;
/** Where the strap leaves the mask (each side, at the rim). */
const STRAP_Y = 1.665;
/** The strap round the back of the head: just outside the head at that height. */
const BX = 0.106, BZ = 0.092;

function maskShape(world: World): Prop {
  const y0 = CY - HJ;
  return new Prop(world, (pen) => {
    const rim: [number, number, number][] = [];
    const mid: [number, number, number][] = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      // Narrower at the nose (top), wider at the mouth and chin.
      const wide = 1 - 0.28 * Math.max(0, Math.sin(a));
      rim.push([RX * wide * Math.cos(a), y0 + RY * Math.sin(a), RIM_Z]);
      mid.push([0.6 * RX * wide * Math.cos(a), y0 - 0.006 + 0.6 * RY * Math.sin(a), RIM_Z + 0.038]);
    }
    pen.path(rim);
    pen.path(mid);
    for (let i = 0; i < 24; i += 3) pen.seg(rim[i][0], rim[i][1], rim[i][2], mid[i][0], mid[i][1], mid[i][2]);
    pen.circle(0, y0 - 0.008, FRONT_Z, 0.014, 'xy');
    pen.seg(0, y0 - 0.008 + 0.014, FRONT_Z, mid[6][0], mid[6][1], mid[6][2]);
    pen.seg(0, y0 - 0.008 - 0.014, FRONT_Z, mid[18][0], mid[18][1], mid[18][2]);
    // The two strap clips at the sides.
    for (const s of [-1, 1]) pen.seg(s * RX, STRAP_Y - HJ - 0.012, RIM_Z, s * (RX + 0.008), STRAP_Y - HJ, RIM_Z - 0.004);
  }, { strength: 1, width: 1.9, boxes: [[-0.04, y0 - 0.045, RIM_Z, 0.04, y0 + 0.035, RIM_Z + 0.036]] });
}

/** The strap's back half, round the back of the head (fixed to the head). */
function strapBack(world: World): Prop {
  const y = STRAP_Y - HJ + 0.012;
  return new Prop(world, (pen) => {
    pen.path([[BX, y, 0.6 * BZ], [BX, y, -0.62 * BZ], [0.62 * BX, y + 0.008, -BZ], [-0.62 * BX, y + 0.008, -BZ], [-BX, y, -0.62 * BZ], [-BX, y, 0.6 * BZ]]);
  }, { strength: 0.9, width: 1.5 });
}

/** One straight piece of strap, from the side of the head to the mask (a unit segment, stretched in `act`). */
function strapSide(world: World): Prop {
  return new Prop(world, (pen) => { pen.seg(0, 0, 0, 1, 0, 0); }, { strength: 0.9, width: 1.5 });
}

function person(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  return {
    root: floating ? track([[0, [0, 0.98, 0]], [T, [0, 0.985, 0.004]]]) : track([[0, [0, 0.975, 0]], [T, [0.003, 0.977, 0.004]]]),
    turn: track([[0, [0, 0.02, 0]]]),
    chest: track([[0, [0.05, 0, 0], 'still'], [ON_B, [0.03, 0, 0]], [T, [0.03, 0, 0], 'still']]),
    // Looks at the mask, then the face meets it, a little down; stays still while it is pressed.
    head: track([[0, [0.22, 0, 0], 'still'], [ON_A + 0.2, [0.2, 0, 0]], [ON_B, [0.06, 0, 0]], [PRESS_A, [0.05, 0, 0], 'still'], [T, [0.05, 0, 0], 'still']]),
    elbows: [track([[0, [-0.6, -1, 0.1]]]), track([[0, [0.6, -1, 0.1]]])],
    overlap: 0.2,
  };
}

const hq = new THREE.Quaternion(), tilt = new THREE.Quaternion(), xAxis = new THREE.Vector3(1, 0, 0), unitX = new THREE.Vector3(1, 0, 0);
const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), dn = new THREE.Vector3();
const contact = new THREE.Vector3(), fingers = new THREE.Vector3(), into = new THREE.Vector3();
const local = new THREE.Vector3();

function clip(world: World, gravity: Gravity) {
  return gesture(world, {
    duration: T,
    loop: 'seam',
    gravity,
    cast: [{ moves: person(gravity) }],
    props: (w) => [maskShape(w), strapBack(w), strapSide(w), strapSide(w)],
    marks: { contacts: 2 },
    act: (t, [f]: Figure[], [mask, back, sideA, sideB], marks) => {
      if (gravity === 'gravity') standFeet(f);
      // How far the mask is from the face (0: on it), and its tilt while held out (bottom forward).
      const k = 1 - ramp(t, ON_A, ON_B);
      const out = OUT * k;
      const press = ramp(t, PRESS_A, PRESS_B);
      tilt.setFromAxisAngle(xAxis, -0.35 * k);
      mask.follow(f, HEAD, [0, -DOWN * k, out - 0.0015 * press], tilt);
      back.follow(f, HEAD);
      hq.copy(f.q[HEAD]);
      // The two straight pieces: from the side of the head (just ahead of the ear) to the mask's clip.
      const sides = [sideA, sideB];
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? -1 : 1;
        f.point(HEAD, s * BX, STRAP_Y - HJ + 0.012, 0.6 * BZ, a);
        local.set(s * (RX + 0.008), STRAP_Y - HJ, RIM_Z - 0.004).applyQuaternion(tilt);
        local.z += out; local.y -= DOWN * k;
        b.copy(local).applyQuaternion(hq).add(f.at[HEAD]);
        d.subVectors(b, a);
        const p = sides[i].object;
        p.position.copy(a);
        p.quaternion.setFromUnitVectors(unitX, dn.copy(d).normalize());
        p.scale.set(d.length(), 1, 1);
      }
      // Both hands on the mask's sides: the heel of the hand low by the jaw, the fingers up along the
      // mask's side, the palm pressing in towards the face; the thumb comes at the height of the nose bridge.
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? -1 : 1;
        local.set(s * (RX * 0.95), CY - HJ, RIM_Z + 0.015).applyQuaternion(tilt);
        local.z += out; local.y -= DOWN * k;
        local.x -= s * 0.003 * press;
        contact.copy(local).applyQuaternion(hq).add(f.at[HEAD]);
        fingers.set(-s * 0.3, 1, 0.15).applyQuaternion(hq);
        into.set(-s, 0, -0.35).applyQuaternion(hq);
        reach(f, i, contact, fingers, into, 1);
        if (marks) marks.contacts[i].show(contact, 0.022, 0.6 * press * (1 - 0.3 * ramp(t, PRESS_B + 0.4, PRESS_B + 0.9)));
      }
    },
    camera: { target: [0.02, 1.53, 0.12], yaw: 0.6, pitch: 0.08, extent: 0.82, span: 0.82 },
    keys: [0.2, 1.0, 2.2],
  });
}

export const v04: Move = {
  id: 'V04',
  name: 'V04-sealed-mask',
  summary: 'Puts a mask on the face and presses its edges with both hands to seal it: thumbs at the nose bridge, fingers along the sides; an elastic strap holds it round the head.',
  params: {},
  medical: true,
  reviewed: false,
  source: 'The medical lead\'s answers of 14 Nov 2026 (videos-answers.md, V04 answers 2 and 3): "Thumbs on the nose bridge, fingers along the sides of the mask." "Strapped around the head with an elastic strap."',
  questions: [],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
