// 4. The daily check-in: a headache yes/no and three sliders, posted to
// /api/checkin, and what the hub stored, labelled Reported.

import { useEffect, useState } from 'react';
import type { Row } from '../../../engine/types.ts';
import { call, failure, kindName, Panel, personName, Said, signalName, Tag, timeOf } from './common.tsx';
import type { PanelProps } from './common.tsx';

const SLIDERS = ['mood', 'stress', 'fatigue'] as const;
const SIGNALS = ['checkin.headache', ...SLIDERS.map((k) => `checkin.${k}`)];
const LOOK_BACK_MS = 72 * 3600_000;

export function Checkin({ profile, me, lang, s }: PanelProps) {
  const [headache, setHeadache] = useState<'yes' | 'no' | null>(null);
  const [values, setValues] = useState<Record<string, number>>({ mood: 50, stress: 50, fatigue: 50 });
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const [stored, setStored] = useState<Row[] | null>(null);
  const [tick, setTick] = useState(0);

  // The /api/rows filter takes one signal at a time.
  useEffect(() => {
    let live = true;
    const from = Date.now() - LOOK_BACK_MS;
    void Promise.all(SIGNALS.map((signal) => call<{ rows: Row[] }>(`/api/rows?person=${encodeURIComponent(me)}&signal=${signal}&from=${from}&limit=200`)))
      .then((replies) => {
        if (!live) return;
        setStored(replies.flatMap((r) => (r.ok ? r.data.rows : [])).sort((a, b) => b.t - a.t));
      });
    return () => { live = false; };
  }, [me, tick]);

  const send = async () => {
    const answers = [
      ...(headache ? [{ signal: 'headache', value: headache === 'yes' ? 1 : 0 }] : []),
      ...SLIDERS.map((k) => ({ signal: k, value: values[k] })),
    ];
    setSaid({ text: s('bench.sending'), bad: false });
    const r = await call<{ accepted: number }>('/api/checkin', { method: 'POST', body: { person: me, answers } });
    setSaid(r.ok ? { text: s('bench.ci.accepted', { count: r.data.accepted }), bad: false } : { text: failure(s, r.error), bad: true });
    setTick((n) => n + 1);
  };

  return (
    <Panel id="checkin" title={s('bench.ci.title')}>
      <p>{s('bench.ci.for', { person: personName(profile, me) })}</p>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <fieldset>
          <legend>{s('bench.ci.headache')}</legend>
          <label className="inline"><input type="radio" name="headache" checked={headache === 'yes'} onChange={() => setHeadache('yes')} /> {s('bench.yes')}</label>
          <label className="inline"><input type="radio" name="headache" checked={headache === 'no'} onChange={() => setHeadache('no')} /> {s('bench.no')}</label>
        </fieldset>
        {SLIDERS.map((k) => (
          <label key={k} className="field">
            <span>{s(`bench.ci.${k}`)}: <output>{values[k]}</output></span>
            <input type="range" min={0} max={100} step={1} value={values[k]} onChange={(e) => setValues({ ...values, [k]: Number(e.target.value) })} />
          </label>
        ))}
        <button type="submit">{s('bench.ci.send')}</button>
      </form>
      {said && <Said text={said.text} bad={said.bad} />}

      <h3>{s('bench.ci.stored', { person: personName(profile, me) })}</h3>
      {stored === null ? <p>{s('bench.loading')}</p> : stored.length === 0 ? <p>{s('bench.ci.nothing')}</p> : (
        <ul className="compact">
          {stored.slice(0, 24).map((r, i) => (
            <li key={r.id ?? i}>
              {timeOf(r.t, lang)} · {signalName(r.signal, s)}:{' '}
              {r.signal === 'checkin.headache' ? s(r.value ? 'bench.yes' : 'bench.no') : r.value ?? r.text}{' '}
              <Tag>{kindName(r.kind, s)}</Tag>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
