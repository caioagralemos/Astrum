// Move "rouse-lead-out" (weightless): wake someone asleep in a cabin's sleeping
// bag and lead them out. Parameters: room (a cabin with a sleeping bag; it is
// authored in Quarters 2 and carried to the room given), helper and person (the
// names on the labels).
//
// Wake her and bring her out. Okafor comes down into Quarters 2 from
// the hatch already moving, and stops by taking Reyes by both shoulders (she is
// held by her sleeping bag on the end wall, so she is the fixed thing he
// catches); his legs carry on and swing down until his feet meet the floor.
// Two small shakes, and she wakes: her head comes up and turns to him, her arm
// comes out, and he takes it by the forearm. He sinks into his legs, then
// pushes off the floor towards the hatch, and she follows a beat late, pulled
// by the arm, tipping forward about her middle as she starts to move.
//
// These are the story's own beats (the scenario's "Okafor gets Reyes out"),
// not a medical instruction.

import * as THREE from 'three';
import { ramp, track } from '../anim.ts';
import { palmOf, plant, reach } from '../cast.ts';
import type { Character, Moves } from '../cast.ts';
import { FORE, UPPER } from '../rig.ts';
import { ACTOR, OTHER, Pair, headTag, seam, tag } from '../step.ts';
import type { Clip, Move, Params } from '../step.ts';
import { Arrow, Contact } from '../world.ts';
import type { World } from '../world.ts';

const T = 6;
const PI = Math.PI;
/** The cabin's floor (the hull's bottom face), and where she floats, in her bag on the end wall. */
const FLOOR = -2.032;
const HER: [number, number, number] = [7.6, -0.98, -0.65];
const her = (dx: number, dy = 0, dz = 0): [number, number, number] => [HER[0] + dx, HER[1] + dy, HER[2] + dz];

const okafor: Moves = {
  root: track([
    [0, [6.3, -0.76, -0.6], 'lin'], [0.5, [6.73, -0.95, -0.61], 'lin'], [0.92, [6.93, -1.07, -0.62]], [1.4, [7.0, -1.12, -0.62], 'still'],
    [2.95, [7.0, -1.12, -0.62], 'still'], [3.32, [7.04, -1.25, -0.62], 'still'], [3.64, [6.9, -1.1, -0.6]],
    [3.97, [6.66, -1.07, -0.58], 'lin'], [T, [5.2, -0.95, -0.5], 'lin'],
  ]),
  turn: track([
    [0, [PI / 2, 0.42, 0], 'lin'], [0.55, [PI / 2, 0.38, 0]], [1.12, [PI / 2, -0.06, 0.02]], [1.6, [PI / 2, 0.04, 0]], [2.0, [PI / 2, 0.02, 0], 'still'],
    [2.95, [PI / 2, 0.02, 0], 'still'], [3.32, [PI / 2, 0.06, 0], 'still'], [3.7, [PI / 2, -0.08, 0]], [4.4, [PI / 2 - 0.12, -0.16, 0]], [T, [PI / 2 - 0.18, -0.14, 0], 'lin'],
  ]),
  chest: track([[0, [0.05, 0, 0]], [1.2, [0.06, 0, 0]], [2.9, [0.06, 0, 0], 'still'], [3.32, [0.1, 0, 0]], [3.8, [0.0, -0.12, 0]], [T, [0.0, -0.18, 0]]]),
  head: track([
    [0, [0.1, 0, 0]], [1.2, [0.16, 0.02, 0]], [2.3, [0.12, 0.05, 0]], [3.2, [0.18, 0, 0]], [3.75, [0.05, -0.5, 0]], [4.5, [-0.02, -0.95, 0.05]], [T, [0.0, -1.0, 0.05]],
  ]),
  hands: [
    track([[0, [-0.2, 0.24, 0.44]], [0.8, [-0.18, 0.2, 0.48]]]),
    track([[0, [0.2, 0.24, 0.44]], [0.8, [0.18, 0.2, 0.48]], [2.7, [0.18, 0.2, 0.48]], [3.2, [0.28, 0.02, 0.3]], [4.0, [0.3, -0.05, 0.12]], [T, [0.3, 0.0, 0.18]]]),
  ],
  elbows: [track([[0, [-0.9, -0.6, -0.5]]]), track([[0, [0.9, -0.6, -0.5]]])],
  feet: [
    track([[0, [-0.1, -0.76, -0.24], 'lin'], [0.6, [-0.1, -0.76, -0.22]], [1.15, [-0.1, -0.78, 0.08]], [3.6, [-0.1, -0.78, 0.1]], [4.1, [-0.1, -0.82, 0.04]], [T, [-0.1, -0.82, 0.0]]]),
    track([[0, [0.1, -0.72, -0.3], 'lin'], [0.6, [0.1, -0.72, -0.28]], [1.2, [0.1, -0.78, 0.1]], [3.6, [0.1, -0.78, 0.1]], [4.2, [0.11, -0.8, 0.0]], [T, [0.11, -0.8, -0.04]]]),
  ],
  ankles: [track([[0, [0.55, 0, 0]], [1.0, [0.3, 0, 0]], [3.7, [0.3, 0, 0]], [T, [0.5, 0, 0]]]), track([[0, [0.6, 0, 0]], [1.0, [0.3, 0, 0]], [3.7, [0.3, 0, 0]], [T, [0.55, 0, 0]]])],
  overlap: 1,
};

const reyes: Moves = {
  root: track([
    [0, HER, 'still'], [1.42, HER, 'still'], [1.56, her(0.014)], [1.73, her(-0.008)], [1.9, her(0.011)], [2.2, HER, 'still'],
    [3.6, HER, 'still'], [4.05, her(-0.18, 0.01, 0.01)], [4.4, her(-0.43, 0.03, 0.03), 'lin'], [T, her(-1.57, 0.12, 0.09), 'lin'],
  ]),
  turn: track([[0, [-PI / 2, 0, 0], 'still'], [3.6, [-PI / 2, 0, 0], 'still'], [4.1, [-PI / 2, 0.32, 0.04]], [4.8, [-PI / 2, 0.2, 0.02]], [T, [-PI / 2, 0.18, 0], 'lin']]),
  chest: track([[0, [0.1, 0, 0.03], 'still'], [1.85, [0.1, 0, 0.03]], [2.2, [-0.06, 0.04, 0]], [2.6, [0.02, 0.05, 0]], [3.6, [0.03, 0.04, 0]], [4.1, [-0.06, 0.02, 0]], [T, [0.02, 0, 0]]]),
  head: track([
    [0, [0.42, -0.1, 0.16], 'still'], [1.7, [0.4, -0.08, 0.14]], [2.02, [0.12, 0.1, 0.04]], [2.35, [-0.04, 0.22, 0]], [2.7, [0.04, 0.24, 0], 'still'],
    [3.6, [0.04, 0.22, 0]], [4.0, [-0.12, 0.15, 0]], [4.6, [0.06, 0.08, 0]], [T, [0.06, 0.04, 0]],
  ]),
  hands: [
    track([[0, [-0.07, -0.06, 0.14], 'still'], [1.95, [-0.07, -0.06, 0.14], 'still'], [2.35, [-0.22, 0.04, 0.22]], [2.75, [-0.26, 0.06, 0.24], 'still'], [3.9, [-0.3, 0.1, 0.16]], [T, [-0.29, 0.06, 0.2]]]),
    track([[0, [0.07, -0.04, 0.15], 'still'], [2.0, [0.07, -0.04, 0.15], 'still'], [2.42, [0.2, 0.08, 0.34]], [2.8, [0.19, 0.14, 0.42], 'still'], [3.4, [0.19, 0.14, 0.42]], [3.85, [0.16, 0.24, 0.5]], [T, [0.17, 0.24, 0.49]]]),
  ],
  elbows: [track([[0, [-1, -0.4, -0.2]], [2.4, [-0.8, -0.6, -0.5]]]), track([[0, [1, -0.4, -0.2]], [2.4, [0.6, -0.8, -0.4]]])],
  feet: [
    track([[0, [-0.09, -0.86, 0.02], 'still'], [3.7, [-0.09, -0.86, 0.02], 'still'], [4.5, [-0.11, -0.78, -0.14]], [T, [-0.12, -0.75, -0.08]]]),
    track([[0, [0.09, -0.86, 0.02], 'still'], [3.8, [0.09, -0.86, 0.02], 'still'], [4.6, [0.11, -0.76, -0.18]], [T, [0.12, -0.73, -0.1]]]),
  ],
  ankles: [track([[0, [0.25, 0, 0]], [3.7, [0.25, 0, 0]], [T, [0.5, 0, 0]]]), track([[0, [0.25, 0, 0]], [3.7, [0.25, 0, 0]], [T, [0.55, 0, 0]]])],
  overlap: 1.4,
};

const fingers = new THREE.Vector3();
const into = new THREE.Vector3();
const point = new THREE.Vector3();
const a1 = new THREE.Vector3();
const a2 = new THREE.Vector3();
const toes = new THREE.Vector3(1, 0, 0);
const up = new THREE.Vector3(0, 1, 0);
const spot = new THREE.Vector3();

/** His hands on her: both on her shoulders, then the near one moves to her forearm and the far one lets go. */
function hold(o: Character, r: Character, t: number, out: number[]) {
  const f = r.fig;
  // Near hand: her near shoulder (her +x side faces the camera), then her forearm.
  const move = ramp(t, 2.45, 2.85);
  f.restPoint(UPPER(1), 0.275, 1.33, 0.0, a1);
  f.restPoint(FORE(1), 0.3, 0.95, 0.0, a2);
  point.copy(a1).lerp(a2, move);
  into.set(-1, 0, 0).applyQuaternion(move < 0.5 ? f.q[UPPER(1)] : f.q[FORE(1)]);
  fingers.set(0, -1, 0).applyQuaternion(f.q[UPPER(1)]);
  a1.set(0, 0, -1).applyQuaternion(f.q[FORE(1)]);
  fingers.lerp(a1, move).normalize();
  // Lifted off a little on the way, not dragged.
  point.addScaledVector(into, -0.05 * Math.sin(Math.PI * move));
  out[0] = ramp(t, 0.72, 0.98);
  reach(o.fig, 0, point, fingers, into, out[0]);
  // Far hand: her far shoulder, let go once he has her arm.
  f.restPoint(UPPER(0), -0.275, 1.33, 0.0, point);
  into.set(1, 0, 0).applyQuaternion(f.q[UPPER(0)]);
  fingers.set(0, -1, 0).applyQuaternion(f.q[UPPER(0)]);
  out[1] = ramp(t, 0.74, 1.0) * (1 - ramp(t, 2.65, 2.95));
  reach(o.fig, 1, point, fingers, into, out[1]);
}

/** His feet on the floor: from when his legs swing down until the push leaves it. */
function stand(o: Character, t: number, out: number[]) {
  const w = ramp(t, 1.02, 1.24) * (1 - ramp(t, 3.52, 3.66));
  out[2] = w;
  plant(o.fig, 0, spot.set(7.14, FLOOR, -0.5), toes, up, w);
  plant(o.fig, 1, spot.set(7.2, FLOOR, -0.75), toes, up, w);
}

function clip(world: World, params: Params): Clip {
  const room = String(params.room ?? 'quarters-2');
  const at = world.room(room);
  const group = new THREE.Group();
  // Authored in Quarters 2 (middle x 6.7, floor at FLOOR): carried to the room given.
  group.position.set(at.x - 6.7, at.floor - FLOOR, 0);
  const him = new Pair(world, okafor, group);
  const she = new Pair(world, reyes, group);
  const onHer = new Contact(world, group);
  const way = new Arrow(world, group, 1.5);
  const tags = [tag(String(params.helper ?? 'Okafor'), 'person'), tag(String(params.person ?? 'Reyes'), 'person')];
  const target = new THREE.Vector3(6.85, -1.0, -0.55).add(group.position);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const now = [0, 0, 0];
  const next = [0, 0, 0];

  /** Pose both people at time t, contacts included. */
  const act = (o: Character, r: Character, t: number, w: number[]) => {
    r.pose(t);
    r.fig.solve();
    o.pose(t);
    hold(o, r, t, w);
    stand(o, t, w);
    o.fig.solve();
    o.fig.draw();
    r.fig.draw();
  };

  return {
    duration: T,
    keys: [1.3, 2.9, 4.6],
    ship: true,
    group,
    tags,
    frame(u, still) {
      const drift = still ? 0 : Math.sin((u / T) * Math.PI * 2);
      world.frame(target, -0.12 + 0.03 * drift, 0.07 + 0.012 * drift, 2.3, 30, 0.02);
      world.focus(room);
      world.depth(1.5, 10);
      world.toneShip(0.2, 0.3, 0.32);
      const k = still ? 0 : seam(u, T);
      act(him.now, she.now, u, now);
      him.now.fig.style(ACTOR.strength, ACTOR.width, 1 - k);
      she.now.fig.style(OTHER.strength, OTHER.width, 1 - k);
      him.next.fig.style(ACTOR.strength, ACTOR.width, k);
      she.next.fig.style(OTHER.strength, OTHER.width, k);
      if (k > 0) act(him.next, she.next, u - T, next);
      // The contact that matters: his hand on her. It swells as it lands, and again as he takes her arm.
      const land = ramp(u, 0.9, 1.0) * (1 - ramp(u, 1.0, 1.45)) + ramp(u, 2.7, 2.85) * (1 - ramp(u, 2.85, 3.25));
      onHer.show(palmOf(him.now.fig, 0, a), 0.08, now[0] * (1 - k), land);
      // The way out, while they go.
      a.set(6.35, -0.3, -0.55);
      b.set(5.6, -0.3, -0.55);
      way.show(a, b, 0.07, 0.75 * ramp(u, 3.6, 4.0) * (1 - k));
      headTag(tags[0], him.now.fig, group, 1 - k);
      headTag(tags[1], she.now.fig, group, 1 - k);
    },
  };
}

export const rouseLeadOut: Move = {
  name: 'rouse-lead-out',
  summary: 'Reach someone asleep in a cabin, wake them, take their arm and lead them out towards the hatch.',
  params: { room: 'quarters-2', helper: 'Okafor', person: 'Reyes' },
  variants: { weightless: clip },
  medical: false,
  reviewed: false,
};
