// What the Settings, Ask Astra and Contact Earth panels share. Talking to the
// hub reuses the workbench's helpers (bench/common.tsx), never its layout.

import { call, clock, usePoll } from '../bench/common.tsx';

export { call, clock, usePoll };
export type { Reply } from '../bench/common.tsx';

export type S = (key: string, vars?: Record<string, string | number>) => string;

/** The three panels this folder adds to the main screen. */
export type MainPanel = 'settings' | 'ask' | 'earth';
export const MAIN_PANELS: readonly string[] = ['settings', 'ask', 'earth'];
export const isMainPanel = (panel: string | null): panel is MainPanel => panel !== null && MAIN_PANELS.includes(panel);

/** Who is looking: `?person=<id>` is a crewmate's own screen, `&phone=1` the iPhone app around it. */
export function viewerOf(): { viewer: string | null; phone: boolean } {
  const query = new URLSearchParams(location.search);
  return { viewer: query.get('person'), phone: query.get('phone') === '1' };
}

/** A delay in words: "about 1 second" under a minute, else a clock ("20:00"). */
export function delayText(seconds: number, s: S): { about: boolean; text: string } {
  if (seconds < 60) {
    const n = Number(seconds.toFixed(1));
    return { about: true, text: s(n === 1 ? 'earth.second' : 'earth.seconds', { n: n.toLocaleString() }) };
  }
  return { about: false, text: clock(seconds) };
}

/** A short delay figure for a list: "1.3 s", "20:00". */
export function delayShort(seconds: number): string {
  return seconds < 60 ? `${Number(seconds.toFixed(1))} s` : clock(seconds);
}

/** "14:32" in the screen's language. */
export function timeOf(t: number, lang: string): string {
  return new Date(t).toLocaleTimeString(lang === 'pt' ? 'pt-BR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** What a restart a panel started should say once the screen is back: the panels are drawn again from nothing. */
const AFTER_RESTART = 'astrum.settings.afterRestart';
export function rememberAfterRestart(key: string): void {
  try { sessionStorage.setItem(AFTER_RESTART, key); } catch { /* the note is a convenience */ }
}
export function takeAfterRestart(): string | null {
  try {
    const key = sessionStorage.getItem(AFTER_RESTART);
    sessionStorage.removeItem(AFTER_RESTART);
    return key;
  } catch { return null; }
}

/** The question asked of the model: its state, why it is not ready, how many wait. */
export interface ModelStatus { state: 'loading' | 'ready' | 'unavailable'; reason: string | null; waiting: number }

/** A refusal or failure from the hub: its own English sentence, or "could not reach" when there was none. */
export function HubSaid({ error, s }: { error: string; s: S }) {
  if (!error) return <p className="xsaid" data-bad="">{s('settings.unreachable')}</p>;
  return <p className="xsaid" data-bad="">{s('settings.hubSaid')} <span lang="en">{error}</span></p>;
}
