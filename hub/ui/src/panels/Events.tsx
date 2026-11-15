// A base-wide event a crewmate declared (core/events.ts), in the alerts panel:
// its own item, never worded as a room limit or an unusual reading, and the
// small form that declares one. Every action goes through the hub's routes
// (/api/events/*, and /api/alerts/acknowledge for "I've seen it"); the hub's
// refusals are shown as its own sentences.

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { EVENT_KINDS } from '../../../engine/alerts.ts';
import type { Alert, EventKind } from '../../../engine/alerts.ts';
import type { Person, Room } from '../../../engine/types.ts';
import { HubSaid, call, timeOf } from './common.tsx';
import type { S } from './common.tsx';

const HOUR = 3600_000;
const AHEAD_MAX_MS = 72 * HOUR;
const NOTE_MAX = 280;

/** "14:32": hours and minutes read the same in English and Portuguese. */
const hhmm = (t: number) => timeOf(t, 'en');

/** "in about N h": tenths under an hour, whole hours above. */
const hoursAhead = (ms: number) => {
  const h = Math.max(0, ms / HOUR);
  return h < 1 ? Number(h.toFixed(1)) : Math.round(h);
};

/** A wait counted down in whole minutes, rounded up, as other alerts show it. */
const minutesLeft = (ms: number) => `${Math.max(0, Math.ceil(ms / 60_000))} min`;

/** "In N minutes/hours": an amount and its unit, read as ms ahead, or null when out of range. */
function TimeAhead({ id, amount, unit, onAmount, onUnit, s, inputRef }: {
  id: string; amount: string; unit: 'min' | 'h'; onAmount: (v: string) => void; onUnit: (v: 'min' | 'h') => void; s: S;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="xrow">
      <label className="xfield">
        <span className="label">{s('event.in')}</span>
        <input ref={inputRef} id={id} type="number" inputMode="decimal" min={1} step="any" value={amount} onChange={(e) => onAmount(e.target.value)} />
      </label>
      <label className="xfield">
        <span className="label">{s('event.unit')}</span>
        <select value={unit} onChange={(e) => onUnit(e.target.value as 'min' | 'h')}>
          <option value="min">{s('event.minutes')}</option>
          <option value="h">{s('event.hours')}</option>
        </select>
      </label>
    </div>
  );
}

const aheadMs = (amount: string, unit: 'min' | 'h') => {
  const n = Number(amount);
  const ms = n * (unit === 'h' ? HOUR : 60_000);
  return Number.isFinite(ms) && ms >= 60_000 && ms <= AHEAD_MAX_MS ? ms : null;
};

function WhoSelect({ crew, by, onBy, label, s }: { crew: Person[]; by: string; onBy: (v: string) => void; label: string; s: S }) {
  return (
    <label className="xfield">
      <span className="label">{s(label)}</span>
      <select value={by} onChange={(e) => onBy(e.target.value)}>
        {crew.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
}

export interface DeclaredProps {
  alert: Alert;
  crew: Person[];
  rooms: Room[];
  /** The hub's clock. */
  now: number;
  viewer: string | null;
  /** A recorded story is playing: nothing here can be acted on. */
  recorded: boolean;
  s: S;
}

/** One declared event, at its warning or event stage. */
export function DeclaredAlert({ alert, crew, rooms, now, viewer, recorded, s }: DeclaredProps) {
  const d = alert.declared!;
  const name = (id: string) => crew.find((p) => p.id === id)?.name ?? id;
  const roomName = (id: string) => s(rooms.find((r) => r.id === id)?.name ?? id);
  const kind = s(`event.${d.kind}`);
  const warning = d.stage === 'warning';
  const eventId = alert.id.startsWith('event|') ? alert.id : `event|${d.kind}|${d.at}`;

  const [action, setAction] = useState<'time' | 'cancel' | 'end' | null>(null);
  const [by, setBy] = useState(viewer ?? crew[0]?.id ?? '');
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState<'min' | 'h'>('h');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string } | { error: string } | null>(null);
  const first = useRef<HTMLElement | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { if (action) first.current?.focus(); }, [action]);
  // The stage moved on (the time came) while "Change time" or "Did not happen" was open: they no longer apply.
  useEffect(() => { if (!warning && (action === 'time' || action === 'cancel')) setAction(null); }, [warning]);

  const back = () => { setAction(null); setSaid(null); opener.current?.focus(); };

  const run = async (what: 'time' | 'cancel' | 'end', who: string) => {
    let body: Record<string, unknown> = { id: eventId, by: who };
    if (what === 'time') {
      const ms = aheadMs(amount, unit);
      if (ms === null) { setSaid({ text: s('event.range') }); return; }
      body = { ...body, expectedAt: now + ms };
    } else if (what === 'cancel') body = { ...body, cancel: true };
    setBusy(true);
    const r = await call(what === 'end' ? '/api/events/end' : '/api/events/update', { method: 'POST', body });
    setBusy(false);
    if (r.ok) { setAction(null); setSaid(null); } else setSaid({ error: r.error });
  };

  const start = (what: 'time' | 'cancel' | 'end', button: HTMLButtonElement) => {
    opener.current = button;
    setSaid(null);
    // On a crewmate's own screen they are the one doing it; only a time needs asking.
    if (viewer && what !== 'time') void run(what, viewer);
    else setAction(what);
  };

  const seen = async () => {
    const r = await call('/api/alerts/acknowledge', { method: 'POST', body: viewer ? { id: alert.id, by: viewer } : { id: alert.id } });
    setSaid(r.ok ? null : { error: r.error });
  };

  const declarer = d.source === 'earth'
    ? `${s('event.fromEarth')}. ${s('event.enteredBy', { name: name(d.by), time: hhmm(d.at) })}`
    : s('event.declaredBy', { name: name(d.by), time: hhmm(d.at) });

  return (
    <article className="alert" data-level={alert.level} role="alert">
      <h3><span className="status-word" data-status={warning ? 'watch' : 'over'}>{s(`level.${alert.level}`)}</span> <span>{kind}</span></h3>
      <p>
        {warning && d.expectedAt !== null
          ? s('event.warning', { kind, time: hhmm(d.expectedAt), hours: hoursAhead(d.expectedAt - now) })
          : <>{s('event.now')}{d.expectedAt !== null && <>. {s('event.wasExpected', { time: hhmm(d.expectedAt) })}</>}</>}
      </p>
      {d.shelter && <p>{s('event.goTo', { room: roomName(d.shelter) })}</p>}
      {d.note && <p>{s('event.quoted', { note: d.note })}</p>}
      <p className="quiet"><span className="kind" data-kind="reported">{s('kind.reported')}</span>. {declarer}</p>
      {alert.card && <p className="quiet">{s('alert.card', { card: alert.card })}</p>}
      {alert.earth && <p className="quiet">{s('alert.earth', { time: minutesLeft(alert.earth.replyAt - now) })}</p>}
      {alert.seenAt && <p className="quiet">{s('alert.seenBy', { who: alert.seenBy ? name(alert.seenBy) : s('event.sharedScreen') })}</p>}

      {!recorded && !action && (
        <div className="actions">
          {viewer && !alert.seenAt && <button type="button" className="btn btn-solid" onClick={() => void seen()}>{s('alert.seeIt')}</button>}
          {warning && <button type="button" className="btn" disabled={busy} onClick={(e) => start('time', e.currentTarget)}>{s('event.changeTime')}</button>}
          {warning && <button type="button" className="btn" disabled={busy} onClick={(e) => start('cancel', e.currentTarget)}>{s('event.didNotHappen')}</button>}
          <button type="button" className="btn" disabled={busy} onClick={(e) => start('end', e.currentTarget)}>{s('event.end')}</button>
        </div>
      )}

      {!recorded && action && (
        <form className="xform" onSubmit={(e) => { e.preventDefault(); void run(action, by); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); back(); } }}>
          <p className="label">{s(action === 'time' ? 'event.changeTime' : action === 'cancel' ? 'event.didNotHappen' : 'event.end')}</p>
          {action === 'time' && <TimeAhead id={`${alert.id}-in`} amount={amount} unit={unit} onAmount={setAmount} onUnit={setUnit} s={s} inputRef={first as RefObject<HTMLInputElement | null>} />}
          {!viewer && <WhoSelect crew={crew} by={by} onBy={setBy} label="event.who" s={s} />}
          <div className="actions">
            <button type="submit" className="btn btn-solid" disabled={busy}
              ref={action === 'time' ? undefined : (el) => { first.current = el; }}>{s('event.confirm')}</button>
            <button type="button" className="btn" onClick={back}>{s('event.back')}</button>
          </div>
        </form>
      )}
      <div aria-live="polite">
        {said && ('error' in said ? <HubSaid error={said.error} s={s} /> : <p className="xsaid" data-bad="">{said.text}</p>)}
      </div>
    </article>
  );
}

export interface DeclareProps {
  crew: Person[];
  rooms: Room[];
  /** The hub's clock (world.now). */
  now: number;
  viewer: string | null;
  s: S;
  /** The form is open: the panel must not close by itself. */
  onOpen: (open: boolean) => void;
}

/** "Declare a base-wide event", at the bottom of the alerts panel, opening its form in place. */
export function DeclareEvent({ crew, rooms, now, viewer, s, onOpen }: DeclareProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<EventKind>('dust_storm');
  const [by, setBy] = useState(viewer ?? crew[0]?.id ?? '');
  const [source, setSource] = useState<'crew' | 'earth'>('crew');
  const [later, setLater] = useState(false);
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState<'min' | 'h'>('h');
  const [shelter, setShelter] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; bad?: boolean } | { error: string } | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLSelectElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => { onOpen(open); if (open) first.current?.focus(); }, [open]);
  useEffect(() => () => onOpen(false), []);

  const close = (text?: string) => {
    setOpen(false);
    setSaid(text ? { text } : null);
    queueMicrotask(() => toggle.current?.focus());
  };

  const submit = async () => {
    let expectedAt: number | undefined;
    if (later) {
      const ms = aheadMs(amount, unit);
      if (ms === null) { setSaid({ text: s('event.range'), bad: true }); amountRef.current?.focus(); return; }
      expectedAt = now + ms;
    }
    setBusy(true);
    const r = await call('/api/events/declare', {
      method: 'POST',
      body: { kind, by, source, ...(note.trim() ? { note: note.trim() } : {}), ...(shelter ? { shelter } : {}), ...(expectedAt !== undefined ? { expectedAt } : {}) },
    });
    setBusy(false);
    if (r.ok) {
      setNote('');
      close(s('event.sent'));
    } else setSaid({ error: r.error });
  };

  return (
    <div className="rule">
      {!open && (
        <div className="actions">
          <button ref={toggle} type="button" className="btn" aria-expanded={false} aria-controls="declare-event" onClick={() => { setSaid(null); setOpen(true); }}>{s('event.declare')}</button>
        </div>
      )}
      {open && (
        <form id="declare-event" className="xform" aria-labelledby="declare-event-title"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
          <h3 className="label" id="declare-event-title">{s('event.declare')}</h3>
          <label className="xfield">
            <span className="label">{s('event.kind')}</span>
            <select ref={first} value={kind} onChange={(e) => setKind(e.target.value as EventKind)}>
              {EVENT_KINDS.map((k) => <option key={k} value={k}>{s(`event.${k}`)}</option>)}
            </select>
          </label>
          <WhoSelect crew={crew} by={by} onBy={setBy} label="event.by" s={s} />
          <div className="xfield">
            <span className="label" id="declare-source">{s('event.source')}</span>
            <div className="choice" role="group" aria-labelledby="declare-source">
              <button type="button" aria-pressed={source === 'crew'} onClick={() => setSource('crew')}>{s('event.onBoard')}</button>
              <button type="button" aria-pressed={source === 'earth'} onClick={() => setSource('earth')}>{s('event.fromEarth')}</button>
            </div>
          </div>
          <div className="xfield">
            <span className="label" id="declare-when">{s('event.when')}</span>
            <div className="choice" role="group" aria-labelledby="declare-when">
              <button type="button" aria-pressed={!later} onClick={() => setLater(false)}>{s('event.now')}</button>
              <button type="button" aria-pressed={later} onClick={() => setLater(true)}>{s('event.later')}</button>
            </div>
          </div>
          {later && <TimeAhead id="declare-in" amount={amount} unit={unit} onAmount={setAmount} onUnit={setUnit} s={s} inputRef={amountRef} />}
          <label className="xfield">
            <span className="label">{s('event.shelter')}</span>
            <select value={shelter} onChange={(e) => setShelter(e.target.value)}>
              <option value="">{s('event.noShelter')}</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{s(r.name)}</option>)}
            </select>
          </label>
          <label className="xfield">
            <span className="label">{s('event.note')}</span>
            <textarea rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby="declare-note-count" />
            <span className="quiet" id="declare-note-count">{s('event.noteCount', { n: note.length, max: NOTE_MAX })}</span>
          </label>
          <div className="actions">
            <button type="submit" className="btn btn-solid" disabled={busy}>{s('event.send')}</button>
            <button type="button" className="btn" onClick={() => close()}>{s('event.cancelForm')}</button>
          </div>
        </form>
      )}
      <div aria-live="polite">
        {said && ('error' in said ? <HubSaid error={said.error} s={s} /> : <p className="xsaid" data-bad={said.bad ? '' : undefined}>{said.text}</p>)}
      </div>
    </div>
  );
}
