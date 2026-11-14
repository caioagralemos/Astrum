// Keyframe tracks for the step animations. A track is a list of keys, each a
// time and a value (a number or a fixed-length list of numbers). Between keys
// the value follows a cubic Hermite curve whose tangents are worked out from
// the neighbouring keys (Catmull-Rom on uneven spacing), so motion carries
// through a key instead of stopping at it. A key marked 'still' has a zero
// tangent: the motion settles into it and starts out of it (ease in and out).
// A key marked 'lin' keeps the straight-line speed of the stretch around it:
// a body gliding without anything to push on keeps its speed, so glides are
// written as 'lin' keys and only the push and the catch ease.
//
// Outside its keys a track carries on in a straight line at its end speed,
// which is what lets a loop fade the next round in while it is already moving.
//
// Everything here is a pure function of time: no state, no allocation once a
// track is built, so any frame can be drawn on its own (the capture needs it).

export type Mode = 'auto' | 'still' | 'lin';
export type KeyIn = [number, number | number[], Mode?];

export interface Track {
  times: Float64Array;
  values: Float64Array;
  tangents: Float64Array;
  size: number;
  /** Set for a looping track (see `cycle`): time wraps into [0, period). */
  period?: number;
}

export function track(keys: KeyIn[]): Track {
  const size = typeof keys[0][1] === 'number' ? 1 : (keys[0][1] as number[]).length;
  const n = keys.length;
  const times = new Float64Array(n);
  const values = new Float64Array(n * size);
  const tangents = new Float64Array(n * size);
  keys.forEach(([t, v], i) => {
    times[i] = t;
    if (typeof v === 'number') values[i] = v;
    else for (let k = 0; k < size; k++) values[i * size + k] = v[k];
  });
  for (let i = 0; i < n; i++) {
    const mode = keys[i][2] ?? 'auto';
    for (let k = 0; k < size; k++) {
      let m = 0;
      if (mode !== 'still' && n > 1) {
        const v = (j: number) => values[j * size + k];
        if (mode === 'lin') {
          // The speed of the stretch on the side that is itself a glide (or the mean of both).
          const before = i > 0 ? (v(i) - v(i - 1)) / (times[i] - times[i - 1]) : null;
          const after = i < n - 1 ? (v(i + 1) - v(i)) / (times[i + 1] - times[i]) : null;
          m = before === null ? after! : after === null ? before : (before + after) / 2;
        } else if (i === 0) m = (v(1) - v(0)) / (times[1] - times[0]);
        else if (i === n - 1) m = (v(n - 1) - v(n - 2)) / (times[n - 1] - times[n - 2]);
        else m = (v(i + 1) - v(i - 1)) / (times[i + 1] - times[i - 1]);
      }
      tangents[i * size + k] = m;
    }
  }
  return { times, values, tangents, size };
}

/** The value of a track at time t, written into out (from offset). */
export function sample(tr: Track, t: number, out: Float64Array | number[], offset = 0): void {
  const { times, values, tangents, size } = tr;
  if (tr.period) t = ((t % tr.period) + tr.period) % tr.period;
  const n = times.length;
  if (n === 1 || t <= times[0]) {
    const dt = n === 1 ? 0 : t - times[0];
    for (let k = 0; k < size; k++) out[offset + k] = values[k] + tangents[k] * dt;
    return;
  }
  if (t >= times[n - 1]) {
    const dt = t - times[n - 1];
    const b = (n - 1) * size;
    for (let k = 0; k < size; k++) out[offset + k] = values[b + k] + tangents[b + k] * dt;
    return;
  }
  let i = 0;
  // Few keys per track: a straight scan is faster than a search.
  while (times[i + 1] < t) i++;
  const t0 = times[i];
  const h = times[i + 1] - t0;
  const s = (t - t0) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const a = i * size;
  const b = a + size;
  for (let k = 0; k < size; k++) {
    out[offset + k] = h00 * values[a + k] + h10 * h * tangents[a + k] + h01 * values[b + k] + h11 * h * tangents[b + k];
  }
}

const one = new Float64Array(1);
export function sample1(tr: Track, t: number): number {
  sample(tr, t, one, 0);
  return one[0];
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
/** 0 before a, 1 after b, smooth in between. */
export const ramp = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
export const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * A track that loops: keys over one loop of length `period`, starting at t = 0. The value at
 * `period` is the value at 0 again, and the speed through the seam is continuous (tangents are
 * worked out across it), so the loop has no seam at all. Do not repeat the first key at the end.
 * Times outside [0, period) wrap.
 */
export function cycle(keys: KeyIn[], period: number): Track {
  const n = keys.length;
  if (n === 1) return { ...track(keys), period };
  const wrapped: KeyIn[] = [[keys[n - 1][0] - period, keys[n - 1][1], keys[n - 1][2]], ...keys, [keys[0][0] + period, keys[0][1], keys[0][2]], [(keys[1] ?? keys[0])[0] + period, (keys[1] ?? keys[0])[1], (keys[1] ?? keys[0])[2]]];
  const tr = track(wrapped);
  return { ...tr, period };
}
