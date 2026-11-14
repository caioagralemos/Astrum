// The hub's main screen: the station fills the window, with the top bar over it.
// The bar's two buttons open what used to be the page below: the bell, alarms
// and alerts (it opens by itself when a new one arrives); the connection icon,
// the hub, the sensors, the link to Earth and the language. Tapping a room or a
// person opens the person view (person/PersonView.tsx); a room, its readings
// in a card. Every word comes from the string table
// and every reading shows how it came to exist.

import { useEffect, useMemo, useRef, useState } from 'react';
import { RecordedSource, chooseSource, useWorld } from './data.ts';
import { current, occupants } from '../../engine/timeline.ts';
import { t } from '../../engine/strings.ts';
import { visibleTo } from '../../engine/alerts.ts';
import { personStatus, roomStatus } from '../../engine/status.ts';
import { Station } from './scene/Station.tsx';
import { PersonView } from './person/PersonView.tsx';
import { AlertsPanel, ConnectionPanel } from './panels.tsx';
import { RoomView } from './room/RoomView.tsx';
import { StationDock } from './dock/StationDock.tsx';
import { useMockAlert } from './demo/mockAlert.ts';
import { Loading } from './Loading.tsx';
import { MainPanels, TopActions, isMainPanel, useStationMission } from './panels/MainPanels.tsx';
import type { MainPanel } from './panels/MainPanels.tsx';
import type { Selection } from './scene/Station.tsx';
import './app.css';
import type { Lang } from '../../engine/strings.ts';

const DAY = 24 * 3600_000;

function startLang(): Lang {
  try {
    const saved = localStorage.getItem('astrum.lang');
    if (saved === 'en' || saved === 'pt') return saved;
  } catch { /* storage can be blocked; the device language still applies */ }
  return navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}


export function App() {
  const source = useMemo(chooseSource, []);
  // `?demoAlert` lays a mock alarm and alerts over the live state, on this screen only (demo/mockAlert.ts).
  const world = useMockAlert(useWorld(source));
  const [lang, setLang] = useState<Lang>(startLang);
  const [selected, setSelected] = useState<Selection>(null);
  const [panel, setPanel] = useState<'alerts' | 'link' | MainPanel | null>(null);
  const s = (key: string, vars?: Record<string, string | number>) => t(key, lang, vars);

  const switchLang = () => {
    const next = lang === 'en' ? 'pt' : 'en';
    setLang(next);
    document.documentElement.lang = next;
    try { localStorage.setItem('astrum.lang', next); } catch { /* not saved, still switched */ }
  };

  // Whose phone this is, if it is one (`?person=<id>`); none on the hub's shared screen.
  const viewer = new URLSearchParams(location.search).get('person');
  // A phone shows its owner what they are told. The hub's shared screen shows only what everyone
  // is told: a question for one person ("Are you OK?") goes to their phone, never the shared screen.
  const alerts = viewer ? visibleTo(world.alerts, viewer) : world.alerts.filter((a) => a.toldTo === 'everyone');
  const active = [...world.alarms.map((a) => `alarm|${a.room}|${a.signal}`), ...alerts.filter((a) => !a.held).map((a) => `alert|${a.id}`)];

  // Something new to see opens the alerts by itself.
  const seen = useRef(new Set<string>());
  const activeKey = active.join(',');
  useEffect(() => {
    if (active.some((key) => !seen.current.has(key))) setPanel('alerts');
    seen.current = new Set(active);
  }, [activeKey]);

  // Escape closes an open panel, or else steps back out of what is selected.
  useEffect(() => {
    if (!panel && !selected) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (panel) setPanel(null);
      else setSelected(null);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [panel, selected]);

  const stationMission = useStationMission(world.profile);
  const { profile, now } = world;
  if (world.restarting) return <main><Loading message={s('settings.restartingAny')} quiet={false} /></main>;
  if (!profile) return <main><Loading message={s(world.status === 'offline' ? 'hub.offline' : 'hub.connecting')} quiet={world.status !== 'offline'} /></main>;

  const values = current(world.latest, now);
  const here = occupants(world.stays, now);
  const where: Record<string, string> = {};
  for (const [room, people] of Object.entries(here)) for (const person of people) where[person] = room;
  const roomStatuses = Object.fromEntries(profile.rooms.map((r) => [r.id, roomStatus(r.id, values, world.alarms, now)]));
  const personStatuses = Object.fromEntries(profile.crew.map((p) => [p.id, personStatus(p.id, alerts)]));
  // The simulated crew sleeps in its quarters from 22:00 to 06:00.
  const hour = new Date(now).getHours();
  const asleep = profile.crew.map((p) => p.id).filter((id) => (hour < 6 || hour >= 22) && where[id]?.startsWith('quarters'));
  const urgent = world.alarms.some((a) => !a.acknowledged) || alerts.some((a) => !a.held && a.level >= 2);
  const toggle = (which: 'alerts' | 'link' | MainPanel) => setPanel((open) => (open === which ? null : which));
  const day = Math.floor((now - Date.parse(profile.missionStart)) / DAY) + 1;

  return (
    <main className="hub">
      <Station rooms={profile.rooms} crew={profile.crew} where={where} roomStatus={roomStatuses} personStatus={personStatuses}
        asleep={asleep} activity={world.activity && Object.fromEntries(Object.entries(world.activity).map(([id, a]) => [id, a.what]))}
        s={s} selected={selected} onSelect={(next) => { setSelected(next); if (next) setPanel(null); }} mission={stationMission} />

      <header className="topbar">
        <h1 className="brand"><img src="brand/logo.svg" alt={s('app.name')} /></h1>
        <p className="topbar-where">{profile.mission?.nameText ?? s(`${profile.place}.short`)} · {s('top.day', { day })}</p>
        <TopActions open={panel} onToggle={toggle} s={s} />
        <button type="button" className="topbar-icon" aria-expanded={panel === 'link'} aria-controls="panel-link"
          aria-label={`${s('top.link')}: ${s(world.status === 'offline' ? 'hub.offline' : world.status === 'replay' ? 'top.link.replay' : 'top.link.live')}`}
          data-off={world.status === 'offline' ? '' : undefined} onClick={() => toggle('link')}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.2a9.5 9.5 0 0 1 13 0M8.6 15.4a5 5 0 0 1 6.8 0" />
            <circle cx="12" cy="18.6" r="1.1" />
            {world.status === 'offline' && <path d="M4 4l16 16" />}
          </svg>
        </button>
        <button type="button" className="topbar-icon" aria-expanded={panel === 'alerts'} aria-controls="panel-alerts"
          aria-label={active.length ? s('top.alerts.count', { count: active.length }) : s('top.alerts')} onClick={() => toggle('alerts')}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2 2 0 0 0 4 0" />
          </svg>
          {active.length > 0 && <span className="badge" data-urgent={urgent ? '' : undefined} aria-hidden="true">{active.length}</span>}
        </button>
      </header>

      {world.status === 'offline' && <p className="banner" role="alert">{s('hub.offline')}</p>}

      {panel === 'alerts' && (
        <AlertsPanel world={world} alerts={alerts} rooms={profile.rooms} crew={profile.crew} now={now} viewer={viewer} s={s} onClose={() => setPanel(null)} />
      )}

      {panel === 'link' && (
        <ConnectionPanel world={world} delaySeconds={profile.delayToEarthSeconds} s={s} onClose={() => setPanel(null)} />
      )}

      {isMainPanel(panel) && (
        <MainPanels which={panel} world={world} profile={profile} selected={selected} lang={lang} s={s} onClose={() => setPanel(null)}
          onLang={(next) => { if (next !== lang) switchLang(); }} />
      )}

      {!selected && (
        <StationDock world={world} profile={profile} values={values} where={where} roomStatus={roomStatuses} personStatus={personStatuses}
          s={s} onSelect={setSelected} onAlerts={() => setPanel('alerts')} />
      )}

      {selected?.kind === 'person' && (() => {
        const person = profile.crew.find((p) => p.id === selected.id);
        return person ? (
          <PersonView person={person} rooms={profile.rooms} crew={profile.crew} latest={values} room={where[person.id] ?? null}
            now={now} s={s} lang={lang} own={viewer === person.id} alerts={alerts.filter((a) => a.person === person.id && !a.held)} />
        ) : null;
      })()}

      {selected?.kind === 'room' && (() => {
        const room = profile.rooms.find((r) => r.id === selected.id);
        if (!room) return null;
        const rows = values.filter((r) => !r.person && r.room === room.id).sort((a, b) => a.signal.localeCompare(b.signal));
        const people = (here[room.id] ?? []).map((id) => ({ id, name: profile.crew.find((p) => p.id === id)?.name ?? id }));
        return <RoomView room={room} status={roomStatuses[room.id] ?? 'unknown'} rows={rows} people={people} now={now} s={s} />;
      })()}

      {world.scenario && (
        <p className="story">
          {s(world.scenario.label)}
          {source instanceof RecordedSource && <> <button type="button" className="btn" onClick={() => source.restart()}>{s('scenario.replay')}</button> <button type="button" className="btn" onClick={() => source.skip()}>{s('scenario.skip')}</button></>}
        </p>
      )}
    </main>
  );
}
