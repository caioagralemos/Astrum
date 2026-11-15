// The drawing the steps share: one renderer filling the window behind the
// takeover screen, the sky (the hub's faint blue lift and square pixel stars),
// the ship (the hub's own drawing, from the same mission file), and the small
// marks a step can lay over its figures: a ring on a point of contact, a thin
// arrow, a path. The camera is framed on the part of the window left free for
// the animation (the stage), the way the hub frames the station between its
// top bar and its widgets.

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { buildShip } from './ship/build.ts';
import type { Ship } from './ship/build.ts';
import { COS, R, layoutOf } from './ship/layout.ts';
import type { RoomPlace } from './ship/layout.ts';
import type { Mission } from '../../../engine/mission.ts';
import shipMission from '../../../profiles/missions/ship-mars-orbit.json';

export const MISSION = shipMission as unknown as Mission;

function cssColour(name: string, fallback: string): THREE.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(value || fallback);
}

const SKY_VERTEX = 'void main() { gl_Position = vec4(position.xy, 0.9999, 1.0); }';
// The sky, in screen space: the background, a faint blue lift towards the middle, and
// square pixel stars (a few twinkle in steps), all from a hash of the pixel grid, so
// the same frame is the same picture at any time.
const SKY_FRAGMENT = /* glsl */ `
uniform vec2 size;
uniform float block;
uniform float time;
uniform vec3 base;
uniform vec3 lift;
uniform vec3 ink;
uniform vec2 centre;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 q = (p - centre) / size.y;
  float d = length(q * vec2(0.55, 1.1));
  vec3 colour = base + lift * 0.8 * exp(-d * d * 2.6);
  vec2 cell = floor(p / block);
  float h = hash(cell);
  if (h > 0.9972) {
    float k = hash(cell + 17.0);
    float level = 0.18 + 0.5 * k * k;
    float rate = 0.6 + 1.6 * hash(cell + 3.0);
    float wave = sin(time * rate + k * 40.0) + sin(time * rate * 1.618 + k * 91.0);
    float v = floor(clamp(0.5 + 0.25 * wave, 0.0, 1.0) * 3.999) / 3.0;
    float twinkle = hash(cell + 9.0) > 0.7 ? 1.0 : 0.0;
    level *= 1.0 - twinkle * 0.6 * (1.0 - v);
    colour = mix(colour, ink, level);
  }
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}`;

const GLOW_VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const GLOW_FRAGMENT = /* glsl */ `
uniform vec3 tint;
uniform float strength;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(tint * strength * a * a, 1.0);
  #include <colorspace_fragment>
}`;

export interface Stage { x: number; y: number; w: number; h: number }

/** A ring on a point of contact, with a soft glow under it, always facing the camera. */
export class Contact {
  readonly group = new THREE.Group();
  private readonly ring: LineSegments2;
  private readonly material: LineMaterial;
  private readonly glow: THREE.ShaderMaterial;
  private readonly world: World;

  constructor(world: World, parent: THREE.Object3D) {
    this.world = world;
    const points: number[] = [];
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
      points.push(Math.cos(a), Math.sin(a), 0, Math.cos(b), Math.sin(b), 0);
    }
    const g = new LineSegmentsGeometry();
    g.setPositions(points);
    this.material = world.line(1.5, 1);
    this.material.transparent = true;
    this.material.depthTest = false;
    this.ring = new LineSegments2(g, this.material);
    this.ring.renderOrder = 20;
    this.glow = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERTEX, fragmentShader: GLOW_FRAGMENT,
      uniforms: { tint: { value: world.ink.clone() }, strength: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.glow);
    glow.renderOrder = 19;
    glow.scale.setScalar(2.6);
    this.group.add(glow, this.ring);
    parent.add(this.group);
  }

  /** Show it at a point, by `amount` (0 to 1); `pulse` (0 to 1) swells the ring a little as contact is made. */
  show(at: THREE.Vector3, radius: number, amount: number, pulse = 0) {
    this.group.visible = amount > 0.01;
    if (!this.group.visible) return;
    this.group.position.copy(at);
    this.group.quaternion.copy(this.world.camera.quaternion);
    this.group.scale.setScalar(radius * (1 + 0.35 * pulse));
    this.material.opacity = amount * (0.85 - 0.45 * pulse);
    (this.glow.uniforms.strength as { value: number }).value = amount * (0.16 + 0.12 * pulse);
  }
}

/** A thin arrow: a shaft and a chevron, drawn in the plane facing the camera. */
export class Arrow {
  private readonly shaft: LineSegments2;
  private readonly head: LineSegments2;
  private readonly material: LineMaterial;
  private readonly world: World;
  private readonly basis = new THREE.Matrix4();
  private readonly ax = new THREE.Vector3();
  private readonly ay = new THREE.Vector3();
  private readonly az = new THREE.Vector3();

  constructor(world: World, parent: THREE.Object3D, width = 1.5) {
    this.world = world;
    this.material = world.line(width, 1);
    this.material.transparent = true;
    this.material.depthTest = false;
    const s = new LineSegmentsGeometry();
    s.setPositions([0, 0, 0, 1, 0, 0]);
    this.shaft = new LineSegments2(s, this.material);
    const h = new LineSegmentsGeometry();
    h.setPositions([0, 0, 0, -1, 0.6, 0, 0, 0, 0, -1, -0.6, 0]);
    this.head = new LineSegments2(h, this.material);
    for (const o of [this.shaft, this.head]) { o.renderOrder = 21; o.frustumCulled = false; parent.add(o); }
  }

  /** From a to b, its head `head` metres long, by `amount` (0 to 1). */
  show(a: THREE.Vector3, b: THREE.Vector3, head: number, amount: number) {
    const on = amount > 0.01;
    this.shaft.visible = this.head.visible = on;
    if (!on) return;
    const { ax, ay, az } = this;
    ax.subVectors(b, a);
    const length = ax.length();
    ax.normalize();
    az.subVectors(this.world.camera.position, a);
    az.addScaledVector(ax, -az.dot(ax)).normalize();
    ay.crossVectors(az, ax);
    this.basis.makeBasis(ax, ay, az);
    this.shaft.quaternion.setFromRotationMatrix(this.basis);
    this.head.quaternion.copy(this.shaft.quaternion);
    this.shaft.position.copy(a);
    this.shaft.scale.set(length, 1, 1);
    this.head.position.copy(b);
    this.head.scale.setScalar(head);
    this.material.opacity = amount;
  }
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 400);
  readonly ink = cssColour('--scene-line', '#f2f3f5');
  readonly bg = cssColour('--bg', '#0b0c0e');
  readonly fog: THREE.Fog;
  readonly lines: LineMaterial[] = [];
  readonly ship: Ship;
  readonly shipRoot: THREE.Group;
  readonly places: RoomPlace[];
  private readonly sky: THREE.ShaderMaterial;
  readonly size = new THREE.Vector2(1, 1);
  stage: Stage = { x: 0, y: 0, w: 1, h: 1 };
  private readonly target = new THREE.Vector3();

  /** `transparent`: no sky and a clear canvas, for a host screen that draws its own backdrop. */
  constructor(canvas: HTMLCanvasElement, ratio: number, options: { transparent?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: options.transparent === true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(ratio);
    this.renderer.setClearColor(this.bg, options.transparent ? 0 : 1);
    this.fog = new THREE.Fog(this.bg, 10, 40);
    this.scene.fog = this.fog;

    this.sky = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT,
      uniforms: {
        size: { value: new THREE.Vector2(1, 1) }, block: { value: 2 }, time: { value: 0 },
        base: { value: this.bg.clone() }, lift: { value: cssColour('--scene-sky', '#132138') }, ink: { value: this.ink.clone() },
        centre: { value: new THREE.Vector2() },
      },
      depthWrite: false, depthTest: false, fog: false,
    });
    const sky = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)), this.sky);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    sky.visible = options.transparent !== true;
    this.scene.add(sky);

    // The ship, drawn as on the hub (no crew of its own: the steps bring theirs).
    const layout = layoutOf(MISSION);
    this.places = layout.places;
    this.ship = buildShip(this.scene, MISSION, layout.modules, layout.places, [], this.ink, this.bg);
    this.shipRoot = this.ship.root;
    this.ship.stars.visible = false;
    this.lines.push(...this.ship.lines);
    const ok = cssColour('--status-ok', '#5b9dff');
    for (const room of this.ship.rooms.values()) {
      (room.wall.uniforms.tint.value as THREE.Color).copy(ok);
      room.wall.uniforms.strength.value = 0.02;
    }
  }

  /** A fat-line material in the ink, at `strength` (0 to 1 of the ink), resized with the view. */
  line(width: number, strength: number): LineMaterial {
    const m = new LineMaterial({ color: this.bg.clone().lerp(this.ink, strength).getHex(), linewidth: width });
    m.fog = true;
    m.resolution.copy(this.size);
    this.lines.push(m);
    return m;
  }

  /** How strong the ship's lines are: structure, room edges and furniture (0 to 1 of the ink). */
  toneShip(structure: number, frame: number, detail: number) {
    const tone = (m: LineMaterial, k: number) => m.color.copy(this.bg).lerp(this.ink, k);
    tone(this.ship.structure, structure);
    if (this.ship.quiet !== this.ship.structure) tone(this.ship.quiet, structure * 0.6);
    for (const side of this.ship.sides) for (const o of [side.back, side.front]) tone(o.material as LineMaterial, structure);
    for (const room of this.ship.rooms.values()) {
      tone(room.frame, frame);
      tone(room.detail, detail);
      for (const o of [room.frontEdge, room.backEdge, room.back, room.front]) tone(o.material as LineMaterial, o === room.back || o === room.front ? detail : frame);
    }
  }

  resize(w: number, h: number) {
    this.size.set(w, h);
    this.renderer.setSize(w, h, false);
    for (const m of this.lines) m.resolution.set(w, h);
    const r = this.renderer.getPixelRatio();
    (this.sky.uniforms.size.value as THREE.Vector2).set(w * r, h * r);
    this.sky.uniforms.block.value = Math.max(1, Math.round(2 * r));
  }

  /**
   * Point the camera at `target` from `yaw` (round from +z, radians) and `pitch` (up), far enough that
   * `extent` metres of height fill `fill` of the stage, and shift the view so the target sits in the
   * stage's middle (plus `lift` of the stage's height up).
   */
  frame(target: THREE.Vector3, yaw: number, pitch: number, extent: number, fov = 30, lift = 0, span = extent * 1.7) {
    const { camera, size, stage } = this;
    camera.fov = fov;
    camera.aspect = size.x / size.y;
    const k = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    // Fit `extent` metres of height and `span` of width into the stage, whatever its shape.
    const fit = Math.max(extent, span * (stage.h / stage.w));
    const distance = (fit / 2 / k) * (size.y / stage.h);
    this.target.copy(target);
    camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(distance).add(target);
    camera.lookAt(target);
    const cx = stage.x + stage.w / 2;
    const cy = stage.y + stage.h / 2 - lift * stage.h;
    camera.setViewOffset(size.x, size.y, size.x / 2 - cx, size.y / 2 - cy, size.x, size.y);
    camera.updateProjectionMatrix();
    const r = this.renderer.getPixelRatio();
    (this.sky.uniforms.centre.value as THREE.Vector2).set(cx * r, (size.y - cy) * r);
  }

  /**
   * A room of the ship, in the world: the middle of its length, its floor (the hull's bottom face,
   * or the deck for an upper cabin) and its ceiling. Moves are placed by it.
   */
  room(id: string): { x: number; floor: number; ceiling: number; x0: number; x1: number } {
    const p = this.places.find((q) => q.id === id);
    if (!p) throw new Error(`No room ${id}`);
    const o = new THREE.Vector3().setFromMatrixPosition(p.frame.matrix);
    const s = p.frame.scale;
    const r = Math.max(p.r0, p.r1) * s;
    const floor = p.band === 'upper' ? 0.015 * s : -COS * r;
    const ceiling = p.band === 'lower' ? 0 : COS * r;
    void R;
    return { x: o.x + ((p.x0 + p.x1) / 2) * s, floor: o.y + floor, ceiling: o.y + ceiling, x0: o.x + p.x0 * s, x1: o.x + p.x1 * s };
  }

  /** Show only one room's walls (the others step aside, as on the hub when a person is in focus); null shows all. */
  focus(id: string | null) {
    for (const [key, room] of this.ship.rooms) room.wall.uniforms.fade.value = id === null || key === id ? 1 : 0;
  }

  /** Fog from the target outwards: lines further than `near` past it fade by `far`. */
  depth(near: number, far: number) {
    const d = this.camera.position.distanceTo(this.target);
    this.fog.near = d + near;
    this.fog.far = d + far;
  }

  /** Where a world point lands on the screen, in CSS pixels (z > 1 when behind the camera). */
  project(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.copy(p).project(this.camera);
    out.x = (out.x * 0.5 + 0.5) * this.size.x;
    out.y = (-out.y * 0.5 + 0.5) * this.size.y;
    return out;
  }

  render(time: number) {
    this.sky.uniforms.time.value = time;
    this.renderer.render(this.scene, this.camera);
  }
}

/** A polyline as fat lines, every segment or every other one (dashed). */
export function polyline(world: World, points: THREE.Vector3[], material: LineMaterial, dashed = false): LineSegments2 {
  const p: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    if (dashed && i % 2 === 1) continue;
    const a = points[i], b = points[i + 1];
    p.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const g = new LineSegmentsGeometry();
  g.setPositions(p);
  const line = new LineSegments2(g, material);
  line.frustumCulled = false;
  void world;
  return line;
}
