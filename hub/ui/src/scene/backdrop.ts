// The sky behind the station, as one thing that turns with the camera: stars,
// now and then a faint nebula, a grid on a floor far below and a ceiling far
// above, and Mars underneath. All of it drifts slowly the same way, as if the
// station were cruising nose first in orbit: the planet's ground and the grid
// fastest, the stars slower, the nebulae slowest. It stands still with reduced
// motion.
//
// It belongs to the sky, not to the screen: everything is drawn from the
// camera's real view direction, as if infinitely far away (the stars and the
// planet are kept centred on the camera), so turning or zooming the station
// swings it all round exactly together. It knows nothing of the station or its
// labels and is simply drawn behind everything. The sky is laid out once from
// the default view, with the horizon along the station's length; the grid
// dissolves well before the horizon and the planet's edge sits well below it,
// so the band the station is in stays clear without anything being cut out.
//
// Two looks, set by --scene-sky-style: 'pixel' (square pixel stars, plus-shaped
// sparkles, stepped twinkle, a dithered nebula, a blockier planet) and 'soft'
// (round stars, smooth twinkle, a smooth and fainter nebula). 'off' keeps the
// plain stars and no nebula. Same stars and brightness in both looks.
//
// Draw calls: one screen-covering triangle for the grid, nebula, sky glow and
// the sky glow; one for the stars; one for the planet. Nothing is
// loaded. The grid and the nebula dim when a room is over a limit and all but
// vanish while something is selected; the planet dims with them.
//
// On a surface the sky's up is the ground's up instead of being laid along the
// station, the grid keeps only its ceiling (a floor grid would fight the
// ground), and below is the ground (ground.ts), not a planet: from the Moon,
// Earth hangs small above the horizon instead; Mars has none. In low Earth
// orbit Earth is far bigger below than Mars is from the ship's orbit.
//
// Tune it in app.css: --scene-grid, --scene-grid-strength, --scene-sky-style,
// --scene-sky (the faint blue lift towards the middle of the sky),
// --scene-nebula, --scene-nebula-strength, --scene-planet, --scene-planet-strength.

import * as THREE from 'three';
import { createStars } from './stars.ts';
import type { SkyStyle, Stars } from './stars.ts';
import { createPlanet } from './planet.ts';
import type { Planet } from './planet.ts';
import type { Demo } from './demo.ts';
import type { Body, Situation } from '../../../engine/mission.ts';

/** Where the place is: which body, and whether in orbit, in transit or on its surface. */
export interface Setting {
  body: Body | null;
  situation: Situation;
}

export interface Backdrop {
  /** Lay the sky out from the camera's default view (only the first time, and when the station is turned on its tail). */
  place: () => void;
  /** Call before every frame is drawn. */
  update: (dt: number, still: boolean) => void;
  /** React to the station's state: a room over a limit, something selected. */
  mood: (over: boolean, selected: boolean) => void;
  dispose: () => void;
}

/** A cell's size against the planes' distance from the eye: lower is a finer grid. */
const CELL = 0.4;
/** Cells per second the grid drifts past. */
const SPEED = 0.03;
/** Radians per second the stars turn: further off, so slower than the grid. */
const STAR_SPEED = 0.0015;
/** The nebulae, further still. */
const NEBULA_SPEED = 0.0006;
/** Radians per second the planet turns under the station. */
const PLANET_SPEED = 0.002;
/** Where the grid shows, as the sine of the angle above or below the horizon: it appears from FROM, is strongest at PEAK, and is gone by TO. */
const FROM = Math.sin(THREE.MathUtils.degToRad(7.5));
const PEAK = Math.sin(THREE.MathUtils.degToRad(14));
const TO = Math.sin(THREE.MathUtils.degToRad(55));
/** The planet: its middle this far below the horizon, and this wide (angular radius), so its edge sits 12 degrees below. */
const PLANET_DOWN = THREE.MathUtils.degToRad(32);
const PLANET_SIZE = THREE.MathUtils.degToRad(20);
/** Low Earth orbit: Earth is close, so it is bigger and its edge comes nearer the horizon. */
const LEO_DOWN = THREE.MathUtils.degToRad(38);
const LEO_SIZE = THREE.MathUtils.degToRad(26);
/** From the Moon: Earth small, above the horizon, ahead. */
const EARTH_UP = THREE.MathUtils.degToRad(7);
const EARTH_SIZE = THREE.MathUtils.degToRad(2.2);
const PLANET_DISTANCE = 200;
/** Size of one chunky pixel in the pixel look, in CSS pixels. */
const BLOCK = 2;
/** How strong the sky's blue lift is towards the middle. */
const GLOW = 0.16;

/**
 * The nebulae: where each sits (degrees round from ahead, degrees up), how wide (degrees), and its
 * cycle (seconds, phase): each drifts into view and out again, so sometimes there is one and often none.
 */
const NEBULAE: [number, number, number, number, number][] = [
  [-15, 12, 20, 170, 0],
  [17, 13, 22, 230, 3.5],
];
/** With ?demoNebula=on: one, in view, at full strength. */
const SHOWN_NEBULA: [number, number, number] = [-12, 10, 18];

const VERTEX = /* glsl */ `
uniform mat3 toSky;
uniform vec2 lens;
uniform vec2 shift;
varying vec3 ray;

void main() {
  // At the far plane: anything the station draws covers it.
  gl_Position = vec4(position.xy, 1.0, 1.0);
  // The direction this corner looks in, in the sky's own axes (along the station, up, ahead).
  // shift: the camera's view offset (see Station.tsx's insets), so the sky stays put behind it.
  ray = toSky * vec3((position.xy + shift) * lens, -1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 colour;
uniform float strength;
uniform float ratio;
uniform float block;
uniform float offset;
uniform vec3 band;
uniform vec4 nebulaA;
uniform vec4 nebulaB;
uniform vec2 envelope;
uniform float nebula;
uniform vec3 nebulaTone;
uniform vec3 nebulaTone2;
uniform vec3 glowColour;
uniform float glow;
uniform float floorGrid;
varying vec3 ray;

float lines(float w) {
  float f = fwidth(w);
  float d = abs(fract(w - 0.5) - 0.5) / f;
  // A soft line about one CSS pixel wide; where they would crowd closer than a few pixels apart
  // (towards the horizon) they fade out instead of shimmering.
  return (1.0 - smoothstep(0.0, 1.1 * ratio, d)) * (1.0 - smoothstep(0.07, 0.16, f * ratio));
}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// Ordered dithering: a 4 by 4 Bayer threshold, 0..1.
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

// How thick the nebulae are in this direction, 0..1. Kept off the horizon, where the station is.
float cloud(vec3 v) {
  float shape = envelope.x * smoothstep(nebulaA.w, 1.0, dot(v, nebulaA.xyz))
              + envelope.y * smoothstep(nebulaB.w, 1.0, dot(v, nebulaB.xyz));
  float n = 0.55 * noise(v * 4.0) + 0.3 * noise(v * 9.0 + 3.1) + 0.15 * noise(v * 19.0 + 7.3);
  float d = shape * smoothstep(0.38, 0.72, n + 0.25 * shape);
  return clamp(d, 0.0, 1.0) * smoothstep(0.08, 0.22, abs(v.y));
}

void main() {
  vec3 r = normalize(ray);
  vec3 dx = dFdx(ray);
  vec3 dy = dFdy(ray);
  vec3 rr = r;
  #ifdef PIXEL
    // The direction at the middle of this chunky pixel, so the whole pixel is one colour.
    vec2 c = (floor(gl_FragCoord.xy / (block * 1.5)) + 0.5) * block * 1.5;
    rr = normalize(ray + dx * (c.x - gl_FragCoord.x) + dy * (c.y - gl_FragCoord.y));
  #endif

  float e = max(abs(r.y), 1e-4);
  float lift = smoothstep(band.x, band.y, e) * (1.0 - smoothstep(band.y, band.z, e));
  // Where the ray meets the plane one unit above or below, in cells.
  vec2 g = r.xz / (e * ${CELL.toFixed(3)});
  float ga = max(lines(g.x + offset), lines(g.y)) * lift * strength * mix(step(0.0, r.y), 1.0, floorGrid);

  float na = 0.0;
  vec3 nc = nebulaTone;
  if (nebula > 0.0005) {
    float d = cloud(rr);
    #ifdef PIXEL
      float level = clamp(floor(d * 3.0 + bayer4(floor(gl_FragCoord.xy / (block * 1.5)))) / 3.0, 0.0, 1.0);
      nc = mix(nebulaTone, nebulaTone2, step(0.6, level));
      na = level * nebula;
    #else
      nc = mix(nebulaTone, nebulaTone2, d);
      na = d * nebula * 0.7;
    #endif
  }

  // A faint blue lift, strongest straight ahead near the horizon.
  float ahead = max(r.z, 0.0);
  float wa = glow * exp(-r.y * r.y * 25.0) * (0.2 + 0.8 * ahead * ahead);

  float total = ga + na + wa;
  if (total < 0.002) discard;
  gl_FragColor = vec4((colour * ga + nc * na + glowColour * wa) / total, min(total, 1.0));
  #include <colorspace_fragment>
}`;

function cssValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function cssColour(name: string, fallback: string): THREE.Color {
  return new THREE.Color(cssValue(name) || fallback);
}

/** A strength from app.css, or from a ?demo switch: 'off' is 0, 'strong' is `strong`, 'on' never 0. */
function strengthOf(name: string, fallback: number, setting: string | null, strong: number): number {
  const read = parseFloat(cssValue(name));
  if (setting === 'off') return 0;
  if (setting === 'strong') return strong;
  if (setting === 'on') return read > 0 ? read : fallback;
  return Number.isFinite(read) ? Math.max(0, read) : fallback;
}

/** A direction in the sky's axes: degrees round from ahead (towards +X), degrees up. */
function skyDirection(out: THREE.Vector3, round: number, up: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(round);
  const e = THREE.MathUtils.degToRad(up);
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

export function createBackdrop(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  root: THREE.Object3D,
  plainStars: THREE.Object3D,
  demo: Demo | null,
  setting: Setting = { body: 'mars', situation: 'orbit' },
): Backdrop {
  const surface = setting.situation === 'surface';
  /** Which body the sky shows, and where: below in space, Earth above from the Moon, none on Mars. */
  const skyBody: Body | null = surface ? (setting.body === 'moon' ? 'earth' : null) : setting.body;
  const leo = !surface && setting.body === 'earth';
  const planetDown = surface ? -EARTH_UP : leo ? LEO_DOWN : PLANET_DOWN;
  const planetSize = surface ? EARTH_SIZE : leo ? LEO_SIZE : PLANET_SIZE;
  const read = cssValue('--scene-sky-style');
  const style: SkyStyle = demo?.sky ?? (read === 'soft' || read === 'off' ? read : 'pixel');
  const pixel = style === 'pixel';
  const ink = cssColour('--scene-line', '#f2f3f5');
  const bg = cssColour('--bg', '#0b0c0e');

  const gridBase = strengthOf('--scene-grid-strength', 0.03, demo?.grid ?? null, 0.6);
  const nebulaBase = style === 'off' ? 0 : strengthOf('--scene-nebula-strength', 0.18, null, 0) * (pixel ? 1 : 0.7);
  const planetBase = strengthOf('--scene-planet-strength', 0.5, demo?.planet ?? null, 1);
  const showNebula = demo?.nebula === true;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const nebulaTone = cssColour('--scene-nebula', '#55657c');
  const uniforms = {
    colour: { value: cssColour('--scene-grid', '#7d8da3') },
    strength: { value: 0 },
    ratio: { value: 1 },
    block: { value: BLOCK },
    offset: { value: 0 },
    band: { value: new THREE.Vector3(FROM, PEAK, TO) },
    toSky: { value: new THREE.Matrix3() },
    lens: { value: new THREE.Vector2(1, 1) },
    shift: { value: new THREE.Vector2() },
    nebulaA: { value: new THREE.Vector4() },
    nebulaB: { value: new THREE.Vector4() },
    envelope: { value: new THREE.Vector2() },
    nebula: { value: 0 },
    nebulaTone: { value: nebulaTone },
    // The second tone: the same dust, a step warmer and paler.
    nebulaTone2: { value: nebulaTone.clone().lerp(new THREE.Color('#8a8276'), 0.45) },
    glowColour: { value: cssColour('--scene-sky', '#132138') },
    // The Moon has no air: its sky stays black.
    glow: { value: style === 'off' || (surface && setting.body === 'moon') ? 0 : GLOW },
    floorGrid: { value: surface ? 0 : 1 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    defines: pixel ? { PIXEL: '' } : {},
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.visible = false;
  scene.add(mesh);

  // The stars: the plain ones from the scene when the sky is off, otherwise this sky's own.
  const stars: Stars | null = style === 'off' ? null : createStars(style, ink);
  const field: THREE.Object3D = stars ? stars.points : plainStars;
  if (stars) {
    plainStars.visible = false;
    scene.add(stars.points);
  }

  const planet: Planet | null = planetBase > 0 && skyBody
    ? createPlanet(style === 'soft' ? 'soft' : 'pixel', skyBody, bg)
    : null;
  if (planet) scene.add(planet.mesh);

  // The sky's axes: along the station (the way the sky drifts), up from the floor, and ahead to the horizon.
  const along = new THREE.Vector3();
  const up = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const sky = new THREE.Matrix3();
  const skyTurn = new THREE.Quaternion();
  const basis = new THREE.Matrix4();
  const turn = new THREE.Matrix4();
  const view = new THREE.Matrix3();
  const placedAs = new THREE.Quaternion(0, 0, 0, 0);
  const origin = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const spin = new THREE.Quaternion();
  // The planet's middle and its turning axis, in the sky's axes and in the world.
  const planetSky = new THREE.Vector3();
  const planetAxisSky = new THREE.Vector3();
  const sunSky = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  /** 1 when the sky's up is the screen's up at the default view, -1 when it is the screen's down. */
  let upright = 1;
  const planetWorld = new THREE.Vector3();
  const planetAxis = new THREE.Vector3();
  const planetTilt = new THREE.Quaternion();
  const pixels = new THREE.Vector2();
  // The nebulae: their resting places in the sky, and where they are now.
  const rest = NEBULAE.map(([round, raise]) => skyDirection(new THREE.Vector3(), round, raise));
  const shown = skyDirection(new THREE.Vector3(), SHOWN_NEBULA[0], SHOWN_NEBULA[1]);
  const moved = new THREE.Vector3();

  let gridGoal = gridBase;
  let gridShown = 0;
  let nebulaGoal = nebulaBase;
  let nebulaShown = 0;
  let planetGoal = planetBase;
  let planetShown = 0;
  let travelled = 0;
  let spun = 0;
  let clock = 0;

  const place = () => {
    if (placedAs.equals(root.quaternion)) return;
    placedAs.copy(root.quaternion);
    // The horizon runs along the station's length, through its middle, as seen from the camera now.
    root.updateMatrixWorld(true);
    along.set(1, 0, 0).applyQuaternion(root.quaternion);
    root.localToWorld(origin.set(0, 0, 0));
    origin.subVectors(camera.position, origin);
    if (surface) {
      // The ground's up, and along the ground square to the view.
      up.set(0, 1, 0).applyQuaternion(root.quaternion);
      along.crossVectors(up, origin).normalize();
    } else up.crossVectors(along, origin).normalize();
    // Whichever side the plane normal comes out, ahead is chosen so that the stars turning about
    // it carry them the same way as the grid: towards the engines (+X), the station flying nose first.
    ahead.crossVectors(along, up);
    if (ahead.dot(origin) > 0) {
      // On a surface up stays up: the drift turns round instead.
      (surface ? along : up).negate();
      ahead.negate();
    }
    sky.set(along.x, along.y, along.z, up.x, up.y, up.z, ahead.x, ahead.y, ahead.z);
    // The planet goes below on screen, the nebulae above and the sun overhead, whichever way the sky's up came out.
    upright = up.dot(camUp.set(0, 1, 0).applyQuaternion(camera.quaternion)) < 0 ? -1 : 1;
    planetSky.set(0, -upright * Math.sin(planetDown), Math.cos(planetDown));
    planetAxisSky.set(1, 0, 0).cross(planetSky).normalize();
    sunSky.set(-0.45, 0.75 * upright, -0.5).normalize();
    skyTurn.setFromRotationMatrix(basis.makeBasis(along, up, ahead));
    if (planet) {
      planetWorld.copy(planetSky).applyQuaternion(skyTurn);
      if (leo) {
        // Seen from low orbit Earth fills the view below; the station's default view looks well
        // down at it, so Earth is set against that view instead: its upper edge the same distance
        // below the middle of the screen as Mars's under the ship, a quiet curve at the bottom.
        // (From the camera's position: its turn is only brought up to date on the next frame.)
        const forward = origin.clone().negate().normalize();
        camUp.set(0, 1, 0).addScaledVector(forward, -forward.y).normalize();
        const down = THREE.MathUtils.degToRad(12) + planetSize;
        planetWorld.copy(forward).multiplyScalar(Math.cos(down)).addScaledVector(camUp, -Math.sin(down)).normalize();
      }
      planetAxis.copy(planetAxisSky).applyQuaternion(skyTurn);
      planetTilt.setFromUnitVectors(yAxis, planetAxis);
      planet.uniforms.sun.value.copy(sunSky).applyQuaternion(skyTurn);
    }
  };

  const ease = (shownNow: number, goal: number, dt: number, still: boolean) =>
    still ? goal : shownNow + (goal - shownNow) * (1 - Math.exp(-dt * 3));

  const update = (dt: number, still: boolean) => {
    if (placedAs.lengthSq() === 0) place();
    if (!still) {
      travelled = (travelled + dt * SPEED) % 1;
      spun = (spun + dt * STAR_SPEED) % (Math.PI * 2);
      clock += dt;
    }
    renderer.getDrawingBufferSize(pixels);
    const ratio = renderer.getPixelRatio();

    // The stars sit round the camera, as far away as the grid: zooming moves neither.
    field.position.copy(camera.position);
    field.quaternion.copy(skyTurn).multiply(spin.setFromAxisAngle(yAxis, spun));
    if (stars) {
      stars.uniforms.time.value = clock;
      stars.uniforms.ratio.value = ratio;
      stars.uniforms.block.value = BLOCK * ratio;
      stars.uniforms.viewport.value.copy(pixels);
    }

    planetShown = ease(planetShown, planetGoal, dt, still);
    if (planet) {
      planet.mesh.visible = planetShown > 0.002;
      planet.mesh.position.copy(planetWorld).multiplyScalar(PLANET_DISTANCE).add(camera.position);
      planet.mesh.scale.setScalar(PLANET_DISTANCE * Math.sin(planetSize));
      planet.mesh.quaternion.copy(planetTilt).multiply(spin.setFromAxisAngle(yAxis, (clock * PLANET_SPEED) % (Math.PI * 2)));
      planet.uniforms.strength.value = planetShown;
      // Its own depth slice runs from just before its nearest ground to its edge.
      planet.uniforms.near.value = PLANET_DISTANCE * (1 - Math.sin(planetSize) * 1.08);
      planet.uniforms.span.value = PLANET_DISTANCE * (Math.cos(planetSize) + Math.sin(planetSize) * 1.08) - planet.uniforms.near.value;
    }

    gridShown = ease(gridShown, gridGoal, dt, still);
    nebulaShown = ease(nebulaShown, nebulaGoal, dt, still);
    const glowing = uniforms.glow.value > 0;
    if (gridShown < 0.002 && nebulaShown < 0.0005 && !glowing && !planet) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const lift = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    uniforms.lens.value.set(lift * camera.aspect, lift);
    const v = camera.view;
    if (v?.enabled) uniforms.shift.value.set((2 * v.offsetX) / v.fullWidth, (-2 * v.offsetY) / v.fullHeight);
    else uniforms.shift.value.set(0, 0);
    view.setFromMatrix4(turn.makeRotationFromQuaternion(camera.quaternion));
    uniforms.toSky.value.multiplyMatrices(sky, view);
    uniforms.strength.value = gridShown;
    uniforms.ratio.value = ratio;
    uniforms.block.value = BLOCK * ratio;
    // Lines at fixed cells slide towards +X as this falls.
    uniforms.offset.value = 1 - travelled;

    // Each nebula fades in and out on its own long cycle; with reduced motion one rests half shown.
    uniforms.nebula.value = nebulaShown;
    const drift = spun * (NEBULA_SPEED / STAR_SPEED);
    const cos = Math.cos(drift);
    const sin = Math.sin(drift);
    for (let i = 0; i < 2; i++) {
      const [, , width, period, phase] = NEBULAE[i];
      const from = showNebula && i === 0 ? shown : rest[i];
      moved.set(from.x * cos + from.z * sin, from.y * upright, from.z * cos - from.x * sin);
      const radius = Math.cos(THREE.MathUtils.degToRad(showNebula && i === 0 ? SHOWN_NEBULA[2] : width));
      (i === 0 ? uniforms.nebulaA : uniforms.nebulaB).value.set(moved.x, moved.y, moved.z, radius);
      const wave = 0.5 + 0.5 * Math.sin((clock / period) * Math.PI * 2 + phase);
      const envelope = showNebula ? (i === 0 ? 1 : 0) : still ? (i === 0 ? 0.6 : 0) : THREE.MathUtils.smoothstep(wave, 0.2, 0.9);
      if (i === 0) uniforms.envelope.value.x = envelope;
      else uniforms.envelope.value.y = envelope;
    }

  };

  const mood = (over: boolean, selected: boolean) => {
    gridGoal = gridBase * (over ? 0.5 : 1) * (selected ? 0.06 : 1);
    nebulaGoal = nebulaBase * (over ? 0.25 : 1) * (selected ? 0.05 : 1);
    planetGoal = planetBase * (over ? 0.6 : 1) * (selected ? 0.15 : 1);
    const colour = cssValue('--scene-grid');
    if (colour) uniforms.colour.value.set(colour);
  };

  const dispose = () => {
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
    if (stars) {
      scene.remove(stars.points);
      stars.dispose();
    }
    if (planet) {
      scene.remove(planet.mesh);
      planet.dispose();
    }
    plainStars.visible = true;
    plainStars.position.set(0, 0, 0);
    plainStars.quaternion.identity();
  };

  return { place, update, mood, dispose };
}
