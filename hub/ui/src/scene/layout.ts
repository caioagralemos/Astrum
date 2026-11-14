// Where each room sits on the station, and the shape every module shares.
//
// The station is one line of eight-sided modules along X, nose at -X, engines
// at +X. Y is up, Z points at the viewer. The hull is whole; it reads as a
// cutaway because a wall is only drawn when seen from inside, so whichever
// side the viewer is on, the near walls open and the room behind shows.

export type Template = 'command' | 'lab' | 'galley' | 'gym' | 'quarters';

/** Which part of a module's height a room takes: all of it, or the upper or lower cabin. */
export type Band = 'full' | 'upper' | 'lower';

export interface RoomPlace {
  id: string;
  template: Template;
  /** Where the room starts and ends along the station, in metres. */
  x0: number;
  x1: number;
  band: Band;
  /** Hull radius at each end; they differ only where the hull tapers. */
  r0: number;
  r1: number;
}

/** Radius of the main modules (to the corners of the octagon). */
export const R = 2.2;
export const COS = Math.cos(Math.PI / 8);
export const SIN = Math.sin(Math.PI / 8);

export const PLACES: RoomPlace[] = [
  { id: 'command', template: 'command', x0: -12.5, x1: -9, band: 'full', r0: 0.62 * R, r1: R },
  { id: 'lab', template: 'lab', x0: -9, x1: -4, band: 'full', r0: R, r1: R },
  { id: 'galley', template: 'galley', x0: -4, x1: 1, band: 'full', r0: R, r1: R },
  { id: 'gym', template: 'gym', x0: 1, x1: 5.5, band: 'full', r0: R, r1: R },
  // The crew quarters: four cabins in one module, two either side of a deck.
  { id: 'quarters-1', template: 'quarters', x0: 5.5, x1: 7.9, band: 'upper', r0: R, r1: R },
  { id: 'quarters-2', template: 'quarters', x0: 5.5, x1: 7.9, band: 'lower', r0: R, r1: R },
  { id: 'quarters-3', template: 'quarters', x0: 7.9, x1: 10.3, band: 'upper', r0: R, r1: R },
  { id: 'quarters-4', template: 'quarters', x0: 7.9, x1: 10.3, band: 'lower', r0: R, r1: R },
];

/** The short engine section behind the quarters. */
export const AFT = { x0: 10.3, x1: 11.2, r0: R, r1: 0.7 * R };

/**
 * The points the default view has to fit: the nose, the hull, the engines,
 * the ends of the solar arrays and the antenna, as [x, y, z].
 */
export const OUTLINE: [number, number, number][] = [
  ...[[-12.5, 0.62 * R], [-9, R], [10.3, R], [11.2, 0.7 * R]].flatMap(([x, r]) => section(r, 'full').map(([y, z]): [number, number, number] => [x, y, z])),
  [12.7, 1.4, -0.35], [12.7, -1.4, -0.35],
  ...[5.3, -5.3].flatMap((y): [number, number, number][] => [[-4.4, y, -1.9], [1.5, y, -3.7]]),
  [8.6, COS * R + 1.8, -0.35],
];

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

/** Top and bottom of a room's height band, at hull radius r. */
export function bandEdges(r: number, band: Band): [number, number] {
  if (band === 'upper') return [COS * r, 0];
  if (band === 'lower') return [0, -COS * r];
  return [COS * r, -COS * r];
}

export function centreOf(place: RoomPlace): [number, number, number] {
  const r = Math.max(place.r0, place.r1);
  const [top, bottom] = bandEdges(r, place.band);
  return [(place.x0 + place.x1) / 2, (top + bottom) / 2, -0.3];
}

/**
 * Where the nth of `count` people floats in a room, as an offset from the
 * room's centre. Spread across the length and staggered in height so their
 * name tags have room.
 */
const SPREAD: [number, number, number][][] = [
  [[0, 0.05, 0.1]],
  [[-0.42, 0.12, 0.1], [0.42, -0.08, -0.2]],
  [[-0.75, -0.3, 0.1], [0, 0.4, -0.15], [0.75, -0.2, 0.15]],
  [[-0.85, -0.5, 0.15], [-0.3, 0.45, -0.15], [0.3, -0.5, 0.1], [0.85, 0.42, -0.1]],
];

export function slot(place: RoomPlace, index: number, count: number): [number, number, number] {
  const [x, y, z] = centreOf(place);
  if (place.template === 'quarters') {
    // A cabin is small: one person floats by the door, a second beside them.
    return [x + (index === 0 ? 0.3 : -0.55), y + (place.band === 'upper' ? 0.05 : -0.05), 0.0];
  }
  const pattern = SPREAD[Math.min(count, SPREAD.length) - 1];
  const [u, v, w] = pattern[index % pattern.length];
  const half = (place.x1 - place.x0) / 2 - 0.5;
  return [x + u * half, y + v * 1.6 - 0.1, w];
}

/** Where a cabin's sleeper is drawn: inside the bag on the far end wall, head up. */
export function bedOf(place: RoomPlace): [number, number, number] {
  return [place.x1 - 0.2, place.band === 'lower' ? -1.0 : 1.02, -0.65];
}
