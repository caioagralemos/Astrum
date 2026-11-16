// The hub's first-run setup: seven framed steps over the dark window, each a
// labelled region with its heading, a progress bar read as "Step N of 7", and
// Back / Next. It builds the mission in the crew's own terms (what kind of
// place, where and how long, who is on board, which board sits in which room,
// the phones) and writes nothing until "Open the base" and one confirmation,
// which sends the whole setup to the hub at once (POST /api/setup,
// core/setup.ts); the hub then restarts on it.
//
// Defaults come from the mission files and the running hub, the same each
// time. Only the look is random each time it opens: the models' angles and
// turning (models.ts) and which world is shown first.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { hubAddress } from '../data.ts';
import type { World } from '../data.ts';
import type { Lang } from '../../../engine/strings.ts';
import { dayOf, roomsOf } from '../../../engine/mission.ts';
import type { Mission } from '../../../engine/mission.ts';
import type { Person } from '../../../engine/types.ts';
import { MISSIONS } from '../scene/missions.ts';
import { useModel } from './models.ts';
import type { ModelName } from './models.ts';
import { Portrait, demoPortraits } from '../dock/widgets.tsx';
import { LogoLight } from './LogoLight.tsx';
import { setupDefaults, todayOn } from './defaults.ts';
import './onboarding.css';

type S = (key: string, vars?: Record<string, string | number>) => string;
type Kind = 'trip' | 'base' | 'iss';
type WorldName = 'mars' | 'moon';
type Pronoun = 'she' | 'he' | 'they';

interface Mate { key: string; id?: string; name: string; role: string; pronoun: Pronoun; portrait: string | null; medicalOfficer: boolean;
  /** Their own photo, a square JPEG data URL made in the page; sent only when the setup is saved. */
  photo?: string | null }

const STEPS = 6;
/** Each step's heading key: welcome, kind, (details by kind), crew, boards, then the summary. */
const STEP_TITLES: Record<number, string> = { 2: 'setup.step2.title', 4: 'setup.step5.title', 5: 'setup.step6.title', 6: 'setup.step4.title' };
const DAY_MS = 86_400_000;
const MIN_DAYS = 30;
/** A starting trip length to the Moon, which the person edits: no profile gives one. */
const MOON_TRIP_DAYS = 3;
const MAX_DAYS = 3 * 365;
const ROLES = ['role.commander', 'role.cmo', 'role.engineer', 'role.scientist'];
const PORTRAITS = [1, 2, 3, 4, 5, 6].map((n) => `crew/crew-${n}.jpg`);
const FILE_OF = { trip: 'ship-mars-orbit', iss: 'iss', mars: 'base-mars', moon: 'base-moon' } as const;
const SCENE_OF = { 'ship-mars-orbit': 'ship', iss: 'iss', 'base-mars': 'base-mars', 'base-moon': 'base-moon' } as const;

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const clampDays = (n: number) => Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(n)));

function Model({ name, className, travel, whole }: { name: ModelName; className?: string; travel?: () => number; whole?: boolean }) {
  const ref = useModel<HTMLDivElement>(name, travel, whole);
  return <div ref={ref} className={`ob-model ${className ?? ''}`} aria-hidden="true" />;
}

export function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`ob-frame ${className ?? ''}`}><i aria-hidden="true" />{children}</div>;
}

export function Onboarding({ world, lang, s, onLang, forced, onClose }: {
  world: World; lang: Lang; s: S; onLang: (lang: Lang) => void;
  /** True on a hub never set up: there is no leaving without saving. */
  forced: boolean;
  onClose: () => void;
}) {
  const profile = world.profile;
  const now = world.now || Date.now();
  // The look, picked once per opening: which world is offered first.
  const [worldOrder] = useState<WorldName[]>(() => (Math.random() < 0.5 ? ['mars', 'moon'] : ['moon', 'mars']));
  const runningFile = profile?.mission?.file ?? null;
  const startKind: Kind = runningFile === 'iss' ? 'iss' : runningFile?.startsWith('base') ? 'base' : 'trip';
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<Kind>(startKind);
  const [where, setWhere] = useState<WorldName>(runningFile === 'base-moon' ? 'moon' : 'mars');
  // A trip's destination: the Moon or Mars (core/setup.ts). The running ship's own when it has one.
  const [dest, setDest] = useState<WorldName>(profile?.mission?.destination?.startsWith('place.moon') ? 'moon' : 'mars');
  const chooseDest = (w: WorldName) => {
    if (w === dest) return;
    setDest(w);
    // A plain starting value for the Moon (about three days), from today; Mars goes back to the ship's own.
    if (w === 'moon') { setDays(MOON_TRIP_DAYS); setStart(todayOn(now, offset)); }
    else { const d = defaultsOf(file); setDays(d.days); setStart(d.start); }
  };
  const file = kind === 'base' ? FILE_OF[where] : FILE_OF[kind];
  const mission: Mission = MISSIONS[SCENE_OF[file]];
  const running = runningFile === file && profile ? profile : null;

  // The defaults for a place: its own, or the running hub's when it runs that place.
  const offset = profile?.mission?.clockOffsetMinutes ?? -new Date(now).getTimezoneOffset();
  const defaultsOf = (f: string) => {
    const m = MISSIONS[SCENE_OF[f as keyof typeof SCENE_OF]];
    const live = runningFile === f && profile ? profile : null;
    // The stay starts today (day 1), for its planned length; a trip departs today (defaults.ts).
    const { start, days } = setupDefaults(live?.mission?.plannedDays ?? m.plannedDays, f === 'ship-mars-orbit', now, offset);
    // A trip's own name is where it is ("Station in transit"), not the ship file's Mars orbit.
    const name = live?.mission?.nameText ?? s(f === 'ship-mars-orbit' ? 'place.transit' : m.name);
    return { start, days, name };
  };
  const [name, setName] = useState(() => defaultsOf(file).name);
  const [days, setDays] = useState(() => defaultsOf(file).days);
  const [start, setStart] = useState(() => defaultsOf(file).start);
  const [todayBy, setTodayBy] = useState<'day' | 'date'>('day');
  // Choosing another place takes that place's defaults.
  const lastFile = useRef(file);
  useEffect(() => {
    if (lastFile.current === file) return;
    lastFile.current = file;
    const d = defaultsOf(file);
    setName(d.name); setDays(d.days); setStart(d.start);
  }, [file]);
  const today = dayOf({ missionStart: start, mission: profile?.mission }, now);
  const setToday = (n: number) => setStart(isoDay(Date.parse(`${todayOn(now, offset)}T00:00:00Z`) - (Math.max(1, n) - 1) * DAY_MS));

  // The crew: the running hub's, as it is.
  const [crew, setCrew] = useState<Mate[]>(() => {
    const people: Person[] = profile?.crew ?? MISSIONS.ship.crew;
    const officer = people.find((p) => p.medicalOfficer) ?? people.find((p) => p.role === 'role.cmo') ?? people[0];
    // The faces the dock's crew card already shows for them (dock/widgets.tsx), so the wall, the dock and the saved portrait agree.
    const faces = demoPortraits(people);
    return people.map((p) => ({
      key: p.id, id: p.id, name: p.name, role: ROLES.includes(p.role) ? p.role : 'role.scientist', pronoun: p.pronoun ?? p.pronouns ?? 'they',
      portrait: p.portrait && /^crew\//.test(p.portrait) ? p.portrait : faces[p.id] ?? null, medicalOfficer: p === officer,
    }));
  });
  // The real app (production mode) carries no sample people: a first setup starts with no crew, and the sample
  // portraits (AI-generated pictures for the simulated crew) are not offered. Demo mode keeps both.
  const [real, setReal] = useState(false);
  useEffect(() => {
    let gone = false;
    fetch(`http://${hubAddress()}/api/missions`).then((r) => r.json()).then((list: { mode?: string }) => {
      if (gone || list.mode !== 'production') return;
      setReal(true);
      if (profile?.setupDone === false) setCrew([]);
    }).catch(() => {});
    return () => { gone = true; };
  }, []);
  const [editing, setEditing] = useState<Mate | null>(null);
  const hasOfficer = crew.some((p) => p.medicalOfficer);

  // Boards and their rooms.
  const rooms = roomsOf(mission);
  const boards = world.sources.filter((x) => x.id.startsWith('chip:'));
  const [boardRooms, setBoardRooms] = useState<Record<string, string>>({});
  const roomOf = (id: string) => {
    const chosen = boardRooms[id];
    if (chosen && rooms.some((r) => r.id === chosen)) return chosen;
    const bare = id.replace(/^chip:/, '');
    const own = (running ? profile?.chips[bare] : undefined) ?? mission.chips[bare];
    return own && rooms.some((r) => r.id === own) ? own : rooms[0]?.id ?? '';
  };
  const boardLabel = (id: string) => {
    const room = roomOf(id);
    const same = boards.filter((b) => roomOf(b.id) === room).map((b) => b.id).sort();
    return `${s(rooms.find((r) => r.id === room)?.name ?? room)} ${same.indexOf(id) + 1}`;
  };

  // Focus goes to each step's heading.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step, editing === null]);

  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'failed' | 'done'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const save = () => {
    setSaving('saving');
    setProblem(null);
    const body = {
      place: file, name: name.trim() || s(mission.name), missionStart: start, plannedDays: days, ...(kind === 'trip' ? { destination: dest } : {}),
      crew: crew.map((p) => ({ ...(p.id && running ? { id: p.id } : {}), name: p.name, role: p.role, pronoun: p.pronoun, ...(p.photo ? { photo: p.photo } : p.portrait ? { portrait: p.portrait } : {}), medicalOfficer: p.medicalOfficer })),
      chips: Object.fromEntries(boards.map((b) => [b.id.replace(/^chip:/, ''), roomOf(b.id)])),
    };
    fetch(`http://${hubAddress()}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(async (r) => {
        const v = await r.json().catch(() => ({})) as { problems?: string[]; error?: string };
        if (!r.ok) throw new Error(v.problems?.[0] ?? v.error ?? String(r.status));
        setSaving('done');
        setTimeout(onClose, 600);
      })
      .catch((err: Error) => { setSaving('failed'); setProblem(err.message); });
  };

  const gravity = kind === 'trip' ? 0 : mission.gravity;
  // A trip to the Moon has the Moon's fixed delay (engine/custom.ts delayFor), as the hub saves it.
  const delay = kind === 'trip' && dest === 'moon' ? 1.3 : mission.delayToEarthSeconds;
  const said = (seconds: number) => (seconds < 90 ? s('setup.sum.seconds', { n: Math.max(1, Math.round(seconds)) }) : s('setup.sum.minutes', { n: Math.round(seconds / 60) }));
  const modelOf: ModelName = kind === 'trip' ? 'ship' : kind === 'iss' ? 'iss' : where === 'moon' ? 'base-moon' : 'base-mars';
  const progress = Math.min(1, Math.max(0, (today - 1) / Math.max(1, days - 1)));

  // Today must fall inside the stay (the hub refuses the same, core/setup.ts): the person's numbers are kept and said back.
  const dayProblem = step !== 3 ? null : today < 1 ? s('setup.today.future') : today > days ? s('setup.today.after', { day: today, length: days }) : null;
  const next = () => { if ((step === 4 && !hasOfficer) || dayProblem) return; setStep((n) => Math.min(STEPS, n + 1)); };
  const back = () => setStep((n) => Math.max(1, n - 1));
  const id = `ob-h-${step}`;
  const title = editing ? s(editing.id || crew.some((p) => p.key === editing.key) ? 'setup.mate.edit' : 'setup.mate.add') : s(step === 3 ? `setup.step3.${kind}.title` : STEP_TITLES[step] ?? 'setup.step4.title');

  const nav = (nextLabel = s('setup.next'), extra?: ReactNode) => (
    <div className="ob-nav">
      {step > 1 ? <button type="button" className="ob-btn quiet" onClick={back}>{s('setup.back')}</button> : <span />}
      {extra}
      <button type="button" className="ob-btn fill" onClick={next} disabled={Boolean(dayProblem)} aria-describedby={step === 4 && !hasOfficer ? 'ob-need' : dayProblem ? 'ob-day-problem' : undefined}>{nextLabel}</button>
    </div>
  );

  const body = () => {
    if (editing) return <MateEditor mate={editing} s={s} samples={!real} onCancel={() => setEditing(null)} onSave={(m) => {
      setCrew((list) => {
        const known = list.some((p) => p.key === m.key);
        const updated = known ? list.map((p) => (p.key === m.key ? m : p)) : [...list, m];
        return m.medicalOfficer ? updated.map((p) => ({ ...p, medicalOfficer: p.key === m.key })) : updated;
      });
      setEditing(null);
    }} onRemove={crew.length > 1 && crew.some((p) => p.key === editing.key) ? () => { setCrew((list) => list.filter((p) => p.key !== editing.key)); setEditing(null); } : undefined} />;
    switch (step) {
      case 1: return (
        <>
          <div className="ob-sp" />
          <LogoLight className="ob-logo" label={s('app.name')} />
          <p className="ob-lede">{s('setup.welcome')}</p>
          <div className="ob-sp" />
          <div className="ob-nav">
            <div className="ob-seg" role="group" aria-label={s('top.language')}>
              {(['en', 'pt'] as const).map((code) => (
                <button key={code} type="button" lang={code} aria-pressed={lang === code} onClick={() => onLang(code)}>{code === 'en' ? 'English' : 'Português'}</button>
              ))}
            </div>
            <button type="button" className="ob-btn fill" onClick={next}>{s('setup.begin')}</button>
          </div>
        </>
      );
      case 2: return (
        <>
          <div className="ob-sp" />
          <div className="ob-choices three" role="radiogroup" aria-labelledby={id}>
            {(['trip', 'base', 'iss'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className="ob-choice" onClick={() => setKind(k)}>
                <Model name={k === 'trip' ? 'ship' : k === 'iss' ? 'iss' : where === 'moon' ? 'base-moon' : 'base-mars'} />
                <b>{s(`setup.kind.${k}`)}</b><span>{s(`setup.kind.${k}.note`)}</span>
              </button>
            ))}
          </div>
          <div className="ob-sp" />{nav()}
        </>
      );
      case 3: return (
        <>
          {kind === 'base' && (
            <>
            <div className="ob-sp" />
            <div className="ob-split">
              <div className="ob-choices two" role="radiogroup" aria-label={s('setup.world')}>
                {worldOrder.map((w) => (
                  <button key={w} type="button" role="radio" aria-checked={where === w} className="ob-choice" onClick={() => setWhere(w)}>
                    <Model name={w} className="sm" /><b>{s(`setup.world.${w}`)}</b><span>{s('setup.gravity', { g: MISSIONS[w === 'mars' ? 'base-mars' : 'base-moon'].gravity })}</span>
                  </button>
                ))}
              </div>
              <div className="ob-fields">
                <Field label={s('setup.name.base')}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
                <StayFields days={days} setDays={setDays} today={today} setToday={setToday} start={start} setStart={setStart} todayBy={todayBy} setTodayBy={setTodayBy} s={s} problem={dayProblem} />
              </div>
            </div>
            </>
          )}
          {kind === 'trip' && (
            <>
              <div className="ob-sp" />
              <div className="ob-route">
                <div className="ob-end"><Model name="earth" className="sm" /><b>{s('setup.world.earth')}</b></div>
                <div className="ob-arc">
                  <Route progress={progress} />
                  <span>{s('setup.dayOf', { day: Math.min(days, Math.max(1, today)), days })}</span>
                </div>
                <div className="ob-end">
                  {/* The models share one WebGL canvas (models.ts), which CSS opacity cannot fade: the chosen world replaces the other. */}
                  <Model key={dest} name={dest} className="sm" />
                  <span className="ob-caption" aria-hidden="true">{s('setup.destination')}</span>
                  <div className="ob-seg" role="radiogroup" aria-label={s('setup.destinationName')}
                    onKeyDown={(e) => {
                      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
                      e.preventDefault();
                      const order: WorldName[] = ['mars', 'moon'];
                      const nextWorld = order[(order.indexOf(dest) + 1) % 2];
                      chooseDest(nextWorld);
                      (e.currentTarget.querySelector(`[data-world="${nextWorld}"]`) as HTMLElement | null)?.focus();
                    }}>
                    {(['mars', 'moon'] as const).map((w) => (
                      <button key={w} type="button" role="radio" data-world={w} aria-checked={dest === w} aria-pressed={dest === w} tabIndex={dest === w ? 0 : -1} onClick={() => chooseDest(w)}>{s(`setup.world.${w}`)}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="ob-fields row">
                <Field label={s('setup.name.trip')}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
                <Field label={s('setup.tripLength')}><input type="number" min={1} max={MAX_DAYS} value={days} aria-describedby="ob-trip-note" onChange={(e) => setDays(Math.min(MAX_DAYS, Math.max(1, Math.round(Number(e.target.value) || 1))))} />
                  <small id="ob-trip-note" className="ob-note">{s('setup.tripLength.note')}</small></Field>
                <Field label={s('setup.departed')}><input type="date" value={start} aria-invalid={dayProblem ? true : undefined} onChange={(e) => e.target.value && setStart(e.target.value)} /></Field>
              </div>
              {dayProblem && <p id="ob-day-problem" className="ob-need ob-centre" role="status">{dayProblem}</p>}
            </>
          )}
          {kind === 'iss' && (
            <>
            <div className="ob-sp" />
            <div className="ob-split">
              <div className="ob-choice static"><Model name="iss" className="hero" /><b>{s('place.iss')}</b><span>{s('setup.weightless')}</span></div>
              <div className="ob-fields">
                <Field label={s('setup.name.iss')}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
                <StayFields days={days} setDays={setDays} today={today} setToday={setToday} start={start} setStart={setStart} todayBy={todayBy} setTodayBy={setTodayBy} s={s} problem={dayProblem} />
              </div>
            </div>
            </>
          )}
          <div className="ob-sp" />{nav()}
        </>
      );
      case 4: return (
        <>
          <ul className={`ob-who${crew.length <= 5 ? ' few' : ''}`} aria-labelledby={id}>
            {crew.map((p) => (
              <li key={p.key}>
                <button type="button" className="ob-face" data-on={p.medicalOfficer ? '' : undefined} onClick={() => setEditing(p)}
                  aria-label={`${p.name}, ${s(p.role)}${p.medicalOfficer ? `, ${s('setup.mo.badge')}` : ''}. ${s('setup.mate.editHint')}`}>
                  {p.photo || p.portrait ? <span className="ob-pic" data-ai={!p.photo && p.portrait ? '' : undefined}><img src={p.photo ?? p.portrait ?? ''} alt="" /></span> : <span className="ob-figure"><Portrait /></span>}
                  <b>{p.name}</b><small>{s(p.role)}</small>
                  {p.medicalOfficer && <span className="ob-badge">{s('setup.mo.badge')}</span>}
                </button>
              </li>
            ))}
            {crew.length < 12 && (
              <li>
                <button type="button" className="ob-face add" onClick={() => setEditing({ key: `new-${Date.now()}`, name: '', role: 'role.engineer', pronoun: 'they', portrait: null, medicalOfficer: !hasOfficer })}>
                  <span className="ob-plus" aria-hidden="true">+</span><b>{s('setup.add')}</b><small>{s('setup.add.note')}</small>
                </button>
              </li>
            )}
          </ul>
          {!hasOfficer && <p id="ob-need" className="ob-need" role="status">{s('setup.mo.needed')}</p>}
          <div className="ob-sp" />{nav()}
        </>
      );
      case 5: return (
        <>
          {boards.length === 0 && <p className="ob-lede left">{s('setup.boards.none')}</p>}
          <ul className="ob-list">
            {boards.map((b) => {
              const live = b.live.map((k) => s(`signal.${k}`));
              return (
                <li key={b.id}>
                  <div className="ob-board">
                    <span className="ob-dot" data-off={b.connected ? undefined : ''} aria-hidden="true" />
                    <b title={b.id}>{boardLabel(b.id)}</b>
                    <label className="ob-room">{s('setup.boards.in')}
                      <select value={roomOf(b.id)} onChange={(e) => setBoardRooms((was) => ({ ...was, [b.id]: e.target.value }))}>
                        {rooms.map((r) => <option key={r.id} value={r.id}>{s(r.name)}</option>)}
                      </select>
                    </label>
                  </div>
                  <p className="ob-small">
                    {b.connected ? (live.length ? s('setup.boards.live', { n: live.length, board: boardLabel(b.id), list: live.join(', ') }) : s('setup.boards.quiet')) : s('source.disconnected')}
                    {b.connected && !b.live.includes('co2') && <> {s('setup.boards.noCo2')}</>}
                    {b.missing.length > 0 && <> {s('source.missing', { list: b.missing.map((k) => s(`signal.${k}`)).join(', ') })}</>}
                  </p>
                </li>
              );
            })}
          </ul>
          <div className="ob-sp" />
          {nav(boards.length ? s('setup.next') : s('setup.skip'))}
        </>
      );
      default: return (
        <>
          <div className="ob-sum">
            <div className="ob-sum-card"><Model name={modelOf} className="big" whole /></div>
            <dl>
              <div><dt>{s('setup.sum.today')}</dt><dd>{s('setup.dayOf', { day: Math.min(days, Math.max(1, today)), days })}</dd></div>
              <div><dt>{s('setup.sum.gravity')}</dt><dd>{gravity > 0 ? s('setup.gravity', { g: gravity }) : s('setup.weightless')}<small>{s(gravity > 0 ? 'setup.sum.cards.gravity' : 'setup.sum.cards.weightless')}</small></dd></div>
              <div><dt>{s('setup.sum.earth')}</dt><dd>{delay < 5 ? s('setup.sum.near') : s('setup.sum.away', { time: said(delay) })}<small>{s('setup.sum.reply', { time: said(delay * 2) })}</small></dd></div>
              <div><dt>{s('setup.sum.rooms')}</dt><dd>{rooms.length}<small>{rooms.slice(0, 4).map((r) => s(r.name)).join(', ')}{rooms.length > 4 ? '…' : ''}</small></dd></div>
              <div><dt>{s('setup.sum.crew')}</dt><dd>{crew.length}<small>{s('setup.sum.officer', { name: crew.find((p) => p.medicalOfficer)?.name ?? '' })}</small></dd></div>
              <div><dt>{s('setup.sum.board')}</dt><dd>{boards.some((b) => b.connected) ? s('setup.sum.boardOn', { board: boards.filter((b) => b.connected).map((b) => boardLabel(b.id)).join(', ') }) : s('setup.sum.boardNone')}</dd></div>
            </dl>
          </div>
          {confirming ? (
            <div className="ob-confirm" role="group" aria-labelledby="ob-confirm-q">
              <p id="ob-confirm-q">{s('setup.confirm')}</p>
              {problem && <p className="ob-need" role="alert">{problem}</p>}
              {saving === 'done' && <p role="status">{s('setup.saved')}</p>}
              <div className="ob-nav">
                <button type="button" className="ob-btn quiet" onClick={() => { setConfirming(false); setSaving('idle'); }} disabled={saving === 'saving' || saving === 'done'}>{s('setup.notYet')}</button>
                <button type="button" className="ob-btn fill" onClick={save} disabled={saving === 'saving' || saving === 'done'}>{s(saving === 'saving' ? 'setup.saving' : 'setup.save')}</button>
              </div>
            </div>
          ) : (
            <div className="ob-nav">
              <button type="button" className="ob-btn quiet" onClick={back}>{s('setup.back')}</button>
              <p className="ob-small ob-phones-note">{s('setup.sum.phones')}</p>
              <button type="button" className="ob-btn fill" onClick={() => setConfirming(true)}>{s('setup.looksRight')}</button>
            </div>
          )}

        </>
      );
    }
  };

  return (
    <div className="ob" data-leaving={saving === 'done' ? '' : undefined}>
      <section className="ob-step" aria-labelledby={id} data-step={step}>
        <Frame className={step === 1 && !editing ? 'center' : ''}>
          <div className="ob-steps" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step} aria-valuetext={s('setup.stepOf', { n: step, of: STEPS })}>
            {Array.from({ length: STEPS }, (_, i) => <span key={i} data-done={i < step ? '' : undefined} />)}
          </div>
          <p className="ob-visually-hidden" aria-live="polite">{s('setup.stepOf', { n: step, of: STEPS })}</p>
          <h2 id={id} ref={heading} tabIndex={-1} className={step === 1 && !editing ? 'ob-visually-hidden' : 'ob-title'}>
            {step === 6 && !editing ? `${name.trim() || s(mission.name)}${kind === 'trip' ? ` · ${s('setup.tripTo', { world: s(`setup.world.${dest}`) })}` : ''}${kind === 'base' && !(name.trim() || s(mission.name)).includes(s(`setup.world.${where}`)) ? `, ${s(`setup.world.${where}`)}` : ''}` : step === 1 && !editing ? s('setup.welcome') : title}
          </h2>
          {body()}
        </Frame>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="ob-field"><span>{label}</span>{children}</label>;
}

function StayFields({ days, setDays, today, setToday, start, setStart, todayBy, setTodayBy, s, problem }: {
  days: number; setDays: (n: number) => void; today: number; setToday: (n: number) => void; start: string; setStart: (d: string) => void;
  todayBy: 'day' | 'date'; setTodayBy: (b: 'day' | 'date') => void; s: S; problem: string | null;
}) {
  return (
    <>
      <label className="ob-field">
        <span>{s('setup.staying')}</span>
        <input type="range" min={MIN_DAYS} max={MAX_DAYS} step={1} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-valuetext={s('setup.days', { n: days })} />
        <span className="ob-range" aria-hidden="true"><span>{s('setup.days', { n: MIN_DAYS })}</span><b>{s('setup.days', { n: days })}</b><span>{s('setup.years', { n: 3 })}</span></span>
      </label>
      <div className="ob-field">
        <span id="ob-today">{s('setup.today')}</span>
        <div className="ob-seg" role="group" aria-labelledby="ob-today">
          <button type="button" aria-pressed={todayBy === 'day'} onClick={() => setTodayBy('day')}>{s('setup.today.day')}</button>
          <button type="button" aria-pressed={todayBy === 'date'} onClick={() => setTodayBy('date')}>{s('setup.today.date')}</button>
        </div>
        {todayBy === 'day'
          ? <input type="number" min={1} value={today} aria-label={s('setup.today.dayLabel')} aria-invalid={problem ? true : undefined} aria-describedby={problem ? 'ob-day-problem' : undefined} onChange={(e) => setToday(Number(e.target.value) || 1)} />
          : <input type="date" value={start} aria-label={s('setup.today.dateLabel')} aria-invalid={problem ? true : undefined} aria-describedby={problem ? 'ob-day-problem' : undefined} onChange={(e) => e.target.value && setStart(e.target.value)} />}
        {problem && <p id="ob-day-problem" className="ob-need" role="status">{problem}</p>}
      </div>
    </>
  );
}

function MateEditor({ mate, s, samples, onCancel, onSave, onRemove }: { mate: Mate; s: S; samples: boolean; onCancel: () => void; onSave: (m: Mate) => void; onRemove?: () => void }) {
  const [m, setM] = useState(mate);
  const [photoProblem, setPhotoProblem] = useState(false);
  const ok = m.name.trim().length > 0;
  return (
    <>
      <div className="ob-addrow">
        <div className="ob-photo">
          <div className="ob-photo-big ob-pic" data-ai={!m.photo && m.portrait ? '' : undefined} aria-hidden="true">{m.photo || m.portrait ? <img src={m.photo ?? m.portrait ?? ''} alt="" /> : <span className="ob-figure"><Portrait /></span>}</div>
          <label className="ob-btn quiet ob-upload">
            {s('setup.mate.addPhoto')}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) { setPhotoProblem(true); return; }
              setPhotoProblem(false);
              void squarePhoto(file).then((photo) => setM((was) => ({ ...was, photo, portrait: null }))).catch(() => setPhotoProblem(true));
            }} />
          </label>
          {photoProblem && <p className="ob-small" role="alert">{s('setup.mate.photoBad')}</p>}
          <p className="ob-small">{s('setup.mate.photoStays')}</p>
          <div className="ob-thumbs" role="radiogroup" aria-label={s('setup.mate.photo')}>
            <button type="button" role="radio" aria-checked={m.portrait === null && !m.photo} className="ob-thumb none" onClick={() => setM({ ...m, portrait: null, photo: null })}>{s('setup.mate.noPhoto')}</button>
            {samples && PORTRAITS.map((p, i) => (
              <button key={p} type="button" role="radio" aria-checked={m.portrait === p && !m.photo} className="ob-thumb" data-ai="" aria-label={s('setup.mate.portrait', { n: i + 1 })} onClick={() => setM({ ...m, portrait: p, photo: null })}>
                <img src={p} alt="" />
              </button>
            ))}
          </div>
        </div>
        <div className="ob-fields">
          <Field label={s('setup.mate.name')}><input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} maxLength={40} autoComplete="off" /></Field>
          <Field label={s('setup.mate.role')}>
            <select value={m.role} onChange={(e) => setM({ ...m, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{s(r)}</option>)}</select>
          </Field>
          <div className="ob-field">
            <span id="ob-pronoun">{s('setup.mate.pronoun')}</span>
            <div className="ob-seg" role="group" aria-labelledby="ob-pronoun">
              {(['she', 'he', 'they'] as const).map((p) => <button key={p} type="button" aria-pressed={m.pronoun === p} onClick={() => setM({ ...m, pronoun: p })}>{s(`setup.pronoun.${p}`)}</button>)}
            </div>
          </div>
          <label className="ob-toggle">
            <input type="checkbox" role="switch" checked={m.medicalOfficer} onChange={(e) => setM({ ...m, medicalOfficer: e.target.checked })} aria-describedby="ob-mo-note" />
            <span>{s('role.cmo')}</span>
            <small id="ob-mo-note">{s('setup.mo.note')}</small>
          </label>
        </div>
      </div>
      <div className="ob-sp" />
      <div className="ob-nav">
        <button type="button" className="ob-btn quiet" onClick={onCancel}>{s('setup.cancel')}</button>
        <span className="ob-grow" />
        {onRemove && <button type="button" className="ob-btn quiet" onClick={onRemove}>{s('setup.mate.remove')}</button>}
        <button type="button" className="ob-btn fill" disabled={!ok} onClick={() => onSave({ ...m, name: m.name.trim() })}>{s(mate.name ? 'setup.mate.done' : 'setup.mate.addTo')}</button>
      </div>
    </>
  );
}

/** A picked image, cropped to its centre square and drawn at most 512 px wide as a JPEG data URL. */
async function squarePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(512, side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = out;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.86);
}

/** The arc's control points, in the SVG's own units (200 by 60). */
const ARC = [[4, 50], [60, 4], [140, 4], [196, 50]] as const;
const bezier = (t: number, i: 0 | 1) => {
  const u = 1 - t;
  return u * u * u * ARC[0][i] + 3 * u * u * t * ARC[1][i] + 3 * u * t * t * ARC[2][i] + t * t * t * ARC[3][i];
};
const slope = (t: number, i: 0 | 1) => {
  const u = 1 - t;
  return 3 * u * u * (ARC[1][i] - ARC[0][i]) + 6 * u * t * (ARC[2][i] - ARC[1][i]) + 3 * t * t * (ARC[3][i] - ARC[2][i]);
};

/**
 * Earth to Mars: the ship at today's point on the arc, nose along it toward Mars (engines trailing toward Earth).
 * It only ever moves forward: a few percent on toward Mars over a minute, easing to a stop. Still with reduced motion.
 */
function Route({ progress }: { progress: number }) {
  const dot = useRef<HTMLSpanElement>(null);
  const angle = useRef(0);
  const travel = useRef(() => angle.current).current;
  useEffect(() => {
    let frame = 0;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Moving, the ship flies the whole route over and over (one crossing every 18 s), growing out of Earth's
    // side and shrinking into the destination's, so the restart is never a jump. At rest it sits on today's place.
    const LAP = 18_000;
    let began = 0;
    const place = (time: number) => {
      if (!began) began = time;
      const u = still ? progress : ((time - began) % LAP) / LAP;
      const t = Math.min(0.98, Math.max(0.02, u));
      const edge = still ? 1 : Math.min(1, u / 0.1, (1 - u) / 0.1);
      const el = dot.current;
      if (el) {
        el.style.left = `${(bezier(t, 0) / 200) * 100}%`;
        el.style.top = `${(bezier(t, 1) / 60) * 100}%`;
        el.style.transform = `scale(${(edge * edge * (3 - 2 * edge)).toFixed(3)})`;
      }
      // Screen y grows downward; the model turns the other way round.
      angle.current = -Math.atan2(slope(t, 1), slope(t, 0));
      if (!still) frame = requestAnimationFrame(place);
    };
    if (still) place(0); else frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [progress]);
  return (
    <div className="ob-arc-track">
      <svg viewBox="0 0 200 60" aria-hidden="true"><path d="M4 50C60 4 140 4 196 50" /></svg>
      <span ref={dot} className="ob-arc-dot" aria-hidden="true"><Model name="ship" className="ob-onarc" travel={travel} /></span>
    </div>
  );
}
