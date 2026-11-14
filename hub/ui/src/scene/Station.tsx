// The station view: every room and who is in it, drawn as a cut-open line
// drawing of the spacecraft.
//
// What matters is drawn at full strength: the crew, with their names above
// them, and each room's light, which shows its status (blue good, yellow alert,
// red danger, grey no reading). Hull and furniture sit at half
// strength. Drag to turn it, pinch or scroll to zoom, tap a room or a person
// to look closer; tap it again, or "Whole station", to go back.
//
// The names and room labels are real buttons laid over the drawing, so the
// view works with a keyboard and a screen reader, and status is always written
// in words as well as shown in colour. With reduced motion nothing bobs or
// pulses and the camera jumps instead of gliding.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { buildShip } from './build.ts';
import type { Ship } from './build.ts';
import { readDemo } from './demo.ts';
import { createBackdrop } from './backdrop.ts';
import type { Backdrop } from './backdrop.ts';
import { COS, OUTLINE, PLACES, bandEdges, bedOf, centreOf, radiusAt, slot } from './layout.ts';
import type { Status } from '../../../engine/status.ts';
import type { Person, Room } from '../../../engine/types.ts';

export interface StationProps {
  rooms: Room[];
  crew: Person[];
  /** Room id for each person, if known. */
  where: Record<string, string>;
  roomStatus: Record<string, Status>;
  personStatus: Record<string, Status>;
  /** Crew ids asleep now: drawn still, in their sleeping bag. */
  asleep: string[];
  s: (key: string, vars?: Record<string, string | number>) => string;
  selected: Selection;
  onSelect: (selection: Selection) => void;
}

export type Selection = { kind: 'room' | 'person'; id: string } | null;

const FOV = 30;
/** The default view: a little from the nose side and a little from above, like the concept drawing. */
const YAW = -0.24;
const PITCH = 0.2;
const FALLBACK: Record<Status, string> = { ok: '#4fd18b', watch: '#f2c14e', over: '#ff5a4a', unknown: '#5b9dff' };
/** How strongly each status lights its room, and its people. */
const ROOM_LIGHT: Record<Status, number> = { ok: 0.02, unknown: 0.026, watch: 0.11, over: 0.32 };
const HALO: Record<Status, number> = { ok: 0, unknown: 0, watch: 0.14, over: 0.3 };

function cssColour(name: string, fallback: string): THREE.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(value || fallback);
}

/** A label laid over the drawing, and where it was put on the last frame. */
interface Tag {
  key: string;
  kind: 'person' | 'room';
  id: string;
  el: HTMLButtonElement;
  /** Button size, and the visible pill inside it. */
  w: number;
  h: number;
  pw: number;
  ph: number;
  x: number;
  y: number;
  /** Which way it moves out of another label's way. */
  dx: number;
  dy: number;
  depth: number;
  show: boolean;
  shown: boolean;
  lastX: number;
  lastY: number;
  box: [number, number, number, number];
}

interface State {
  ship: Ship;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  portrait: boolean;
  /** Where the camera is gliding to, if anywhere. */
  goal: { position: THREE.Vector3; target: THREE.Vector3; active: boolean };
  /** The viewer has turned or zoomed the view themselves since it was last framed. */
  moved: boolean;
  aim: (selection: Selection) => void;
  backdrop: Backdrop;
}

/** Applies the page-address development switches (see demo.ts) over the real data. */
function withDemo(props: StationProps, demo: ReturnType<typeof readDemo>) {
  if (!demo) return props;
  const ids = props.crew.map((p) => p.id);
  const where = { ...props.where };
  for (const [who, room] of Object.entries(demo.where)) for (const id of who === '*' ? ids : [who]) where[id] = room;
  const asleep = demo.asleep === '*' ? ids : demo.asleep ?? props.asleep;
  const roomStatus = { ...props.roomStatus };
  const personStatus = { ...props.personStatus };
  for (const [id, status] of Object.entries(demo.status)) {
    if (ids.includes(id)) personStatus[id] = status;
    else roomStatus[id] = status;
  }
  return { ...props, where, asleep, roomStatus, personStatus };
}

export function Station(raw: StationProps) {
  const demo = useMemo(readDemo, []);
  const props = withDemo(raw, demo);
  const { rooms, crew, where, roomStatus, personStatus, asleep, s, selected, onSelect } = props;
  const holder = useRef<HTMLDivElement>(null);
  const built = useRef<State | null>(null);
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const tags = useRef<Tag[]>([]);
  const latest = useRef(props);
  latest.current = props;
  /** The selected label's key, kept ready for the frame loop. */
  const chosen = useRef('');
  chosen.current = props.selected ? `${props.selected.kind}:${props.selected.id}` : '';
  const [failed, setFailed] = useState(false);

  // Full screen: the browser's own where it has one; elsewhere (the iPhone's web view)
  // the station covers the window. Escape leaves either way.
  const [full, setFull] = useState(false);
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === holder.current && holder.current !== null);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    if (!full || document.fullscreenElement) return;
    const leave = (event: KeyboardEvent) => { if (event.key === 'Escape') setFull(false); };
    document.addEventListener('keydown', leave);
    return () => document.removeEventListener('keydown', leave);
  }, [full]);
  const toggleFull = () => {
    const el = holder.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (full) setFull(false);
    else if (document.fullscreenEnabled) el.requestFullscreen().catch(() => setFull(true));
    else setFull(true);
  };
  const places = useMemo(() => PLACES.filter((place) => rooms.some((r) => r.id === place.id)), [rooms]);
  const crewKey = crew.map((p) => p.id).join(',');

  // Build the scene once (again only if the rooms or crew change).
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    // Depth fade: lines thin out into the background the further they are from the viewer.
    // Its range follows the camera (see the frame loop), so it reads the same at any zoom.
    const fog = new THREE.Fog(cssColour('--bg', '#0b0c0e'), 10, 40);
    scene.fog = fog;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 2.5;
    controls.maxDistance = 70;

    const ink = cssColour('--scene-line', '#f2f3f5');
    const bg = cssColour('--bg', '#0b0c0e');
    const ship = buildShip(scene, places, crew.map((p) => p.id), ink, bg);
    const { root } = ship;
    (ship.stars.material as THREE.PointsMaterial).size = 1.5 * renderer.getPixelRatio();

    const rootInverse = new THREE.Quaternion();
    const dir = new THREE.Vector3();
    const state: State = {
      ship, camera, controls, portrait: false, moved: false,
      backdrop: createBackdrop(scene, renderer, camera, root, demo?.grid ?? null),
      goal: { position: new THREE.Vector3(), target: new THREE.Vector3(), active: false },
      aim: () => {},
    };

    // Frame a set of points (in station coordinates) so they fill `fill` of the view, seen from
    // the default angle (or the viewer's own, once they have one). A scratch camera measures where the box's corners land and corrects twice,
    // so perspective (the nearer nose looks bigger) does not push the drawing off centre.
    const scratch = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
    const corner = new THREE.Vector3();
    const right = new THREE.Vector3();
    const upward = new THREE.Vector3();
    // Once the camera is placed, going closer (or back out) keeps the angle the viewer chose:
    // the near walls open from any side, so there is no need to swing round.
    let keep = false;
    /** Set when the station is stood up or laid down: the old angle no longer means anything. */
    let reframe = true;
    /** Whether the viewer has turned the station themselves; until then, the drawn angles are used. */
    let turned = false;
    const current = new THREE.Vector3();
    const fit = (points: THREE.Vector3[], fill: number, yaw = YAW, pitch = PITCH) => {
      scratch.aspect = camera.aspect;
      scratch.updateProjectionMatrix();
      if (keep) dir.copy(current);
      else dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).applyQuaternion(root.quaternion);
      const target = state.goal.target.set(0, 0, 0);
      for (const p of points) target.add(p);
      root.localToWorld(target.divideScalar(points.length));
      let distance = 30;
      const half = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      for (let pass = 0; pass < 4; pass++) {
        scratch.position.copy(target).addScaledVector(dir, distance);
        scratch.lookAt(target);
        scratch.updateMatrixWorld(true);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of points) {
          root.localToWorld(corner.copy(p)).project(scratch);
          x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x);
          y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y);
        }
        right.setFromMatrixColumn(scratch.matrixWorld, 0);
        upward.setFromMatrixColumn(scratch.matrixWorld, 1);
        target.addScaledVector(right, ((x0 + x1) / 2) * distance * half * scratch.aspect);
        target.addScaledVector(upward, ((y0 + y1) / 2) * distance * half);
        distance *= Math.max((x1 - x0) / 2, (y1 - y0) / 2) / fill;
      }
      state.goal.position.copy(target).addScaledVector(dir, distance);
      state.goal.active = true;
    };
    const outline = OUTLINE.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const box = Array.from({ length: 8 }, () => new THREE.Vector3());
    const boxPoints = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
      box.forEach((p, i) => p.set(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0));
      return box;
    };
    state.aim = (selection) => {
      current.subVectors(camera.position, controls.target);
      if (reframe) turned = false;
      keep = turned && current.lengthSq() > 1e-4;
      reframe = false;
      current.normalize();
      if (selection?.kind === 'room') {
        const place = places.find((p) => p.id === selection.id);
        if (place) {
          const r = Math.max(place.r0, place.r1);
          const [hi, lo] = bandEdges(r, place.band);
          fit(boxPoints(place.x0, lo, -COS * r, place.x1, hi, COS * r * 0.4), place.band === 'full' ? 0.6 : 0.5, YAW * 0.3, PITCH * 0.6);
          return;
        }
      } else if (selection?.kind === 'person') {
        const person = ship.people.get(selection.id);
        if (person?.holder.visible) {
          const { x, y, z } = person.goal;
          // A sleeper's bag is on an end wall, so look at it from further round.
          fit(boxPoints(x - 0.9, y - 0.9, z - 0.3, x + 0.9, y + 0.9, z + 0.3), 0.5, person.asleep ? YAW * 2.4 : YAW * 0.3, PITCH * 0.6);
          return;
        }
      }
      state.moved = false;
      fit(outline, state.portrait ? 0.88 : 0.9);
    };
    built.current = state;
    controls.addEventListener('start', () => {
      state.goal.active = false;
      state.moved = true;
      turned = true;
    });

    let width = 0;
    let height = 0;
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      width = w;
      height = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      for (const material of ship.lines) material.resolution.set(w, h);
      // On a tall, narrow screen the station is stood on its tail: in orbit there is no up.
      const portrait = w / h < 0.85;
      if (portrait !== state.portrait) {
        state.portrait = portrait;
        root.rotation.z = portrait ? -Math.PI / 2 : 0;
        reframe = true;
        root.updateMatrixWorld(true);
        rootInverse.copy(root.quaternion).invert();
        state.moved = false;
      }
      if (!state.moved) {
        state.aim(latest.current.selected);
        camera.position.copy(state.goal.position);
        controls.target.copy(state.goal.target);
        state.goal.active = false;
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    // A tap (not a drag) on a person or a room selects it; a tap on empty space does nothing.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const hits: THREE.Object3D[] = [];
    let down = { x: 0, y: 0, t: 0 };
    const onDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY, t: performance.now() }; };
    const onUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8 || performance.now() - down.t > 500) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      hits.length = 0;
      for (const person of ship.people.values()) if (person.holder.visible) hits.push(person.hit);
      let found = raycaster.intersectObjects(hits, false)[0];
      if (!found) {
        hits.length = 0;
        for (const room of ship.rooms.values()) hits.push(room.hit);
        found = raycaster.intersectObjects(hits, false)[0];
      }
      if (!found) return;
      const { kind, id } = found.object.userData as { kind: 'room' | 'person'; id: string };
      const { selected: now, onSelect: select } = latest.current;
      select(now?.kind === kind && now.id === id ? null : { kind, id });
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    // Only draw while the view is on screen.
    let onScreen = true;
    const visibility = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; });
    visibility.observe(el);

    // Everything the frame loop needs, made once.
    const point = new THREE.Vector3();
    const middle = new THREE.Vector3();
    const camUp = new THREE.Vector3();
    const facing = new THREE.Quaternion();
    const edges = new Map<string, [THREE.Vector3, THREE.Vector3]>();
    for (const place of places) {
      const [x, y] = centreOf(place);
      const r = radiusAt(place, x);
      const [hi, lo] = bandEdges(r, place.band);
      edges.set(place.id, [new THREE.Vector3(x, y, 0), new THREE.Vector3(x, place.band === 'upper' ? hi : lo, 0)]);
    }

    const toScreen = (v: THREE.Vector3) => {
      v.project(camera);
      const behind = v.z > 1;
      v.set(((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height, behind ? 1 : 0);
      return v;
    };
    const boxOf = (tag: Tag) => {
      const px = tag.x + (tag.w - tag.pw) / 2;
      const cy = tag.y + tag.h / 2;
      tag.box[0] = px - 3;
      tag.box[1] = cy - 17;
      tag.box[2] = px + tag.pw + 3;
      tag.box[3] = cy + 17;
    };
    const layoutTags = () => {
      const list = tags.current;
      camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      for (let i = 0; i < list.length; i++) {
        const tag = list[i];
        tag.show = false;
        if (tag.kind === 'person') {
          const person = ship.people.get(tag.id);
          if (!person?.holder.visible) continue;
          // Just above the head, like a name over a player.
          point.copy(person.holder.position);
          root.localToWorld(point).addScaledVector(camUp, person.asleep ? 0.85 : 0.95);
          toScreen(point);
          if (point.z) continue;
          tag.x = point.x - tag.w / 2;
          tag.y = point.y - tag.h / 2 - tag.ph / 2 - 2;
          tag.dx = 0;
          tag.dy = -1;
          tag.depth = point.y;
        } else {
          const pair = edges.get(tag.id);
          if (!pair) continue;
          toScreen(root.localToWorld(middle.copy(pair[0])));
          toScreen(root.localToWorld(point.copy(pair[1])));
          if (point.z || middle.z) continue;
          const ox = point.x - middle.x;
          const oy = point.y - middle.y;
          const inset = (tag.h - tag.ph) / 2;
          if (Math.abs(ox) > Math.abs(oy)) {
            tag.dx = Math.sign(ox);
            tag.dy = 0;
            tag.x = ox > 0 ? point.x + 4 - (tag.w - tag.pw) / 2 : point.x - 4 - tag.w + (tag.w - tag.pw) / 2;
            tag.y = point.y - tag.h / 2;
          } else {
            tag.dx = 0;
            tag.dy = Math.sign(oy) || 1;
            tag.x = point.x - tag.w / 2;
            tag.y = oy > 0 ? point.y + 4 - inset : point.y - 4 - tag.h + inset;
          }
          tag.depth = -1e6;
        }
        tag.show = point.x > -60 && point.x < width + 60 && point.y > -60 && point.y < height + 60;
      }
      // Place the selected label first, then people from the bottom of the screen up, then rooms;
      // anything that would cover a label already placed steps out of its way.
      const selectedKey = chosen.current;
      const rank = (tag: Tag) => (tag.key === selectedKey ? -2e6 : 0) + (tag.kind === 'room' ? 1e6 : 0) - tag.depth;
      for (let i = 1; i < list.length; i++) {
        const tag = list[i];
        let j = i - 1;
        while (j >= 0 && rank(list[j]) > rank(tag)) { list[j + 1] = list[j]; j--; }
        list[j + 1] = tag;
      }
      for (let i = 0; i < list.length; i++) {
        const tag = list[i];
        if (!tag.show) continue;
        tag.x = Math.min(Math.max(tag.x, 0), Math.max(0, width - tag.w));
        boxOf(tag);
        for (let tries = 0; tries < 12; tries++) {
          let clash = false;
          for (let j = 0; j < i; j++) {
            const other = list[j];
            if (!other.show) continue;
            const a = tag.box;
            const b = other.box;
            if (a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]) {
              if (tag.dy < 0) tag.y -= a[3] - b[1];
              else if (tag.dy > 0) tag.y += b[3] - a[1];
              else if (tag.dx > 0) tag.x += b[2] - a[0];
              else tag.x -= a[2] - b[0];
              boxOf(tag);
              clash = true;
              break;
            }
          }
          if (!clash) break;
        }
      }
      for (let i = 0; i < list.length; i++) {
        const tag = list[i];
        if (tag.show !== tag.shown) {
          tag.el.style.visibility = tag.show ? 'visible' : 'hidden';
          tag.shown = tag.show;
        }
        if (!tag.show) continue;
        const x = Math.round(tag.x);
        const y = Math.round(tag.y);
        if (x !== tag.lastX || y !== tag.lastY) {
          tag.el.style.transform = `translate(${x}px, ${y}px)`;
          tag.lastX = x;
          tag.lastY = y;
        }
      }
    };

    const roomList = [...ship.rooms.values()];
    const peopleList = [...ship.people.values()];
    const eye = new THREE.Vector3();
    let frameId = 0;
    let last = performance.now();
    const draw = (time: number) => {
      frameId = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (time - last) / 1000);
      last = time;
      if (document.hidden || !onScreen) return;
      // Seen from the front, the back wall's fittings show; from behind, the front wall's.
      const fromFront = root.worldToLocal(eye.copy(camera.position)).z > 0;
      ship.backLines.visible = fromFront;
      ship.frontLines.visible = !fromFront;
      for (const room of roomList) {
        room.back.visible = fromFront;
        room.front.visible = !fromFront;
        room.frontEdge.visible = fromFront;
        room.backEdge.visible = !fromFront;
      }
      const calm = still.matches;
      const ease = calm ? 1 : 1 - Math.exp(-dt * 5);

      if (state.goal.active) {
        camera.position.lerp(state.goal.position, ease);
        controls.target.lerp(state.goal.target, ease);
        if (camera.position.distanceToSquared(state.goal.position) < 1e-4) state.goal.active = false;
      }
      controls.enableDamping = !calm;
      controls.update();
      const reach = camera.position.distanceTo(controls.target);
      fog.near = reach - 2;
      fog.far = reach + 9;
      // Lines keep their width on screen, so a far-off person or fitting would close up into a
      // solid white shape. As they shrink on screen, their lines thin and dim instead.
      const personPx = (1.79 * height) / (2 * reach * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
      // A person is a dense drawing, so they reach full strength only when large on screen.
      const near = THREE.MathUtils.clamp((personPx - 25) / 175, 0, 1);
      for (const person of peopleList) {
        person.material.opacity = 0.4 + 0.5 * near;
        person.material.linewidth = 0.8 + 0.6 * near;
      }
      for (const room of roomList) room.detail.opacity = 0.45 + 0.55 * near;

      // Rooms over a limit breathe slowly; with reduced motion they hold steady at full strength.
      const breath = calm ? 1 : 0.7 + 0.3 * (0.5 + 0.5 * Math.sin((time / 2400) * Math.PI * 2));
      for (let i = 0; i < roomList.length; i++) {
        const room = roomList[i];
        room.wall.uniforms.strength.value = room.glow * (room.pulse ? breath : 1);
      }

      facing.copy(rootInverse).multiply(camera.quaternion);
      for (let i = 0; i < peopleList.length; i++) {
        const person = peopleList[i];
        if (!person.holder.visible) continue;
        person.at.lerp(person.goal, person.placed ? ease : 1);
        person.placed = true;
        person.holder.position.copy(person.at);
        const drifting = !calm && !person.asleep;
        if (drifting) person.holder.position.y += Math.sin(time / 1700 + person.phase) * 0.05;
        person.halo.quaternion.copy(facing);
        person.turn.rotation.z = person.roll + (drifting ? Math.sin(time / 2600 + person.phase) * 0.07 : 0);
        person.haloMaterial.uniforms.strength.value = person.haloGlow * (person.haloPulse ? breath : 1);
      }

      state.backdrop.update(dt, calm, state.portrait, tags.current);
      renderer.render(scene, camera);
      layoutTags();
    };
    frameId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      visibility.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      state.backdrop.dispose();
      ship.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      built.current = null;
    };
    // The scene is rebuilt only when the rooms or the crew change; everything else is applied below.
  }, [places, crewKey]);

  // Status colours, strength and where people are, whenever the data changes.
  const statusKey = JSON.stringify([where, roomStatus, personStatus, asleep, selected]);
  useEffect(() => {
    const state = built.current;
    if (!state) return;
    const { ship } = state;
    const ink = cssColour('--scene-line', '#f2f3f5');
    const bg = cssColour('--bg', '#0b0c0e');
    const colour = (status: Status) => cssColour(`--status-${status}`, FALLBACK[status]);
    const tone = (material: LineMaterial, target: THREE.Color, strength: number) => material.color.copy(bg).lerp(target, strength);
    const focusRoom = selected?.kind === 'room' ? selected.id : selected ? where[selected.id] ?? null : null;

    tone(ship.structure, ink, selected ? 0.22 : 0.45);
    state.backdrop.mood(Object.values(roomStatus).includes('over'), selected !== null);
    for (const [id, room] of ship.rooms) {
      const status = roomStatus[id] ?? 'unknown';
      const dimmed = focusRoom !== null && focusRoom !== id;
      const focused = focusRoom === id;
      if (status === 'over') {
        tone(room.frame, colour('over'), dimmed ? 0.5 : 1);
        room.frame.linewidth = 3.25;
      } else if (status === 'watch') {
        tone(room.frame, colour('watch'), dimmed ? 0.4 : 0.95);
        room.frame.linewidth = 2.25;
      } else {
        tone(room.frame, ink, dimmed ? 0.2 : focused ? 0.85 : 0.55);
        room.frame.linewidth = 1.75;
      }
      tone(room.detail, ink, dimmed ? 0.16 : focused ? 0.7 : 0.42);
      (room.wall.uniforms.tint.value as THREE.Color).copy(colour(status));
      room.glow = ROOM_LIGHT[status] * (dimmed ? 0.35 : 1);
      room.pulse = status === 'over';
    }

    const inRoom = new Map<string, string[]>();
    for (const person of crew) {
      const room = where[person.id];
      if (room) inRoom.set(room, [...(inRoom.get(room) ?? []), person.id]);
    }
    for (const person of crew) {
      const figure = ship.people.get(person.id);
      if (!figure) continue;
      const place = places.find((p) => p.id === where[person.id]);
      figure.holder.visible = Boolean(place);
      if (!place) {
        figure.placed = false;
        continue;
      }
      const lying = asleep.includes(person.id) && place.template === 'quarters';
      figure.asleep = lying;
      figure.face.visible = !lying;
      figure.sleep.visible = lying;
      if (lying) figure.goal.set(...bedOf(place));
      else {
        const together = inRoom.get(place.id)!.filter((id) => !(asleep.includes(id) && place.template === 'quarters'));
        figure.goal.set(...slot(place, together.indexOf(person.id), together.length));
      }
      const status = personStatus[person.id] ?? 'ok';
      const dimmed = selected !== null && (selected.kind === 'person' ? selected.id !== person.id : selected.id !== place.id);
      tone(figure.material, status === 'ok' || status === 'unknown' ? ink : colour(status), dimmed ? 0.35 : 1);
      (figure.haloMaterial.uniforms.tint.value as THREE.Color).copy(colour(status));
      figure.haloGlow = HALO[status] * (dimmed ? 0.35 : 1);
      figure.haloPulse = status === 'over';
      figure.halo.visible = figure.haloGlow > 0;
    }
  }, [places, crewKey, statusKey]);

  // Look closer at whatever is selected, or back at the whole station.
  useEffect(() => {
    built.current?.aim(selected);
  }, [selected?.kind, selected?.id, places]);

  // A development switch can select something on load (see demo.ts).
  useEffect(() => {
    if (demo?.select) raw.onSelect(demo.select);
  }, [demo]);

  // Measure the labels after every render; the frame loop places them.
  useLayoutEffect(() => {
    const next: Tag[] = [];
    for (const [key, el] of labels.current) {
      const pill = el.firstElementChild as HTMLElement | null;
      const old = tags.current.find((t) => t.key === key && t.el === el);
      const [kind, id] = key.split(/:(.*)/s) as ['person' | 'room', string];
      const tag: Tag = old ?? {
        key, kind, id, el, w: 0, h: 0, pw: 0, ph: 0, x: 0, y: 0, dx: 0, dy: -1, depth: 0,
        show: false, shown: true, lastX: NaN, lastY: NaN, box: [0, 0, 0, 0],
      };
      tag.w = el.offsetWidth;
      tag.h = el.offsetHeight;
      tag.pw = pill?.offsetWidth ?? tag.w;
      tag.ph = pill?.offsetHeight ?? tag.h;
      next.push(tag);
    }
    tags.current = next;
  });

  const keep = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) labels.current.set(key, el);
    else labels.current.delete(key);
  };
  const roomName = (id: string) => s(rooms.find((r) => r.id === id)?.name ?? id);
  const toggle = (next: NonNullable<Selection>) => onSelect(selected?.kind === next.kind && selected.id === next.id ? null : next);
  const focusRoom = selected?.kind === 'room' ? selected.id : selected ? where[selected.id] ?? null : null;

  if (failed) return null;
  return (
    <div ref={holder} className="station" role="group" aria-label={s('scene.label')} data-full={full ? '' : undefined}>
      <button type="button" className="station-full" aria-label={s(full ? 'scene.full.exit' : 'scene.full')}
        title={s(full ? 'scene.full.exit' : 'scene.full')} aria-pressed={full} onClick={toggleFull}>
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path d={full ? 'M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5' : 'M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5'}
            fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {places.map((place) => {
        const status = roomStatus[place.id] ?? 'unknown';
        const pressed = selected?.kind === 'room' && selected.id === place.id;
        return (
          <button key={place.id} ref={keep(`room:${place.id}`)} type="button" className="tag tag-room" data-status={status}
            data-dim={focusRoom !== null && focusRoom !== place.id ? '' : undefined}
            aria-label={`${roomName(place.id)}, ${s(`status.${status}`)}`} aria-pressed={pressed}
            onClick={() => toggle({ kind: 'room', id: place.id })}>
            <span className="tag-pill">
              {roomName(place.id)}
              {status !== 'ok' && <span className="tag-status"> · {s(`status.${status}`)}</span>}
            </span>
          </button>
        );
      })}
      {crew.filter((person) => places.some((p) => p.id === where[person.id])).map((person) => {
        const status = personStatus[person.id] ?? 'ok';
        const pressed = selected?.kind === 'person' && selected.id === person.id;
        const dim = selected !== null && !pressed && !(selected.kind === 'room' && selected.id === where[person.id]);
        return (
          <button key={person.id} ref={keep(`person:${person.id}`)} type="button" className="tag tag-person" data-status={status}
            data-dim={dim ? '' : undefined}
            aria-label={s('scene.in', { name: person.name, room: roomName(where[person.id]) }) + (status === 'ok' ? '' : `. ${s(`status.${status}`)}`)}
            aria-pressed={pressed} onClick={() => toggle({ kind: 'person', id: person.id })}>
            <span className="tag-pill">
              {person.name}
              {(status === 'watch' || status === 'over') && <span className="tag-status"> · {s(`status.${status}`)}</span>}
            </span>
          </button>
        );
      })}
      {selected && <button type="button" className="station-home" onClick={() => onSelect(null)}>{s('scene.whole')}</button>}
    </div>
  );
}
