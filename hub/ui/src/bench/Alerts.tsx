// 3. Alerts and alarms: everything in world.alarms, world.alerts and
// world.earthMessages, with the buttons that answer them.

import { useState } from 'react';
import type { Alert, EarthMessage } from '../../../engine/alerts.ts';
import type { RoomAlarm } from '../../../engine/cabin.ts';
import { call, clock, failure, kindName, num, Panel, personName, roomName, Said, signalName, sourceName, Tag, timeOf } from './common.tsx';
import type { PanelProps, S } from './common.tsx';

export function Alerts(props: PanelProps) {
  const { world, s } = props;
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const post = async (path: string, body: unknown) => {
    const r = await call(path, { method: 'POST', body });
    setSaid(r.ok ? { text: s('bench.sent'), bad: false } : { text: failure(s, r.error), bad: true });
  };
  const nothing = !world.alarms.length && !world.alerts.length && !world.earthMessages.length;

  return (
    <Panel id="alerts" title={s('bench.al.title')}>
      <div aria-live="polite">
        {nothing && <p>{s('bench.al.none')}</p>}
        {world.alarms.length > 0 && <h3>{s('bench.al.alarms')}</h3>}
        {world.alarms.map((a) => <AlarmItem key={`${a.room}|${a.signal}`} alarm={a} post={post} {...props} />)}
        {world.alerts.length > 0 && <h3>{s('bench.al.alerts')}</h3>}
        {world.alerts.map((a) => <AlertItem key={a.id} alert={a} post={post} {...props} />)}
        {world.earthMessages.length > 0 && <h3>{s('bench.al.earth')}</h3>}
        {world.earthMessages.map((m) => <EarthItem key={m.id} message={m} {...props} />)}
      </div>
      {said && <Said text={said.text} bad={said.bad} />}
    </Panel>
  );
}

type Post = (path: string, body: unknown) => Promise<void>;

function AlarmItem({ alarm, post, profile, world, lang, s }: PanelProps & { alarm: RoomAlarm; post: Post }) {
  const room = roomName(profile, s, alarm.room);
  return (
    <article className="item">
      <p><strong>{s('alarm.over', { room, signal: signalName(alarm.signal, s), value: alarm.value, unit: alarm.unit, limit: alarm.limit })}</strong></p>
      <p>
        {alarm.over != null && <>{s('alert.over', { over: alarm.over, unit: alarm.unit })} · </>}
        <Tag>{kindName(alarm.kind, s)}</Tag> {s('bench.from', { source: sourceName(alarm.source, profile, s) })} · {s('bench.al.since', { time: timeOf(alarm.since, lang) })}
      </p>
      {alarm.stale && alarm.lastReading && <p>{s('alarm.stale', { value: num(alarm.lastReading.value), unit: alarm.unit, minutes: Math.round((world.now - alarm.lastReading.t) / 60_000) })}</p>}
      {alarm.stuck && <p>{s('alarm.stuck')}</p>}
      <LimitSource text={alarm.limitSource} s={s} />
      {alarm.acknowledged ? <p>{s('alarm.acknowledged')}</p>
        : <button type="button" onClick={() => void post('/api/alarms/acknowledge', { room: alarm.room })}>{s('alarm.acknowledge')}</button>}
    </article>
  );
}

function AlertItem({ alert, post, profile, world, me, lang, s }: PanelProps & { alert: Alert; post: Post }) {
  const name = (id: string) => personName(profile, id);
  const room = roomName(profile, s, alert.room);
  const signal = signalName(alert.signal, s);
  const left = alert.answerBy === null ? 0 : (alert.answerBy - world.now) / 1000;
  const asking = alert.level === 2 && alert.answer === null && alert.answerBy !== null;
  const headline = alert.stationWide
    ? s('alert.stationWide', {
      signal, count: new Set(world.alerts.filter((a) => a.stationWide && a.signal === alert.signal).map((a) => a.room)).size,
      people: world.alerts.filter((a) => a.stationWide && a.signal === alert.signal).map((a) => name(a.person)).join(', '),
    })
    : alert.reason === 'room-limit'
      ? s('alert.roomLimit', { person: name(alert.person), room, signal, value: alert.value ?? '', unit: alert.unit ?? '', limit: alert.limit ?? '' })
      : s('alert.unusual', { person: name(alert.person), signal });

  return (
    <article className="item">
      <p><Tag>{s(`level.${alert.level}`)}</Tag> <strong>{headline}</strong></p>
      <p>
        {alert.over != null && <>{s('alert.over', { over: alert.over, unit: alert.unit ?? '' })} · </>}
        {alert.direction && alert.reason === 'unusual' && <>{s(`bench.al.direction.${alert.direction}`)} · </>}
        <Tag>{kindName(alert.kind, s)}</Tag> · {s('bench.al.since', { time: timeOf(alert.since, lang) })}
      </p>
      {alert.stationWide && <p>{alert.lowestRoom ? s('alert.lowestRoom', { room: roomName(profile, s, alert.lowestRoom.room), value: alert.lowestRoom.value, unit: alert.unit ?? '' }) : s('alert.noRoomUnder')}</p>}
      <p>{alert.held ? s('bench.al.held', { person: name(alert.person) }) : s('alert.toldTo', { who: alert.toldTo === 'everyone' ? s('alert.everyone') : alert.toldTo.map(name).join(', ') })}</p>
      {alert.limitSource && <LimitSource text={alert.limitSource} s={s} />}

      {asking && (
        <div className="ask-ok">
          <p aria-live="off">{left > 0 ? s(alert.askKey ?? 'alert.areYouOk', { seconds: Math.ceil(left) }) : s('bench.al.countdownOver')}</p>
          {me === alert.person ? (
            <p className="row">
              <button type="button" onClick={() => void post('/api/alerts/answer', { id: alert.id, answer: 'ok' })}>{s('alert.ok')}</button>
              <button type="button" onClick={() => void post('/api/alerts/answer', { id: alert.id, answer: 'help' })}>{s('alert.help')}</button>
            </p>
          ) : <p className="muted">{s('bench.al.onlyThem', { person: name(alert.person) })}</p>}
        </div>
      )}
      {alert.answer === 'ok' && <p>{s('alert.answeredOk')}</p>}
      {alert.answer === 'help' && <p>{s('bench.al.answeredHelp')}</p>}

      {alert.card && <p>{s('alert.card', { card: alert.card })}</p>}
      {alert.earth && (
        <p aria-live="off">
          {s('alert.earth', { time: clock((alert.earth.replyAt - world.now) / 1000) })}{' '}
          {alert.earthInTime === true ? s('alert.earthInTime', { reply: clock((alert.earth.replyAt - alert.levelSince) / 1000), act: clock(alert.actWithinSeconds ?? 0) })
            : alert.earthInTime === false ? s('alert.earthTooLate', { reply: clock((alert.earth.replyAt - alert.levelSince) / 1000), act: clock(alert.actWithinSeconds ?? 0) })
              : alert.level === 3 ? s('alert.earthUnknown', { reply: clock((alert.earth.replyAt - alert.levelSince) / 1000) }) : ''}
        </p>
      )}
      {alert.level === 3 && (alert.seenAt
        ? <p>{s('alert.seenBy', { who: alert.seenBy ? name(alert.seenBy) : s('alert.everyone') })} · {timeOf(alert.seenAt, lang)}</p>
        : <button type="button" onClick={() => void post('/api/alerts/acknowledge', { id: alert.id, by: me })}>{s('alert.seeIt')}</button>)}
    </article>
  );
}

function EarthItem({ message, profile, world, s }: PanelProps & { message: EarthMessage }) {
  const person = personName(profile, message.about.person);
  const reply = (message.replyAt - world.now) / 1000;
  const arrive = (message.arrivesAt - world.now) / 1000;
  const room = message.about.room ? s('bench.al.inRoom', { room: roomName(profile, s, message.about.room) }) : '';
  return (
    <article className="item" aria-live="off">
      <p>
        <strong>{reply <= 0 ? s('earth.replyDue', { person })
          : message.resolvedAt !== null ? s('earth.resolvedPending', { person, time: clock(reply) })
            : s('earth.pending', { person, time: clock(reply) })}</strong>
      </p>
      <p>
        {arrive > 0 ? s('bench.al.reaches', { time: clock(arrive) }) : s('bench.al.reached')} ·{' '}
        {s('bench.al.about', { person, signal: signalName(message.about.signal, s), room })} · <Tag>{s(`level.${message.about.level}`)}</Tag>
        {message.about.stationWide && <> · {s('bench.al.stationWide')}</>}
      </p>
    </article>
  );
}

function LimitSource({ text, s }: { text: string; s: S }) {
  return (
    <details>
      <summary>{s('bench.al.limitSource')}</summary>
      <p className="muted">{s('bench.hubWords')}</p>
      <p lang="en">{text}</p>
    </details>
  );
}
