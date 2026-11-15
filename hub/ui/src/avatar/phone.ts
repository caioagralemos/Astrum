// The crew avatar alone, for the iPhone app's Me screen. Same figure as
// avatar.html (same modules, unchanged), without the page around it.
// The app sets the state with window.astrum.setState({selected, marked, states, blood}):
// states names each region with something to report ('watch' or 'over') and is drawn
// with no selection too; blood draws the vessels (person/regions.ts).
// a tap on a region is posted back through the "astrum" message handler.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { createCrewAvatar } from './CrewAvatar.ts';
import type { BodyRegion } from './CrewAvatar.ts';
import { createBodySystems } from './BodySystems.ts';
import type { SystemView } from './BodySystems.ts';
import { createPoseRig, neutralPose } from './PoseRig.ts';
import { covers, createVessels, paintRegions } from '../person/regions.ts';
import type { BodyStates, RegionState } from '../person/regions.ts';

/** The phone's five regions (BodyRegion in phone/Astrum/Model/Signals.swift). */
type PhoneRegion = 'head' | 'heart' | 'lungs' | 'body' | 'blood';
interface PhoneState { selected: PhoneRegion | null; marked: PhoneRegion[]; states: BodyStates; blood: RegionState | null }
declare global {
  interface Window {
    astrum: { setState(state: Partial<PhoneState>): void };
    webkit?: { messageHandlers?: { astrum?: { postMessage(message: unknown): void } } };
  }
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000);
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, .01, 100);
camera.position.set(.68, 1.07, 3.05);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, .92, 0);
controls.enableZoom = false;
controls.enablePan = false;
controls.rotateSpeed = .5;
controls.update();
// Turning only: the tilt stays where it is, so a vertical drag can scroll the screen.
controls.minPolarAngle = controls.maxPolarAngle = controls.getPolarAngle();
const motion = () => { controls.enableDamping = !reduceMotion.matches; };
motion();
reduceMotion.addEventListener('change', motion);

const avatar = createCrewAvatar();
scene.add(avatar.root);
const systems = createBodySystems();
scene.add(systems.root);
const vesselLines = createVessels();
avatar.root.add(vesselLines.root);
createPoseRig(avatar.root, systems.root).setPose(neutralPose);

// Blood has no organ of its own: it shows the heart view's vessels without the heart.
const vessels = 0x7dabc4;
const heartParts = (systems.root.children[0]?.children ?? []).filter(object =>
  !(object instanceof LineSegments2 && (object.material as LineMaterial).color.getHex() === vessels));

const views: Record<PhoneRegion, SystemView> = { head: 'head', heart: 'heart', lungs: 'breathing', body: 'overview', blood: 'heart' };
let state: PhoneState = { selected: null, marked: [], states: {}, blood: null };
let dirty = true;

function paint() {
  const { selected, marked } = state;
  // A marked region with no state from an older app build still shows, as 'watch'.
  const states: BodyStates = { ...Object.fromEntries(marked.map((r) => [r, 'watch'])), ...state.states };
  vesselLines.set(state.blood ?? states.blood ?? null);
  systems.setView(selected ? views[selected] : 'overview');
  for (const part of heartParts) part.visible = selected !== 'blood';
  const halfView = selected === 'heart' ? 'heart' : selected === 'lungs' ? 'breathing' : null;
  for (const [part, group] of avatar.regions) group.traverse(object => {
    const isSelected = selected !== null && covers(selected, part);
    if (object instanceof THREE.Mesh) {
      const material = object.material as THREE.MeshBasicMaterial;
      material.color.setHex(isSelected ? (selected === 'heart' ? 0x30200f : 0x152b3d) : 0x030507);
      // As on the web page: the chest half over the organ in view is left open.
      const cut = part === 'chest' ? halfView : null;
      material.onBeforeCompile = shader => {
        if (!cut) return;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float regionX;').replace('#include <begin_vertex>', '#include <begin_vertex>\nregionX=position.x;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float regionX;').replace('#include <opaque_fragment>', `outgoingLight *= ${cut === 'heart' ? 'smoothstep(-0.015,0.06,regionX)' : '1.0-smoothstep(-0.06,0.015,regionX)'};\n#include <opaque_fragment>`);
      };
      material.customProgramCacheKey = () => part + (cut ?? '');
      material.needsUpdate = true;
    }
  });
  paintRegions(avatar.regions, states, (part) => {
    const isSelected = selected !== null && covers(selected, part);
    const color = selected === 'heart' ? 0xf0b65f : 0x9dcee8;
    return { color: isSelected ? color : selected === null ? 0xbfc6ce : 0x686b70, width: isSelected ? 1.8 : 1.35 };
  });
  dirty = true;
}

window.astrum = {
  setState(next) {
    state = { selected: next.selected ?? null, marked: next.marked ?? [], states: next.states ?? {}, blood: next.blood ?? null };
    paint();
  },
};
paint();

const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
function pick(event: PointerEvent): PhoneRegion | null {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(avatar.pickTargets)[0];
  const part = hit?.object.userData.region as BodyRegion | undefined;
  if (!part) return null;
  if (part === 'chest') return avatar.root.worldToLocal(hit.point.clone()).x > 0 ? 'heart' : 'lungs';
  return part === 'head' || part === 'ears' ? 'head' : 'body';
}
const down = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', event => down.set(event.clientX, event.clientY));
renderer.domElement.addEventListener('pointerup', event => {
  if (down.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) >= 5) return;
  const region = pick(event);
  if (region) window.webkit?.messageHandlers?.astrum?.postMessage({ region });
});

const resize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); dirty = true; };
addEventListener('resize', resize);
resize();
// Draws only when something changed: no idle motion, no idle work.
renderer.setAnimationLoop(() => {
  if (controls.update() || dirty) { renderer.render(scene, camera); dirty = false; }
});
addEventListener('pagehide', () => { renderer.setAnimationLoop(null); controls.dispose(); avatar.dispose(); systems.dispose(); renderer.dispose(); });
