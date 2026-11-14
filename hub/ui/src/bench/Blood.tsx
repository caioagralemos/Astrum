// 5. Blood tests (GET/POST /api/blood): the medical lead's entries, each
// person's newest results compared with them, the demo crewmate's real
// Inspiration4 values (replayed, with the lab's own range), and a form to
// type a result where entries exist.

import { useEffect, useState } from 'react';
import { glucoseMgdlToMmoll, glucoseMmollToMgdl } from '../../../engine/blood.ts';
import type { BloodEntry, Judgement } from '../../../engine/blood.ts';
import type { Row } from '../../../engine/types.ts';
import { call, failure, HubWords, kindName, num, Panel, personName, Said, signalName, sourceName, Tag, timeOf, usePoll } from './common.tsx';
import type { PanelProps, S } from './common.tsx';

interface BloodResult { id: string; row: Row; judgement: Judgement; unitMatches: boolean }
interface BloodReply { entries: BloodEntry[]; problems: string[]; latest: Record<string, BloodResult[]> }

const JUDGEMENT: Record<Judgement, string> = {
  'no-range': 'blood.noRange', 'in-range': 'blood.inRange', below: 'blood.below', above: 'blood.above', 'urgent-below': 'blood.urgentBelow', 'urgent-above': 'blood.urgentAbove',
};

/** "Inspiration4 C001, R+1. Lab range 0-200." → its parts, so the screen can word them. */
function inspiration4(text: string | null | undefined): { subject: string; timepoint: string; low: string | null; high: string | null } | null {
  const m = /^Inspiration4 (C\d{3}), ([LR][+-]\d+)\.(?: Lab range (-?[\d.]+)-(-?[\d.]+)\.)?/.exec(text ?? '');
  return m ? { subject: m[1], timepoint: m[2], low: m[3] ?? null, high: m[4] ?? null } : null;
}

export function Blood({ profile, me, lang, s }: PanelProps) {
  const { data, error, reload } = usePoll<BloodReply>('/api/blood', 30_000);
  const [whose, setWhose] = useState(me);
  useEffect(() => setWhose(me), [me]);
  const entries = data?.entries ?? [];
  const results = data?.latest[whose] ?? [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const testName = (id: string) => byId.get(id)?.name[lang] ?? signalName(`blood.${id}`, s);

  return (
    <Panel id="blood" title={s('blood.title')}>
      {error !== null && <p className="said bad">{failure(s, error)}</p>}
      {!data ? <p>{s('bench.loading')}</p> : (
        <>
          <h3>{s('bench.bl.entries')}</h3>
          {entries.length === 0 ? <p>{s('blood.noEntries')}</p> : (
            <ul>
              {entries.map((e) => (
                <li key={e.id}>
                  <strong>{e.name[lang]}</strong> ({e.unit}){' '}
                  {e.reference_range.low !== null || e.reference_range.high !== null
                    ? s('bench.bl.range', { low: e.reference_range.low ?? '-', high: e.reference_range.high ?? '-', unit: e.unit })
                    : s('blood.noRange')}
                  {e.what_it_means[lang] && <details><summary>{s('bench.bl.whatItMeans')}</summary><p>{e.what_it_means[lang]}</p></details>}
                </li>
              ))}
            </ul>
          )}
          {data.problems.length > 0 && <><p>{s('blood.fileProblems')}</p><HubWords lines={data.problems} s={s} /></>}

          <h3>{s('bench.bl.latest')}</h3>
          <label className="field">
            <span>{s('bench.bl.forPerson')}</span>
            <select value={whose} onChange={(e) => setWhose(e.target.value)}>
              {profile.crew.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {results.length === 0 ? <p>{s('bench.bl.noResults', { person: personName(profile, whose) })}</p> : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{s('bench.bl.test')}</th>
                    <th scope="col">{s('bench.bl.result')}</th>
                    <th scope="col">{s('bench.bl.compared')}</th>
                    <th scope="col">{s('bench.ev.labels')}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const i4 = r.row.source === 'nasa:osdr-inspiration4' ? inspiration4(r.row.text) : null;
                    const entry = byId.get(r.id);
                    return (
                      <tr key={r.id}>
                        <th scope="row">{testName(r.id)}</th>
                        <td>{r.row.value === null ? r.row.text : `${r.row.value} ${r.row.unit}`}</td>
                        <td>
                          {entry && !r.unitMatches ? s('blood.unitMismatch', { unit: r.row.unit }) : s(JUDGEMENT[r.judgement])}
                          {i4?.low != null && <div>{s('blood.labRange', { low: i4.low, high: i4.high ?? '', unit: r.row.unit })}</div>}
                        </td>
                        <td>
                          <Tag>{kindName(r.row.kind, s)}</Tag> {sourceName(r.row.source, profile, s)}
                          {i4 && <div className="muted">{s('bench.bl.i4', { subject: i4.subject, timepoint: i4.timepoint })}</div>}
                          <div className="muted">{s('bench.bl.taken')}: {timeOf(r.row.t, lang)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {entries.length > 0 && <TypeResults entries={entries} whose={whose} s={s} lang={lang} onSaved={reload} />}
        </>
      )}
    </Panel>
  );
}

function TypeResults({ entries, whose, s, lang, onSaved }: { entries: BloodEntry[]; whose: string; s: S; lang: 'en' | 'pt'; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const [said, setSaid] = useState<{ text: string; bad: boolean; lines: string[] } | null>(null);

  const convert = (e: BloodEntry) => {
    const typed = Number(values[e.id]);
    const from = units[e.id]?.trim();
    const value = from === 'mmol/L' && e.unit === 'mg/dL' ? glucoseMmollToMgdl(typed) : glucoseMgdlToMmoll(typed);
    setValues({ ...values, [e.id]: num(value, 1) });
    setUnits({ ...units, [e.id]: e.unit });
    setSaid({ text: s('bench.bl.converted', { from: from ?? '', to: e.unit, value: num(value, 1) }), bad: false, lines: [] });
  };

  const save = async () => {
    const filled = entries.filter((e) => (values[e.id] ?? '').trim() !== '');
    if (!filled.length) { setSaid({ text: s('bench.bl.typeOne'), bad: true, lines: [] }); return; }
    const body = {
      person: whose,
      values: Object.fromEntries(filled.map((e) => [e.id, Number(values[e.id])])),
      units: Object.fromEntries(filled.filter((e) => units[e.id]?.trim()).map((e) => [e.id, units[e.id].trim()])),
    };
    const r = await call<{ saved: unknown[] }>('/api/blood', { method: 'POST', body });
    if (r.ok) {
      setSaid({ text: s('bench.bl.saved', { count: r.data.saved.length }), bad: false, lines: [] });
      setValues({});
      onSaved();
    } else {
      const refused = (r.body as { refused?: { id: string; reason: string }[] } | null)?.refused ?? [];
      setSaid(refused.length
        ? { text: s('bench.bl.refused'), bad: true, lines: refused.map((x) => `${x.id}: ${x.reason}`) }
        : { text: failure(s, r.error), bad: true, lines: [] });
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h3>{s('blood.type')}</h3>
      {entries.map((e) => {
        const typedUnit = units[e.id]?.trim();
        const wrong = typedUnit && typedUnit !== e.unit;
        const glucose = e.id === 'glucose' && wrong && (typedUnit === 'mmol/L' || typedUnit === 'mg/dL') && (values[e.id] ?? '').trim() !== '';
        return (
          <fieldset key={e.id}>
            <legend>{e.name[lang]} ({e.unit})</legend>
            <div className="row">
              <label className="field"><span>{s('bench.bl.result')}</span><input inputMode="decimal" value={values[e.id] ?? ''} onChange={(x) => setValues({ ...values, [e.id]: x.target.value })} /></label>
              <label className="field"><span>{s('bench.bl.unit')}</span><input value={units[e.id] ?? ''} placeholder={e.unit} onChange={(x) => setUnits({ ...units, [e.id]: x.target.value })} /></label>
            </div>
            {wrong && <p className="said bad">{s('blood.wrongUnit', { typed: typedUnit, unit: e.unit })}</p>}
            {glucose && <button type="button" onClick={() => convert(e)}>{s('blood.convertGlucose', { from: typedUnit, to: e.unit })}</button>}
          </fieldset>
        );
      })}
      <button type="submit">{s('bench.bl.save')}</button>
      {said && <><Said text={said.text} bad={said.bad} /><HubWords lines={said.lines} s={s} /></>}
    </form>
  );
}
