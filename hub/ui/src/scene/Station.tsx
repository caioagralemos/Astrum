// The station view: every room and who is in it, drawn as a cut-open line
// drawing of the place, from its mission file (hub/profiles/missions): the
// ship, the International Space Station or a base on the Moon or Mars.
// Without a mission it draws the ship.
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

import { destinationBody } from '../../../engine/mission.ts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { POSES, buildShip } from './build.ts';
import type { Figure, Ship } from './build.ts';
import { readDemo } from './demo.ts';
import { createBackdrop } from './backdrop.ts';
import { createWeather } from './weather.ts';
import type { Weather } from './weather.ts';
import { createHazards } from './hazards.ts';
import type { Backdrop } from './backdrop.ts';
import type { Doing, PoseName, Spot } from './layout.ts';
import { activitySpots, bedOf, extentOf, labelEdge, layoutOf, neutralSpot, outlineOf, sleepsIn } from './layout.ts';
import type { LastSeen } from '../../../engine/timeline.ts';
// HH:MM, the same in both languages (24-hour).
import { timeOf } from '../panels/common.tsx';
import { MISSIONS, SHIP } from './missions.ts';
import { roomsOf } from '../../../engine/mission.ts';
import type { Mission } from '../../../engine/mission.ts';
import type { Status } from '../../../engine/status.ts';
import type { Person, Room } from '../../../engine/types.ts';
import { paintFigure } from './bodyPaint.ts';
import type { BodyStates } from '../person/regions.ts';

export interface StationProps {
  rooms: Room[];
  crew: Person[];
  /** Room id for each person, if known. */
  where: Record<string, string>;
  /** Display only: the last room of each person whose place is unknown, drawn faint as "last seen", never as there now. */
  lastSeen?: Record<string, LastSeen>;
  roomStatus: Record<string, Status>;
  personStatus: Record<string, Status>;
  /** Crew ids asleep now: drawn still, in their sleeping bag (used only when `activity` is not given). */
  asleep: string[];
  /**
   * What each person is doing as far as the hub knows. A figure runs on the treadmill or sits at
   * the table only when this says so (and the room has that furniture); anyone else is drawn in a
   * neutral pose. Absent (older hubs, mission previews): the asleep list, everyone else neutral.
   */
  activity?: Record<string, Doing>;
  s: (key: string, vars?: Record<string, string | number>) => string;
  selected: Selection;
  onSelect: (selection: Selection) => void;
  /** The place to draw; the ship when absent. */
  mission?: Mission;
  /** Declared base-wide events that have weather in the view (weather.ts): an illustration, never the only word. */
  weather?: Weather;
  /**
   * The parts of the view covered by interface laid over it (top bar, bottom widgets), in CSS
   * pixels. The sky still fills the whole view; the place is framed in what is left. Unset sides
   * fall back to the CSS variables --scene-inset-top / -right / -bottom / -left on .station.
   */
  inset?: Inset;
  /** A room drawn in the status red whatever its reading (the emergency's room); none when absent. */
  alarmRoom?: string | null;
  /** How much of the free view a selected room fills (its insets already clear of what covers it); the usual framing when absent. */
  roomZoom?: number;
  /** The selected person's body states (person/regions.ts): their figure is drawn as the data display. */
  body?: { person: string; states: BodyStates } | null;
}

export interface Inset { top?: number; right?: number; bottom?: number; left?: number }

export type Selection = { kind: 'room' | 'person'; id: string } | null;

const FOV = 30;
/** The ship's default view: a little from the nose side and a little from above, like the concept drawing. Each mission sets its own. */
const YAW = -0.24;
const PITCH = 0.2;
/** How far round a sleeper in a bag is seen from, beyond the way they face. */
const SLEEPER_TURN = YAW * 2.4 + Math.PI / 2;
const FALLBACK: Record<Status, string> = { ok: '#4fd18b', watch: '#f2c14e', over: '#ff5a4a', unknown: '#5b9dff' };
/** How strongly each status lights its room, and its people. */
// A room that is fine, or has no reading, is not coloured at all (the words on its tag say so);
// only an alert or a danger lights it.
const ROOM_LIGHT: Record<Status, number> = { ok: 0, unknown: 0, watch: 0.11, over: 0.32 };
const HALO: Record<Status, number> = { ok: 0, unknown: 0, watch: 0.14, over: 0.3 };

/**
 * When nothing in the view has changed for SETTLE_MS (no camera move, easing, pulse, movement or
 * selected person), only the sky's slow drift moves, a few pixels a second: it is drawn at most once
 * every IDLE_FRAME_MS (about 30 frames a second) instead of on every display frame.
 */
const SETTLE_MS = 3000;
const IDLE_FRAME_MS = 30;

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const FROST = new THREE.Color(0.85, 0.93, 1);
const WHITE = new THREE.Color(1, 1, 1);
const COS_8 = Math.cos(Math.PI / 8);
const turnY = new THREE.Quaternion();
const facingDir = new THREE.Vector3();
/** Laid on their back, head towards -x: face up, body along the bunk. */
const lieDown = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

function cssNumber(name: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

function cssColour(name: string, fallback: string): THREE.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(value || fallback);
}

/** A label laid over the drawing, and where it was put on the last frame. */
interface Tag {
  key: string;
  /** A group is one tag for several people in the same room whose names would crowd. */
  kind: 'person' | 'room' | 'group';
  id: string;
  el: HTMLElement;
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
  /** A person placed this frame in a room that can be seen (whether or not their own tag shows). */
  cand: boolean;
  /** How present it is (0 to 1): tags fade in and out rather than pop. */
  alpha: number;
  /** Where it was put before stepping out of other tags' way. */
  homeX: number;
  homeY: number;
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
  /** Back to the default view of the whole place, whatever the viewer has done. */
  home: () => void;
  backdrop: Backdrop;
  /** Something in the view has changed: draw every frame again until it has settled. */
  wake: () => void;
}

/** What each person is doing: the hub's activity, or else only who is asleep. */
function doingOf(activity: Record<string, Doing> | undefined, asleep: string[]): Record<string, Doing> {
  return activity ?? Object.fromEntries(asleep.map((id) => [id, 'sleeping' as const]));
}

/** Applies the page-address development switches (see demo.ts) over the real data. */
function withDemo(props: StationProps, demo: ReturnType<typeof readDemo>): StationProps & { doing: Record<string, Doing> } {
  if (!demo) return { ...props, doing: doingOf(props.activity, props.asleep) };
  const ids = props.crew.map((p) => p.id);
  const preview = Boolean(demo.mission && !props.mission);
  if (preview && demo.mission) {
    // Another place than the hub's own: its rooms, and the crew where the mission file says they work
    // (or sleep), with no readings.
    const mission = MISSIONS[demo.mission];
    const sleeping = demo.asleep !== null;
    props = {
      ...props, mission, rooms: roomsOf(mission), roomStatus: {},
      where: Object.fromEntries(mission.crew.map((p) => [p.id, sleeping ? p.quarters : p.work])),
    };
  }
  const where = { ...props.where };
  for (const [who, room] of Object.entries(demo.where)) for (const id of who === '*' ? ids : [who]) where[id] = room;
  const asleep = demo.asleep === '*' ? ids : demo.asleep ?? props.asleep;
  const roomStatus = { ...props.roomStatus };
  const personStatus = { ...props.personStatus };
  for (const [id, status] of Object.entries(demo.status)) {
    if (ids.includes(id)) personStatus[id] = status;
    else roomStatus[id] = status;
  }
  // A preview of another place knows only who is asleep; the switches go over whatever is known.
  const doing = { ...doingOf(preview ? undefined : props.activity, asleep) };
  if (demo.asleep !== null) for (const id of asleep) doing[id] = 'sleeping';
  for (const [who, what] of Object.entries(demo.activity)) for (const id of who === '*' ? ids : [who]) doing[id] = what;
  const weather = demo.weather ?? props.weather;
  return { ...props, where, asleep, roomStatus, personStatus, doing, weather };
}

export function Station(raw: StationProps) {
  const demo = useMemo(readDemo, []);
  const shown = withDemo(raw, demo);
  // Where each figure is drawn: the live place, or else the last one seen (`ghost`), so nobody vanishes.
  const ghost = Object.fromEntries(Object.entries(raw.lastSeen ?? {}).filter(([id, last]) => !shown.where[id] && shown.rooms.some((r) => r.id === last.room)));
  const seat = { ...Object.fromEntries(Object.entries(ghost).map(([id, last]) => [id, last.room])), ...shown.where };
  const props = { ...shown, ghost, seat };
  const { rooms, crew, where, roomStatus, personStatus, doing, s, selected, onSelect } = props;
  const holder = useRef<HTMLDivElement>(null);
  const built = useRef<State | null>(null);
  const labels = useRef(new Map<string, HTMLElement>());
  const firstAim = useRef(true);
  /** The edge tags for rooms over their limit, by room id. */
  const alarms = useRef(new Map<string, HTMLButtonElement>());
  /** The ground's strength at rest and where it is easing to (it dims like the planet). */
  const groundBase = useRef({ value: 0 }).current;
  const groundGoal = useRef({ value: 0 }).current;
  const tags = useRef<Tag[]>([]);
  const latest = useRef(props);
  latest.current = props;
  /** The selected label's key, kept ready for the frame loop. */
  const chosen = useRef('');
  chosen.current = props.selected ? `${props.selected.kind}:${props.selected.id}` : '';
  const [failed, setFailed] = useState(false);

  const mission = props.mission ?? SHIP;
  /** A place drawn only for a look (?demoMission): its rooms have no sensors, so "no reading" is said, not shown, on each label. */
  const demoPlace = Boolean(demo?.mission) && !raw.mission;
  const layout = useMemo(() => layoutOf(mission), [mission]);
  const roomKey = rooms.map((r) => r.id).join(',');
  const places = useMemo(() => layout.places.filter((place) => rooms.some((r) => r.id === place.id)), [layout, roomKey]);
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

    // The dimming layer for the person view: a sheet in the background colour drawn over the
    // station, darker towards the panel, with the chosen person drawn again on top of it.
    const dimMaterial = new THREE.ShaderMaterial({
      uniforms: { tint: { value: cssColour('--bg', '#0b0c0e') }, strength: { value: 0 }, portrait: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform vec3 tint; uniform float strength; uniform float portrait; varying vec2 vUv;
        void main() {
          float towardsPanel = mix(vUv.x, 1.0 - vUv.y, portrait);
          gl_FragColor = vec4(tint, strength * mix(0.55, 0.88, towardsPanel));
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const dimScene = new THREE.Scene();
    dimScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dimMaterial));
    const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    /** Layer 1 holds the person drawn above the dimming layer. */
    const ABOVE = 1;
    let lifted: Figure | undefined;
    const lift = (figure: Figure | undefined) => {
      if (figure === lifted) return;
      for (const [f, layer] of [[lifted, 0], [figure, ABOVE]] as const) {
        f?.holder.traverse((object) => { if (object !== f.hit) object.layers.set(layer); });
      }
      lifted = figure;
    };
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 2.5;
    const view = mission.view ?? { yaw: YAW, pitch: PITCH, turnOnTall: true };
    const viewYaw = view.yaw;
    const viewPitch = view.pitch;
    const [zoomYaw, zoomPitch] = mission.kind === 'ship' ? [YAW * 0.3, PITCH * 0.6] : [viewYaw, Math.max(viewPitch, 0.45)];
    const depth = view.depth ?? 1;
    const surface = mission.where.situation === 'surface';
    const weightless = mission.gravity === 0;
    controls.maxDistance = 70 * depth;
    // On the ground the view stays above it.
    if (surface) controls.maxPolarAngle = Math.PI * 0.47;

    const ink = cssColour('--scene-line', '#f2f3f5');
    const bg = cssColour('--bg', '#0b0c0e');
    const ship = buildShip(scene, mission, layout.modules, places, crew.map((p) => p.id), ink, bg);
    const { root } = ship;
    (ship.stars.material as THREE.PointsMaterial).size = 1.5 * renderer.getPixelRatio();

    /** When something in the view last changed (see SETTLE_MS). */
    let busyAt = performance.now();
    const rootInverse = new THREE.Quaternion();
    const dir = new THREE.Vector3();
    const state: State = {
      ship, camera, controls, portrait: false, moved: false,
      backdrop: createBackdrop(scene, renderer, camera, root, ship.stars, demo, { ...mission.where, destination: destinationBody(mission.destination) }),
      goal: { position: new THREE.Vector3(), target: new THREE.Vector3(), active: false },
      aim: () => {},
      home: () => {},
      wake: () => { busyAt = performance.now(); },
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
    /** `at` is where on screen the points' middle should land, in -1..1 across and up (0, 0 is the centre). */
    /**
     * The share of the screen's height the widgets along the bottom take (dock/StationDock.tsx,
     * room/RoomView.tsx). Framing the station or a room keeps above them; a person's own sheet does not.
     */
    const DOCK = 0.27;
    const fit = (points: THREE.Vector3[], wanted: number, yaw = viewYaw, pitch = viewPitch, aim: [number, number] = [0, 0], aboveDock = false) => {
      const fill = aboveDock ? wanted * (1 - DOCK) : wanted;
      // Centred exactly in the space above the widgets the ship reads high (the top bar weighs on it
      // too), so it sits a little lower than that, nearer the widgets.
      const at: [number, number] = aboveDock ? [aim[0], aim[1] + DOCK * 0.6] : aim;
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
        // Fit within what the insets leave free (its share of the width and height).
        distance *= Math.max((x1 - x0) / 2 / free.w, (y1 - y0) / 2 / free.h) / fill;
      }
      target.addScaledVector(right, -at[0] * distance * half * scratch.aspect);
      target.addScaledVector(upward, -at[1] * distance * half);
      state.goal.position.copy(target).addScaledVector(dir, distance);
      state.goal.active = true;
    };
    const outline = outlineOf(mission, layout.modules);
    const box = Array.from({ length: 8 }, () => new THREE.Vector3());
    /** A box's corners; with a matrix, carried from a module's frame into the place's. */
    const boxPoints = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, matrix?: THREE.Matrix4) => {
      box.forEach((p, i) => {
        p.set(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0);
        if (matrix) p.applyMatrix4(matrix);
      });
      return box;
    };
    const weather = createWeather(root, renderer, camera, outline, viewYaw, surface, ink, bg, mission.where.body);
    const roomBoxes = places.map((place) => ({ id: place.id, box: new THREE.Box3().setFromPoints(boxPoints(...extentOf(place), place.frame.matrix)) }));
    const hazards = createHazards(root, renderer, outline, roomBoxes, viewYaw, surface, ink, bg, mission.where.body);
    state.aim = (selection) => {
      current.subVectors(camera.position, controls.target);
      if (reframe) turned = false;
      keep = turned && current.lengthSq() > 1e-4;
      reframe = false;
      current.normalize();
      if (selection?.kind === 'room') {
        const place = places.find((p) => p.id === selection.id);
        if (place) {
          const zoom = latest.current.roomZoom;
          if (mission.kind === 'ship') {
            fit(boxPoints(...extentOf(place), place.frame.matrix), zoom ?? (place.band === 'full' ? 0.45 : 0.36), zoomYaw, zoomPitch, [0, 0], zoom === undefined);
            return;
          }
          // On a station or a base, modules lie every way: look in through the room's open side nearer
          // the default view (away from the modules round it), a little from above (more on a surface).
          const facing = place.frame.front;
          const towards = Math.sin(viewYaw) * facing.x + Math.cos(viewYaw) * facing.z >= 0 ? 1 : -1;
          const flat = Math.hypot(facing.x, facing.z) > 0.3;
          fit(boxPoints(...extentOf(place), place.frame.matrix), zoom ?? (place.frame.dome ? 0.42 : 0.45),
            flat ? Math.atan2(towards * facing.x, towards * facing.z) : zoomYaw, surface ? 0.55 : flat ? 0.3 : zoomPitch, [0, 0], zoom === undefined);
          return;
        }
      } else if (selection?.kind === 'person') {
        const person = ship.people.get(selection.id);
        if (person?.holder.visible) {
          const { x, y, z } = person.goal;
          // A sleeper's bag is on an end wall, so look at it from further round.
          // The person view's panel takes the right of the screen (the bottom on a tall one), so
          // the camera comes in close, at eye level and facing them, with the person filling the
          // height on the other side of the panel, centred vertically.
          fit(boxPoints(x - 0.9, y - 0.9, z - 0.3, x + 0.9, y + 0.9, z + 0.3), state.portrait ? 0.28 : 0.9,
            person.asleep ? person.lookYaw : person.face.rotation.y + 0.25, person.asleep ? person.lookPitch : 0.05, state.portrait ? [0, 0.56] : [-0.45, 0]);
          return;
        }
      }
      state.moved = false;
      // The ship's own frame is fitted as it always was; elsewhere the rooms, with a little more
      // margin so some of what surrounds them still shows.
      fit(outline, mission.view?.frame ? (state.portrait ? 0.88 : 0.9) : (state.portrait ? 0.8 : 0.78), viewYaw, viewPitch, [0, 0], true);
    };
    state.home = () => {
      state.moved = false;
      reframe = true;
      state.aim(null);
    };
    built.current = state;
    // Only a real drag or zoom counts as the viewer turning the station: a tap (which also
    // starts the controls) must not, or stepping back out would keep the close-up's angle.
    const grabbedAt = new THREE.Vector3();
    let grabbing = false;
    controls.addEventListener('start', () => {
      state.goal.active = false;
      grabbing = true;
      grabbedAt.copy(camera.position);
    });
    controls.addEventListener('end', () => { grabbing = false; });
    controls.addEventListener('change', () => {
      state.wake();
      if (!grabbing || camera.position.distanceToSquared(grabbedAt) < 1e-4) return;
      state.moved = true;
      turned = true;
    });

    let width = 0;
    let height = 0;
    // The free rectangle: the view minus the insets. The camera's projection is shifted (a view
    // offset) so the point it turns about sits in the middle of it; the orbit still turns about
    // the place's own centre. The shift glides when the insets change.
    const free = { w: 1, h: 1, top: 0, right: 0, bottom: 0, left: 0, dx: 0, dy: 0 };
    const shift = { x: 0, y: 0 };
    const sideOf = (given: number | undefined, name: string, fallback: number | undefined) => {
      if (given !== undefined && Number.isFinite(given)) return Math.max(0, given);
      const css = parseFloat(getComputedStyle(el).getPropertyValue(name));
      if (Number.isFinite(css)) return Math.max(0, css);
      return Math.max(0, fallback ?? 0);
    };
    /** Read the insets; true when they changed. */
    const readInsets = () => {
      const given = latest.current.inset ?? {};
      const d = demo?.inset;
      const top = sideOf(given.top, '--scene-inset-top', d?.[0]);
      const right = sideOf(given.right, '--scene-inset-right', d?.[1]);
      const bottom = sideOf(given.bottom, '--scene-inset-bottom', d?.[2]);
      const left = sideOf(given.left, '--scene-inset-left', d?.[3]);
      const changed = top !== free.top || right !== free.right || bottom !== free.bottom || left !== free.left;
      Object.assign(free, { top, right, bottom, left });
      if (width && height) {
        free.w = Math.max(0.2, (width - left - right) / width);
        free.h = Math.max(0.2, (height - top - bottom) / height);
        free.dx = (left - right) / 2;
        free.dy = (top - bottom) / 2;
      }
      return changed;
    };
    const applyShift = () => {
      if (Math.abs(shift.x) < 0.25 && Math.abs(shift.y) < 0.25) {
        if (camera.view?.enabled) camera.clearViewOffset();
      } else camera.setViewOffset(width, height, -shift.x, -shift.y, width, height);
    };
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      width = w;
      height = h;
      state.wake();
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      readInsets();
      shift.x = free.dx;
      shift.y = free.dy;
      applyShift();
      camera.updateProjectionMatrix();
      for (const material of ship.lines) material.resolution.set(w, h);
      // On a tall, narrow screen the station is stood on its tail: in orbit there is no up.
      // A base keeps its ground below and is only framed taller.
      const portrait = w / h < 0.85;
      if (portrait !== state.portrait) {
        state.portrait = portrait;
        root.rotation.z = portrait && view.turnOnTall ? -Math.PI / 2 : 0;
        reframe = true;
        root.updateMatrixWorld(true);
        rootInverse.copy(root.quaternion).invert();
        state.moved = false;
      }
      if (!state.moved) {
        state.aim(latest.current.selected);
        camera.position.copy(state.goal.position);
        controls.target.copy(state.goal.target);
        // However large the place, the viewer can always pull back to see all of it.
        controls.maxDistance = Math.max(controls.maxDistance, camera.position.distanceTo(controls.target) * 3);
        state.goal.active = false;
        state.backdrop.place();
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    if (demo?.orbit) {
      // Development only: turn and zoom the view from its default framing (see demo.ts).
      const [azimuth, elevation, zoom] = demo.orbit;
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target).divideScalar(zoom);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(azimuth));
      const side = new THREE.Vector3().crossVectors(offset, new THREE.Vector3(0, 1, 0)).normalize();
      offset.applyAxisAngle(side, THREE.MathUtils.degToRad(elevation));
      camera.position.copy(controls.target).add(offset);
      state.moved = true;
      turned = true;
    }

    // A tap (not a drag) on a person or a room selects it. With something selected, a tap
    // outside it goes back to the whole station; inside it (a person in the chosen room) goes in.
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
      const { selected: now, onSelect: select, where: at } = latest.current;
      const hit = found ? found.object.userData as { kind: 'room' | 'person'; id: string } : null;
      if (!now) {
        if (hit) select(hit);
        return;
      }
      if (hit && hit.kind === now.kind && hit.id === now.id) return;
      if (hit?.kind === 'person' && now.kind === 'room' && at[hit.id] === now.id) select(hit);
      else select(null);
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
      const [middle, edge] = labelEdge(place);
      edges.set(place.id, [new THREE.Vector3(...middle).applyMatrix4(place.frame.matrix), new THREE.Vector3(...edge).applyMatrix4(place.frame.matrix)]);
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
    // The interface laid over the view (the top bar's items, the dock, the open panel, the story
    // line), in the station's own pixels, read with the insets. A label never sits under any of it:
    // there it could neither be read nor pressed, and its words would cross the interface's.
    const COVERS = '.topbar > *, .dock, .person, .panel, .sheet, .story, .banner';
    let covers: [number, number, number, number][] = [];
    const readCovers = () => {
      const origin = el.getBoundingClientRect();
      covers = [...document.querySelectorAll<HTMLElement>(COVERS)]
        .map((c) => c.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => [r.left - origin.left, r.top - origin.top, r.right - origin.left, r.bottom - origin.top]);
    };
    const covered = (tag: Tag) => {
      const x0 = tag.x + (tag.w - tag.pw) / 2 - 4;
      const x1 = x0 + tag.pw + 8;
      const y0 = tag.y + (tag.h - tag.ph) / 2 - 4;
      const y1 = y0 + tag.ph + 8;
      return covers.some((c) => x0 < c[2] && c[0] < x1 && y0 < c[3] && c[1] < y1);
    };
    // Whether each room, and each person, can be seen from here. A label shows only for what can.
    // A room's walls open on whichever side faces the camera (even an end wall, end-on), so what
    // hides a room is another module standing in front of it: (a) seen nearly end-on, a room is
    // first checked strictly, with a margin either way so it does not flicker; (b) no other
    // module's walls may stand between the camera and it (a simple box per walled module, a few
    // rays a frame in turn); (c) it must be large enough on screen to be worth naming.
    // Only modules with walls hide anything: rooms (and, where extras are drawn in full like the
    // ship's engine section, the walled modules nobody works in); the others are open outlines.
    const occluders = layout.modules.filter((m) => (m.look === 'hull' || m.look === 'dome') && (m.spec.isRoom || mission.view?.extras === 'full')).map((m) => {
      const box = m.dome
        ? new THREE.Box3(new THREE.Vector3(-m.dome.radius * 0.85, 0, -m.dome.radius * 0.85), new THREE.Vector3(m.dome.radius * 0.85, m.dome.height * 0.85, m.dome.radius * 0.85))
        // Set in from the walls, so a ray that only grazes a module's corner or crosses its end does not count.
        : new THREE.Box3(new THREE.Vector3(m.x0 + 0.4, -COS_8 * Math.max(m.r0, m.r1) * 0.72, -COS_8 * Math.max(m.r0, m.r1) * 0.72), new THREE.Vector3(m.x1 - 0.4, COS_8 * Math.max(m.r0, m.r1) * 0.72, COS_8 * Math.max(m.r0, m.r1) * 0.72));
      return { id: m.spec.id, matrix: m.matrix, inverse: m.matrix.clone().invert(), box };
    });
    const axisOf = new Map(places.map((p) => [p.id, p.frame.dome ? null : new THREE.Vector3(1, 0, 0).applyQuaternion(p.frame.quaternion)]));
    const sizeOf = new Map(places.map((p) => [p.id, p.frame.dome ? p.frame.dome.radius * 2 : Math.max(p.x1 - p.x0, 2 * p.r0) * p.frame.scale]));
    const moduleOf = new Map(places.map((p) => [p.id, p.frame.spec.id]));
    // A room counts as seen if any of a few points of it is: its middle, near its ceiling, its label edge.
    const samplesOf = new Map(places.map((p) => {
      const [middle, edge] = labelEdge(p);
      const [, , , , hi] = extentOf(p);
      return [p.id, [middle, edge, [middle[0], hi * 0.8, middle[2]] as [number, number, number]].map((v) => new THREE.Vector3(...v).applyMatrix4(p.frame.matrix))];
    }));
    const head = new THREE.Vector3();
    const across = new Map<string, boolean>();
    const hidden = new Map<string, boolean>();
    const ray = new THREE.Ray();
    const local = new THREE.Ray();
    const hitAt = new THREE.Vector3();
    const camLocal = new THREE.Vector3();
    const anchor = new THREE.Vector3();
    let turn = 0;
    /** True when a walled module other than `own` stands between the camera and `at` (place coordinates). */
    const blocked = (at: THREE.Vector3, own: string | undefined) => {
      const far = camLocal.distanceTo(at) - 0.3;
      ray.origin.copy(camLocal);
      ray.direction.subVectors(at, camLocal).normalize();
      for (const o of occluders) {
        if (o.id === own) continue;
        local.copy(ray).applyMatrix4(o.inverse);
        if (!local.intersectBox(o.box, hitAt)) continue;
        if (hitAt.applyMatrix4(o.matrix).distanceTo(camLocal) < far) return true;
      }
      return false;
    };
    const roomSeen = (id: string) => hidden.get(`room:${id}`) !== true;
    const seen = () => {
      root.worldToLocal(camLocal.copy(camera.position));
      // (a) end-on, every tag is checked this frame (the view has just swung round); otherwise
      // (b) a few occlusion rays each frame, round the tags in turn.
      let endOn = false;
      for (const [id, axis] of axisOf) {
        if (!axis) continue;
        const side = Math.sqrt(Math.max(0, 1 - eye.dot(axis) ** 2));
        const was = across.get(id) ?? true;
        const now = was ? side > 0.34 : side > 0.42;
        if (now !== was) endOn = true;
        across.set(id, now);
      }
      const list = tags.current;
      for (let k = 0; k < (endOn ? list.length : Math.min(4, list.length)); k++) {
        const tag = list[(turn++) % list.length];
        if (tag.kind === 'room') {
          const pair = edges.get(tag.id);
          const samples = samplesOf.get(tag.id);
          if (samples) hidden.set(tag.key, samples.every((v) => blocked(anchor.copy(v), moduleOf.get(tag.id))));
        } else {
          const person = ship.people.get(tag.id);
          const room = latest.current.seat[tag.id];
          if (person) {
            const own = room ? moduleOf.get(room) : undefined;
            head.copy(person.holder.position).y += 0.7;
            hidden.set(tag.key, blocked(anchor.copy(person.holder.position), own) && blocked(head, own));
          } else if (tag.kind === 'group') {
            const samples = samplesOf.get(tag.id);
            if (samples) hidden.set(tag.key, samples.every((v) => blocked(anchor.copy(v), moduleOf.get(tag.id))));
          }
        }
      }
    };
    const pixelsPerMetre = (distance: number) => height / (2 * distance * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));

    const layoutTags = (dt: number, calm: boolean) => {
      const list = tags.current;
      camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      seen();
      for (let i = 0; i < list.length; i++) {
        const tag = list[i];
        tag.show = false;
        if (tag.kind === 'group') continue;
        if (tag.kind === 'person') {
          const person = ship.people.get(tag.id);
          if (!person?.holder.visible) continue;
          const room = latest.current.seat[tag.id];
          tag.cand = false;
          if (room && !roomSeen(room)) continue;
          if (pixelsPerMetre(camera.position.distanceTo(root.localToWorld(anchor.copy(person.holder.position)))) * 1.8 < 12) continue;
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
          // In a room that can be seen, a person counts towards a shared tag even if the test says
          // they are just out of sight; on their own they show only if they are not.
          tag.cand = true;
          if (hidden.get(tag.key)) continue;
        } else {
          const pair = edges.get(tag.id);
          if (!pair || !roomSeen(tag.id)) continue;
          if (pixelsPerMetre(camera.position.distanceTo(root.localToWorld(anchor.copy(pair[0])))) * (sizeOf.get(tag.id) ?? 2) < 34) continue;
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
        tag.show = point.x > -60 && point.x < width + 60 && point.y > -60 && point.y < height + 60
          // Not under the interface laid over the view: a tag there could not be read or pressed.
          && point.x >= free.left && point.x <= width - free.right && point.y >= free.top && point.y <= height - free.bottom
          && !covered(tag);
      }
      // Several people in one room whose names would crowd (sleepers side by side, a meal) share
      // one tag above the highest of them, with a button for each, instead of pushing each other away.
      for (const group of list) {
        if (group.kind !== 'group') continue;
        let count = 0, top = Infinity, sumX = 0, crowded = false;
        for (const a of list) {
          if (a.kind !== 'person' || !a.cand || latest.current.where[a.id] !== group.id) continue;
          for (const b of list) {
            if (b === a || b.kind !== 'person' || !b.cand || latest.current.where[b.id] !== group.id) continue;
            if (Math.abs(a.x - b.x) < (a.pw + b.pw) / 2 + 6 && Math.abs(a.y - b.y) < a.ph + 6) crowded = true;
          }
          count++;
          sumX += a.x + a.w / 2;
          top = Math.min(top, a.y);
        }
        // Shared when they would crowd, or when some of them could not be named on their own.
        let missing = false;
        for (const a of list) if (a.kind === 'person' && a.cand && !a.show && latest.current.where[a.id] === group.id) missing = true;
        if (count < 2 || !(crowded || missing) || hidden.get(group.key)) continue;
        for (const a of list) if (a.kind === 'person' && latest.current.where[a.id] === group.id && a.key !== chosen.current) a.show = false;
        group.x = sumX / count - group.w / 2;
        group.y = top;
        group.dx = 0;
        group.dy = -1;
        group.depth = top + 1e3;
        group.show = true;
      }
      // Place the selected label first, then people from the bottom of the screen up, then rooms;
      // anything that would cover a label already placed steps out of its way.
      const selectedKey = chosen.current;
      // Then rooms with something to say (not fine) before rooms that are fine.
      const rank = (tag: Tag) => (tag.key === selectedKey ? -4e6 : 0) + (tag.kind === 'room' ? (tag.el.dataset.status === 'ok' || tag.el.dataset.status === 'unknown' ? 2e6 : 1e6) : 0) - tag.depth;
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
        tag.homeX = tag.x;
        tag.homeY = tag.y;
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
        // A label never wanders far from what it names: rather than more than about its own height
        // away, it gives way (the ones placed first, by rank, keep their place).
        if (tag.key !== selectedKey && Math.hypot(tag.x - tag.homeX, tag.y - tag.homeY) > tag.ph * 1.15) tag.show = false;
        // Stepping aside must not carry it under the interface either.
        if (tag.show && covered(tag)) tag.show = false;
      }
      // Fade over about 120 ms (at once with reduced motion); a faded-out tag leaves the tab order
      // and the accessibility tree too (visibility: hidden), since it names nothing on screen.
      const step = calm ? 1 : dt / 0.12;
      for (let i = 0; i < list.length; i++) {
        const tag = list[i];
        const alpha = Math.min(1, Math.max(0, tag.alpha + (tag.show ? step : -step)));
        if (alpha !== tag.alpha) {
          tag.alpha = alpha;
          tag.el.style.opacity = alpha >= 1 ? '' : String(alpha);
        }
        const present = tag.show || alpha > 0;
        if (present !== tag.shown) {
          tag.el.style.visibility = present ? 'visible' : 'hidden';
          tag.shown = present;
        }
        if (!present) continue;
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

    // A room over its limit that cannot be seen from here gets a small tag pinned to the nearest
    // edge of the free rectangle, pointing towards it; pressing it goes to the room.
    const edgeAt = new THREE.Vector3();
    const placeAlarms = () => {
      for (const [id, el] of alarms.current) {
        const tag = tags.current.find((t) => t.key === `room:${id}`);
        const pair = edges.get(id);
        const showing = tag?.shown && (tag.alpha > 0.5);
        // Only for a room that really cannot be seen: hidden behind other modules, or out of view.
        // (A tag that gave way to another, or a room too small to name, is still in sight.)
        let away = hidden.get(`room:${id}`) === true;
        if (!away && pair) {
          root.localToWorld(edgeAt.copy(pair[0])).project(camera);
          const sx = ((edgeAt.x + 1) / 2) * width;
          const sy = ((1 - edgeAt.y) / 2) * height;
          away = edgeAt.z > 1 || sx < free.left || sx > width - free.right || sy < free.top || sy > height - free.bottom;
        }
        if (!pair || showing || !away || latest.current.selected) {
          if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
          continue;
        }
        root.localToWorld(edgeAt.copy(pair[0])).project(camera);
        const behind = edgeAt.z > 1;
        let nx = behind ? -edgeAt.x : edgeAt.x;
        let ny = behind ? -edgeAt.y : edgeAt.y;
        if (behind && Math.hypot(nx, ny) < 1e-3) ny = -1;
        // Inside the free rectangle (the top bar is always there, so at least its height is kept clear).
        const top = Math.max(free.top, 64) + 8;
        const left = free.left + 8;
        const right = width - free.right - 8;
        const bottom = height - free.bottom - 8;
        const w2 = el.offsetWidth / 2;
        const h2 = el.offsetHeight / 2;
        const px = ((nx + 1) / 2) * width;
        const py = ((1 - ny) / 2) * height;
        let ex: number;
        let ey: number;
        if (!behind && px > left && px < right && py > top && py < bottom) {
          // On screen but hidden behind something: at the nearest edge, level with it.
          const gaps = [px - left, right - px, py - top, bottom - py];
          const nearest = gaps.indexOf(Math.min(...gaps));
          ex = nearest === 0 ? left + w2 : nearest === 1 ? right - w2 : Math.min(Math.max(px, left + w2), right - w2);
          ey = nearest === 2 ? top + h2 : nearest === 3 ? bottom - h2 : Math.min(Math.max(py, top + h2), bottom - h2);
        } else {
          // Off screen or behind the viewer: out along the line from the middle towards it.
          const cx = (left + right) / 2;
          const cy = (top + bottom) / 2;
          const k = Math.min((right - left) / 2 - w2, (bottom - top) / 2 - h2) / Math.max(Math.hypot(px - cx, py - cy), 1e-3);
          ex = Math.min(Math.max(cx + (px - cx) * k, left + w2), right - w2);
          ey = Math.min(Math.max(cy + (py - cy) * k, top + h2), bottom - h2);
        }
        const arrow = el.querySelector('[data-arrow]') as HTMLElement | null;
        if (arrow) arrow.style.transform = `rotate(${Math.atan2(py - ey, px - ex)}rad)`;
        el.style.visibility = 'visible';
        el.style.transform = `translate(${Math.round(ex - el.offsetWidth / 2)}px, ${Math.round(ey - el.offsetHeight / 2)}px)`;
      }
    };

    // The small looped movement of an exercise: whole limbs swung about the shoulder and hip, out of
    // step from one person to the next. Nothing moves with reduced motion, nor when the person is
    // too small on screen to see it.
    const X_AXIS = new THREE.Vector3(1, 0, 0);
    const swing = new THREE.Quaternion();
    const pivoted = new THREE.Vector3();
    const SHOULDER_L = new THREE.Vector3(-0.18, 1.41, 0);
    const SHOULDER_R = new THREE.Vector3(0.18, 1.41, 0);
    const HIP_L = new THREE.Vector3(-0.079, 0.965, 0);
    const HIP_R = new THREE.Vector3(0.079, 0.965, 0);
    const turnLimb = (limb: THREE.Object3D, pivot: THREE.Vector3, angle: number) => {
      swing.setFromAxisAngle(X_AXIS, angle);
      limb.quaternion.copy(swing);
      limb.position.copy(pivot).sub(pivoted.copy(pivot).applyQuaternion(swing));
    };
    const moveLimbs = (person: Figure, time: number, calm: boolean) => {
      const { limbs } = person;
      const active = !calm && !person.asleep && person.motion !== 'still' && person.holder.visible && person.material.opacity > 0.5;
      if (!active) {
        if (person.moving) {
          for (const limb of [limbs.leftArm, limbs.rightArm, limbs.leftLeg, limbs.rightLeg]) { limb.quaternion.identity(); limb.position.set(0, 0, 0); }
          person.moving = false;
        }
        return;
      }
      person.moving = true;
      const t = time / 1000 + person.phase * 0.37;
      if (person.motion === 'run' || person.motion === 'walk') {
        const run = person.motion === 'run';
        const a = Math.sin(t * Math.PI * 2 * (run ? 1.05 : 0.8)) * (run ? 0.42 : 0.26);
        turnLimb(limbs.leftLeg, HIP_L, -a);
        turnLimb(limbs.rightLeg, HIP_R, a);
        turnLimb(limbs.leftArm, SHOULDER_L, a * 0.7);
        turnLimb(limbs.rightArm, SHOULDER_R, -a * 0.7);
      } else {
        // Pedalling.
        const a = Math.sin(t * Math.PI * 2 * 0.9) * 0.28;
        turnLimb(limbs.leftLeg, HIP_L, -a);
        turnLimb(limbs.rightLeg, HIP_R, a);
      }
    };

    const roomList = [...ship.rooms.values()];
    const peopleList = [...ship.people.values()];
    const eye = new THREE.Vector3();
    const aimAt = new THREE.Vector3();
    const side = (object: LineSegments2, source: LineMaterial, strength: number) => {
      const material = object.material as LineMaterial;
      material.color.copy(source.color);
      material.linewidth = source.linewidth;
      material.opacity = (source.transparent ? source.opacity : 1) * strength;
      object.visible = strength > 0.01;
    };
    let frameId = 0;
    let insetCheck = 0;
    let last = performance.now();
    groundGoal.value = ship.ground ? ship.ground.uniforms.strength.value : 0;
    groundBase.value = groundGoal.value;
    const draw = (time: number) => {
      frameId = requestAnimationFrame(draw);
      if (document.hidden || !onScreen) {
        last = time;
        return;
      }
      if (time - busyAt > SETTLE_MS && time - last < IDLE_FRAME_MS) return;
      const dt = Math.min(0.1, (time - last) / 1000);
      last = time;
      const calm = still.matches;
      const ease = calm ? 1 : 1 - Math.exp(-dt * 5);

      // The insets are read now and then (they can change from CSS alone); a change reframes,
      // keeping the viewer's own zoom and angle if they have one.
      if (insetCheck % 20 === 0) readCovers();
      if (++insetCheck % 20 === 0 && readInsets()) {
        if (!state.moved) state.aim(latest.current.selected);
      }
      if (shift.x !== free.dx || shift.y !== free.dy) {
        shift.x += (free.dx - shift.x) * ease;
        shift.y += (free.dy - shift.y) * ease;
        if (Math.abs(free.dx - shift.x) < 0.5 && Math.abs(free.dy - shift.y) < 0.5) {
          shift.x = free.dx;
          shift.y = free.dy;
        }
        applyShift();
        camera.updateProjectionMatrix();
        busyAt = time;
      }
      if (state.goal.active) {
        busyAt = time;
        camera.position.lerp(state.goal.position, ease);
        controls.target.lerp(state.goal.target, ease);
        if (camera.position.distanceToSquared(state.goal.position) < 1e-4) state.goal.active = false;
      }
      controls.enableDamping = !calm;
      if (controls.update()) busyAt = time;
      const reach = camera.position.distanceTo(controls.target);
      // The fade starts just behind what the camera looks at, so the subject itself is never dimmed;
      // a bigger place fades over a longer reach.
      // In a dust storm the far rooms fade into the dust instead of the dark.
      fog.near = reach + depth * (1 - 0.8 * weather.haze);
      fog.far = reach + 9 * depth * (1 - 0.55 * weather.haze);
      fog.color.copy(bg).lerp(weather.hazeColour, weather.haze);
      // The near plane follows the distance, so a far-off station keeps its depth precision and stays in
      // front of the planet's slice of the depth range (see planet.ts).
      const nearPlane = THREE.MathUtils.clamp(reach * 0.004, 0.1, 2);
      if (Math.abs(camera.near - nearPlane) > 1e-3 || camera.far !== 400 * Math.max(1, depth)) {
        camera.near = nearPlane;
        camera.far = 400 * Math.max(1, depth);
        camera.updateProjectionMatrix();
      }
      // Lines keep their width on screen, so a far-off person or fitting would close up into a
      // solid white shape. As they shrink on screen, their lines thin and dim instead.
      const personPx = (1.79 * height) / (2 * reach * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
      // A person is a dense drawing, so they reach full strength only when large on screen.
      const near = THREE.MathUtils.clamp((personPx - 25) / 175, 0, 1);
      const chosen = latest.current.selected?.kind === 'person' ? ship.people.get(latest.current.selected.id) : undefined;
      for (const person of peopleList) {
        person.material.opacity = (person === chosen ? 1 : 0.4 + 0.5 * near) * (person.ghost ? 0.4 : 1);
        person.material.linewidth = person === chosen ? 1.6 : 0.8 + 0.6 * near;
      }
      for (const room of roomList) room.detail.opacity = 0.45 + 0.55 * near;

      // Seen from the front, the back wall's fittings show; from behind, the front wall's. In
      // between (looking along the station) the two crossfade, so nothing pops as the view turns.
      // Each module is judged by the way its own front faces (for the ship, all along +z).
      root.worldToLocal(eye.copy(camera.position)).sub(root.worldToLocal(aimAt.copy(controls.target))).normalize();
      for (const group of ship.sides) {
        const front = THREE.MathUtils.smoothstep(eye.dot(group.facing), -0.25, 0.25);
        side(group.back, ship.structure, front);
        side(group.front, ship.structure, 1 - front);
      }
      for (const room of roomList) {
        const front = THREE.MathUtils.smoothstep(eye.dot(room.facing), -0.25, 0.25);
        side(room.back, room.detail, front);
        side(room.front, room.detail, 1 - front);
        side(room.frontEdge, room.frame, front);
        side(room.backEdge, room.frame, 1 - front);
        // A declared event's shelter reads a little brighter (the place to go); air leaving blooms pale on every outline.
        const shelter = latest.current.weather?.shelter === room.place.id ? 1 : 0;
        if (shelter || hazards.frost > 0.001) {
          for (const edge of [room.frontEdge, room.backEdge]) {
            const m = edge.material as LineMaterial;
            m.color.lerp(FROST, hazards.frost * 0.6).lerp(WHITE, shelter * 0.5);
            m.linewidth *= 1 + 0.5 * shelter + 0.6 * hazards.frost;
            m.opacity = Math.min(1, m.opacity * (1 + 0.6 * shelter + 0.5 * hazards.frost));
          }
        }
      }

      // Rooms over a limit breathe slowly; with reduced motion they hold steady at full strength.
      const breath = calm ? 1 : 0.7 + 0.3 * (0.5 + 0.5 * Math.sin((time / 2400) * Math.PI * 2));
      for (let i = 0; i < roomList.length; i++) {
        const room = roomList[i];
        room.wall.uniforms.strength.value = room.glow * (room.pulse ? breath : 1);
        const fade = room.wall.uniforms.fade;
        fade.value += (room.wallsShown - fade.value) * (calm ? 1 : 1 - Math.exp(-dt * 6));
        if ((room.pulse && !calm) || Math.abs(room.wallsShown - fade.value) > 1e-3) busyAt = time;
      }

      facing.copy(rootInverse).multiply(camera.quaternion);
      for (let i = 0; i < peopleList.length; i++) {
        const person = peopleList[i];
        if (!person.holder.visible) continue;
        if (person.at.distanceToSquared(person.goal) > 1e-6 || person.moving || (person.haloPulse && !calm)) busyAt = time;
        person.at.lerp(person.goal, person.placed ? ease : 1);
        person.placed = true;
        person.holder.position.copy(person.at);
        // Only someone floating free drifts and sways; at a station they hold their place.
        const drifting = weightless && !calm && !person.asleep && person.roll !== 0;
        moveLimbs(person, time, calm);
        if (drifting) person.holder.position.y += Math.sin(time / 1700 + person.phase) * 0.05;
        person.halo.quaternion.copy(facing);
        person.turn.rotation.z = person.roll + (drifting ? Math.sin(time / 2600 + person.phase) * 0.07 : 0);
        person.haloMaterial.uniforms.strength.value = person.haloGlow * (person.haloPulse ? breath : 1);
      }

      state.backdrop.update(dt, calm);
      if (weather.update(dt, calm, latest.current.weather)) busyAt = time;
      if (hazards.update(dt, calm, latest.current.weather)) busyAt = time;
      root.position.copy(hazards.sway);
      if (ship.ground) {
        const g = ship.ground.uniforms.strength;
        // A dust storm in the air softens the ground under it.
        const groundTo = groundGoal.value * (1 - 0.35 * weather.haze);
        g.value += (groundTo - g.value) * (calm ? 1 : 1 - Math.exp(-dt * 3));
        if (Math.abs(groundTo - g.value) > 1e-3) busyAt = time;
      }
      const dim = dimMaterial.uniforms.strength;
      dim.value += ((chosen ? 1 : 0) - dim.value) * (calm ? 1 : 1 - Math.exp(-dt * 6));
      // A person in close-up drifts and sways at full size on screen: drawn on every frame.
      if (chosen || Math.abs((chosen ? 1 : 0) - dim.value) > 1e-3) busyAt = time;
      if (dim.value > 0.01) {
        lift(chosen);
        dimMaterial.uniforms.portrait.value = state.portrait ? 1 : 0;
        renderer.autoClear = false;
        renderer.clear();
        renderer.render(scene, camera);
        renderer.render(dimScene, flat);
        renderer.clearDepth();
        camera.layers.set(ABOVE);
        renderer.render(scene, camera);
        camera.layers.set(0);
        renderer.autoClear = true;
      } else {
        lift(undefined);
        renderer.render(scene, camera);
      }
      layoutTags(dt, calm);
      placeAlarms();
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
      weather.dispose();
      hazards.dispose();
      ship.dispose();
      dimScene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      dimMaterial.dispose();
      renderer.dispose();
      // Free the drawing buffer and the context now rather than whenever the canvas is collected
      // (a hot reload in development rebuilds the scene on every edit).
      renderer.forceContextLoss();
      renderer.domElement.remove();
      built.current = null;
    };
    // The scene is rebuilt only when the rooms or the crew change; everything else is applied below.
  }, [places, crewKey, mission]);

  // Status colours, strength and where people are, whenever the data changes.
  const statusKey = JSON.stringify([where, ghost, roomStatus, personStatus, doing, selected, props.alarmRoom ?? null]);
  useEffect(() => {
    const state = built.current;
    if (!state) return;
    const { ship } = state;
    state.wake();
    const ink = cssColour('--scene-line', '#f2f3f5');
    const bg = cssColour('--bg', '#0b0c0e');
    const colour = (status: Status) => cssColour(`--status-${status}`, FALLBACK[status]);
    const tone = (material: LineMaterial, target: THREE.Color, strength: number) => material.color.copy(bg).lerp(target, strength);
    const focusRoom = selected?.kind === 'room' ? selected.id : selected ? where[selected.id] ?? null : null;

    const personFocus = selected?.kind === 'person';
    // Two strengths of structure (app.css): the rooms' hulls, and the extras that cannot be
    // interacted with; modules that are not rooms sit between. All dim further while something is selected.
    const hull = cssNumber('--scene-structure-strength', 0.45);
    const extras = cssNumber('--scene-extras-strength', 0.12);
    const dim = selected ? 0.5 : 1;
    tone(ship.structure, ink, hull * dim);
    if (ship.quiet !== ship.structure) tone(ship.quiet, ink, extras * dim);
    if (ship.grid !== ship.structure) tone(ship.grid, ink, extras * 0.6 * dim);
    if (ship.closed !== ship.structure) tone(ship.closed, ink, ((hull + extras) / 2) * dim);
    const over = Object.values(roomStatus).includes('over');
    state.backdrop.mood(over, selected !== null);
    groundGoal.value = groundBase.value * (over ? 0.75 : 1) * (selected ? 0.45 : 1);
    for (const [id, room] of ship.rooms) {
      const status = roomStatus[id] ?? 'unknown';
      const dimmed = focusRoom !== null && focusRoom !== id;
      const focused = focusRoom === id;
      if (status === 'over' || id === props.alarmRoom) {
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
      // Coming in close to a person, the camera can end up beside a neighbouring room, whose
      // end wall would stand between it and them: other rooms' walls step aside.
      // On a station or a base other modules crowd round a room in focus too: theirs step aside then as well.
      room.wallsShown = (personFocus || (selected?.kind === 'room' && mission.kind !== 'ship')) && !focused ? 0 : 1;
      room.pulse = status === 'over';
    }

    const inRoom = new Map<string, string[]>();
    for (const person of crew) {
      const room = seat[person.id];
      if (room) inRoom.set(room, [...(inRoom.get(room) ?? []), person.id]);
    }
    // Stations are given out by person id, so nobody swaps places as others come and go.
    for (const ids of inRoom.values()) ids.sort();
    const sleeping = (id: string, place: (typeof places)[number]) => doing[id] === 'sleeping' && sleepsIn(place);
    // Who is where in each room: at the treadmill, the cycle or the table only when the hub says they
    // are exercising or eating (and the room has that furniture); everyone else in a neutral place.
    // Someone whose own status is over is shown stopped: neutral, still.
    const spots = new Map<string, Spot>();
    for (const [roomId, ids] of inRoom) {
      const place = places.find((p) => p.id === roomId);
      if (!place) continue;
      const free = { exercising: activitySpots(place, 'exercising'), eating: activitySpots(place, 'eating') };
      const neutral: string[] = [];
      for (const id of ids) {
        if (ghost[id]) { neutral.push(id); continue; }
        if (sleeping(id, place)) continue;
        const what = (personStatus[id] ?? 'ok') === 'over' ? 'none' : doing[id];
        const spot = what === 'exercising' || what === 'eating' ? free[what].shift() : undefined;
        if (spot) spots.set(id, spot);
        else neutral.push(id);
      }
      const busy = ids.some((id) => spots.has(id));
      neutral.forEach((id, k) => spots.set(id, neutralSpot(place, k, neutral.length, busy)));
    }
    for (const person of crew) {
      const figure = ship.people.get(person.id);
      if (!figure) continue;
      const place = places.find((p) => p.id === seat[person.id]);
      figure.holder.visible = Boolean(place);
      figure.ghost = Boolean(ghost[person.id]);
      if (!place) {
        figure.placed = false;
        continue;
      }
      const lying = !figure.ghost && sleeping(person.id, place);
      figure.asleep = lying;
      const m = place.frame;
      if (lying) {
        // Sleepers: in their bag (weightless) or on their bunk, by their order among the room's sleepers.
        const sleepers = inRoom.get(place.id)!.filter((id) => sleeping(id, place));
        const bed = bedOf(place, sleepers.indexOf(person.id));
        figure.goal.set(...bed.at).applyMatrix4(m.matrix);
        if (bed.lying) figure.sleep.quaternion.copy(m.quaternion).multiply(turnY.setFromAxisAngle(Y_AXIS, bed.yaw + Math.PI / 2)).multiply(lieDown);
        else figure.sleep.quaternion.copy(m.quaternion).multiply(turnY.setFromAxisAngle(Y_AXIS, bed.yaw - Math.PI / 2));
        // The close-up looks from further round at a bag on a wall, from above at a bunk.
        facingDir.set(0, 0, 1).applyQuaternion(figure.sleep.quaternion);
        figure.lookYaw = bed.lying ? (mission.view?.face ?? 0) : Math.atan2(facingDir.x, facingDir.z) + SLEEPER_TURN;
        figure.lookPitch = bed.lying ? 0.75 : 0.05;
        figure.face.visible = false;
        figure.sleep.visible = true;
        if (figure.sit) figure.sit.visible = false;
      } else {
        const spot = spots.get(person.id)!;
        figure.goal.set(...spot.at).applyMatrix4(m.matrix);
        figure.sleep.visible = false;
        figure.face.visible = true;
        const pose: PoseName = spot.pose;
        figure.motion = figure.ghost ? 'still' : spot.motion;
        if (figure.poseName !== pose) {
          // The neutral pose is each person's own, so four people never look cloned.
          figure.rig.setPose(pose === 'float' || pose === 'stand' ? figure.neutral : POSES[pose]);
          figure.poseName = pose;
        }
        if (spot.yaw !== null) {
          // At a station: turned to it, square to the room (the module's own frame), no tilt.
          figure.face.quaternion.copy(m.quaternion).multiply(turnY.setFromAxisAngle(Y_AXIS, spot.yaw));
          figure.roll = 0;
        } else if (mission.gravity > 0) {
          figure.face.quaternion.setFromAxisAngle(Y_AXIS, (mission.view?.face ?? 0) + (figure.phase % 1.2) - 0.6);
          figure.roll = 0;
        } else {
          figure.face.quaternion.setFromAxisAngle(Y_AXIS, figure.baseYaw + (mission.view?.face ?? 0));
          figure.roll = figure.baseRoll;
        }
      }
      const status = personStatus[person.id] ?? 'ok';
      const dimmed = selected !== null && (selected.kind === 'person' ? selected.id !== person.id : selected.id !== place.id);
      tone(figure.material, status === 'ok' || status === 'unknown' ? ink : colour(status), dimmed ? 0.35 : 1);
      (figure.haloMaterial.uniforms.tint.value as THREE.Color).copy(colour(status));
      figure.haloGlow = HALO[status] * (dimmed ? 0.35 : 1);
      figure.haloPulse = status === 'over';
      if (figure.ghost) figure.haloGlow = 0;
      figure.halo.visible = figure.haloGlow > 0;
    }
  }, [places, crewKey, statusKey, mission]);

  // The selected person's regions in their status colours, and the vessels for a blood finding (bodyPaint.ts).
  const bodyKey = JSON.stringify(props.body ?? null);
  useEffect(() => {
    const state = built.current;
    if (!state) return;
    for (const [id, figure] of state.ship.people) paintFigure(figure, props.body?.person === id ? props.body.states : null);
    state.wake();
  }, [bodyKey, places, crewKey, mission]);

  // Look closer at whatever is selected, or back at the whole station.
  useEffect(() => {
    // With ?demoOrbit/demoZoom the first view is the one asked for; later selections aim as usual.
    if (firstAim.current && demo?.orbit && !selected) {
      firstAim.current = false;
      return;
    }
    firstAim.current = false;
    built.current?.aim(selected);
  }, [selected?.kind, selected?.id, places, mission]);

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
      const [kind, id] = key.split(/:(.*)/s) as ['person' | 'room' | 'group', string];
      const tag: Tag = old ?? {
        key, kind, id, el, w: 0, h: 0, pw: 0, ph: 0, x: 0, y: 0, dx: 0, dy: -1, depth: 0,
        show: false, shown: el.style.visibility !== 'hidden', cand: false, alpha: 0, homeX: 0, homeY: 0, lastX: NaN, lastY: NaN, box: [0, 0, 0, 0],
      };
      tag.w = el.offsetWidth;
      tag.h = el.offsetHeight;
      tag.pw = pill?.offsetWidth ?? tag.w;
      tag.ph = pill?.offsetHeight ?? tag.h;
      next.push(tag);
    }
    tags.current = next;
  });

  const keep = (key: string) => (el: HTMLElement | null) => {
    if (el) labels.current.set(key, el);
    else labels.current.delete(key);
  };
  const roomName = (id: string) => s(rooms.find((r) => r.id === id)?.name ?? id);
  const toggle = (next: NonNullable<Selection>) => onSelect(selected?.kind === next.kind && selected.id === next.id ? null : next);
  const focusRoom = selected?.kind === 'room' ? selected.id : selected ? where[selected.id] ?? null : null;

  if (failed) return null;
  return (
    <div ref={holder} className="station" role="group" aria-label={s('scene.label')}>
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
              {status !== 'ok' && !(status === 'unknown' && demoPlace) && <span className="tag-status"> · {s(`status.${status}`)}</span>}
            </span>
          </button>
        );
      })}
      {crew.filter((person) => places.some((p) => p.id === seat[person.id])).map((person) => {
        const status = personStatus[person.id] ?? 'ok';
        const pressed = selected?.kind === 'person' && selected.id === person.id;
        const dim = selected !== null && !pressed && !(selected.kind === 'room' && selected.id === seat[person.id]);
        const last = ghost[person.id];
        const place = last
          ? `${person.name}, ${s('person.lastSeen', { room: roomName(last.room), time: timeOf(last.at, 'en') })}, ${s(`kind.${last.kind}`)}`
          : s('scene.in', { name: person.name, room: roomName(where[person.id]) });
        return (
          <button key={person.id} ref={keep(`person:${person.id}`)} type="button" className="tag tag-person" data-status={status}
            data-dim={dim ? '' : undefined} data-ghost={last ? '' : undefined}
            aria-label={place + (status === 'ok' ? '' : `. ${s(`status.${status}`)}`)}
            aria-pressed={pressed} onClick={() => toggle({ kind: 'person', id: person.id })}>
            <span className="tag-pill">
              {person.name}
              {last && <span className="tag-status"> · {s('scene.lastSeen', { time: timeOf(last.at, 'en') })}</span>}
              {(status === 'watch' || status === 'over') && <span className="tag-status"> · {s(`status.${status}`)}</span>}
            </span>
          </button>
        );
      })}
      {/* One tag for several people in a room, when their names would crowd: a button for each. */}
      {places.map((place) => {
        const here = crew.filter((person) => where[person.id] === place.id);
        if (here.length < 2) return null;
        return (
          <div key={`group:${place.id}`} ref={keep(`group:${place.id}`)} className="tag tag-person" role="group" aria-label={roomName(place.id)} style={{ visibility: 'hidden' }}>
            <span className="tag-pill">
              {here.map((person, i) => {
                const status = personStatus[person.id] ?? 'ok';
                const pressed = selected?.kind === 'person' && selected.id === person.id;
                return (
                  <span key={person.id}>
                    {i > 0 && <span aria-hidden="true"> · </span>}
                    <button type="button" data-status={status} aria-pressed={pressed}
                      aria-label={s('scene.in', { name: person.name, room: roomName(place.id) }) + (status === 'ok' ? '' : `. ${s(`status.${status}`)}`)}
                      onClick={() => toggle({ kind: 'person', id: person.id })}
                      style={{ background: 'none', border: 0, padding: '0 1px', margin: 0, color: status === 'watch' || status === 'over' ? `var(--status-${status})` : 'inherit', font: 'inherit', cursor: 'pointer' }}>
                      {person.name}
                    </button>
                  </span>
                );
              })}
            </span>
          </div>
        );
      })}
      {/* Tapping outside the selection goes back; this is the same for keyboards (Escape too), shown only when focused. */}
      {places.filter((place) => roomStatus[place.id] === 'over').map((place) => (
        <button key={`alarm:${place.id}`} type="button" className="tag tag-room" data-status="over" style={{ visibility: 'hidden' }}
          ref={(el) => { if (el) alarms.current.set(place.id, el); else alarms.current.delete(place.id); }}
          aria-label={`${roomName(place.id)}, ${s('status.over')}`} onClick={() => onSelect({ kind: 'room', id: place.id })}>
          <span className="tag-pill">
            <span data-arrow="" aria-hidden="true" style={{ display: 'inline-block', marginRight: 4 }}>→</span>
            {roomName(place.id)}<span className="tag-status"> · {s('status.over')}</span>
          </span>
        </button>
      ))}
      {/* Back to the whole place, where everything is named: always there for keyboards (Escape too), shown only when focused. */}
      <button type="button" className="station-home" onClick={() => { built.current?.home(); onSelect(null); }}>{s('scene.whole')}</button>
      {/* Development only (?demoInset): where the insets are, so the framing can be judged. */}
      {demo?.inset && (() => {
        const [top, right, bottom, left] = demo.inset;
        const box = (style: React.CSSProperties, key: string) => (
          <div key={key} aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none', border: '1px dashed rgba(255,255,255,0.28)', boxSizing: 'border-box', ...style }} />
        );
        return [
          top > 0 && box({ top: 0, left: 0, right: 0, height: top }, 'top'),
          bottom > 0 && box({ bottom: 0, left: 0, right: 0, height: bottom }, 'bottom'),
          left > 0 && box({ top, bottom, left: 0, width: left }, 'left'),
          right > 0 && box({ top, bottom, right: 0, width: right }, 'right'),
        ];
      })()}
    </div>
  );
}
