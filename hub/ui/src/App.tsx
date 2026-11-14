// Skeleton screen: proves the data path end to end. It has no design yet; the
// real screens replace it. Every word comes from the string table and every
// reading shows how it came to exist.

import { useMemo, useState } from 'react';
import { RecordedSource, chooseSource, hubAddress, useWorld } from './data.ts';
import { current, isFresh, occupants } from '../../engine/timeline.ts';
import { t } from '../../engine/strings.ts';
import { visibleTo } from '../../engine/alerts.ts';
import { personStatus, roomStatus } from '../../engine/status.ts';
import { Station } from './scene/Station.tsx';
import type { Selection } from './scene/Station.tsx';
import './app.css';
import type { Lang } from '../../engine/strings.ts';
import type { Row } from '../../engine/types.ts';

const DAY = 24 * 3600_000;

function startLang(): Lang {
  try {
    const saved = localStorage.getItem('astrum.lang');
    if (saved === 'en' || saved === 'pt') return saved;
  } catch { /* storage can be blocked; the device language still applies */ }
  return navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function App() {
  const source = useMemo(chooseSource, []);
  const world = useWorld(source);
  const [lang, setLang] = useState<Lang>(startLang);
  const [selected, setSelected] = useState<Selection>(null);
  const s = (key: string, vars?: Record<string, string | number>) => t(key, lang, vars);

  const switchLang = () => {
    const next = lang === 'en' ? 'pt' : 'en';
    setLang(next);
    document.documentElement.lang = next;
    try { localStorage.setItem('astrum.lang', next); } catch { /* not saved, still switched */ }
  };

  const { profile, now } = world;
  if (!profile) return <main><p role="status">{s(world.status === 'offline' ? 'hub.offline' : 'hub.connecting')}</p></main>;

  const values = current(world.latest, now);
  // A phone shows its owner only what the hub tells them. The hub's own window sees everything.
  const viewer = new URLSearchParams(location.search).get('person');
  const alerts = viewer ? visibleTo(world.alerts, viewer) : world.alerts;
  const here = occupants(world.stays, now);
  const where: Record<string, string> = {};
  for (const [room, people] of Object.entries(here)) for (const person of people) where[person] = room;
  const roomStatuses = Object.fromEntries(profile.rooms.map((r) => [r.id, roomStatus(r.id, values, world.alarms, now)]));
  const personStatuses = Object.fromEntries(profile.crew.map((p) => [p.id, personStatus(p.id, alerts)]));
  // The simulated crew sleeps in its quarters from 22:00 to 06:00.
  const hour = new Date(now).getHours();
  const asleep = profile.crew.map((p) => p.id).filter((id) => (hour < 6 || hour >= 22) && where[id]?.startsWith('quarters'));
  const shownRooms = selected?.kind === 'room' ? profile.rooms.filter((r) => r.id === selected.id) : profile.rooms;
  const shownCrew = selected?.kind === 'person' ? profile.crew.filter((p) => p.id === selected.id) : profile.crew;
  const day = Math.floor((now - Date.parse(profile.missionStart)) / DAY) + 1;

  return (
    <main>
      <header>
        <h1 className="brand"><img src="brand/logo.svg" alt={s('app.name')} /></h1>
        <p>
          {s(profile.place)} · {s('top.missionDay', { day })} · {s('top.delay', { time: clock(profile.delayToEarthSeconds) })}
        </p>
        <button type="button" onClick={switchLang} aria-label={lang === 'en' ? 'Mudar para português' : 'Switch to English'}>
          {lang === 'en' ? 'PT' : 'EN'}
        </button>
        {world.status === 'offline' && <p role="alert">{s('hub.offline')}</p>}
        {world.scenario && (
          <p>
            {s(world.scenario.label)}
            {source instanceof RecordedSource && <> <button type="button" onClick={() => source.restart()}>{s('scenario.replay')}</button> <button type="button" onClick={() => source.skip()}>{s('scenario.skip')}</button></>}
          </p>
        )}
      </header>

      {world.alarms.map((alarm) => {
        const room = profile.rooms.find((r) => r.id === alarm.room);
        return (
          <p key={`${alarm.room}|${alarm.signal}`} role="alert">
            <strong>{s('alarm.over', { room: s(room?.name ?? alarm.room), signal: s(`signal.${alarm.signal}`), value: alarm.value, unit: alarm.unit, limit: alarm.limit })}</strong>
            {' '}<small>{s(`kind.${alarm.kind}`)} · {alarm.source}</small>{' '}
            {alarm.acknowledged ? s('alarm.acknowledged') : (
              <button type="button" onClick={() => void fetch(`http://${hubAddress()}/api/alarms/acknowledge`, { method: 'POST', body: JSON.stringify({ room: alarm.room }) })}>
                {s('alarm.acknowledge')}
              </button>
            )}
          </p>
        );
      })}

      {[...new Set(alerts.filter((a) => a.stationWide).map((a) => a.signal))].map((signal) => {
        const group = alerts.filter((a) => a.stationWide && a.signal === signal);
        const first = group[0];
        const roomName = (id: string) => s(profile.rooms.find((r) => r.id === id)?.name ?? id);
        return (
          <div key={`wide|${signal}`} role="alert">
            <p>
              <strong>{s('level.3')}.</strong>{' '}
              {s('alert.stationWide', { signal: s(`signal.${signal}`), count: new Set(group.map((a) => a.room)).size, people: group.map((a) => profile.crew.find((p) => p.id === a.person)?.name ?? a.person).join(', ') })}{' '}
              {first.lowestRoom ? s('alert.lowestRoom', { room: roomName(first.lowestRoom.room), value: first.lowestRoom.value, unit: first.unit ?? '' }) : s('alert.noRoomUnder')}
              {' '}<small>{s(`kind.${first.kind}`)}</small>
            </p>
            {first.card && <p>{s('alert.card', { card: first.card })}</p>}
            {first.earth && <p>{s('alert.earth', { time: clock(Math.max(0, Math.ceil((first.earth.replyAt - now) / 1000))) })}</p>}
          </div>
        );
      })}

      {alerts.filter((alert) => !alert.held && !alert.stationWide).map((alert) => {
        const name = (id: string) => profile.crew.find((p) => p.id === id)?.name ?? id;
        const room = profile.rooms.find((r) => r.id === alert.room);
        const post = (answer: 'ok' | 'help') => void fetch(`http://${hubAddress()}/api/alerts/answer`, { method: 'POST', body: JSON.stringify({ id: alert.id, answer }) });
        return (
          <div key={alert.id} role="alert">
            <p>
              <strong>{s(`level.${alert.level}`)}.</strong>{' '}
              {alert.reason === 'room-limit'
                ? s('alert.roomLimit', { person: name(alert.person), room: s(room?.name ?? ''), signal: s(`signal.${alert.signal}`), value: alert.value ?? '', unit: alert.unit ?? '', limit: alert.limit ?? '' })
                : s('alert.unusual', { person: name(alert.person), signal: s(`signal.${alert.signal}`) })}
              {' '}<small>{s(`kind.${alert.kind}`)} · {s('alert.toldTo', { who: alert.toldTo === 'everyone' ? s('alert.everyone') : alert.toldTo.map(name).join(', ') })}</small>
            </p>
            {alert.level === 2 && alert.answer === null && alert.answerBy !== null && (!viewer || viewer === alert.person) && (
              <p>
                {s('alert.areYouOk', { seconds: Math.max(0, Math.ceil((alert.answerBy - now) / 1000)) })}{' '}
                <button type="button" onClick={() => post('ok')}>{s('alert.ok')}</button>{' '}
                <button type="button" onClick={() => post('help')}>{s('alert.help')}</button>
              </p>
            )}
            {alert.answer === 'ok' && <p>{s('alert.answeredOk')}</p>}
            {alert.card && <p>{s('alert.card', { card: alert.card })}</p>}
            {alert.earth && <p>{s('alert.earth', { time: clock(Math.max(0, Math.ceil((alert.earth.replyAt - now) / 1000))) })}</p>}
          </div>
        );
      })}

      <Station rooms={profile.rooms} crew={profile.crew} where={where} roomStatus={roomStatuses} personStatus={personStatuses}
        asleep={asleep} s={s} selected={selected} onSelect={setSelected} />

      <section aria-labelledby="rooms">
        <h2 id="rooms">{s('hub.rooms')}</h2>
        {shownRooms.map((room) => {
          const rows = values.filter((r) => !r.person && r.room === room.id).sort((a, b) => a.signal.localeCompare(b.signal));
          const people = (here[room.id] ?? []).map((id) => profile.crew.find((p) => p.id === id)?.name ?? id);
          return (
            <article key={room.id}>
              <h3>{s(room.name)}</h3>
              <p>{people.length ? people.join(', ') : s('hub.nobody')}</p>
              {rows.length ? <Readings rows={rows} now={now} s={s} /> : <p>{s('reading.none')}</p>}
            </article>
          );
        })}
      </section>

      <section aria-labelledby="crew">
        <h2 id="crew">{s('hub.crew')}</h2>
        {shownCrew.map((person) => {
          // Blood results get their own screen; the skeleton lists the rest.
          const rows = values.filter((r) => r.person === person.id && !r.signal.startsWith('blood.'));
          return (
            <article key={person.id}>
              <h3>{person.name} <small>{s(person.role)}</small></h3>
              {rows.length ? <Readings rows={rows} now={now} s={s} /> : <p>{s('reading.none')}</p>}
            </article>
          );
        })}
      </section>

      <section aria-labelledby="sensors">
        <h2 id="sensors">{s('hub.sensors')}</h2>
        {world.sources.length === 0 && <p>{s('source.disconnected')}</p>}
        {world.sources.map((src) => (
          <p key={src.id}>
            <strong>{src.id}</strong> · {s(src.connected ? 'source.connected' : 'source.disconnected')}
            {src.missing.length > 0 && <> · {s('source.missing', { list: src.missing.map((k) => s(`signal.${k}`)).join(', ') })}</>}
            {src.connected && src.id.startsWith('chip:') && (['beep', 'alarm', 'off'] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => void fetch(`http://${hubAddress()}/api/buzz`, { method: 'POST', body: JSON.stringify({ mode }) })}>
                {s(mode === 'beep' ? 'chip.beep' : mode === 'alarm' ? 'chip.alarm' : 'chip.alarmOff')}
              </button>
            ))}
          </p>
        ))}
      </section>
    </main>
  );
}

function Readings({ rows, now, s }: { rows: Row[]; now: number; s: (key: string, vars?: Record<string, string | number>) => string }) {
  return (
    <dl>
      {rows.map((row) => (
        <div key={`${row.signal}`}>
          <dt>{s(`signal.${row.signal}`)}</dt>
          <dd>
            {row.value === null ? row.text : `${Number(row.value.toFixed(2))} ${row.unit}`}
            {' '}
            <small>{s(`kind.${row.kind}`)} · {row.source}{isFresh(row, now) ? '' : ` · ${s('reading.stale')}`}</small>
          </dd>
        </div>
      ))}
    </dl>
  );
}
