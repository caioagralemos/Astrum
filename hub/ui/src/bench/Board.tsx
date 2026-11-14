// 7. The sensor board: its status, the parts not answering, the live values
// in its room from every source with their labels, and its buzzer.

import { useState } from 'react';
import { isFresh } from '../../../engine/timeline.ts';
import { ago, call, failure, kindName, num, Panel, roomName, Said, signalName, sourceName, Tag } from './common.tsx';
import type { PanelProps } from './common.tsx';

export function Board({ world, profile, s }: PanelProps) {
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const chips = world.sources.filter((x) => x.id.startsWith('chip:'));
  const buzz = async (mode: 'beep' | 'alarm' | 'off') => {
    const r = await call('/api/buzz', { method: 'POST', body: { mode } });
    setSaid(r.ok ? { text: s('bench.sent'), bad: false } : { text: failure(s, r.error), bad: true });
  };

  return (
    <Panel id="board" title={s('bench.bd.title')}>
      {chips.length === 0 && <p>{s('bench.bd.none')}</p>}
      {chips.map((chip) => {
        const room = chip.room ?? profile.chips[chip.id.slice('chip:'.length)] ?? null;
        const rows = world.latest
          .filter((r) => r.room === room && !r.person)
          .sort((a, b) => a.signal.localeCompare(b.signal) || a.source.localeCompare(b.source));
        return (
          <article key={chip.id} className="item">
            <p>
              <strong>{s(chip.connected ? 'source.connected' : 'source.disconnected')}</strong>
              {room && <> · {s('bench.bd.room', { room: roomName(profile, s, room) })}</>}
              {chip.lastSeen && <> · {s('bench.bd.lastSeen', { ago: ago(chip.lastSeen, world.now, s) })}</>}
            </p>
            {chip.live.length > 0 && <p>{s('bench.bd.sending', { list: chip.live.map((k) => signalName(k, s)).join(', ') })}</p>}
            {chip.missing.length > 0 && <p>{s('source.missing', { list: chip.missing.map((k) => signalName(k, s)).join(', ') })}</p>}
            {room && (
              <>
                <h3>{s('bench.bd.values', { room: roomName(profile, s, room) })}</h3>
                {rows.length === 0 ? <p>{s('reading.none')}</p> : (
                  <dl className="readings">
                    {rows.map((r) => (
                      <div key={`${r.signal}|${r.source}`}>
                        <dt>{signalName(r.signal, s)}</dt>
                        <dd>
                          {r.value === null ? r.text : `${num(r.value)} ${r.unit}`} <Tag>{kindName(r.kind, s)}</Tag>{' '}
                          <span className="muted">{r.source.startsWith('sim:') ? '' : sourceName(r.source, profile, s)}{isFresh(r, world.now) ? '' : ` · ${s('reading.stale')}`}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </>
            )}
          </article>
        );
      })}
      <h3>{s('bench.bd.buzzer')}</h3>
      <p className="muted">{s('bench.bd.liveWarning')}</p>
      <div className="row">
        <button type="button" onClick={() => void buzz('beep')}>{s('chip.beep')}</button>
        <button type="button" onClick={() => void buzz('alarm')}>{s('chip.alarm')}</button>
        <button type="button" onClick={() => void buzz('off')}>{s('chip.alarmOff')}</button>
      </div>
      {said && <Said text={said.text} bad={said.bad} />}
    </Panel>
  );
}
