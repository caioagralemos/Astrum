// Where each module and room sits, read from the mission file, and the shape
// every eight-sided module shares.
//
// Every module has its own frame: x along its length (from -length/2 to
// +length/2), y its "up", z towards its front, centred on its position. The
// furniture, the walls and the people's places are worked out in that frame and
// then carried into the place's frame by the module's matrix, so a module can
// lie in any direction. The ship's modules all lie along X with no turn, so for
// it the matrix is only a move along X and the numbers are those it always had.
//
// The hull is whole; it reads as a cutaway because a wall is only drawn when
// seen from inside, so whichever side the viewer is on, the near walls open and
// the room behind shows.

import * as THREE from 'three';
import type { Mission, ModuleSpec, Template, Vec3 } from '../../../engine/mission.ts';

export type { Template };

/** Which part of a module's height a room takes: all of it, or the upper or lower cabin. */
export type Band = 'full' | 'upper' | 'lower';

/** Radius of the main modules (to the corners of the octagon); furniture is drawn to fit it. */
export const R = 2.2;
export const COS = Math.cos(Math.PI / 8);
export const SIN = Math.sin(Math.PI / 8);

/** How a module is drawn: a cut-open eight-sided hull, a closed pod, a plain outline, a dome or a box. */
export type Look = 'hull' | 'pod' | 'outline' | 'dome' | 'box';

export interface ModuleFrame {
  spec: ModuleSpec;
  look: Look;
  /** From the module's frame (scaled so its widest radius is R) to the place's. */
  matrix: THREE.Matrix4;
  quaternion: THREE.Quaternion;
  scale: number;
  /** Ends and radii in the module's own (scaled) frame. */
  x0: number;
  x1: number;
  r0: number;
  r1: number;
  /** Sides of its outline. */
  sides: number;
  /** A dome's radius and height, in its own frame. */
  dome: { radius: number; height: number } | null;
  /** Which way its front (its frame's +z) faces, in the place's frame. */
  front: THREE.Vector3;
}

export interface RoomPlace {
  id: string;
  template: Template;
  frame: ModuleFrame;
  /** Where the room starts and ends along its module, in the module's frame. */
  x0: number;
  x1: number;
  band: Band;
  /** Hull radius at each end; they differ only where the hull tapers. */
  r0: number;
  r1: number;
  /** In g: 0 means people float. */
  gravity: number;
  /** A module split into cabins has several rooms. */
  cabin: boolean;
}

const unit = (v: Vec3) => new THREE.Vector3(...v).normalize();

/** The frame of one module: its axis is x, its up y (a dome's axis is its y). */
export function frameOf(spec: ModuleSpec): ModuleFrame {
  const shape = spec.shape;
  const axis = unit(spec.axis);
  let x: THREE.Vector3;
  let y: THREE.Vector3;
  if (shape.kind === 'dome') {
    y = axis;
    x = new THREE.Vector3(1, 0, 0);
    if (Math.abs(x.dot(y)) > 0.95) x.set(0, 0, 1);
    x.addScaledVector(y, -x.dot(y)).normalize();
  } else {
    x = axis;
    y = spec.up ? unit(spec.up) : new THREE.Vector3(0, 1, 0);
    if (Math.abs(y.dot(x)) > 0.95) y = new THREE.Vector3(1, 0, 0);
    if (Math.abs(y.dot(x)) > 0.95) y = new THREE.Vector3(0, 0, 1);
    y.addScaledVector(x, -y.dot(x)).normalize();
  }
  const z = new THREE.Vector3().crossVectors(x, y);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  let look: Look;
  let r0 = 0, r1 = 0, length = 0, sides = 8, scale = 1;
  let dome: ModuleFrame['dome'] = null;
  if (shape.kind === 'cylinder') {
    sides = shape.sides ?? 8;
    look = shape.chamfer ? 'pod' : sides === 8 ? 'hull' : 'outline';
    r0 = shape.radius;
    r1 = shape.radiusEnd ?? shape.radius;
    length = shape.length;
    if (spec.isRoom) {
      look = 'hull';
      sides = 8;
      scale = Math.max(r0, r1) / R;
    }
  } else if (shape.kind === 'dome') {
    look = 'dome';
    sides = shape.sides ?? 8;
    dome = { radius: shape.radius, height: shape.height ?? shape.radius };
  } else {
    look = 'box';
    length = shape.length;
    r0 = shape.width / 2;
    r1 = shape.height / 2;
  }
  r0 /= scale;
  r1 /= scale;
  length /= scale;
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...spec.position), quaternion, new THREE.Vector3(scale, scale, scale));
  return { spec, look, matrix, quaternion, scale, x0: -length / 2, x1: length / 2, r0, r1, sides, dome, front: z.clone() };
}

/** Every module's frame, and every room (a module, or each of its cabins), for a mission. */
export function layoutOf(mission: Mission): { modules: ModuleFrame[]; places: RoomPlace[] } {
  const modules = mission.modules.map(frameOf);
  const places: RoomPlace[] = [];
  for (const frame of modules) {
    const { spec } = frame;
    if (!spec.isRoom) continue;
    const base = { template: spec.template, frame, gravity: mission.gravity, r0: frame.r0, r1: frame.r1 };
    if (spec.cabins?.length) {
      for (const c of spec.cabins) {
        const x0 = frame.x0 + c.from / frame.scale;
        const x1 = frame.x0 + c.to / frame.scale;
        places.push({ ...base, id: c.id, x0, x1, band: c.band, r0: radiusAt(frame, x0), r1: radiusAt(frame, x1), cabin: true });
      }
    } else places.push({ ...base, id: spec.id, x0: frame.x0, x1: frame.x1, band: 'full', cabin: false });
  }
  return { modules, places };
}

/**
 * The points the default view has to fit, in the place's frame: the mission's own, or else the
 * rooms (modules people can be in), so the view centres what can be interacted with and lets
 * trusses, wings and other modules run off the edges.
 */
export function outlineOf(mission: Mission, modules: ModuleFrame[]): THREE.Vector3[] {
  if (mission.view?.frame?.length) return mission.view.frame.map((p) => new THREE.Vector3(...p));
  const points: THREE.Vector3[] = [];
  const p = new THREE.Vector3();
  const rooms = modules.filter((m) => m.spec.isRoom);
  for (const m of rooms.length ? rooms : modules) {
    if (m.dome) {
      for (const [x, y, z] of [[m.dome.radius, 0, 0], [-m.dome.radius, 0, 0], [0, 0, m.dome.radius], [0, 0, -m.dome.radius], [0, m.dome.height, 0]]) points.push(p.set(x, y, z).applyMatrix4(m.matrix).clone());
      continue;
    }
    const r = Math.max(m.r0, m.r1);
    for (const x of [m.x0, m.x1]) for (const [y, z] of [[r, 0], [-r, 0], [0, r], [0, -r]]) points.push(p.set(x, y, z).applyMatrix4(m.matrix).clone());
  }
  return points;
}

export function radiusAt(place: { x0: number; x1: number; r0: number; r1: number }, x: number): number {
  return place.r0 + ((place.r1 - place.r0) * (x - place.x0)) / (place.x1 - place.x0);
}

/**
 * The cross-section of a module (or of one cabin), as [y, z] corners going
 * round, closed. For the full octagon, corners 2 and 3 bound the back face and
 * 6 and 7 the front face.
 */
export function section(r: number, band: Band): [number, number][] {
  const c = COS * r;
  const s = SIN * r;
  // The deck between cabins is a hair thick, so the two cabins' floor and ceiling never overlap.
  const d = 0.015;
  if (band === 'upper') return [[c, s], [c, -s], [s, -c], [d, -c], [d, c], [s, c]];
  if (band === 'lower') return [[-d, c], [-d, -c], [-s, -c], [-c, -s], [-c, s], [-s, c]];
  return [[c, s], [c, -s], [s, -c], [-s, -c], [-c, -s], [-c, s], [-s, c], [s, c]];
}

/** A regular outline of `sides` corners at radius r round the x axis, as [y, z]; eight sides gives `section`'s octagon. */
export function ring(r: number, sides: number): [number, number][] {
  if (sides === 8) return section(r, 'full');
  return Array.from({ length: sides }, (_, i) => {
    const a = Math.PI / sides + (i * 2 * Math.PI) / sides;
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
  });
}

/** Top and bottom of a room's height band, at hull radius r. */
export function bandEdges(r: number, band: Band): [number, number] {
  if (band === 'upper') return [COS * r, 0];
  if (band === 'lower') return [0, -COS * r];
  return [COS * r, -COS * r];
}

/**
 * The floor people stand on, in the module's frame. With gravity a whole module gets a raised
 * floor level with its lower corners (wide enough to walk on, stores beneath); a cabin stands on
 * its deck or on the hull's bottom face.
 */
export function floorOf(place: RoomPlace): number {
  if (place.frame.dome) return 0;
  const r = Math.max(place.r0, place.r1);
  if (place.band === 'upper') return 0.015;
  if (place.band === 'lower') return -COS * r;
  return -SIN * r;
}

export function centreOf(place: RoomPlace): [number, number, number] {
  if (place.frame.dome) return [0, place.frame.dome.height * 0.45, 0];
  const r = Math.max(place.r0, place.r1);
  const [top, bottom] = bandEdges(r, place.band);
  return [(place.x0 + place.x1) / 2, (top + bottom) / 2, -0.3];
}

/** The room's corners for framing it, in the module's frame. */
export function extentOf(place: RoomPlace): [number, number, number, number, number, number] {
  if (place.frame.dome) {
    const { radius, height } = place.frame.dome;
    return [-radius, 0, -radius, radius, height, radius * 0.4];
  }
  const r = Math.max(place.r0, place.r1);
  const [hi, lo] = bandEdges(r, place.band);
  return [place.x0, lo, -COS * r, place.x1, hi, COS * r * 0.4];
}

/** Two points for the room's label, in the module's frame: its middle, and the edge the label sits beyond. */
export function labelEdge(place: RoomPlace): [[number, number, number], [number, number, number]] {
  if (place.frame.dome) return [[0, place.frame.dome.height * 0.5, 0], [0, 0, 0]];
  const [x, y] = centreOf(place);
  const r = radiusAt(place, x);
  const [hi, lo] = bandEdges(r, place.band);
  return [[x, y, 0], [x, place.band === 'upper' ? hi : lo, 0]];
}

/** How someone in a room is drawn: floating, standing, or sitting (in gravity). */
export type Stance = 'float' | 'stand' | 'sit';

/** The poses the figures take (build.ts holds the joint angles for each). */
export type PoseName = 'float' | 'stand' | 'run' | 'walk' | 'pedal' | 'table' | 'seated';

/** The small looped movement that goes with an exercise (none under reduced motion). */
export type Motion = 'still' | 'run' | 'walk' | 'pedal';

export interface Spot {
  /** Where the middle of the body is, in the module's frame. */
  at: [number, number, number];
  stance: Stance;
  /** Which way they face, radians round the module's y; null keeps their own look. */
  yaw: number | null;
  pose: PoseName;
  motion: Motion;
}

/**
 * Where the nth of `count` people in a neutral place floats in a room, as an offset from the
 * room's centre. Spread across the length and staggered in height so their name tags have room.
 */
const SPREAD: [number, number, number][][] = [
  [[0, 0.05, 0.1]],
  [[-0.42, 0.12, 0.1], [0.42, -0.08, -0.2]],
  [[-0.75, -0.3, 0.1], [0, 0.4, -0.15], [0.75, -0.2, 0.15]],
  [[-0.85, -0.5, 0.15], [-0.3, 0.45, -0.15], [0.3, -0.5, 0.1], [0.85, 0.42, -0.1]],
];

/** Chairs round the commons table: angle round the dome's middle. */
export const SEATS = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
export const SEAT_RADIUS = 1.35;

const HALF = Math.PI / 2;

/** What the hub says someone is doing (engine/activity.ts); the view draws nothing it does not know. */
export type Doing = 'sleeping' | 'exercising' | 'eating' | 'none';

/**
 * Where someone doing something the hub knows does it, beside the furniture furniture.ts draws
 * (same measurements: metres from the room's middle along it, from the axis in height and
 * depth): the treadmill and the cycle for exercise, the table for a meal. Rooms without that
 * furniture have none, and the person is shown in their neutral place instead.
 */
export function activitySpots(place: RoomPlace, what: 'exercising' | 'eating'): Spot[] {
  const cx = (place.x0 + place.x1) / 2;
  const at = (x: number, y: number, z: number): [number, number, number] => [cx + x, y, z];
  const spot = (a: [number, number, number], yaw: number, pose: PoseName, motion: Motion, stance: Stance): Spot => ({ at: a, yaw, pose, motion, stance });
  const t = place.template;
  if (place.gravity > 0) {
    const f = floorOf(place);
    if (what === 'eating') {
      return place.frame.dome && t === 'galley'
        ? SEATS.map((a) => spot([Math.cos(a) * SEAT_RADIUS, f + 0.54, Math.sin(a) * SEAT_RADIUS], Math.atan2(-Math.cos(a), -Math.sin(a)), 'seated', 'still', 'sit'))
        : [];
    }
    // The treadmill stands in the medical module (and an exercise module, where there is one).
    return !place.frame.dome && (t === 'medical' || t === 'exercise') ? [spot(at(1.3, f + 0.18 + 0.95, -0.65), HALF, 'walk', 'walk', 'stand')] : [];
  }
  if (place.frame.dome) return [];
  if (what === 'exercising') {
    return t === 'exercise' ? [spot(at(-1.1, -0.87, -0.25), -HALF, 'run', 'run', 'float'), spot(at(0.95, -1.05, -0.4), HALF, 'pedal', 'pedal', 'float')] : [];
  }
  return t === 'galley' ? [
    spot(at(-1.25, -0.8, -0.4), HALF, 'table', 'still', 'float'), spot(at(1.25, -0.8, -0.4), -HALF, 'table', 'still', 'float'),
    spot(at(-0.35, -0.8, -1.55), 0, 'table', 'still', 'float'), spot(at(0.4, -0.8, 0.75), Math.PI, 'table', 'still', 'float'),
  ] : [];
}

/**
 * The neutral place of the nth of `count` people doing nothing the hub knows: floating upright and
 * relaxed (weightless) or standing (with gravity), near the furniture but not using it, spread so
 * their name tags have room. `busy` is true when others in the room are at its furniture: the
 * neutral ones then keep clear of it (higher up in orbit, towards the front on a floor).
 */
export function neutralSpot(place: RoomPlace, index: number, count: number, busy: boolean): Spot {
  const pattern = SPREAD[Math.min(Math.max(count, 1), SPREAD.length) - 1];
  const [u, v, w] = pattern[index % pattern.length];
  const stand = (at: [number, number, number]): Spot => ({ at, stance: 'stand', yaw: null, pose: 'stand', motion: 'still' });
  const float = (at: [number, number, number]): Spot => ({ at, stance: 'float', yaw: null, pose: 'float', motion: 'still' });
  if (place.gravity > 0) {
    const floor = floorOf(place);
    if (place.frame.dome) {
      // Round the dome, beyond the chairs of a table.
      const a = 0.6 + index * 1.9;
      const { radius } = place.frame.dome;
      return stand([Math.cos(a) * radius * 0.62, floor + 0.95, Math.sin(a) * radius * 0.62]);
    }
    const half = (place.x1 - place.x0) / 2 - 0.5;
    const x = (place.x0 + place.x1) / 2;
    if (place.cabin) return stand([x + (index === 0 ? -0.5 : 0.35), floor + 0.95, 0.15 - index * 0.2]);
    return stand([x + u * half, floor + 0.95, (busy ? 0.55 : 0.1) + w * 1.5]);
  }
  if (place.frame.dome) {
    // The cupola: in the dome and just below it, among the windows.
    const spots: [number, number, number][] = [[0, 0.25, 0], [0.55, -0.1, 0.35], [-0.55, -0.1, 0.3], [0.1, -0.15, -0.5]];
    return float(spots[index % spots.length]);
  }
  const [x, y] = centreOf(place);
  if (place.template === 'quarters' && place.cabin) {
    return float([x + (index === 0 ? 0.3 : -0.55), y + (place.band === 'upper' ? 0.05 : -0.05), 0.0]);
  }
  const half = (place.x1 - place.x0) / 2 - 0.5;
  // Beside people at the treadmill or the table, float above them, clear of their heads and tags.
  if (busy) return float([x + u * half, y + 0.85 + v * 0.25, w + 0.45]);
  return float([x + u * half, y + v * 1.3 + 0.05, w + 0.3]);
}

/** Where a sleeper is drawn, in the module's frame. */
export interface Bed {
  at: [number, number, number];
  /** Turn round the module's y. */
  yaw: number;
  /** Lying on a bunk (in gravity) rather than upright in a bag on a wall. */
  lying: boolean;
}

/** Sleep stations along the back wall of a quarters module without cabins (the ISS's Harmony has four). */
export const STATIONS = [-2.1, -0.7, 0.7, 2.1];

/** Bunks in a cabin with gravity: along the back of the cabin, this far from the middle in depth. */
export const BUNK_Z = -0.85;
export const BUNK_TOP = 0.52;

export function bedOf(place: RoomPlace, index: number): Bed {
  const cx = (place.x0 + place.x1) / 2;
  if (place.gravity > 0) {
    return { at: [cx - 0.1, floorOf(place) + BUNK_TOP + 0.12, BUNK_Z], yaw: 0, lying: true };
  }
  if (!place.cabin) {
    // Upright in a sleep station on the back wall, facing out into the module.
    return { at: [cx + STATIONS[index % STATIONS.length], 0.05, -COS * R + 0.5], yaw: Math.PI / 2, lying: false };
  }
  // In the bag on the cabin's far end wall, head up.
  return { at: [place.x1 - 0.2, place.band === 'lower' ? -1.0 : 1.02, -0.65], yaw: 0, lying: false };
}

/** Whether a room is where people sleep. */
export function sleepsIn(place: RoomPlace): boolean {
  return place.template === 'quarters';
}
