// Builds the station's 3D drawing: the cut-open hull, solar arrays, antenna and
// engines, each room's walls (which carry its status light), its furniture,
// the crew figures and a few stars. Station.tsx owns the scene and animates
// it; this file only makes the parts and hands back what can be changed.

import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { furnish } from './furniture.ts';
import { createCrewAvatar } from '../avatar/CrewAvatar.ts';
import { createPoseRig, neutralPose, posePresets } from '../avatar/PoseRig.ts';
import type { AvatarPose } from '../avatar/PoseRig.ts';
import { AFT, COS, R, SIN, bandEdges, centreOf, radiusAt, section } from './layout.ts';
import type { Band, RoomPlace } from './layout.ts';
import { Pen } from './pen.ts';

export interface RoomParts {
  place: RoomPlace;
  /** The edge of the room's opening: tinted and thickened by its status. */
  frame: LineMaterial;
  /** That edge drawn on the front (the cut) and on the back: the view shows the near one. */
  frontEdge: THREE.Object3D;
  backEdge: THREE.Object3D;
  /** Furniture and fittings. */
  detail: LineMaterial;
  /** What hangs on each long wall: shown only while that wall is the far one. */
  back: THREE.Object3D;
  front: THREE.Object3D;
  /** The room's inner walls, lit by its status. */
  wall: THREE.ShaderMaterial;
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
  /** The sleeping figure, in the bag on the cabin wall. */
  sleep: THREE.Group;
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

export interface Ship {
  root: THREE.Group;
  structure: LineMaterial;
  lines: LineMaterial[];
  rooms: Map<string, RoomParts>;
  /** Hull lines that lie across the back face, and across the front: each shown only while far. */
  backLines: THREE.Object3D;
  frontLines: THREE.Object3D;
  people: Map<string, Figure>;
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
// walls. A wall seen from outside is not drawn at all, so from any side the
// hull is only its outline and the rooms inside stay in view.
const WALL_FRAGMENT = /* glsl */ `
uniform vec3 base;
uniform vec3 tint;
uniform float strength;
uniform vec3 light;
uniform float reach;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  float d = distance(vLocal, light) / reach;
  float glow = strength / (1.0 + 4.0 * d * d);
  if (dot(vNormal, cameraPosition - vWorld) <= 0.0) discard;
  gl_FragColor = vec4(base + tint * glow, 1.0);
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
    },
    side: THREE.DoubleSide,
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
const SLEEPING: AvatarPose = { ...neutralPose, leftElbow: 30, rightElbow: 30, leftHip: 8, rightHip: 8, leftKnee: 12, rightKnee: 12 };

export function buildShip(scene: THREE.Scene, places: RoomPlace[], crew: string[], ink: THREE.Color, bg: THREE.Color): Ship {
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
  const structure = line(1.5);

  // The hull: rings at every bulkhead, edges along every corner.
  const segments = [{ x0: -12.5, x1: -9, r0: 0.62 * R, r1: R }, { x0: -9, x1: AFT.x0, r0: R, r1: R }, AFT];
  const corner = (r: number) => section(r, 'full');
  // Corners 2 and 3 bound the back face, 6 and 7 the front: each pair is drawn apart (below) and shown only
  // while its face is the far one, since from the near side those lines would cross the rooms.
  const along = (from: number[]) => {
    for (const s of segments) {
      const a = corner(s.r0);
      const b = corner(s.r1);
      for (const i of from) pen.seg(s.x0, a[i][0], a[i][1], s.x1, b[i][0], b[i][1]);
    }
  };
  along([0, 1, 4, 5]);
  for (const x of [-12.5, -9, -4, 1, 5.5, 7.9, 10.3, 11.2]) {
    const r = x < -9 ? radiusAt(segments[0], x) : x > AFT.x0 ? radiusAt(AFT, x) : R;
    pen.path(corner(r).map(([y, z]) => [x, y, z]), true);
  }
  // Hatches between the big rooms: one on each side of the bulkhead, just clear of its wall.
  for (const x of [-9, -4, 1, 5.5].flatMap((b) => [b - 0.03, b + 0.03])) {
    const h = 0.42;
    const c = 0.14;
    pen.path([[x, -0.2 + h, -h + c], [x, -0.2 + h, h - c], [x, -0.2 + h - c, h], [x, -0.2 - h + c, h],
      [x, -0.2 - h, h - c], [x, -0.2 - h, -h + c], [x, -0.2 - h + c, -h], [x, -0.2 + h - c, -h]], true);
  }
  // Engines: two bells behind the aft cap.
  for (const y of [0.78, -0.78]) {
    const bell: [number, number][] = [[11.2, 0.22], [11.4, 0.26], [12.05, 0.44], [12.7, 0.62]];
    for (const [x, r] of bell.slice(1)) pen.circle(x, y, -0.35, r, 'yz', 16);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      for (let k = 0; k < bell.length - 1; k++) {
        const [xa, ra] = bell[k];
        const [xb, rb] = bell[k + 1];
        pen.seg(xa, y + Math.cos(a) * ra, -0.35 + Math.sin(a) * ra, xb, y + Math.cos(a) * rb, -0.35 + Math.sin(a) * rb);
      }
    }
  }
  // An airlock on top, a storage pod below, and the antenna.
  const top = COS * R;
  pod(pen, -7.9, -5.6, top + 0.8, -0.5, 0.62);
  pen.seg(-7.0, top, -0.5, -7.0, top + 0.2, -0.5).seg(-6.5, top, -0.5, -6.5, top + 0.2, -0.5);
  pod(pen, 2.1, 4.4, -top - 0.8, -0.5, 0.62);
  pen.seg(3.0, -top, -0.5, 3.0, -top - 0.2, -0.5).seg(3.5, -top, -0.5, 3.5, -top - 0.2, -0.5);
  pen.box(8.4, top, -0.55, 8.8, top + 0.16, -0.15);
  pen.seg(8.6, top + 0.16, -0.35, 8.6, top + 1.45, -0.35);
  pen.circle(8.6, top + 1.62, -0.35, 0.17, 'xy', 14).circle(8.6, top + 1.62, -0.35, 0.17, 'yz', 14);
  // Solar arrays on a mast behind the galley, angled a little so they read as panels.
  const mastX = -1.5;
  const mastZ = -COS * R - 0.7;
  const reach = top + 0.45 + 2.8;
  pen.seg(mastX, -reach, mastZ, mastX, reach, mastZ).seg(mastX, 0, -COS * R, mastX, 0, mastZ);
  for (const side of [1, -1]) {
    const tilt = side * 0.32;
    const toWorld = (x: number, y: number): [number, number, number] => {
      const dx = x - mastX;
      return [mastX + dx * Math.cos(tilt), y, mastZ - dx * Math.sin(tilt)];
    };
    const y0 = side * (top + 0.45);
    const y1 = side * reach;
    for (const [xa, xb] of [[-4.6, -1.8], [-1.2, 1.6]]) {
      const cols = 5;
      const rows = 4;
      for (let i = 0; i <= cols; i++) {
        const x = xa + ((xb - xa) * i) / cols;
        pen.path([toWorld(x, y0), toWorld(x, y1)]);
      }
      for (let j = 0; j <= rows; j++) {
        const y = y0 + ((y1 - y0) * j) / rows;
        pen.path([toWorld(xa, y), toWorld(xb, y)]);
      }
      pen.path([toWorld(xa < mastX ? xb : xa, (y0 + y1) / 2), toWorld(mastX, (y0 + y1) / 2)]);
    }
  }
  root.add(pen.lines(structure));
  along([2, 3]);
  // The deck between the upper and lower cabins meets the back wall here.
  pen.seg(5.5, 0, -COS * R, AFT.x0, 0, -COS * R);
  const backLines = pen.lines(structure);
  along([6, 7]);
  pen.seg(5.5, 0, COS * R, AFT.x0, 0, COS * R);
  const frontLines = pen.lines(structure);
  frontLines.visible = false;
  root.add(backLines, frontLines);

  // The engine section's walls, unlit.
  const neutral = wallMaterial(bg, new THREE.Vector3(), 1);
  root.add(new THREE.Mesh(shell(AFT.x0, AFT.x1, AFT.r0, AFT.r1, 'full'), neutral));

  const unseen = new THREE.MeshBasicMaterial({ visible: false });
  const rooms = new Map<string, RoomParts>();
  for (const place of places) {
    const frame = line(1.75);
    const detail = line(1.5);
    detail.transparent = true;
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
      return pen.lines(frame);
    };
    const frontEdge = opening(1);
    const backEdge = opening(-1);
    backEdge.visible = false;
    furnish(pen, place, 'room');
    const detailLines = pen.lines(detail);
    furnish(pen, place, 'back');
    const back = pen.lines(detail);
    furnish(pen, place, 'front');
    const front = pen.lines(detail);
    front.visible = false;
    const [cx, cy] = centreOf(place);
    const full = place.band === 'full';
    const light = full ? new THREE.Vector3(cx, COS * radiusAt(place, cx) - 0.4, -0.7) : new THREE.Vector3(cx + 0.5, cy + (place.band === 'upper' ? 0.1 : -0.1), -1.4);
    const wall = wallMaterial(bg, light, full ? 3.4 : 2.0);
    const walls = new THREE.Mesh(shell(place.x0, place.x1, place.r0, place.r1, place.band), wall);
    const r = Math.max(place.r0, place.r1);
    const [hi, lo] = bandEdges(r, place.band);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(place.x1 - place.x0, hi - lo, 2 * COS * r), unseen);
    hit.position.set(cx, (hi + lo) / 2, 0);
    hit.userData = { kind: 'room', id: place.id };
    root.add(walls, frontEdge, backEdge, detailLines, back, front, hit);
    rooms.set(place.id, { place, frame, frontEdge, backEdge, detail, back, front, wall, glow: 0, pulse: false, hit });
  }

  // The crew.
  const people = new Map<string, Figure>();
  const haloGeometry = new THREE.PlaneGeometry(2.1, 2.1);
  // Each crewmate is the 3D crew avatar, posed. Its outline takes the figure's one line material
  // (so the scene can tint it by status) and its solid faces take the background colour, so a
  // person hides what is behind them and stays legible over furniture.
  const posed = (material: LineMaterial, pose: AvatarPose) => {
    const avatar = createCrewAvatar();
    createPoseRig(avatar.root, new THREE.Group()).setPose(pose);
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
    return avatar.root;
  };
  crew.forEach((id, i) => {
    const material = line(2);
    material.transparent = true;
    const look = LOOKS[i % LOOKS.length];
    const holder = new THREE.Group();
    const face = new THREE.Group();
    const turn = new THREE.Group();
    turn.add(posed(material, look.pose));
    face.rotation.y = look.yaw;
    face.add(turn);
    // Asleep: zipped into the bag on the cabin's end wall, upright, facing into the cabin.
    const sleep = new THREE.Group();
    sleep.add(posed(material, SLEEPING));
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
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), unseen);
    hit.userData = { kind: 'person', id };
    holder.add(halo, face, sleep, hit);
    holder.visible = false;
    root.add(holder);
    people.set(id, {
      holder, face, turn, sleep, halo, haloMaterial, haloGlow: 0, haloPulse: false, material, hit,
      roll: look.roll, phase: i * 1.9, goal: new THREE.Vector3(), at: new THREE.Vector3(), placed: false, asleep: false,
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

  return { root, structure, lines, rooms, backLines, frontLines, people, stars, dispose };
}
