// The short way to author a move: `gesture(world, spec)` builds a looping clip
// of one or two figures (or more), with optional props, contact rings and
// arrows, a floor line with gravity and a slight drift without it, and a
// camera framed to whatever box the stage is in (square by default). See
// AUTHORING.md for the format and a worked example.
//
// The interface here is stable: authors write against GestureSpec, Prop and
// the helpers re-exported below, and they keep working as the rig improves.

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Character } from './cast.ts';
import type { Moves } from './cast.ts';
import type { Figure } from './rig.ts';
import { Pen } from './ship/pen.ts';
import { ACTOR, OTHER, seam } from './step.ts';
import type { Clip, Gravity } from './step.ts';
import { Arrow, Contact } from './world.ts';
import type { World } from './world.ts';

export { cycle, track, ramp, smooth, mix, clamp01, sample1 } from './anim.ts';
export { reach, plant, palmOf, NEUTRAL, ANKLE_HEIGHT } from './cast.ts';
export type { Moves } from './cast.ts';
export { PELVIS, CHEST, HEAD, UPPER, FORE, HAND, THIGH, SHIN, FOOT, STERNUM_Y, STERNUM_Z, COM_HEIGHT, restJoint } from './rig.ts';
export type { Figure } from './rig.ts';

type V3 = [number, number, number];

/** A simple object drawn in lines (a fan, a mask, pads, a cloth, a stretcher, a door), placed each frame. */
export class Prop {
  readonly object = new THREE.Group();
  private readonly material: LineMaterial;
  private readonly fill: THREE.MeshBasicMaterial;
  private readonly tmp = new THREE.Vector3();

  /**
   * `draw` draws the prop with a pen in its own frame (metres). `boxes` are solid blocks in the
   * background colour, [x0, y0, z0, x1, y1, z1], so a prop hides what is behind it like a figure does.
   */
  constructor(world: World, draw: (pen: Pen) => void, options: { strength?: number; width?: number; boxes?: [number, number, number, number, number, number][] } = {}) {
    const pen = new Pen();
    draw(pen);
    this.material = world.line(options.width ?? 1.8, options.strength ?? 0.85);
    this.material.transparent = true;
    const lines = pen.lines(this.material);
    lines.frustumCulled = false;
    lines.renderOrder = 2;
    this.object.add(lines);
    this.fill = new THREE.MeshBasicMaterial({ color: world.bg, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4, transparent: true });
    for (const [x0, y0, z0, x1, y1, z1] of options.boxes ?? []) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), this.fill);
      box.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      this.object.add(box);
    }
  }

  /** Put it at a point, turned by Euler angles (radians, order YXZ: yaw, pitch, roll). */
  at(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): this {
    this.object.position.set(x, y, z);
    this.object.rotation.set(pitch, yaw, roll, 'YXZ');
    return this;
  }

  /** Carry it with a bone of a figure: `offset` and `turn` in that bone's rest frame (relative to its joint). */
  follow(fig: Figure, bone: number, offset: V3 = [0, 0, 0], turn?: THREE.Quaternion): this {
    fig.point(bone, offset[0], offset[1], offset[2], this.tmp);
    this.object.position.copy(this.tmp);
    this.object.quaternion.copy(fig.q[bone]);
    if (turn) this.object.quaternion.multiply(turn);
    return this;
  }

  /** How present it is (0 to 1), for showing a prop only part of the loop. Set it in `act`; it is kept until changed. */
  shown = 1;

  /** Applied by the gesture after `act`: presence times the round's own fade at the seam. */
  apply(fade: number) {
    const a = this.shown * fade;
    this.object.visible = a > 0.01;
    this.material.opacity = a;
    this.fill.opacity = a;
    this.fill.depthWrite = a > 0.5;
  }
}

/** What a gesture's `act` gets for marking contacts and directions (only for the round on screen). */
export interface Marks {
  contacts: Contact[];
  arrows: Arrow[];
}

export interface GestureSpec {
  /** One loop, in seconds (her spec: about 3). */
  duration: number;
  /**
   * 'cycle' (default): every track is built with `cycle(keys, duration)` and returns to where it
   * started, so the loop is seamless by construction. 'seam': the action does not return (someone
   * walks out); the last half second dissolves into the next round, which is already moving.
   */
  loop?: 'cycle' | 'seam';
  gravity: Gravity;
  /** The people. The first with role 'actor' is drawn at full strength; the others quieter. */
  cast: { moves: Moves; role?: 'actor' | 'other' }[];
  /** Props, made once per round on screen (twice with 'seam'). */
  props?: (world: World) => Prop[];
  /** How many contact rings and arrows `act` may show. */
  marks?: { contacts?: number; arrows?: number };
  /**
   * Called every frame after the tracks have posed and solved everyone: lay contacts (reach,
   * plant), place props, show marks. The rig is solved again after it. `marks` is null for the
   * next round fading in over a 'seam'.
   */
  act?: (t: number, figs: Figure[], props: Prop[], marks: Marks | null) => void;
  /** The camera: looks at `target` from yaw (round from +z) and pitch, fitting `extent` metres high and `span` wide. */
  camera: { target: V3; yaw: number; pitch: number; extent: number; span?: number };
  /** Gravity: draw the floor line (default true). Weightless: drift slightly (default true). */
  floor?: boolean;
  drift?: boolean;
  /** Key poses for reduced motion (loop times). */
  keys?: number[];
}

const target = new THREE.Vector3();

/**
 * For inspecting a move from other sides while authoring (the viewer's `&cam=yaw,pitch[,extent[,x,y,z]]`):
 * replaces the move's camera angle, and its extent and target when given. Never used for a loop that ships.
 */
export const CAMERA_OVERRIDE: { yaw?: number; pitch?: number; extent?: number; target?: V3 } = {};

export function gesture(world: World, spec: GestureSpec): Clip {
  const group = new THREE.Group();
  const stage = new THREE.Group();
  group.add(stage);
  const T = spec.duration;
  const seamed = spec.loop === 'seam';
  const look = { ink: world.ink, bg: world.bg };
  const rounds = (seamed ? [0, 1] : [0]).map(() => {
    const chars = spec.cast.map((c) => {
      const ch = new Character(look, c.moves);
      ch.fig.addTo(stage);
      return ch;
    });
    const props = spec.props?.(world) ?? [];
    for (const p of props) stage.add(p.object);
    return { chars, figs: chars.map((c) => c.fig), props };
  });
  const marks: Marks = {
    contacts: Array.from({ length: spec.marks?.contacts ?? 0 }, () => new Contact(world, stage)),
    arrows: Array.from({ length: spec.marks?.arrows ?? 0 }, () => new Arrow(world, stage, 1.6)),
  };
  if (spec.gravity === 'gravity' && spec.floor !== false) {
    const pen = new Pen();
    const [cx, , cz] = spec.camera.target;
    const half = Math.max(1.4, (spec.camera.span ?? spec.camera.extent) * 0.6);
    pen.seg(cx - half, 0, cz, cx + half, 0, cz);
    pen.rectXZ(cx - half, cz - 1.0, cx + half, cz + 1.0, 0);
    const floor = pen.lines(world.line(1.25, 0.26));
    floor.frustumCulled = false;
    stage.add(floor);
  }
  const roles = spec.cast.map((c, i) => c.role ?? (i === 0 ? 'actor' : 'other'));

  const play = (r: (typeof rounds)[number], t: number, alpha: number, m: Marks | null) => {
    for (const c of r.chars) { c.pose(t); c.fig.solve(); }
    if (spec.act) spec.act(t, r.figs, r.props, m);
    for (let i = 0; i < r.chars.length; i++) {
      const f = r.chars[i].fig;
      f.solve();
      f.draw();
      const s = roles[i] === 'actor' ? ACTOR : OTHER;
      f.style(s.strength, s.width, alpha);
    }
    for (const p of r.props) p.apply(alpha);
  };

  return {
    duration: T,
    keys: spec.keys ?? [0, T / 3, (2 * T) / 3],
    ship: false,
    group,
    tags: [],
    frame(u, still) {
      const wave = Math.sin((u / T) * Math.PI * 2);
      const { span } = spec.camera;
      const tg = CAMERA_OVERRIDE.target ?? spec.camera.target;
      const yaw = CAMERA_OVERRIDE.yaw ?? spec.camera.yaw;
      const pitch = CAMERA_OVERRIDE.pitch ?? spec.camera.pitch;
      const extent = CAMERA_OVERRIDE.extent ?? spec.camera.extent;
      target.set(tg[0], tg[1], tg[2]);
      world.frame(target, yaw + (still ? 0 : 0.02 * wave), pitch, extent, 30, 0, CAMERA_OVERRIDE.extent ?? span ?? extent);
      world.depth(3, 12);
      // Weightless: the whole scene drifts a little, on a path that closes every loop.
      if (spec.gravity === 'weightless' && spec.drift !== false && !still) {
        stage.position.set(0.025 * wave, 0.018 * Math.sin((u / T) * Math.PI * 2 + 1.2), 0);
        stage.rotation.z = 0.012 * Math.sin((u / T) * Math.PI * 2 + 0.6);
      } else {
        stage.position.set(0, 0, 0);
        stage.rotation.z = 0;
      }
      const k = seamed && !still ? seam(u, T) : 0;
      for (const c of marks.contacts) c.show(target, 0, 0);
      for (const a of marks.arrows) a.show(target, target, 0, 0);
      play(rounds[0], u, 1 - k, marks);
      if (seamed) {
        if (k > 0) play(rounds[1], u - T, k, null);
        else {
          for (const f of rounds[1].figs) f.style(1, 1, 0);
          for (const p of rounds[1].props) p.apply(0);
        }
      }
    },
  };
}
