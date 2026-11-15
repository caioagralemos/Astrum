// The person's body as the data display: what each region has to report, from
// what this screen may see (App.tsx). The scene draws it on the selected
// person's figure (scene/bodyPaint.ts); this list says it in words beside the
// sheet, with a shape mark and the reading's kind, so colour is never the only cue.
import type { Alert } from '../../../engine/alerts.ts';
import type { UnusualSignal } from '../../../engine/evidence.ts';
import type { Kind, Row } from '../../../engine/types.ts';
import { KindMark } from '../panels.tsx';
import './body.css';
import { REGIONS, regionOf, regionOfAlert, worse } from './regions.ts';
import type { BodyRegion, BodyStates, RegionState } from './regions.ts';

type S = (key: string, vars?: Record<string, string | number>) => string;

export interface BodyLine { region: BodyRegion; state: RegionState; text: string; kind: Kind }

/** Only what a reading or an open alert says: unusual for the person, past her limit or range, or an alert on it. */
export function bodyLines(alerts: Alert[], unusual: UnusualSignal[], latest: Row[], s: S, name: string, own: boolean): BodyLine[] {
  const lines: BodyLine[] = [];
  const whose = own ? 'you' : 'them';
  const alerted = new Set<string>();
  for (const alert of alerts) {
    const region = regionOfAlert(alert);
    if (!region) continue;
    const state: RegionState = alert.level >= 3 ? 'over' : 'watch';
    let text = s(`level.${alert.level}`);
    if (alert.signal) {
      alerted.add(alert.signal);
      const signal = s(`signal.${alert.signal}`);
      if (region === 'blood' && alert.value !== null && alert.limit !== null) text = `${signal}: ${s(alert.value > alert.limit ? 'blood.above' : 'blood.below').toLowerCase()}`;
      else text = `${signal}: ${text.toLowerCase()}`;
    }
    lines.push({ region, state, text, kind: alert.kind });
  }
  for (const u of unusual) {
    const region = regionOf(u.signal);
    if (!region || alerted.has(u.signal) || !u.direction) continue;
    const kind = latest.find((r) => r.signal === u.signal)?.kind ?? 'measured';
    lines.push({ region, state: 'watch', text: s(`person.${u.direction}.${whose}`, { signal: s(`signal.${u.signal}`), name }), kind });
  }
  return lines.sort((a, b) => REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region) || (a.state === 'over' ? -1 : 1));
}

export function statesOf(lines: BodyLine[]): BodyStates {
  const states: BodyStates = {};
  for (const line of lines) states[line.region] = worse(states[line.region], line.state);
  return states;
}

export function BodyList({ lines, s }: { lines: BodyLine[]; s: S }) {
  if (lines.length === 0) return null;
  return (
    <article className="mod body-figure">
      <ul className="body-figure-list" aria-label={s('body.title')}>
        {lines.map((line, i) => (
          <li key={i} data-state={line.state}>
            <span className={`body-figure-mark ${line.state === 'over' ? 'is-over' : ''}`} aria-hidden="true" />
            <span><b>{s(`body.${line.region}`)}</b> · {line.text} <KindMark kind={line.kind} s={s} /></span>
          </li>
        ))}
      </ul>
    </article>
  );
}
