// V05 leave the room (her description: "Walks from one room to another through
// a door"). Not medical: nothing here needs her answer.
//
// With gravity: a walk, left to right, through a door frame. The walk is
// solved from the floor up every frame: each foot is planted on its own spot
// for the stance and swings to the next one (toe-off, lift, heel down), the
// centre of mass rises over the standing leg and dips between steps, sways a
// little towards the leg it stands on, the pelvis turns with the stride and
// the arms swing against the legs.
//
// Weightless: the same passage through a hatch, as in orbit. The figure comes
// in already gliding, head first and face down, one hand reaching ahead; the
// hand catches the edge of the hatch and gives a small pull as the body slides
// past (the only change of speed is during that hold), lets go, and the body
// glides on into the next room, legs trailing.
//
// Both loops do not come back: the last half second dissolves into the next
// round, which is already moving.

import { Prop, gesture, plant, ramp, reach, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { KeyIn } from '../anim.ts';
import * as THREE from 'three';
import type { Move } from '../step.ts';

const PI = Math.PI;

// ---- With gravity: the walk ----

const TG = 3.3;
/** Walking speed (m/s), one stride's time (s) and the part of it each foot stands. */
const V = 0.85;
const C = 1.0;
const STANCE = 0.62;
const X0 = -1.35;
/** Each foot's own line on the floor (a little out from the hip). */
const FOOT_Z = [0.1, -0.1];
/** Door: the opening is 0.9 m wide and 2.0 m high, in a wall at x = 0 (the wall runs along z). */
const DOOR_W = 0.45;
const DOOR_H = 2.0;
const JAMB = 0.07;

const frac = (x: number) => x - Math.floor(x);

/** Where the centre of mass is along the walk at time t (constant speed). */
const along = (t: number) => X0 + V * t;

/** A placeholder: the walk is posed in `act`, from the floor up. */
const walker: Moves = {
  root: track([[0, [X0, 0.93, 0], 'lin'], [TG, [X0 + V * TG, 0.93, 0], 'lin']]),
  turn: track([[0, [PI / 2, 0, 0]]]),
  head: track([[0, [0.06, 0, 0]]]),
};

const spot = new THREE.Vector3();
const toes = new THREE.Vector3();
const up = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Pose the walker at time t: root, pelvis turn, chest counter-turn, arms; then the feet, each
 * planted for its stance or swinging to its next spot. Pure in t, so any frame stands alone.
 */
function walk(f: Figure, t: number) {
  // Both feet's phases (leg 1 half a stride behind leg 0).
  const p0 = frac(t / C);
  // The centre of mass is highest over a standing leg (mid-stance) and lowest between steps.
  const bob = Math.cos(2 * PI * (2 * t / C - STANCE));
  const x = along(t);
  // A little sway towards the leg that is standing (leg 0's side at its mid-stance).
  const sway = 0.018 * Math.cos(2 * PI * (t / C - STANCE / 2));
  f.root.set(x, 0.948 + 0.017 * bob, sway * (FOOT_Z[0] > 0 ? 1 : -1));
  // The pelvis turns with the stride (the forward leg's hip goes forward); the chest turns back.
  const twist = 0.07 * Math.sin(2 * PI * p0);
  f.turn.setFromEuler(euler.set(0.03, PI / 2 + twist, 0));
  f.chest.setFromEuler(euler.set(0.02, -twist * 1.4, 0));
  f.head.setFromEuler(euler.set(0.05 - 0.02 * bob, twist * 0.4, 0));
  // Arms swing against the legs: arm 0 forward when leg 1 is forward. Elbows point back.
  for (let a = 0; a < 2; a++) {
    const s = a === 0 ? -1 : 1;
    const swing = Math.sin(2 * PI * (p0 + (a === 0 ? 0.5 : 0)) - 0.3);
    f.body(s * 0.25, -0.17 + 0.03 * Math.max(0, swing), 0.2 * swing + 0.02, f.arms[a].target);
    f.bodyDir(s * 0.15, 0, -1, f.arms[a].pole);
    f.arms[a].weight = 0;
  }
  // Feet: stance on its spot, then a swing to the next one.
  for (let l = 0; l < 2; l++) {
    const off = l === 0 ? 0 : 0.5;
    const cyc = t / C + off;
    const n = Math.floor(cyc);
    const p = cyc - n;
    // The spot of stance n: under the centre of mass at mid-stance.
    const spotAt = (k: number) => X0 + V * (k - off + STANCE / 2) * C;
    const z = FOOT_Z[l];
    if (p < STANCE) {
      // Standing. Late in the stance the heel lifts (rolls onto the toes).
      const roll = 0.45 * ramp(p, STANCE - 0.16, STANCE);
      const fx = spotAt(n);
      toes.set(Math.cos(roll), -Math.sin(roll), 0);
      up.set(Math.sin(roll), Math.cos(roll), 0);
      // Turning about the ball of the foot (0.13 m ahead of the ankle) lifts the ankle.
      spot.set(fx + 0.13 * (1 - Math.cos(roll)), 0.13 * Math.sin(roll), z);
      plant(f, l, spot, toes, up, 1);
    } else {
      // Swinging: from this spot to the next, lifted in the middle; toes down at the start, up at heel strike.
      const s = (p - STANCE) / (1 - STANCE);
      const e = s * s * (3 - 2 * s);
      const fx = spotAt(n) + (spotAt(n + 1) - spotAt(n)) * e;
      const pitch = 0.45 * (1 - ramp(s, 0, 0.45)) - 0.22 * ramp(s, 0.55, 0.92) * (1 - ramp(s, 0.95, 1));
      const lift = 0.075 * Math.sin(PI * Math.min(1, s * 1.1)) + 0.13 * Math.sin(Math.max(0, pitch));
      toes.set(Math.cos(pitch), -Math.sin(pitch), 0);
      up.set(Math.sin(pitch), Math.cos(pitch), 0);
      spot.set(fx + 0.13 * (1 - Math.cos(pitch)) * (pitch > 0 ? 1 : 0), lift, z);
      plant(f, l, spot, toes, up, 1);
      // A swinging leg only touches the floor at its ends: not a contact for the check.
      if (s > 0.08 && s < 0.92) f.legs[l].weight = 0.49;
    }
    f.bodyDir(0, 0, 1, f.legs[l].pole);
  }
}

// ---- Weightless: through a hatch ----

const TW = 3.2;
const HATCH = 0.5; // half the opening (1.0 m square), centred at y = 1.0
const HY = 1.0;
const o = HATCH + 0.11; // the frame's outer edge
const W = 1.6; // the bulkhead's half size (past the edges of the view)
/** Gliding speed before the pull, and how much the pull on the hatch adds. */
const V0 = 0.8;
const DV = 0.16;
const PULL_A = 1.05;
const PULL_B = 1.75;
const XW0 = -1.05;

/** Where the centre of mass is: a glide, a small pull while the hand holds the hatch, a faster glide. */
function glideX(t: number): number {
  const w = PULL_B - PULL_A;
  const u = Math.min(1, Math.max(0, (t - PULL_A) / w));
  const extra = t <= PULL_A ? 0 : t >= PULL_B ? w * 0.5 + (t - PULL_B) : w * (u * u * u - (u * u * u * u) / 2);
  return XW0 + V0 * t + DV * extra;
}

// Head first along +x, face down: yaw a quarter turn (front to +x), then pitched forward a quarter.
const glidePath: KeyIn[] = [];
for (let i = -6; i <= 34; i++) glidePath.push([i * 0.1, [glideX(i * 0.1), HY, 0]]);

const floater: Moves = {
  root: track(glidePath),
  turn: track([[0, [PI / 2, PI / 2 - 0.08, 0]]]),
  chest: track([[0, [-0.06, 0, 0]]]),
  // The head lifts to look ahead, through the hatch.
  head: track([[0, [-0.5, 0, 0]], [1.6, [-0.42, 0, 0]], [TW, [-0.45, 0, 0]]]),
  hands: [
    // The near hand reaches ahead for the hatch; after letting go it comes forward again.
    track([[0, [-0.17, 1.0, 0.08], 'still'], [0.6, [-0.24, 0.98, 0.1]], [2.0, [-0.3, -0.05, 0.22]], [2.6, [-0.24, 0.7, 0.16]], [TW, [-0.2, 0.95, 0.14], 'still']]),
    // The far hand rides along the body.
    track([[0, [0.24, -0.16, 0.06]], [1.4, [0.25, -0.12, 0.08]], [TW, [0.24, -0.16, 0.06]]]),
  ],
  elbows: [track([[0, [-1, 0.2, -0.4]]]), track([[0, [1, 0, -0.3]]])],
  feet: [track([[0, [-0.07, -0.86, -0.05]], [1.9, [-0.08, -0.84, -0.09]], [TW, [-0.07, -0.86, -0.05]]]), track([[0, [0.08, -0.85, -0.1]], [1.9, [0.07, -0.86, -0.06]], [TW, [0.08, -0.85, -0.1]]])],
  knees: [track([[0, [-0.1, 0, 1]]]), track([[0, [0.1, 0, 1]]])],
  ankles: [track([[0, [0.75, 0, 0]]]), track([[0, [0.7, 0, 0]]])],
};

const grip = new THREE.Vector3();
const fingers = new THREE.Vector3(0, 0.25, 1).normalize();
const into = new THREE.Vector3(-1, 0, 0);
const ring = new THREE.Vector3();

export const v05: Move = {
  id: 'V05',
  name: 'V05-leave-the-room',
  summary: 'Walks from one room to another through a door; without gravity, glides through a hatch, guided by one hand on its edge.',
  params: {},
  medical: false,
  reviewed: false,
  questions: [],
  variants: {
    weightless: (world) => gesture(world, {
      duration: TW,
      loop: 'seam',
      gravity: 'weightless',
      cast: [{ moves: floater }],
      // The hatch: a solid square frame with depth (it hides what is behind it), in a bulkhead
      // drawn as a faint outline only (cut away, so both rooms stay in view).
      props: (w) => {
        const d = 0.07;
        const ringBoxes: [number, number, number, number, number, number][] = [
          [-d, HY + HATCH, -o, d, HY + o, o], [-d, HY - o, -o, d, HY - HATCH, o],
          [-d, HY - HATCH, HATCH, d, HY + HATCH, o], [-d, HY - HATCH, -o, d, HY + HATCH, -HATCH],
        ];
        return [
          new Prop(w, (pen) => {
            for (const x of [-d, d]) {
              pen.rectYZ(HY - HATCH, -HATCH, HY + HATCH, HATCH, x);
              pen.rectYZ(HY - o, -o, HY + o, o, x);
            }
            for (const [y, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) pen.seg(-d, HY + y * HATCH, z * HATCH, d, HY + y * HATCH, z * HATCH);
          }, { strength: 0.85, width: 1.8, boxes: ringBoxes }),
          // The bulkhead, solid: the body is hidden behind it until it comes through the hatch.
          new Prop(w, (pen) => {
            pen.rectYZ(HY - W, -W, HY + W, W, 0);
          }, { strength: 0.25, width: 1.2, boxes: [
            [-0.02, HY + o, -W, 0.02, HY + W, W], [-0.02, HY - W, -W, 0.02, HY - o, W],
            [-0.02, HY - o, o, 0.02, HY + o, W], [-0.02, HY - o, -W, 0.02, HY + o, -o],
          ] }),
        ];
      },
      marks: { contacts: 1 },
      act: (t, [f], _props, marks) => {
        // The near hand holds the hatch's near edge, on its far face, and pulls a little as the body slides past.
        const hold = ramp(t, PULL_A - 0.25, PULL_A) * (1 - ramp(t, PULL_B, PULL_B + 0.25));
        grip.set(0.075, HY - 0.04, HATCH + 0.05);
        reach(f, 0, grip, fingers, into, hold);
        if (marks) marks.contacts[0].show(ring.copy(grip), 0.06, 0.8 * ramp(t, PULL_A - 0.05, PULL_A + 0.1) * (1 - ramp(t, PULL_B - 0.1, PULL_B + 0.05)));
      },
      camera: { target: [0.55, 0.95, 0], yaw: 0.95, pitch: 0.16, extent: 2.5, span: 2.8 },
      keys: [0.4, 1.4, 2.6],
    }),
    gravity: (world) => gesture(world, {
      duration: TG,
      loop: 'seam',
      gravity: 'gravity',
      cast: [{ moves: walker }],
      // A door frame (solid, it hides what is behind it) in a wall: the far side of the wall solid,
      // the near side drawn as a faint outline only (cut away, so the walk stays in view).
      props: (w) => {
        const frame: [number, number, number, number, number, number][] = [
          [-JAMB, 0, DOOR_W, JAMB, DOOR_H, DOOR_W + 0.08],
          [-JAMB, 0, -DOOR_W - 0.08, JAMB, DOOR_H, -DOOR_W],
          [-JAMB, DOOR_H, -DOOR_W - 0.08, JAMB, DOOR_H + 0.08, DOOR_W + 0.08],
        ];
        const far: [number, number, number, number, number, number] = [-0.05, 0, -DOOR_W - 1.0, 0.05, DOOR_H + 0.4, -DOOR_W - 0.08];
        return [
          new Prop(w, (pen) => { for (const b of frame) pen.box(...b); }, { strength: 0.85, width: 1.7, boxes: frame }),
          new Prop(w, (pen) => {
            pen.box(...far);
            pen.rectYZ(0, DOOR_W + 0.08, DOOR_H + 0.4, DOOR_W + 1.0, 0);
            pen.seg(0, DOOR_H + 0.4, -DOOR_W - 0.08, 0, DOOR_H + 0.4, DOOR_W + 0.08);
          }, { strength: 0.3, width: 1.2, boxes: [far] }),
        ];
      },
      act: (t, [f]) => walk(f, t),
      camera: { target: [0, 1.0, 0], yaw: 0.32, pitch: 0.14, extent: 2.5, span: 3.3 },
      keys: [0.3, 1.6, 2.8],
    }),
  },
};
