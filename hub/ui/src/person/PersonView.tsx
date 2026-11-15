// The person view: what opens when a crewmate is tapped. One composed sheet
// that never scrolls, in the room view's language (neutral cards, light white
// numbers, colour only inside the data), ordered by importance:
//
//   1. The headline: whatever is furthest from this person's usual (the hub's
//      evidence card decides what is unusual), as a chart against their usual
//      range. With nothing unusual, their heart rate.
//   2. Four vitals in one card, each with its own picture: heart rate (or the
//      next signal), blood pressure as one figure, sleep as a week of nights,
//      exercise as a ring filled against their own usual.
//   3. The air where the data points (or where they are), on the same NASA bar
//      as the room view.
//   4. The rest (how they said they feel, the night's detail) as a quiet strip.
//   5. Where it points, in the evidence card's words, never "caused by".
//
// Tapping any reading makes it the headline. Every reading carries its kind
// mark (Measured, Simulated...), named in words for screen readers.

import { useEffect, useMemo, useState } from 'react';
import { useHub } from '../hub.ts';
import type { Load } from '../hub.ts';
import { isReplay } from '../data.ts';
import { isCurrentReading, personSummary } from '../../../engine/baseline.ts';
import type { Judged, SignalBaseline } from '../../../engine/baseline.ts';
import { CO2_LEVELS } from '../../../engine/exposure.ts';
import type { Evidence } from '../../../engine/evidence.ts';
import type { Alert } from '../../../engine/alerts.ts';
import type { DoseCoverage, PersonDose } from '../../../engine/dose.ts';
import type { Lang } from '../../../engine/strings.ts';
import type { Kind, Person, Room, Row } from '../../../engine/types.ts';
import { Chart } from './Chart.tsx';
import { FollowUp } from './FollowUp.tsx';
import { BodyList } from './BodyFigure.tsx';
import type { BodyLine } from './BodyFigure.tsx';
import type { FollowUpAsk } from '../../../engine/followup.ts';
import type { Point } from './Chart.tsx';
import { SignalIcon } from './icons.tsx';
import { KindKey, KindMark } from '../panels.tsx';
import { Gauge } from '../room/viz.tsx';
import type { LastSeen } from '../../../engine/timeline.ts';
import { timeOf } from '../panels/common.tsx';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const DENSE_WINDOW = 12 * HOUR;
const DAILY_WINDOW = 14 * DAY;

/** The four vitals' places, in order of preference. */
const VITALS = ['heart_rate', 'blood_pressure_systolic', 'sleep_duration', 'exercise_minutes', 'hrv', 'sleep_efficiency', 'sleep_awakenings'];
/** Shown with its partner, never on its own. */
const PARTNER: Record<string, string> = { blood_pressure_systolic: 'blood_pressure_diastolic' };
/**
 * What may be a reading on this sheet, in the strip's order: body readings by
 * family (heart, breathing, sleep, activity, how they feel), then check-in
 * answers. Nothing else: a message to Earth, a typed note or a blood result is not a tile.
 */
const READINGS = ['heart_rate', 'resting_heart_rate', 'hrv', 'blood_pressure_systolic', 'breathing_rate', 'respiratory_rate', 'blood_oxygen', 'body_temperature',
  'sleep_duration', 'sleep_efficiency', 'sleep_awakenings', 'exercise_minutes', 'steps', 'active_energy', 'sound_level', 'mood.stress', 'mood.fatigue', 'mood.sleepy'];
const readingRank = (signal: string) => {
  const i = READINGS.indexOf(signal);
  return i >= 0 ? i : signal.startsWith('checkin.') ? READINGS.length : -1;
};

type S = (key: string, vars?: Record<string, string | number>) => string;

export interface PersonViewProps {
  person: Person;
  rooms: Room[];
  crew: Person[];
  /** The newest value of every signal and place. */
  latest: Row[];
  /** The room they are in now, if known. */
  room: string | null;
  /** Display only, when `room` is null: the last room the hub knew for them, when and how (null: never known). */
  lastSeen?: LastSeen | null;
  now: number;
  s: S;
  lang: Lang;
  /** True on the person's own phone: the words say "your". */
  own: boolean;
  /** This person's open alerts (as the viewer may see them). An alert speaks before their readings do. */
  alerts: Alert[];
  /** Their radiation dose (engine/dose.ts), or null when there is none. */
  dose: PersonDose | null;
  /** What their body shows, region by region (App.tsx, person/BodyFigure.tsx): the words beside the scene's coloured figure. */
  body: BodyLine[];
  /** The medical lead's follow-up question waiting for them: shown on their own screen only. */
  followUp: FollowUpAsk | null;
  /** A recorded story is playing: nothing can be answered. */
  recorded: boolean;
  /** Their evidence card as the recording carries it; used in a browser replay, which has no hub to ask. */
  recordedEvidence?: Evidence | null;
}

export function PersonView({ person, rooms, crew, latest, room, lastSeen = null, now, s, lang, own, alerts, dose, followUp, recorded, body, recordedEvidence = null }: PersonViewProps) {
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [person.id]);

  // Asked once a minute; the minute in the address keeps the request stable in between.
  const minute = Math.floor(now / 60_000) * 60_000;
  const history = useHub<{ rows: Row[] }>(`/api/rows?person=${person.id}&from=${minute - DAILY_WINDOW - DAY}&limit=50000`);
  const asked = useHub<Evidence>(`/api/evidence?person=${person.id}`);
  const evidence: Load<Evidence> = isReplay() && recordedEvidence ? { state: 'ready', value: recordedEvidence } : asked;
  // The most serious alert on them, if any: its room is the air that matters.
  const alert = [...alerts].sort((a, b) => b.level - a.level)[0];
  const airRoom = alert?.room ?? room ?? (evidence.state === 'ready' ? evidence.value.focusRoom : null);

  const rows = useMemo(() => (history.state === 'ready' ? history.value.rows.filter((r) => r.person === person.id && !r.signal.startsWith('blood.')) : []), [history, person.id]);
  const summary = useMemo(() => personSummary(rows, person.id, now), [rows, person.id, Math.floor(now / 60_000)]);
  const baseline = new Map<string, SignalBaseline>(summary.signals.map((b) => [b.signal, b]));
  const mine = latest.filter((r) => r.person === person.id && !r.signal.startsWith('blood.'));
  const latestOf = (signal: string) => mine.find((r) => r.signal === signal) ?? rows.filter((r) => r.signal === signal).at(-1);
  const has = (signal: string) => Boolean(latestOf(signal));

  // Order of importance: what the hub finds unusual, furthest first; with nothing unusual, the heart rate.
  const unusual = evidence.state === 'ready' ? [...evidence.value.unusual.signals].sort((a, b) => Math.abs(b.z) - Math.abs(a.z)) : [];
  const isUnusual = (signal: string) => unusual.some((u) => u.signal === signal);
  // Readings only (READINGS), with a number or a yes/no: typed words are never a tile.
  const all = [...new Set([...mine.map((r) => r.signal), ...summary.signals.map((b) => b.signal)])]
    .filter((k) => readingRank(k) >= 0 && latestOf(k)?.value != null)
    .sort((a, b) => readingRank(a) - readingRank(b) || a.localeCompare(b));
  const fallback = has('heart_rate') ? 'heart_rate' : all[0] ?? null;
  const hero = picked && all.includes(picked) ? picked : unusual.find((u) => all.includes(u.signal))?.signal ?? fallback;
  const vitals = VITALS.filter((k) => k !== hero && has(k)).slice(0, 4);
  const rest = all.filter((k) => k !== hero && !vitals.includes(k));

  const roomName = (id: string) => s(rooms.find((r) => r.id === id)?.name ?? id);
  const personName = (id: string) => crew.find((p) => p.id === id)?.name ?? id;
  const locale = lang === 'pt' ? 'pt-BR' : 'en-GB';
  const time = (t: number) => new Date(t).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const date = (t: number) => new Date(t).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const whose = own ? 'you' : 'them';

  const direction = (signal: string) => {
    const found = unusual.find((u) => u.signal === signal);
    const judged = baseline.get(signal);
    return found?.direction ?? (judged?.status === 'judged' && judged.unusual ? judged.direction : null);
  };
  const headline = (signal: string) => {
    const vars = { signal: s(`signal.${signal}`), name: person.name };
    const way = direction(signal);
    if (way === 'high') return s(`person.high.${whose}`, vars);
    if (way === 'low') return s(`person.low.${whose}`, vars);
    if (baseline.get(signal)?.status === 'judged') return s(`person.within.${whose}`, vars);
    return s('person.noHistory', vars);
  };
  // The line under the name: an alert first (what is happening to them), then their own readings.
  const alertRoom = alert?.room ? roomName(alert.room) : '';
  const verdict = alert
    ? alert.reason === 'room-limit' ? s('person.verdict.roomLimit', { room: alertRoom, signal: s(`signal.${alert.signal}`) }) : headline(alert.signal)
    : unusual.length ? headline(unusual[0].signal) : s(`person.allUsual.${whose}`, { name: person.name });
  const verdictTone = alert ? (alert.level >= 3 ? 'over' : 'watch') : unusual.length ? 'watch' : 'ok';

  const series = (signal: string) => {
    const pts = rows.filter((r) => r.signal === signal && r.value !== null);
    const b = baseline.get(signal);
    const daily = b && b.status !== 'no-recent' ? b.mode === 'daily' : pts.filter((r) => r.t > now - DENSE_WINDOW).length < 4;
    const from = now - (daily ? DAILY_WINDOW : DENSE_WINDOW);
    const points: Point[] = pts.filter((r) => r.t >= from).map((r) => ({ t: r.t, v: r.value as number }));
    const band: [number, number] | null = b?.status === 'judged' && b.spread > 0 ? [(b as Judged).usual - 2 * b.spread, (b as Judged).usual + 2 * b.spread] : null;
    return { points, from, daily, band };
  };
  /** The last `n` days' values of a signal, oldest first. */
  const days = (signal: string, n = 7) => rows.filter((r) => r.signal === signal && r.value !== null && r.t > now - n * DAY).map((r) => r.value as number);
  const usualOf = (signal: string) => {
    const b = baseline.get(signal);
    return b?.status === 'judged' ? b.usual : null;
  };

  const heroRow = hero ? latestOf(hero) : undefined;
  const heroSeries = hero ? series(hero) : null;
  const co2Now = airRoom ? latest.find((r) => r.room === airRoom && !r.person && r.signal === 'co2' && r.value !== null) : undefined;
  const headacheLevel = CO2_LEVELS[0].level;
  const limit = CO2_LEVELS[1].level;
  const co2Tone = co2Now?.value == null ? undefined : co2Now.value > limit ? 'over' : co2Now.value >= headacheLevel ? 'watch' : 'ok';

  const ev = evidence.state === 'ready' ? evidence.value : null;
  const pointsTo = ev
    ? ev.pointsTo === 'room' && ev.focusRoom ? s('evidence.pointsTo.room', { room: roomName(ev.focusRoom) })
      : ev.pointsTo === 'person' ? s('evidence.pointsTo.person', { person: personName(ev.person) })
      : s(`evidence.pointsTo.${ev.pointsTo}`)
    : null;

  const kinds = [...new Set([heroRow, ...vitals.map(latestOf), ...rest.map(latestOf), co2Now].filter((r): r is Row => Boolean(r)).map((r) => r.kind))] as Kind[];
  const pick = (signal: string) => setPicked(signal);

  /** A module's header: grey glyph, short name in small caps, the kind mark, and a mark if unusual. */
  const head = (signal: string, row: Row | undefined) => (
    <span className="mod-head">
      <SignalIcon signal={signal} />
      <span>{s(`signal.${signal}.short`)}</span>
      {row && <KindMark kind={row.kind} s={s} />}
      {isUnusual(signal) && <span className="odd-mark" role="img" aria-label={s('person.unusual')} />}
    </span>
  );

  const vital = (signal: string) => {
    const row = latestOf(signal);
    if (!row) return null;
    const partner = PARTNER[signal] ? latestOf(PARTNER[signal]) : undefined;
    const label = [s(`signal.${signal}`), formatValue(row, s), partner ? `${s(`signal.${PARTNER[signal]}`)} ${formatValue(partner, s)}` : '', s(`kind.${row.kind}`), isUnusual(signal) ? s('person.unusual') : ''].filter(Boolean).join(', ');
    return (
      <button key={signal} type="button" className="mod vital" data-unusual={isUnusual(signal) ? '' : undefined} aria-label={label} onClick={() => pick(signal)}>
        {head(signal, row)}
        <span className="mod-body" aria-hidden="true">
          <span className="mod-value">
            {partner ? <>{Math.round(row.value as number)}<span className="slash">/</span>{Math.round(partner.value as number)}</> : bigValue(row)}
            <span className="unit">{unitOf(row)}</span>
          </span>
          <span className="mod-pic">
            {signal === 'exercise_minutes' && usualOf(signal) ? <Ring fraction={(row.value as number) / (usualOf(signal) as number)} />
              : signal === 'sleep_duration' || signal === 'sleep_efficiency' || signal === 'sleep_awakenings' || signal === 'exercise_minutes' || partner ? <DayBars values={days(signal)} />
              : <MiniTrace points={series(signal).points} />}
          </span>
        </span>
      </button>
    );
  };

  return (
    <section className="person frame" aria-labelledby="person-name">
      <header className="person-head">
        <h2 id="person-name">{person.name}</h2>
        <p className="person-verdict" data-tone={verdictTone}>{alert && <span className="person-level">{s(`level.${alert.level}`)}. </span>}{verdict}</p>
        <p className="person-meta">
          {s(person.role)}, {room ? s('person.in', { room: roomName(room) })
            : lastSeen ? <>{s('person.lastSeen', { room: roomName(lastSeen.room), time: timeOf(lastSeen.at, lang) })} <KindMark kind={lastSeen.kind} s={s} /></>
            : s('person.whereUnknown')}
        </p>
      </header>

      <BodyList lines={body} s={s} />

      {own && <FollowUp followUp={followUp} person={person.id} lang={lang} s={s} recorded={recorded} className="mod followup" />}

      {hero && heroSeries && (
        <article className="mod hero" aria-live="polite" data-unusual={isUnusual(hero) ? '' : undefined}>
          <p className="hero-top">
            {head(hero, heroRow)}
            {heroRow && <span className="hero-when">{time(heroRow.t)}</span>}
          </p>
          <p className="hero-line">
            <span className="mod-value">{heroRow ? bigValue(heroRow) : '–'}<span className="unit">{heroRow ? unitOf(heroRow) : ''}</span></span>
            {(isUnusual(hero) || picked === hero) && <span className="hero-words">{headline(hero)}</span>}
          </p>
          {history.state === 'ready' ? (
            <Chart points={heroSeries.points} from={heroSeries.from} to={now} unit="" band={heroSeries.band}
              flag={isUnusual(hero)} bandLabel={s('person.usualRange')} tick={heroSeries.daily ? date : time} dots={heroSeries.daily}
              label={`${s(`signal.${hero}`)}, ${s(heroSeries.daily ? 'person.last14d' : 'person.last12h')}`} />
          ) : <p className="chart chart-empty">{s(history.state === 'failed' ? 'person.noData' : 'person.loading')}</p>}
        </article>
      )}

      {vitals.length > 0 && <div className="vitals">{vitals.map(vital)}</div>}

      {airRoom && co2Now && co2Now.value !== null && (
        <article className="mod air" aria-label={`${roomName(airRoom)}, ${s('signal.co2')}, ${formatValue(co2Now, s)}, ${s(`co2.zone.${co2Tone}`)}, ${s(`kind.${co2Now.kind}`)}`}>
          <span className="mod-head" aria-hidden="true"><SignalIcon signal="co2" /><span>{s('person.airIn', { room: roomName(airRoom) })}</span><KindMark kind={co2Now.kind} s={s} /></span>
          <span className="air-body" aria-hidden="true">
            <span className="mod-value">{Number(co2Now.value.toFixed(1))}<span className="unit">{co2Now.unit}</span></span>
            <Gauge value={co2Now.value} min={1.5} max={4.5}
              zones={[{ from: 1.5, to: headacheLevel, tone: 'ok' }, { from: headacheLevel, to: limit, tone: 'watch' }, { from: limit, to: 4.5, tone: 'over' }]}
              marks={[{ at: headacheLevel, label: String(headacheLevel) }, { at: limit, label: String(limit) }]} />
          </span>
        </article>
      )}

      <Dose dose={dose} s={s} lang={lang} />

      {rest.length > 0 && (
        <nav className="mods-strip person-strip" aria-label={s('person.tracking')}>
          {rest.slice(0, 5).map((signal) => {
            const row = latestOf(signal);
            // Past its freshness (engine/baseline.ts): shown as old, never as current.
            const old = row && !isCurrentReading(signal, row.t, now) ? ago(now - row.t, s) : '';
            return (
              <button key={signal} type="button" className="mod-mini" data-unusual={isUnusual(signal) ? '' : undefined} data-stale={old ? '' : undefined} onClick={() => pick(signal)}
                aria-label={[s(`signal.${signal}`), row ? formatValue(row, s) : '', old, row ? s(`kind.${row.kind}`) : '', isUnusual(signal) ? s('person.unusual') : ''].filter(Boolean).join(', ')}>
                <span className="mod-mini-head" aria-hidden="true"><SignalIcon signal={signal} />{row && <KindMark kind={row.kind} s={s} />}</span>
                <span className="mod-mini-value" aria-hidden="true">{row ? formatValue(row, s, true) : '–'}{old && <span className="mod-mini-ago">{old}</span>}</span>
                {row?.unit === '0-100' ? <Scale value={row.value as number} /> : <span className="scale scale-empty" />}
                <span className="mod-mini-name" aria-hidden="true">{s(`signal.${signal}.short`)}</span>
              </button>
            );
          })}
        </nav>
      )}

      {pointsTo && <p className="person-points"><span>{pointsTo}.</span> {s('evidence.notDiagnosis')}</p>}
      <KindKey kinds={kinds} s={s} />
    </section>
  );
}

/**
 * Their radiation dose: worked out from room rates and stays, never measured.
 * Today, this mission and projected at mission end, each in its own unit; NASA's
 * career limit only beside a dose made wholly of dose equivalent. No colour, no bar.
 */
function Dose({ dose, s, lang }: { dose: PersonDose | null; s: S; lang: Lang }) {
  const locale = lang === 'pt' ? 'pt-BR' : 'en-GB';
  const num = (v: number) => v.toLocaleString(locale, v !== 0 && Math.abs(v) < 1 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 1 });
  const percent = (share: number) => num(share * 100);
  const hours = (ms: number) => Math.round(ms / HOUR);
  const gaps = (c: DoseCoverage) => [
    c.unplacedMs >= HOUR ? s('dose.unplaced', { hours: hours(c.unplacedMs) }) : '',
    c.noRateMs >= HOUR ? s('dose.noRate', { hours: hours(c.noRateMs) }) : '',
  ].filter(Boolean);
  const value = (v: number, unit: string, share?: number | null) => (
    <>
      <span className="mod-value">{num(v)}<span className="unit">{unit}</span></span>
      {share != null && <span className="dose-share">{s('dose.ofLimit', { percent: percent(share) })}</span>}
    </>
  );
  const many = (dose?.amounts.length ?? 0) > 1;
  const todayGaps = dose ? gaps(dose.today) : [];
  const missionGaps = dose ? gaps(dose.mission) : [];
  return (
    <article className="mod dose" aria-labelledby="dose-title">
      <h3 className="mod-head" id="dose-title">
        <SignalIcon signal="radiation" />
        <span>{s('dose.title')}</span>
        {dose && <span className="dose-kind"><KindMark kind={dose.kind} s={s} /><span aria-hidden="true">{s(`dose.${dose.kind}`)}</span></span>}
      </h3>
      {!dose || !dose.amounts.length ? <p className="dose-note">{s('dose.none')}</p> : (
        <>
          {dose.amounts.map((a) => (
            <section key={a.quantity} className="dose-amount" aria-label={many ? s(`dose.${a.quantity}`) : undefined}>
              {many && <p className="dose-quantity" aria-hidden="true">{s(`dose.${a.quantity}`)}</p>}
              <dl className="dose-grid">
                <div><dt>{s('dose.today')}</dt><dd>{value(a.today, a.unit)}</dd></div>
                <div><dt>{s('dose.mission')}</dt><dd>{value(a.mission, a.unit, dose.comparable ? dose.ofLimit?.mission : null)}</dd></div>
                {a.projected !== null && <div><dt>{s('dose.projected')}</dt><dd>{value(a.projected, a.unit, dose.comparable ? dose.ofLimit?.projected : null)}</dd></div>}
              </dl>
              <p className="dose-note">{s('dose.rate', { value: num(a.ratePerDay), unit: a.unit })}</p>
            </section>
          ))}
          {todayGaps.length > 0 && <p className="dose-note">{s('dose.today')}: {todayGaps.join(', ')}</p>}
          {missionGaps.length > 0 && <p className="dose-note">{s('dose.mission')}: {missionGaps.join(', ')}</p>}
          {dose.comparable && dose.limit
            ? <p className="dose-note">{s('dose.limit', { value: num(dose.limit.value), unit: dose.limit.unit })}. {s('dose.careerOnly')}</p>
            : dose.reason && <p className="dose-note">{s(`dose.notComparable.${dose.reason}`)}</p>}
          <p className="dose-note">{s('dose.howKnown')}</p>
        </>
      )}
    </article>
  );
}

/** The exercise ring: filled to today's minutes against this person's own usual (no goal is invented). */
function Ring({ fraction }: { fraction: number | null }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const f = fraction === null ? 0 : Math.max(0, Math.min(1, fraction));
  return (
    <svg className="ring" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx={28} cy={28} r={r} className="ring-track" />
      {fraction !== null && <circle cx={28} cy={28} r={r} className="ring-fill" strokeDasharray={`${f * c} ${c}`} transform="rotate(-90 28 28)" />}
    </svg>
  );
}

/** A week of daily values as bars, the latest brightest. */
function DayBars({ values }: { values: number[] }) {
  if (!values.length) return null;
  const hi = Math.max(...values);
  const lo = Math.min(...values) * 0.6;
  return (
    <span className="daybars" aria-hidden="true">
      {values.map((v, i) => <span key={i} style={{ height: `${15 + ((v - lo) / (hi - lo || 1)) * 85}%` }} data-last={i === values.length - 1 ? '' : undefined} />)}
    </span>
  );
}

/** A small trace with no axes. */
function MiniTrace({ points }: { points: Point[] }) {
  if (points.length < 2) return null;
  const step = Math.max(1, Math.floor(points.length / 40));
  const pts = points.filter((_, i) => i % step === 0);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / (t1 - t0 || 1)) * 100).toFixed(1)},${(36 - ((p.v - lo) / (hi - lo || 1)) * 32).toFixed(1)}`).join('');
  return <svg className="minitrace" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d={d} vectorEffect="non-scaling-stroke" /></svg>;
}

/** A 0 to 100 answer on its own scale. */
function Scale({ value }: { value: number }) {
  return <span className="scale" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span>;
}

/** How long ago, as "14 h ago". */
function ago(ms: number, s: S): string {
  const hours = Math.round(ms / 3600_000);
  return hours >= 48 ? s('reading.agoDays', { days: Math.round(hours / 24) }) : s('reading.agoHours', { hours: Math.max(1, hours) });
}

function bigValue(row: Row): string {
  if (row.value === null) return row.text ?? '';
  if (row.unit === 'min' && row.value >= 90) return `${Math.floor(row.value / 60)}:${String(Math.round(row.value % 60)).padStart(2, '0')}`;
  return String(Number(row.value.toFixed(row.value < 10 ? 1 : 0)));
}

function unitOf(row: Row): string {
  if (row.unit === 'min') return row.value !== null && row.value >= 90 ? 'h' : 'min';
  if (row.unit === '0-100' || row.unit === 'count' || row.unit === 'yes/no') return '';
  return row.unit;
}

/** A reading as people say it: hours for long durations, yes or no for yes/no questions. */
export function formatValue(row: Row, s: S, short = false): string {
  if (row.value === null) return row.text ?? '';
  const v = row.value;
  if (short && row.unit !== 'yes/no' && row.unit !== 'min' && row.unit !== '%') return String(Number(v.toFixed(v < 10 ? 1 : 0)));
  if (row.unit === 'yes/no') return s(v ? 'person.yes' : 'person.no');
  if (row.unit === 'min' && v >= 90) return `${Math.floor(v / 60)} h ${String(Math.round(v % 60)).padStart(2, '0')}`;
  if (row.unit === '%') return `${Math.round(v)}%`;
  if (row.unit === 'count' || row.unit === '0-100' || row.unit === 'index' || row.unit === 'raw') return String(Math.round(v));
  return `${Number(v.toFixed(v < 10 ? 2 : 0))} ${row.unit}`;
}
