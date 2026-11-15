// V28 cover the person. Her description: "Covers the character lying down with
// a blanket." Two figures: one lies on their back on the floor; the other
// kneels beside them, holding the blanket's near edge spread out over them,
// lowers it until it lies over the body from the shoulders to past the feet,
// lets go, and rests the hands on the thighs.
//
// Not stated, and kept to the least: the blanket stops at the shoulders, the
// head stays uncovered; nothing is tucked in. Which side the helper kneels on
// is not stated: the person's right, as in V10 and V27.
//
// With gravity only for now: where the person lies without gravity, and how
// the helper holds on, are asked (as for V07). The loop does not come back:
// the last half second dissolves into the next round.

import * as THREE from 'three';
import { Prop, THIGH, gesture, plant, ramp, reach, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Move } from '../step.ts';
import type { World } from '../world.ts';

const T = 3.4;
/** The blanket comes down, then the hands let go and go to the thighs. */
const DOWN_A = 0.3, DOWN_B = 1.9;
const LET_GO = 1.62, REST = 2.5;
/** How high the blanket is held above where it ends (metres), at the start. */
const LIFT = 0.42;

// On the back along x, head towards -x, face up: body x to world -z, body up to world -x, body front to world +y.
const LYING = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));

const person: Moves = {
  orient: LYING,
  root: track([[0, [0, 0.09, 0]]]),
  turn: track([[0, [0, 0, 0]]]),
  head: track([[0, [-0.04, 0, 0]]]),
  hands: [track([[0, [-0.27, -0.43, -0.045]]]), track([[0, [0.27, -0.43, -0.045]]])],
  elbows: [track([[0, [-1, 0, -0.3]]]), track([[0, [1, 0, -0.3]]])],
  feet: [track([[0, [-0.1, -0.89, -0.035]]]), track([[0, [0.1, -0.89, -0.035]]])],
  knees: [track([[0, [-0.1, 0, 1]]]), track([[0, [0.1, 0, 1]]])],
  ankles: [track([[0, [0.3, 0, 0]]]), track([[0, [0.3, 0, 0]]])],
};

// The blanket where it ends: over the body from the shoulders (x = -0.42) to past the feet (x = 1.12),
// 1.1 m wide; its height follows the body down the middle and falls to the floor at the sides.
const X0 = -0.42, X1 = 1.12, HALF = 0.55;
/** The body's top along it (chest, hips, shins, toes up). */
function top(x: number): number {
  const keys: [number, number][] = [[-0.42, 0.205], [-0.15, 0.205], [0.05, 0.185], [0.4, 0.18], [0.62, 0.15], [0.78, 0.15], [0.88, 0.25], [1.03, 0.25], [1.12, 0.03]];
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const [xa, ya] = keys[i - 1], [xb, yb] = keys[i];
      const u = (x - xa) / (xb - xa), e = u * u * (3 - 2 * u);
      return ya + (yb - ya) * e;
    }
  }
  return keys[keys.length - 1][1];
}
/** Across: on the body in the middle, falling to the floor at the sides. */
function across(z: number): number {
  const u = Math.min(1, Math.max(0, (Math.abs(z) - 0.3) / 0.22));
  return 1 - u * u * (3 - 2 * u);
}
const height = (x: number, z: number) => Math.max(0.006, top(x) * across(z) + 0.045);

/** Solid blocks under the blanket, in steps that stay just under it, so the covered body is hidden. */
function under(): [number, number, number, number, number, number][] {
  const out: [number, number, number, number, number, number][] = [];
  const bands = [0, 0.1, 0.2, 0.27, 0.34, 0.41, 0.5];
  for (let x = X0 + 0.01; x < X1 - 0.04; x += 0.06) {
    const xb = Math.min(X1 - 0.04, x + 0.06);
    for (let j = 0; j < bands.length - 1; j++) {
      let h = Infinity;
      for (let i = 0; i <= 4; i++) for (let m = 0; m <= 2; m++) h = Math.min(h, height(x + ((xb - x) * i) / 4, bands[j] + ((bands[j + 1] - bands[j]) * m) / 2));
      h -= 0.003;
      if (h < 0.01) continue;
      out.push([x, 0, bands[j], xb, h, bands[j + 1]], [x, 0, -bands[j + 1], xb, h, -bands[j]]);
    }
  }
  return out;
}

function blanket(world: World): Prop {
  return new Prop(world, (pen) => {
    const nx = 18, nz = 14;
    const row = (z: number) => { const pts: [number, number, number][] = []; for (let i = 0; i <= nx; i++) { const x = X0 + ((X1 - X0) * i) / nx; pts.push([x, height(x, z), z]); } pen.path(pts); };
    const col = (x: number) => { const pts: [number, number, number][] = []; for (let j = 0; j <= nz; j++) { const z = -HALF + (2 * HALF * j) / nz; pts.push([x, height(x, z), z]); } pen.path(pts); };
    for (const z of [-HALF, -0.32, -0.12, 0.12, 0.32, HALF]) row(z);
    for (const x of [X0, -0.05, 0.4, 0.75, X1]) col(x);
  }, {
    strength: 0.95, width: 1.8,
    // Solid underneath, so the covered body is hidden.
    boxes: under(),
  });
}

// The helper kneels at the person's right (+z), by the hips, facing them (-z).
const KX = 0.18;
const HALF_IN = HALF - 0.02;
const helper: Moves = {
  root: track([[0, [KX, 0.52, 0.8], 'still'], [DOWN_A, [KX, 0.52, 0.8]], [DOWN_B - 0.3, [KX, 0.43, 0.69], 'still'], [DOWN_B, [KX, 0.43, 0.69], 'still'], [REST, [KX, 0.52, 0.82], 'still'], [T, [KX, 0.52, 0.82], 'still']]),
  turn: track([[0, [Math.PI, 0.3, 0], 'still'], [DOWN_A, [Math.PI, 0.3, 0]], [DOWN_B - 0.3, [Math.PI, 0.82, 0], 'still'], [DOWN_B, [Math.PI, 0.82, 0], 'still'], [REST, [Math.PI, 0.15, 0], 'still'], [T, [Math.PI, 0.15, 0], 'still']]),
  chest: track([[0, [0.1, 0, 0], 'still'], [DOWN_B, [0.3, 0, 0], 'still'], [REST, [0.05, 0, 0], 'still'], [T, [0.05, 0, 0], 'still']]),
  head: track([[0, [0.35, 0, 0], 'still'], [DOWN_B, [0.3, 0, 0]], [REST, [0.4, 0, 0], 'still'], [T, [0.4, 0, 0], 'still']]),
  hands: [track([[0, [-0.2, -0.25, 0.35]]]), track([[0, [0.2, -0.25, 0.35]]])],
  elbows: [track([[0, [-1, -0.5, -0.2]]]), track([[0, [1, -0.5, -0.2]]])],
  overlap: 0.3,
};

/** The two places on the near edge the hands hold (x along the body), on the edge at z = HALF. */
const HOLD_X = [0.42, -0.06];

const spot = new THREE.Vector3(), toesBack = new THREE.Vector3(0, 0, 1), floorDown = new THREE.Vector3(0, -1, 0);
const grip = new THREE.Vector3(), fingers = new THREE.Vector3(), thighDown = new THREE.Vector3(), lap = new THREE.Vector3();

export const v28: Move = {
  id: 'V28',
  name: 'V28-cover-the-person',
  summary: 'Kneels beside a person lying on their back and covers them with a blanket, from the shoulders down.',
  params: {},
  medical: false,
  reviewed: false,
  questions: [
    'V27, V28, no gravity: where is the person lying, and how does the helper hold on? (The same question as for V07.)',
  ],
  variants: {
    gravity: (world) => gesture(world, {
      duration: T,
      loop: 'seam',
      gravity: 'gravity',
      cast: [{ moves: helper, role: 'actor' }, { moves: person, role: 'actor' }],
      props: (w) => [blanket(w)],
      act: (t, [h]: Figure[], [b]) => {
        // Kneeling: knees and the tops of the feet on the floor, shins back.
        for (let l = 0; l < 2; l++) {
          const s = l === 0 ? 1 : -1;
          plant(h, l, spot.set(KX + s * 0.12, 0, 1.25), toesBack, floorDown, 1);
          h.legs[l].pole.set(0, -0.4, -1);
        }
        // The blanket: held up and nearly flat, it comes down and takes the body's shape. Scaling its
        // height about the floor while lowering it keeps it clear of the body all the way down.
        const k = ramp(t, DOWN_A, DOWN_B);
        const lift = LIFT * (1 - k);
        const sy = 1 - (lift / LIFT) * 0.85;
        b.object.position.set(0, lift, 0);
        b.object.scale.set(1, sy, 1);
        // The hands hold the near edge, palms on top, until it is down; then they go to the thighs and rest.
        const rest = ramp(t, LET_GO, REST);
        for (let a = 0; a < 2; a++) {
          const s = a === 0 ? -1 : 1;
          grip.set(HOLD_X[a], lift + sy * height(HOLD_X[a], HALF_IN) + 0.004, HALF_IN);
          h.restPoint(THIGH(a), s * 0.09, 0.72, 0.075, lap);
          grip.lerp(lap, rest);
          // A small lift on the way, clear of the blanket's edge.
          grip.y += 0.06 * Math.sin(Math.PI * rest);
          fingers.set(0, -0.3, -1).lerp(thighDown.set(0, -1, 0).applyQuaternion(h.q[THIGH(a)]), rest).normalize();
          reach(h, a, grip, fingers, floorDown, 1);
        }
      },
      camera: { target: [0.12, 0.42, 0.3], yaw: 2.55, pitch: 0.42, extent: 1.5, span: 1.95 },
      keys: [0.2, 1.2, 3.0],
    }),
  },
};
