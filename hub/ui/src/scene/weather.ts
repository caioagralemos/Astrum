// The weather of a declared base-wide event, drawn into the station view: an
// illustration of what a crewmate declared (core/events.ts), never a reading.
// The words in the alerts panel always say it too; this only sets the mood.
//
//   dust storm            a body of air the colour of the ground it rises from
//                         (Mars ochre, Moon grey), rolling across a surface base: a few
//                         large veils of noise, layered in depth so the far
//                         rooms and the horizon dim behind them while the near
//                         ones stay clear, and fine grain carried low in the
//                         gusts. The ground softens under it. While it is only
//                         expected: a front on the horizon, upwind, creeping
//                         closer over clear air. On a ship or a station: nothing.
//   solar particle event  radiation cannot be seen, so nothing falls: what it
//                         does to a camera. Sparse, sharp hits over the whole
//                         view (a dot of a pixel or three, now and then a short
//                         straight track), each gone within a few frames, at a
//                         rate that rises and falls slowly; and a faint wash
//                         from the sun's side. While expected: the wash only.
//
// Each effect is two draw calls (the dust in its ground's colour, the solar event in the ink), moved
// entirely in its shaders from a few uniforms: nothing is allocated per frame.
// They fade in and out over about 1.75 s. With reduced motion the dust holds
// still and the solar event keeps its faint wash, with no hits.

import * as THREE from 'three';

export type EventStage = 'warning' | 'event';
/** The declared events drawn in the view (here and in hazards.ts). Kept as plain ids, so a kind the hub adds later is simply not drawn until it is listed here. */
export const WEATHER_KINDS = ['dust_storm', 'solar_particle_event', 'fire', 'pressure_loss', 'quake', 'meteoroid_impact'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];
/** The declared events drawn in the view, how far along each is, and the shelter room the crew were told to go to (kept clear). */
export type Weather = Partial<Record<WeatherKind, EventStage>> & { shelter?: string | null };

export interface WeatherLayer {
  /** Advances the weather; true while anything is still showing or moving (keep drawing every frame). */
  update: (dt: number, calm: boolean, weather: Weather | undefined) => boolean;
  /** How much the dust storm is in the air now (0 to 1): the ground softens and far rooms fade into it. */
  readonly haze: number;
  readonly hazeColour: THREE.Color;
  dispose: () => void;
}

export const FADE_PER_S = 1 / 1.75;
/** The sun the ground is lit by (ground.ts), in the place's frame. */
const SUN = new THREE.Vector3(-0.35, 0.85, -0.4).normalize();

export const NOISE = /* glsl */ `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return v;
}`;

// ---- Dust: the veils ------------------------------------------------------------------------

const VEIL_VERTEX = /* glsl */ `
attribute float layer;
varying vec2 vAt;
varying float vLayer;
varying float vDepth;
void main() {
  vAt = uv;
  vLayer = layer;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;

const VEIL_FRAGMENT = /* glsl */ `
uniform float clock;
uniform float flow;
uniform float front;
uniform float far;
uniform float strength;
uniform float width;
uniform float reach;
uniform vec3 haze;
varying vec2 vAt;
varying float vLayer;
varying float vDepth;
${NOISE}
void main() {
  // In metres along the wind (x) and across it (y); each layer drifts at its own pace, the higher faster.
  vec2 m = (vAt - 0.5) * width;
  float pace = 0.6 + 0.8 * vLayer;
  vec2 p = vec2(m.x - flow * pace, m.y) * 0.06 + vec2(vLayer * 31.7, vLayer * 7.3);
  // Billows: the noise is pushed about by slower noise of its own, so it rolls rather than slides.
  vec2 warp = vec2(fbm(p * 0.5 + vec2(clock * 0.03, 0.0)), fbm(p * 0.5 + vec2(4.1, clock * 0.04)));
  float body = fbm(p + 1.8 * warp);
  // Round and soft at its edges, so no sheet ever shows a side.
  float shape = smoothstep(0.5, 0.2, length(vAt - 0.5));
  // Thin close to the viewer, thick towards the horizon: the near rooms stay clear, the far ones dim.
  shape *= mix(0.35, 1.0, smoothstep(reach * 0.7, reach * 1.8, vDepth));
  // While expected: a low wall of dust on the horizon behind the base, heavier upwind, its edge
  // billowing and creeping closer (front is its distance behind the middle, in metres).
  float edge = front + (body - 0.5) * width * 0.08;
  float wall = smoothstep(edge, edge + width * 0.05, -m.y) * mix(0.55, 1.0, smoothstep(width * 0.25, -width * 0.25, m.x));
  float ahead = mix(1.0, wall * 2.6, far);
  float sides = smoothstep(0.0, 0.18, vAt.x) * smoothstep(1.0, 0.82, vAt.x);
  // While it is still far off, only the far veils show.
  float distant = mix(1.0, smoothstep(0.45, 0.0, vLayer), far);
  // The lowest layers are the densest: the air is thickest at the ground.
  float depth = mix(0.55, 0.2, vLayer);
  float a = smoothstep(0.3, 0.75, body) * shape * ahead * sides * distant * depth * strength;
  gl_FragColor = vec4(haze, a);
  #include <colorspace_fragment>
}`;

// ---- Dust: the grain --------------------------------------------------------------------------

const GRAIN_VERTEX = /* glsl */ `
uniform float travel;
uniform float span;
uniform float across;
uniform float front;
uniform float gust;
uniform float strength;
uniform float size;
uniform vec3 centre;
uniform vec3 dir;
uniform vec3 side;
attribute vec4 seed;
varying float vAlpha;
void main() {
  // Four speeds, in quarters, so the travel uniform can wrap without a jump.
  float m = 0.75 + 0.25 * floor(seed.w * 3.999);
  float s = fract(seed.x + travel * m / span);
  float u = (s - 0.5) * span;
  // Densest in the bottom metre, a few lifted higher.
  float h = pow(seed.z, 3.0) * 3.0;
  vec3 at = centre + dir * u + side * ((seed.y - 0.5) * 2.0 * across) + vec3(0.0, h, 0.0);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
  gl_Position = clip;
  gl_PointSize = size * (0.8 + 0.7 * fract(seed.w * 7.3));
  // A gust front sweeps through now and then: the grain in it shows brighter.
  float band = exp(-pow((u - gust) / (span * 0.06), 2.0));
  float ends = smoothstep(0.0, 0.1, s) * smoothstep(1.0, 0.9, s);
  float ahead = step(u, front);
  vAlpha = strength * ends * ahead * (0.3 + 0.6 * band) * (0.5 + 0.5 * fract(seed.y * 13.1));
}`;

const GRAIN_FRAGMENT = /* glsl */ `
uniform vec3 ink;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(ink, vAlpha);
  #include <colorspace_fragment>
}`;

// ---- Solar: hits on the sensor, and the wash ------------------------------------------------

const HIT_VERTEX = /* glsl */ `
uniform float tick;
uniform float rate;
uniform float strength;
uniform float pixel;
uniform vec2 resolution;
attribute vec2 corner;
attribute vec4 seed;
varying float vAlpha;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  // Each hit lasts one to three frames, then the slot lands somewhere else, or nowhere.
  float life = 1.0 + floor(seed.x * 2.999);
  float epoch = floor((tick + seed.y * 5.0) / life);
  vec2 k = vec2(seed.z * 97.31, epoch * 0.731);
  float on = step(hash(k), rate);
  vec2 at = vec2(hash(k + 1.7), hash(k + 3.1)) * 2.0 - 1.0;
  float kind = hash(k + 5.3);
  // Most are a sharp dot of one to three pixels; a few are a short straight track at any angle.
  bool track = kind > 0.7;
  float w = track ? 1.0 : 1.5 + floor(hash(k + 7.9) * 2.0);
  float len = track ? 5.0 + hash(k + 9.4) * 14.0 : 0.0;
  float turn = hash(k + 11.2) * 6.2832;
  vec2 d = vec2(cos(turn), sin(turn));
  vec2 off = d * (corner.x - 0.5) * (len + w) + vec2(-d.y, d.x) * corner.y * 0.5 * w;
  gl_Position = vec4(at + off * pixel * 2.0 / resolution, 0.0, 1.0);
  vAlpha = strength * on * (0.55 + 0.45 * hash(k + 13.6)) * (track ? mix(0.35, 1.0, corner.x) : 1.0);
}`;

const HIT_FRAGMENT = /* glsl */ `
uniform vec3 ink;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(ink, vAlpha);
  #include <colorspace_fragment>
}`;

const WASH_VERTEX = /* glsl */ `
varying vec2 vAt;
void main() { vAt = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const WASH_FRAGMENT = /* glsl */ `
uniform vec2 sun;
uniform float pulse;
uniform float strength;
uniform vec3 ink;
varying vec2 vAt;
void main() {
  // Strongest on the sun's side of the view, with a broad soft band drifting across from it.
  float s = dot(vAt, sun);
  float side = smoothstep(-0.4, 1.4, s);
  float band = exp(-pow((s - pulse) / 0.55, 2.0));
  gl_FragColor = vec4(ink, strength * side * (0.6 + 0.4 * band));
  #include <colorspace_fragment>
}`;

/** The ground's colour for this body, from the same CSS variables as ground.ts. */
export function dustOf(body: string | null): THREE.Color {
  const [name, fallback] = body === 'moon' ? ['--scene-ground-moon', '#3c3c3e'] : ['--scene-ground-mars', '#32281f'];
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try { return new THREE.Color(value || fallback); } catch { return new THREE.Color(fallback); }
}

export function seeds(count: number, seed: number): Float32Array {
  // Seeded, so the same event draws the same way on every screen and every reload.
  let n = seed;
  return new Float32Array(count * 4).map(() => ((n = (n * 16807) % 2147483647) - 1) / 2147483646);
}

/**
 * `outline` is the place's points in the frame of `root` (layout.ts outlineOf), `viewYaw` the
 * default view's angle round (the wind crosses the screen), `surface` whether it stands on ground.
 */
export function createWeather(
  root: THREE.Object3D, renderer: THREE.WebGLRenderer, camera: THREE.Camera, outline: THREE.Vector3[],
  viewYaw: number, surface: boolean, ink: THREE.Color, bg: THREE.Color, body: string | null,
): WeatherLayer {
  const box = new THREE.Box3().setFromPoints(outline);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z, 1) / 2;
  const pixelRatio = renderer.getPixelRatio();
  const wind = new THREE.Vector3(Math.cos(viewYaw), 0, -Math.sin(viewYaw));
  const towardsViewer = new THREE.Vector3(Math.sin(viewYaw), 0, Math.cos(viewYaw));
  const ground = new THREE.Vector3(centre.x, box.min.y, centre.z);

  // The veils: five level sheets of air stacked over the ground, from the bottom metre up past the
  // roofs; seen from above, each drifting at its own pace gives the body of air its depth.
  const veilWidth = radius * 8;
  const heights = [0.2, 0.8, 1.7, 2.9, 4.4].map((h) => h * Math.max(1, size.y / 4));
  const positions: number[] = [], uvs: number[] = [], layers: number[] = [], index: number[] = [];
  const corner = new THREE.Vector3();
  heights.forEach((h, i) => {
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      corner.copy(ground).addScaledVector(wind, (a - 0.5) * veilWidth).addScaledVector(towardsViewer, (b - 0.5) * veilWidth);
      corner.y += h;
      positions.push(corner.x, corner.y, corner.z);
      uvs.push(a, b);
      layers.push(i / (heights.length - 1));
    }
    const o = i * 4;
    index.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  const veilGeometry = new THREE.BufferGeometry();
  veilGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  veilGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  veilGeometry.setAttribute('layer', new THREE.Float32BufferAttribute(layers, 1));
  veilGeometry.setIndex(index);
  // The dust is the ground it rises from (ground.ts reads the same colours from app.css), lifted
  // into the air: Mars a muted ochre, the Moon grey regolith. The haze stays dark, the grain lighter.
  const soil = dustOf(body);
  const hsl = soil.getHSL({ h: 0, s: 0, l: 0 });
  const haze = new THREE.Color().setHSL(hsl.h, Math.min(hsl.s * 1.6, 0.38), 0.27);
  const speck = new THREE.Color().setHSL(hsl.h, Math.min(hsl.s * 1.4, 0.3), 0.62);
  const veilMaterial = new THREE.ShaderMaterial({
    uniforms: {
      clock: { value: 0 }, flow: { value: 0 }, front: { value: 0 }, far: { value: 0 }, strength: { value: 0 },
      width: { value: veilWidth }, reach: { value: 1 }, haze: { value: haze },
    },
    vertexShader: VEIL_VERTEX, fragmentShader: VEIL_FRAGMENT,
    // Not cut by the ground: where far terrain rose through a veil it left a hard line. Drawn first
    // among the see-through things, so the rooms' lines and the people stay over it.
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
  });
  const veils = new THREE.Mesh(veilGeometry, veilMaterial);
  veils.renderOrder = -2;

  const GRAIN = 2200;
  const grainGeometry = new THREE.BufferGeometry();
  grainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(GRAIN * 3), 3));
  grainGeometry.setAttribute('seed', new THREE.Float32BufferAttribute(seeds(GRAIN, 7), 4));
  const grainMaterial = new THREE.ShaderMaterial({
    uniforms: {
      travel: { value: 0 }, span: { value: radius * 4 }, across: { value: radius * 1.6 }, front: { value: 0 }, gust: { value: 0 },
      strength: { value: 0 }, size: { value: 1.6 * pixelRatio }, centre: { value: ground.clone() },
      dir: { value: wind.clone() }, side: { value: towardsViewer.clone() }, ink: { value: speck },
    },
    vertexShader: GRAIN_VERTEX, fragmentShader: GRAIN_FRAGMENT,
    transparent: true, depthWrite: false,
  });
  const grain = new THREE.Points(grainGeometry, grainMaterial);
  grain.renderOrder = 3;

  // The hits: a quad per slot, placed on the screen by the shader. The wash: one sheet over the view.
  const HITS = 90;
  const hitGeometry = new THREE.InstancedBufferGeometry();
  hitGeometry.setAttribute('corner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
  hitGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  hitGeometry.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds(HITS, 11), 4));
  hitGeometry.instanceCount = HITS;
  const hitMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tick: { value: 0 }, rate: { value: 0 }, strength: { value: 0 }, pixel: { value: pixelRatio },
      resolution: { value: new THREE.Vector2(1, 1) }, ink: { value: ink.clone() },
    },
    vertexShader: HIT_VERTEX, fragmentShader: HIT_FRAGMENT,
    transparent: true, depthTest: false, depthWrite: false,
  });
  const hits = new THREE.Mesh(hitGeometry, hitMaterial);
  hits.renderOrder = 20;
  const washMaterial = new THREE.ShaderMaterial({
    uniforms: { sun: { value: new THREE.Vector2(0, 1) }, pulse: { value: 0 }, strength: { value: 0 }, ink: { value: ink.clone() } },
    vertexShader: WASH_VERTEX, fragmentShader: WASH_FRAGMENT,
    transparent: true, depthTest: false, depthWrite: false,
  });
  const wash = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), washMaterial);
  wash.renderOrder = 19;
  for (const mesh of [veils, grain, hits, wash]) {
    // Placed by their shaders, nowhere near their own bounds.
    mesh.frustumCulled = false;
    mesh.visible = false;
  }
  const dustParts = surface ? [veils, grain] : [];
  for (const mesh of [...dustParts, wash, hits]) root.add(mesh);

  const drawing = new THREE.Vector2();
  const sunAt = new THREE.Vector3();
  const middle = new THREE.Vector3();
  const dust = { shown: 0, approach: 0, far: 0, flow: 0, clock: 0 };
  const solar = { shown: 0, hits: 0, clock: 0 };
  const ease = (from: number, to: number, dt: number, calm: boolean) =>
    calm ? to : to > from ? Math.min(to, from + dt * FADE_PER_S) : Math.max(to, from - dt * FADE_PER_S);

  return {
    get haze() { return dust.shown * (1 - 0.7 * dust.far); },
    hazeColour: haze,
    update(dt, calm, weather) {
      let busy = false;

      // Dust.
      const storm = surface ? weather?.dust_storm : undefined;
      const dustGoal = storm ? 1 : 0;
      dust.shown = ease(dust.shown, dustGoal, dt, calm);
      veils.visible = grain.visible = dust.shown > 0.001;
      if (veils.visible) {
        const k = calm ? 1 : 1 - Math.exp(-dt * 0.8);
        if (storm) dust.far += ((storm === 'warning' ? 1 : 0) - dust.far) * k;
        if (!calm) {
          dust.clock = (dust.clock + dt) % 2000;
          // The wind rises and falls slowly, never stops; slower while the storm is still far off.
          const gust = 1 + 0.35 * Math.sin(dust.clock * 0.31) + 0.15 * Math.sin(dust.clock * 0.97 + 1.7);
          dust.flow = (dust.flow + dt * radius * 0.22 * gust * (1 - 0.6 * dust.far)) % 4000;
          grainMaterial.uniforms.travel.value = (grainMaterial.uniforms.travel.value + dt * radius * 0.5 * gust) % (radius * 16);
          busy = true;
        }
        // While expected, the front stands on the horizon upwind and creeps in; once here it has passed over.
        dust.approach = Math.min(1, dust.approach + (calm ? 0 : dt / 240));
        const front = radius * (1.9 - 0.6 * dust.approach);
        veilMaterial.uniforms.clock.value = dust.clock;
        veilMaterial.uniforms.flow.value = dust.flow;
        veilMaterial.uniforms.front.value = front;
        veilMaterial.uniforms.far.value = dust.far;
        veilMaterial.uniforms.strength.value = dust.shown;
        veilMaterial.uniforms.reach.value = camera.position.distanceTo(root.localToWorld(middle.copy(centre)));
        grainMaterial.uniforms.front.value = THREE.MathUtils.lerp(radius * 3, -radius * 3, dust.far);
        // A gust front crosses every twenty seconds or so.
        grainMaterial.uniforms.gust.value = ((dust.clock * radius * 0.4) % (radius * 8)) - radius * 2;
        grainMaterial.uniforms.strength.value = calm ? 0 : dust.shown * (1 - dust.far);
        if (dust.shown !== dustGoal) busy = true;
      } else dust.approach = 0;

      // Solar particle event.
      const spe = weather?.solar_particle_event;
      const solarGoal = spe ? (calm ? 0.6 : 1) : 0;
      solar.shown = ease(solar.shown, solarGoal, dt, calm);
      wash.visible = solar.shown > 0.001;
      const hitsGoal = spe === 'event' && !calm ? 1 : 0;
      solar.hits = ease(solar.hits, hitsGoal, dt, calm);
      hits.visible = solar.hits > 0.001;
      if (wash.visible) {
        if (!calm) solar.clock = (solar.clock + dt) % 3600;
        // Where the sun is on screen, from the middle of the place.
        root.localToWorld(sunAt.copy(SUN).multiplyScalar(radius * 20).add(centre)).project(camera);
        root.localToWorld(middle.copy(centre)).project(camera);
        washMaterial.uniforms.sun.value.set(sunAt.x - middle.x, sunAt.y - middle.y).normalize();
        washMaterial.uniforms.pulse.value = 1.6 - ((solar.clock / 11) % 1) * 3.6;
        washMaterial.uniforms.strength.value = solar.shown * 0.07;
        if (hits.visible) {
          renderer.getDrawingBufferSize(drawing);
          hitMaterial.uniforms.resolution.value.copy(drawing);
          // Frames counted at a steady 40 a second, whatever the screen's rate, so a hit lasts 25 to 75 ms.
          hitMaterial.uniforms.tick.value = Math.floor(solar.clock * 40) % 4096;
          const swell = 0.5 + 0.5 * Math.sin(solar.clock * 0.23) * Math.sin(solar.clock * 0.071 + 0.6);
          hitMaterial.uniforms.rate.value = 0.03 + 0.11 * swell;
          hitMaterial.uniforms.strength.value = solar.hits * 0.95;
        }
        if (!calm) busy = true;
      }
      return busy;
    },
    dispose() {
      for (const mesh of [veils, grain, hits, wash]) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    },
  };
}
