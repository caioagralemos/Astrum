// The workbench: one plain page where every feature of the hub can be tried
// against the live hub, before the designed screens exist. Same data layer,
// same string table, same language switch as the hub's own screen.

import { useMemo, useState } from 'react';
import { chooseSource, hubAddress, useWorld } from '../data.ts';
import type { Lang } from '../../../engine/strings.ts';
import { makeS } from './common.tsx';
import type { PanelProps } from './common.tsx';
import { Ask } from './Ask.tsx';
import { EvidencePanel } from './Evidence.tsx';
import { Alerts } from './Alerts.tsx';
import { Checkin } from './Checkin.tsx';
import { Blood } from './Blood.tsx';
import { Sensors } from './Sensors.tsx';
import { Board } from './Board.tsx';
import { Story } from './Story.tsx';
import { Quality } from './Quality.tsx';

const SECTIONS: [string, string][] = [
  ['ask', 'bench.ask.title'], ['evidence', 'evidence.title'], ['alerts', 'bench.al.title'], ['checkin', 'bench.ci.title'], ['blood', 'blood.title'],
  ['sensors', 'hub.sensors'], ['board', 'bench.bd.title'], ['story', 'bench.st.title'], ['quality', 'bench.q.title'],
];

function startLang(): Lang {
  try {
    const saved = localStorage.getItem('astrum.lang');
    if (saved === 'en' || saved === 'pt') return saved;
  } catch { /* storage can be blocked; the device language still applies */ }
  return navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export function Bench() {
  const source = useMemo(chooseSource, []);
  const world = useWorld(source);
  const [lang, setLang] = useState<Lang>(startLang);
  const [me, setMe] = useState(() => new URLSearchParams(location.search).get('person') ?? 'reyes');
  const s = makeS(lang);
  document.documentElement.lang = lang;
  document.title = s('bench.title');

  const switchLang = () => {
    const next = lang === 'en' ? 'pt' : 'en';
    setLang(next);
    try { localStorage.setItem('astrum.lang', next); } catch { /* not saved, still switched */ }
  };
  const choose = (id: string) => {
    setMe(id);
    const url = new URL(location.href);
    url.searchParams.set('person', id);
    history.replaceState(null, '', url);
  };

  const { profile } = world;
  const person = profile?.crew.some((p) => p.id === me) ? me : profile?.crew[0]?.id ?? me;
  const props: PanelProps | null = profile ? { world, profile, me: person, lang, s } : null;

  return (
    <main className="bench">
      <header className="bench-head">
        <div>
          <h1>{s('bench.title')}</h1>
          <p className="muted">{s('bench.intro')}</p>
        </div>
        <div className="row">
          {profile && (
            <label className="field inline-field">
              <span>{s('bench.iAm')}</span>
              <select value={person} onChange={(e) => choose(e.target.value)}>
                {profile.crew.map((p) => <option key={p.id} value={p.id}>{p.name} ({s(p.role)})</option>)}
              </select>
            </label>
          )}
          <button type="button" onClick={switchLang} aria-label={s('bench.langSwitch')}>{s('bench.langButton')}</button>
        </div>
        <p role="status">
          {world.status === 'live' && profile ? s('bench.live') : world.status === 'replay' ? s('bench.replay') : s(world.status === 'offline' ? 'hub.offline' : 'hub.connecting')}
          {' · '}{s('bench.hubAt', { address: hubAddress() })}
        </p>
        {world.scenario && <p className="warning" role="status">{s('bench.scenarioShown', { name: s(world.scenario.label) })}</p>}
        <nav aria-label={s('bench.sections')}>
          <ul>{SECTIONS.map(([id, key]) => <li key={id}><a href={`#${id}`}>{s(key)}</a></li>)}</ul>
        </nav>
      </header>

      {props && (
        <div className="grid">
          <Ask {...props} />
          <EvidencePanel {...props} />
          <Alerts {...props} />
          <Checkin {...props} />
          <Blood {...props} />
          <Board {...props} />
          <Sensors {...props} />
          <Story {...props} />
          <Quality {...props} />
        </div>
      )}
    </main>
  );
}
