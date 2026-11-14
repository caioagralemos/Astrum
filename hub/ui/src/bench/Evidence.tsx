// 2. The evidence card for the chosen person (GET /api/evidence): the four
// questions as data, and where it points with its reasons. "Points to",
// never "caused by"; every number with its label.

import { CO2_LEVELS } from '../../../engine/exposure.ts';
import type { Evidence, PersonExposure, Reason } from '../../../engine/evidence.ts';
import { failure, hours, kindName, num, Panel, personName, roomName, signalName, sourceName, Tag, timeOf, usePoll } from './common.tsx';
import type { PanelProps, S } from './common.tsx';
import type { Profile } from '../../../engine/types.ts';

const LEVELS = CO2_LEVELS.map((l) => l.level);

export function EvidencePanel({ profile, me, lang, s }: PanelProps) {
  const { data, error, reload } = usePoll<Evidence>(`/api/evidence?person=${encodeURIComponent(me)}`, 60_000);
  const name = (id: string) => personName(profile, id);
  const room = (id: string | null) => roomName(profile, s, id);

  return (
    <Panel id="evidence" title={s('evidence.title')} wide>
      <p>{s('bench.ev.for', { person: name(me) })} <button type="button" onClick={reload}>{s('bench.refresh')}</button></p>
      {error !== null && <p className="said bad">{failure(s, error)}</p>}
      {!data ? <p>{s('bench.loading')}</p> : data.person !== me ? null : (
        <>
          <h3>1. {s('evidence.unusualFor', { person: name(me) })}</h3>
          {data.unusual.signals.length === 0 ? <p>{s('evidence.nothingUnusual', { person: name(me) })}</p> : (
            <ul>
              {data.unusual.signals.map((u) => (
                <li key={u.signal}>
                  {s(u.direction === 'low' ? 'evidence.lower' : 'evidence.higher', { signal: signalName(u.signal, s), recent: num(u.recent, 1), usual: num(u.usual, 1) })}
                  {' '}<Tag>{kindName(u.kind, s)}</Tag>
                  <br /><small className="muted">{s('evidence.history', { count: u.baselineCount })}</small>
                </li>
              ))}
            </ul>
          )}

          <h3>2. {s('evidence.sameRoom')}</h3>
          {data.sameRoom.length === 0 ? <p>{s('evidence.sameRoomNobody')}</p> : (
            <ul>
              {data.sameRoom.map((r) => (
                <li key={r.signal}>
                  {signalName(r.signal, s)} · {r.room ? s('bench.ev.inRoom', { room: room(r.room) }) : s('bench.ev.notPlaced')}:{' '}
                  {r.same.length ? s('evidence.sameRoomShows', { people: r.same.map(name).join(', ') })
                    : r.judged.length ? s('evidence.sameRoomNormal', { people: r.judged.map(name).join(', ') })
                      : s('evidence.sameRoomNobody')}
                </li>
              ))}
            </ul>
          )}

          <h3>3. {s('evidence.whereBeen')}</h3>
          {data.whereBeen.onlyThem.map((o) => <p key={o.room}>{s('evidence.onlyThem', { person: name(me), room: room(o.room) })} ({s('evidence.hoursIn', { hours: hours(o.ms), room: room(o.room) })}) <Tag>{kindName(o.stayKind, s)}</Tag></p>)}
          {[...data.whereBeen.windows].sort((a, b) => a.ms - b.ms).map((w) => (
            <div key={w.ms} className="scroll">
              <table>
                <caption>{s(w.ms <= 24 * 3600_000 ? 'evidence.last24' : 'evidence.last72')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{s('bench.ev.who')}</th>
                    <th scope="col">{s('bench.ev.rooms')}</th>
                    <th scope="col">{s('bench.ev.breathed')}</th>
                    {LEVELS.map((l) => <th key={l} scope="col">{s('bench.ev.aboveCol', { level: l })}</th>)}
                    <th scope="col">{s('bench.ev.labels')}</th>
                  </tr>
                </thead>
                <tbody>
                  {w.people.map((p) => <ExposureRow key={p.person} p={p} total={w.ms} me={me} profile={profile} s={s} />)}
                </tbody>
              </table>
            </div>
          ))}

          <h3>4. {s('evidence.reported')}</h3>
          {data.reported.rows.length === 0 ? <p>{s('evidence.reportedNone')}</p> : (
            <>
              <ul>
                {data.reported.runs.map((r) => (
                  <li key={r.signal}>
                    {r.days >= 2 ? s('evidence.reportedRun', { signal: signalName(r.signal, s), days: r.days }) : s('bench.ev.answers', { signal: signalName(r.signal, s), count: r.count })}
                    {' '}<Tag>{kindName(r.kind, s)}</Tag>
                  </li>
                ))}
              </ul>
              <details>
                <summary>{s('bench.ci.stored', { person: name(me) })}</summary>
                <ul>
                  {[...data.reported.rows].reverse().map((r, i) => (
                    <li key={i}>{timeOf(r.t, lang)} · {signalName(r.signal, s)}: {r.value ?? r.text} <Tag>{kindName(r.kind, s)}</Tag></li>
                  ))}
                </ul>
              </details>
            </>
          )}

          <h3>{s('bench.ev.verdict')}</h3>
          <p className="verdict" role="status">
            <strong>{data.pointsTo === 'room' ? s('evidence.pointsTo.room', { room: room(data.focusRoom) })
              : data.pointsTo === 'person' ? s('evidence.pointsTo.person', { person: name(me) })
                : s(`evidence.pointsTo.${data.pointsTo}`)}</strong>
          </p>
          <h4>{s('bench.ev.reasons')}</h4>
          {data.reasons.length === 0 ? <p>{s('bench.ev.noReasons')}</p> : (
            <ul>{data.reasons.map((r, i) => <li key={i}>{reasonText(r, profile, s, data.now)}</li>)}</ul>
          )}
          <p className="muted">{s('evidence.notDiagnosis')}</p>
        </>
      )}
    </Panel>
  );
}

function ExposureRow({ p, total, me, profile, s }: { p: PersonExposure; total: number; me: string; profile: Profile; s: S }) {
  const at = (level: number) => p.above.find((a) => a.level === level)?.ms ?? 0;
  const labels = [p.kind && s('bench.labelPart', { what: s('bench.what.co2'), kind: kindName(p.kind, s) }), p.stayKind && s('bench.labelPart', { what: s('bench.what.location'), kind: kindName(p.stayKind, s) })].filter(Boolean).join('; ');
  return (
    <tr className={p.person === me ? 'me' : undefined}>
      <th scope="row">{personName(profile, p.person)}</th>
      <td>
        {p.rooms.map((r) => <div key={r.room}>{s('evidence.hoursIn', { hours: hours(r.ms), room: roomName(profile, s, r.room) })}{r.average !== null && <> · {num(r.average)} mmHg</>}</div>)}
      </td>
      <td>
        {p.average === null ? s('bench.ev.noCo2') : num(p.average)}
        {p.covered < total && <div className="muted">{s('bench.ev.covered', { covered: hours(p.covered), total: hours(total) })}</div>}
      </td>
      {LEVELS.map((l) => <td key={l}>{hours(at(l))}</td>)}
      <td>{labels}</td>
    </tr>
  );
}

function reasonText(r: Reason, profile: Profile, s: S, now: number): string {
  const room = (id: string | null) => roomName(profile, s, id);
  const people = (ids: string[]) => ids.map((id) => personName(profile, id)).join(', ');
  if (r.code === 'exposure-stands-out') {
    return `${s('evidence.reason.exposure', { hours: hours(r.ms), level: r.level })}${r.room ? ` (${room(r.room)})` : ''} · ${kindName(r.kind, s)}`;
  }
  if (r.code === 'crewmates-same') return `${s('evidence.reason.crewmatesSame')}: ${people(r.people)}`;
  if (r.code === 'crewmates-normal') return `${s('evidence.reason.crewmatesNormal')}: ${people(r.people)}`;
  const p = r.problem;
  const minutes = p.t === null ? 0 : Math.round((now - p.t) / 60_000);
  const text = s(`evidence.reason.${p.problem}`, {
    room: room(p.room), signal: signalName(p.signal, s), minutes, value: p.value === null ? '' : num(p.value), other: p.other ? num(p.other.value) : '',
  });
  return p.source ? `${text} · ${sourceName(p.source, profile, s)}${p.kind ? ` · ${kindName(p.kind, s)}` : ''}` : text;
}
