// Contact Earth: first, how long a message takes from here (the running
// mission's one-way delay), then a message box, then every message still
// listed, newest first: the crew's and the ones alerts sent by themselves.
// Each counts down to reaching Earth and to the earliest reply. A reply the
// demo makes up is marked Simulated beside its words. A message whose alert
// has ended stays: the crew has acted, and the reply is still on its way.

import { useEffect, useRef, useState } from 'react';
import type { EarthMessage } from '../../../engine/alerts.ts';
import type { Lang } from '../../../engine/strings.ts';
import type { Person, Room } from '../../../engine/types.ts';
import { Sheet } from './Sheet.tsx';
import { IncidentReport } from './IncidentReport.tsx';
import { HubSaid, call, clock, delayText, timeOf, viewerOf } from './common.tsx';
import type { S } from './common.tsx';

/** A wait counted down in whole minutes, rounded up, so screens a few seconds apart agree: "14 min". */
const minutesLeft = (seconds: number) => `${Math.max(0, Math.ceil(seconds / 60))} min`;

export interface EarthProps {
  messages: EarthMessage[];
  delaySeconds: number;
  crew: Person[];
  rooms: Room[];
  /** The hub's clock. */
  now: number;
  selected: string | null;
  lang: Lang;
  s: S;
  onClose: () => void;
  /** A message to show first (opened from an "Earth replied" item): scrolled into view and focused. */
  focus?: string | null;
}

export function EarthPanel({ messages, delaySeconds, crew, rooms, now, selected, lang, s, onClose, focus }: EarthProps) {
  useEffect(() => {
    if (!focus) return;
    const el = document.querySelector<HTMLElement>(`[data-earth-id="${CSS.escape(focus)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el?.focus({ preventScroll: true });
  }, [focus]);
  const { viewer } = viewerOf();
  const [from, setFrom] = useState(viewer ?? (selected && crew.some((p) => p.id === selected) ? selected : crew[0]?.id ?? ''));
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<{ text: string } | { error: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const one = delayText(delaySeconds, s);
  const two = delayText(delaySeconds * 2, s);

  const send = async () => {
    if (!text.trim()) { setSaid({ text: s('earth.empty') }); box.current?.focus(); return; }
    setSending(true);
    const r = await call<{ message: EarthMessage }>('/api/earth/messages', { method: 'POST', body: { from, text } });
    setSending(false);
    if (r.ok) {
      setText('');
      setSaid({ text: s('earth.sent', { time: one.text }) });
    } else setSaid({ error: r.error });
  };

  // Said aloud once, as each message reaches Earth or a reply comes back (the countdowns themselves are not read out).
  const [news, setNews] = useState('');
  const seen = useRef<Map<string, string> | null>(null);
  const states = messages.map((m) => [m.id, m.reply ? 'reply' : m.delivered || now >= m.arrivesAt ? 'delivered' : 'sent'] as const);
  const stateKey = states.map((x) => x.join(':')).join(',');
  useEffect(() => {
    const before = seen.current;
    seen.current = new Map(states);
    if (!before) return;
    const changed = states.filter(([id, state]) => before.has(id) && before.get(id) !== state).map(([, state]) => state);
    if (changed.includes('reply')) setNews(s('earth.announceReply'));
    else if (changed.includes('delivered')) setNews(s('earth.announceDelivered'));
  }, [stateKey]);

  const name = (id: string | undefined) => crew.find((p) => p.id === id)?.name ?? id ?? '';
  const roomName = (id: string | null) => (id ? s(rooms.find((r) => r.id === id)?.name ?? id) : '');
  const newest = [...messages].sort((a, b) => b.sentAt - a.sentAt);

  return (
    <Sheet id="earth" title={s('earth.title')} s={s} onClose={onClose} focus={box}>
      <div className="xearth-fact">
        <p className="xearth-lead">{one.about ? s('earth.takesAbout', { time: one.text }) : s('earth.takes', { time: one.text })}</p>
        <p className="xearth-then">{two.about ? s('earth.replyAbout', { time: two.text }) : s('earth.replyIn', { time: two.text })}</p>
      </div>

      <form className="xform rule" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {!viewer && (
          <label className="xfield">
            <span className="label">{s('earth.from')}</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {crew.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <label className="xfield">
          <span className="label">{s('earth.message')}</span>
          <textarea ref={box} rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="actions">
          <button type="submit" className="btn btn-solid" disabled={sending}>{s('earth.send')}</button>
        </div>
        <div aria-live="polite">
          {said && ('error' in said ? <HubSaid error={said.error} s={s} /> : <p className="xsaid">{said.text}</p>)}
        </div>
      </form>
      <p className="visually-hidden" aria-live="polite">{news}</p>

      <div className="rule">
        <h3 className="label">{s('earth.list')}</h3>
        {newest.length === 0 && <p className="quiet">{s('earth.none')}</p>}
        <ol className="xmessages">
          {newest.map((m) => {
            const arrive = (m.arrivesAt - now) / 1000;
            const reply = (m.replyAt - now) / 1000;
            const total = Math.max(1, (m.replyAt - m.sentAt) / 1000);
            const delivered = m.delivered || arrive <= 0;
            return (
              <li key={m.id} className="xmessage" data-earth-id={m.id} tabIndex={-1}>
                <p className="xmessage-head">
                  <span>{m.kind === 'crew' ? s('earth.byPerson', { name: name(m.from) }) : s('earth.byHub')}</span>
                  <span className="quiet">{s('earth.sentAt', { time: timeOf(m.sentAt, lang) })}</span>
                </p>
                {m.kind === 'crew'
                  ? <p className="xmessage-text">{m.text}</p>
                  : (
                    <p className="xmessage-text">
                      {m.about.level !== null && <><span className="status-word" data-status={m.about.level >= 3 ? 'over' : 'watch'}>{s(`level.${m.about.level}`)}</span>. </>}
                      {s('earth.auto', { person: name(m.about.person), signal: s(`signal.${m.about.signal}`) })}
                      {m.about.room && <>, {s('person.in', { room: roomName(m.about.room) })}</>}.
                    </p>
                  )}
                <div className="xtrack" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, 100 - (reply / total) * 100))}%` }} /><i style={{ left: '50%' }} /></div>
                <p className="xmessage-times">
                  <span data-done={delivered ? '' : undefined}>{delivered ? s('earth.delivered') : s('earth.arrives', { time: minutesLeft(arrive) })}</span>
                  <span>{m.reply ? s('earth.reply') : reply > 0 ? s('earth.replyCountdown', { time: minutesLeft(reply) }) : s('earth.replyNow')}{m.simulatedDelay && <> · {s('earth.simulatedDelay')}</>}</span>
                </p>
                {m.report && <IncidentReport report={m.report} s={s} lang={lang} />}
                {m.kind === 'alert' && m.resolvedAt !== null && !m.reply && <p className="quiet">{s('earth.alertEnded')}</p>}
                {m.reply && (
                  <blockquote className="xreply">
                    <p>{m.reply.key ? s(m.reply.key, m.reply.vars) : m.reply.text}</p>
                    <footer className="quiet">
                      {m.simulated === 'ai' && <><span className="kind" data-kind="simulated">{s(m.simulatedBy === 'fixed' ? 'earth.simulatedFixed' : 'earth.simulatedByAi')}</span> · </>}
                      {timeOf(m.reply.at, lang)}
                      {m.reply.simulated && m.simulated !== 'ai' && <> · <span className="kind" data-kind="simulated">{s('kind.simulated')}</span></>}
                    </footer>
                  </blockquote>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </Sheet>
  );
}
