// What the main screen mounts from this folder: the top bar's Ask Astra,
// Contact Earth and Settings buttons (one "More" menu on a phone), the panel
// that is open, and the drawing of the running mission for the station view.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { World } from '../data.ts';
import type { Lang } from '../../../engine/strings.ts';
import type { Mission } from '../../../engine/mission.ts';
import type { Profile } from '../../../engine/types.ts';
import { MISSIONS, placedAt } from '../scene/missions.ts';
import type { MissionName } from '../scene/demo.ts';
import { AskPanel } from './Ask.tsx';
import { EarthPanel } from './Earth.tsx';
import { SettingsPanel } from './Settings.tsx';
import { call, isMainPanel } from './common.tsx';
import type { MainPanel, S } from './common.tsx';
import './panels.css';

export { isMainPanel };
export type { MainPanel };

const ICONS: Record<MainPanel, ReactNode> = {
  // A four-pointed star: Astra's mark, not a face.
  ask: <path d="M12 3.5c.6 4.6 1.9 5.9 6.5 6.5c-4.6.6-5.9 1.9-6.5 6.5c-.6-4.6-1.9-5.9-6.5-6.5c4.6-.6 5.9-1.9 6.5-6.5zM18.5 16.5l.5 2l2 .5l-2 .5l-.5 2l-.5-2l-2-.5l2-.5z" />,
  // Earth: a globe, its equator and a meridian.
  earth: <><circle className="xline" cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5z" /></>,
  // Settings: a gear.
  settings: <><circle className="xline" cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /><circle className="xline" cx="12" cy="12" r="6.6" /></>,
};
const TITLES: Record<MainPanel, string> = { ask: 'ask.title', earth: 'earth.title', settings: 'top.settings' };
const ORDER: MainPanel[] = ['ask', 'earth', 'settings'];

export interface TopActionsProps {
  open: string | null;
  onToggle: (panel: MainPanel) => void;
  s: S;
}

/** The three buttons, beside the connection icon. At phone width they fold into one menu. */
export function TopActions({ open, onToggle, s }: TopActionsProps) {
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!menu) return;
    list.current?.querySelector('button')?.focus();
    const away = (e: Event) => { if (!list.current?.parentElement?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setMenu(false); more.current?.focus(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc, true); };
  }, [menu]);

  return (
    <div className="xtop">
      <div className="xtop-wide">
        {ORDER.map((p) => (
          <button key={p} type="button" className="topbar-icon" aria-expanded={open === p} aria-controls={`panel-${p}`} aria-label={s(TITLES[p])} title={s(TITLES[p])} onClick={() => onToggle(p)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ICONS[p]}</svg>
          </button>
        ))}
      </div>
      <div className="xtop-narrow">
        <button ref={more} type="button" className="topbar-icon xtop-more" aria-expanded={menu || isMainPanel(open)} aria-haspopup="true" aria-controls="xtop-menu"
          aria-label={s('top.more')} onClick={() => setMenu((m) => !m)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="5.5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18.5" cy="12" r="1.3" /></svg>
        </button>
        {menu && (
          <ul ref={list} id="xtop-menu" className="frame xmenu">
            {ORDER.map((p) => (
              <li key={p}>
                <button type="button" aria-pressed={open === p} onClick={() => { setMenu(false); more.current?.focus(); onToggle(p); }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ICONS[p]}</svg>
                  {s(TITLES[p])}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export interface MainPanelsProps {
  which: MainPanel;
  world: World;
  profile: Profile;
  selected: { kind: 'room' | 'person'; id: string } | null;
  lang: Lang;
  onLang: (lang: Lang) => void;
  s: S;
  onClose: () => void;
}

/** The open panel. */
export function MainPanels({ which, world, profile, selected, lang, onLang, s, onClose }: MainPanelsProps) {
  const person = selected?.kind === 'person' ? selected.id : null;
  if (which === 'settings') return <SettingsPanel world={world} lang={lang} onLang={onLang} s={s} onClose={onClose} />;
  if (which === 'ask') return <AskPanel crew={profile.crew} selected={person} lang={lang} s={s} onClose={onClose} />;
  return (
    <EarthPanel messages={world.earthMessages} delaySeconds={profile.delayToEarthSeconds} crew={profile.crew} rooms={profile.rooms}
      now={world.now} selected={person} lang={lang} s={s} onClose={onClose} />
  );
}

const BUILT_IN: Record<string, MissionName> = { 'ship-mars-orbit': 'ship', iss: 'iss', 'base-mars': 'base-mars', 'base-moon': 'base-moon' };

/**
 * The mission the station view draws: the one the hub runs. Built-in places are
 * drawn at once; a place the crew made is fetched from the hub. Undefined
 * (the ship, or ?demoMission) while there is none.
 */
export function useStationMission(profile: Profile | null): Mission | undefined {
  const file = profile?.mission?.file ?? null;
  const demo = new URLSearchParams(location.search).has('demoMission');
  const [fetched, setFetched] = useState<{ file: string; mission: Mission } | null>(null);
  const facts = profile?.mission;
  const body = facts?.where.body ?? null, situation = facts?.where.situation, gravity = facts?.gravity;
  const bundled = file && BUILT_IN[file] ? MISSIONS[BUILT_IN[file]] : null;
  // Drawn where the hub says the place is now: a ship moved in Settings is no longer where its file was
  // built (a built-in one's bundled file), nor where it was when it was fetched (one the crew made).
  const known = useMemo(() => {
    const from = bundled ?? (fetched?.file === file ? fetched.mission : null);
    return from && situation !== undefined && gravity !== undefined ? placedAt(from, { where: { body, situation }, gravity }) : from;
  }, [file, bundled, fetched, body, situation, gravity]);
  useEffect(() => {
    if (!file || bundled || demo) return;
    let live = true;
    void call<{ mission: Mission }>(`/api/missions/${file}`).then((r) => { if (live && r.ok) setFetched({ file, mission: r.data.mission }); });
    return () => { live = false; };
  }, [file]);
  if (demo || !file) return undefined;
  return known ?? undefined;
}
