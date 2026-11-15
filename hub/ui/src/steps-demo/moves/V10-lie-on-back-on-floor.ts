// V10 lie on the back on the floor. Her description: "WITH gravity. Lays another
// character on their back on a firm surface and kneels beside them."
//
// Her answer 14 (videos-answers.md, 14 Nov): "Lower the person slowly from
// sitting, supporting the head, then lay them flat on a firm surface."
//
// Drawn here, and nothing more: the person sits on the floor, legs out in front,
// limp; the rescuer kneels at their right side with one hand behind the head and
// the other behind the upper back, and lowers them slowly backwards about the
// hips until they lie flat; the hands come out from behind them as the head
// touches down, and the rescuer straightens up, kneeling beside them. Only the
// head support and the slow lowering are hers; which side the rescuer kneels on
// and where the second hand goes are not stated, so they are asked
// (`questions`). The floor is the firm surface.

import * as THREE from 'three';
import { CHEST, HEAD, THIGH, gesture, plant, reach, ramp, smooth, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Move } from '../step.ts';

const T = 4.0;
/** The lowering: from sitting (0) to flat on the back (1), slow, between these times. */
const DOWN_FROM = 0.35, DOWN_TO = 2.55;
/** The patient's hip joints, which stay put on the floor: the body turns about them. */
const HIP = new THREE.Vector3(0, 0.085, 0);
/** How far back the body has gone (radians from upright) at loop time t. */
function tilt(t: number): number {
  return (Math.PI / 2) * smooth(ramp(t, DOWN_FROM, DOWN_TO));
}

// Facing +x (legs out along +x); the right side (arm and leg 0) is towards +z, where the rescuer kneels.
const patient: Moves = {
  root: track([[0, [0, 0.135, 0]]]),
  turn: track([[0, [Math.PI / 2, 0, 0]]]),
  chest: track([[0, [0.06, 0, 0]], [DOWN_TO, [0, 0, 0]]]),
  // Limp: the head drops a little forward while held, and lies straight once down.
  head: track([[0, [0.22, 0, 0], 'still'], [DOWN_TO - 0.4, [0.08, 0, 0]], [DOWN_TO + 0.1, [0, 0, 0], 'still']]),
  elbows: [track([[0, [-1, 0, -0.4]]]), track([[0, [1, 0, -0.4]]])],
  wrists: [track([[0, [0.3, 0, 0]]]), track([[0, [0.3, 0, 0]]])],
  ankles: [track([[0, [0.6, 0, 0]]]), track([[0, [0.6, 0, 0]]])],
};

// The rescuer kneels on the patient's right (+z), facing them (-z), level with their shoulders.
const KNEEL_X = -0.3;
const rescuer: Moves = {
  root: track([[0, [KNEEL_X + 0.14, 0.47, 0.5], 'still'], [DOWN_FROM, [KNEEL_X + 0.14, 0.47, 0.5]], [DOWN_TO - 0.3, [KNEEL_X - 0.12, 0.34, 0.5]], [DOWN_TO + 0.2, [KNEEL_X - 0.12, 0.34, 0.52], 'still'], [3.3, [KNEEL_X, 0.5, 0.6], 'still'], [T, [KNEEL_X, 0.5, 0.6], 'still']]),
  // Leans forward and turns towards the head as the person goes down; upright at the end.
  turn: track([[0, [Math.PI + 0.25, 0.25, 0], 'still'], [DOWN_FROM, [Math.PI + 0.25, 0.25, 0]], [DOWN_TO - 0.2, [Math.PI + 0.5, 0.62, 0]], [DOWN_TO + 0.2, [Math.PI + 0.5, 0.62, 0], 'still'], [3.3, [Math.PI + 0.1, 0.05, 0], 'still'], [T, [Math.PI + 0.1, 0.05, 0], 'still']]),
  chest: track([[0, [0.15, 0, 0], 'still'], [DOWN_TO - 0.2, [0.35, 0, 0]], [DOWN_TO + 0.2, [0.35, 0, 0], 'still'], [3.3, [0.05, 0, 0], 'still'], [T, [0.05, 0, 0], 'still']]),
  head: track([[0, [0.35, 0, 0], 'still'], [DOWN_TO, [0.3, 0, 0]], [3.3, [0.3, 0, 0], 'still'], [T, [0.3, 0, 0], 'still']]),
  // Free hands come to rest on the thighs at the end.
  hands: [track([[0, [-0.12, -0.28, 0.3]]]), track([[0, [0.12, -0.28, 0.3]]])],
  elbows: [track([[0, [-1, -0.4, -0.3]]]), track([[0, [1, -0.4, -0.3]]])],
  overlap: 0.4,
};

const q = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const up = new THREE.Vector3();
const p1 = new THREE.Vector3();
const fingers = new THREE.Vector3();
const into = new THREE.Vector3();
const floorDown = new THREE.Vector3(0, -1, 0);
const floorUp = new THREE.Vector3(0, 1, 0);
const toesBack = new THREE.Vector3(0, 0, 1);
const toesFwd = new THREE.Vector3(1, 0, 0);
const spot = new THREE.Vector3();
const across = new THREE.Vector3(0, 0, -1);
const mid = new THREE.Vector3();
const shoulders = new THREE.Vector3();
/** From the middle of the two hands to the middle of the rescuer's shoulders: above, and back towards the rescuer. */
const REACH = new THREE.Vector3(-0.02, 0.27, 0.33);

/** The person: turned back by the tilt about the hips, legs flat along the floor, hands resting on it. */
function lay(p: Figure, t: number) {
  const a = tilt(t);
  p.turn.setFromEuler(euler.set(-a, Math.PI / 2, 0));
  up.set(0, 0.05, 0).applyQuaternion(p.turn);
  p.root.copy(HIP).add(up);
  p.solve();
  for (let l = 0; l < 2; l++) {
    const s = l === 0 ? 1 : -1;
    const leg = p.legs[l];
    leg.target.set(0.8, 0.07, s * 0.11);
    leg.pole.set(0, 1, 0);
  }
  // Hands limp on the floor beside the hips, palms down.
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    reach(p, i, spot.set(0.06, 0.03, s * 0.27), toesFwd, floorDown, 1);
  }
}

export const v10: Move = {
  id: 'V10',
  name: 'V10-lie-on-back-on-floor',
  summary: 'With gravity. Lowers a person slowly from sitting onto their back on the floor, supporting the head, and kneels beside them.',
  params: {},
  medical: true,
  reviewed: false,
  source: 'Lowering from sitting while supporting the head: the medical lead’s answer 14 (14 Nov 2026). Nothing else is taken from a guideline.',
  questions: [
    'V10: which side does the rescuer kneel on, and where does the second hand go while lowering? (The animation shows the rescuer on the person’s right, one hand behind the head and one behind the upper back.)',
  ],
  variants: {
    gravity: (world) => gesture(world, {
      duration: T,
      loop: 'seam',
      gravity: 'gravity',
      cast: [{ moves: rescuer, role: 'actor' }, { moves: patient, role: 'other' }],
      act: (t, [r, p]: Figure[]) => {
        lay(p, t);
        // Kneeling: knees and the tops of the feet on the floor.
        for (let l = 0; l < 2; l++) {
          const s = l === 0 ? 1 : -1;
          plant(r, l, spot.set(KNEEL_X + s * 0.13, 0, 0.98), toesBack, floorDown, 1);
          r.legs[l].pole.set(0, -0.4, -1);
        }
        // The hands behind the head and the upper back, out from under them as the head lands.
        const hold = 1 - ramp(t, DOWN_TO - 0.15, DOWN_TO + 0.35);
        // While holding, the rescuer's shoulders follow the two hands down: the body is placed so the
        // middle of the shoulders stays a comfortable reach above and beside the middle of the hold.
        if (hold > 0) {
          p.restPoint(HEAD, 0, 1.6, -0.09, p1);
          p.restPoint(CHEST, -0.07, 1.3, -0.1, mid);
          mid.add(p1).multiplyScalar(0.5).add(REACH);
          shoulders.set(0, 0.32, 0).applyQuaternion(r.chest);
          shoulders.y += 0.095;
          shoulders.applyQuaternion(r.turn);
          r.root.lerp(mid.sub(shoulders), smooth(hold));
        }
        p.restPoint(HEAD, 0, 1.6, -0.09, p1);
        fingers.set(0, 1, 0).applyQuaternion(p.q[HEAD]);
        into.set(0, 0, 1).applyQuaternion(p.q[HEAD]);
        reach(r, 1, p1, fingers, into, hold);
        p.restPoint(CHEST, -0.07, 1.3, -0.1, p1);
        into.set(0, 0, 1).applyQuaternion(p.q[CHEST]);
        reach(r, 0, p1, across, into, hold);
        // Once upright again, the hands rest on the thighs.
        const rest = ramp(t, 3.0, 3.35);
        for (let a = 0; a < 2; a++) {
          if (rest <= 0) break;
          const s = a === 0 ? -1 : 1;
          r.restPoint(THIGH(a), s * 0.09, 0.72, 0.075, p1);
          fingers.set(0, -1, 0).applyQuaternion(r.q[THIGH(a)]);
          reach(r, a, p1, fingers, floorDown, rest);
        }
        void q; void floorUp;
      },
      camera: { target: [-0.05, 0.42, 0.2], yaw: 2.3, pitch: 0.4, extent: 1.5, span: 2.1 },
      keys: [0.2, 1.5, 3.6],
    }),
  },
};
