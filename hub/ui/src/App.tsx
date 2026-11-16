// The hub's main screen: the station fills the window, with the top bar over it.
// The bar's two buttons open what used to be the page below: the bell, alarms
// and alerts (it opens by itself when a new one arrives); the connection icon,
// the hub, the sensors, the link to Earth and the language. Tapping a room or a
// person opens the person view (person/PersonView.tsx); a room, its readings
// in a card. Every word comes from the string table
// and every reading shows how it came to exist.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RecordedSource, chooseSource, useRecordedState, useWorld } from './data.ts';
import { IntroCard } from './demo/Intro.tsx';
import { PhoneView, TakeSwitch } from './demo/PhoneTake.tsx';
import type { TakeSide } from './demo/PhoneTake.tsx';
import { current, lastSeen, occupants } from '../../engine/timeline.ts';
import type { LastSeen } from '../../engine/timeline.ts';
import { t } from '../../engine/strings.ts';
import { isSettled, visibleTo } from '../../engine/alerts.ts';
import { bodyLines, statesOf } from './person/BodyFigure.tsx';
import { personStatus, roomStatus } from '../../engine/status.ts';
import { dayOf } from '../../engine/mission.ts';
import { Station } from './scene/Station.tsx';
import { PersonView } from './person/PersonView.tsx';
import { AlertsPanel, ConnectionPanel, forgetSilenced } from './panels.tsx';
import { RoomView } from './room/RoomView.tsx';
import { StationDock } from './dock/StationDock.tsx';
import { useMockAlert } from './demo/mockAlert.ts';
import { Loading } from './Loading.tsx';
import { Emergency } from './emergency/Emergency.tsx';
import { Steps } from './emergency/Steps.tsx';
import { Beat2Zoom } from './emergency/Beat2Zoom.tsx';
import { useEarthReplyTone } from './sound.ts';
import type { Alert } from '../../engine/alerts.ts';
import { MainPanels, TopActions, isMainPanel, useStationMission } from './panels/MainPanels.tsx';
import type { MainPanel } from './panels/MainPanels.tsx';
import type { Selection } from './scene/Station.tsx';
import { WEATHER_KINDS } from './scene/weather.ts';
import type { Weather, WeatherKind } from './scene/weather.ts';
import './app.css';
import type { Lang } from '../../engine/strings.ts';
import { Onboarding } from './onboarding/Onboarding.tsx';

function startLang(): Lang {
  try {
    const saved = localStorage.getItem('astrum.lang');
    if (saved === 'en' || saved === 'pt') return saved;
  } catch { /* storage can be blocked; the device language still applies */ }
  return navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}


const TAKEN_KEY = 'astrum.emergency.taken';
const occurrence = (a: Alert) => `${a.id}|${a.levelSince}`;

export function App() {
  const source = useMemo(chooseSource, []);
  // `?demoAlert` lays a mock alarm and alerts over the live state, on this screen only (demo/mockAlert.ts).
  const world = useMockAlert(useWorld(source));
  const recorded = useRecordedState(source);
  // The narrator leaves 10 s after the recording reaches its end; a replay from the start brings it back.
  const [narratorDone, setNarratorDone] = useState(false);
  const atEnd = recorded.endsAt !== null && world.now >= recorded.endsAt;
  useEffect(() => {
    if (!atEnd) { setNarratorDone(false); return; }
    const t = setTimeout(() => setNarratorDone(true), 10_000);
    return () => clearTimeout(t);
  }, [atEnd]);
  // Replay only: a scenario filmed on the phone in the same take can show that side instead (demo/PhoneTake.tsx).
  const [takeSide, setTakeSide] = useState<TakeSide>('hub');
  const [lang, setLang] = useState<Lang>(startLang);
  const [selected, setSelected] = useState<Selection>(null);
  const [panel, setPanel] = useState<'alerts' | 'link' | MainPanel | null>(null);
  const s = (key: string, vars?: Record<string, string | number>) => t(key, lang, vars);
  // The emergency's steps, open for one alert's card. `?demoSteps=<card id>` opens a card's steps on this screen only (development).
  const [steps, setSteps] = useState<{ alert: Alert | null; card: string } | null>(() => {
    const demo = import.meta.env.DEV ? new URLSearchParams(location.search).get('demoSteps') : null;
    return demo ? { alert: null, card: demo } : null;
  });
  // A recorded story waits at its emergency until the viewer has been through the steps (data.ts, meta.holdAt).
  const stepsWereOpen = useRef(false);
  useEffect(() => {
    if (steps) stepsWereOpen.current = true;
    else if (stepsWereOpen.current) { stepsWereOpen.current = false; if (source instanceof RecordedSource) source.release(); }
  }, [source, steps]);

  // The takeover's second screen (emergency/Beat2Zoom.tsx): after the tap, the camera on the alert's room and
  // its panel, until the alert ends, is settled, or Earth's reply is in and someone closes it. Each occurrence
  // (alert id and levelSince) is remembered for this tab, so a reload goes straight back to it.
  const [taken, setTaken] = useState<Record<string, 'open' | 'released'>>(() => {
    try { return JSON.parse(sessionStorage.getItem(TAKEN_KEY) ?? '{}') as Record<string, 'open' | 'released'>; } catch { return {}; }
  });
  const take = (alert: Alert, how: 'open' | 'released') => setTaken((prev) => {
    const next = { ...prev, [occurrence(alert)]: how };
    try { sessionStorage.setItem(TAKEN_KEY, JSON.stringify(next)); } catch { /* not remembered: a reload shows the first screen again */ }
    return next;
  });
  const [zoomHeight, setZoomHeight] = useState(0);
  // The first-run setup (onboarding/): `?onboarding=1` opens it; a hub never set up opens it by itself; Settings opens it again.
  const [setup, setSetup] = useState(() => new URLSearchParams(location.search).get('onboarding') === '1');
  const setupForced = world.profile?.setupDone === false;

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
  // Earth's replies (any: simulated, or a recorded story's) are informational items in the alerts list until this screen
  // opens or marks them read. Kept in memory per screen. Every screen gets the same messages to Earth as the Earth panel.
  // Read replies are remembered on this screen (localStorage), and a reply that was already there when the page
  // opened is not news: only replies that arrive while the page is open show as unread.
  const [earthRead, setEarthRead] = useState<ReadonlySet<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('astrum.earthRead') ?? '[]') as string[]); } catch { return new Set(); }
  });
  const earthSeeded = useRef(false);
  useEffect(() => {
    if (earthSeeded.current || world.profile === null) return;
    earthSeeded.current = true;
    const here = world.earthMessages.filter((m) => m.reply).map((m) => m.id);
    if (here.length) setEarthRead((was) => new Set([...was, ...here]));
  }, [world.profile, world.earthMessages]);
  useEffect(() => {
    try { localStorage.setItem('astrum.earthRead', JSON.stringify([...earthRead].slice(-200))); } catch { /* private window: memory only */ }
  }, [earthRead]);
  const [earthFocus, setEarthFocus] = useState<string | null>(null);
  const unreadEarth = earthSeeded.current ? world.earthMessages.filter((m) => m.reply && !earthRead.has(m.id)).sort((a, b) => b.reply!.at - a.reply!.at) : [];
  const readEarth = (id: string) => setEarthRead((was) => new Set([...was, id]));
  const openEarth = (id: string | null) => { if (id) readEarth(id); setEarthFocus(id); setPanel('earth'); };
  // A new reply (not one already here when the page got the hub's state): one soft tone (sound.ts).
  useEarthReplyTone(world.earthMessages, world.profile !== null);
  const active = [...world.alarms.map((a) => `alarm|${a.room}|${a.signal}`), ...alerts.filter((a) => !a.held).map((a) => `alert|${a.id}`), ...unreadEarth.map((m) => `earth|${m.id}`)];

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

  // The story's strip is as tall as its words need (one line on a wide window, more on a phone or in
  // a longer language); the dock and the panels above it move up by exactly that much.
  const story = useRef<HTMLParagraphElement>(null);
  const storyShown = Boolean(world.scenario && world.profile && !world.restarting);
  useLayoutEffect(() => {
    const el = story.current;
    const hub = el?.parentElement;
    if (!el || !hub) return;
    const fit = () => hub.style.setProperty('--story-room', `${Math.ceil(el.offsetHeight) + 5}px`);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => { watch.disconnect(); hub.style.removeProperty('--story-room'); };
  }, [storyShown]);

  const stationMission = useStationMission(world.profile);
  // A declared base-wide event also shows in the view (scene/weather.ts, scene/hazards.ts), with its shelter kept clear.
  const weather: Weather = {};
  for (const alert of world.alerts) {
    if (!alert.declared) continue;
    const kind: string = alert.declared.kind;
    if ((WEATHER_KINDS as readonly string[]).includes(kind)) weather[kind as WeatherKind] = alert.declared.stage;
    if (alert.declared.shelter) weather.shelter = alert.declared.shelter;
  }
  const { profile, now } = world;
  if (world.restarting) return <main><Loading message={s('settings.restartingAny')} quiet /></main>;
  if (!profile) return <main><Loading message={s(world.status === 'offline' ? 'hub.offline' : 'hub.connecting')} quiet={world.status !== 'offline'} /></main>;

  const values = current(world.latest, now);
  const here = occupants(world.stays, now);
  const where: Record<string, string> = {};
  for (const [room, people] of Object.entries(here)) for (const person of people) where[person] = room;
  // Someone in no room is never just gone: the last room the hub knew for them, shown as "last seen".
  // Display only; `where` (live) is what anything judging a room uses.
  const lastPlace: Record<string, LastSeen> = {};
  const fromStays = lastSeen(world.stays, now);
  for (const person of profile.crew) {
    if (where[person.id]) continue;
    const a = fromStays[person.id], b = world.lastSeen?.[person.id];
    const last = a && b ? (a.at >= b.at ? a : b) : a ?? b;
    if (last) lastPlace[person.id] = last;
  }
  const roomStatuses = Object.fromEntries(profile.rooms.map((r) => [r.id, roomStatus(r.id, values, world.alarms, now)]));
  const personStatuses = Object.fromEntries(profile.crew.map((p) => [p.id, personStatus(p.id, alerts)]));
  // The simulated crew sleeps in its quarters from 22:00 to 06:00.
  const hour = new Date(now).getHours();
  const asleep = profile.crew.map((p) => p.id).filter((id) => (hour < 6 || hour >= 22) && where[id]?.startsWith('quarters'));
  const urgent = world.alarms.some((a) => !a.acknowledged) || alerts.some((a) => !a.held && a.level >= 2);
  // The emergency's details, after its first screen. For now the alerts, at that alert; the next screens replace this.
  // The emergency's steps card, one step per page (emergency/Steps.tsx). The next screen of the takeover calls this.
  const openEmergencySteps = (alert: Alert) => {
    if (!alert.card) return;
    setSelected(null);
    setPanel(null);
    setSteps({ alert, card: alert.card });
  };
  // The zoomed view: the newest level 3 occurrence opened here and not settled or released.
  const zoomed = alerts
    .filter((a) => a.level === 3 && !a.held && !isSettled(a) && taken[occurrence(a)] === 'open')
    .sort((a, b) => b.levelSince - a.levelSince)[0] ?? null;
  const zoomTarget: Selection = zoomed
    ? zoomed.room ? { kind: 'room', id: zoomed.room } : where[zoomed.person] ? { kind: 'person', id: zoomed.person } : null
    : null;
  const zoomEarth = zoomed?.earthId ? world.earthMessages.find((m) => m.id === zoomed.earthId) ?? null : null;
  const zoomReply = zoomEarth?.reply ?? null;
  const openEmergency = (alert: Alert) => {
    setPanel(null);
    setSelected(null); // the scene is given the alert's room while it lasts (zoomTarget)
    take(alert, 'open');
  };
  const toggle = (which: 'alerts' | 'link' | MainPanel) => setPanel((open) => (open === which ? null : which));
  const day = dayOf(profile, now);
  // The selected person's body as the data display: only what this screen may see (alerts above),
  // plus readings the hub judges unusual for them (person/regions.ts). The figure and the list share it.
  const bodyPerson = !zoomed && selected?.kind === 'person' ? profile.crew.find((p) => p.id === selected.id) ?? null : null;
  const body = bodyPerson ? bodyLines(alerts.filter((a) => a.person === bodyPerson.id && !a.held), world.evidence?.[bodyPerson.id]?.unusual.signals ?? [],
    values.filter((r) => r.person === bodyPerson.id), s, bodyPerson.name, viewer === bodyPerson.id) : [];

  return (
    <main className="hub" data-take={recorded.phone ? takeSide : undefined}>
      {/* A recorded scenario's context card, over the hub before it plays (replay only). */}
      {recorded.intro && source instanceof RecordedSource && <IntroCard intro={recorded.intro} lang={lang} s={s} onStart={() => source.begin()} />}
      <Station weather={weather} rooms={profile.rooms} crew={profile.crew} where={where} lastSeen={lastPlace} roomStatus={roomStatuses} readRooms={[...new Set(values.filter((r) => r.room && !r.person && r.value !== null).map((r) => r.room as string))]} personStatus={personStatuses}
        asleep={asleep} activity={world.activity && Object.fromEntries(Object.entries(world.activity).map(([id, a]) => [id, a.what]))}
        s={s} selected={zoomed ? zoomTarget : selected} onSelect={(next) => { if (zoomed) return; setSelected(next); if (next) setPanel(null); }} mission={stationMission} body={bodyPerson ? { person: bodyPerson.id, states: statesOf(body) } : null}
        alarmRoom={zoomed?.room ?? null} inset={zoomed ? { top: 84, bottom: zoomHeight + 32 } : undefined} roomZoom={zoomed ? 0.55 : undefined} />

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
        <AlertsPanel world={world} alerts={alerts} rooms={profile.rooms} crew={profile.crew} now={now} viewer={viewer} lang={lang} s={s} onClose={() => setPanel(null)}
          onSteps={openEmergencySteps} earthReplies={unreadEarth} onOpenEarth={openEarth} onReadEarth={readEarth} />
      )}

      {panel === 'link' && (
        <ConnectionPanel world={world} delaySeconds={profile.delayToEarthSeconds} s={s} onClose={() => setPanel(null)} />
      )}

      {isMainPanel(panel) && (
        <MainPanels which={panel} world={world} profile={profile} selected={selected} lang={lang} s={s} onClose={() => setPanel(null)} earthFocus={earthFocus}
          onLang={(next) => { if (next !== lang) switchLang(); }} onSetup={() => { setPanel(null); setSetup(true); }} />
      )}

      {!selected && !zoomed && (
        <StationDock world={world} profile={profile} values={values} where={where} lastSeen={lastPlace} roomStatus={roomStatuses} personStatus={personStatuses}
          s={s} onSelect={setSelected} onAlerts={() => setPanel('alerts')} onEarth={openEarth} earthUnread={unreadEarth.length} />
      )}

      {!zoomed && selected?.kind === 'person' && (() => {
        const person = profile.crew.find((p) => p.id === selected.id);
        return person ? (
          <PersonView person={person} rooms={profile.rooms} crew={profile.crew} latest={values} room={where[person.id] ?? null} lastSeen={lastPlace[person.id] ?? null}
            now={now} s={s} lang={lang} own={viewer === person.id} alerts={alerts.filter((a) => a.person === person.id && !a.held)}
            dose={world.dose?.[person.id] ?? null} followUp={viewer === person.id ? world.followUp ?? null : null} recorded={Boolean(world.scenario)} body={body} recordedEvidence={world.evidence?.[person.id] ?? null} />
        ) : null;
      })()}

      {!zoomed && selected?.kind === 'room' && (() => {
        const room = profile.rooms.find((r) => r.id === selected.id);
        if (!room) return null;
        const rows = values.filter((r) => !r.person && r.room === room.id).sort((a, b) => a.signal.localeCompare(b.signal));
        const people = (here[room.id] ?? []).map((id) => ({ id, name: profile.crew.find((p) => p.id === id)?.name ?? id }));
        return <RoomView room={room} status={roomStatuses[room.id] ?? 'unknown'} rows={rows} people={people} now={now} s={s} />;
      })()}

      {recorded.phone && <>
        <TakeSwitch side={takeSide} onSide={setTakeSide} s={s} />
        <PhoneView take={recorded.phone} now={now} playing={world.status === 'replay'} shown={takeSide === 'phone'} s={s} />
      </>}

      {/* The narrator: the story's current beat in one plain line, so someone watching from outside knows what is happening. */}
      {(() => {
        if (!recorded.started || recorded.intro || narratorDone || world.status !== 'replay' || !recorded.captions.length) return null;
        const line = [...recorded.captions].reverse().find((c) => c.at <= now);
        if (!line) return null;
        const text = typeof line.text === 'string' ? line.text : (lang === 'pt' && line.text.pt) || line.text.en;
        return (
          <div className="caption-wrap">
            <p className="caption" role="status" aria-live="polite"><span key={text}>{text}</span></p>
            <p className="caption-hint">{s('scenario.explore')}</p>
          </div>
        );
      })()}

      {/* What reached a phone or a cabin board at this beat: a banner that slides in, stays a few seconds and goes. */}
      {recorded.notices.length > 0 && recorded.started && world.status === 'replay' && !recorded.intro && (
        <div className="notices" aria-live="polite">
          {recorded.notices.filter((n) => n.at <= now && n.at >= Math.max(...recorded.notices.filter((m) => m.at <= now).map((m) => m.at))).map((n, i) => (
            <div key={`${n.at}-${i}`} className="notice" data-kind={n.kind} style={{ animationDelay: `${i * 0.35}s` }}>
              <p className="notice-on">{n.on}</p>
              <div className="notice-card">
                {n.kind === 'phone'
                  ? <img className="notice-app notice-icon" src="brand/app-icon.png" alt="" aria-hidden="true" />
                  : <span className="notice-app" aria-hidden="true">◉</span>}
                <div><p className="notice-title">{n.title}</p><p className="notice-body">{n.body}</p></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {world.scenario && (
        <p ref={story} className="story">
          {s(world.scenario.label)}
          {/* The web replay's strip: the label and the way back to the site (the owner's call: no Replay, Skip or Another scenario). */}
          {source instanceof RecordedSource && <> <a className="btn" href="../">{s('scenario.back')}</a></>}
        </p>
      )}

      {zoomed && (
        <Beat2Zoom key={occurrence(zoomed)} alert={zoomed} alarms={world.alarms} rooms={profile.rooms} crew={profile.crew} now={now} viewer={viewer} lang={lang} s={s}
          reply={zoomReply} replyLabel={zoomEarth?.simulated === 'ai' ? (zoomEarth.simulatedBy === 'fixed' ? 'earth.simulatedFixed' : 'earth.simulatedByAi') : null} replyAt={zoomEarth?.replyAt ?? null} simulatedDelay={zoomEarth?.simulatedDelay === true} report={zoomEarth?.report ?? null} recorded={Boolean(world.scenario)} paused={Boolean(steps)} onContinue={openEmergencySteps} onHeight={setZoomHeight}
          onRelease={() => take(zoomed, 'released')} />
      )}

      <Emergency alerts={alerts} rooms={profile.rooms} crew={profile.crew} s={s} onOpen={openEmergency}
        skip={(a) => isSettled(a) || occurrence(a) in taken} />

      {(setup || setupForced) && !viewer && (
        <Onboarding world={world} lang={lang} s={s} forced={setupForced} onLang={(next) => { if (next !== lang) switchLang(); }} onClose={() => setSetup(false)} />
      )}

      {steps && (
        <Steps key={`${steps.card}|${steps.alert?.id ?? ''}`} alert={steps.alert} cardId={steps.card} gravity={profile.mission?.gravity ?? null}
          lang={lang} s={s} onClose={() => setSteps(null)} />
      )}
    </main>
  );
}
