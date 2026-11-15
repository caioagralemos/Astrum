// Moves: the reusable pieces a steps card is assembled from. A move is a named,
// parameterised, looping action of one or two crew figures with its own
// staging (camera, the marks on points of contact). It may come in two
// variants: weightless (in orbit, in transit) and with gravity (on a surface);
// a move without one of them says so (`variants` simply lacks it).
//
// A move is authored once in a reference place (a cabin, the galley, a floor)
// and placed by its parameters: rooms are looked up in the ship's layout, and
// the move's whole drawing is carried there by its group's position, so a move
// written in Quarters 2 plays the same in Quarters 4.
//
// This file also holds what moves share: the two looks of a figure (the one
// acting, everyone else quieter), the loop's seam, and name labels.

import * as THREE from 'three';
import { Character } from './cast.ts';
import type { Moves } from './cast.ts';
import type { World } from './world.ts';
import { ramp } from './anim.ts';

export type Gravity = 'weightless' | 'gravity';

export interface Tag {
  text: string;
  kind: 'person' | 'room';
  /** Where it points, in the world. */
  at: THREE.Vector3;
  shown: number;
}

/** One playable instance of a move: its loop, drawn into the world on demand. */
export interface Clip {
  /** Length of one loop, in seconds. */
  duration: number;
  /** Key poses (loop times) to step through on demand under reduced motion. */
  keys: number[];
  /** Whether the ship is drawn behind it. */
  ship: boolean;
  group: THREE.Group;
  tags: Tag[];
  /** Draw loop time u (0 to duration). `still`: no camera drift (reduced motion, key poses). */
  frame(u: number, still: boolean): void;
}

/** Parameters a card gives a move: room ids, who is who. Each move documents its own. */
export type Params = Record<string, string | number | undefined>;

export interface Move {
  /** The medical lead's ID (V01 …), when the move is on her list. */
  id?: string;
  /** The name: her file name without .mp4 (V05-leave-the-room), or a story move's name. */
  name: string;
  /** What it shows, in plain words (not how to do anything medical). */
  summary: string;
  /** The parameters it takes, with their defaults. */
  params: Params;
  variants: Partial<Record<Gravity, (world: World, params: Params) => Clip>>;
  /** Medical content that needs the medical lead's review and a cited source. */
  medical: boolean;
  /** Approved by the medical lead after watching it. Until then the viewer says "not yet reviewed". */
  reviewed: boolean;
  /** Where any medical detail beyond her one-line description comes from (cited), if anywhere. */
  source?: string;
  /** What was left out because it needs her answer (also in QUESTIONS-FOR-MEDICAL-LEAD.md). */
  questions?: string[];
}

/** A step on a card: the move to show, its parameters, and the instruction text (the medical lead's). */
export interface CardStep {
  move: string;
  gravity: Gravity;
  params?: Params;
  title: string;
  line: string;
}

/** How long the seam's dissolve lasts at the end of a loop, in seconds. */
export const SEAM = 0.5;

/** The figure acting (full strength) and the others (quieter). */
export const ACTOR = { strength: 1, width: 2.4 };
export const OTHER = { strength: 0.62, width: 1.7 };

/**
 * A person drawn twice: once for this round of the loop and once for the next, which fades in
 * over the seam already moving (its tracks run on before their first key at the same speed).
 */
export class Pair {
  readonly now: Character;
  readonly next: Character;
  constructor(world: World, moves: Moves, group: THREE.Group) {
    const look = { ink: world.ink, bg: world.bg };
    this.now = new Character(look, moves);
    this.next = new Character(look, moves);
    this.now.fig.addTo(group);
    this.next.fig.addTo(group);
  }
}

/** The seam: how far into the dissolve loop time u is (0 before it, 1 at the loop's end). */
export function seam(u: number, duration: number): number {
  return ramp(u, duration - SEAM, duration);
}

export function tag(text: string, kind: 'person' | 'room'): Tag {
  return { text, kind, at: new THREE.Vector3(), shown: 1 };
}

/** Name label over a figure's head, in the world (the figure is drawn in its move's group). */
export function headTag(t: Tag, fig: { restPoint: (b: number, x: number, y: number, z: number, out: THREE.Vector3) => THREE.Vector3 }, group: THREE.Object3D, shown: number) {
  fig.restPoint(2, 0, 1.93, 0, t.at);
  t.at.add(group.position);
  t.shown = shown;
}
