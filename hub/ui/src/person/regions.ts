// The body as the data display: which signals belong to which region of the
// figure, a region's state from real readings and open alerts only, and how a
// figure is painted with it (region lines in the status colour, and a
// schematic vessel network when a blood result is outside the range).
//
// The signal table mirrors the phone's (phone/Astrum/Model/Signals.swift,
// Signals.signals(in:) and AlertText.region(ofCard:)): the two must change
// together. The phone's avatar page (avatar/phone.ts) paints with the same code.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { BodyRegion as AvatarPart } from '../avatar/CrewAvatar.ts';

export type BodyRegion = 'head' | 'heart' | 'lungs' | 'body' | 'blood';
export const REGIONS: BodyRegion[] = ['head', 'heart', 'lungs', 'body', 'blood'];

export const REGION_SIGNALS: Record<BodyRegion, string[]> = {
  head: ['sleep_duration', 'sleep_efficiency', 'sleep_awakenings', 'checkin.headache', 'checkin.mood',
    'checkin.stress', 'checkin.fatigue', 'mood.stress', 'mood.fatigue', 'mood.sleepy'],
  heart: ['heart_rate', 'resting_heart_rate', 'hrv', 'blood_pressure_systolic', 'blood_pressure_diastolic'],
  lungs: ['breathing_rate', 'respiratory_rate', 'blood_oxygen', 'co2'],
  body: ['exercise_minutes', 'steps', 'active_energy', 'body_temperature', 'sound_level'],
  blood: [],
};

/** A card's region (AlertText.region(ofCard:) on the phone). */
const CARD_REGION: Record<string, BodyRegion> = { 'high-co2': 'lungs', 'low-oxygen': 'lungs', headache: 'head' };

export function regionOf(signal: string): BodyRegion | null {
  if (signal.startsWith('blood.')) return 'blood';
  return REGIONS.find((r) => REGION_SIGNALS[r].includes(signal)) ?? null;
}

/** The region an open alert belongs to: its card's, the air of a room is Lungs, else its signal's. */
export function regionOfAlert(alert: { reason: string; signal: string; card?: string | null }): BodyRegion | null {
  if (alert.card) return CARD_REGION[alert.card] ?? null;
  return alert.reason === 'room-limit' ? 'lungs' : regionOf(alert.signal);
}

/** Watch: unusual, outside a range, or an alert below level 3. Over: a level 3 alert. */
export type RegionState = 'watch' | 'over';
/** The status tokens of app.css (--status-watch, --status-over), as numbers for the figure. */
export const STATE_COLOR: Record<RegionState, number> = { watch: 0xf2c14e, over: 0xff5a4a };
export const worse = (a: RegionState | undefined, b: RegionState): RegionState => (a === 'over' || b === 'over' ? 'over' : 'watch');

/** The figure's parts each region is drawn on. Heart and lungs share the chest; blood is the vessels. */
export function covers(region: BodyRegion, part: AvatarPart) {
  switch (region) {
    case 'head': return part === 'head' || part === 'ears';
    case 'heart': case 'lungs': return part === 'chest';
    case 'body': return part === 'pelvis' || part.endsWith('Arm') || part.endsWith('Leg');
    case 'blood': return false;
  }
}

export type BodyStates = Partial<Record<BodyRegion, RegionState>>;

/** The state a figure part is drawn in: the worst of the regions that cover it. */
export function partState(states: BodyStates, part: AvatarPart): RegionState | null {
  let state: RegionState | null = null;
  for (const region of REGIONS) {
    const s = states[region];
    if (s && covers(region, part)) state = worse(state ?? undefined, s);
  }
  return state;
}

// Schematic, not anatomy: from the heart a trunk down to the hips, one line
// down each arm and leg, and a small loop at the heart. Metres, feet at y = 0,
// in the crew avatar's neutral pose (avatar/CrewAvatar.ts).
const VESSEL_PATHS: [number, number][][] = [
  [[0.0, 1.40], [0.0, 1.22], [0.0, 1.05], [0.0, 0.96]],
  [[0.0, 1.40], [0.0, 1.50], [0.0, 1.58]],
  [[0.0, 1.38], [-0.12, 1.39], [-0.2, 1.34], [-0.25, 1.1], [-0.29, 0.92], [-0.315, 0.74]],
  [[0.0, 1.38], [0.12, 1.39], [0.2, 1.34], [0.25, 1.1], [0.29, 0.92], [0.315, 0.74]],
  [[0.0, 0.96], [-0.07, 0.9], [-0.09, 0.72], [-0.105, 0.5], [-0.112, 0.3], [-0.118, 0.1]],
  [[0.0, 0.96], [0.07, 0.9], [0.09, 0.72], [0.105, 0.5], [0.112, 0.3], [0.118, 0.1]],
];

/** The vessel network, hidden until a blood result is outside the range. */
export function createVessels() {
  const points: number[] = [];
  const smooth = (path: [number, number][]) => new THREE.CatmullRomCurve3(path.map(([x, y]) => new THREE.Vector3(x, y, 0.01))).getPoints(path.length * 6);
  const add = (pts: THREE.Vector3[]) => { for (let i = 1; i < pts.length; i++) points.push(...pts[i - 1].toArray(), ...pts[i].toArray()); };
  for (const path of VESSEL_PATHS) add(smooth(path));
  // The loop at the heart, a little left of centre where the heart sits.
  const loop: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; loop.push(new THREE.Vector3(0.04 + Math.cos(a) * 0.035, 1.31 + Math.sin(a) * 0.045, 0.01)); }
  add(loop);
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(points);
  // Drawn after the figure's dark faces, so it reads as inside the body; thinner than the outline.
  const material = new LineMaterial({ color: STATE_COLOR.watch, linewidth: 1.1, depthTest: false, transparent: true, opacity: 0.75 });
  const lines = new LineSegments2(geometry, material);
  lines.renderOrder = 0.5;
  lines.visible = false;
  return {
    root: lines,
    set(state: RegionState | null) {
      lines.visible = state !== null;
      if (state) material.color.setHex(STATE_COLOR[state]);
    },
    dispose() { geometry.dispose(); material.dispose(); lines.removeFromParent(); },
  };
}

/** Paints a crew avatar's outlines: a coloured region in its state's colour, slightly heavier; the rest in `base`. */
export function paintRegions(regions: Map<AvatarPart, THREE.Group>, states: BodyStates, base: (part: AvatarPart) => { color: number; width: number }) {
  for (const [part, group] of regions) {
    const state = partState(states, part);
    const { color, width } = base(part);
    group.traverse((object) => {
      if (!(object instanceof LineSegments2)) return;
      const material = object.material as LineMaterial;
      material.color.setHex(state ? STATE_COLOR[state] : color);
      material.linewidth = state ? Math.max(width, 1.35) + 0.45 : width;
    });
  }
}
