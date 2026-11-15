// The emergency's second screen ("zoom to the room"): after the tap on the
// first screen the station's camera comes in on the alert's room (App.tsx selects it; the room is
// outlined in the status red), and one wide projection frame takes the dock's place. Left: what and
// where, the reading with its kind, limit and age, "I've seen it" (a signed-in screen only) and
// Earth's reply time. Right: the card's first step, word for word, and Start help, which
// opens the steps. It cannot be dismissed (a tap on the scene does nothing) and stays until the alert
// ends, someone marks it settled here, or Earth's reply is in and someone closes it (the owner's rule).
// With `&auto=<seconds>` the steps open by themselves when a quiet countdown ends, unless the
// panel was touched; without it nothing opens by itself.

import { IncidentReport } from '../panels/IncidentReport.tsx';
import type { IncidentReport as IncidentReportData } from '../../../engine/earth-report.ts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Alert } from '../../../engine/alerts.ts';
import { NEEDS_SOMEONE } from '../../../engine/alerts.ts';
import type { RoomAlarm } from '../../../engine/cabin.ts';
import type { Lang } from '../../../engine/strings.ts';
import { hubAddress, isReplay } from '../data.ts';
import { KindChip } from '../panels.tsx';
import { loadCard, sentences } from './Steps.tsx';
import './beat2zoom.css';

type S = (key: string, vars?: Record<string, string | number>) => string;

interface Props {
  alert: Alert;
  alarms: RoomAlarm[];
  rooms: { id: string; name: string }[];
  crew: { id: string; name: string }[];
  now: number;
  /** Whose screen this is (`?person=`); null on the shared screen, which has no "I've seen it". */
  viewer: string | null;
  lang: Lang;
  s: S;
  /** Earth's reply to this alert's message, once it is in. */
  reply: { text: string; key?: string; vars?: Record<string, string | number> } | null;
  /** The label beside a simulated reply (demo mode), by string key: "Reply simulated by AI", or "Simulated reply" for the hub's fixed sentence. */
  replyLabel?: string | null;
  /** When the reply is due as the message to Earth lists it (the demo's shortened delay, when set), and whether that delay is simulated. */
  replyAt?: number | null;
  simulatedDelay?: boolean;
  /** The incident report the alert filed with its message to Earth. */
  report?: IncidentReportData | null;
  /** A recorded story is playing: its alerts cannot be settled. */
  recorded: boolean;
  /** Releases the view (Close after Earth's reply, or settled here). */
  onRelease: () => void;
  /** True while the steps are open over it: the countdown waits. */
  paused: boolean;
  onContinue: (alert: Alert) => void;
  /** The panel's height in pixels, so the scene frames the room above it. */
  onHeight: (px: number) => void;
}

/** Chemical formulas as the Portuguese cards already write them: CO₂, O₂. */
const formula = (text: string) => text.replace(/\bCO2\b/g, 'CO₂').replace(/\bO2\b/g, 'O₂');

const autoSeconds = () => {
  const n = Number(new URLSearchParams(location.search).get('auto'));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const reduceQuery = () => matchMedia('(prefers-reduced-motion: reduce)');

export function Beat2Zoom({ alert, alarms, rooms, crew, now, viewer, lang, s, reply, replyLabel, replyAt, simulatedDelay, report, recorded, paused, onContinue, onHeight, onRelease }: Props) {
  const [card, setCard] = useState<{ title: string; first: string | null } | 'loading' | 'failed' | null>(alert.card ? 'loading' : null);
  const [seen, setSeen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [settleFailed, setSettleFailed] = useState(false);
  const settleButton = useRef<HTMLButtonElement>(null);
  const settleYes = useRef<HTMLButtonElement>(null);
  const [auto] = useState(autoSeconds);
  const [left, setLeft] = useState(auto ?? 0);
  const [held, setHeld] = useState(false);
  const [reduce, setReduce] = useState(() => reduceQuery().matches);
  const fired = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!alert.card) { setCard(null); return; }
    let live = true;
    setCard('loading');
    loadCard(alert.card, lang).then(
      (c) => { if (live) setCard(c ? { title: c.title, first: c.steps[0] ?? null } : 'failed'); },
      () => { if (live) setCard('failed'); });
    return () => { live = false; };
  }, [alert.card, lang]);

  useEffect(() => {
    const q = reduceQuery();
    const on = () => setReduce(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);

  // Focus moves to the heading once, so it is announced once.
  useEffect(() => { requestAnimationFrame(() => heading.current?.focus({ preventScroll: true })); }, []);

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const fit = () => onHeight(el.offsetHeight);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const ready = typeof card === 'object' && card !== null;
  const canContinue = Boolean(alert.card) && card !== 'failed';
  const counting = auto !== null && canContinue && ready && !held && !paused && !fired.current;
  useEffect(() => {
    if (!counting) return;
    if (left <= 0) { fired.current = true; onContinue(alert); return; }
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [counting, left]);

  // Only what the hub sent: a private alert names the person and nothing more.
  const person = crew.find((p) => p.id === alert.person)?.name ?? alert.person;
  const restricted = alert.signal === NEEDS_SOMEONE;
  const name = restricted
    ? s('alert.needsSomeone', { person })
    : ready ? formula(card.title)
      : alert.declared ? s(`event.${alert.declared.kind}`) : formula(s(`signal.${alert.signal}`));
  const where = alert.stationWide
    ? s('bench.al.stationWide')
    : alert.room ? s(rooms.find((r) => r.id === alert.room)?.name ?? alert.room) : restricted ? null : person;
  const top = [alert.drill ? s('drill.badge') : null, s('emergency.title')].filter(Boolean).join(' · ');

  // The reading, its limit and how fresh it is, each with its label; stale is never shown as live.
  const alarm = alarms.find((a) => a.room === alert.room && a.signal === alert.signal);
  const reading = restricted || alert.value === null || alert.value === undefined ? null : (() => {
    const limit = alert.limit === null || alert.limit === undefined ? null
      : s(alert.limitSource === 'crew' ? 'emergency.crewLimit' : 'emergency.nasaLimit', { limit: alert.limit, unit: alert.unit ?? '' });
    const last = alarm?.lastReading ?? null;
    const minutes = last ? Math.max(0, Math.floor((now - last.t) / 60_000)) : null;
    const value = alarm?.stale && last
      ? s('emergency.stale', { value: last.value, unit: alert.unit ?? '', minutes: minutes ?? 0 })
      : `${alert.value} ${alert.unit ?? ''}`.trim();
    const fresh = alarm?.stale || minutes === null ? null
      : minutes < 1 ? s('dock.updatedNow') : minutes < 60 ? s('dock.updatedMin', { min: minutes }) : s('dock.updatedHours', { hours: Math.floor(minutes / 60) });
    return { value, limit, fresh };
  })();

  const dueAt = replyAt ?? alert.earth?.replyAt ?? null;
  const due = dueAt === null ? null : Math.ceil((dueAt - now) / 60_000);
  const countdown = due === null ? null : due > 0 ? s('earth.replyCountdown', { time: `${due} min` }) : s('earth.replyNow');
  const earth = reply || countdown === null ? null : simulatedDelay ? `${countdown} · ${s('earth.simulatedDelay')}` : countdown;
  const replyText = reply ? (reply.key ? s(reply.key, reply.vars) : reply.text) : null;

  // "Emergency settled": asked once, in the panel; the mock (`demo-`) is never sent to the hub.
  useEffect(() => { if (asking) settleYes.current?.focus({ preventScroll: true }); }, [asking]);
  const settle = async () => {
    setSettleFailed(false);
    if (!alert.id.startsWith('demo-') && !isReplay()) {
      try {
        // A declared event has its own end (core/events.ts), which wants a crew id: whoever is signed in here,
        // or on the shared screen the crewmate who declared it. The hub does not record who ended it.
        const res = alert.declared
          ? await fetch(`http://${hubAddress()}/api/events/end`, { method: 'POST', body: JSON.stringify({ id: alert.id, by: viewer ?? alert.person }) })
          : await fetch(`http://${hubAddress()}/api/alerts/settle`, { method: 'POST', body: JSON.stringify(viewer ? { id: alert.id, by: viewer } : { id: alert.id }) });
        if (!res.ok && res.status !== 404) { setSettleFailed(true); return; }
      } catch { setSettleFailed(true); return; }
    }
    onRelease();
  };

  const markSeen = () => {
    setSeen(true);
    if (alert.id.startsWith('demo-') || isReplay()) return; // the mock and a recorded story are never sent to the hub
    void fetch(`http://${hubAddress()}/api/alerts/acknowledge`, { method: 'POST', body: JSON.stringify({ id: alert.id, by: viewer }) });
  };

  const total = auto ?? 1;
  const showCount = auto !== null && canContinue && ready && !fired.current;

  return (
    <section ref={panel} className="beat2 frame" role="region" aria-labelledby="beat2-title"
      onPointerDown={() => setHeld(true)} onKeyDown={() => setHeld(true)}>
      <div className="beat2-side">
        <p className="beat2-top">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 3.2L21.6 20H2.4Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M12 9.5v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="12" cy="17.2" r="0.95" fill="currentColor" />
          </svg>
          {top}
        </p>
        <h2 id="beat2-title" ref={heading} className="beat2-name" tabIndex={-1}>
          <span className="beat2-sr">{top}: </span>{name}
        </h2>
        {where && (
          <p className="beat2-where">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="12" cy="10" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {where}
          </p>
        )}
        {reading && (
          <p className="beat2-reading">
            {reading.value} <KindChip kind={alert.kind} s={s} />
            {reading.limit && <> · {reading.limit}</>}
            {reading.fresh && <> · {reading.fresh}</>}
          </p>
        )}
        {report && <IncidentReport report={report} s={s} lang={lang} />}
        {replyText && (
          <p className="beat2-reply"><span>{s('emergency.earthReplied')}</span> “{replyText}”{replyLabel && <> <span className="kind" data-kind="simulated">{s(replyLabel)}</span></>}</p>
        )}
        <div className="beat2-row">
          {asking ? (
            <span className="beat2-ask" role="group" aria-labelledby="beat2-ask">
              <span id="beat2-ask">{s('emergency.settleAsk')}</span>
              <button ref={settleYes} type="button" className="beat2-btn beat2-small" onClick={() => void settle()}>{s('emergency.settleYes')}</button>
              <button type="button" className="beat2-btn beat2-small beat2-plain" onClick={() => { setAsking(false); requestAnimationFrame(() => settleButton.current?.focus()); }}>{s('emergency.settleNo')}</button>
            </span>
          ) : (
            <>
              {viewer && !alert.seenAt && !seen && <button type="button" className="beat2-btn" onClick={markSeen}>{s('alert.seeIt')}</button>}
              {viewer && (alert.seenAt || seen) && <span className="beat2-quiet">{s('bench.al.seenSent')}</span>}
              {!recorded && (
                <button ref={settleButton} type="button" className="beat2-btn beat2-quietbtn" onClick={() => setAsking(true)}>{s('emergency.settle')}</button>
              )}
              {earth && <span className="beat2-earth">{earth}</span>}
              {replyText && <button type="button" className="beat2-btn" onClick={onRelease}>{s('top.close')}</button>}
            </>
          )}
          {settleFailed && <span className="beat2-quiet" role="status">{s('hub.offline')}</span>}
        </div>
      </div>

      <div className="beat2-rule" aria-hidden="true" />

      <div className="beat2-side">
        {alert.card ? (
          <>
            <p className="beat2-label">{s('emergency.firstAction')}</p>
            {ready && card.first ? (() => {
              const [lead, ...rest] = sentences(card.first);
              return (
                <>
                  <p className="beat2-step">{lead}</p>
                  {rest.length > 0 && <p className="beat2-more">{rest.join(' ')}</p>}
                </>
              );
            })() : <p className="beat2-step">{card === 'loading' ? s('steps.loading') : card === 'failed' ? s('steps.failed') : ''}</p>}
            {ready && <p className="beat2-quiet">{s('emergency.fromCard')}</p>}
            {canContinue && (
              <div className="beat2-row">
                <button type="button" className="beat2-btn beat2-solid" onClick={() => { fired.current = true; onContinue(alert); }}
                  aria-describedby={showCount && !held ? 'beat2-auto' : undefined}>
                  {s('emergency.continue')}
                </button>
                {showCount && !held && (
                  <span className="beat2-count" data-still={reduce ? '' : undefined} aria-hidden="true"
                    style={{ ['--beat2-done' as string]: String(1 - left / total) }}>
                    <svg viewBox="0 0 36 36" focusable="false">
                      <circle cx="18" cy="18" r="15" pathLength="1" className="beat2-ring-base" />
                      <circle cx="18" cy="18" r="15" pathLength="1" className="beat2-ring" />
                    </svg>
                    <span>{left}</span>
                  </span>
                )}
                {showCount && !held && <span id="beat2-auto" className="beat2-sr">{s('emergency.autoIn', { seconds: auto })}</span>}
              </div>
            )}
          </>
        ) : (
          <p className="beat2-step beat2-nocard">{s('ask.noCard')}</p>
        )}
      </div>
    </section>
  );
}
