// 9. Data quality (GET /api/quality): readings refused at the door, rooms
// whose limit cannot be judged, and sensors that may be stuck.

import type { Quality as QualityData } from '../../../engine/types.ts';
import { failure, kindName, num, Panel, roomName, signalName, sourceName, timeOf, usePoll } from './common.tsx';
import type { PanelProps } from './common.tsx';

export function Quality({ world, profile, lang, s }: PanelProps) {
  const { data, error } = usePoll<QualityData>('/api/quality', 5000);
  const room = (id: string) => roomName(profile, s, id);
  // Unjudged and stuck entries carry no unit; the room's newest reading of that signal does.
  const unitOf = (r: string, signal: string) => world.latest.find((x) => x.room === r && x.signal === signal && !x.person)?.unit ?? '';
  const clean = data && !data.rejected.length && !data.unjudged.length && !data.stuck.length;

  return (
    <Panel id="quality" title={s('bench.q.title')}>
      {error !== null && <p className="said bad">{failure(s, error)}</p>}
      {!data ? <p>{s('bench.loading')}</p> : clean ? <p>{s('bench.q.allGood')}</p> : (
        <>
          {data.rejected.length > 0 && <h3>{s('bench.q.rejected')}</h3>}
          <ul>
            {data.rejected.map((r) => (
              <li key={`${r.source}|${r.signal}|${r.unit}`}>
                {s('quality.rejected', { count: r.count, signal: signalName(r.signal, s), source: sourceName(r.source, profile, s), value: num(r.lastValue), unit: r.unit })}
                {' · '}{timeOf(r.lastAt, lang)}
              </li>
            ))}
          </ul>
          {data.unjudged.length > 0 && <h3>{s('bench.q.unjudged')}</h3>}
          <ul>
            {data.unjudged.map((u) => (
              <li key={`${u.room}|${u.signal}`}>
                {u.reason === 'stuck' && u.last
                  ? s('quality.stuck', { room: room(u.room), signal: signalName(u.signal, s), value: num(u.last.value), unit: unitOf(u.room, u.signal), minutes: Math.round((world.now - u.since) / 60_000) })
                  : u.last ? s('quality.noReading', { room: room(u.room), signal: signalName(u.signal, s), time: timeOf(u.last.t, lang) })
                    : s('quality.neverRead', { room: room(u.room), signal: signalName(u.signal, s) })}
                {u.last && <div className="muted">{s('bench.q.last', { value: num(u.last.value), unit: unitOf(u.room, u.signal), kind: kindName(u.last.kind, s), source: sourceName(u.last.source, profile, s) })}</div>}
              </li>
            ))}
          </ul>
          {data.stuck.length > 0 && <h3>{s('bench.q.stuck')}</h3>}
          <ul>
            {data.stuck.map((x) => (
              <li key={`${x.room}|${x.signal}|${x.source}`}>
                {s('quality.stuck', { room: room(x.room), signal: signalName(x.signal, s), value: num(x.value), unit: unitOf(x.room, x.signal), minutes: Math.round((x.lastAt - x.since) / 60_000) })}
                {' · '}{kindName(x.kind, s)} · {sourceName(x.source, profile, s)}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
