// The widgets the dock can show when nothing is selected, in the station's
// language: neutral glass, a grey small-caps header (what it is on the left,
// how its numbers came to exist on the right), white light numbers, and colour
// only when something is wrong, always with words.
//
// Each widget is written once and fits every size it lists (quarter, third,
// half, full): it lays its content out for the space it is given (container
// queries in app.css), showing more as it grows. Each also says how relevant
// it is right now and whether it is showing a problem; the smart stack
// (SmartDock.tsx) uses that to choose what is in front.
//
// The dock is a shared screen: it never shows mood, check-in answers, blood
// values or level 1 alerts (those are for the person alone).

import type { ReactNode } from 'react';
import { CO2_LEVELS } from '../../../engine/exposure.ts';
import type { Status } from '../../../engine/status.ts';
import type { Kind, Person, Profile, Room, Row } from '../../../engine/types.ts';
import type { World } from '../data.ts';
import type { Selection } from '../scene/Station.tsx';
import { KindMark } from '../panels.tsx';

export type S = (key: string, vars?: Record<string, string | number>) => string;
export type Size = 'quarter' | 'third' | 'half' | 'full';

export interface DockContext {
  world: World;
  profile: Profile;
  /** The value shown now for every signal and place. */
  values: Row[];
  where: Record<string, string>;
  roomStatus: Record<string, Status>;
  personStatus: Record<string, Status>;
  now: number;
  s: S;
  onSelect: (selection: Selection) => void;
  onAlerts: () => void;
}

export interface Widget {
  id: string;
  sizes: Size[];
  /** 0 to 100: how much it matters now. A problem is 100 and stays in front. */
  score: (c: DockContext) => number;
  problem: (c: DockContext) => boolean;
  render: (c: DockContext) => ReactNode;
}

const HOUR = 3600_000;
const HEADACHE = CO2_LEVELS[0].level;
const LIMIT = CO2_LEVELS[1].level;
const at = (now: number) => new Date(now).getHours();
const night = (now: number) => at(now) >= 22 || at(now) < 7;
const roomName = (c: DockContext, id: string) => c.s(c.profile.rooms.find((r: Room) => r.id === id)?.name ?? id);
const clock = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
const kinds = (rows: (Row | undefined)[]) => [...new Set(rows.filter((r): r is Row => Boolean(r)).map((r) => r.kind))] as Kind[];

function Head({ icon, title, kinds: ks, note, s }: { icon: string; title: string; kinds?: Kind[]; note?: ReactNode; s: S }) {
  return (
    <h2 className="w-head dw-head">
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={icon} /></svg>
      <span className="dw-title">{title}</span>
      <span className="dw-right">{note ?? (ks && ks.map((k) => <KindMark key={k} kind={k} s={s} />))}</span>
    </h2>
  );
}

const ICON = {
  crew: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
  co2: 'M5.2 12H9M15 12h3.8M5.2 12a2.1 2.1 0 1 1-4.2 0 2.1 2.1 0 0 1 4.2 0zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM23 12a2.1 2.1 0 1 1-4.2 0 2.1 2.1 0 0 1 4.2 0z',
  alerts: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2 2 0 0 0 4 0',
  earth: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5z',
  mission: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2',
  exposure: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7v5h4.5',
  sleep: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
  exercise: 'M3.5 9.5v5M6.5 7v10M17.5 7v10M20.5 9.5v5M6.5 12h11',
  board: 'M5 5h14v14H5zM9 9h6v6H9zM9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5',
  radiation: 'M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM10.5 9.4 7.5 4.2A8.5 8.5 0 0 0 3.5 11.5h6M13.5 9.4l3-5.2a8.5 8.5 0 0 1 4 7.3h-6M10.5 14.6l-3 5.2a8.5 8.5 0 0 0 9 0l-3-5.2',
};

// ---------------------------------------------------------------- Crew

const crew: Widget = {
  id: 'crew',
  sizes: ['quarter', 'third', 'half'],
  problem: (c) => Object.values(c.personStatus).some((x) => x === 'watch' || x === 'over'),
  score: () => 60,
  render: (c) => {
    const doing = (p: Person) => {
      const status = c.personStatus[p.id];
      if (status === 'over') return { text: c.s('dock.needsHelp'), tone: 'over' };
      if (status === 'watch') return { text: c.s('status.watch'), tone: 'watch' };
      const what = c.world.activity?.[p.id]?.what ?? (c.world.asleep.includes(p.id) ? 'sleeping' : 'none');
      return { text: what === 'none' ? '' : c.s(`dock.doing.${what}`), tone: '' };
    };
    return (
      <>
        <Head icon={ICON.crew} title={c.s('hub.crew')} s={c.s} note={c.s('dock.onBoard', { count: c.profile.crew.length })} />
        <ul className="dw-rows">
          {c.profile.crew.map((p) => {
            const d = doing(p);
            const room = c.where[p.id];
            return (
              <li key={p.id}>
                <button type="button" className="dw-row" data-tone={d.tone || undefined} onClick={() => c.onSelect({ kind: 'person', id: p.id })}
                  aria-label={[p.name, room ? roomName(c, room) : '', d.text].filter(Boolean).join(', ')}>
                  <span className="dw-name">{p.name}</span>
                  <span className="dw-where">{room ? roomName(c, room) : '–'}</span>
                  <span className="dw-state">{d.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </>
    );
  },
};

// ---------------------------------------------------------------- CO2 in every room

const co2Of = (c: DockContext, room: string) => c.values.find((r) => r.room === room && !r.person && r.signal === 'co2' && r.value !== null);
const tone = (v: number | null | undefined) => (v == null ? 'unknown' : v > LIMIT ? 'over' : v >= HEADACHE ? 'watch' : 'ok');

const co2: Widget = {
  id: 'co2',
  sizes: ['third', 'half', 'full'],
  problem: (c) => c.world.alarms.length > 0 || c.profile.rooms.some((r) => tone(co2Of(c, r.id)?.value) !== 'ok' && tone(co2Of(c, r.id)?.value) !== 'unknown'),
  score: () => 70,
  render: (c) => {
    const LOW = 1.5;
    const HIGH = 3.6;
    const y = (v: number) => `${((Math.min(HIGH, Math.max(LOW, v)) - LOW) / (HIGH - LOW)) * 100}%`;
    const rows = c.profile.rooms.map((r) => ({ room: r, row: co2Of(c, r.id) }));
    const worst = rows.filter((x) => x.row).sort((a, b) => (b.row!.value as number) - (a.row!.value as number))[0];
    const over = rows.filter((x) => tone(x.row?.value) === 'over').length;
    return (
      <>
        <Head icon={ICON.co2} title={c.s('dock.airTitle')} s={c.s} kinds={kinds(rows.map((x) => x.row))}
          note={over ? <span className="dw-bad">{c.s('dock.roomsOver', { count: over })}</span> : undefined} />
        <div className="dw-co2">
          <div className="dw-levels" aria-hidden="true">
            <span style={{ bottom: y(LIMIT) }}><em>{c.s('dock.nasaLimit', { value: LIMIT })}</em></span>
            <span style={{ bottom: y(HEADACHE) }} data-soft=""><em>{c.s('dock.headacheLevel', { value: HEADACHE })}</em></span>
          </div>
          <ul className="dw-cols">
            {rows.map(({ room, row }) => (
              <li key={room.id}>
                <button type="button" onClick={() => c.onSelect({ kind: 'room', id: room.id })}
                  aria-label={[roomName(c, room.id), row ? `${c.s('signal.co2')} ${Number((row.value as number).toFixed(2))} ${row.unit}` : c.s('status.unknown'), row ? c.s(`kind.${row.kind}`) : ''].filter(Boolean).join(', ')}>
                  <span className="dw-col" aria-hidden="true">{row && <span className="dw-col-fill" data-tone={tone(row.value)} style={{ height: y(row.value as number) }} />}</span>
                  <span className="dw-col-value" aria-hidden="true">{row ? (row.value as number).toFixed(1) : '–'}</span>
                  <span className="dw-col-name" aria-hidden="true">{roomName(c, room.id)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {worst?.row && <p className="dw-foot dw-only-full">{c.s('dock.highestNow', { room: roomName(c, worst.room.id), value: (worst.row.value as number).toFixed(2) })}</p>}
      </>
    );
  },
};

// ---------------------------------------------------------------- Alerts

/** What the shared screen may show: room alarms and alerts at level 2 or 3. */
const shared = (c: DockContext) => c.world.alerts.filter((a) => !a.held && a.level >= 2);

const alerts: Widget = {
  id: 'alerts',
  sizes: ['quarter', 'third', 'half'],
  problem: (c) => c.world.alarms.length > 0 || shared(c).length > 0,
  score: () => 45,
  render: (c) => {
    const open = c.world.alarms.length + shared(c).length;
    const first = shared(c)[0];
    const alarm = c.world.alarms[0];
    const name = (id: string) => c.profile.crew.find((p) => p.id === id)?.name ?? id;
    return (
      <>
        <Head icon={ICON.alerts} title={c.s('top.alerts')} s={c.s} />
        <button type="button" className="dw-alerts" data-tone={open ? (c.world.alarms.length || first?.level === 3 ? 'over' : 'watch') : 'ok'} onClick={c.onAlerts}>
          <span className="dw-big">{open}</span>
          <span className="dw-sub">{open ? c.s('dock.openNow') : c.s('dock.allQuiet')}</span>
          {first ? <span className="dw-line">{name(first.person)}{first.room ? `, ${roomName(c, first.room)}` : ''}: {c.s(`level.${first.level}`)}</span>
            : alarm ? <span className="dw-line">{roomName(c, alarm.room)}: {c.s('status.over')}</span>
            : <span className="dw-line dw-muted">{c.s('dock.noRoomOver')}</span>}
        </button>
      </>
    );
  },
};

// ---------------------------------------------------------------- Earth

const inFlight = (c: DockContext) => c.world.earthMessages.filter((m) => m.replyAt > c.now).sort((a, b) => b.sentAt - a.sentAt)[0];

const earth: Widget = {
  id: 'earth',
  sizes: ['quarter', 'third', 'half'],
  problem: () => false,
  score: (c) => (inFlight(c) ? 85 : 40),
  render: (c) => {
    const m = inFlight(c);
    const delay = c.profile.delayToEarthSeconds * 1000;
    const from = m?.from ? c.profile.crew.find((p) => p.id === m.from)?.name ?? m.from : null;
    const progress = m ? Math.min(1, (c.now - m.sentAt) / (m.replyAt - m.sentAt)) : 0;
    return (
      <>
        <Head icon={ICON.earth} title={c.s('dock.earth')} s={c.s} />
        {delay < 60_000 && !m ? (
          <div className="dw-earth">
            <p className="dw-big dw-word">{c.s('dock.live')}</p>
            <p className="dw-label">{c.s('dock.liveNote')}</p>
          </div>
        ) : m ? (
          <div className="dw-earth">
            <p className="dw-label">{c.s('dock.replyIn')}</p>
            <p className="dw-big">{clock(m.replyAt - c.now)}</p>
            <div className="dw-track" aria-hidden="true">
              <span className="dw-track-fill" style={{ width: `${progress * 100}%` }} />
              <span className="dw-track-mid" />
            </div>
            <p className="dw-track-labels dw-not-quarter" aria-hidden="true"><span>{c.s('dock.sent')}</span><span>{c.s('dock.reachesEarth')}</span><span>{c.s('dock.reply')}</span></p>
            {from && <p className="dw-foot dw-not-quarter">{c.s('dock.lastMessage', { name: from })}</p>}
          </div>
        ) : (
          <div className="dw-earth">
            <p className="dw-big">{Math.round(delay / 60_000)}<span className="unit">{c.s('dock.min')}</span></p>
            <p className="dw-label">{c.s('dock.earthDelay')}</p>
            <p className="dw-foot dw-not-quarter">{c.s('dock.replyAfter', { min: Math.round((2 * delay) / 60_000) })}</p>
          </div>
        )}
      </>
    );
  },
};

// ---------------------------------------------------------------- Mission

const mission: Widget = {
  id: 'mission',
  sizes: ['quarter', 'third'],
  problem: () => false,
  score: () => 30,
  render: (c) => {
    const day = Math.floor((c.now - Date.parse(c.profile.missionStart)) / (24 * HOUR)) + 1;
    const m = c.profile.mission;
    const g = m?.gravity ?? 0;
    return (
      <>
        <Head icon={ICON.mission} title={m?.nameText ?? c.s(`${c.profile.place}.short`)} s={c.s} />
        <div className="dw-mission">
          <p className="dw-big">{day}</p>
          <p className="dw-label">{m?.plannedDays ? c.s('dock.dayOf', { days: m.plannedDays }) : c.s('dock.day')}</p>
          {m?.plannedDays ? <div className="dw-track" aria-hidden="true"><span className="dw-track-fill" style={{ width: `${Math.min(100, (day / m.plannedDays) * 100)}%` }} /></div> : null}
          <p className="dw-facts">
            <span>{g === 0 ? c.s('dock.weightless') : c.s('dock.gravity', { g })}</span>
            <span className="dw-not-quarter">{c.profile.delayToEarthSeconds < 60 ? c.s('dock.live') : c.s('dock.delayShort', { min: Math.round(c.profile.delayToEarthSeconds / 60) })}</span>
          </p>
        </div>
      </>
    );
  },
};

// ---------------------------------------------------------------- Exposure

const exposureHours = (c: DockContext) => {
  const card = Object.values(c.world.evidence ?? {})[0];
  const win = card?.whereBeen.windows.reduce((a, b) => (b.ms > a.ms ? b : a), card.whereBeen.windows[0]);
  if (!win) return null;
  return {
    hours: win.ms / HOUR,
    kind: win.people.find((p) => p.kind)?.kind ?? null,
    people: c.profile.crew.map((p) => {
      const mine = win.people.find((x) => x.person === p.id);
      const above = mine?.above.find((a) => a.level === HEADACHE)?.ms ?? 0;
      return { person: p, hours: above / HOUR };
    }),
  };
};

const exposure: Widget = {
  id: 'exposure',
  sizes: ['third', 'half', 'full'],
  problem: () => false,
  score: (c) => ((exposureHours(c)?.people.some((p) => p.hours > 0.25)) ? 80 : 20),
  render: (c) => {
    const e = exposureHours(c);
    if (!e) return <><Head icon={ICON.exposure} title={c.s('dock.exposure', { hours: 72 })} s={c.s} /><p className="dw-muted dw-empty">{c.s('reading.none')}</p></>;
    const top = Math.max(1, ...e.people.map((p) => p.hours));
    const lead = [...e.people].sort((a, b) => b.hours - a.hours)[0];
    const card = lead.hours > 0 ? c.world.evidence?.[lead.person.id] : undefined;
    return (
      <>
        <Head icon={ICON.exposure} title={c.s('dock.exposure', { hours: Math.round(e.hours) })} s={c.s} kinds={e.kind ? [e.kind] : undefined} />
        <p className="dw-label dw-not-quarter">{c.s('dock.exposureWhat', { value: HEADACHE })}</p>
        <ul className="dw-bars">
          {e.people.map(({ person, hours }) => (
            <li key={person.id} aria-label={`${person.name}, ${c.s('dock.hours', { hours: hours.toFixed(1) })}`}>
              <span className="dw-name" aria-hidden="true">{person.name}</span>
              <span className="dw-bar" aria-hidden="true"><span style={{ width: `${(hours / top) * 100}%` }} data-tone={hours > 0 ? 'watch' : undefined} /></span>
              <span className="dw-num" aria-hidden="true">{hours.toFixed(1)}<span className="unit">h</span></span>
            </li>
          ))}
        </ul>
        {card?.pointsTo === 'room' && card.focusRoom && <p className="dw-foot">{c.s('evidence.pointsTo.room', { room: roomName(c, card.focusRoom) })}</p>}
      </>
    );
  },
};

// ---------------------------------------------------------------- Sleep, exercise

const perPerson = (c: DockContext, signal: string) => c.profile.crew.map((p) => ({ person: p, row: c.values.find((r) => r.person === p.id && r.signal === signal && r.value !== null) }));
const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;

function PeopleBars({ c, signal, format, title, icon }: { c: DockContext; signal: string; format: (v: number) => string; title: string; icon: string }) {
  const rows = perPerson(c, signal);
  const top = Math.max(1, ...rows.map((r) => (r.row?.value as number) ?? 0));
  return (
    <>
      <Head icon={icon} title={title} s={c.s} kinds={kinds(rows.map((r) => r.row))} />
      <ul className="dw-bars">
        {rows.map(({ person, row }) => (
          <li key={person.id} aria-label={`${person.name}, ${row ? format(row.value as number) : c.s('reading.none')}`}>
            <span className="dw-name" aria-hidden="true">{person.name}</span>
            <span className="dw-bar" aria-hidden="true">{row && <span style={{ width: `${((row.value as number) / top) * 100}%` }} />}</span>
            <span className="dw-num" aria-hidden="true">{row ? format(row.value as number) : '–'}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

const sleep: Widget = {
  id: 'sleep',
  sizes: ['quarter', 'third', 'half'],
  problem: () => false,
  score: (c) => (night(c.now) || at(c.now) < 10 ? 65 : 35),
  render: (c) => <PeopleBars c={c} signal="sleep_duration" title={c.s('dock.sleep')} icon={ICON.sleep} format={(v) => hm(v)} />,
};

const exercise: Widget = {
  id: 'exercise',
  sizes: ['quarter', 'third', 'half'],
  problem: () => false,
  score: (c) => (Object.values(c.world.activity ?? {}).some((a) => a.what === 'exercising') ? 70 : 30),
  render: (c) => <PeopleBars c={c} signal="exercise_minutes" title={c.s('dock.exercise')} icon={ICON.exercise} format={(v) => `${Math.round(v)}′`} />,
};

// ---------------------------------------------------------------- The real board

const BOARD_SIGNALS = ['temperature', 'humidity', 'pressure', 'noise', 'light', 'vibration', 'co2', 'oxygen', 'air_quality', 'radiation'];

const board: Widget = {
  id: 'board',
  sizes: ['third', 'half', 'full'],
  problem: (c) => c.world.sources.some((src) => src.id.startsWith('chip:') && !src.connected),
  score: () => 35,
  render: (c) => {
    const src = c.world.sources.find((x) => x.id.startsWith('chip:'));
    if (!src) return <><Head icon={ICON.board} title={c.s('dock.board')} s={c.s} /><p className="dw-muted dw-empty">{c.s('source.disconnected')}</p></>;
    const room = src.room ?? c.profile.chips[src.id.replace(/^chip:/, '')] ?? null;
    const rows = BOARD_SIGNALS.map((k) => c.values.find((r) => r.source === src.id && r.signal === k && r.value !== null)).filter((r): r is Row => Boolean(r));
    return (
      <>
        <Head icon={ICON.board} title={`${c.s('dock.board')}${room ? `, ${roomName(c, room)}` : ''}`} s={c.s}
          note={<span className={src.connected ? '' : 'dw-bad'}>{c.s(src.connected ? 'source.connected' : 'source.disconnected')}</span>} />
        <dl className="dw-grid">
          {rows.map((r) => (
            <div key={r.signal}>
              <dt>{c.s(`signal.${r.signal}.short`)}</dt>
              <dd>{Number((r.value as number).toFixed((r.value as number) < 10 ? 2 : 1))}<span className="unit">{r.unit === 'raw' ? '' : r.unit === 'C' ? '°C' : r.unit}</span><KindMark kind={r.kind} s={c.s} /></dd>
            </div>
          ))}
        </dl>
        {src.missing.length > 0 && <p className="dw-foot dw-not-quarter">{c.s('dock.notAnswering', { list: src.missing.map((k) => c.s(`signal.${k}.short`)).join(', ') })}</p>}
      </>
    );
  },
};

// ---------------------------------------------------------------- Radiation

const radiation: Widget = {
  id: 'radiation',
  sizes: ['third', 'half'],
  problem: () => false,
  score: () => 25,
  render: (c) => {
    const rows = c.profile.rooms.map((r) => ({ room: r, row: c.values.find((x) => x.room === r.id && !x.person && x.signal === 'radiation' && x.value !== null) }));
    const known = rows.filter((x) => x.row);
    if (!known.length) return <><Head icon={ICON.radiation} title={c.s('signal.radiation')} s={c.s} /><p className="dw-muted dw-empty">{c.s('reading.none')}</p></>;
    const avg = known.reduce((sum, x) => sum + (x.row!.value as number), 0) / known.length;
    const top = Math.max(...known.map((x) => x.row!.value as number));
    const unit = known[0].row!.unit === 'uGy/day' ? 'µGy/d' : known[0].row!.unit;
    return (
      <>
        <Head icon={ICON.radiation} title={c.s('signal.radiation')} s={c.s} kinds={kinds(known.map((x) => x.row))} />
        <p className="dw-big">{Math.round(avg)}<span className="unit">{unit}</span></p>
        <p className="dw-label">{c.s('dock.stationAverage')}</p>
        <ul className="dw-minicols" aria-hidden="true">
          {rows.map(({ room, row }) => <li key={room.id} title={roomName(c, room.id)}><span style={{ height: row ? `${20 + ((row.value as number) / top) * 80}%` : '0%' }} /></li>)}
        </ul>
      </>
    );
  },
};

export const WIDGETS: Widget[] = [crew, co2, alerts, earth, mission, exposure, sleep, exercise, board, radiation];
