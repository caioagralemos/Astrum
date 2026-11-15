// The widgets the dock can show when nothing is selected, in the station's
// language: a clear title with its icon, values under small labelled rows set
// apart by hairlines, an optional footer line, and colour only when something
// is wrong, always with words. How each number came to exist (its kind mark)
// sits right after the number, or at the header's right when the widget
// shows many numbers as one picture (bars, columns).
// The surface itself (tint, grid, outline, corners, ink) is the hub's one
// projection look, from app.css; nothing here draws it.
//
// Each widget is written once and fits every size it lists (quarter, third,
// half, full): it lays its content out for the space it is given (container
// queries in app.css), showing more as it grows. Each also says how relevant
// it is right now and whether it is showing a problem; the smart stack
// (SmartDock.tsx) uses that to choose what is in front.
//
// The dock is a shared screen: it never shows mood, check-in answers, blood
// values or level 1 alerts (those are for the person alone).

import { useState } from 'react';
import type { ReactNode } from 'react';
import { CO2_LEVELS } from '../../../engine/exposure.ts';
import type { Status } from '../../../engine/status.ts';
import { dayOf } from '../../../engine/mission.ts';
import type { Kind, Person, Profile, Room, Row } from '../../../engine/types.ts';
import type { World } from '../data.ts';
import type { Selection } from '../scene/Station.tsx';
import { KindMark } from '../panels.tsx';
import type { LastSeen } from '../../../engine/timeline.ts';
import { timeOf } from '../panels/common.tsx';
import { SignalIcon } from '../person/icons.tsx';

export type S = (key: string, vars?: Record<string, string | number>) => string;
export type Size = 'quarter' | 'third' | 'half' | 'full';

export interface DockContext {
  world: World;
  profile: Profile;
  /** The value shown now for every signal and place. */
  values: Row[];
  where: Record<string, string>;
  /** Display only: where each person in no room was last seen (engine/timeline.ts lastSeen). */
  lastSeen?: Record<string, LastSeen>;
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
/** A reading as the board shows it: two decimals under 10, one above; the unit as the hub names it. */
const num = (v: number) => String(Number(v.toFixed(v < 10 ? 2 : 1)));
const unitText = (unit: string) => (unit === 'raw' ? '' : unit === 'C' ? '°C' : unit);

const ICON = {
  crew: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
  cabin: 'M3 9.5c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0 3 1.4 4.5 0M3 14.5c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0 3 1.4 4.5 0',
  co2: 'M5.2 12H9M15 12h3.8M5.2 12a2.1 2.1 0 1 1-4.2 0 2.1 2.1 0 0 1 4.2 0zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM23 12a2.1 2.1 0 1 1-4.2 0 2.1 2.1 0 0 1 4.2 0z',
  alerts: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2 2 0 0 0 4 0',
  earth: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8.2 4.4c.3 1.3-.6 2-1.5 2.7-.9.7-1.2 1.7-.5 2.6.7.9 2 .7 2.8 1.5.8.8.3 2 .9 2.9.5.8 1.6.9 1.8 1.9.2 1-.6 1.8-.5 2.8.1.6.4 1.1.9 1.6M14.6 3.9c-.7.9-.3 1.9.6 2.4.9.5 2 .2 2.7 1 .6.7.2 1.7.9 2.4.4.4 1 .5 1.5.4M15.2 13.2c.9-.5 2-.2 2.5.6.5.8.1 1.8-.6 2.4-.5.4-.8.9-.8 1.6',
  mission: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2',
  exposure: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7v5h4.5',
  sleep: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
  exercise: 'M3.5 9.5v5M6.5 7v10M17.5 7v10M20.5 9.5v5M6.5 12h11',
  board: 'M5 5h14v14H5zM9 9h6v6H9zM9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5',
  radiation: 'M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM10.5 9.4 7.5 4.2A8.5 8.5 0 0 0 3.5 11.5h6M13.5 9.4l3-5.2a8.5 8.5 0 0 1 4 7.3h-6M10.5 14.6l-3 5.2a8.5 8.5 0 0 0 9 0l-3-5.2',
  // Footer glyphs.
  home: 'M4 10.5 12 4l8 6.5v9a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5z',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2',
  send: 'M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4z',
  down: 'M12 4v15M6.5 13.5 12 19l5.5-5.5',
  warn: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2v.1',
};

function Glyph({ d, className }: { d: string; className: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={d} /></svg>;
}

function Head({ icon, title, kinds: ks, note, s }: { icon: string; title: string; kinds?: Kind[]; note?: ReactNode; s: S }) {
  return (
    <h2 className="dw-head">
      <Glyph d={icon} className="dw-icon" />
      <span className="dw-title">{title}</span>
      {(note || ks?.length) ? <span className="dw-right">{note}{ks?.map((k) => <KindMark key={k} kind={k} s={s} />)}</span> : null}
    </h2>
  );
}

/** One value under its label row (icon, name); its kind mark follows the value. */
function Stat({ icon, label, kind, s, children }: { icon?: ReactNode; label: string; kind?: Kind; s: S; children: ReactNode }) {
  return (
    <div className="dw-stat">
      <p className="dw-stat-label">{icon}<span className="dw-stat-name">{label}</span></p>
      <p className="dw-stat-value">{children}{kind && <KindMark kind={kind} s={s} />}</p>
    </div>
  );
}

interface FootItem { key: string; icon: string; text: ReactNode; className?: string }

/** The footer under a hairline: one line per item, each with its glyph. */
function Foot({ items, className }: { items: (FootItem | null | false | undefined)[]; className?: string }) {
  const shown = items.filter((i): i is FootItem => Boolean(i));
  if (!shown.length) return null;
  return (
    <div className={`dw-foot${className ? ` ${className}` : ''}`}>
      {shown.map((i) => (
        <p key={i.key} className={`dw-foot-item${i.className ? ` ${i.className}` : ''}`}><Glyph d={i.icon} className="dw-foot-icon" /><span>{i.text}</span></p>
      ))}
    </div>
  );
}

/**
 * A crewmate's picture: their photo when the mission gives one, otherwise the
 * same head and shoulders for everyone, drawn in facets like the station's line
 * figures, turned three quarters and cropped as a portrait. Decorative: the
 * tile's button names them.
 */
export function Portrait({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="dw-portrait" aria-hidden="true">
      {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : (
        <svg viewBox="0 0 48 48" preserveAspectRatio="xMidYMax slice" focusable="false">
          <path d="M23 7 30 9.5 33 15 35 20 33 25.5 28 29.5 21 29 16 25 14 17 16 10Z" />
          <path d="M30 9.5 27 16 33 15M27 16 35 20M16 10 22 19 27 16M14 17 22 19 21 29M27 16 29 23 35 20M29 23 33 25.5M29 23 28 29.5M22 19 29 23" />
          <path d="M19.5 29.2 18.5 34M27.5 29.8 28 34M1 48 4 40 14 35.5 18.5 34 23.5 39 28 34 35 36 44 40 47 48M14 35.5 16 48M35 36 33 48M23.5 39V48M4 40 9 48M44 40 40 48" />
        </svg>
      )}
    </span>
  );
}

/**
 * Placeholder portraits for a simulated crew (public/crew, each marked "AI"): three of women, three of men.
 * A crewmate gets one from the set that goes with their pronouns or, for the names the hub picks
 * (engine/names.ts), with the name; anyone else keeps the line figure. Handed out in crew order.
 */
const PORTRAITS = { she: ['crew/crew-2.jpg', 'crew/crew-1.jpg', 'crew/crew-3.jpg'], he: ['crew/crew-4.jpg', 'crew/crew-5.jpg', 'crew/crew-6.jpg'] };
const NAMES_SHE = new Set(['Sally', 'Mae', 'Peggy', 'Christina', 'Jessica', 'Kathleen', 'Anne', 'Nicole', 'Kayla', 'Jasmin', 'Serena', 'Megan', 'Karen',
  'Tracy', 'Ellen', 'Eileen', 'Mary', 'Joan', 'Shannon', 'Kate', 'Sunita', 'Kalpana', 'Valentina', 'Elena', 'Anna', 'Svetlana', 'Marina', 'Samantha',
  'Sophie', 'Rosemary', 'Sara', 'Naoko', 'Chiaki', 'Yaping', 'Julie', 'Roberta', 'Jenni', 'Katya', 'Soyeon', 'Reyes', 'Okafor']);
const NAMES_HE = new Set(['Marcos', 'Pedro', 'José', 'Fernando', 'Carlos', 'Victor', 'Raja', 'Michael', 'Scott', 'Mark', 'Robert', 'Warren', 'Frank',
  'Franklin', 'Neil', 'Sidney', 'Reid', 'Yuri', 'Alexei', 'Sergei', 'Oleg', 'Gennady', 'Anton', 'Mikhail', 'Dmitri', 'Pyotr', 'Andrei', 'Nikolai', 'Ivan',
  'Talgat', 'Leonid', 'Luca', 'Thomas', 'Alexander', 'Matthias', 'Tim', 'André', 'Andreas', 'Christer', 'Marcus', 'Pablo', 'Paolo', 'Umberto', 'Dirk',
  'Franz', 'Bertalan', 'Tibor', 'Vladimír', 'Dumitru', 'Georgi', 'Mirosław', 'Raphaël', 'John', 'Koichi', 'Satoshi', 'Akihiko', 'Kimiya', 'Norishige',
  'Soichi', 'Takuya', 'Mamoru', 'Makoto', 'Liwei', 'Haipeng', 'Zhigang', 'Haisheng', 'Chris', 'Marc', 'David', 'Jeremy', 'Joshua', 'Rakesh', 'Sultan',
  'Ali', 'Mohammed', 'Rodolfo', 'Arnaldo', 'Abdul', 'Ilan', 'Eytan', 'Alper', 'Leo', 'Tanaka',
  // Once in the list, and still saved on missions started then.
  'Claude']);
function demoPortraits(people: { id: string; name: string; pronouns?: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = { she: 0, he: 0 };
  for (const p of people) {
    const set = p.pronouns === 'she' ? 'she' : p.pronouns === 'he' ? 'he' : NAMES_SHE.has(p.name) ? 'she' : NAMES_HE.has(p.name) ? 'he' : null;
    if (set) out[p.id] = PORTRAITS[set][used[set]++ % PORTRAITS[set].length];
  }
  return out;
}

// ---------------------------------------------------------------- Crew

const crew: Widget = {
  id: 'crew',
  sizes: ['quarter', 'third', 'half'],
  problem: (c) => Object.values(c.personStatus).some((x) => x === 'watch' || x === 'over'),
  score: () => 60,
  render: (c) => {
    // The example crew is simulated: its portraits are AI-generated pictures of nobody, and the card says so.
    const simulatedCrew = c.values.some((r) => Boolean(r.person) && r.kind === 'simulated');
    const demo = simulatedCrew ? demoPortraits(c.profile.crew) : {};
    const shown = c.profile.crew.some((p) => !p.portrait && demo[p.id]);
    const doing = (p: Person) => {
      const status = c.personStatus[p.id];
      if (status === 'over') return { text: c.s('dock.needsHelp'), tone: 'over' };
      if (status === 'watch') return { text: c.s('status.watch'), tone: 'watch' };
      const what = c.world.activity?.[p.id]?.what ?? (c.world.asleep.includes(p.id) ? 'sleeping' : 'none');
      return { text: what === 'none' ? '' : c.s(`dock.doing.${what}`), tone: '' };
    };
    return (
      <>
        <Head icon={ICON.crew} title={c.s('hub.crew')} s={c.s} note={c.s('dock.aboard', { count: c.profile.crew.length })} />
        <ul className="dw-tiles">
          {c.profile.crew.map((p) => {
            const d = doing(p);
            const room = c.where[p.id];
            const last = room ? undefined : c.lastSeen?.[p.id];
            const place = room ? roomName(c, room)
              : last ? `${c.s('person.lastSeen', { room: roomName(c, last.room), time: timeOf(last.at, 'en') })}, ${c.s(`kind.${last.kind}`)}`
              : c.s('person.whereUnknown');
            const label = [p.name, place, d.text].filter(Boolean).join(', ');
            return (
              <li key={p.id}>
                <button type="button" className="dw-tile" data-tone={d.tone || undefined} onClick={() => c.onSelect({ kind: 'person', id: p.id })}
                  aria-label={label} title={label}>
                  <Portrait src={p.portrait ?? demo[p.id]} />
                  <span className="dw-tile-name" aria-hidden="true">
                    {d.tone && <span className="dw-dot" data-tone={d.tone} />}
                    <span>{p.name}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {simulatedCrew && shown && <p className="dw-crew-note">{c.s('dock.crewPortraits')}</p>}
      </>
    );
  },
};

// ---------------------------------------------------------------- CO2, for the Cabin widget

const co2Of = (c: DockContext, room: string) => c.values.find((r) => r.room === room && !r.person && r.signal === 'co2' && r.value !== null);
const tone = (v: number | null | undefined) => (v == null ? 'unknown' : v > LIMIT ? 'over' : v >= HEADACHE ? 'watch' : 'ok');
const roomsOver = (c: DockContext) => c.profile.rooms.filter((r) => tone(co2Of(c, r.id)?.value) === 'over').length;
const co2Problem = (c: DockContext) => c.world.alarms.length > 0 || c.profile.rooms.some((r) => tone(co2Of(c, r.id)?.value) !== 'ok' && tone(co2Of(c, r.id)?.value) !== 'unknown');
/** The room with the most CO2 now, if any room has a reading. */
const worstCo2 = (c: DockContext) => c.profile.rooms
  .map((r) => ({ room: r, row: co2Of(c, r.id) }))
  .filter((x): x is { room: Room; row: Row } => Boolean(x.row))
  .sort((a, b) => (b.row.value as number) - (a.row.value as number))[0];

// ---------------------------------------------------------------- Cabin

const CABIN_SIGNALS = ['co2', 'temperature', 'pressure'];

/** The room the sensor board is in; without a board, the first room with readings. */
function cabinRoom(c: DockContext): string | null {
  const src = c.world.sources.find((x) => x.id.startsWith('chip:'));
  const board = src ? src.room ?? c.profile.chips[src.id.replace(/^chip:/, '')] ?? null : null;
  if (board) return board;
  return c.profile.rooms.find((r) => c.values.some((v) => v.room === r.id && !v.person && v.value !== null))?.id ?? null;
}

/** A room's reading of one signal, the board's own when it has one. */
function roomReading(c: DockContext, room: string, signal: string): Row | undefined {
  const rows = c.values.filter((r) => r.room === room && !r.person && r.signal === signal && r.value !== null);
  return rows.find((r) => r.source.startsWith('chip:')) ?? rows[0];
}

// In the old CO2 widget's place: its sizes, its problem and its rank, no more.
const cabin: Widget = {
  id: 'cabin',
  sizes: ['third', 'half', 'full'],
  problem: co2Problem,
  score: () => 70,
  render: (c) => {
    const room = cabinRoom(c);
    const rows = CABIN_SIGNALS.map((k) => (room ? roomReading(c, room, k) : undefined));
    const worst = worstCo2(c);
    const over = roomsOver(c);
    const newest = Math.max(0, ...rows.map((r) => r?.t ?? 0));
    const age = c.now - newest;
    const updated = age < 60_000 ? c.s('dock.updatedNow')
      : age < HOUR ? c.s('dock.updatedMin', { min: Math.round(age / 60_000) })
      : c.s('dock.updatedHours', { hours: Math.round(age / HOUR) });
    return (
      <>
        <Head icon={ICON.cabin} title={c.s('dock.cabin')} s={c.s} note={room ? roomName(c, room) : undefined} />
        <div className="dw-stats">
          {CABIN_SIGNALS.map((k, i) => {
            const r = rows[i];
            return (
              <Stat key={k} icon={<SignalIcon signal={k} />} label={c.s(`signal.${k}.short`)} kind={r?.kind} s={c.s}>
                {r ? <>{num(r.value as number)}<span className="unit">{unitText(r.unit)}</span></> : '–'}
              </Stat>
            );
          })}
        </div>
        <Foot items={[
          over > 0 && { key: 'over', icon: ICON.warn, text: c.s('dock.roomsOver', { count: over }), className: 'dw-bad dw-not-quarter' },
          worst && { key: 'worst', icon: over > 0 ? ICON.warn : ICON.home, className: over > 0 ? 'dw-bad dw-worst' : undefined,
            text: c.s('dock.highestCo2', { room: roomName(c, worst.room.id), value: `${num(worst.row.value as number)} ${worst.row.unit}` }) },
          newest > 0 && { key: 'updated', icon: ICON.clock, text: updated, className: 'dw-not-quarter' },
        ]} />
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
    // A declared base-wide event leads, as its own line: its kind and its stage, never a person's level.
    const event = shared(c).filter((a) => a.reason === 'declared' && a.declared).sort((a, b) => b.level - a.level)[0];
    const first = event ?? shared(c)[0];
    const alarm = c.world.alarms[0];
    const name = (id: string) => c.profile.crew.find((p) => p.id === id)?.name ?? id;
    const stage = (d: NonNullable<typeof first.declared>) => (d.stage === 'warning' && d.expectedAt !== null
      ? c.s('event.wasExpected', { time: new Date(d.expectedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) })
      : c.s('event.now'));
    const line = event?.declared ? `${c.s(`event.${event.declared.kind}`)}: ${stage(event.declared)}`
      : first ? `${name(first.person)}${first.room ? `, ${roomName(c, first.room)}` : ''}: ${c.s(`level.${first.level}`)}`
      : alarm ? `${roomName(c, alarm.room)}: ${c.s('status.over')}`
      : c.s('dock.noRoomOver');
    return (
      <>
        <Head icon={ICON.alerts} title={c.s('top.alerts')} s={c.s} />
        <button type="button" className="dw-alerts" data-tone={open ? (c.world.alarms.length || first?.level === 3 ? 'over' : 'watch') : 'ok'} onClick={c.onAlerts}>
          <span className="dw-stat-label"><span className="dw-stat-name">{c.s('dock.openLabel')}</span></span>
          <span className="dw-stat-value">{open}</span>
          {!open && <span className="dw-sub">{c.s('dock.allQuiet')}</span>}
        </button>
        <Foot items={[{ key: 'line', icon: open ? ICON.warn : ICON.home, text: line }]} />
      </>
    );
  },
};

// ---------------------------------------------------------------- Earth

const inFlight = (c: DockContext) => c.world.earthMessages.filter((m) => m.replyAt > c.now && !m.reply).sort((a, b) => b.sentAt - a.sentAt)[0];
/** The newest reply in the last 10 minutes. A simulated one always carries its label. */
const replied = (c: DockContext) => c.world.earthMessages.filter((m) => m.reply && c.now - m.reply.at < 10 * 60_000).sort((a, b) => b.reply!.at - a.reply!.at)[0];

const earth: Widget = {
  id: 'earth',
  sizes: ['quarter', 'third', 'half'],
  problem: () => false,
  score: (c) => (inFlight(c) || replied(c) ? 85 : 40),
  render: (c) => {
    const m = inFlight(c);
    const r = m ? undefined : replied(c);
    const delay = c.profile.delayToEarthSeconds * 1000;
    const from = m?.from ? c.profile.crew.find((p) => p.id === m.from)?.name ?? m.from : null;
    const progress = m ? Math.min(1, (c.now - m.sentAt) / (m.replyAt - m.sentAt)) : 0;
    return (
      <>
        <Head icon={ICON.earth} title={c.s('dock.earth')} s={c.s} />
        {r?.reply ? (
          <>
            <p className="dw-sub">{c.s('emergency.earthReplied')} “{r.reply.key ? c.s(r.reply.key, r.reply.vars) : r.reply.text}”</p>
            <Foot items={[{ key: 'ai', icon: ICON.send, text: r.simulated === 'ai' ? c.s('earth.simulatedByAi') : c.s('kind.simulated') }]} />
          </>
        ) : delay < 60_000 && !m ? (
          <>
            <Stat label={c.s('dock.oneWayLabel')} s={c.s}>{c.s('dock.live')}</Stat>
            <Foot items={[{ key: 'note', icon: ICON.send, text: c.s('dock.liveNote') }]} />
          </>
        ) : m ? (
          <>
            <Stat label={c.s('dock.replyIn')} s={c.s}>{`${Math.max(0, Math.ceil((m.replyAt - c.now) / 60000))} min`}</Stat>
            <div className="dw-track" aria-hidden="true">
              <span className="dw-track-fill" style={{ width: `${progress * 100}%` }} />
              <span className="dw-track-mid" />
            </div>
            <p className="dw-track-labels dw-not-quarter" aria-hidden="true"><span>{c.s('dock.sent')}</span><span>{c.s('dock.reachesEarth')}</span><span>{c.s('dock.reply')}</span></p>
            {(from || m.simulatedDelay) && <Foot className="dw-not-quarter" items={[
              ...(from ? [{ key: 'from', icon: ICON.send, text: c.s('dock.lastMessage', { name: from }) }] : []),
              ...(m.simulatedDelay ? [{ key: 'delay', icon: ICON.send, text: c.s('earth.simulatedDelay') }] : []),
            ]} />}
          </>
        ) : (
          <>
            <Stat label={c.s('dock.oneWayLabel')} s={c.s}>{Math.round(delay / 60_000)}<span className="unit">{c.s('dock.min')}</span></Stat>
            <Foot className="dw-not-quarter" items={[{ key: 'reply', icon: ICON.send, text: c.s('dock.replyAfter', { min: Math.round((2 * delay) / 60_000) }) }]} />
          </>
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
    const day = dayOf(c.profile, c.now);
    const m = c.profile.mission;
    const g = m?.gravity ?? 0;
    return (
      <>
        <Head icon={ICON.mission} title={m?.nameText ?? c.s(`${c.profile.place}.short`)} s={c.s} />
        <Stat label={c.s('dock.dayLabel')} s={c.s}>{day}</Stat>
        {m?.plannedDays ? (
          <>
            <div className="dw-track" aria-hidden="true"><span className="dw-track-fill" style={{ width: `${Math.min(100, (day / m.plannedDays) * 100)}%` }} /></div>
            <p className="dw-label">{c.s('dock.plannedDays', { days: m.plannedDays })}</p>
          </>
        ) : null}
        <Foot items={[
          { key: 'g', icon: ICON.down, text: g === 0 ? c.s('dock.weightless') : c.s('dock.gravity', { g }) },
          { key: 'delay', icon: ICON.send, className: 'dw-not-quarter', text: c.profile.delayToEarthSeconds < 60 ? c.s('dock.live') : c.s('dock.delayShort', { min: Math.round(c.profile.delayToEarthSeconds / 60) }) },
        ]} />
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
        {card?.pointsTo === 'room' && card.focusRoom && <Foot items={[{ key: 'room', icon: ICON.home, text: c.s('evidence.pointsTo.room', { room: roomName(c, card.focusRoom) }) }]} />}
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
        <div className="dw-grid">
          {rows.map((r) => (
            <Stat key={r.signal} icon={<SignalIcon signal={r.signal} />} label={c.s(`signal.${r.signal}.short`)} kind={r.kind} s={c.s}>
              {num(r.value as number)}<span className="unit">{unitText(r.unit)}</span>
            </Stat>
          ))}
        </div>
        {src.missing.length > 0 && <Foot className="dw-not-quarter" items={[{ key: 'missing', icon: ICON.warn, text: c.s('dock.notAnswering', { list: src.missing.map((k) => c.s(`signal.${k}.short`)).join(', ') }) }]} />}
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
        <Stat label={c.s('dock.averageLabel')} s={c.s}>{num(avg)}<span className="unit">{unit}</span></Stat>
        <ul className="dw-minicols" aria-hidden="true">
          {rows.map(({ room, row }) => <li key={room.id} title={roomName(c, room.id)}><span style={{ height: row ? `${20 + ((row.value as number) / top) * 80}%` : '0%' }} /></li>)}
        </ul>
      </>
    );
  },
};

export const WIDGETS: Widget[] = [crew, cabin, alerts, earth, mission, exposure, sleep, exercise, board, radiation];
