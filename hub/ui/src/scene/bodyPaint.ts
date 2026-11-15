// The selected person's figure in the scene as the data display: each region
// with something to report takes its status colour (person/regions.ts), a
// blood finding draws the vessels inside it. Only that figure: the others keep
// the one shared line material. The coloured copies follow the shared
// material's opacity and width every frame, so dimming and "last seen" still apply.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { BodyRegion as AvatarPart } from '../avatar/CrewAvatar.ts';
import { STATE_COLOR, createVessels, partState } from '../person/regions.ts';
import type { BodyStates, RegionState } from '../person/regions.ts';

interface Painted { restore: () => void }
const painted = new WeakMap<object, Painted>();

/** Paints one figure (`null` states: back to the shared material, vessels removed). */
export function paintFigure(figure: { regions: Map<AvatarPart, THREE.Group>; material: LineMaterial }, states: BodyStates | null) {
  painted.get(figure)?.restore();
  painted.delete(figure);
  if (!states || Object.keys(states).length === 0) return;
  const base = figure.material;
  const undo: (() => void)[] = [];
  const follow = (line: LineSegments2, material: LineMaterial, widen: number) => {
    const own = line.onBeforeRender;
    line.onBeforeRender = function (...args) {
      material.opacity = base.opacity;
      material.linewidth = base.linewidth * widen;
      own.apply(this, args);
    };
    undo.push(() => { line.onBeforeRender = own; });
  };
  const copies = new Map<RegionState, LineMaterial>();
  const copy = (state: RegionState) => {
    let m = copies.get(state);
    if (!m) { m = base.clone(); m.color.setHex(STATE_COLOR[state]); copies.set(state, m); }
    return m;
  };
  // The rest of the body in the scene's plain line colour, not the status tint the whole
  // figure otherwise takes, so the coloured region is the one that reads.
  let plain: LineMaterial | null = null;
  const neutral = () => {
    if (!plain) {
      plain = base.clone();
      plain.color.set(getComputedStyle(document.documentElement).getPropertyValue('--scene-line').trim() || '#f2f3f5');
    }
    return plain;
  };
  for (const [part, group] of figure.regions) {
    const state = partState(states, part);
    group.traverse((object) => {
      if (!(object instanceof LineSegments2) || object.material !== base) return;
      const material = state ? copy(state) : neutral();
      object.material = material;
      follow(object, material, state ? 1.35 : 1);
      undo.push(() => { object.material = base; });
    });
  }
  // The vessels were built into the figure (build.ts), posed with it.
  const root = figure.regions.values().next().value?.parent;
  const vessels = root?.children.find((o) => o.userData.vessels)?.userData.vessels as ReturnType<typeof createVessels> | undefined;
  if (states.blood && vessels) {
    vessels.set(states.blood);
    vessels.root.renderOrder = 3;
    const material = vessels.root.material as LineMaterial;
    const own = vessels.root.onBeforeRender;
    vessels.root.onBeforeRender = function (...args) {
      material.opacity = base.opacity * 0.8;
      material.linewidth = base.linewidth;
      own.apply(this, args);
    };
    undo.push(() => { vessels.root.onBeforeRender = own; vessels.set(null); });
  }
  painted.set(figure, {
    restore() {
      undo.forEach((u) => u());
      copies.forEach((m) => m.dispose());
      (plain as LineMaterial | null)?.dispose();
    },
  });
}
