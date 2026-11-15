// The hub's floating panels: connection and alerts, opened from the top bar.
// (The language switch is in Settings, panels/Settings.tsx.)
//
// They are drawn like the station: a flat dark sheet outlined in the scene's
// line colour, its corners cut at 45 degrees like the hull's octagon. Inside,
// no boxes within boxes: sections are split by one hairline, labels are plain
// sentence case, numbers are large and light. Status is a word in its colour.
// Every reading names how it came to exist (Measured, Simulated...) in words.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { hubAddress } from './data.ts';
import { closeIn, noteCount, openedWith } from './panels/autoClose.ts';
import { DeclareEvent, DeclaredAlert } from './panels/Events.tsx';
import type { World } from './data.ts';
import type { Status } from '../../engine/status.ts';
import type { Kind, Person, Room } from '../../engine/types.ts';
import type { Lang } from '../../engine/strings.ts';
import { FollowUp } from './person/FollowUp.tsx';
import { timeOf } from './panels/common.tsx';
import { isSettled } from '../../engine/alerts.ts';
import { ICON } from './dock/widgets.tsx';
import { boardName } from './onboarding/boardName.ts';

type S = (key: string, vars?: Record<string, string | number>) => string;

/** A wait counted down in whole minutes, rounded up, so screens a few seconds apart agree: "14 min". */
const minutesLeft = (seconds: number) => `${Math.max(0, Math.ceil(seconds / 60))} min`;

/** A delay as it reads best: "1.3 s" under a minute, "20:00" from a minute up. */
function clock(seconds: number): string {
  if (seconds < 60) return `${Number(seconds.toFixed(seconds < 10 ? 1 : 0))} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const post = (path: string, body: unknown) => void fetch(`http://${hubAddress()}${path}`, { method: 'POST', body: JSON.stringify(body) });

/** How a reading came to exist, always written out. */
export function KindChip({ kind, s }: { kind: Kind; s: S }) {
  return <span className="kind" data-kind={kind}>{s(`kind.${kind}`)}</span>;
}

/**
 * How a reading came to exist, as a small mark (with a key nearby): a full dot
 * for Measured, half for Replayed, an empty ring for Simulated, a dashed ring
 * for Estimated, a square for Reported. Named in words for screen readers and
 * on hover.
 */
export function KindMark({ kind, s }: { kind: Kind; s: S }) {
  return <span className="kind-mark" data-kind={kind} role="img" aria-label={s(`kind.${kind}`)} title={s(`kind.${kind}`)} />;
}

/** The key to the marks, listing only the kinds on screen. */
export function KindKey({ kinds, s }: { kinds: Kind[]; s: S }) {
  const order: Kind[] = ['measured', 'replayed', 'estimated', 'reported', 'simulated'];
  return (
    <p className="kind-key" aria-hidden="true">
      {order.filter((k) => kinds.includes(k)).map((k) => <span key={k}><span className="kind-mark" data-kind={k} />{s(`kind.${k}`)}</span>)}
    </p>
  );
}

/** A status as its word, in its colour (the word carries it; the colour only repeats it). */
function StatusWord({ status, text }: { status: Status | 'live' | 'off'; text: string }) {
  return <span className="status-word" data-status={status}>{text}</span>;
}

function PanelHead({ id, title, sub, close, onClose, live }: { id: string; title: string; sub?: ReactNode; close: string; onClose: () => void; live?: boolean }) {
  return (
    <div className="panel-head">
      <div>
        <h2 id={id}>{title}</h2>
        {sub && <p className="panel-sub" aria-live={live ? 'polite' : undefined}>{sub}</p>}
      </div>
      <button type="button" className="panel-close" aria-label={close} onClick={onClose}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7L7 17" /></svg>
      </button>
    </div>
  );
}

export interface ConnectionProps {
  world: World;
  delaySeconds: number;
  s: S;
  onClose: () => void;
}

export function ConnectionPanel({ world, delaySeconds, s, onClose }: ConnectionProps) {
  const off = world.status === 'offline';
  return (
    <section id="panel-link" className="panel frame" aria-labelledby="panel-link-title">
      <PanelHead id="panel-link-title" title={s('top.link')} close={s('top.close')} onClose={onClose}
        sub={<StatusWord status={off ? 'off' : 'live'} text={s(off ? 'hub.offline' : world.status === 'replay' ? 'top.link.replay' : 'top.link.live')} />} />

      <div className="rule">
        <p className="label">{s('top.earthDelay')}</p>
        <p className="figure">{clock(delaySeconds)}</p>
      </div>

      <div className="rule">
        <h3 className="label">{s('hub.sensors')}</h3>
        {world.sources.length === 0 && <p className="quiet">{s('source.disconnected')}</p>}
        {world.sources.map((src) => (
          <div key={src.id} className="source">
            <p className="source-head">
              <span className={world.profile && src.id.startsWith('chip:') ? undefined : 'mono'} title={src.id}>{world.profile ? boardName(src, world.sources, world.profile, s) : src.id}</span>
              <StatusWord status={src.connected ? 'live' : 'off'} text={s(src.connected ? 'source.connected' : 'source.disconnected')} />
            </p>
            {src.missing.length > 0 && (
              <p className="quiet">{s('source.missing', { list: src.missing.map((k) => s(`signal.${k}`)).join(', ') })}</p>
            )}
            {src.connected && src.id.startsWith('chip:') && (
              <div className="actions" role="group" aria-label={s('top.buzzer')}>
                {(['beep', 'alarm', 'off'] as const).map((mode) => (
                  <button key={mode} type="button" className="btn" onClick={() => post('/api/buzz', { mode })}>
                    {s(mode === 'beep' ? 'chip.beep' : mode === 'alarm' ? 'chip.alarm' : 'chip.alarmOff')}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The alerts panel closes by itself once what it showed has all gone
 * (panels/autoClose.ts): after a beat, and only when nobody is pointing or
 * moving focus inside it. Focus inside goes back to the bell. True while it
 * fades out (reduced motion: it simply closes).
 */
function useAutoClose(count: number, node: RefObject<HTMLElement | null>, close: () => void, hold = false): boolean {
  const state = useRef(openedWith(count));
  const quietSince = useRef(-Infinity);
  /** Focus was last inside: on something there, or on an alert that has since gone. */
  const focusInside = useRef(false);
  const [interacting, setInteracting] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeRef = useRef(close);
  closeRef.current = close;

  // Pointing at it, or keyboard focus inside it, holds it open.
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    let pointer = false;
    let keys = false;
    const update = () => {
      setInteracting(pointer || keys);
      if (!pointer && !keys) quietSince.current = performance.now();
    };
    const enter = () => { pointer = true; update(); };
    const leave = () => { pointer = false; update(); };
    const focusIn = (e: FocusEvent) => { focusInside.current = true; keys = e.target instanceof Element && e.target.matches(':focus-visible'); update(); };
    const focusOut = (e: FocusEvent) => {
      if (el.contains(e.relatedTarget as Node | null)) return;
      keys = false;
      update();
      // Leaving for somewhere else ends it; focus dropped because its alert was removed does not.
      const from = e.target as Node;
      queueMicrotask(() => { focusInside.current = !e.relatedTarget && !from.isConnected; });
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('focusin', focusIn);
    el.addEventListener('focusout', focusOut);
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('focusin', focusIn);
      el.removeEventListener('focusout', focusOut);
    };
  }, []);

  // A form open inside (declaring an event) holds it open too, however focus and the pointer move; closing it counts as use ending.
  useEffect(() => { if (!hold) quietSince.current = Math.max(quietSince.current, performance.now()); }, [hold]);

  useEffect(() => {
    state.current = noteCount(state.current, count, performance.now());
    if (count > 0) setClosing(false);
    const wait = closeIn(state.current, performance.now(), interacting || hold, quietSince.current);
    if (wait === null) return;
    const timer = setTimeout(() => {
      const el = node.current;
      // Focus inside (or lost with a removed alert) goes back to the bell; focus elsewhere stays put.
      const focus = document.activeElement;
      if (el?.contains(focus) || ((!focus || focus === document.body) && focusInside.current)) {
        document.querySelector<HTMLElement>('button[aria-controls="panel-alerts"]')?.focus({ preventScroll: true });
      }
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) closeRef.current();
      else setClosing(true);
    }, wait);
    return () => clearTimeout(timer);
  }, [count, interacting, hold]);

  // If the fade's end is never reported (the page hidden), close anyway.
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => closeRef.current(), 1000);
    return () => clearTimeout(timer);
  }, [closing]);

  return closing;
}

export interface AlertsProps {
  world: World;
  alerts: World['alerts'];
  rooms: Room[];
  crew: Person[];
  now: number;
  viewer: string | null;
  lang: Lang;
  s: S;
  onClose: () => void;
  /** Opens a level 3 alert's steps card, one step per page (emergency/Steps.tsx). */
  onSteps?: (alert: World['alerts'][number]) => void;
  /** Earth replies this screen has not opened or marked read: informational items, never alerts (no level, no buzzer, no takeover). */
  earthReplies?: World['earthMessages'];
  onOpenEarth?: (id: string) => void;
  onReadEarth?: (id: string) => void;
}

export function AlertsPanel({ world, alerts, rooms, crew, now, viewer, lang, s, onClose, onSteps, earthReplies = [], onOpenEarth, onReadEarth }: AlertsProps) {
  const roomName = (id: string) => s(rooms.find((r) => r.id === id)?.name ?? id);
  const name = (id: string) => crew.find((p) => p.id === id)?.name ?? id;
  // "Emergency settled" (emergency/Beat2Zoom.tsx): who and when; the alert stays listed.
  const settledLine = (a: World['alerts'][number]) => a.settledBy
    ? s('alert.settledBy', { who: name(a.settledBy), time: timeOf(a.settledAt ?? now, lang) })
    : s('alert.settledShared', { time: timeOf(a.settledAt ?? now, lang) });
  const shown = alerts.filter((a) => !a.held);
  // A declared event (base-wide, station-wide too) is its own item: never grouped by signal or worded as a reading.
  const declared = shown.filter((a) => a.reason === 'declared' && a.declared);
  const readings = shown.filter((a) => !(a.reason === 'declared' && a.declared));
  const wide = [...new Set(readings.filter((a) => a.stationWide).map((a) => a.signal))];
  const single = readings.filter((a) => !a.stationWide);
  // Level 2 and 3 alerts that are not addressed to this screen: the dock counts them, so the list
  // names them too, with who has been told and nothing else.
  const listed = new Set(shown.map((a) => a.id));
  const others = world.alerts.filter((a) => !a.held && a.level >= 2 && !listed.has(a.id));
  // The medical lead's follow-up question for this screen's own crewmate (the hub sends it to no other screen).
  const followUp = viewer && world.followUp?.person === viewer ? world.followUp : null;
  const count = world.alarms.length + declared.length + wide.length + single.length + others.length + (followUp ? 1 : 0) + earthReplies.length;
  const recorded = Boolean(world.scenario);
  const [declaring, setDeclaring] = useState(false);

  const node = useRef<HTMLElement>(null);
  const closing = useAutoClose(count, node, onClose, declaring && !recorded);

  return (
    <section ref={node} id="panel-alerts" className="panel frame" aria-labelledby="panel-alerts-title" data-closing={closing ? '' : undefined}
      onAnimationEnd={(event) => { if (closing && event.target === event.currentTarget) onClose(); }}>
      <PanelHead id="panel-alerts-title" title={s('top.alerts')} close={s('top.close')} onClose={onClose} live
        sub={count ? s('top.alerts.active', { count }) : <StatusWord status="ok" text={s('top.alerts.none')} />} />

      {viewer && <FollowUp followUp={followUp} person={viewer} lang={lang} s={s} recorded={recorded} className="alert followup" />}

      {earthReplies.map((m) => m.reply && (
        <article key={`earth|${m.id}`} className="alert alert-earth" aria-labelledby={`earth-${m.id}`}>
          <h3 id={`earth-${m.id}`}>
            <svg className="alert-earth-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={ICON.earth} /></svg>
            <span>{s('earth.replied')}</span>
          </h3>
          <p className="alert-earth-text">{m.reply.key ? s(m.reply.key, m.reply.vars) : m.reply.text}</p>
          <p className="quiet">
            {m.simulated === 'ai' || m.reply.simulated ? <><span className="kind" data-kind="simulated">{s(m.simulated === 'ai' && m.simulatedBy !== 'fixed' ? 'earth.simulatedByAi' : m.simulated === 'ai' ? 'earth.simulatedFixed' : 'kind.simulated')}</span> · </> : null}
            {timeOf(m.reply.at, lang)}
          </p>
          <div className="actions">
            {onOpenEarth && <button type="button" className="btn" onClick={() => onOpenEarth(m.id)}>{s('earth.openMessage')}</button>}
            {onReadEarth && <button type="button" className="btn" onClick={() => onReadEarth(m.id)}>{s('earth.markRead')}</button>}
          </div>
        </article>
      ))}

      {world.alarms.map((alarm) => (
        <article key={`${alarm.room}|${alarm.signal}`} className="alert" data-level="3" role="alert">
          <h3><StatusWord status="over" text={s('status.over')} /> <span>{roomName(alarm.room)}</span></h3>
          <p>{s('alarm.over', { room: roomName(alarm.room), signal: s(`signal.${alarm.signal}`), value: alarm.value, unit: alarm.unit, limit: alarm.limit })}</p>
          <p className="quiet"><KindChip kind={alarm.kind} s={s} /></p>
          {alarm.acknowledged
            ? <p className="quiet">{s('alarm.acknowledged')}</p>
            : <div className="actions"><button type="button" className="btn btn-solid" onClick={() => post('/api/alarms/acknowledge', { room: alarm.room })}>{s('alarm.acknowledge')}</button></div>}
        </article>
      ))}

      {declared.map((alert) => (
        <DeclaredAlert key={alert.id} alert={alert} crew={crew} rooms={rooms} now={now} viewer={viewer} recorded={recorded} s={s} />
      ))}

      {wide.map((signal) => {
        const group = readings.filter((a) => a.stationWide && a.signal === signal);
        const first = group[0];
        return (
          <article key={`wide|${signal}`} className="alert" data-level="3" role="alert">
            <h3><StatusWord status="over" text={s('level.3')} /></h3>
            <p>
              {s('alert.stationWide', { signal: s(`signal.${signal}`), count: new Set(group.map((a) => a.room)).size, people: group.map((a) => name(a.person)).join(', ') })}{' '}
              {first.lowestRoom ? s('alert.lowestRoom', { room: roomName(first.lowestRoom.room), value: first.lowestRoom.value, unit: first.unit ?? '' }) : s('alert.noRoomUnder')}
            </p>
            <p className="quiet"><KindChip kind={first.kind} s={s} /></p>
            {first.card && <p className="quiet">{s('alert.card', { card: first.card })}</p>}
            {first.card && onSteps && <div className="actions"><button type="button" className="btn btn-solid" onClick={() => onSteps(first)}>{s('steps.open')}</button></div>}
            {first.earth && <p className="quiet">{s('alert.earth', { time: minutesLeft((first.earth.replyAt - now) / 1000) })}</p>}
            {isSettled(first) && <p className="quiet">{settledLine(first)}</p>}
          </article>
        );
      })}

      {others.map((alert) => (
        <article key={alert.id} className="alert" data-level={alert.level}>
          <h3><StatusWord status={alert.level >= 3 ? 'over' : 'watch'} text={s(`level.${alert.level}`)} /> <span>{name(alert.person)}</span></h3>
          <p className="quiet">{s('alert.toldTo', { who: alert.toldTo === 'everyone' ? s('alert.everyone') : alert.toldTo.map(name).join(', ') })}</p>
        </article>
      ))}

      {single.map((alert) => {
        const asking = alert.level === 2 && alert.answer === null && alert.answerBy !== null && viewer === alert.person;
        return (
          <article key={alert.id} className="alert" data-level={alert.level} data-alert={alert.id} role="alert">
            <h3><StatusWord status={alert.level >= 3 ? 'over' : alert.level === 2 ? 'watch' : 'unknown'} text={s(`level.${alert.level}`)} /> <span>{name(alert.person)}</span></h3>
            <p>
              {alert.reason === 'room-limit'
                ? s('alert.roomLimit', { person: name(alert.person), room: roomName(alert.room ?? ''), signal: s(`signal.${alert.signal}`), value: alert.value ?? '', unit: alert.unit ?? '', limit: alert.limit ?? '' })
                : s('alert.unusual', { person: name(alert.person), signal: s(`signal.${alert.signal}`) })}
            </p>
            <p className="quiet"><KindChip kind={alert.kind} s={s} />. {s('alert.toldTo', { who: alert.toldTo === 'everyone' ? s('alert.everyone') : alert.toldTo.map(name).join(', ') })}</p>
            {asking && (
              <>
                <p className="countdown">{s('alert.areYouOk', { seconds: Math.max(0, Math.ceil((alert.answerBy! - now) / 1000)) })}</p>
                <div className="actions">
                  <button type="button" className="btn btn-solid" onClick={() => post('/api/alerts/answer', { id: alert.id, answer: 'ok' })}>{s('alert.ok')}</button>
                  <button type="button" className="btn btn-danger" onClick={() => post('/api/alerts/answer', { id: alert.id, answer: 'help' })}>{s('alert.help')}</button>
                </div>
              </>
            )}
            {alert.answer === 'ok' && <p className="quiet">{s('alert.answeredOk')}</p>}
            {alert.card && <p className="quiet">{s('alert.card', { card: alert.card })}</p>}
            {alert.card && alert.level === 3 && onSteps && <div className="actions"><button type="button" className="btn btn-solid" onClick={() => onSteps(alert)}>{s('steps.open')}</button></div>}
            {alert.earth && <p className="quiet">{s('alert.earth', { time: minutesLeft((alert.earth.replyAt - now) / 1000) })}</p>}
            {isSettled(alert) && <p className="quiet">{settledLine(alert)}</p>}
          </article>
        );
      })}

      {!recorded && <DeclareEvent crew={crew} rooms={rooms} now={world.now} viewer={viewer} s={s} onOpen={setDeclaring} />}
    </section>
  );
}
