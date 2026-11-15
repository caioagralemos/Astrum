// A tapped room, read at a glance in the widgets along the bottom of the
// station (they take the place of the station overview, dock/StationDock.tsx),
// the way Apple's Weather app reads a city:
// each reading gets a picture made for what it measures, and the pictures are
// sized by what matters most to the people breathing there.
//
//   Breathing  CO2, the one reading with a verified NASA limit: a big number
//              on a bar split into NASA's zones, the last hours beneath.
//   Comfort    two cards of two halves, each half its label, a line instrument
//              and its number: oxygen as its trace, temperature and pressure
//              as a needle on their last 24 hours, humidity as a needle on its
//              own 0 to 100 scale.
//   The rest   a quiet strip: air quality, radiation, noise, light, vibration,
//              each a number over its last hours as stems.
//
// Only CO2 is judged. Everything else is shown against its own last 24 hours
// (or, for humidity, its own 0 to 100 scale): no invented "good" range.
// Every reading carries a mark for how it came to exist (Measured, Replayed,
// Simulated...), keyed at the foot, and every module says it all in words to a
// screen reader.

import { useMemo } from 'react';
import { CO2_LEVELS } from '../../../engine/exposure.ts';
import type { Status } from '../../../engine/status.ts';
import type { Kind, Room, Row } from '../../../engine/types.ts';
import { useHub } from '../hub.ts';
import { formatValue } from '../person/PersonView.tsx';
import { Glyph, SignalIcon } from '../person/icons.tsx';
import { KindKey, KindMark } from '../panels.tsx';
import { ArcGauge, Bars, Scale, Spark, trend } from './viz.tsx';
import type { Zone } from './viz.tsx';

type S = (key: string, vars?: Record<string, string | number>) => string;
type Point = { t: number; v: number };

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const COMFORT = ['oxygen', 'pressure', 'temperature', 'humidity'];
const STRIP = ['air_quality', 'radiation', 'noise', 'light', 'vibration'];

export interface RoomViewProps {
  room: Room;
  status: Status;
  /** The value shown for each of the room's signals now. */
  rows: Row[];
  /** Who is here. */
  people: { id: string; name: string }[];
  now: number;
  s: S;
}

export function RoomView({ room, status, rows, people, now, s }: RoomViewProps) {
  const minute = Math.floor(now / 60_000) * 60_000;
  const history = useHub<{ rows: Row[] }>(`/api/rows?room=${room.id}&from=${minute - DAY}&limit=50000`);

  // Each signal's last 24 hours, from the same source as the value shown now.
  const traces = useMemo(() => {
    const map = new Map<string, Point[]>();
    if (history.state !== 'ready') return map;
    for (const row of rows) {
      map.set(row.signal, history.value.rows
        .filter((r) => r.signal === row.signal && r.source === row.source && !r.person && r.value !== null)
        .map((r) => ({ t: r.t, v: r.value as number })));
    }
    return map;
  }, [history, rows]);

  const row = (signal: string) => rows.find((r) => r.signal === signal && r.value !== null);
  const trace = (signal: string) => traces.get(signal) ?? [];
  const span = (signal: string) => {
    const values = trace(signal).map((p) => p.v);
    return values.length ? { low: Math.min(...values), high: Math.max(...values) } : null;
  };
  const kinds = [...new Set(rows.map((r) => r.kind))] as Kind[];

  /** Everything a module shows, in one sentence for a screen reader. */
  const said = (r: Row, extra: string[] = []) => {
    const way = trend(trace(r.signal), now);
    const range = span(r.signal);
    return [s(`signal.${r.signal}`), formatValue(r, s), ...extra, way ? s(`trend.${way}`) : '',
      range ? s('room.dayRange', { low: round(range.low), high: round(range.high) }) : '', s(`kind.${r.kind}`)].filter(Boolean).join(', ');
  };

  const head = (r: Row) => (
    <p className="mod-head">
      <SignalIcon signal={r.signal} />
      <span>{s(`signal.${r.signal}.short`)}</span>
      <KindMark kind={r.kind} s={s} />
    </p>
  );
  /** The number with its unit, and beside it which way the reading is going, if it is on the move. */
  const big = (r: Row) => {
    const unit = unitOf(r);
    return (
      <p className="mod-value">
        {valueOnly(r, s)}{unit && <span className="unit" data-degree={unit === '°' ? '' : undefined}>{unit}</span>}
        <TrendMark way={trend(trace(r.signal), now)} />
      </p>
    );
  };

  const co2 = row('co2');
  const headache = CO2_LEVELS[0].level;
  const limit = CO2_LEVELS[1].level;
  const zones: Zone[] = [{ from: 1.5, to: headache, tone: 'ok' }, { from: headache, to: limit, tone: 'watch' }, { from: limit, to: 4.5, tone: 'over' }];
  const co2Tone = co2?.value == null ? undefined : co2.value > limit ? 'over' : co2.value >= headache ? 'watch' : 'ok';

  const comfort = COMFORT.map(row).filter((r): r is Row => Boolean(r));
  const strip = [...STRIP, ...rows.map((r) => r.signal).filter((k) => k !== 'co2' && !COMFORT.includes(k) && !STRIP.includes(k))]
    .map(row).filter((r): r is Row => Boolean(r));

  /** One reading filling half a card: its label row, its instrument, its number, the same in every half. */
  const half = (r: Row) => (
    <article key={r.signal} className="w-half" data-signal={r.signal} aria-label={said(r)}>
      {head(r)}
      <div className="w-half-body" aria-hidden="true">
        <div className="w-half-pic">
          {r.signal === 'oxygen' ? <Spark points={trace(r.signal).filter((p) => p.t > now - 12 * HOUR)} />
            : <Scale now={r.value as number} range={span(r.signal)} scale={r.signal === 'humidity' ? [0, 100] : undefined} />}
        </div>
        {big(r)}
      </div>
    </article>
  );
  // A pair with one reading missing (no oxygen sensor, say) is filled from the small readings on the right,
  // first one first, so no card stands half empty; what was moved leaves the right-hand group.
  const spare = [...strip];
  const pair = (signals: string[], key: string) => {
    const found = signals.map(row).filter((r): r is Row => Boolean(r));
    while (found.length > 0 && found.length < signals.length && spare.length > 0) found.push(spare.shift() as Row);
    return found.length ? <section key={key} className="widget-card w-pair">{found.map(half)}</section> : null;
  };
  const warmth = pair(['temperature', 'humidity'], 'warmth');
  const air = pair(['oxygen', 'pressure'], 'air');

  return (
    <div className="dock dock-room" role="group" aria-labelledby="room-name">
      <section className="widget-card w-room" data-tone={co2Tone}>
        <div className="w-room-words">
          <h2 id="room-name">{s(room.name)}</h2>
          <p className="room-status" data-status={status}>{s(status === 'unknown' && rows.some((r) => r.value !== null) ? 'room.summary.noCo2' : `room.summary.${status}`)}</p>
          <p className="room-people">{people.length ? people.map((p) => p.name).join(', ') : s('hub.nobody')}</p>
        </div>
        {co2 && co2.value !== null && (
          <div className="w-room-co2" role="img" aria-label={said(co2, [s(`co2.zone.${co2Tone}`)])}>
            <ArcGauge value={co2.value} min={1.5} max={4} zones={zones.map((z) => ({ ...z, to: Math.min(z.to, 4) }))}
              marks={[{ at: headache, label: String(headache) }, { at: limit, label: String(limit) }]} />
            <p className="w-room-co2-value" aria-hidden="true">{Number(co2.value.toFixed(2))}</p>
            <p className="w-room-co2-unit" aria-hidden="true">{co2.unit} CO2 <KindMark kind={co2.kind} s={s} /></p>
          </div>
        )}
      </section>

      {warmth}
      {air}

      {spare.length > 0 && (
        <section className="widget-card w-rest">
          <div className="w-rest-top"><KindKey kinds={kinds} s={s} /></div>
          <div className="w-rest-cols">
            {spare.map((r) => (
              <article key={r.signal} className="w-col-reading" data-signal={r.signal} aria-label={said(r)}>
                <p className="w-col-head" aria-hidden="true"><SignalIcon signal={r.signal} /><KindMark kind={r.kind} s={s} /></p>
                <Bars points={trace(r.signal)} now={now} />
                <p className="w-col-big" aria-hidden="true">{valueOnly(r, s)}</p>
                <p className="w-col-label" aria-hidden="true">{s(`signal.${r.signal}.short`)}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TrendMark({ way }: { way: 'rising' | 'falling' | 'steady' | null }) {
  // Steady says nothing worth a mark; only a reading on the move gets one.
  if (!way || way === 'steady') return null;
  return <span className="trend-mark" data-way={way}><Glyph name={way === 'rising' ? 'up' : way === 'falling' ? 'down' : 'flat'} /></span>;
}

function round(v: number): string {
  return String(Number(v.toFixed(Math.abs(v) < 10 ? 1 : 0)));
}

/** The number alone; the unit is set smaller beside it. */
function valueOnly(row: Row, s: (key: string) => string): string {
  if (row.value === null) return row.text ?? '';
  if (row.unit === 'raw' || row.unit === 'index' || row.unit === '%' || row.unit === 'yes/no') return formatValue(row, s).replace('%', '');
  return round(row.value);
}

function unitOf(row: Row): string {
  if (row.unit === 'raw' || row.unit === 'index' || row.unit === 'yes/no') return '';
  if (row.unit === 'C') return '°';
  if (row.unit === 'uGy/day') return 'µGy/d';
  return row.unit;
}
