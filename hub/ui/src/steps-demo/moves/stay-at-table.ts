// Move "stay-at-table" (weightless): arrive at a galley table with someone,
// both hold position (feet under the table's foot bar) and stay together.
// Parameters: room (a galley; authored in the ship's Galley), helper, person.
//
// Move to the Galley and stay with her. The two come in from the
// Exercise bay already gliding, Okafor ahead with Reyes's arm in his hand. He
// reaches ahead for the table and catches its edge; his arm takes the stop
// (the elbow gives) and his legs swing on past, then come down and hook under
// the table's foot bar. She arrives a beat later, slowed through the arm he
// holds, swings round her middle, takes the table edge herself and hooks her
// feet too. His hand moves to her shoulder, and they stay.
//
// The story's own beats (the scenario: "Okafor gets Reyes out to the galley",
// "Okafor goes with her"), not a medical instruction.

import * as THREE from 'three';
import { ramp, track } from '../anim.ts';
import { palmOf, plant, reach } from '../cast.ts';
import type { Character, Moves } from '../cast.ts';
import { UPPER } from '../rig.ts';
import { ACTOR, OTHER, Pair, headTag, seam, tag } from '../step.ts';
import type { Clip, Move, Params } from '../step.ts';
import { Contact } from '../world.ts';
import type { World } from '../world.ts';

const T = 4.8;
/** The galley table's top and far edge, and its foot bar (galley furniture, place frame). */
const TOP = -0.7;
const EDGE = -1.05;
const BAR_Y = -1.72;
const Z = -1.24;

const okafor: Moves = {
  root: track([
    [0, [-0.5, -0.86, Z], 'lin'], [0.75, [-1.1, -0.88, Z], 'lin'], [1.15, [-1.52, -0.89, Z]], [1.6, [-1.93, -0.9, Z]], [1.95, [-2.0, -0.93, Z]], [2.45, [-1.96, -1.04, Z], 'still'],
    [3.6, [-1.96, -1.03, Z], 'still'], [T, [-1.96, -1.04, Z], 'still'],
  ]),
  turn: track([
    [0, [0, 0.06, 0.16], 'lin'], [0.8, [0, 0.06, 0.16]], [1.35, [0, 0.08, -0.06]], [1.8, [0, 0.1, -0.2]], [2.3, [0.2, 0.08, 0.03]], [2.8, [0.4, 0.07, 0], 'still'], [T, [0.4, 0.07, 0], 'still'],
  ]),
  chest: track([[0, [0.02, 0, 0.04]], [1.3, [0.05, 0, -0.08]], [2.2, [0.05, 0.05, 0.02]], [3.0, [0.06, 0.12, 0]], [T, [0.06, 0.12, 0]]]),
  head: track([[0, [0.0, -0.5, 0]], [1.0, [0.08, -0.35, 0]], [1.7, [0.1, 0.0, 0]], [2.4, [0.05, 0.2, 0]], [2.9, [0.1, 0.25, 0], 'still'], [T, [0.1, 0.25, 0], 'still']]),
  hands: [
    track([[0, [-0.32, 0.15, 0.25]], [0.7, [-0.52, 0.2, 0.3]], [1.0, [-0.55, 0.1, 0.32]]]),
    track([[0, [0.36, 0.0, 0.05]]]),
  ],
  elbows: [track([[0, [-1, -0.3, -0.6]]]), track([[0, [0.8, -0.6, -0.6]]])],
  feet: [
    track([[0, [0.02, -0.74, 0.02], 'lin'], [1.0, [0.0, -0.74, 0.04]], [1.6, [-0.22, -0.74, 0.12]], [2.2, [-0.12, -0.8, 0.16]]]),
    track([[0, [0.22, -0.7, -0.04], 'lin'], [1.0, [0.2, -0.7, -0.02]], [1.65, [-0.02, -0.74, 0.1]], [2.3, [0.08, -0.8, 0.16]]]),
  ],
  ankles: [track([[0, [0.55, 0, 0]], [2.0, [0.3, 0, 0]]]), track([[0, [0.6, 0, 0]], [2.0, [0.3, 0, 0]]])],
  overlap: 1.2,
};

const reyes: Moves = {
  root: track([
    [0, [0.26, -0.84, Z - 0.02], 'lin'], [0.9, [-0.46, -0.86, Z - 0.01], 'lin'], [1.35, [-0.8, -0.88, Z]], [1.85, [-1.12, -0.9, Z]], [2.25, [-1.2, -0.93, Z]], [2.75, [-1.16, -1.05, Z], 'still'],
    [3.8, [-1.16, -1.04, Z], 'still'], [T, [-1.16, -1.05, Z], 'still'],
  ]),
  turn: track([
    [0, [0, 0.1, 0.22], 'lin'], [1.0, [0, 0.1, 0.22]], [1.6, [0, 0.1, 0.05]], [2.1, [0, 0.1, -0.22]], [2.6, [-0.2, 0.07, 0.03]], [3.1, [-0.32, 0.06, 0], 'still'], [T, [-0.32, 0.06, 0], 'still'],
  ]),
  chest: track([[0, [0.04, 0, 0]], [2.0, [0.06, 0, -0.06]], [3.0, [0.08, -0.05, 0]], [T, [0.08, -0.05, 0]]]),
  head: track([[0, [0.05, -0.15, 0]], [1.8, [0.1, -0.1, 0.05]], [2.8, [0.18, -0.12, 0], 'still'], [T, [0.18, -0.12, 0], 'still']]),
  hands: [
    track([[0, [-0.34, 0.18, 0.12]], [2.5, [-0.28, 0.16, 0.3]], [3.4, [-0.27, 0.2, 0.32]], [T, [-0.28, 0.17, 0.3]]]),
    track([[0, [0.3, 0.05, 0.22]], [1.6, [0.4, 0.12, 0.34]], [2.1, [0.36, 0.0, 0.34]]]),
  ],
  elbows: [track([[0, [-1, -0.5, -0.4]]]), track([[0, [1, -0.5, -0.5]]])],
  feet: [
    track([[0, [0.04, -0.74, -0.08], 'lin'], [1.4, [0.04, -0.74, -0.06]], [2.1, [-0.2, -0.74, 0.1]], [2.6, [-0.1, -0.8, 0.16]]]),
    track([[0, [0.22, -0.7, -0.12], 'lin'], [1.4, [0.22, -0.7, -0.1]], [2.15, [0.0, -0.74, 0.08]], [2.7, [0.1, -0.8, 0.16]]]),
  ],
  ankles: [track([[0, [0.5, 0, 0]], [2.4, [0.3, 0, 0]]]), track([[0, [0.55, 0, 0]], [2.4, [0.3, 0, 0]]])],
  overlap: 1.5,
};

const fingers = new THREE.Vector3();
const into = new THREE.Vector3();
const point = new THREE.Vector3();
const a1 = new THREE.Vector3();
const a2 = new THREE.Vector3();
const ahead = new THREE.Vector3(0, 0, 1);
const up = new THREE.Vector3(0, 1, 0);
const down = new THREE.Vector3(0, -1, 0);
const spot = new THREE.Vector3();
const AROUND = new THREE.Vector3(0, -0.3, 1);
const BACKWARD = new THREE.Vector3(0, 0.2, -1);

function act(o: Character, r: Character, t: number, w: number[]) {
  r.pose(t);
  // Her hand on the table edge, then her feet under the bar.
  const her = r.fig;
  w[2] = ramp(t, 1.95, 2.25);
  reach(her, 1, point.set(-0.86, TOP, EDGE + 0.06), fingers.set(0.15, 0, 1), down, w[2]);
  const hook2 = ramp(t, 2.25, 2.65);
  plant(her, 0, spot.set(-1.27, BAR_Y - 0.09, EDGE + 0.06), ahead, up, hook2);
  plant(her, 1, spot.set(-1.03, BAR_Y - 0.09, EDGE + 0.06), ahead, up, hook2);
  her.solve();
  o.pose(t);
  const f = o.fig;
  // His leading hand catches the table edge.
  w[1] = ramp(t, 0.92, 1.12);
  reach(f, 0, point.set(-2.1, TOP, EDGE + 0.08), fingers.set(-0.15, 0, 1), down, w[1]);
  // His trailing hand on her arm all the way, moving up to her shoulder once they are still.
  const move = ramp(t, 2.75, 3.15);
  her.restPoint(UPPER(0), -0.285, 1.2, 0.01, a1);
  her.restPoint(UPPER(0), -0.205, 1.47, -0.03, a2);
  point.copy(a1).lerp(a2, move);
  into.set(1, 0, 0).applyQuaternion(her.q[UPPER(0)]);
  a1.set(0, -1, 0).applyQuaternion(her.q[UPPER(0)]);
  into.lerp(a1, move).normalize();
  fingers.copy(AROUND).applyQuaternion(her.q[UPPER(0)]);
  a2.copy(BACKWARD).applyQuaternion(her.turn);
  fingers.lerp(a2, move).normalize();
  point.addScaledVector(into, -0.05 * Math.sin(Math.PI * move));
  w[0] = 1;
  reach(f, 1, point, fingers, into, 1);
  // His feet come down and hook under the foot bar.
  const hook = ramp(t, 1.75, 2.15);
  plant(f, 0, spot.set(-2.08, BAR_Y - 0.09, EDGE + 0.06), ahead, up, hook);
  plant(f, 1, spot.set(-1.84, BAR_Y - 0.09, EDGE + 0.06), ahead, up, hook);
  f.solve();
  f.draw();
  her.draw();
}

function clip(world: World, params: Params): Clip {
  const room = String(params.room ?? 'galley');
  const at = world.room(room);
  const group = new THREE.Group();
  // Authored in the ship's Galley (middle x -1.5, floor -2.032): carried to the room given.
  group.position.set(at.x + 1.5, at.floor + 2.032, 0);
  const him = new Pair(world, okafor, group);
  const she = new Pair(world, reyes, group);
  const onHer = new Contact(world, group);
  const onTable = new Contact(world, group);
  const tags = [tag(String(params.helper ?? 'Okafor'), 'person'), tag(String(params.person ?? 'Reyes'), 'person')];
  const target = new THREE.Vector3(-1.35, -1.05, -0.9).add(group.position);
  const a = new THREE.Vector3();
  const now = [0, 0, 0];
  const next = [0, 0, 0];

  return {
    duration: T,
    keys: [1.0, 2.0, 3.6],
    ship: true,
    group,
    tags,
    frame(u, still) {
      const drift = still ? 0 : Math.sin((u / T) * Math.PI * 2);
      world.frame(target, 0.42 + 0.03 * drift, 0.16 + 0.01 * drift, 2.45, 30, 0.0, 3.4);
      world.focus(room);
      world.depth(1.5, 10);
      world.toneShip(0.2, 0.3, 0.34);
      const k = still ? 0 : seam(u, T);
      act(him.now, she.now, u, now);
      him.now.fig.style(ACTOR.strength, ACTOR.width, 1 - k);
      she.now.fig.style(OTHER.strength, OTHER.width, 1 - k);
      him.next.fig.style(ACTOR.strength, ACTOR.width, k);
      she.next.fig.style(OTHER.strength, OTHER.width, k);
      if (k > 0) act(him.next, she.next, u - T, next);
      const land = ramp(u, 2.95, 3.1) * (1 - ramp(u, 3.1, 3.5));
      onHer.show(palmOf(him.now.fig, 1, a), 0.08, (1 - k) * now[0], land);
      const grab = ramp(u, 0.95, 1.05) * (1 - ramp(u, 1.05, 1.45));
      onTable.show(palmOf(him.now.fig, 0, a), 0.07, (1 - k) * now[1] * 0.6, grab);
      headTag(tags[0], him.now.fig, group, 1 - k);
      headTag(tags[1], she.now.fig, group, 1 - k);
    },
  };
}

export const stayAtTable: Move = {
  name: 'stay-at-table',
  summary: 'Arrive at a table with someone, holding their arm; both hold position there (feet under the foot bar) and stay together.',
  params: { room: 'galley', helper: 'Okafor', person: 'Reyes' },
  variants: { weightless: clip },
  medical: false,
  reviewed: false,
};
