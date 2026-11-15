// Move "compressions" (with gravity only; there is no weightless variant: in
// orbit this needs a different technique, which is not drawn here). Parameters:
// none (a bare floor).
//
// The example medical step: chest compressions, with gravity, on
// the floor of a surface base. One person lies on their back; the other kneels
// at their side with the heel of one hand on the lower half of the breastbone
// and the other hand on top, arms straight, shoulders over the hands.
//
// The numbers come only from a published guideline (see SOURCES.md): a rate of
// 100 to 120 a minute and a depth of about 5 cm, not more than 6 cm, on the
// lower half of the sternum, letting the chest come all the way back up. It is
// animated at 110 a minute (11 compressions in the 6 second loop) and exactly
// 5 cm, with equal time down and up (the guideline sets no ratio; a plain
// cosine is the least invented shape).
//
// The kneeling body is solved from the ground up every frame, so the motion
// has weight: shins and feet stay on the floor, the thighs turn about the
// knees, and the hips go where the knees, the trunk and straight arms over the
// hands allow; as the hands go down 5 cm the shoulders go down with them and
// the hips rise and fall. The hands are fixed to the chest's surface, which is
// itself pushed in under them, so they never leave it.

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { track } from '../anim.ts';
import { Character, plant, reach } from '../cast.ts';
import type { Moves } from '../cast.ts';
import { CHEST, COM_HEIGHT, FOREARM, STERNUM_Y, STERNUM_Z, THIGH_LEN, UPPER_ARM, restJoint } from '../rig.ts';
import { ACTOR, OTHER, tag } from '../step.ts';
import type { Clip, Move } from '../step.ts';
import { Contact } from '../world.ts';
import type { World } from '../world.ts';

/** Compressions a minute (the guideline's 100 to 120), and the loop: 11 of them, 6 seconds. */
export const RATE = 110;
const COUNT = 11;
const T = (COUNT * 60) / RATE;
const PERIOD = 60 / RATE;
/** How far the chest goes in (the guideline's "approximately 5 cm"). */
const DEPTH = 0.05;

/** How far down the chest is (0 at the top, 1 at full depth) at loop time u: equal time down and up. */
function press(u: number, period = PERIOD): number {
  const phase = (((u / period) % 1) + 1) % 1;
  return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
}

/** For the screen's beat: how far into this compression (1 at full depth), and which one of the loop's 11. */
export function beatOf(u: number): { pulse: number; count: number } {
  return { pulse: press(u), count: Math.min(COUNT, Math.floor(u / PERIOD) + 1) };
}

// The person lying down: on their back along the floor, head towards -x. Their body
// (avatar up, +y) points along -x, their front (+z) up.
const LYING = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
/** Their back on the floor: the centre of mass sits half the chest's depth up. */
const BACK = 0.095;
/** Where the breastbone's lower half is, at rest: right over the origin. */
const STERNUM = new THREE.Vector3(0, BACK + STERNUM_Z, 0);
const PATIENT_ROOT = new THREE.Vector3(STERNUM_Y - COM_HEIGHT, BACK, 0);

const patient: Moves = {
  root: track([[0, [PATIENT_ROOT.x, PATIENT_ROOT.y, PATIENT_ROOT.z]]]),
  turn: track([[0, [0, 0, 0]]]),
  head: track([[0, [-0.12, 0.08, 0]]]),
  hands: [track([[0, [-0.4, -0.2, -0.05]]]), track([[0, [0.33, -0.2, -0.05]]])],
  elbows: [track([[0, [-1, 0, -0.3]]]), track([[0, [1, 0, -0.3]]])],
  feet: [track([[0, [-0.11, -0.87, -0.02]]]), track([[0, [0.12, -0.87, -0.02]]])],
  knees: [track([[0, [-0.2, 0, 1]]]), track([[0, [0.2, 0, 1]]])],
  ankles: [track([[0, [-0.5, 0, 0.12]]]), track([[0, [-0.5, 0, -0.12]]])],
  orient: LYING,
};

// The rescuer kneels on the person's +z side, facing them (-z). Only the head, the chest's
// bend and the arms' poles are tracks; the rest is solved from the floor up in `kneel`.
const rescuer: Moves = {
  root: track([[0, [0, 0.6, 0.45]]]),
  turn: track([[0, [Math.PI, 0, 0]]]),
  head: track([[0, [0.42, 0, 0]]]),
  elbows: [track([[0, [-0.4, 0, -1]]]), track([[0, [0.4, 0, -1]]])],
};

const v = new THREE.Vector3();
const w = new THREE.Vector3();
const contact = new THREE.Vector3();
const wristLow = new THREE.Vector3();
const fingers = new THREE.Vector3(0, 0, -1);
const fingersTop = new THREE.Vector3(0.35, 0, -1).normalize();
const down = new THREE.Vector3(0, -1, 0);
const spot = new THREE.Vector3();
const back = new THREE.Vector3(0, 0, 1);
const floorUp = new THREE.Vector3(0, -1, 0);
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const nod = new THREE.Quaternion();

/** Where the knees and the tops of the feet rest, either side of the chest. */
const KNEE_Z = 0.3;
const KNEE_X = 0.16;
const KNEE_Y = 0.058;
const ARM = (UPPER_ARM + FOREARM) * 0.996;
const HIP = restJoint(9);
const SHOULDER = restJoint(3);
const CHEST_PIVOT = restJoint(CHEST);
/** The thigh's reach in the side view (it also goes out a little from hip to knee). */
const THIGH_SIDE = Math.sqrt(THIGH_LEN * THIGH_LEN - (KNEE_X - Math.abs(HIP[0])) ** 2);

/**
 * Solve the kneeling body for chest depth d (metres): hands on the chest, straight arms, shoulders
 * over the hands, hips wherever the knees and the trunk put them.
 */
function kneel(c: Character, d: number, bend: number) {
  const f = c.fig;
  // The hands: heel of the lower one on the breastbone (pushed in by d), the other on top of it.
  contact.copy(STERNUM).y -= d;
  // Shoulders: centred over the hands, as high as straight arms reach from the lower wrist.
  wristLow.copy(contact).addScaledVector(fingers, 0.03 - 0.075).y += 0.042;
  const across = Math.abs(SHOULDER[0]);
  const height = Math.sqrt(ARM * ARM - across * across);
  const sy = wristLow.y + height;
  const sz = wristLow.z + 0.02;
  // The trunk from hips to shoulders, as the chest's bend makes it (in the body's frame).
  const ty = CHEST_PIVOT[1] - HIP[1] + (SHOULDER[1] - CHEST_PIVOT[1]) * Math.cos(bend);
  const tz = (SHOULDER[1] - CHEST_PIVOT[1]) * Math.sin(bend);
  const trunk = Math.hypot(ty, tz);
  // Hips: on a circle about the knees (the thigh) and on one about the shoulders (the trunk).
  const ky = KNEE_Y, kz = KNEE_Z;
  const dy = sy - ky, dz = sz - kz;
  const dist = Math.hypot(dy, dz);
  const a = (THIGH_SIDE * THIGH_SIDE - trunk * trunk + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, THIGH_SIDE * THIGH_SIDE - a * a));
  const my = ky + (dy * a) / dist, mz = kz + (dz * a) / dist;
  // Of the two crossings, the one behind the line from knees to shoulders (on the rescuer's side).
  let hy = my - (dz * h) / dist, hz = mz + (dy * h) / dist;
  if (hz < mz) { hy = my + (dz * h) / dist; hz = mz - (dy * h) / dist; }
  // Lean the whole body so the trunk points from the hips to the shoulders.
  const lean = Math.atan2(-(sz - hz), sy - hy) - Math.atan2(tz, ty);
  f.turn.setFromEuler(euler.set(lean, Math.PI, 0));
  // Root (centre of mass) from the hips' middle.
  v.set(0, HIP[1] - COM_HEIGHT, 0).applyQuaternion(f.turn);
  f.root.set(contact.x, hy, hz).sub(v);
  f.chest.setFromEuler(euler.set(bend, 0, 0));
  // Knees and feet stay where they are on the floor: the leg goals are the ankles, the knees point down and forward.
  for (let l = 0; l < 2; l++) {
    const s = l === 0 ? 1 : -1;
    const leg = f.legs[l];
    const x = contact.x + s * KNEE_X;
    plant(f, l, spot.set(x * 1.0 + s * 0.02, 0.135, KNEE_Z + 0.43), back, floorUp, 1);
    leg.pole.set(0, -1, -0.6);
    void x;
  }
  // Elbows (straight, but if they bend at all) point out and back.
  f.arms[0].pole.set(0.6, 0, 1);
  f.arms[1].pole.set(-0.6, 0, 1);
  return contact;
}

function clip(world: World): Clip {
  return compressionsClip(world, RATE, COUNT);
}

/**
 * Chest compressions at `rate` a minute, `count` of them per loop (the loop is count × 60 / rate
 * seconds), `depth` metres deep (DEPTH, about 5 cm, unless the move gives its own). `gaugeText`
 * labels the depth gauge in the viewer only (captures carry no text).
 */
export function compressionsClip(world: World, rate: number, count: number, span = 2.9, depth = DEPTH, gaugeText = '5 cm'): Clip {
  const PERIOD = 60 / rate;
  const T = (count * 60) / rate;
  const pressAt = (u: number) => press(u, PERIOD);
  const group = new THREE.Group();
  const look = { ink: world.ink, bg: world.bg };
  const lying = new Character(look, patient);
  const kneeling = new Character(look, rescuer);
  lying.fig.addTo(group);
  kneeling.fig.addTo(group);
  lying.fig.style(OTHER.strength, OTHER.width);
  kneeling.fig.style(ACTOR.strength, ACTOR.width);
  const onChest = new Contact(world, group);
  const tags = [tag(gaugeText, 'room')];

  // The floor: a quiet slab with a few boards' lines, wide enough to ground both people.
  const floor = new LineSegmentsGeometry();
  const p: number[] = [];
  const x0 = -1.6, x1 = 1.4, z0 = -1.0, z1 = 1.5;
  p.push(x0, 0, z0, x1, 0, z0, x1, 0, z0, x1, 0, z1, x1, 0, z1, x0, 0, z1, x0, 0, z1, x0, 0, z0);
  for (let x = x0 + 0.5; x < x1 - 0.01; x += 0.5) p.push(x, 0, z0, x, 0, z1);
  floor.setPositions(p);
  const floorLines = new LineSegments2(floor, world.line(1.25, 0.24));
  group.add(floorLines);
  // A short depth gauge beside the chest: the chest's top at rest, and the depth below it.
  const gauge = new LineSegmentsGeometry();
  const gx = -0.02, gz = -0.27;
  const top = STERNUM.y, bottom = STERNUM.y - depth;
  gauge.setPositions([gx, top, gz, gx, bottom, gz, gx - 0.03, top, gz, gx + 0.03, top, gz, gx - 0.03, bottom, gz, gx + 0.03, bottom, gz]);
  const gaugeLines = new LineSegments2(gauge, world.line(1.5, 0.75));
  group.add(gaugeLines);

  const target = new THREE.Vector3(0.12, 0.42, 0.05);
  const into = new THREE.Vector3();

  const pose = (u: number) => {
    const c = pressAt(u);
    const d = depth * c;
    lying.pose(u);
    // The head nods a little with each push, a beat late (the body takes the push, the head follows).
    const late = pressAt(u - 0.09);
    lying.fig.head.multiply(nod.setFromEuler(euler.set(0.035 * late, 0, 0)));
    lying.fig.press = d;
    lying.fig.solve();
    kneeling.pose(u);
    const at = kneel(kneeling, d, 0.12 + 0.05 * c);
    // Head: looks down at the hands, and dips a touch with the push.
    kneeling.fig.head.setFromEuler(euler.set(0.22 + 0.05 * pressAt(u - 0.05), 0, 0));
    // Lower hand (the one on the person's feet side) on the chest; the upper one on top of it.
    reach(kneeling.fig, 0, w.copy(at).addScaledVector(fingers, 0.03), fingers, into.copy(down), 1);
    reach(kneeling.fig, 1, w.copy(at).addScaledVector(fingers, 0.035).setY(at.y + 0.088), fingersTop, into.copy(down), 1);
    kneeling.fig.solve();
    lying.fig.draw();
    kneeling.fig.draw();
    return c;
  };

  return {
    duration: T,
    keys: [0, PERIOD / 2],
    ship: false,
    group,
    tags,
    frame(u, still) {
      const drift = still ? 0 : Math.sin((u / T) * Math.PI * 2);
      world.frame(target, 2.15 + 0.025 * drift, 0.24 + 0.01 * drift, 1.75, 30, 0.0, span);
      world.depth(1.5, 7);
      const c = pose(u);
      onChest.show(contact, 0.075, 0.9, c);
      tags[0].at.set(gx, (top + bottom) / 2 + 0.06, gz - 0.02);
      tags[0].shown = 1;
    },
  };
}

export const compressions: Move = {
  name: 'compressions',
  summary: 'One person kneels beside another lying on their back and gives chest compressions, at the rate and depth of the cited guideline.',
  params: {},
  variants: { gravity: clip },
  medical: true,
  reviewed: false,
};
