// The hub's floating panels: connection and alerts, opened from the top bar.
// (The language switch is in Settings, panels/Settings.tsx.)
//
// They are drawn like the station: a flat dark sheet outlined in the scene's
// line colour, its corners cut at 45 degrees like the hull's octagon. Inside,
// no boxes within boxes: sections are split by one hairline, labels are plain
// sentence case, numbers are large and light. Status is a word in its colour.
// Every reading names how it came to exist (Measured, Simulated...) in words.

import type { ReactNode } from 'react';
import { hubAddress } from './data.ts';
import type { World } from './data.ts';
import type { Status } from '../../engine/status.ts';
import type { Kind, Person, Room } from '../../engine/types.ts';

type S = (key: string, vars?: Record<string, string | number>) => string;

/** A delay as it reads best: "1.3 s" under a minute, "20:00" from a minute up. */
function clock(seconds: number): string {
  if (seconds < 60) return `${Number(seconds.toFixed(seconds < 10 ? 1 : 0))} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const post = (path: string, body: unknown) => void fetch(`http://${hubAddress()}${path}`, { method: 'POST', body: JSON.stringify(body) });

/** How a reading came to exist, always written out. */
export function KindChip({ kind, s }: { kind: Kind; s: S }) {
  return <span className="kind" data-kind={kind}>{s(`kind.${kind}`)}</span>;
}

/**
 * How a reading came to exist, as a small mark (with a key nearby): a full dot
 * for Measured, half for Replayed, an empty ring for Simulated, a dashed ring
 * for Estimated, a square for Reported. Named in words for screen readers and
 * on hover.
 */
export function KindMark({ kind, s }: { kind: Kind; s: S }) {
  return <span className="kind-mark" data-kind={kind} role="img" aria-label={s(`kind.${kind}`)} title={s(`kind.${kind}`)} />;
}

/** The key to the marks, listing only the kinds on screen. */
export function KindKey({ kinds, s }: { kinds: Kind[]; s: S }) {
  const order: Kind[] = ['measured', 'replayed', 'estimated', 'reported', 'simulated'];
  return (
    <p className="kind-key" aria-hidden="true">
      {order.filter((k) => kinds.includes(k)).map((k) => <span key={k}><span className="kind-mark" data-kind={k} />{s(`kind.${k}`)}</span>)}
    </p>
  );
}

/** A status as its word, in its colour (the word carries it; the colour only repeats it). */
function StatusWord({ status, text }: { status: Status | 'live' | 'off'; text: string }) {
  return <span className="status-word" data-status={status}>{text}</span>;
}

function PanelHead({ id, title, sub, close, onClose }: { id: string; title: string; sub?: ReactNode; close: string; onClose: () => void }) {
  return (
    <div className="panel-head">
      <div>
        <h2 id={id}>{title}</h2>
        {sub && <p className="panel-sub">{sub}</p>}
      </div>
      <button type="button" className="panel-close" aria-label={close} onClick={onClose}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7L7 17" /></svg>
      </button>
    </div>
  );
}

export interface ConnectionProps {
  world: World;
  delaySeconds: number;
  s: S;
  onClose: () => void;
}

export function ConnectionPanel({ world, delaySeconds, s, onClose }: ConnectionProps) {
  const off = world.status === 'offline';
  return (
    <section id="panel-link" className="panel frame" aria-labelledby="panel-link-title">
      <PanelHead id="panel-link-title" title={s('top.link')} close={s('top.close')} onClose={onClose}
        sub={<StatusWord status={off ? 'off' : 'live'} text={s(off ? 'hub.offline' : world.status === 'replay' ? 'top.link.replay' : 'top.link.live')} />} />

      <div className="rule">
        <p className="label">{s('top.earthDelay')}</p>
        <p className="figure">{clock(delaySeconds)}</p>
      </div>

      <div className="rule">
        <h3 className="label">{s('hub.sensors')}</h3>
        {world.sources.length === 0 && <p className="quiet">{s('source.disconnected')}</p>}
        {world.sources.map((src) => (
          <div key={src.id} className="source">
            <p className="source-head">
              <span className="mono">{src.id}</span>
              <StatusWord status={src.connected ? 'live' : 'off'} text={s(src.connected ? 'source.connected' : 'source.disconnected')} />
            </p>
            {src.missing.length > 0 && (
              <p className="quiet">{s('source.missing', { list: src.missing.map((k) => s(`signal.${k}`)).join(', ') })}</p>
            )}
            {src.connected && src.id.startsWith('chip:') && (
              <div className="actions" role="group" aria-label={s('top.buzzer')}>
                {(['beep', 'alarm', 'off'] as const).map((mode) => (
                  <button key={mode} type="button" className="btn" onClick={() => post('/api/buzz', { mode })}>
                    {s(mode === 'beep' ? 'chip.beep' : mode === 'alarm' ? 'chip.alarm' : 'chip.alarmOff')}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export interface AlertsProps {
  world: World;
  alerts: World['alerts'];
  rooms: Room[];
  crew: Person[];
  now: number;
  viewer: string | null;
  s: S;
  onClose: () => void;
}

export function AlertsPanel({ world, alerts, rooms, crew, now, viewer, s, onClose }: AlertsProps) {
  const roomName = (id: string) => s(rooms.find((r) => r.id === id)?.name ?? id);
  const name = (id: string) => crew.find((p) => p.id === id)?.name ?? id;
  const shown = alerts.filter((a) => !a.held);
  const wide = [...new Set(shown.filter((a) => a.stationWide).map((a) => a.signal))];
  const single = shown.filter((a) => !a.stationWide);
  const count = world.alarms.length + wide.length + single.length;

  return (
    <section id="panel-alerts" className="panel frame" aria-labelledby="panel-alerts-title">
      <PanelHead id="panel-alerts-title" title={s('top.alerts')} close={s('top.close')} onClose={onClose}
        sub={count ? s('top.alerts.active', { count }) : <StatusWord status="ok" text={s('top.alerts.none')} />} />

      {world.alarms.map((alarm) => (
        <article key={`${alarm.room}|${alarm.signal}`} className="alert" data-level="3" role="alert">
          <h3><StatusWord status="over" text={s('status.over')} /> <span>{roomName(alarm.room)}</span></h3>
          <p>{s('alarm.over', { room: roomName(alarm.room), signal: s(`signal.${alarm.signal}`), value: alarm.value, unit: alarm.unit, limit: alarm.limit })}</p>
          <p className="quiet"><KindChip kind={alarm.kind} s={s} /></p>
          {alarm.acknowledged
            ? <p className="quiet">{s('alarm.acknowledged')}</p>
            : <div className="actions"><button type="button" className="btn btn-solid" onClick={() => post('/api/alarms/acknowledge', { room: alarm.room })}>{s('alarm.acknowledge')}</button></div>}
        </article>
      ))}

      {wide.map((signal) => {
        const group = shown.filter((a) => a.stationWide && a.signal === signal);
        const first = group[0];
        return (
          <article key={`wide|${signal}`} className="alert" data-level="3" role="alert">
            <h3><StatusWord status="over" text={s('level.3')} /></h3>
            <p>
              {s('alert.stationWide', { signal: s(`signal.${signal}`), count: new Set(group.map((a) => a.room)).size, people: group.map((a) => name(a.person)).join(', ') })}{' '}
              {first.lowestRoom ? s('alert.lowestRoom', { room: roomName(first.lowestRoom.room), value: first.lowestRoom.value, unit: first.unit ?? '' }) : s('alert.noRoomUnder')}
            </p>
            <p className="quiet"><KindChip kind={first.kind} s={s} /></p>
            {first.card && <p className="quiet">{s('alert.card', { card: first.card })}</p>}
            {first.earth && <p className="quiet">{s('alert.earth', { time: clock(Math.max(0, Math.ceil((first.earth.replyAt - now) / 1000))) })}</p>}
          </article>
        );
      })}

      {single.map((alert) => {
        const asking = alert.level === 2 && alert.answer === null && alert.answerBy !== null && viewer === alert.person;
        return (
          <article key={alert.id} className="alert" data-level={alert.level} role="alert">
            <h3><StatusWord status={alert.level >= 3 ? 'over' : alert.level === 2 ? 'watch' : 'unknown'} text={s(`level.${alert.level}`)} /> <span>{name(alert.person)}</span></h3>
            <p>
              {alert.reason === 'room-limit'
                ? s('alert.roomLimit', { person: name(alert.person), room: roomName(alert.room ?? ''), signal: s(`signal.${alert.signal}`), value: alert.value ?? '', unit: alert.unit ?? '', limit: alert.limit ?? '' })
                : s('alert.unusual', { person: name(alert.person), signal: s(`signal.${alert.signal}`) })}
            </p>
            <p className="quiet"><KindChip kind={alert.kind} s={s} />. {s('alert.toldTo', { who: alert.toldTo === 'everyone' ? s('alert.everyone') : alert.toldTo.map(name).join(', ') })}</p>
            {asking && (
              <>
                <p className="countdown">{s('alert.areYouOk', { seconds: Math.max(0, Math.ceil((alert.answerBy! - now) / 1000)) })}</p>
                <div className="actions">
                  <button type="button" className="btn btn-solid" onClick={() => post('/api/alerts/answer', { id: alert.id, answer: 'ok' })}>{s('alert.ok')}</button>
                  <button type="button" className="btn btn-danger" onClick={() => post('/api/alerts/answer', { id: alert.id, answer: 'help' })}>{s('alert.help')}</button>
                </div>
              </>
            )}
            {alert.answer === 'ok' && <p className="quiet">{s('alert.answeredOk')}</p>}
            {alert.card && <p className="quiet">{s('alert.card', { card: alert.card })}</p>}
            {alert.earth && <p className="quiet">{s('alert.earth', { time: clock(Math.max(0, Math.ceil((alert.earth.replyAt - now) / 1000))) })}</p>}
          </article>
        );
      })}
    </section>
  );
}
