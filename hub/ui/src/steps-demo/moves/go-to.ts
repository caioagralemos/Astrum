// Move "go-to" (weightless): go to someone, through the place. Seen in the
// whole-ship cutaway, small: a crewmate pushes off in one room, glides head
// first along the route (drawn), through each hatch, turns upright on arrival
// and stops by the person. The route is worked out from the ship's layout,
// room to room, so any two rooms work. Parameters: from, to (room ids),
// helper (the label on the one going), person (who is waiting there, drawn
// asleep in the cabin's bag when `asleep` is 1).
//
// In weightlessness a body only changes speed when it pushes on something, so
// the trip is: a crouch, a push, a glide at one speed, and a catch at the end.
// The trip is shown faster than life (a ship's length in about three seconds),
// which the screen should say.

import * as THREE from 'three';
import { CatmullRomCurve3 } from 'three';
import { ramp, sample1, track } from '../anim.ts';
import { Character } from '../cast.ts';
import type { Moves } from '../cast.ts';
import { ACTOR, OTHER, Pair, headTag, seam, tag } from '../step.ts';
import type { Clip, Move, Params } from '../step.ts';
import { polyline } from '../world.ts';
import type { World } from '../world.ts';

const T = 4.6;
const PI = Math.PI;

/** How far along the route (0 to 1) at time t: still, a push, one speed, a catch. */
const along = track([[0, 0, 'still'], [0.55, 0, 'still'], [0.9, 0.05, 'lin'], [3.35, 0.94, 'lin'], [3.9, 1, 'still']]);

// The traveller's limbs in the body's frame, from the push to the glide (head first, one arm
// reaching ahead, legs together) and back to a neutral float on arrival.
const traveller: Moves = {
  root: track([[0, [0, 0, 0]]]),
  turn: track([[0, [0, 0, 0]]]),
  chest: track([[0, [0.1, 0, 0]], [0.5, [0.25, 0, 0]], [0.85, [-0.05, 0, 0]], [3.4, [-0.05, 0, 0]], [4.0, [0.08, 0, 0]]]),
  head: track([[0, [0.15, 0, 0]], [0.9, [-0.25, 0, 0]], [3.4, [-0.25, 0, 0]], [4.0, [0.1, 0.4, 0]]]),
  hands: [
    track([[0, [-0.3, 0.17, 0.3]], [0.5, [-0.3, 0.05, 0.25]], [0.9, [-0.12, 0.95, 0.12]], [3.35, [-0.12, 0.95, 0.12]], [3.9, [-0.25, 0.3, 0.42]], [T, [-0.24, 0.26, 0.4]]]),
    track([[0, [0.3, 0.17, 0.3]], [0.5, [0.3, 0.05, 0.25]], [0.9, [0.24, -0.25, 0.06]], [3.35, [0.24, -0.25, 0.06]], [3.9, [0.3, 0.15, 0.3]], [T, [0.3, 0.17, 0.3]]]),
  ],
  feet: [
    track([[0, [-0.1, -0.62, 0.22]], [0.5, [-0.1, -0.5, 0.3]], [0.85, [-0.08, -0.86, -0.04]], [3.35, [-0.08, -0.86, -0.04]], [4.0, [-0.12, -0.72, 0.1]]]),
    track([[0, [0.1, -0.62, 0.22]], [0.5, [0.1, -0.5, 0.3]], [0.85, [0.08, -0.86, -0.08]], [3.35, [0.08, -0.86, -0.08]], [4.0, [0.12, -0.72, 0.1]]]),
  ],
  ankles: [track([[0, [0.3, 0, 0]], [0.9, [0.7, 0, 0]], [3.4, [0.7, 0, 0]], [4.0, [0.4, 0, 0]]]), track([[0, [0.3, 0, 0]], [0.9, [0.7, 0, 0]], [3.4, [0.7, 0, 0]], [4.0, [0.4, 0, 0]]])],
  overlap: 0.4,
};

/** Someone asleep in a cabin's bag (as at the start of rouse-lead-out). */
function sleeper(at: [number, number, number]): Moves {
  return {
    root: track([[0, at]]),
    turn: track([[0, [-PI / 2, 0, 0]]]),
    chest: track([[0, [0.1, 0, 0.03]]]),
    head: track([[0, [0.42, -0.1, 0.16]]]),
    hands: [track([[0, [-0.07, -0.06, 0.14]]]), track([[0, [0.07, -0.04, 0.15]]])],
    elbows: [track([[0, [-1, -0.4, -0.2]]]), track([[0, [1, -0.4, -0.2]]])],
    feet: [track([[0, [-0.09, -0.86, 0.02]]]), track([[0, [0.09, -0.86, 0.02]]])],
    ankles: [track([[0, [0.25, 0, 0]]]), track([[0, [0.25, 0, 0]]])],
  };
}

const tangent = new THREE.Vector3();
const facing = new THREE.Vector3();
const side = new THREE.Vector3();
const basis = new THREE.Matrix4();
const glide = new THREE.Quaternion();
const upright = new THREE.Quaternion();
const start = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const p = new THREE.Vector3();

function clip(world: World, params: Params): Clip {
  const from = world.room(String(params.from ?? 'galley'));
  const to = world.room(String(params.to ?? 'quarters-2'));
  const group = new THREE.Group();
  const dir = Math.sign(to.x - from.x) || 1;

  // The route: from the middle of the first room, through each hatch on the way (the bulkheads
  // between rooms, at hatch height), to beside the person at the end.
  const mid = (r: { floor: number }) => r.floor + 1.12;
  const points = [new THREE.Vector3(from.x, mid(from), -0.45)];
  const ends = [...new Set(world.places.map((q) => world.room(q.id)).flatMap((r) => [r.x0, r.x1]).map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b);
  const hatchY = -0.25;
  for (const x of dir > 0 ? ends : ends.reverse()) {
    if ((x - from.x) * dir > 0.3 && (to.x - x) * dir > -0.01 && Math.abs(x - to.x) > 0.3) {
      points.push(new THREE.Vector3(x - dir * 0.5, hatchY, -0.3), new THREE.Vector3(x + dir * 0.5, hatchY, -0.3));
    }
  }
  const restAt: [number, number, number] = [to.x + 0.9, to.floor + 1.05, -0.65];
  const stop = new THREE.Vector3(to.x - 0.3 * dir, to.floor + 1.08, -0.35);
  const last = points[points.length - 1];
  if ((stop.x - last.x) * dir > 0.2) points.push(new THREE.Vector3((last.x + stop.x) / 2, (last.y + stop.y) / 2, (last.z + stop.z) / 2));
  points.push(stop);
  const route = new CatmullRomCurve3(points, false, 'centripetal', 0.5);
  const samples = route.getSpacedPoints(160);

  // The route drawn: all of it faint and dashed, the part travelled solid.
  const faint = world.line(1.5, 0.4);
  const bright = world.line(2, 0.95);
  group.add(polyline(world, samples, faint, true));
  const done = polyline(world, samples, bright);
  group.add(done);
  const doneGeometry = done.geometry as THREE.InstancedBufferGeometry;

  const him = new Pair(world, traveller, group);
  const asleep = Number(params.asleep ?? 1) === 1;
  const her = asleep ? new Character({ ink: world.ink, bg: world.bg }, sleeper(restAt)) : null;
  her?.fig.addTo(group);
  her?.fig.style(OTHER.strength, 1.4);
  const tags = [tag(String(params.helper ?? 'Okafor'), 'person'), tag(String(params.person ?? 'Reyes'), 'person'), tag(roomName(String(params.from ?? 'galley')), 'room'), tag(roomName(String(params.to ?? 'quarters-2')), 'room')];
  tags[2].at.set(from.x, from.floor - 0.25, 2.1);
  tags[3].at.set(to.x, to.floor - 0.25, 2.1);
  const target = new THREE.Vector3((from.x + to.x) / 2 + 0.3, -0.5, 0);
  const span = Math.abs(to.x - from.x) + 5;

  // Upright and facing along the route, at both ends.
  start.setFromEuler(euler.set(0, dir > 0 ? PI / 2 : -PI / 2, 0));

  const pose = (c: Character, t: number) => {
    const s = sample1(along, t);
    route.getPointAt(Math.min(1, Math.max(0, s)), p);
    route.getTangentAt(Math.min(1, Math.max(0, s)), tangent);
    const f = c.fig;
    // Gliding, head first: the body's up along the route, its front to the viewer.
    facing.set(0, 0, 1);
    side.crossVectors(tangent, facing).normalize();
    facing.crossVectors(side, tangent).normalize();
    basis.makeBasis(side, tangent, facing);
    glide.setFromRotationMatrix(basis);
    const lie = ramp(t, 0.55, 0.85) * (1 - ramp(t, 3.3, 3.85));
    upright.copy(start).slerp(glide, lie);
    c.pose(t, p, upright);
    f.solve();
    f.draw();
    return s;
  };

  return {
    duration: T,
    keys: [0.5, 2.0, 4.0],
    ship: true,
    group,
    tags,
    frame(u, still) {
      const drift = still ? 0 : Math.sin((u / T) * PI * 2);
      world.frame(target, 0.12 * Math.sign(to.x - from.x || 1) + 0.02 * drift, 0.2 + 0.006 * drift, 5.5, 30, 0.0, span);
      world.focus(null);
      world.depth(6, 30);
      world.toneShip(0.42, 0.5, 0.4);
      const k = still ? 0 : seam(u, T);
      const s = pose(him.now, u);
      him.now.fig.style(ACTOR.strength, 1.7, 1 - k);
      him.next.fig.style(ACTOR.strength, 1.7, k);
      if (k > 0) pose(him.next, u - T);
      her?.pose(0);
      her?.fig.solve();
      her?.fig.draw();
      doneGeometry.instanceCount = Math.round(Math.max(0, Math.min(1, s)) * 160) * (1 - k > 0.5 ? 1 : 0);
      headTag(tags[0], him.now.fig, group, 1 - k);
      if (her) headTag(tags[1], her.fig, group, 1);
      else tags[1].shown = 0;
    },
  };
}

function roomName(id: string): string {
  return id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()).replace(/ (\d)/, ' $1');
}

export const goTo: Move = {
  name: 'go-to',
  summary: 'Go to someone through the place: push off, glide along the drawn route through the hatches, stop beside them.',
  params: { from: 'galley', to: 'quarters-2', helper: 'Okafor', person: 'Reyes', asleep: 1 },
  variants: { weightless: clip },
  medical: false,
  reviewed: false,
};
