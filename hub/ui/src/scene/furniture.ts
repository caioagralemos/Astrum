// What is inside each kind of room, drawn in outline so a room can be told at a
// glance: the command deck's console and windscreen, the lab's racks and bench,
// the galley's table and lockers, the gym's treadmill and cycle, a cabin's
// sleeping bag. In orbit everything is made for weightlessness: nothing to sit
// on, no bunks, only foot bars, straps and harnesses. On a surface (gravity
// above 0) the same rooms get ordinary furniture: chairs, bunks, benches, a
// couch, drawn from the floor up. A few lines, not clutter.
//
// Measurements are in metres from the room's middle along the station, from
// the module's axis in height, and from the axis in depth (the back wall is at
// z = -COS * R, the front wall at z = COS * R).
//
// The station is a cutaway from either side: whichever long wall faces the
// viewer is left out, and the far one stays. So each room is drawn in three
// parts: what hangs on the back wall, what hangs on the front wall, and what
// stands free in the room. The view shows only the far wall's part.

import { BUNK_TOP, BUNK_Z, COS, R, SEATS, SEAT_RADIUS, SIN, STATIONS, floorOf, radiusAt } from './layout.ts';
import type { RoomPlace, Template } from './layout.ts';
import type { Pen } from './pen.ts';

const TOP = COS * R;
const BACK = -COS * R;
/** The front wall: its fittings are seen only from behind the station. */
const FRONT = COS * R;

/** Which part of a room to draw: the free-standing things, or one long wall's. */
export type Wall = 'room' | 'back' | 'front';

/** A porthole in the front wall, with its frame. */
function porthole(pen: Pen, x: number, y: number, r: number) {
  pen.circle(x, y, FRONT - 0.02, r, 'xy', 24).circle(x, y, FRONT - 0.06, r + 0.08, 'xy', 24);
}

/** A handrail along the front wall, on two stand-offs. */
function handrail(pen: Pen, x0: number, x1: number, y: number) {
  pen.seg(x0, y, FRONT - 0.12, x1, y, FRONT - 0.12).seg(x0, y, FRONT - 0.12, x0, y, FRONT - 0.02).seg(x1, y, FRONT - 0.12, x1, y, FRONT - 0.02);
}

/** Soft stowage bags strapped to the front wall. */
function stowage(pen: Pen, x0: number, y0: number, cols: number, rows: number) {
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = x0 + i * 0.5;
      const y = y0 + j * 0.42;
      pen.box(x, y, FRONT - 0.24, x + 0.44, y + 0.36, FRONT - 0.02);
      pen.seg(x + 0.22, y, FRONT - 0.24, x + 0.22, y + 0.36, FRONT - 0.24);
    }
  }
}

/** A soft light fitting on the ceiling, which the room's status light seems to come from. */
function ceilingLight(pen: Pen) {
  pen.rectXZ(-0.55, -0.85, 0.55, -0.3, TOP - 0.03);
}

function command(pen: Pen, place: RoomPlace, wall: Wall) {
  if (wall === 'back') return;
  const cx = (place.x0 + place.x1) / 2;
  if (wall === 'front') {
    // A second, smaller console for the commander, and a handrail. The nose
    // narrows, so the front wall here sits a little further in.
    pen.at(cx, 0, COS * radiusAt(place, cx + 0.15) - FRONT);
    pen.box(0.15, -0.6, FRONT - 0.32, 1.25, 0.0, FRONT - 0.02);
    pen.rectXY(0.3, -0.45, 1.1, -0.15, FRONT - 0.32);
    handrail(pen, 0.2, 1.2, 0.35);
    return;
  }
  const r = (x: number) => radiusAt(place, cx + x);
  // Console under the windscreen, its top sloping up towards the nose, with two screens.
  const profile: [number, number][] = [[-1.45, -1.0], [-0.7, -1.0], [-0.7, -0.5], [-1.2, -0.05], [-1.45, -0.05]];
  for (const z of [-0.7, 0.3]) pen.path(profile.map(([x, y]) => [x, y, z]), true);
  for (const [x, y] of profile) pen.seg(x, y, -0.7, x, y, 0.3);
  const slope = (t: number, z: number): [number, number, number] => [-0.7 - 0.5 * t + 0.02, -0.5 + 0.45 * t + 0.02, z];
  for (const [z0, z1] of [[-0.6, -0.15], [-0.05, 0.22]]) pen.path([slope(0.2, z0), slope(0.85, z0), slope(0.85, z1), slope(0.2, z1)], true);
  // Windscreen: panes in the two upper faces where the nose tapers, looking forward and up.
  for (const [a, b] of [[-1.7, -1.15], [-1.05, -0.5]]) {
    const ra = r(a) - 0.04;
    const rb = r(b) - 0.04;
    pen.path([[a, COS * ra, -SIN * ra * 0.7], [b, COS * rb, -SIN * rb * 0.7], [b, COS * rb, SIN * rb * 0.6], [a, COS * ra, SIN * ra * 0.6]], true);
    const slant = (rr: number, t: number): [number, number] => [COS * rr + (SIN * rr - COS * rr) * t, -SIN * rr + (-COS * rr + SIN * rr) * t];
    const [ya0, za0] = slant(ra, 0.18);
    const [ya1, za1] = slant(ra, 0.82);
    const [yb0, zb0] = slant(rb, 0.18);
    const [yb1, zb1] = slant(rb, 0.82);
    pen.path([[a, ya0, za0], [b, yb0, zb0], [b, yb1, zb1], [a, ya1, za1]], true);
  }
  // The pilot's station: an open back frame with a harness, and a foot bar. Nothing to sit on.
  pen.rectYZ(-1.15, -0.5, -0.05, 0.1, 0.3);
  pen.path([[0.3, -0.1, -0.45], [0.3, -0.65, -0.2], [0.3, -0.1, 0.05]]);
  pen.seg(0.3, -0.65, -0.2, 0.3, -0.95, -0.2);
  const floor = -COS * r(-0.35);
  pen.seg(-0.35, floor + 0.25, -0.45, -0.35, floor + 0.25, 0.2);
  pen.seg(-0.35, floor + 0.25, -0.45, -0.35, floor, -0.45).seg(-0.35, floor + 0.25, 0.2, -0.35, floor, 0.2);
}

function lab(pen: Pen, wall: Wall) {
  if (wall === 'front') {
    // A cold-storage freezer with four drawers, stowage bags and a handrail.
    pen.box(-2.2, -0.8, FRONT - 0.34, -1.2, 0.7, FRONT - 0.02);
    for (const y of [-0.42, -0.05, 0.32]) pen.seg(-2.2, y, FRONT - 0.34, -1.2, y, FRONT - 0.34);
    stowage(pen, -0.6, -0.7, 2, 3);
    handrail(pen, 0.9, 2.2, 0.55);
    return;
  }
  if (wall === 'room') {
    // Workbench with the blood analyser on it, held to the floor by one post, and a foot rail.
    pen.box(0.95, -0.8, -1.6, 2.3, -0.72, 0.2);
    pen.box(1.55, -TOP, -0.8, 1.7, -0.8, -0.65);
    pen.box(1.1, -0.72, -1.35, 1.6, -0.36, -0.85);
    pen.rectXY(1.18, -0.64, 1.42, -0.46, -0.85);
    pen.seg(0.95, -1.82, 0.5, 2.3, -1.82, 0.5).seg(1.0, -1.82, 0.5, 1.0, -TOP, 0.5).seg(2.25, -1.82, 0.5, 2.25, -TOP, 0.5);
    ceilingLight(pen);
    return;
  }
  // Three experiment racks along the back wall; the middle one is a glovebox.
  for (const c of [-1.65, -0.55, 0.55]) {
    pen.box(c - 0.5, -0.8, BACK + 0.03, c + 0.5, 0.8, BACK + 0.3);
    if (c === -0.55) {
      pen.seg(c - 0.5, 0.45, BACK + 0.3, c + 0.5, 0.45, BACK + 0.3);
      pen.circle(c - 0.22, -0.15, BACK + 0.3, 0.14, 'xy', 14).circle(c + 0.22, -0.15, BACK + 0.3, 0.14, 'xy', 14);
    } else {
      for (const y of [-0.27, 0.27]) pen.seg(c - 0.5, y, BACK + 0.3, c + 0.5, y, BACK + 0.3);
    }
  }
}

function galley(pen: Pen, wall: Wall) {
  if (wall === 'front') {
    // Two portholes the crew eat by, a screen for calls home, a handrail.
    porthole(pen, -1.5, 0.15, 0.32);
    porthole(pen, -0.55, 0.15, 0.32);
    pen.rectXY(0.6, -0.15, 1.7, 0.55, FRONT - 0.04).rectXY(0.66, -0.09, 1.64, 0.49, FRONT - 0.05);
    handrail(pen, -1.9, 1.9, -0.6);
    return;
  }
  if (wall === 'back') {
    // Food lockers on the back wall, and the food warmer and water dispenser.
    pen.box(-2.3, -0.8, BACK + 0.03, -1.1, 0.8, BACK + 0.28);
    pen.seg(-1.7, -0.8, BACK + 0.28, -1.7, 0.8, BACK + 0.28);
    for (const y of [-0.27, 0.27]) pen.seg(-2.3, y, BACK + 0.28, -1.1, y, BACK + 0.28);
    pen.box(1.2, -0.1, BACK + 0.03, 2.1, 0.5, BACK + 0.38);
    pen.rectXY(1.3, 0.0, 1.8, 0.4, BACK + 0.38);
    pen.box(1.4, -0.8, BACK + 0.03, 1.8, -0.35, BACK + 0.25);
    pen.seg(1.6, -0.8, BACK + 0.25, 1.6, -0.9, BACK + 0.32);
    return;
  }
  // The table, on a single post, with a foot bar round it to hook toes under.
  pen.box(-0.8, -0.78, -1.05, 0.8, -0.7, 0.25);
  pen.box(-0.07, -TOP, -0.47, 0.07, -0.78, -0.33);
  pen.rectXZ(-0.75, -0.95, 0.75, 0.2, -1.72);
  pen.seg(-0.07, -1.72, -0.4, -0.75, -1.72, -0.4).seg(0.07, -1.72, -0.4, 0.75, -1.72, -0.4);
  ceilingLight(pen);
}

function gym(pen: Pen, wall: Wall) {
  if (wall === 'back') return;
  if (wall === 'front') {
    // A screen to run by, and the resistive exercise device's frame and bar.
    pen.rectXY(-1.6, 0.0, -0.6, 0.65, FRONT - 0.04).rectXY(-1.54, 0.06, -0.66, 0.59, FRONT - 0.05);
    pen.box(0.7, -0.8, FRONT - 0.3, 1.9, -0.7, FRONT - 0.02);
    pen.seg(0.8, -0.7, FRONT - 0.16, 0.8, 0.7, FRONT - 0.16).seg(1.8, -0.7, FRONT - 0.16, 1.8, 0.7, FRONT - 0.16);
    pen.seg(0.65, 0.2, FRONT - 0.16, 1.95, 0.2, FRONT - 0.16);
    return;
  }
  // Treadmill on the floor, with the harness bungees that hold a runner down.
  pen.box(-1.95, -2.0, -0.8, -0.25, -1.82, 0.3);
  pen.rectXZ(-1.85, -0.7, -0.35, 0.2, -1.82);
  pen.circle(-1.1, -0.45, -0.25, 0.24, 'xz', 16);
  for (const [x, z, dx, dz] of [[-1.85, -0.7, -1, -1], [-1.85, 0.2, -1, 1], [-0.35, -0.7, 1, -1], [-0.35, 0.2, 1, 1]]) {
    pen.seg(x, -1.82, z, -1.1 + dx * 0.17, -0.45, -0.25 + dz * 0.17);
  }
  // Exercise cycle: frame, flywheel, crank and handlebar. No saddle; the rider is clipped in.
  pen.box(0.75, -2.0, -0.75, 1.85, -1.85, -0.05);
  pen.circle(1.2, -1.4, -0.4, 0.32, 'xy', 20).circle(1.2, -1.4, -0.4, 0.05, 'xy', 8);
  pen.seg(1.2, -1.4, -0.4, 1.38, -1.18, -0.4).seg(1.38, -1.18, -0.55, 1.38, -1.18, -0.25);
  pen.seg(1.75, -1.85, -0.4, 1.75, -0.75, -0.4).seg(1.75, -0.75, -0.75, 1.75, -0.75, -0.05);
  pen.seg(1.75, -0.75, -0.75, 1.6, -0.75, -0.75).seg(1.75, -0.75, -0.05, 1.6, -0.75, -0.05);
  ceilingLight(pen);
}

function quarters(pen: Pen, wall: Wall) {
  if (wall === 'front') {
    // A porthole, and a few personal things strapped up.
    porthole(pen, -0.3, 0.45, 0.22);
    pen.rectXY(0.25, 0.2, 0.65, 0.7, FRONT - 0.03);
    return;
  }
  if (wall === 'back') {
    // A small screen on the back wall.
    pen.rectXY(-0.55, 0.3, 0.15, 0.72, BACK + 0.02).rectXY(-0.5, 0.35, 0.1, 0.67, BACK + 0.02);
    return;
  }
  // A personal locker on the near end wall, and a reading light.
  pen.box(-1.17, 0.95, -1.25, -0.95, 1.5, -0.5);
  pen.seg(-0.95, 1.15, -0.62, -0.95, 1.3, -0.62);
  pen.box(0.45, 1.0, -1.7, 0.75, 1.1, -1.55);
}

/**
 * The sleeping bag, standing on the far end wall of a cabin (the wall the default
 * view looks at), head up in both cabins. Drawn with its own origin, never mirrored.
 */
function sleepingBag(pen: Pen) {
  const x = 1.04;
  const outline: [number, number][] = [[-0.87, 0.2], [-0.43, 0.2], [-0.32, 1.62], [-0.42, 1.82], [-0.88, 1.82], [-0.98, 1.62]];
  pen.path(outline.map(([z, y]) => [x, y, z]), true);
  pen.seg(x, 1.25, -0.95, x, 1.25, -0.35);
  for (const [z, y] of [[-0.85, 0.24], [-0.45, 0.24], [-0.4, 1.78], [-0.9, 1.78]]) pen.seg(x, y, z, 1.185, y, z);
}

// ---- Weightless rooms that only the station has. ----

/**
 * An empty spacesuit stored on its wall mount, seen from the front, its torso's face at depth z and
 * the wall at `wall`. Drawn as the suit, not a body: a big round helmet with a visor and no face,
 * the hard upper torso with the life-support pack standing proud of it behind (wider than the
 * shoulders and above them), the small control box on the chest, thick ringed arms and legs
 * hanging limp, block gloves and boots. It hangs from a rail on two struts, and an umbilical hose
 * loops from the chest box to the wall. Perfectly symmetric and rigid. Its feet are at y = -1.05.
 */
function suit(pen: Pen, x: number, z: number, wall: number) {
  const back = z - 0.24;
  // Life-support pack behind the torso: deeper than it, wider than the shoulders, above them.
  pen.box(x - 0.36, -0.02, back, x + 0.36, 0.8, z - 0.04);
  // The mount: a rail across the wall above it, hooks down to the pack, two struts to the wall.
  pen.seg(x - 0.42, 0.96, wall, x + 0.42, 0.96, wall);
  for (const side of [-1, 1]) {
    pen.seg(x + side * 0.22, 0.96, wall, x + side * 0.22, 0.8, back);
    pen.seg(x + side * 0.22, 0.2, back, x + side * 0.22, 0.2, wall);
  }
  // Helmet over the pack's top, its visor a flat-bottomed arc, no face.
  pen.circle(x, 0.76, z + 0.04, 0.2, 'xy', 20);
  const visor: [number, number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI * (0.12 + (0.76 * i) / 6);
    visor.push([x + Math.cos(a) * 0.15, 0.7 + Math.sin(a) * 0.13, z + 0.06]);
  }
  pen.path(visor, true);
  // Neck ring, the hard upper torso tapering to the waist, and the waist ring.
  pen.seg(x - 0.14, 0.57, z + 0.02, x + 0.14, 0.57, z + 0.02);
  pen.path([[x - 0.31, 0.55, z], [x + 0.31, 0.55, z], [x + 0.27, 0.12, z], [x + 0.21, -0.08, z], [x - 0.21, -0.08, z], [x - 0.27, 0.12, z]], true);
  pen.rectXY(x - 0.22, -0.2, x + 0.22, -0.08, z);
  // The control box on the chest.
  pen.box(x - 0.12, 0.16, z, x + 0.12, 0.34, z + 0.09);
  // A thick tube from a to b, `w` wide, closed at both ends (rings at the joints).
  const tube = (ax: number, ay: number, bx: number, by: number, w: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    const nx = (-(by - ay) / len) * (w / 2);
    const ny = ((bx - ax) / len) * (w / 2);
    pen.path([[ax + nx, ay + ny, z], [bx + nx, by + ny, z], [bx - nx, by - ny, z], [ax - nx, ay - ny, z]], true);
  };
  for (const side of [-1, 1]) {
    // Arms hanging at rest, a little out from the body; elbow and wrist rings close each tube.
    tube(x + side * 0.33, 0.48, x + side * 0.43, 0.12, 0.15);
    tube(x + side * 0.43, 0.12, x + side * 0.46, -0.2, 0.14);
    pen.rectXY(x + side * 0.46 - 0.07, -0.36, x + side * 0.46 + 0.07, -0.2, z);
    // Legs hanging limp, slightly apart; knee rings close each tube, boots as blocks.
    tube(x + side * 0.12, -0.2, x + side * 0.15, -0.6, 0.17);
    tube(x + side * 0.15, -0.6, x + side * 0.16, -0.93, 0.16);
    pen.box(x + side * 0.16 - 0.1, -1.05, z - 0.06, x + side * 0.16 + 0.1, -0.93, z + 0.1);
  }
  // The umbilical, looping from the chest box out and back to the wall.
  const hose: [number, number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    hose.push([x + 0.12 + 0.6 * Math.sin(t * Math.PI * 0.75), 0.24 - 0.8 * Math.sin(t * Math.PI), z + 0.09 + (wall - z - 0.09) * t]);
  }
  pen.path(hose);
}

/** The airlock in orbit: suits on the back wall, tools and a handrail on the front. */
function airlock(pen: Pen, wall: Wall) {
  if (wall === 'back') {
    suit(pen, -0.75, BACK + 0.3, BACK + 0.03);
    suit(pen, 0.75, BACK + 0.3, BACK + 0.03);
    return;
  }
  if (wall === 'front') {
    stowage(pen, -1.0, -0.6, 2, 2);
    handrail(pen, -1.6, 1.6, 0.6);
    return;
  }
  ceilingLight(pen);
}

/** Four sleep stations in a node's walls (the ISS keeps its crew quarters in Harmony). */
function sleepStations(pen: Pen, wall: Wall) {
  if (wall === 'front') {
    stowage(pen, -1.9, -0.7, 2, 2);
    stowage(pen, 1.0, -0.7, 2, 2);
    handrail(pen, -2.4, 2.4, 0.75);
    return;
  }
  if (wall === 'room') {
    // Drawn with the room, not the wall, so they show from either side.
    for (const x of STATIONS) {
      // The compartment set into the wall, its open front, and the bag hung inside.
      pen.box(x - 0.6, -1.0, BACK + 0.03, x + 0.6, 1.1, BACK + 0.85);
      pen.path([[x - 0.25, -0.85, BACK + 0.12], [x + 0.25, -0.85, BACK + 0.12], [x + 0.3, 0.75, BACK + 0.12], [x + 0.2, 0.95, BACK + 0.12], [x - 0.2, 0.95, BACK + 0.12], [x - 0.3, 0.75, BACK + 0.12]], true);
    }
    ceilingLight(pen);
  }
}

/** A room with no fittings of its own (a node, a store): racks behind, bags and a handrail in front. */
function plain(pen: Pen, wall: Wall) {
  if (wall === 'back') {
    for (const c of [-1.1, 0.0, 1.1]) pen.box(c - 0.5, -0.8, BACK + 0.03, c + 0.5, 0.8, BACK + 0.3);
    return;
  }
  if (wall === 'front') {
    stowage(pen, -1.0, -0.5, 2, 2);
    handrail(pen, -1.6, 1.6, 0.65);
    return;
  }
  ceilingLight(pen);
}

/**
 * The cupola, in the dome's own frame (y rises from the port it sits on): a frame
 * round each side window, the round window at the top, and the robotics desk.
 */
function cupola(pen: Pen, place: RoomPlace) {
  const dome = place.frame.dome!;
  const n = place.frame.sides;
  const corner = (i: number, y: number, k: number): [number, number, number] => {
    const a = Math.PI / n + (i * 2 * Math.PI) / n;
    return [Math.cos(a) * dome.radius * k, y, Math.sin(a) * dome.radius * k];
  };
  // The sides lean in as they rise: window frames inset on each.
  for (let i = 0; i < n; i++) {
    const lo = 0.35 * dome.height;
    const hi = 0.75 * dome.height;
    const a = corner(i, lo, 0.92), b = corner(i + 1, lo, 0.92), c = corner(i + 1, hi, 0.74), d = corner(i, hi, 0.74);
    const mix = (p: number[], q: number[], t: number): [number, number, number] => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    pen.path([mix(a, b, 0.15), mix(a, b, 0.85), mix(d, c, 0.85), mix(d, c, 0.15)], true);
  }
  pen.circle(0, dome.height - 0.04, 0, dome.radius * 0.4, 'xz', 24);
  // The robotics workstation: a low desk with two hand controllers.
  pen.box(-0.6, 0.15, -0.9, 0.6, 0.3, -0.55);
  pen.seg(-0.35, 0.3, -0.72, -0.35, 0.45, -0.72).seg(0.35, 0.3, -0.72, 0.35, 0.45, -0.72);
}

// ---- Rooms with gravity: a floor to stand on, chairs and bunks. Drawn from the floor up. ----

/** A chair at (x, z) facing `yaw` (radians round y; 0 faces +z): seat, back, four legs. */
function chair(pen: Pen, x: number, z: number, yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (u: number, y: number, w: number): [number, number, number] => [x + u * c + w * s, y, z - u * s + w * c];
  const seat = [at(-0.22, 0.45, -0.22), at(0.22, 0.45, -0.22), at(0.22, 0.45, 0.22), at(-0.22, 0.45, 0.22)];
  pen.path(seat, true);
  pen.path([at(-0.22, 0.45, -0.22), at(-0.22, 0.95, -0.24), at(0.22, 0.95, -0.24), at(0.22, 0.45, -0.22)]);
  for (const p of seat) pen.seg(p[0], 0, p[2], p[0], 0.45, p[2]);
}

/** A table: top and one post with a foot. */
function table(pen: Pen, x0: number, z0: number, x1: number, z1: number, h: number) {
  pen.box(x0, h - 0.05, z0, x1, h, z1);
  const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
  pen.seg(x, 0, z, x, h - 0.05, z);
  pen.rectXZ(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 0.02);
}

/** A rack of shelves against a wall: frame and `n` shelves. */
function shelves(pen: Pen, x0: number, x1: number, z0: number, z1: number, h: number, n: number) {
  pen.box(x0, 0, z0, x1, h, z1);
  for (let i = 1; i < n; i++) pen.rectXZ(x0, z0, x1, z1, (h * i) / n);
}

function commandStanding(pen: Pen, wall: Wall) {
  if (wall === 'back') {
    // The console along the back wall, its screens above.
    pen.box(-1.6, 0, BACK + 0.25, 1.6, 0.78, BACK + 0.85);
    for (const x of [-1.2, -0.2, 0.8]) pen.rectXY(x, 1.05, x + 0.8, 1.55, BACK + 0.2).rectXY(x + 0.05, 1.1, x + 0.75, 1.5, BACK + 0.21);
    return;
  }
  if (wall === 'front') {
    pen.circle(0.6, 1.35, FRONT - 0.3, 0.3, 'xy', 20).circle(0.6, 1.35, FRONT - 0.34, 0.38, 'xy', 20);
    return;
  }
  chair(pen, -0.6, -0.55, Math.PI);
  chair(pen, 0.6, -0.55, Math.PI);
}

function labStanding(pen: Pen, wall: Wall) {
  if (wall === 'back') {
    pen.box(-2.3, 0, BACK + 0.25, 2.3, 0.92, BACK + 0.9);
    pen.box(-1.8, 0.92, BACK + 0.35, -1.1, 1.3, BACK + 0.75);
    pen.rectXY(-1.7, 1.0, -1.2, 1.2, BACK + 0.75);
    pen.box(0.4, 0.92, BACK + 0.35, 0.8, 1.15, BACK + 0.7);
    for (const x of [-2.2, -0.6, 1.0]) pen.box(x, 1.4, BACK + 0.2, x + 1.3, 1.9, BACK + 0.55);
    return;
  }
  if (wall === 'front') {
    shelves(pen, 0.9, 2.2, FRONT - 0.95, FRONT - 0.45, 1.6, 4);
    return;
  }
  // Two stools at the bench.
  for (const x of [-1.2, 0.6]) {
    pen.circle(x, 0.62, -0.75, 0.18, 'xz', 12);
    pen.seg(x, 0, -0.75, x, 0.62, -0.75);
  }
}

function medicalStanding(pen: Pen, wall: Wall) {
  if (wall === 'back') {
    pen.rectXY(-1.9, 1.1, -0.9, 1.7, BACK + 0.2).rectXY(-1.84, 1.16, -0.96, 1.64, BACK + 0.21);
    shelves(pen, 1.3, 2.4, BACK + 0.25, BACK + 0.75, 1.5, 3);
    return;
  }
  if (wall === 'front') return;
  // The examination couch, on four legs, with a raised head end.
  pen.box(-2.2, 0.62, -1.2, -0.4, 0.7, -0.45);
  pen.path([[-2.2, 0.7, -1.2], [-2.2, 0.95, -1.2], [-1.75, 0.7, -1.2]]).path([[-2.2, 0.7, -0.45], [-2.2, 0.95, -0.45], [-1.75, 0.7, -0.45]]);
  pen.seg(-2.2, 0.95, -1.2, -2.2, 0.95, -0.45);
  for (const [x, z] of [[-2.1, -1.1], [-0.5, -1.1], [-2.1, -0.55], [-0.5, -0.55]]) pen.seg(x, 0, z, x, 0.62, z);
  // A treadmill: belt, frame and the upright with its handrail.
  pen.box(0.4, 0, -1.05, 2.2, 0.18, -0.25);
  pen.rectXZ(0.5, -0.95, 2.0, -0.35, 0.18);
  pen.seg(2.15, 0.18, -1.0, 2.15, 1.1, -1.0).seg(2.15, 0.18, -0.3, 2.15, 1.1, -0.3).seg(2.15, 1.1, -1.0, 2.15, 1.1, -0.3);
  pen.seg(2.15, 1.0, -1.0, 1.6, 1.0, -1.0).seg(2.15, 1.0, -0.3, 1.6, 1.0, -0.3);
}

function airlockStanding(pen: Pen, place: RoomPlace, wall: Wall) {
  if (wall === 'back') {
    // Two suits on their stands.
    for (const x of [-0.65, 0.65]) {
      pen.at((place.x0 + place.x1) / 2 + x, floorOf(place) + 1.1, 0);
      suit(pen, 0, BACK + 0.45, BACK + 0.03);
      pen.at((place.x0 + place.x1) / 2, floorOf(place), 0);
      pen.seg(x, 0, BACK + 0.4, x, 0.05, BACK + 0.4);
    }
    return;
  }
  if (wall === 'front') return;
  // A bench, and the outer hatch on the far end wall.
  pen.box(-0.9, 0.42, -0.1, 0.9, 0.48, 0.35);
  for (const x of [-0.8, 0.8]) pen.seg(x, 0, 0.12, x, 0.42, 0.12);
  const end = (place.x1 - place.x0) / 2 - 0.03;
  pen.circle(end, 1.0, 0, 0.5, 'yz', 20).circle(end, 1.0, 0, 0.6, 'yz', 20);
}

function cabinStanding(pen: Pen, wall: Wall) {
  if (wall === 'front') {
    pen.circle(0.4, 1.25, 0.85, 0.22, 'xy', 18);
    return;
  }
  if (wall === 'back') return;
  // The bunk along the back of the cabin, its mattress and pillow, and a locker at the end.
  pen.box(-1.05, 0, BUNK_Z - 0.4, 0.85, BUNK_TOP - 0.1, BUNK_Z + 0.4);
  pen.box(-1.05, BUNK_TOP - 0.1, BUNK_Z - 0.38, 0.85, BUNK_TOP, BUNK_Z + 0.38);
  pen.box(-1.0, BUNK_TOP, BUNK_Z - 0.3, -0.7, BUNK_TOP + 0.1, BUNK_Z + 0.3);
  pen.box(0.95, 0, -0.55, 1.15, 1.6, 0.05);
}

function plainStanding(pen: Pen, wall: Wall) {
  if (wall === 'back') {
    shelves(pen, -2.0, -0.3, BACK + 0.25, BACK + 0.8, 1.7, 4);
    shelves(pen, 0.3, 2.0, BACK + 0.25, BACK + 0.8, 1.7, 4);
  }
}

/** The commons, in its dome: a table with four chairs in the middle, the kitchen counter at the far side. */
function commons(pen: Pen) {
  // An eight-sided table top on a post.
  const top: [number, number, number][] = Array.from({ length: 8 }, (_, i) => {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    return [Math.cos(a) * 0.85, 0.75, Math.sin(a) * 0.85];
  });
  pen.path(top, true);
  pen.seg(0, 0, 0, 0, 0.75, 0);
  pen.circle(0, 0.02, 0, 0.35, 'xz', 12);
  for (const a of SEATS) chair(pen, Math.cos(a) * SEAT_RADIUS, Math.sin(a) * SEAT_RADIUS, Math.atan2(-Math.cos(a), -Math.sin(a)));
  // The counter, with the food warmer and water on it.
  pen.box(-1.4, 0, -3.3, 1.4, 0.9, -2.7);
  pen.box(-1.1, 0.9, -3.2, -0.4, 1.25, -2.85);
  pen.rectXY(-1.0, 0.98, -0.5, 1.18, -2.85);
  pen.box(0.5, 0.9, -3.15, 0.75, 1.3, -2.95);
}

/** The greenhouse, in its dome: two racks of trays with seedlings, and a round planter. */
function greenhouse(pen: Pen) {
  for (const z of [-1.6, 0.9]) {
    shelves(pen, -1.5, 1.5, z, z + 0.6, 1.5, 3);
    for (let tier = 0; tier < 3; tier++) {
      const y = (1.5 * tier) / 3;
      for (let k = 0; k < 6; k++) {
        const x = -1.3 + k * 0.5;
        pen.path([[x - 0.08, y + 0.18, z + 0.3], [x, y + 0.02, z + 0.3], [x + 0.08, y + 0.18, z + 0.3]]);
      }
    }
  }
  pen.circle(2.0, 0.4, -0.3, 0.45, 'xz', 14).circle(2.0, 0, -0.3, 0.45, 'xz', 14);
  for (const a of [0, 1.3, 2.6, 3.9, 5.2]) pen.seg(2.0 + Math.cos(a) * 0.15, 0.4, -0.3 + Math.sin(a) * 0.15, 2.0 + Math.cos(a) * 0.3, 0.75, -0.3 + Math.sin(a) * 0.3);
}

/** Draw one part of a room's furniture with the pen (already set to the room's module frame). */
export function furnish(pen: Pen, place: RoomPlace, wall: Wall) {
  const cx = (place.x0 + place.x1) / 2;
  if (place.frame.dome) {
    // A dome has no near and far long walls: everything stands free.
    if (wall === 'room') {
      pen.at(0, 0, 0);
      if (place.gravity === 0) cupola(pen, place);
      else if (place.template === 'galley') commons(pen);
      else if (place.template === 'greenhouse') greenhouse(pen);
    }
    pen.at(0, 0, 0);
    return;
  }
  if (place.gravity > 0) {
    pen.at(cx, floorOf(place), 0);
    if (place.band === 'full' && wall === 'room') {
      // The raised floor, wall to wall.
      const half = (place.x1 - place.x0) / 2 - 0.03;
      pen.rectXZ(-half, -COS * R + 0.03, half, COS * R - 0.03, 0);
    }
    const standing: Partial<Record<Template, () => void>> = {
      command: () => commandStanding(pen, wall),
      lab: () => labStanding(pen, wall),
      medical: () => medicalStanding(pen, wall),
      exercise: () => medicalStanding(pen, wall),
      airlock: () => airlockStanding(pen, place, wall),
      quarters: () => (place.cabin ? cabinStanding(pen, wall) : plainStanding(pen, wall)),
    };
    (standing[place.template] ?? (() => plainStanding(pen, wall)))();
    pen.at(0, 0, 0);
    return;
  }
  pen.at(cx, 0, 0, place.band === 'lower' ? -1 : 1);
  const draw: Partial<Record<Template, () => void>> = {
    command: () => command(pen, place, wall),
    lab: () => lab(pen, wall),
    galley: () => galley(pen, wall),
    exercise: () => gym(pen, wall),
    quarters: () => (place.cabin ? quarters(pen, wall) : sleepStations(pen, wall)),
    airlock: () => airlock(pen, wall),
  };
  (draw[place.template] ?? (() => plain(pen, wall)))();
  if (place.template === 'quarters' && place.cabin && wall === 'room') {
    pen.at(cx, place.band === 'lower' ? -2.02 : 0, 0);
    sleepingBag(pen);
  }
  pen.at(0, 0, 0);
}
