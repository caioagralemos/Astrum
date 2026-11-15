// When the alerts panel closes by itself (panels.tsx): once everything it was
// showing has gone, it holds "Nothing needs attention" for a beat, so the
// change is seen and heard, and then closes. Never when it was opened empty
// and has shown nothing since (someone looking on purpose), and never while
// someone is pointing or moving focus inside it: then it waits for them to
// finish, and a little longer.

/** How long the empty panel stays before closing, ms. */
export const EMPTY_BEAT_MS = 1500;
/** How long it waits after someone stops interacting with it, ms. */
export const AFTER_USE_MS = 600;

export interface AutoClose {
  /** It has shown at least one alert or alarm since it opened. */
  hadItems: boolean;
  /** When the list last became empty (ms), or null while it is not. */
  emptySince: number | null;
}

export const openedWith = (count: number): AutoClose => ({ hadItems: count > 0, emptySince: null });

/** The list now holds `count` items, at `now`. */
export function noteCount(state: AutoClose, count: number, now: number): AutoClose {
  if (count > 0) return { hadItems: true, emptySince: null };
  if (!state.hadItems || state.emptySince !== null) return state;
  return { ...state, emptySince: now };
}

/**
 * How long until it should close, ms (0: now), or null when it should not
 * (yet). `quietSince` is when someone last stopped interacting with it.
 */
export function closeIn(state: AutoClose, now: number, interacting: boolean, quietSince = -Infinity): number | null {
  if (!state.hadItems || state.emptySince === null || interacting) return null;
  return Math.max(0, state.emptySince + EMPTY_BEAT_MS - now, quietSince + AFTER_USE_MS - now);
}
