// V09 chest compressions with gravity. Her description: "WITH gravity. One lies
// on their back on the floor; the other kneels beside them, hands stacked on
// the middle of the chest, arms straight, pressing hard and fast, 2 presses per
// second."
//
// Her answers (videos-answers.md, 14 Nov): 11, "about 5 cm" deep; 12, exactly
// 120 a minute; 13, both hands stacked on the lower half of the breastbone, the
// centre of the chest. Her corrected card (cards.json, cardiac-arrest-gravity,
// step 3, after the ERC 2025 check) says "5 to 6 cm deep", so the chest goes in
// 5.5 cm: it reads as 5 to 6 and is still "about 5". The difference between
// her answer 11 and her card is asked of her, once (`questions`).
//
// 120 a minute in her 3 second loop is 6 presses. The motion is the
// compressions move's (moves/compressions.ts): the kneeling body is solved
// from the floor up, so each press comes from the shoulders over straight arms.
//
// The posture, confirmed by her (15 Nov 2026, relayed by the owner): "the arms
// and the shoulders should be completely straight and make a 90° angle with the
// chest." Elbows locked at every frame, the shoulders right over the hands, the
// arm line at 90° to the chest seen from the side; the camera looks from the
// person's feet side so the right angle shows.

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { InterleavedBufferAttribute } from 'three';
import { CHEST, HAND, PELVIS, UPPER } from '../rig.ts';
import type { Clip, Move } from '../step.ts';
import type { World } from '../world.ts';
import { palmOf } from '../cast.ts';
import { compressionsClip } from './compressions.ts';

// Angle marker added at the medical lead's request, 15 Nov, drawn as an L over
// the scene: a bright line from the contact point up along the arms' axis (the
// wrists' middle to the shoulders' middle) and on past the shoulders, a bright
// line from the contact point along the chest's plane across the breastbone to
// one side (the side-on camera sees it at full length; a head-to-feet line
// would point at the camera), and a small square in the corner. All of it is
// built every frame from the bones as posed, so if the arms were not at 90° the
// corner would not be square. It is lifted a little towards the camera and
// drawn over everything, so no hand covers it. The contact glow is made smaller
// and dimmer here so it does not wash out the corner.
// No number: the owner asked for the angle mark alone, 15 Nov.
// The L lies on the arms' axis and the chest; the square sits in its corner,
// two sides on the strokes. It is drawn last, over a fill in the background
// colour (88%) that masks the hand outlines under it, so it reads as the
// standard right-angle mark. Its sides follow the strokes' directions, measured
// from the bones, so the angle shown is the real one.

/** Past the shoulders, the chest stroke's length, the square's side, the lift towards the camera (metres). */
const ABOVE = 0.25, CHEST_RUN = 0.3, SIDE = 0.075, LIFT = 0.025;
/** Which way the chest stroke goes: +1 towards the rescuer (left on screen), -1 over the person's far side.
 * It goes over the far side (an L, not the reversed L asked for): towards the rescuer it ran into the
 * knees and forearms, and the corner had no open space. */
const STROKE = -1;
/** 1.5 times the figure's line weight (ACTOR.width, 2.4). */
const WEIGHT = 3.6;

/** Line segments whose ends are rewritten every frame (no new objects per frame), drawn over everything. */
function V09Lines(world: World, group: THREE.Group, count: number, width: number, strength: number) {
  const g = new LineSegmentsGeometry();
  g.setPositions(new Array(count * 6).fill(0));
  const material = world.line(width, strength);
  material.depthTest = false;
  material.depthWrite = false;
  material.transparent = true;   // drawn in the transparent pass, so after the fill under it
  const line = new LineSegments2(g, material);
  line.frustumCulled = false;
  line.renderOrder = 30;
  group.add(line);
  const start = g.attributes.instanceStart as InterleavedBufferAttribute;
  const data = start.data.array as Float32Array;
  return {
    set(i: number, a: THREE.Vector3, b: THREE.Vector3) {
      data.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    },
    done() { start.data.needsUpdate = true; },
  };
}

const corner = new THREE.Vector3();

/** A quad in the background colour, nearly opaque, drawn over the figures and under the marker's lines. */
function V09Fill(world: World, group: THREE.Group) {
  const positions = new Float32Array(12);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: world.bg, transparent: true, opacity: 0.88, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 29;
  group.add(mesh);
  const attribute = g.getAttribute('position') as THREE.BufferAttribute;
  return {
    set(i: number, v: THREE.Vector3) { positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z; },
    done() { attribute.needsUpdate = true; },
  };
}
const sh = new THREE.Vector3(), wr = new THREE.Vector3(), meet = new THREE.Vector3(), toCam = new THREE.Vector3();
const front = new THREE.Vector3(), up = new THREE.Vector3(), along = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();

/** The compressions clip with the right-angle marker drawn over it. */
function V09WithAngle(world: World): Clip {
  const clip = compressionsClip(world, 120, 6, 2.05, DEPTH, '5 to 6 cm', 0.5);
  const fill = V09Fill(world, clip.group);
  const marker = V09Lines(world, clip.group, 4, WEIGHT, 1);
  const frame = clip.frame.bind(clip);
  clip.frame = (u, still) => {
    frame(u, still);
    const k = clip.rescuer, p = clip.patient;
    // The arm line: from the wrists' middle up through the shoulders' middle.
    sh.addVectors(k.at[UPPER(0)], k.at[UPPER(1)]).multiplyScalar(0.5);
    wr.addVectors(k.at[HAND(0)], k.at[HAND(1)]).multiplyScalar(0.5);
    up.subVectors(sh, wr).normalize();
    // The chest's plane at the hands, from the person's bones: across the breastbone.
    front.set(0, 0, 1).applyQuaternion(p.q[CHEST]);
    along.subVectors(p.at[PELVIS], p.at[CHEST]).normalize();
    along.crossVectors(front, along).normalize();
    if (along.z * STROKE < 0) along.negate();
    // They meet on the chest's surface under the hands: the arm line carried down to the lower palm's height.
    palmOf(k, 0, a);
    meet.copy(wr).addScaledVector(up, -(wr.y - a.y) / Math.max(1e-3, up.y));
    // The whole marker comes a little towards the camera.
    toCam.subVectors(world.camera.position, meet).normalize();
    meet.addScaledVector(toCam, LIFT);
    // The L: up from the vertex along the arms past the shoulders, and along the chest.
    a.copy(sh).addScaledVector(toCam, LIFT).addScaledVector(up, ABOVE);
    marker.set(0, meet, a);
    a.copy(meet).addScaledVector(along, CHEST_RUN);
    marker.set(1, meet, a);
    // The square in the corner: its two free sides, over a fill that masks what is under it.
    a.copy(meet).addScaledVector(up, SIDE);
    b.copy(a).addScaledVector(along, SIDE);
    marker.set(2, a, b);
    corner.copy(meet).addScaledVector(along, SIDE);
    marker.set(3, b, corner);
    fill.set(0, meet);
    fill.set(1, corner);
    fill.set(2, b);
    fill.set(3, a);
    fill.done();
    marker.done();
  };
  return clip;
}

/** Her card's 5 to 6 cm: the middle of it. */
const DEPTH = 0.055;

export const v09: Move = {
  id: 'V09',
  name: 'V09-chest-compressions-with-gravity',
  summary: 'One lies on their back on the floor; the other kneels beside them, hands stacked on the middle of the chest, arms straight, 2 presses per second.',
  params: {},
  medical: true,
  reviewed: false,
  source: 'Posture: the medical lead, 15 Nov 2026, relayed by the owner: "the arms and the shoulders should be completely straight and make a 90° angle with the chest." Rate, hand position and depth: the medical lead’s answers 11 to 13 (14 Nov 2026) and her cardiac-arrest-gravity card, step 3 ("5 to 6 cm deep, about 2 times per second"). They agree with ILCOR 2020 Adult Basic Life Support CoSTR (Olasveengen et al., Resuscitation 2020;156:A35–A79: "100 to 120/min", "approximately 5 cm … avoiding … greater than 6 cm", "on the lower half of the sternum") and ERC 2025 ("at least 5 cm, not more than 6 cm", as summarised in medical-factcheck/PARA-A-MEDICA.md; not opened here).',
  questions: [
    'V09: your answer 11 says about 5 cm deep, your corrected card says 5 to 6 cm. The animation uses 5.5 cm. Is that right?',
  ],
  variants: { gravity: (world) => V09WithAngle(world) },
};
