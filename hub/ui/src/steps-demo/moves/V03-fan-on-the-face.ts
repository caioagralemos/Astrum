// V03 fan on the face. Her description: "Turns on a small fan and puts it near
// the face, pointing at it." One figure holds a small hand fan in the left
// hand in front of the chest, presses its switch with the right hand's
// fingertips, the blades start turning, and the left hand brings the fan up in
// front of the face, pointing at it. Small arrows show the air going to the
// face. Nothing else: how near, how long, and what the fan is for are her card
// text, not drawn here.
//
// The fan is the master: its pose is worked out first (in front of the chest,
// or in front of the face pointing at it), the left hand is laid on its handle
// with `reach`, so the grip never slips, and the right hand's fingertips are
// laid on the switch.
//
// Weightless: the figure floats, knees up. With gravity: standing on the floor.
// The loop does not come back (the fan stays on at the face): the last half
// second dissolves into the next round.

import * as THREE from 'three';
import { HEAD, Prop, gesture, ramp, reach, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Gravity, Move } from '../step.ts';
import type { World } from '../world.ts';
import { NOSE, basis, standFeet } from './V17-kit.ts';

const T = 3.2;
/** When the switch is pressed, when the blades start, and when the fan goes up to the face. */
const PRESS_A = 0.55, PRESS_B = 0.95;
const SPIN = 0.85;
const UP_A = 1.15, UP_B = 1.85;

// The fan, in its own frame: the air goes out along +z, up is +y.
const R = 0.07;
const HW = 0.016, HD = 0.014, HTOP = -R, HBOT = -0.19;
/** The switch: a small button on the handle's +x face (the side the right hand comes from). */
const SWITCH = new THREE.Vector3(HW + 0.006, -0.1, 0);

function fanBody(world: World): Prop {
  return new Prop(world, (pen) => {
    // The guard: a back ring and a front ring, joined, and the hub.
    pen.circle(0, 0, -0.012, R, 'xy');
    pen.circle(0, 0, 0.012, R, 'xy');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pen.seg(R * Math.cos(a), R * Math.sin(a), -0.012, R * Math.cos(a), R * Math.sin(a), 0.012);
    }
    pen.circle(0, 0, 0.012, 0.016, 'xy');
    pen.seg(-0.016, 0, 0.012, -R, 0, 0.012).seg(0.016, 0, 0.012, R, 0, 0.012);
    // The handle, and the switch on its side.
    pen.box(-HW, HBOT, -HD, HW, HTOP, HD);
    pen.box(SWITCH.x - 0.004, SWITCH.y - 0.009, -0.007, SWITCH.x + 0.004, SWITCH.y + 0.009, 0.007);
  }, { strength: 1, width: 2, boxes: [[-HW, HBOT, -HD, HW, HTOP, HD]] });
}

function fanBlades(world: World): Prop {
  return new Prop(world, (pen) => {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      // A blade: a narrow leaf from the hub to near the guard.
      const p = (r: number, w: number): [number, number, number] => [r * c - w * s, r * s + w * c, 0];
      pen.path([p(0.014, -0.007), p(0.035, -0.019), p(0.058, -0.014), p(0.06, 0.005), p(0.035, 0.014), p(0.014, 0.007)]);
    }
  }, { strength: 0.9, width: 1.6 });
}

/** The blades' angle at t: still, then spinning up to about 3 turns a second. */
function bladeAngle(t: number): number {
  if (t <= SPIN) return 0;
  const w = 3 * Math.PI * 2, rise = 0.45;
  const u = t - SPIN;
  return u < rise ? (w * u * u) / (2 * rise) : w * (rise / 2 + (u - rise));
}

function person(gravity: Gravity): Moves {
  const floating = gravity === 'weightless';
  return {
    root: floating
      ? track([[0, [0, 0.98, 0]], [T, [0, 0.986, 0.004]]])
      : track([[0, [0, 0.975, 0]], [T, [0.004, 0.978, 0.004]]]),
    turn: track([[0, [0, 0.02, 0]]]),
    chest: track([[0, [0.04, 0.04, 0], 'still'], [UP_A, [0.04, 0.04, 0]], [UP_B, [0.0, 0.0, 0], 'still']]),
    // Looks down at the switch, then up as the fan comes to the face, and leans into the air a little.
    head: track([[0, [0.32, 0, 0], 'still'], [PRESS_B, [0.34, 0.03, 0]], [UP_A + 0.1, [0.15, 0.02, 0]], [UP_B, [0.02, 0, 0], 'still'], [T, [0.04, 0, 0], 'still']]),
    hands: [
      // The right hand rests low, comes to the switch (laid on by `reach`), and goes back down.
      floating
        ? track([[0, [-0.27, 0.08, 0.26], 'still'], [PRESS_A - 0.25, [-0.2, 0.2, 0.36]], [PRESS_B + 0.35, [-0.24, 0.12, 0.3]], [UP_B + 0.2, [-0.28, 0.06, 0.24], 'still']])
        : track([[0, [-0.24, -0.12, 0.08], 'still'], [PRESS_A - 0.25, [-0.18, 0.15, 0.32]], [PRESS_B + 0.35, [-0.22, -0.02, 0.18]], [UP_B + 0.3, [-0.24, -0.14, 0.06], 'still']]),
      null,
    ],
    elbows: [track([[0, [-1, -0.7, -0.3]]]), track([[0, [1, -0.6, -0.5]]])],
    overlap: 0.3,
  };
}

const q = new THREE.Quaternion(), qSpin = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
const yb = new THREE.Vector3(), zb = new THREE.Vector3(), zFace = new THREE.Vector3();
const nose = new THREE.Vector3(), low = new THREE.Vector3(), high = new THREE.Vector3(), at = new THREE.Vector3();
const grip = new THREE.Vector3(), into = new THREE.Vector3(), fingers = new THREE.Vector3();
const sw = new THREE.Vector3(), tip = new THREE.Vector3(), ring = new THREE.Vector3();
const from = new THREE.Vector3(), to = new THREE.Vector3(), side = new THREE.Vector3();

function clip(world: World, gravity: Gravity) {
  return gesture(world, {
    duration: T,
    loop: 'seam',
    gravity,
    cast: [{ moves: person(gravity) }],
    props: (w) => [fanBody(w), fanBlades(w)],
    marks: { contacts: 1, arrows: 3 },
    act: (t, [f]: Figure[], [fan, blades], marks) => {
      if (gravity === 'gravity') standFeet(f);
      const k = ramp(t, UP_A, UP_B);
      // In front of the chest, a little to the right, pointing back at the body; then in front of
      // the face, 22 cm out and a little to the right and below, pointing at the face.
      f.body(0.05, 0.36, 0.3, low);
      f.restPoint(HEAD, NOSE[0], NOSE[1], NOSE[2], nose);
      f.body(0.03, 0, 0.22, high).sub(f.root).add(nose);
      high.y -= 0.02;
      at.copy(low).lerp(high, k);
      // A small arc outwards on the way up, not a straight slide.
      f.bodyDir(0, 0, 1, side);
      at.addScaledVector(side, 0.04 * Math.sin(Math.PI * k));
      f.bodyDir(0, 0, -1, zb);
      zFace.subVectors(nose, high).normalize();
      zb.lerp(zFace, k).normalize();
      f.bodyDir(0, 1, 0, yb);
      basis(q, yb, zb);
      fan.object.position.copy(at);
      fan.object.quaternion.copy(q);
      blades.object.position.copy(at);
      qSpin.setFromAxisAngle(zAxis, bladeAngle(t));
      blades.object.quaternion.copy(q).multiply(qSpin);
      // The left hand holds the handle by its -x face, fingers round it, pointing away from the face.
      grip.set(-HW, -0.14, 0).applyQuaternion(q).add(at);
      into.set(1, 0, 0).applyQuaternion(q);
      fingers.set(0, -0.25, -1).applyQuaternion(q);
      reach(f, 1, grip, fingers, into, 1);
      // The right hand's fingertips on the switch: the fingers point into it, palm down.
      const press = ramp(t, PRESS_A - 0.25, PRESS_A) * (1 - ramp(t, PRESS_B, PRESS_B + 0.25));
      sw.copy(SWITCH).applyQuaternion(q).add(at);
      fingers.set(-1, 0, 0).applyQuaternion(q);
      f.bodyDir(0, -1, 0, into);
      // The palm's middle sits back from the fingertips by 6.5 cm, and the press goes in 4 mm.
      const push = 0.004 * ramp(t, PRESS_A, PRESS_A + 0.08) * (1 - ramp(t, PRESS_B - 0.15, PRESS_B - 0.05));
      tip.copy(sw).addScaledVector(fingers, -(0.004 + 0.065) + push);
      reach(f, 0, tip, fingers, into, press);
      if (!marks) return;
      marks.contacts[0].show(ring.copy(sw), 0.025, 0.8 * ramp(t, PRESS_A - 0.05, PRESS_A + 0.05) * (1 - ramp(t, PRESS_B - 0.1, PRESS_B)));
      // The air: three short arrows from the fan towards the face, flowing, once it is up.
      const air = ramp(t, UP_B - 0.25, UP_B + 0.15);
      for (let i = 0; i < 3; i++) {
        const phase = (t * 1.6 + i / 3) % 1;
        const off = (i - 1) * 0.032;
        f.bodyDir(1, 0, 0, side);
        from.copy(zb).multiplyScalar(0.03 + 0.08 * phase).add(at).addScaledVector(side, off);
        to.copy(from).addScaledVector(zb, 0.07);
        const fade = Math.sin(Math.PI * phase);
        marks.arrows[i].show(from, to, 0.022, air * fade * 0.95);
      }
    },
    camera: { target: [0.0, 1.42, 0.16], yaw: -1.15, pitch: 0.1, extent: 1.05, span: 1.05 },
    keys: [0.2, 0.8, 2.4],
  });
}

export const v03: Move = {
  id: 'V03',
  name: 'V03-fan-on-the-face',
  summary: 'Turns on a small fan and puts it near the face, pointing at it.',
  params: {},
  medical: false,
  reviewed: false,
  questions: [],
  variants: {
    weightless: (world) => clip(world, 'weightless'),
    gravity: (world) => clip(world, 'gravity'),
  },
};
