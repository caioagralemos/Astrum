// Playback speed for a recording: where its clock is after some real time,
// and the other way round. Pure functions, shared by the browser player and
// the hub's live player, so both play a story at the same pace.

/** [moment, speed] entries: the speed holds from that moment until the next. */
export type SpeedProfile = [number, number][];

/** The profile to use: the recording's own, or real time from its start. */
export function speedProfile(speed: SpeedProfile | undefined, startsAt: number): SpeedProfile {
  const kept = (speed ?? []).filter(([, v]) => v > 0).sort((a, b) => a[0] - b[0]);
  if (!kept.length || kept[0][0] > startsAt) kept.unshift([startsAt, kept[0]?.[1] ?? 1]);
  return kept;
}

/** The speed at one moment of the recording. */
export function speedAt(profile: SpeedProfile, t: number): number {
  let speed = profile[0][1];
  for (const [from, v] of profile) if (t >= from) speed = v;
  return speed;
}

/** Real milliseconds from the recording's start until it reaches moment `t`. */
export function realOffset(profile: SpeedProfile, startsAt: number, t: number): number {
  let real = 0;
  for (let i = 0; i < profile.length; i++) {
    const from = Math.max(profile[i][0], startsAt);
    const until = Math.min(i + 1 < profile.length ? profile[i + 1][0] : Infinity, t);
    if (until > from) real += (until - from) / profile[i][1];
  }
  return real;
}

/** The recording's moment after `real` milliseconds of playing. */
export function momentAfter(profile: SpeedProfile, startsAt: number, real: number): number {
  let left = Math.max(0, real);
  for (let i = 0; i < profile.length; i++) {
    const from = Math.max(profile[i][0], startsAt);
    const until = i + 1 < profile.length ? profile[i + 1][0] : Infinity;
    if (until <= from) continue;
    const span = (until - from) / profile[i][1];
    if (left <= span) return from + left * profile[i][1];
    left -= span;
  }
  return startsAt;
}
