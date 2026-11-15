// The incident report a level 3 alert filed with its message to Earth
// (engine/earth-report.ts): a quiet "Incident report sent to Earth" line with
// "View report", which opens the report in labelled sections, every number
// with its kind, and "Show JSON" for the raw export with a Copy button.

import { useId, useState } from 'react';
import type { IncidentReport as Report, ReportReading } from '../../../engine/earth-report.ts';
import type { Lang } from '../../../engine/strings.ts';
import { timeOf } from './common.tsx';
import type { S } from './common.tsx';

function ReadingsTable({ rows, s, lang, caption }: { rows: ReportReading[]; s: S; lang: Lang; caption: string }) {
  if (!rows.length) return <p className="quiet">{s('report.none')}</p>;
  return (
    <table className="report-table">
      <caption className="sr-only">{caption}</caption>
      <thead><tr><th scope="col">{s('report.signal')}</th><th scope="col">{s('report.value')}</th><th scope="col">{s('report.limit')}</th><th scope="col">{s('report.kind')}</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.signal}>
            <th scope="row">{r.name}</th>
            <td className="mono">{r.value === null ? '—' : `${r.value} ${r.unit}`.trim()}{r.stale && <> · {s('report.stale')}</>} <span className="quiet">{timeOf(r.at, lang)}</span></td>
            <td className="mono">{r.limit === null ? '—' : `${r.limit} ${r.unit}`.trim()}{r.limitSource && <span className="quiet"> · {r.limitSource}</span>}</td>
            <td><span className="kind" data-kind={r.kind}>{s(`kind.${r.kind}`)}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function IncidentReport({ report, s, lang }: { report: Report; s: S; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState(false);
  const [copied, setCopied] = useState<'' | 'ok' | 'failed'>('');
  const id = useId();
  const raw = JSON.stringify(report, null, 2);
  const copy = async () => {
    try { await navigator.clipboard.writeText(raw); setCopied('ok'); } catch { setCopied('failed'); }
  };
  return (
    <div className="report">
      <p className="quiet report-line">
        {s('earth.reportSent')} · <button type="button" className="linkish" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(!open)}>{open ? s('earth.hideReport') : s('earth.viewReport')}</button>
      </p>
      {open && (
        <section id={`${id}-body`} className="report-body" aria-labelledby={`${id}-title`}>
          <h4 id={`${id}-title`} className="label">{report.summary}</h4>
          {report.restricted && <p className="quiet">{s('report.restricted')}</p>}
          <h5 className="label">{s('report.when')}</h5>
          <p>{s('report.filed', { time: timeOf(report.filedAt, lang), day: report.missionDay ?? '—', level: report.alert.level, reason: report.alert.reason })}</p>
          <h5 className="label">{s('report.where')}</h5>
          <p>{report.where.roomName ?? '—'}</p>
          <h5 className="label">{s('report.who')}</h5>
          <p>{report.who.name ?? report.who.person}</p>
          {!report.restricted && <>
            <h5 className="label">{s('report.readings')}</h5>
            <ReadingsTable rows={report.readings} s={s} lang={lang} caption={s('report.readings')} />
            <h5 className="label">{s('report.body')}</h5>
            <ReadingsTable rows={report.bodyReadings} s={s} lang={lang} caption={s('report.body')} />
          </>}
          <h5 className="label">{s('report.timeline')}</h5>
          <ol className="report-timeline">
            {report.timeline.map((e, i) => <li key={i}><span className="mono">{timeOf(e.at, lang)}</span> {e.event}</li>)}
          </ol>
          <h5 className="label">{s('report.card')}</h5>
          <p>{report.card ? report.card.title : s('report.none')}</p>
          <h5 className="label">{s('report.crewTold')}</h5>
          <p>{report.crewTold.join(', ')}</p>
          <p>
            <button type="button" className="btn" aria-expanded={json} aria-controls={`${id}-json`} onClick={() => setJson(!json)}>{json ? s('earth.hideJson') : s('earth.showJson')}</button>
            {json && <> <button type="button" className="btn" onClick={() => void copy()}>{s('earth.copy')}</button> <span className="quiet" role="status">{copied === 'ok' ? s('earth.copied') : copied === 'failed' ? s('earth.copyFailed') : ''}</span></>}
          </p>
          {json && <pre id={`${id}-json`} className="mono report-json" role="region" aria-label={s('earth.rawReport')} tabIndex={0}>{raw}</pre>}
        </section>
      )}
    </div>
  );
}
