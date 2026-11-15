// The declared events that are not weather, drawn into the station view as an
// illustration of what a crewmate declared (core/events.ts), never a reading:
// the words in the alerts panel always say it too. None names a room (only
// where to shelter), so each is base-wide, and the shelter room stays clear.
//
//   fire              smoke, not flames: soft grey smoke pooling under the
//                     rooms' ceilings and rolling slowly, thinner at mid
//                     height, with a muted ember glow breathing low.
//   pressure_loss     air leaving: pale wisps drawn out of the rooms and away
//                     from the structure (up and out on a surface), quick and
//                     gone within a few metres. Station.tsx adds a pale bloom
//                     on the room outlines (`frost`).
//   quake             the ground moves: a slow, small sway of the whole place
//                     (`sway`, applied by Station.tsx) in irregular tremors with
//                     decaying aftershocks, and dust lifting off the ground and
//                     settling. Surface bases only; nothing while expected.
//   meteoroid_impact  a bright point falls some way off, flashes, a thin ring
//                     runs out along the ground and a plume of dust rises and
//                     settles (on a ship or station, a small grey burst off the
//                     far side). While it lasts, the plume lingers and a small
//                     strike comes again every 20 to 40 s.
//
// One draw call each, moved in the shaders from a few uniforms; nothing is
// allocated per frame. Fades follow weather.ts. With reduced motion each is a
// faint, still version: smoke and glow held, a still mist, settled dust, the
// lingering plume; nothing sways or strikes.

import * as THREE from 'three';
import { FADE_PER_S, NOISE, dustOf, seeds } from './weather.ts';
import type { Weather } from './weather.ts';

export interface RoomBox { id: string; box: THREE.Box3 }

export interface Hazards {
  update: (dt: number, calm: boolean, weather: Weather | undefined) => boolean;
  /** How far the room outlines bloom pale now (pressure loss), 0 to 1. */
  readonly frost: number;
  /** Where the place is moved to by a quake now (add to the root's position). */
  readonly sway: THREE.Vector3;
  dispose: () => void;
}

const MAX_ROOMS = 16;

// ---- Fire --------------------------------------------------------------------------------------

const SMOKE_VERTEX = /* glsl */ `
attribute vec3 info; // room index, level (0 under the ceiling, 1 mid height), kind (0 smoke, 1 glow)
varying vec2 vAt;
varying vec3 vInfo;
varying vec3 vPos;
void main() {
  vAt = uv;
  vInfo = info;
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SMOKE_FRAGMENT = /* glsl */ `
uniform float clock;
uniform float strength;
uniform float glow;
uniform float clear[${MAX_ROOMS}];
uniform vec3 smoke;
uniform vec3 ember;
varying vec2 vAt;
varying vec3 vInfo;
varying vec3 vPos;
${NOISE}
void main() {
  if (vInfo.z > 0.5) {
    float r = length(vAt - 0.5) * 2.0;
    float a = glow * smoothstep(1.0, 0.0, r) * (0.55 + 0.45 * fbm(vAt * 3.0 + vec2(clock * 0.04, -clock * 0.03)));
    gl_FragColor = vec4(ember, a * 0.3);
  } else {
    float keep = 1.0 - clear[int(vInfo.x + 0.5)];
    float edges = smoothstep(0.0, 0.22, vAt.x) * smoothstep(1.0, 0.78, vAt.x) * smoothstep(0.0, 0.22, vAt.y) * smoothstep(1.0, 0.78, vAt.y);
    vec2 p = vPos.xz * 0.32 + vec2(vInfo.y * 13.0 + vInfo.x * 3.1, 0.0);
    vec2 warp = vec2(fbm(p * 0.7 + vec2(clock * 0.05, 0.0)), fbm(p * 0.7 + vec2(5.2, -clock * 0.04)));
    float body = fbm(p + 1.7 * warp);
    float a = strength * keep * edges * smoothstep(0.3, 0.75, body) * mix(0.75, 0.4, vInfo.y);
    gl_FragColor = vec4(smoke, a);
  }
  #include <colorspace_fragment>
}`;

// ---- Pressure loss ----------------------------------------------------------------------------

const WISP_VERTEX = /* glsl */ `
uniform float clock;
uniform float strength;
uniform float rooms;
uniform float surface;
uniform float pixel;
uniform vec2 resolution;
uniform vec3 centre;
uniform vec3 low[${MAX_ROOMS}];
uniform vec3 high[${MAX_ROOMS}];
uniform float clear[${MAX_ROOMS}];
attribute vec2 corner;
attribute vec4 seed;
varying float vAlpha;
varying vec2 vAt;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  float life = 0.9 + seed.w * 0.8;
  float cycle = clock / life + seed.x;
  float t = fract(cycle);
  vec2 k = vec2(seed.y * 41.3, floor(cycle) * 0.37);
  int i = int(min(floor(hash(k) * rooms), rooms - 1.0));
  vec3 from = mix(low[i], high[i], vec3(hash(k + 1.3), 0.35 + 0.6 * hash(k + 2.7), hash(k + 4.1)));
  // Out from the middle of the structure; on the ground, out and up into the sky.
  vec3 out3 = from - centre;
  if (surface > 0.5) out3.y = abs(out3.y) + length(out3.xz) * 0.7 + 0.5;
  vec3 dir = normalize(out3 + vec3(0.0001));
  // Fast at first, then spent within a few metres.
  float reach = (1.0 - exp(-3.2 * t)) * (2.5 + 3.5 * hash(k + 5.9));
  vec3 head = from + dir * reach;
  vec3 tail = from + dir * reach * 0.45;
  vec4 ch = projectionMatrix * modelViewMatrix * vec4(head, 1.0);
  vec4 ct = projectionMatrix * modelViewMatrix * vec4(tail, 1.0);
  vec2 d = (ch.xy / ch.w - ct.xy / ct.w) * resolution;
  d = length(d) > 1e-4 ? normalize(d) : vec2(1.0, 0.0);
  vec4 p = mix(ct, ch, corner.x);
  // Wide and soft, widening as it thins: a wisp, never a line.
  float w = (8.0 + 30.0 * t) * pixel;
  p.xy += vec2(-d.y, d.x) * corner.y * w / resolution * p.w;
  gl_Position = p;
  vAt = corner;
  vAlpha = strength * (1.0 - clear[i]) * pow(1.0 - t, 2.0) * smoothstep(0.0, 0.08, t) * step(0.0, ch.w) * step(0.0, ct.w);
}`;

const WISP_FRAGMENT = /* glsl */ `
uniform vec3 mist;
varying float vAlpha;
varying vec2 vAt;
void main() {
  float across = exp(-vAt.y * vAt.y * 3.0);
  float along = sin(3.14159 * vAt.x);
  gl_FragColor = vec4(mist, vAlpha * across * along * 0.32);
  #include <colorspace_fragment>
}`;

// ---- Quake dust ---------------------------------------------------------------------------------

const LIFT_VERTEX = /* glsl */ `
uniform float lift;
uniform float strength;
uniform float size;
uniform float reach;
uniform vec3 centre;
attribute vec4 seed;
varying float vAlpha;
void main() {
  float turn = seed.x * 6.2832;
  float r = reach * (0.25 + 0.75 * sqrt(seed.y));
  float h = lift * (0.2 + 1.4 * pow(seed.z, 2.0)) + 0.03;
  vec3 at = centre + vec3(cos(turn) * r, h, sin(turn) * r);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
  gl_PointSize = size * (0.8 + 0.8 * seed.w);
  vAlpha = strength * (0.15 + 0.85 * lift) * (0.4 + 0.6 * seed.w);
}`;

const LIFT_FRAGMENT = /* glsl */ `
uniform vec3 tint;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  gl_FragColor = vec4(tint, vAlpha * smoothstep(0.5, 0.1, length(c)));
  #include <colorspace_fragment>
}`;

// ---- Meteoroid impact ---------------------------------------------------------------------------

const IMPACT_VERTEX = /* glsl */ `
uniform vec3 strike;
uniform vec3 plumeAt;
uniform float age;
uniform float fall;
uniform float ringSize;
uniform float plumeW;
uniform float plumeH;
attribute vec2 corner;
attribute float kind; // 0 the falling point and flash, 1 the ring, 2 the plume
varying vec2 vAt;
varying float vKind;
void main() {
  vAt = corner;
  vKind = kind;
  if (kind > 0.5 && kind < 1.5) {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(strike + vec3(corner.x * ringSize, 0.05, corner.y * ringSize), 1.0);
    return;
  }
  vec3 anchor = kind < 0.5 ? strike + vec3(0.0, fall, 0.0) : plumeAt;
  vec4 view = modelViewMatrix * vec4(anchor, 1.0);
  view.xy += kind < 0.5 ? corner * 1.6 : vec2(corner.x * plumeW, (corner.y + 1.0) * plumeH);
  gl_Position = projectionMatrix * view;
}`;

const IMPACT_FRAGMENT = /* glsl */ `
uniform float clock;
uniform float flash;
uniform float ring;
uniform float ringRadius;
uniform float plume;
uniform vec3 ink;
uniform vec3 dust;
varying vec2 vAt;
varying float vKind;
${NOISE}
void main() {
  if (vKind < 0.5) {
    float d = length(vAt);
    gl_FragColor = vec4(ink, flash * (exp(-d * d * 40.0) + 0.35 * exp(-d * d * 5.0)));
  } else if (vKind < 1.5) {
    float r = length(vAt);
    gl_FragColor = vec4(ink, ring * exp(-pow((r - ringRadius) / 0.008, 2.0)) * smoothstep(1.0, 0.7, r));
  } else {
    // Billowing, heavier at its foot, rising slowly.
    vec2 p = vec2(vAt.x * 1.4, vAt.y * 1.6 - clock * 0.05);
    float body = fbm(p * 1.8 + fbm(p + clock * 0.03));
    float shape = smoothstep(1.0, 0.25, length(vAt)) * mix(1.0, 0.6, smoothstep(-0.2, 1.0, vAt.y));
    gl_FragColor = vec4(dust, plume * shape * smoothstep(0.3, 0.75, body) * 0.75);
  }
  #include <colorspace_fragment>
}`;

function material(uniforms: Record<string, THREE.IUniform>, vertexShader: string, fragmentShader: string, depthTest = false) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest, side: THREE.DoubleSide });
}

export function createHazards(
  root: THREE.Object3D, renderer: THREE.WebGLRenderer, outline: THREE.Vector3[], rooms: RoomBox[],
  viewYaw: number, surface: boolean, ink: THREE.Color, bg: THREE.Color, body: string | null,
): Hazards {
  const place = new THREE.Box3().setFromPoints(outline);
  const centre = place.getCenter(new THREE.Vector3());
  const size = place.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z, 1) / 2;
  // The ground a surface base stands on is at 0 (ground.ts); the outline reaches below it.
  const floor = surface ? 0 : place.min.y;
  const pixelRatio = renderer.getPixelRatio();
  const list = rooms.slice(0, MAX_ROOMS);
  const clear = new Array<number>(MAX_ROOMS).fill(0);
  const soil = dustOf(body).getHSL({ h: 0, s: 0, l: 0 });
  const dustTone = new THREE.Color().setHSL(soil.h, Math.min(soil.s * 1.6, 0.38), 0.42);

  // Fire: two sheets in each room (under the ceiling, at mid height) and one glow on the floor of the place.
  const positions: number[] = [], uvs: number[] = [], info: number[] = [], index: number[] = [];
  const quad = (y: number, x0: number, z0: number, x1: number, z1: number, i: number, level: number, kind: number) => {
    const o = positions.length / 3;
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      positions.push(a ? x1 : x0, y, b ? z1 : z0);
      uvs.push(a, b);
      info.push(i, level, kind);
    }
    index.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  list.forEach(({ box }, i) => {
    const h = box.max.y - box.min.y;
    quad(box.max.y - h * 0.12, box.min.x, box.min.z, box.max.x, box.max.z, i, 0, 0);
    quad(box.min.y + h * 0.55, box.min.x, box.min.z, box.max.x, box.max.z, i, 1, 0);
  });
  quad(floor + 0.05, centre.x - radius * 1.4, centre.z - radius * 1.4, centre.x + radius * 1.4, centre.z + radius * 1.4, 0, 0, 1);
  const smokeGeometry = new THREE.BufferGeometry();
  smokeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  smokeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  smokeGeometry.setAttribute('info', new THREE.Float32BufferAttribute(info, 3));
  smokeGeometry.setIndex(index);
  const smokeMaterial = material({
    clock: { value: 0 }, strength: { value: 0 }, glow: { value: 0 }, clear: { value: clear },
    smoke: { value: bg.clone().lerp(ink, 0.42) },
    // A muted ember: a danger state's colour, held low and dark.
    ember: { value: new THREE.Color('#7a3d22') },
  }, SMOKE_VERTEX, SMOKE_FRAGMENT);
  const smoke = new THREE.Mesh(smokeGeometry, smokeMaterial);
  // After the rooms' dark walls (build.ts draws them at 10), or the smoke inside would be hidden by them.
  smoke.renderOrder = 12;

  // Pressure loss: soft quads streaming out of the rooms.
  const WISPS = 200;
  const wispGeometry = new THREE.InstancedBufferGeometry();
  wispGeometry.setAttribute('corner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
  wispGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  wispGeometry.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds(WISPS, 23), 4));
  wispGeometry.instanceCount = WISPS;
  const low = Array.from({ length: MAX_ROOMS }, (_, i) => (list[i]?.box.min ?? centre).clone());
  const high = Array.from({ length: MAX_ROOMS }, (_, i) => (list[i]?.box.max ?? centre).clone());
  const wispMaterial = material({
    clock: { value: 0 }, strength: { value: 0 }, rooms: { value: Math.max(1, list.length) }, surface: { value: surface ? 1 : 0 },
    pixel: { value: pixelRatio }, resolution: { value: new THREE.Vector2(1, 1) }, centre: { value: centre.clone() },
    low: { value: low }, high: { value: high }, clear: { value: clear },
    mist: { value: new THREE.Color(0.86, 0.92, 1).multiply(ink) },
  }, WISP_VERTEX, WISP_FRAGMENT);
  const wisps = new THREE.Mesh(wispGeometry, wispMaterial);
  wisps.renderOrder = 4;

  // Quake: dust on the ground round the base.
  const LIFT = 1400;
  const liftGeometry = new THREE.BufferGeometry();
  liftGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(LIFT * 3), 3));
  liftGeometry.setAttribute('seed', new THREE.Float32BufferAttribute(seeds(LIFT, 31), 4));
  const liftMaterial = material({
    lift: { value: 0 }, strength: { value: 0 }, size: { value: 3 * pixelRatio }, reach: { value: radius * 1.7 },
    centre: { value: new THREE.Vector3(centre.x, floor, centre.z) }, tint: { value: dustTone },
  }, LIFT_VERTEX, LIFT_FRAGMENT, true);
  const dustLift = new THREE.Points(liftGeometry, liftMaterial);
  dustLift.renderOrder = 3;

  // Meteoroid impact: a point and flash, a ring on the ground, a plume.
  const impactGeometry = new THREE.BufferGeometry();
  const corners: number[] = [], kinds: number[] = [], impactIndex: number[] = [];
  for (let k = 0; k < 3; k++) {
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { corners.push(a, b); kinds.push(k); }
    impactIndex.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
  }
  impactGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12 * 3), 3));
  impactGeometry.setAttribute('corner', new THREE.Float32BufferAttribute(corners, 2));
  impactGeometry.setAttribute('kind', new THREE.Float32BufferAttribute(kinds, 1));
  impactGeometry.setIndex(impactIndex);
  // Some way off behind the base, on the far side of the view; off the far side of the hull in space.
  const away = new THREE.Vector3(-Math.sin(viewYaw) - 0.5 * Math.cos(viewYaw), 0, -Math.cos(viewYaw) + 0.5 * Math.sin(viewYaw)).normalize();
  const plumeAt = surface
    ? new THREE.Vector3(centre.x, floor, centre.z).addScaledVector(away, radius * 1.5)
    : centre.clone().addScaledVector(away, radius * 1.15);
  const impactMaterial = material({
    strike: { value: plumeAt.clone() }, plumeAt: { value: plumeAt }, age: { value: 0 }, fall: { value: 0 },
    ringSize: { value: radius * 1.0 }, plumeW: { value: radius * 0.4 }, plumeH: { value: radius * 0.35 },
    clock: { value: 0 }, flash: { value: 0 }, ring: { value: 0 }, ringRadius: { value: 0 }, plume: { value: 0 },
    ink: { value: ink.clone() }, dust: { value: surface ? dustTone : bg.clone().lerp(ink, 0.45) },
  }, IMPACT_VERTEX, IMPACT_FRAGMENT, surface);
  const impact = new THREE.Mesh(impactGeometry, impactMaterial);
  impact.renderOrder = 5;

  const meshes = [smoke, wisps, dustLift, impact];
  for (const mesh of meshes) {
    mesh.frustumCulled = false;
    mesh.visible = false;
    root.add(mesh);
  }

  const drawing = new THREE.Vector2();
  const sway = new THREE.Vector3();
  const fire = { shown: 0, clock: 0 };
  const leak = { shown: 0, clock: 0, frost: 0 };
  const quake = { shown: 0, age: 99, next: 1.2, lift: 0, n: 0 };
  const hit = { shown: 0, age: 99, next: 0, settled: 0, n: 0, clock: 0 };
  const ease = (from: number, to: number, dt: number, calm: boolean) =>
    calm ? to : to > from ? Math.min(to, from + dt * FADE_PER_S) : Math.max(to, from - dt * FADE_PER_S);
  /** A steady, seeded sequence of irregular numbers in 0..1. */
  const irregular = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  return {
    get frost() { return leak.frost; },
    sway,
    update(dt, calm, weather) {
      let busy = false;
      const shelter = weather?.shelter ?? null;
      for (let i = 0; i < MAX_ROOMS; i++) clear[i] = list[i]?.id === shelter ? 1 : 0;

      // Fire.
      const fireGoal = weather?.fire ? (calm ? 0.6 : 1) * (weather.fire === 'warning' ? 0.35 : 1) : 0;
      fire.shown = ease(fire.shown, fireGoal, dt, calm);
      smoke.visible = fire.shown > 0.001;
      if (smoke.visible) {
        if (!calm) { fire.clock = (fire.clock + dt) % 2000; busy = true; }
        const u = smokeMaterial.uniforms;
        u.clock.value = fire.clock;
        u.strength.value = fire.shown;
        // Breathing slowly and unevenly, never a flicker.
        u.glow.value = fire.shown * (calm ? 0.7 : 0.62 + 0.24 * Math.sin(fire.clock * 0.7) + 0.14 * Math.sin(fire.clock * 1.83 + 1.1));
      }

      // Pressure loss.
      const leakGoal = weather?.pressure_loss ? (calm ? 0.45 : 1) * (weather.pressure_loss === 'warning' ? 0.35 : 1) : 0;
      leak.shown = ease(leak.shown, leakGoal, dt, calm);
      wisps.visible = leak.shown > 0.001;
      if (wisps.visible) {
        if (!calm) { leak.clock = (leak.clock + dt) % 3600; busy = true; }
        renderer.getDrawingBufferSize(drawing);
        wispMaterial.uniforms.resolution.value.copy(drawing);
        wispMaterial.uniforms.clock.value = leak.clock;
        wispMaterial.uniforms.strength.value = leak.shown;
      }
      leak.frost = leak.shown * (calm ? 0.35 : 0.3 + 0.2 * Math.sin(leak.clock * 1.1));

      // Quake (surface only; nothing while one is merely expected).
      const shaking = surface && weather?.quake === 'event';
      quake.shown = ease(quake.shown, shaking ? 1 : 0, dt, calm);
      dustLift.visible = quake.shown > 0.001;
      sway.set(0, 0, 0);
      if (dustLift.visible) {
        let env = 0;
        if (!calm) {
          quake.age += dt;
          if (shaking && quake.age > quake.next) {
            quake.age = 0;
            quake.next = 6 + 6 * irregular(++quake.n);
          }
          const a = quake.age;
          // A main tremor and two weaker aftershocks, each dying away.
          env = Math.exp(-a * 0.9) + 0.45 * (a > 2.6 ? Math.exp(-(a - 2.6) * 1.4) : 0) + 0.25 * (a > 4.4 ? Math.exp(-(a - 4.4) * 1.8) : 0);
          env *= quake.shown;
          const t = a * Math.PI * 2;
          sway.set(Math.sin(t * 1.3) + 0.4 * Math.sin(t * 2.1 + 1), 0.35 * Math.sin(t * 0.9 + 2), Math.sin(t * 1.1 + 0.6)).multiplyScalar(0.07 * env);
          // The dust leaps up with the shaking and settles far more slowly.
          quake.lift += (Math.min(1, env * 1.4) - quake.lift) * (1 - Math.exp(-dt * (env * 1.4 > quake.lift ? 5 : 0.3)));
          busy = true;
        } else quake.lift = 0.3;
        liftMaterial.uniforms.lift.value = quake.lift;
        liftMaterial.uniforms.strength.value = quake.shown * 0.85;
      } else { quake.age = 99; quake.next = 1.2; quake.lift = 0; }

      // Meteoroid impact.
      const striking = weather?.meteoroid_impact === 'event';
      hit.shown = ease(hit.shown, striking ? 1 : 0, dt, calm);
      impact.visible = hit.shown > 0.001;
      const u = impactMaterial.uniforms;
      if (impact.visible) {
        let flash = 0, ring = 0;
        if (calm) {
          hit.settled = 1;
        } else {
          hit.clock = (hit.clock + dt) % 2000;
          hit.age += dt;
          if (striking && hit.age > hit.next) {
            hit.age = 0;
            hit.n += 1;
            hit.next = 20 + 20 * irregular(hit.n);
            // A repeat strikes a little to one side of the first.
            const turn = irregular(hit.n + 50) * Math.PI * 2;
            u.strike.value.copy(plumeAt);
            if (hit.n > 1) u.strike.value.x += Math.cos(turn) * radius * 0.5, u.strike.value.z += Math.sin(turn) * radius * 0.5;
          }
          const a = hit.age;
          const scale = hit.n > 1 ? 0.6 : 1;
          // Falling for a third of a second, a flash, then the ring runs out over three seconds.
          u.fall.value = Math.max(0, 1 - a / 0.35) * radius * 2.2;
          flash = a < 0.35 ? 0.8 : Math.exp(-(a - 0.35) * 5) * 1.4;
          const r = Math.max(0, a - 0.35);
          u.ringRadius.value = (1 - Math.exp(-r * 1.1)) * 0.9 * scale;
          ring = surface && a > 0.35 ? Math.max(0, 1 - r / 3.2) * 0.8 : 0;
          if (a > 0.6) hit.settled = Math.min(1, hit.settled + dt / 6);
          flash *= scale;
          busy = true;
        }
        const rise = calm ? 1 : Math.max(hit.settled, 1 - Math.exp(-Math.max(0, hit.age - 0.35) * 0.9));
        u.plumeW.value = radius * (0.25 + 0.2 * rise);
        u.plumeH.value = radius * 0.4 * rise;
        // The plume rises full and settles to a lingering haze.
        const fresh = calm ? 0 : Math.max(0, Math.min(1, (hit.age - 0.35) * 2)) * Math.exp(-Math.max(0, hit.age - 3) * 0.25) * (hit.n > 1 ? 0.5 : 1);
        u.plume.value = hit.shown * Math.max(0.4 * hit.settled, fresh);
        u.flash.value = hit.shown * flash;
        u.ring.value = hit.shown * ring;
        u.age.value = hit.age;
        u.clock.value = hit.clock;
      } else { hit.age = 99; hit.next = 0; hit.settled = 0; hit.n = 0; }

      if ((fire.shown !== fireGoal) || (leak.shown !== leakGoal)) busy = true;
      return busy;
    },
    dispose() {
      for (const mesh of meshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    },
  };
}
