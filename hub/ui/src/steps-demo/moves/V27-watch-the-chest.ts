// V27 watch the chest. Her description: "Watches the chest of the character
// lying down rise and fall, counting 10 seconds." Two figures: one lies on
// their back on the floor and breathes (the chest rises and falls); the other
// kneels beside them, level with the chest, and watches it, the head turned
// to it. A small arrow over the chest goes up as it rises and down as it
// falls.
//
// Not drawn: the counting (no text, no numbers inside the animation, by her
// rule); nothing about what to do with the result. One breath per loop is the
// least her 3-second loop allows (about 19 a minute); the rate is asked
// (questions), not taken as a medical statement. Which side the watcher
// kneels on is not stated: the person's right, as in V10.
//
// With gravity only for now: where the person lies without gravity, and how
// the watcher holds on, are asked (as for V07).

import * as THREE from 'three';
import { CHEST, THIGH, gesture, plant, reach, cycle, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import type { Move } from '../step.ts';

const T = 3.2;

// On the back along x, head towards -x, face up: body x to world -z, body up to world -x, body front to world +y.
// Their right side (body -x, arm and leg 0) is towards +z, where the watcher kneels.
const LYING = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));

const person: Moves = {
  orient: LYING,
  root: track([[0, [0, 0.09, 0]]]),
  turn: track([[0, [0, 0, 0]]]),
  // The chest lifts a little on the hips as it fills (pitch > 0 lifts it, lying on the back).
  chest: cycle([[0, [0, 0, 0], 'still'], [1.25, [0.03, 0, 0], 'still'], [2.75, [0, 0, 0], 'still']], T),
  head: cycle([[0, [-0.03, 0, 0], 'still'], [1.25, [-0.06, 0, 0], 'still'], [2.75, [-0.03, 0, 0], 'still']], T),
  // Arms beside the body and legs straight, resting on the floor (body -z is down).
  hands: [track([[0, [-0.27, -0.43, -0.045]]]), track([[0, [0.27, -0.43, -0.045]]])],
  elbows: [track([[0, [-1, 0, -0.3]]]), track([[0, [1, 0, -0.3]]])],
  feet: [track([[0, [-0.1, -0.86, -0.035]]]), track([[0, [0.1, -0.86, -0.035]]])],
  knees: [track([[0, [-0.1, 0, 1]]]), track([[0, [0.1, 0, 1]]])],
  ankles: [track([[0, [0.5, 0, 0]]]), track([[0, [0.5, 0, 0]]])],
};

// The watcher kneels at the person's right (+z), level with the chest, facing them (-z).
const KX = -0.4;
const watcher: Moves = {
  root: cycle([[0, [KX, 0.5, 0.56]], [T / 2, [KX, 0.502, 0.558]]], T),
  turn: track([[0, [Math.PI, 0.45, 0]]]),
  chest: track([[0, [0.22, 0, 0]]]),
  // Looks down at the chest, following it a little as it rises and falls.
  head: cycle([[0, [0.5, -0.1, 0], 'still'], [1.25, [0.46, -0.1, 0], 'still'], [2.75, [0.5, -0.1, 0], 'still']], T),
  elbows: [track([[0, [-1, -0.4, -0.3]]]), track([[0, [1, -0.4, -0.3]]])],
  overlap: 0,
};

const spot = new THREE.Vector3(), toesBack = new THREE.Vector3(0, 0, 1), floorDown = new THREE.Vector3(0, -1, 0);
const lap = new THREE.Vector3(), fingers = new THREE.Vector3();
const from = new THREE.Vector3(), to = new THREE.Vector3(), chest = new THREE.Vector3();

export const v27: Move = {
  id: 'V27',
  name: 'V27-watch-the-chest',
  summary: 'Kneels beside a person lying on their back and watches their chest rise and fall.',
  params: {},
  medical: true,
  reviewed: false,
  questions: [
    'V27: the person breathes once every 3.2 seconds (about 19 a minute) so that one breath fits the loop. Is that right, or should it be slower?',
    'V27, no gravity: where is the person lying, and how does the watcher hold on? (The same question as for V07.)',
  ],
  variants: {
    gravity: (world) => gesture(world, {
      duration: T,
      gravity: 'gravity',
      cast: [{ moves: watcher, role: 'actor' }, { moves: person, role: 'actor' }],
      marks: { arrows: 1 },
      act: (t, [w, p]: Figure[], _props, marks) => {
        // Kneeling: knees and the tops of the feet on the floor, shins back.
        for (let l = 0; l < 2; l++) {
          const s = l === 0 ? 1 : -1;
          plant(w, l, spot.set(KX + s * 0.12, 0, 0.98), toesBack, floorDown, 1);
          w.legs[l].pole.set(0, -0.4, -1);
        }
        // Hands resting on the thighs.
        for (let a = 0; a < 2; a++) {
          const s = a === 0 ? -1 : 1;
          w.restPoint(THIGH(a), s * 0.09, 0.72, 0.075, lap);
          fingers.set(0, -1, 0).applyQuaternion(w.q[THIGH(a)]);
          reach(w, a, lap, fingers, floorDown, 1);
        }
        if (!marks) return;
        // Over the chest: an arrow up while it rises, down while it falls.
        const rising = t < 1.25;
        const amount = rising ? Math.sin(Math.PI * t / 1.25) : t < 2.75 ? Math.sin(Math.PI * (t - 1.25) / 1.5) : 0;
        p.restPoint(CHEST, 0, 1.28, 0.095, chest);
        // A little to the camera's side of the breastbone, clear of the watcher's arms.
        chest.z -= 0.11;
        from.copy(chest); to.copy(chest);
        from.y += rising ? 0.08 : 0.23;
        to.y += rising ? 0.23 : 0.08;
        marks.arrows[0].show(from, to, 0.045, 0.9 * amount);
      },
      camera: { target: [-0.2, 0.45, 0.25], yaw: 2.6, pitch: 0.32, extent: 1.3, span: 1.6 },
      keys: [0.2, 1.25, 2.4],
    }),
  },
};
