// The crew as line figures. Everyone floats: there is no standing or sitting
// in orbit, so the poses are the relaxed crouch the body falls into without
// weight, a swimmer pushing off, a drift with arms loose, and someone reading.
// Four poses so four people never look cloned. A sleeper is drawn straight,
// arms folded, for the sleeping bag on their cabin wall.
//
// Figures are flat drawings about 1.5 m tall, centred on the middle of the
// body, in the XY plane; the scene turns awake figures to face the camera.

import type { Pen } from './pen.ts';

type P = [number, number];

/** Joints of one pose: head centre, neck, hips, then each arm and leg as [joint, end]. */
interface Pose {
  head: P;
  neck: P;
  hips: P;
  shoulders?: [P, P];
  arms: [P, P][];
  legs: [P, P][];
  /** How far the whole figure is turned, in radians. */
  roll: number;
  /** Extra lines, such as a tablet in the hands. */
  extra?: [P, P][];
}

export const POSES: Pose[] = [
  // The neutral body posture: knees up, arms floating forward at chest height.
  {
    head: [0.07, 0.6], neck: [0.03, 0.46], hips: [-0.03, -0.06],
    arms: [[[0.2, 0.28], [0.36, 0.4]], [[0.13, 0.22], [0.31, 0.29]]],
    legs: [[[0.25, -0.3], [0.07, -0.62]], [[0.18, -0.37], [-0.02, -0.66]]],
    roll: 0.12,
  },
  // Pushing off: one arm reaching ahead, the other along the body, legs trailing.
  {
    head: [0.03, 0.6], neck: [0.02, 0.46], hips: [-0.01, -0.06],
    arms: [[[0.12, 0.66], [0.2, 0.9]], [[-0.05, 0.18], [-0.02, -0.1]]],
    legs: [[[0.04, -0.42], [0.0, -0.78]], [[-0.09, -0.38], [-0.2, -0.72]]],
    roll: -1.2,
  },
  // Drifting, seen from the front: arms loose and raised, legs apart.
  {
    head: [0, 0.6], neck: [0, 0.46], hips: [0, -0.06],
    shoulders: [[-0.14, 0.41], [0.14, 0.41]],
    arms: [[[-0.33, 0.27], [-0.46, 0.41]], [[0.34, 0.31], [0.42, 0.52]]],
    legs: [[[-0.17, -0.4], [-0.27, -0.7]], [[0.2, -0.38], [0.16, -0.72]]],
    roll: 0.16,
  },
  // Reading a tablet, legs tucked.
  {
    head: [-0.06, 0.6], neck: [-0.02, 0.46], hips: [0.03, -0.06],
    arms: [[[-0.16, 0.24], [-0.32, 0.36]], [[-0.1, 0.2], [-0.28, 0.3]]],
    legs: [[[-0.27, -0.14], [-0.08, -0.42]], [[-0.21, -0.22], [-0.01, -0.48]]],
    extra: [[[-0.4, 0.27], [-0.3, 0.5]]],
    roll: -0.3,
  },
];

export const SLEEPER: Pose = {
  head: [0, 0.6], neck: [0, 0.47], hips: [0, -0.04],
  shoulders: [[-0.12, 0.4], [0.12, 0.4]],
  arms: [],
  legs: [[[-0.08, -0.36], [-0.05, -0.68]], [[0.08, -0.36], [0.05, -0.68]]],
  roll: 0,
};

/** Draw one pose with the pen, at the pen's origin. The roll is left to the scene. */
export function drawPose(pen: Pen, pose: Pose) {
  const [hx, hy] = pose.head;
  pen.circle(hx, hy, 0, 0.12, 'xy', 16);
  const line = (a: P, b: P) => pen.seg(a[0], a[1], 0, b[0], b[1], 0);
  line(pose.neck, pose.hips);
  const shoulders = pose.shoulders ?? [[pose.neck[0], pose.neck[1] - 0.05], [pose.neck[0], pose.neck[1] - 0.05]] as [P, P];
  if (pose.shoulders) line(pose.shoulders[0], pose.shoulders[1]);
  pose.arms.forEach(([elbow, hand], i) => {
    line(shoulders[i], elbow);
    line(elbow, hand);
  });
  const hips: [P, P] = [[pose.hips[0] - (pose.shoulders ? 0.08 : 0), pose.hips[1]], [pose.hips[0] + (pose.shoulders ? 0.08 : 0), pose.hips[1]]];
  if (pose.shoulders) line(hips[0], hips[1]);
  pose.legs.forEach(([knee, foot], i) => {
    line(hips[i], knee);
    line(knee, foot);
  });
  for (const [a, b] of pose.extra ?? []) line(a, b);
}
