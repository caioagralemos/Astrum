// What is inside each kind of room, drawn in outline so a room can be told at a
// glance: the command deck's console and windscreen, the lab's racks and bench,
// the galley's table and lockers, the gym's treadmill and cycle, a cabin's
// sleeping bag. Everything is made for weightlessness: nothing to sit on, no
// bunks, only foot bars, straps and harnesses. A few lines, not clutter.
//
// Measurements are in metres from the room's middle along the station, from
// the module's axis in height, and from the axis in depth (the back wall is at
// z = -COS * R, the front wall at z = COS * R).
//
// The station is a cutaway from either side: whichever long wall faces the
// viewer is left out, and the far one stays. So each room is drawn in three
// parts: what hangs on the back wall, what hangs on the front wall, and what
// stands free in the room. The view shows only the far wall's part.

import { COS, R, SIN, radiusAt } from './layout.ts';
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

/** Draw one part of a room's furniture with the pen. */
export function furnish(pen: Pen, place: RoomPlace, wall: Wall) {
  const cx = (place.x0 + place.x1) / 2;
  pen.at(cx, 0, 0, place.band === 'lower' ? -1 : 1);
  const draw: Record<Template, () => void> = {
    command: () => command(pen, place, wall),
    lab: () => lab(pen, wall),
    galley: () => galley(pen, wall),
    gym: () => gym(pen, wall),
    quarters: () => quarters(pen, wall),
  };
  draw[place.template]();
  if (place.template === 'quarters' && wall === 'room') {
    pen.at(cx, place.band === 'lower' ? -2.02 : 0, 0);
    sleepingBag(pen);
  }
  pen.at(0, 0, 0);
}
