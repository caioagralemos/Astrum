// Builds the place's 3D drawing from its mission: the cut-open hulls and domes,
// the closed pods and outlines of modules nobody works in, trusses, solar
// arrays, radiators, antennas, engines and legs, each room's walls (which carry
// its status light), its furniture, the crew figures, the ground on a surface
// and a few stars. Station.tsx owns the scene and animates it; this file only
// makes the parts and hands back what can be changed.
//
// Static lines are merged by strength: one object for all the structure, and
// one pair (back and front) for each direction modules face; only rooms get
// their own, since their colour follows their status.

import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { furnish } from './furniture.ts';
import { createCrewAvatar } from './CrewAvatar.ts';
import { createPoseRig, neutralPose, posePresets } from './PoseRig.ts';
import type { AvatarPose } from './PoseRig.ts';
import { COS, R, SIN, bandEdges, centreOf, radiusAt, ring, section } from './layout.ts';
import type { Band, ModuleFrame, Motion, PoseName, RoomPlace } from './layout.ts';
import { Pen } from './pen.ts';
import { createGround } from './ground.ts';
import type { GroundMesh } from './ground.ts';
import type { Mission, Panel, Vec3 } from '../../../../engine/mission.ts';

export interface RoomParts {
  place: RoomPlace;
  /** Which way the room's front wall faces, in the place's frame: the view opens it from either side. */
  facing: THREE.Vector3;
  /** The edge of the room's opening: tinted and thickened by its status. */
  frame: LineMaterial;
  /** That edge drawn on the front (the cut) and on the back: the view shows the near one. */
  frontEdge: LineSegments2;
  backEdge: LineSegments2;
  /** Furniture and fittings. */
  detail: LineMaterial;
  /** What hangs on each long wall: shown only while that wall is the far one. */
  back: LineSegments2;
  front: LineSegments2;
  /** The room's inner walls, lit by its status. */
  wall: THREE.ShaderMaterial;
  /** How present the walls are (0 to 1): other rooms' walls step aside while a person is in focus. */
  wallsShown: number;
  /** How strong the light is before any pulse, and whether it pulses. */
  glow: number;
  pulse: boolean;
  hit: THREE.Mesh;
}

export interface Figure {
  holder: THREE.Group;
  /** The awake figure, turned the way this person faces. */
  face: THREE.Group;
  turn: THREE.Group;
  /** The sleeping figure, in the bag on the cabin wall (or on a bunk, with gravity). */
  sleep: THREE.Group;
  /** Seated at a table: no longer a separate body (the awake body is re-posed); kept null. */
  sit: THREE.Group | null;
  /** Re-poses the awake body (only when the activity changes, never per frame). */
  rig: { setPose: (pose: AvatarPose) => void };
  /** The awake body's limbs, turned about the shoulder and hip for the small looped movements. */
  limbs: { leftArm: THREE.Object3D; rightArm: THREE.Object3D; leftLeg: THREE.Object3D; rightLeg: THREE.Object3D };
  /** The pose and movement it has now. */
  poseName: PoseName | '';
  motion: Motion;
  /** Whether the limbs are turned away from the pose (and must be put back when still). */
  moving: boolean;
  /** Its own slight tilt when floating free, kept while the figure is at a station (where it is 0). */
  baseRoll: number;
  /** The way this person faces when floating, before the mission's own turn (view.face). */
  baseYaw: number;
  /** Where the close-up looks from, radians round and up in the place's frame (set when placed). */
  lookYaw: number;
  lookPitch: number;
  halo: THREE.Mesh;
  haloMaterial: THREE.ShaderMaterial;
  haloGlow: number;
  haloPulse: boolean;
  material: LineMaterial;
  hit: THREE.Mesh;
  roll: number;
  phase: number;
  /** Where the figure is going, and where it is drawn (before bobbing). */
  goal: THREE.Vector3;
  at: THREE.Vector3;
  placed: boolean;
  asleep: boolean;
}

/** Hull lines that lie across modules' back faces, and across their front faces: each shown only while far. */
export interface Sides {
  facing: THREE.Vector3;
  back: LineSegments2;
  front: LineSegments2;
}

export interface Ship {
  root: THREE.Group;
  structure: LineMaterial;
  /** Beams, wings, legs and masts (the same as structure on the ship). */
  quiet: LineMaterial;
  /** The grid inside wings and radiators. */
  grid: LineMaterial;
  /** Modules that are not rooms. */
  closed: LineMaterial;
  lines: LineMaterial[];
  rooms: Map<string, RoomParts>;
  sides: Sides[];
  people: Map<string, Figure>;
  /** The ground on a surface; null in space. */
  ground: GroundMesh | null;
  stars: THREE.Points;
  dispose: () => void;
}

const WALL_VERTEX = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

// Light inside a room: brightest round the ceiling fitting, fading across the
// walls. A wall fades out as it turns edge-on to the viewer and is gone once
// seen from outside, so from any side the hull is only its outline and the
// rooms inside stay in view, and going round never makes a wall pop.
const WALL_FRAGMENT = /* glsl */ `
uniform vec3 base;
uniform vec3 tint;
uniform float strength;
uniform vec3 light;
uniform float reach;
uniform float fade;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  float d = distance(vLocal, light) / reach;
  float glow = strength / (1.0 + 4.0 * d * d);
  float facing = dot(normalize(vNormal), normalize(cameraPosition - vWorld));
  float alpha = smoothstep(0.0, 0.35, facing) * fade;
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(base + tint * glow, alpha);
  #include <colorspace_fragment>
}`;

const HALO_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const HALO_FRAGMENT = /* glsl */ `
uniform vec3 tint;
uniform float strength;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(tint * strength * a * a, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * Walls draw after every line, so a wall part-way through fading covers what is behind it by
 * just that much; the glow round a person draws after the walls, which would otherwise hide it.
 */
const WALLS = 10;

function wallMaterial(base: THREE.Color, light: THREE.Vector3, reach: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: WALL_VERTEX,
    fragmentShader: WALL_FRAGMENT,
    uniforms: {
      base: { value: base.clone() },
      tint: { value: new THREE.Color() },
      strength: { value: 0 },
      light: { value: light },
      reach: { value: reach },
      fade: { value: 1 },
    },
    side: THREE.DoubleSide,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 4,
  });
}

/**
 * The inner walls of a stretch of hull: every face round the section, the cut
 * included, and both end walls. The wall shader leaves out any face seen from
 * outside, so whichever side the station is seen from, the near wall is open.
 */
function shell(x0: number, x1: number, r0: number, r1: number, band: Band): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const a = section(r0, band);
  const b = section(r1, band);
  const cy = a.reduce((sum, p) => sum + p[0], 0) / a.length;
  const cz = a.reduce((sum, p) => sum + p[1], 0) / a.length;
  const tri = (p: number[], q: number[], r: number[], n: number[]) => {
    positions.push(...p, ...q, ...r);
    normals.push(...n, ...n, ...n);
  };
  for (let i = 0; i < a.length; i++) {
    const j = (i + 1) % a.length;
    const [ay, az] = a[i];
    const [by, bz] = a[j];
    // Inward normal of this face, in the cross-section.
    let ny = -(bz - az);
    let nz = by - ay;
    if (ny * (cy - (ay + by) / 2) + nz * (cz - (az + bz) / 2) < 0) { ny = -ny; nz = -nz; }
    const n = [0, ny, nz];
    const p0 = [x0, ay, az];
    const p1 = [x0, by, bz];
    const q0 = [x1, b[i][0], b[i][1]];
    const q1 = [x1, b[j][0], b[j][1]];
    tri(p0, q0, q1, n);
    tri(p0, q1, p1, n);
  }
  // End walls, set in a hair so neighbouring rooms' walls never fight.
  for (const [x, ring, nx] of [[x0 + 0.015, a, 1], [x1 - 0.015, b, -1]] as const) {
    const my = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
    const mz = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      tri([x, my, mz], [x, p[0], p[1]], [x, q[0], q[1]], [nx, 0, 0]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

/** A closed eight-sided prism with chamfered ends, along X: a pod or tank outside the hull. */
function pod(pen: Pen, x0: number, x1: number, y: number, z: number, r: number) {
  const ring = (x: number, rr: number): [number, number, number][] =>
    Array.from({ length: 8 }, (_, i) => {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      return [x, y + Math.cos(a) * rr, z + Math.sin(a) * rr];
    });
  const stations: [number, number][] = [[x0, r * 0.65], [x0 + 0.3, r], [x1 - 0.3, r], [x1, r * 0.65]];
  const rings = stations.map(([x, rr]) => ring(x, rr));
  for (const points of rings) pen.path(points, true);
  for (let s = 0; s < rings.length - 1; s++) {
    for (let i = 0; i < 8; i++) {
      const p = rings[s][i];
      const q = rings[s + 1][i];
      pen.seg(p[0], p[1], p[2], q[0], q[1], q[2]);
    }
  }
}

/** A seeded random number, so the stars are the same every time. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How each crewmate floats: a pose from the avatar's rig, which way they face (radians round
 * the vertical, 0 towards the viewer) and a slight tilt. Nobody stands or sits in orbit.
 */
const LOOKS: { pose: AvatarPose; yaw: number; roll: number }[] = [
  // The neutral body posture: knees drawn up, arms floating forward.
  { pose: posePresets.Floating, yaw: 0.45, roll: 0.12 },
  // Pushing off: one arm reaching ahead.
  { pose: posePresets.Reaching, yaw: -0.5, roll: -0.1 },
  // Drifting, arms loose.
  { pose: { ...neutralPose, leftShoulder: 45, rightShoulder: 35, leftElbow: 40, rightElbow: 55, leftHip: 50, rightHip: 35, leftKnee: 80, rightKnee: 60, headTurn: 10 }, yaw: 0.2, roll: 0.06 },
  // Reading: both forearms up, as if holding a tablet.
  { pose: { ...neutralPose, leftShoulder: 25, rightShoulder: 25, leftElbow: 100, rightElbow: 100, leftHip: 30, rightHip: 20, leftKnee: 45, rightKnee: 35, headTurn: -8 }, yaw: -0.8, roll: -0.05 },
];
/**
 * The joint angles of each activity's pose (see layout.ts stationsOf). The rig turns an upper arm
 * only sideways and bends the elbow forward, so hands reach forward by the forearm; the looped
 * movement (Station.tsx) swings whole limbs about the shoulder and hip.
 */
export const POSES: Record<PoseName, AvatarPose> = {
  // Weightless and doing nothing in particular: the relaxed posture, hands easy.
  float: { ...neutralPose, leftShoulder: 14, rightShoulder: 10, leftElbow: 45, rightElbow: 35, leftHip: 30, rightHip: 22, leftKnee: 50, rightKnee: 40 },
  stand: { ...neutralPose, leftShoulder: 6, rightShoulder: 5, leftElbow: 15, rightElbow: 10 },
  // Running on the treadmill, held by the harness: mid-stride, arms bent.
  run: { ...neutralPose, leftShoulder: 8, rightShoulder: 8, leftElbow: 85, rightElbow: 85, leftHip: 18, rightHip: -8, leftKnee: 55, rightKnee: 30 },
  walk: { ...neutralPose, leftShoulder: 6, rightShoulder: 6, leftElbow: 35, rightElbow: 35, leftHip: 10, rightHip: -6, leftKnee: 18, rightKnee: 8 },
  // On the cycle, clipped in: thighs forward, knees bent, hands forward on the bar.
  pedal: { ...neutralPose, leftShoulder: 10, rightShoulder: 10, leftElbow: 70, rightElbow: 70, leftHip: 80, rightHip: 60, leftKnee: 95, rightKnee: 75 },
  // At the table, toes under the foot bar, forearms on the table.
  table: { ...neutralPose, leftShoulder: 10, rightShoulder: 14, leftElbow: 85, rightElbow: 70, leftHip: 28, rightHip: 18, leftKnee: 50, rightKnee: 35 },
  // At a bench, a glovebox or the console: both hands forward at the work.
  work: { ...neutralPose, leftShoulder: 12, rightShoulder: 10, leftElbow: 90, rightElbow: 80, leftHip: 15, rightHip: 10, leftKnee: 25, rightKnee: 20 },
  standWork: { ...neutralPose, leftShoulder: 8, rightShoulder: 8, leftElbow: 85, rightElbow: 75 },
  // One hand on a rack or a locker beside them.
  reach: { ...neutralPose, leftShoulder: 12, rightShoulder: 38, leftElbow: 40, rightElbow: 95, leftHip: 12, rightHip: 8, leftKnee: 20, rightKnee: 15 },
  // Looking out of the cupola's windows, hands on the frame.
  look: { ...neutralPose, leftShoulder: 30, rightShoulder: 30, leftElbow: 60, rightElbow: 60, leftHip: 10, rightHip: 6, leftKnee: 15, rightKnee: 10, headTurn: 0 },
  // At the small screen in a cabin, or the sleep station: hands up to it.
  screen: { ...neutralPose, leftShoulder: 10, rightShoulder: 12, leftElbow: 95, rightElbow: 60, leftHip: 18, rightHip: 12, leftKnee: 30, rightKnee: 22 },
  seated: { ...posePresets.Seated },
};

/** Standing, with gravity: weight on both feet, arms easy, each a little different. */
const STANDING: AvatarPose[] = [
  { ...neutralPose, leftShoulder: 8, rightShoulder: 5, leftElbow: 15, rightElbow: 25, headTurn: -8 },
  { ...neutralPose, leftShoulder: 5, rightShoulder: 30, leftElbow: 10, rightElbow: 95, headTurn: 12 },
  { ...neutralPose, leftShoulder: 25, rightShoulder: 25, leftElbow: 100, rightElbow: 100, headTurn: -5 },
  { ...neutralPose, leftShoulder: 6, rightShoulder: 6, leftElbow: 20, rightElbow: 12, leftHip: 6, rightHip: -4, headTurn: 6 },
];
const SLEEPING: AvatarPose = { ...neutralPose, leftElbow: 30, rightElbow: 30, leftHip: 8, rightHip: 8, leftKnee: 12, rightKnee: 12 };

/** Two directions square to `d` (unit), the first as near "up" as it can be. */
function across(d: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const u = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  u.addScaledVector(d, -u.dot(d)).normalize();
  return [u, new THREE.Vector3().crossVectors(d, u)];
}

const v3 = (p: Vec3) => new THREE.Vector3(...p);
const segV = (pen: Pen, a: THREE.Vector3, b: THREE.Vector3) => pen.seg(a.x, a.y, a.z, b.x, b.y, b.z);

/** A circle round `c` in the plane of a and b (unit, square to each other). */
function circleIn(pen: Pen, c: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number, steps: number) {
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < steps; i++) {
    const t0 = (i / steps) * Math.PI * 2;
    const t1 = ((i + 1) / steps) * Math.PI * 2;
    p.copy(c).addScaledVector(a, Math.cos(t0) * r).addScaledVector(b, Math.sin(t0) * r);
    q.copy(c).addScaledVector(a, Math.cos(t1) * r).addScaledVector(b, Math.sin(t1) * r);
    segV(pen, p, q);
  }
}

/** A flat gridded wing: a solar array or a radiator (see Panel in engine/mission.ts). */
function wing(pen: Pen, panel: Panel, inner: Pen = pen) {
  const along = v3(panel.along).normalize();
  const base = v3(panel.across).normalize();
  const tilt = panel.tilt ?? 0;
  // The panel's width direction, turned about its length by the tilt.
  const side = base.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(new THREE.Vector3().crossVectors(along, base), Math.sin(tilt));
  const at = v3(panel.at);
  const point = (u: number, v: number) => at.clone().addScaledVector(along, v).addScaledVector(side, u);
  const cols = panel.cols ?? 4;
  const rows = panel.rows ?? 4;
  const v0 = panel.from;
  const v1 = panel.from + panel.length;
  for (const [a, b] of panel.panels) {
    // The outline in the wing's own line, the grid inside it in the (perhaps fainter) inner one.
    for (let i = 0; i <= cols; i++) {
      const u = a + ((b - a) * i) / cols;
      segV(i === 0 || i === cols ? pen : inner, point(u, v0), point(u, v1));
    }
    for (let j = 0; j <= rows; j++) {
      const v = v0 + ((v1 - v0) * j) / rows;
      segV(j === 0 || j === rows ? pen : inner, point(a, v), point(b, v));
    }
    if (panel.braces) segV(pen, point(a < 0 ? b : a, (v0 + v1) / 2), point(0, (v0 + v1) / 2));
  }
  if (panel.spine) segV(pen, point(0, 0), point(0, v1));
}

/** A beam: one line, or a square girder braced bay by bay. */
function girder(pen: Pen, from: THREE.Vector3, to: THREE.Vector3, size: number) {
  if (size <= 0) {
    segV(pen, from, to);
    return;
  }
  const d = to.clone().sub(from);
  const length = d.length();
  d.normalize();
  const [u, w] = across(d);
  const h = size / 2;
  const corners = [[h, h], [-h, h], [-h, -h], [h, -h]];
  const at = (t: number, k: number) => from.clone().addScaledVector(d, t).addScaledVector(u, corners[k % 4][0]).addScaledVector(w, corners[k % 4][1]);
  const bays = Math.max(1, Math.round(length / size));
  for (let k = 0; k < 4; k++) segV(pen, at(0, k), at(length, k));
  for (let b = 0; b <= bays; b++) {
    const t = (length * b) / bays;
    for (let k = 0; k < 4; k++) segV(pen, at(t, k), at(t, k + 1));
    if (b === bays) break;
    const t1 = (length * (b + 1)) / bays;
    // One diagonal across each face, alternating bay by bay.
    for (let k = 0; k < 4; k++) segV(pen, at(b % 2 ? t : t1, k), at(b % 2 ? t1 : t, k + 1));
  }
}

/** The rings of a dome, from its floor to its top, as points in its own frame. */
function domeRings(radius: number, height: number, sides: number, rings = 3): THREE.Vector3[][] {
  const out: THREE.Vector3[][] = [];
  for (let k = 0; k <= rings; k++) {
    const phi = (k / rings) * (Math.PI / 2);
    out.push(Array.from({ length: sides }, (_, i) => {
      const a = Math.PI / sides + (i * 2 * Math.PI) / sides;
      return new THREE.Vector3(Math.cos(a) * radius * Math.cos(phi), height * Math.sin(phi), Math.sin(a) * radius * Math.cos(phi));
    }));
  }
  return out;
}

/** A dome's outline: floor ring, the rings above, and a line up each corner. */
function domeLines(pen: Pen, radius: number, height: number, sides: number) {
  const rings = domeRings(radius, height, sides);
  for (let k = 0; k < rings.length - 1; k++) {
    pen.path(rings[k].map((p) => [p.x, p.y, p.z] as [number, number, number]), true);
    for (let i = 0; i < sides; i++) segV(pen, rings[k][i], rings[k + 1][i]);
  }
}

/** The inner faces of a dome (and its floor, with gravity), normals inwards, for the wall shader. */
function domeShell(radius: number, height: number, sides: number, floor: boolean): THREE.BufferGeometry {
  const rings = domeRings(radius, height, sides);
  const positions: number[] = [];
  const normals: number[] = [];
  const inside = new THREE.Vector3(0, height * 0.3, 0);
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    mid.copy(a).add(b).add(c).divideScalar(3);
    if (n.dot(inside.clone().sub(mid)) < 0) n.negate();
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
  };
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      tri(rings[k][i], rings[k + 1][i], rings[k + 1][j]);
      tri(rings[k][i], rings[k + 1][j], rings[k][j]);
    }
  }
  if (floor) {
    const centre = new THREE.Vector3(0, 0.01, 0);
    for (let i = 0; i < sides; i++) {
      const a = rings[0][i].clone().setY(0.01);
      const b = rings[0][(i + 1) % sides].clone().setY(0.01);
      positions.push(centre.x, centre.y, centre.z, a.x, a.y, a.z, b.x, b.y, b.z);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

/** The ratios of an engine bell (from the throat): along its length, and of its exit radius. */
const BELL: [number, number][] = [[0, 0.22 / 0.62], [0.2 / 1.5, 0.26 / 0.62], [0.85 / 1.5, 0.44 / 0.62], [1, 1]];

export function buildShip(scene: THREE.Scene, mission: Mission, modules: ModuleFrame[], places: RoomPlace[], crew: string[], ink: THREE.Color, bg: THREE.Color): Ship {
  const root = new THREE.Group();
  scene.add(root);
  const lines: LineMaterial[] = [];
  const line = (width: number) => {
    const material = new LineMaterial({ color: ink.getHex(), linewidth: width });
    // Lines fade into the dark with distance, so the near side of the station reads first.
    material.fog = true;
    lines.push(material);
    return material;
  };
  const pen = new Pen();
  // A part shown on one side only gets its own material, which follows another's colour and
  // width (set by status) and fades in and out as the viewer goes round (see Station.tsx).
  const follower = (width: number) => {
    const material = line(width);
    material.transparent = true;
    return material;
  };
  const structure = line(1.5);
  // What cannot be interacted with is context, drawn quieter and thinner than the rooms (unless
  // the mission asks for its extras at full strength, as the ship does): beams, wings, legs and
  // masts in one line, the inner grid of wings and radiators fainter still, and modules nobody
  // works in between those and the rooms, closed rather than cut away.
  const full = mission.view?.extras === 'full';
  const quiet = full ? structure : line(1.0);
  const grid = full ? structure : line(0.8);
  const closed = full ? structure : line(1.2);
  const outside = full ? pen : new Pen();
  const inner = full ? pen : new Pen();
  const shut = full ? pen : new Pen();
  const byId = new Map(modules.map((m) => [m.spec.id, m]));
  const gravity = mission.gravity > 0;

  // Modules. A hull's corner lines on its top and bottom faces belong to the structure; those on
  // its back and front faces (corners 2, 3 and 6, 7) are drawn apart, by the way the module
  // faces, and shown only while their face is the far one, since from the near side they would
  // cross the rooms.
  const sidePens = new Map<string, { facing: THREE.Vector3; back: Pen; front: Pen }>();
  const sidesOf = (m: ModuleFrame) => {
    const key = m.front.toArray().map((v) => Math.round(v * 100)).join(',');
    let entry = sidePens.get(key);
    if (!entry) sidePens.set(key, entry = { facing: m.front.clone(), back: new Pen(), front: new Pen() });
    return entry;
  };
  const neutralWalls: THREE.BufferGeometry[] = [];
  for (const m of modules) {
    const { spec } = m;
    pen.frame(m.matrix);
    shut.frame(m.matrix);
    if (m.look === 'hull' && !spec.isRoom && !full) {
      // A module nobody works in: closed, every corner drawn, in the in-between line.
      const corner = (x: number) => section(radiusAt(m, x), 'full');
      const a = corner(m.x0);
      const b = corner(m.x1);
      for (let i = 0; i < 8; i++) shut.seg(m.x0, a[i][0], a[i][1], m.x1, b[i][0], b[i][1]);
      for (const x of [m.x0, m.x1]) shut.path(corner(x).map(([y, z]) => [x, y, z]), true);
      continue;
    }
    if (m.look === 'hull') {
      const corner = (x: number) => section(radiusAt(m, x), 'full');
      const a = corner(m.x0);
      const b = corner(m.x1);
      for (const i of [0, 1, 4, 5]) pen.seg(m.x0, a[i][0], a[i][1], m.x1, b[i][0], b[i][1]);
      const stops = new Set([m.x0, m.x1]);
      for (const c of spec.cabins ?? []) for (const at of [c.from, c.to]) stops.add(m.x0 + at / m.scale);
      for (const x of stops) pen.path(corner(x).map(([y, z]) => [x, y, z]), true);
      const sides = sidesOf(m);
      sides.back.frame(m.matrix);
      sides.front.frame(m.matrix);
      for (const i of [2, 3]) sides.back.seg(m.x0, a[i][0], a[i][1], m.x1, b[i][0], b[i][1]);
      for (const i of [6, 7]) sides.front.seg(m.x0, a[i][0], a[i][1], m.x1, b[i][0], b[i][1]);
      if (spec.cabins?.some((c) => c.band === 'lower')) {
        // The deck between the upper and lower cabins meets the back and front walls here.
        sides.back.seg(m.x0, 0, -COS * m.r0, m.x1, 0, -COS * m.r1);
        sides.front.seg(m.x0, 0, COS * m.r0, m.x1, 0, COS * m.r1);
      }
      if (!spec.isRoom) neutralWalls.push(shell(m.x0, m.x1, m.r0, m.r1, 'full').applyMatrix4(m.matrix));
    } else if (m.look === 'pod') {
      pod(shut, m.x0, m.x1, 0, 0, m.r0);
      // Two short struts to the hull it hangs from.
      const parent = spec.attachedTo ? byId.get(spec.attachedTo.module) : undefined;
      if (parent && (spec.attachedTo!.port === 'zenith' || spec.attachedTo!.port === 'nadir')) {
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion);
        const offset = new THREE.Vector3().fromArray(parent.spec.position).sub(new THREE.Vector3().fromArray(spec.position)).dot(up);
        const sign = Math.sign(offset);
        const gap = Math.abs(offset) - COS * Math.max(parent.r0, parent.r1) * parent.scale;
        for (const x of [-0.25, 0.25]) shut.seg(x, sign * gap, 0, x, sign * (gap - 0.2), 0);
      }
    } else if (m.look === 'outline') {
      const a = ring(m.r0, m.sides);
      const b = ring(m.r1, m.sides);
      shut.path(a.map(([y, z]) => [m.x0, y, z]), true);
      shut.path(b.map(([y, z]) => [m.x1, y, z]), true);
      for (let i = 0; i < m.sides; i++) shut.seg(m.x0, a[i][0], a[i][1], m.x1, b[i][0], b[i][1]);
    } else if (m.look === 'box') {
      shut.box(m.x0, -m.r1, -m.r0, m.x1, m.r1, m.r0);
    } else if (m.dome) {
      domeLines(spec.isRoom ? pen : shut, m.dome.radius, m.dome.height, m.sides);
    }
  }
  shut.frame(null);
  // Hatches between rooms that meet end to end: one on each side of the bulkhead, just clear of its wall.
  const end = new THREE.Vector3();
  const other = new THREE.Vector3();
  for (const m of modules) {
    const parent = m.spec.attachedTo ? byId.get(m.spec.attachedTo.module) : undefined;
    if (!parent || m.look !== 'hull' || parent.look !== 'hull' || !m.spec.isRoom || !parent.spec.isRoom) continue;
    for (const x of [m.x0, m.x1]) {
      end.set(x, 0, 0).applyMatrix4(m.matrix);
      const meets = [parent.x0, parent.x1].some((px) => other.set(px, 0, 0).applyMatrix4(parent.matrix).distanceTo(end) < 0.05);
      if (!meets) continue;
      pen.frame(m.matrix);
      for (const hx of [x - 0.03, x + 0.03]) {
        const h = 0.42;
        const c = 0.14;
        pen.path([[hx, -0.2 + h, -h + c], [hx, -0.2 + h, h - c], [hx, -0.2 + h - c, h], [hx, -0.2 - h + c, h],
          [hx, -0.2 - h, h - c], [hx, -0.2 - h, -h + c], [hx, -0.2 - h + c, -h], [hx, -0.2 + h - c, -h]], true);
      }
    }
  }
  pen.frame(null);

  // Engines: bells behind the hull.
  for (const e of mission.engines ?? []) {
    const axis = v3(e.axis).normalize();
    const [u, w] = across(axis);
    const at = v3(e.at);
    const ringAt = (k: number) => at.clone().addScaledVector(axis, BELL[k][0] * e.length);
    for (let k = 1; k < BELL.length; k++) circleIn(pen, ringAt(k), u, w, BELL[k][1] * e.radius, 16);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      for (let k = 0; k < BELL.length - 1; k++) {
        const p = ringAt(k).addScaledVector(u, Math.cos(a) * BELL[k][1] * e.radius).addScaledVector(w, Math.sin(a) * BELL[k][1] * e.radius);
        const q = ringAt(k + 1).addScaledVector(u, Math.cos(a) * BELL[k + 1][1] * e.radius).addScaledVector(w, Math.sin(a) * BELL[k + 1][1] * e.radius);
        segV(pen, p, q);
      }
    }
  }
  // Antennas: a base on the hull, a mast and a two-ring dish.
  for (const a of mission.antennas ?? []) {
    const up = v3(a.up).normalize();
    const [, side] = across(up);
    const flat = new THREE.Vector3().crossVectors(up, side).negate();
    const foot = v3(a.at);
    const box = (u0: number, h0: number, w0: number, u1: number, h1: number, w1: number) => {
      const p = (uu: number, hh: number, ww: number) => foot.clone().addScaledVector(flat, uu).addScaledVector(up, hh).addScaledVector(side, ww);
      for (const [hh] of [[h0], [h1]]) for (const [ua, wa, ub, wb] of [[u0, w0, u1, w0], [u1, w0, u1, w1], [u1, w1, u0, w1], [u0, w1, u0, w0]]) segV(pen, p(ua, hh, wa), p(ub, hh, wb));
      for (const [uu, ww] of [[u0, w0], [u1, w0], [u1, w1], [u0, w1]]) segV(pen, p(uu, h0, ww), p(uu, h1, ww));
    };
    box(-0.2, 0, -0.2, 0.2, 0.16, 0.2);
    segV(pen, foot.clone().addScaledVector(up, 0.16), foot.clone().addScaledVector(up, a.height - a.dish));
    const top = foot.clone().addScaledVector(up, a.height);
    circleIn(pen, top, flat, up, a.dish, 14);
    circleIn(pen, top, up, side, a.dish, 14);
  }
  for (const t of mission.trusses ?? []) girder(outside, v3(t.from), v3(t.to), t.size ?? 0);
  for (const p of [...(mission.solarArrays ?? []), ...(mission.radiators ?? [])]) wing(outside, p, inner);
  // Legs and pads under modules that stand on the ground.
  for (const l of mission.legs ?? []) {
    const m = byId.get(l.module);
    if (!m) continue;
    const feet: THREE.Vector3[] = [];
    if (m.dome) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        feet.push(new THREE.Vector3(Math.cos(a) * m.dome.radius * 0.75, 0, Math.sin(a) * m.dome.radius * 0.75).applyMatrix4(m.matrix));
      }
    } else {
      const r = Math.max(m.r0, m.r1);
      for (const x of [m.x0 + 0.7, m.x1 - 0.7]) for (const z of [-SIN * r * 0.8, SIN * r * 0.8]) feet.push(new THREE.Vector3(x, -COS * r, z).applyMatrix4(m.matrix));
    }
    for (const f of feet) {
      outside.seg(f.x, f.y, f.z, f.x, f.y - l.height, f.z);
      outside.rectXZ(f.x - 0.22, f.z - 0.22, f.x + 0.22, f.z + 0.22, f.y - l.height + 0.02);
    }
  }
  root.add(pen.lines(structure));
  if (outside !== pen) root.add(outside.lines(quiet));
  if (inner !== pen) root.add(inner.lines(grid));
  if (shut !== pen) root.add(shut.lines(closed));
  const sides: Sides[] = [];
  for (const { facing, back, front } of sidePens.values()) {
    const b = back.lines(follower(1.5));
    const f = front.lines(follower(1.5));
    f.visible = false;
    root.add(b, f);
    sides.push({ facing, back: b, front: f });
  }

  // Unlit walls for the hull modules nobody works in (the ship's engine section).
  if (neutralWalls.length) {
    const neutral = wallMaterial(bg, new THREE.Vector3(), 1);
    const walls = new THREE.Mesh(neutralWalls.length === 1 ? neutralWalls[0] : mergeGeometries(neutralWalls)!, neutral);
    walls.renderOrder = WALLS;
    root.add(walls);
  }

  const unseen = new THREE.MeshBasicMaterial({ visible: false });
  const rooms = new Map<string, RoomParts>();
  // The inside of a room: a neutral lift a little above the background (app.css --scene-room-fill).
  const fillValue = getComputedStyle(document.documentElement).getPropertyValue('--scene-room-fill').trim();
  const roomFill = fillValue ? new THREE.Color(fillValue) : bg.clone();
  const lit = new THREE.Vector3();
  for (const place of places) {
    const { frame: m } = place;
    pen.frame(m.matrix);
    const frame = line(1.75);
    const detail = line(1.5);
    detail.transparent = true;
    let frontEdge: LineSegments2;
    let backEdge: LineSegments2;
    if (m.dome) {
      // A dome's opening is its floor: the same ring shows from either side.
      const ringPoints = domeRings(m.dome.radius - 0.05, 0, m.sides)[0].map((p) => [p.x, 0.04, p.z] as [number, number, number]);
      pen.path(ringPoints, true);
      frontEdge = pen.lines(follower(1.75));
      pen.path(ringPoints, true);
      backEdge = pen.lines(follower(1.75));
    } else {
      // The edge of the opening on one side (+1 front, -1 back): from the hull's top corner on that
      // side to its bottom one (or the deck), set in a little so it reads inside the hull's own lines.
      const rim = (x: number, side: number): [number, number, number][] => {
        const r = radiusAt(place, x);
        const c = COS * r - 0.04;
        const s = SIN * r - 0.04;
        const top: [number, number] = place.band === 'lower' ? [-0.05, side * c] : [c, side * s];
        const bottom: [number, number] = place.band === 'upper' ? [0.05, side * c] : [-c, side * s];
        return [[x, top[0], top[1]], [x, bottom[0], bottom[1]]];
      };
      const opening = (side: number) => {
        const [a0, a1] = rim(place.x0 + 0.08, side);
        const [b0, b1] = rim(place.x1 - 0.08, side);
        pen.path([a0, b0, b1, a1], true);
        return pen.lines(follower(1.75));
      };
      frontEdge = opening(1);
      backEdge = opening(-1);
    }
    backEdge.visible = false;
    furnish(pen, place, 'room');
    const detailLines = pen.lines(detail);
    furnish(pen, place, 'back');
    const back = pen.lines(follower(1.5));
    furnish(pen, place, 'front');
    const front = pen.lines(follower(1.5));
    front.visible = false;
    for (const object of [back, front]) object.frustumCulled = false;
    let walls: THREE.Mesh;
    let wall: THREE.ShaderMaterial;
    let box: THREE.BoxGeometry;
    const hitAt = new THREE.Vector3();
    if (m.dome) {
      lit.set(0, m.dome.height * 0.8, 0).applyMatrix4(m.matrix);
      wall = wallMaterial(roomFill, lit.clone(), m.dome.radius * 0.9);
      walls = new THREE.Mesh(domeShell(m.dome.radius, m.dome.height, m.sides, place.gravity > 0).applyMatrix4(m.matrix), wall);
      box = new THREE.BoxGeometry(m.dome.radius * 1.8, m.dome.height, m.dome.radius * 1.8);
      hitAt.set(0, m.dome.height / 2, 0);
    } else {
      const [cx, cy] = centreOf(place);
      const full = place.band === 'full';
      lit.copy(full ? new THREE.Vector3(cx, COS * radiusAt(place, cx) - 0.4, -0.7) : new THREE.Vector3(cx + 0.5, cy + (place.band === 'upper' ? 0.1 : -0.1), -1.4)).applyMatrix4(m.matrix);
      wall = wallMaterial(roomFill, lit.clone(), (full ? 3.4 : 2.0) * m.scale);
      walls = new THREE.Mesh(shell(place.x0, place.x1, place.r0, place.r1, place.band).applyMatrix4(m.matrix), wall);
      const r = Math.max(place.r0, place.r1);
      const [hi, lo] = bandEdges(r, place.band);
      box = new THREE.BoxGeometry(place.x1 - place.x0, hi - lo, 2 * COS * r);
      hitAt.set(cx, (hi + lo) / 2, 0);
    }
    walls.renderOrder = WALLS;
    const hit = new THREE.Mesh(box, unseen);
    hit.matrixAutoUpdate = false;
    hit.matrix.copy(m.matrix).multiply(new THREE.Matrix4().makeTranslation(hitAt));
    hit.userData = { kind: 'room', id: place.id };
    root.add(walls, frontEdge, backEdge, detailLines, back, front, hit);
    rooms.set(place.id, { place, facing: m.front.clone(), frame, frontEdge, backEdge, detail, back, front, wall, wallsShown: 1, glow: 0, pulse: false, hit });
  }
  pen.frame(null);

  // The ground, on a surface.
  const ground = mission.ground && mission.where.body ? createGround(mission.ground, mission.where.body, bg) : null;
  if (ground) root.add(ground.mesh);

  // The crew.
  const people = new Map<string, Figure>();
  const haloGeometry = new THREE.PlaneGeometry(2.1, 2.1);
  // Each crewmate is the 3D crew avatar, posed. Its outline takes the figure's one line material
  // (so the scene can tint it by status) and its solid faces take the background colour, so a
  // person hides what is behind them and stays legible over furniture.
  const posed = (material: LineMaterial, pose: AvatarPose) => {
    const avatar = createCrewAvatar();
    const rig = createPoseRig(avatar.root, new THREE.Group());
    rig.setPose(pose);
    avatar.root.traverse((object) => {
      if (object instanceof LineSegments2) {
        (object.material as LineMaterial).dispose();
        object.material = material;
        object.renderOrder = 2;
      } else if (object instanceof THREE.Mesh) {
        (object.material as THREE.MeshBasicMaterial).color.copy(bg);
      }
    });
    // The avatar stands on y = 0; the scene places people by the middle of the body.
    avatar.root.position.y = -0.95;
    const limb = (name: 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg') => avatar.regions.get(name) ?? new THREE.Group();
    return { root: avatar.root, rig, limbs: { leftArm: limb('leftArm'), rightArm: limb('rightArm'), leftLeg: limb('leftLeg'), rightLeg: limb('rightLeg') } };
  };
  crew.forEach((id, i) => {
    const material = line(2);
    material.transparent = true;
    const look = LOOKS[i % LOOKS.length];
    const holder = new THREE.Group();
    const face = new THREE.Group();
    const turn = new THREE.Group();
    // One awake body, re-posed for what the person is doing where they are (Station.tsx).
    const body = posed(material, gravity ? STANDING[i % STANDING.length] : POSES.float);
    turn.add(body.root);
    face.rotation.y = gravity ? 0 : look.yaw;
    face.add(turn);
    const sit = null;
    // Asleep: zipped into the bag on the cabin's end wall, upright, facing into the cabin.
    const sleep = new THREE.Group();
    sleep.add(posed(material, SLEEPING).root);
    sleep.rotation.y = -Math.PI / 2;
    sleep.scale.setScalar(0.9);
    const haloMaterial = new THREE.ShaderMaterial({
      vertexShader: HALO_VERTEX,
      fragmentShader: HALO_FRAGMENT,
      uniforms: { tint: { value: new THREE.Color() }, strength: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.renderOrder = WALLS + 1;
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), unseen);
    hit.userData = { kind: 'person', id };
    holder.add(halo, face, sleep, hit);
    holder.visible = false;
    root.add(holder);
    people.set(id, {
      holder, face, turn, sleep, sit, rig: body.rig, limbs: body.limbs, poseName: '', motion: 'still', moving: false, baseRoll: gravity ? 0 : look.roll,
      halo, haloMaterial, haloGlow: 0, haloPulse: false, material, hit,
      baseYaw: gravity ? 0 : look.yaw, lookYaw: 0, lookPitch: 0, roll: gravity ? 0 : look.roll, phase: i * 1.9, goal: new THREE.Vector3(), at: new THREE.Vector3(), placed: false, asleep: false,
    });
  });

  // A few faint stars, far away.
  const random = seeded(7);
  const starPositions: number[] = [];
  const starColours: number[] = [];
  const faint = new THREE.Color();
  for (let i = 0; i < 420; i++) {
    const u = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    starPositions.push(Math.cos(a) * s * 120, u * 120, Math.sin(a) * s * 120);
    faint.copy(bg).lerp(ink, 0.3 + random() * random() * 0.6);
    starColours.push(faint.r, faint.g, faint.b);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColours, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false }));
  scene.add(stars);

  const dispose = () => {
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const material = object.material as THREE.Material | THREE.Material[];
        for (const m of Array.isArray(material) ? material : [material]) m.dispose();
      }
    });
    haloGeometry.dispose();
    scene.remove(root, stars);
  };

  return { root, structure, quiet, grid, closed, lines, rooms, sides, people, ground, stars, dispose };
}
