// 6. Sensors (GET/POST/DELETE /api/sensors, POST /api/sensors/test): the
// registry, the signals the hub knows by itself, anything heard but not
// registered, a form to add one, a connection test, and removal. Crew levels
// are always shown as the crew's, with NASA's limit beside them, apart.

import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { CrewJudgement, CrewLimits, NasaLimitInfo, PhysicalBounds, SensorSpec, SignalSpec, Transport } from '../../../engine/sensors.ts';
import { TRANSPORTS } from '../../../engine/sensors.ts';
import type { Kind } from '../../../engine/types.ts';
import { ago, call, failure, HubWords, kindName, num, Panel, personName, roomName, Said, signalName, sourceName, Tag, usePoll } from './common.tsx';
import type { PanelProps, S } from './common.tsx';

interface SignalView extends SignalSpec {
  crewLimits: (CrewLimits & { limitSource: 'crew' }) | null;
  nasaLimit: NasaLimitInfo | null;
  last: { value: number | null; text: string | null; unit: string; kind: Kind; t: number } | null;
  arriving: boolean;
  unitMatches: boolean;
  judgement: CrewJudgement | null;
}
interface SensorView extends Omit<SensorSpec, 'signals'> {
  source: string;
  lastHeard: number | null;
  signals: SignalView[];
  refused: { signal: string; unit: string; bounds: PhysicalBounds; count: number; lastValue: number; lastAt: number }[];
}
interface Overview {
  now: number;
  sensors: SensorView[];
  builtIn: { signal: string; nameKey: string; nasaLimit: NasaLimitInfo | null; bound: { unit: string | null; min: number | null; max: number | null } | null; lastAt: number | null; units: string[]; sources: string[] }[];
  undescribed: { signal: string; lastAt: number | null; units: string[]; sources: string[] }[];
  unknown: { id: string; firstAt: number; lastAt: number; count: number; via: string; signals: string[] }[];
  problems: string[];
}
type Example =
  | { kind: 'serial-json'; line: string; text: string }
  | { kind: 'http-push'; url: string; body: string; curl: string; text: string };
interface TestReply { id: string; startedAt: number; arrived: boolean; arrivedAt: number | null; example: Example }

const LEVEL_FIELDS = ['warnAbove', 'warnBelow', 'alarmAbove', 'alarmBelow'] as const;
const NUMBER_FIELDS = [...LEVEL_FIELDS, 'windowMinutes', 'min', 'max'] as const;
type SignalForm = { signal: string; name: string; namePt: string; unit: string; decimals: string; note: string } & Record<(typeof NUMBER_FIELDS)[number], string>;
const blankSignal = (): SignalForm => ({ signal: '', name: '', namePt: '', unit: '', decimals: '1', note: '', warnAbove: '', warnBelow: '', alarmAbove: '', alarmBelow: '', windowMinutes: '', min: '', max: '' });

export function Sensors(props: PanelProps) {
  const { profile, s, lang } = props;
  const { data, error, reload } = usePoll<Overview>('/api/sensors', 10_000);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const formRef = useRef<HTMLInputElement>(null);
  const names = Object.fromEntries((data?.sensors ?? []).map((x) => [x.id, x.name]));
  const custom = Object.fromEntries((data?.sensors ?? []).flatMap((x) => x.signals.map((g) => [g.signal, lang === 'pt' && g.namePt ? g.namePt : g.name])));

  return (
    <Panel id="sensors" title={s('hub.sensors')} wide>
      {error !== null && <p className="said bad">{failure(s, error)}</p>}
      {!data ? <p>{s('bench.loading')}</p> : (
        <>
          {data.problems.length > 0 && <><p>{s('sensors.fileProblems')}</p><HubWords lines={data.problems} s={s} /></>}

          <h3>{s('bench.se.registered')}</h3>
          {data.sensors.length === 0 ? <p>{s('bench.se.noneRegistered')}</p>
            : data.sensors.map((x) => <SensorItem key={x.id} sensor={x} now={data.now} onChange={reload} onRemoved={setRemoved} {...props} />)}
          {removed && <Said text={removed} />}

          {(data.unknown.length > 0 || data.undescribed.length > 0) && <h3>{s('bench.se.unknownTitle')}</h3>}
          {data.unknown.map((u) => (
            <article key={u.id} className="item">
              <p><strong>{s('sensors.unknown', { id: u.id })}</strong></p>
              <p>{s('bench.se.unknownSignals', { signals: u.signals.map((g) => signalName(g, s, custom)).join(', ') })} · {ago(u.lastAt, data.now, s)}</p>
              <button type="button" onClick={() => { setPrefill(u.id); formRef.current?.focus(); }}>{s('sensors.addThis')}</button>
            </article>
          ))}
          {data.undescribed.map((u) => (
            <p key={u.signal}>
              {s('sensors.undescribed', { signal: signalName(u.signal, s, custom) })}{u.units.some(Boolean) && ` (${u.units.filter(Boolean).join(', ')})`} · {s('bench.se.heardFrom', { sources: u.sources.map((x) => sourceName(x, profile, s, names)).join(', ') })}
            </p>
          ))}

          <AddSensor key={prefill ?? ''} idRef={formRef} startId={prefill ?? ''} onSaved={reload} {...props} />

          <details>
            <summary>{s('bench.se.builtIn')} ({data.builtIn.length})</summary>
            <ul className="compact">
              {data.builtIn.map((b) => (
                <li key={b.signal}>
                  <strong>{s(b.nameKey)}</strong>
                  {' · '}{b.nasaLimit ? s('sensors.nasaLimit', { max: b.nasaLimit.max, unit: b.nasaLimit.unit, minutes: b.nasaLimit.windowMinutes }) : s('bench.se.nasaNone')}
                  {b.bound && (b.bound.min !== null || b.bound.max !== null) && <>{' · '}{s('bench.se.bound', { range: [
                    b.bound.min !== null ? s('bench.se.below', { min: b.bound.min, unit: b.bound.unit ?? '' }) : '',
                    b.bound.max !== null ? s('bench.se.above', { max: b.bound.max, unit: b.bound.unit ?? '' }) : '',
                  ].filter(Boolean).join(', ') })}</>}
                  {' · '}{b.sources.length ? s('bench.se.heardFrom', { sources: b.sources.map((x) => sourceName(x, profile, s, names)).join(', ') }) : s('bench.se.notHeard24')}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </Panel>
  );
}

function SensorItem({ sensor, now, onChange, onRemoved, profile, lang, s }: PanelProps & { sensor: SensorView; now: number; onChange: () => void; onRemoved: (text: string) => void }) {
  const [test, setTest] = useState<TestReply | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const runTest = async () => {
    const r = await call<TestReply>(`/api/sensors/test?id=${encodeURIComponent(sensor.id)}`, { method: 'POST' });
    if (r.ok) setTest(r.data); else setSaid({ text: failure(s, r.error), bad: true });
  };
  const remove = async () => {
    const r = await call(`/api/sensors?id=${encodeURIComponent(sensor.id)}`, { method: 'DELETE' });
    setConfirm(false);
    if (!r.ok) { setSaid({ text: failure(s, r.error), bad: true }); return; }
    onRemoved(s('bench.se.removed', { id: sensor.name }));
    onChange();
  };

  return (
    <article className="item">
      <h4>{sensor.name} <small className="muted">({sensor.id})</small></h4>
      <p>
        {sensor.room ? s('bench.se.place.room', { room: roomName(profile, s, sensor.room) }) : s('bench.se.place.person', { person: personName(profile, sensor.person ?? '') })}
        {' · '}{s(`sensors.transport.${sensor.transport}`)}
      </p>
      <ul>
        {sensor.signals.map((g) => (
          <li key={g.signal}>
            <strong>{lang === 'pt' && g.namePt ? g.namePt : g.name}</strong> ({g.unit || '-'})
            <div>
              {g.last
                ? <>{g.last.value === null ? s('bench.se.lastText', { text: g.last.text ?? '', ago: ago(g.last.t, now, s) }) : s('bench.se.lastReading', { value: num(g.last.value, g.decimals), unit: g.last.unit, ago: ago(g.last.t, now, s) })} <Tag>{kindName(g.last.kind, s)}</Tag></>
                : s('sensors.neverHeard')}
              {g.last && <> · {g.arriving ? s('sensors.arriving') : s('reading.stale')}</>}
            </div>
            {!g.unitMatches && g.last && <div>{s('sensors.unitMismatch', { unit: g.last.unit, registered: g.unit })}</div>}
            <div className="limits">
              <div>
                <span className="muted">{s('sensors.crewLimits')}:</span>{' '}
                {g.crewLimits && LEVEL_FIELDS.some((k) => g.crewLimits?.[k] !== undefined)
                  ? LEVEL_FIELDS.filter((k) => g.crewLimits?.[k] !== undefined).map((k) => `${s(`sensors.${k}`)} ${s('sensors.crewLimit', { value: g.crewLimits![k]!, unit: g.unit })}`).join('; ')
                    + (g.crewLimits.windowMinutes ? `; ${s('sensors.window')}: ${g.crewLimits.windowMinutes}` : '')
                  : s('sensors.noLimits')}
                {g.judgement && <div>{judgementText(g.judgement, g.unit, s)}</div>}
              </div>
              <div>
                {g.nasaLimit ? s('sensors.nasaLimit', { max: g.nasaLimit.max, unit: g.nasaLimit.unit, minutes: g.nasaLimit.windowMinutes }) : s('bench.se.nasaNone')}
              </div>
            </div>
            {(g.bounds?.min !== undefined || g.bounds?.max !== undefined) && (
              <div className="muted">{s('sensors.bounds')}: {[
                g.bounds?.min !== undefined ? s('bench.se.below', { min: g.bounds.min, unit: g.unit }) : '',
                g.bounds?.max !== undefined ? s('bench.se.above', { max: g.bounds.max, unit: g.unit }) : '',
              ].filter(Boolean).join(', ')}</div>
            )}
          </li>
        ))}
      </ul>
      {sensor.refused.map((r) => <p key={r.signal}>{s('sensors.refused', { count: r.count })} ({signalName(r.signal, s)}, {num(r.lastValue)} {r.unit})</p>)}

      <div className="row">
        <button type="button" onClick={() => void runTest()}>{test ? s('bench.se.testAgain') : s('sensors.test')}</button>
        {!confirm ? <button type="button" onClick={() => setConfirm(true)}>{s('sensors.remove')}</button> : (
          <>
            <button type="button" className="danger" onClick={() => void remove()}>{s('bench.se.confirmRemove', { name: sensor.name })}</button>
            <button type="button" onClick={() => setConfirm(false)}>{s('bench.se.cancel')}</button>
          </>
        )}
      </div>
      {confirm && <p className="muted">{s('sensors.removeKeeps')}</p>}
      {test && (
        <div className="test" aria-live="polite">
          <p><strong>{test.arrived ? s('sensors.testArrived') : s('sensors.testWaiting')}</strong> · {s('bench.se.testStarted', { ago: ago(test.startedAt, now, s) })}</p>
          {test.example.kind === 'http-push' ? (
            <>
              <p>{s('bench.se.curl')}</p>
              <pre tabIndex={0}><code>{test.example.curl}</code></pre>
              <p>{s('bench.se.body')} <span className="muted">{s('bench.se.postTo', { url: test.example.url })}</span></p>
              <pre tabIndex={0}><code>{test.example.body}</code></pre>
            </>
          ) : (
            <>
              <p>{s('bench.se.line')}</p>
              <pre tabIndex={0}><code>{test.example.line}</code></pre>
            </>
          )}
          <HubWords lines={[test.example.text]} s={s} />
        </div>
      )}
      {said && <Said text={said.text} bad={said.bad} />}
    </article>
  );
}

function judgementText(j: CrewJudgement, unit: string, s: S): string {
  if (j.level === 'unjudged') return s(`sensors.reason.${j.reason ?? 'no-reading'}`);
  if (j.level === 'ok') return s('sensors.level.ok');
  return s(`sensors.level.${j.level}`, { limit: j.limit ?? '', unit });
}

function AddSensor({ profile, s, startId, idRef, onSaved }: PanelProps & { startId: string; idRef: RefObject<HTMLInputElement | null>; onSaved: () => void }) {
  const [id, setId] = useState(startId);
  const [name, setName] = useState('');
  const [place, setPlace] = useState<'room' | 'person'>('room');
  const [room, setRoom] = useState(profile.rooms[0]?.id ?? '');
  const [person, setPerson] = useState(profile.crew[0]?.id ?? '');
  const [transport, setTransport] = useState<Transport>('http-push');
  const [signals, setSignals] = useState<SignalForm[]>([blankSignal()]);
  const [said, setSaid] = useState<{ text: string; bad: boolean; problems: string[]; notices: string[] } | null>(null);

  const edit = (i: number, field: keyof SignalForm, value: string) => setSignals(signals.map((g, j) => (j === i ? { ...g, [field]: value } : g)));
  const n = (v: string) => (v.trim() === '' ? undefined : Number(v));

  const save = async () => {
    const body = {
      id: id.trim(), name, transport,
      ...(place === 'room' ? { room } : { person }),
      signals: signals.map((g) => {
        const limits = Object.fromEntries([...LEVEL_FIELDS, 'windowMinutes'].map((k) => [k, n(g[k as keyof SignalForm])]).filter(([, v]) => v !== undefined));
        const bounds = Object.fromEntries((['min', 'max'] as const).map((k) => [k, n(g[k])]).filter(([, v]) => v !== undefined));
        return {
          signal: g.signal.trim(), name: g.name, unit: g.unit, decimals: n(g.decimals) ?? 1, note: g.note,
          ...(g.namePt.trim() ? { namePt: g.namePt } : {}),
          ...(Object.keys(limits).length ? { limits } : {}),
          ...(Object.keys(bounds).length ? { bounds } : {}),
        };
      }),
    };
    const r = await call<{ sensor: SensorSpec; source: string; notices: string[] }>('/api/sensors', { method: 'POST', body });
    if (r.ok) {
      setSaid({ text: s('bench.se.saved', { name: r.data.sensor.name, source: r.data.source }), bad: false, problems: [], notices: r.data.notices });
      onSaved();
    } else {
      const b = r.body as { problems?: string[]; notices?: string[] } | null;
      setSaid({ text: b?.problems ? s('bench.se.notSaved') : failure(s, r.error), bad: true, problems: b?.problems ?? [], notices: b?.notices ?? [] });
    }
  };

  return (
    <form className="add" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h3>{s('bench.se.add')}</h3>
      <div className="row">
        <label className="field"><span>{s('bench.se.id')}</span><input ref={idRef} value={id} onChange={(e) => setId(e.target.value)} autoCapitalize="off" spellCheck={false} /></label>
        <label className="field"><span>{s('bench.se.name')}</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <fieldset>
        <legend>{s('bench.se.where')}</legend>
        <label className="inline"><input type="radio" name="place" checked={place === 'room'} onChange={() => setPlace('room')} /> {s('bench.se.inRoom')}</label>
        <label className="inline"><input type="radio" name="place" checked={place === 'person'} onChange={() => setPlace('person')} /> {s('bench.se.onPerson')}</label>
        {place === 'room' ? (
          <label className="field"><span>{s('bench.se.room')}</span>
            <select value={room} onChange={(e) => setRoom(e.target.value)}>{profile.rooms.map((r) => <option key={r.id} value={r.id}>{s(r.name)}</option>)}</select>
          </label>
        ) : (
          <label className="field"><span>{s('bench.se.person')}</span>
            <select value={person} onChange={(e) => setPerson(e.target.value)}>{profile.crew.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
        )}
      </fieldset>
      <label className="field"><span>{s('bench.se.transport')}</span>
        <select value={transport} onChange={(e) => setTransport(e.target.value as Transport)}>{TRANSPORTS.map((x) => <option key={x} value={x}>{s(`sensors.transport.${x}`)}</option>)}</select>
      </label>

      {signals.map((g, i) => (
        <fieldset key={i} className="signal">
          <legend>{s('bench.se.signal', { n: i + 1 })}</legend>
          <div className="row">
            <label className="field"><span>{s('bench.se.key')}</span><input value={g.signal} onChange={(e) => edit(i, 'signal', e.target.value)} autoCapitalize="off" spellCheck={false} /></label>
            <label className="field"><span>{s('bench.se.name')}</span><input value={g.name} onChange={(e) => edit(i, 'name', e.target.value)} /></label>
            <label className="field"><span>{s('bench.se.namePt')}</span><input value={g.namePt} onChange={(e) => edit(i, 'namePt', e.target.value)} /></label>
            <label className="field"><span>{s('bench.se.unit')}</span><input value={g.unit} onChange={(e) => edit(i, 'unit', e.target.value)} autoCapitalize="off" /></label>
            <label className="field"><span>{s('bench.se.decimals')}</span><input inputMode="numeric" value={g.decimals} onChange={(e) => edit(i, 'decimals', e.target.value)} /></label>
          </div>
          <fieldset>
            <legend>{s('sensors.crewLimits')}</legend>
            <p className="muted">{s('bench.se.optional')}</p>
            <div className="row">
              {[...LEVEL_FIELDS, 'windowMinutes' as const].map((k) => (
                <label key={k} className="field"><span>{s(k === 'windowMinutes' ? 'sensors.window' : `sensors.${k}`)}</span><input inputMode="decimal" value={g[k]} onChange={(e) => edit(i, k, e.target.value)} /></label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{s('sensors.bounds')}</legend>
            <p className="muted">{s('bench.se.optional')}</p>
            <div className="row">
              <label className="field"><span>{s('bench.se.min')}</span><input inputMode="decimal" value={g.min} onChange={(e) => edit(i, 'min', e.target.value)} /></label>
              <label className="field"><span>{s('bench.se.max')}</span><input inputMode="decimal" value={g.max} onChange={(e) => edit(i, 'max', e.target.value)} /></label>
            </div>
          </fieldset>
          <label className="field"><span>{s('bench.se.note')}</span><input value={g.note} onChange={(e) => edit(i, 'note', e.target.value)} /></label>
          {signals.length > 1 && <button type="button" onClick={() => setSignals(signals.filter((_, j) => j !== i))}>{s('bench.se.removeSignal')}</button>}
        </fieldset>
      ))}
      <div className="row">
        <button type="button" onClick={() => setSignals([...signals, blankSignal()])}>{s('bench.se.addSignal')}</button>
        <button type="submit">{s('bench.se.save')}</button>
      </div>
      {said && (
        <>
          <Said text={said.text} bad={said.bad} />
          <HubWords lines={said.problems} s={s} />
          {said.notices.length > 0 && <><p>{s('bench.se.notices')}</p><HubWords lines={said.notices} s={s} /></>}
        </>
      )}
    </form>
  );
}
