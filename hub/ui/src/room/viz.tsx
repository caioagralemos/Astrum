// Small pictures of a reading, so a glance says what a number would make you
// work out. They are one family of line instruments at the same weights: the
// scale (base, ticks) in the projection's white, the data in its reading's tint
// (--tint, set per signal in app.css): the value shown by position (a needle, a
// dot), the day's range or the level as a heavier stretch. NASA's zones keep
// their status colours, and the words beside them say the same.
//   Gauge    / ArcGauge  where a value sits against NASA's levels (only for a
//            signal that has a verified NASA limit): each zone its own stretch
//            in its status colour, a tick at each level, a dot at now;
//   Scale    a needle on a straight scale, the last 24 hours (or, on a scale of
//            its own, the level from its start) as the heavier stretch;
//   Spark    the trace of the last hours over the same base, the area under it
//            softly filled, a dot at now;
//   DayRange the last 24 hours' low and high as a capsule, a dot where it is now.
// Each one is described in words for screen readers by its caller.

export interface Zone { from: number; to: number; tone: 'ok' | 'watch' | 'over' }

/** The zone a value falls in: what decides whether its dot is drawn in a status colour. */
function toneOf(value: number, zones: Zone[]): Zone['tone'] {
  const inside = zones.find((z) => value >= z.from && value < z.to);
  return inside ? inside.tone : value < zones[0].from ? zones[0].tone : zones[zones.length - 1].tone;
}

/** A straight scale against NASA's levels: each zone its stretch in its status colour, a tick at each level, a dot at the value. */
export function Gauge({ value, min, max, zones, marks }: { value: number; min: number; max: number; zones: Zone[]; marks: { at: number; label: string }[] }) {
  const at = (v: number) => (Math.min(max, Math.max(min, v)) - min) / (max - min) * 100;
  const pos = (v: number) => `${at(v)}%`;
  const tone = toneOf(value, zones);
  return (
    <div className="gauge" aria-hidden="true">
      <div className="gauge-track">
        <span className="inst-base" />
        {zones.map((z, i) => {
          // A hair of space between zones, so each reads as its own stretch.
          const from = at(z.from) + (i ? 0.8 : 0);
          const to = at(z.to) - (i < zones.length - 1 ? 0.8 : 0);
          return <span key={z.from} className="inst-band" data-tone={z.tone} style={{ left: `${from}%`, width: `${Math.max(0, to - from)}%` }} />;
        })}
        {marks.map((m) => <span key={m.at} className="inst-tick" data-major="" style={{ left: pos(m.at) }} />)}
        <span className="gauge-dot" data-tone={tone === 'ok' ? undefined : tone} style={{ left: pos(value) }} />
      </div>
      <div className="gauge-marks">
        {/* Two levels sit close together: the first is set to the left of its point, the rest to the right. */}
        {marks.map((m, i) => <span key={m.at} data-side={i === 0 ? 'before' : 'after'} style={{ left: pos(m.at) }}>{m.label}</span>)}
      </div>
    </div>
  );
}

/** The last 24 hours as a capsule from low to high, inside the room's own scale, with a dot at now. */
export function DayRange({ low, high, now }: { low: number; high: number; now: number }) {
  const span = high - low || 1;
  // A little room either side so the capsule never touches the ends.
  const lo = low - span * 0.15;
  const hi = high + span * 0.15;
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="dayrange" aria-hidden="true">
      <span className="dayrange-fill" style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})` }} />
      <span className="dayrange-dot" style={{ left: pos(now) }} />
    </div>
  );
}

/**
 * The trace of the last hours over the instruments' shared base, a dot at the
 * newest reading. Scaled to its own low and high: it shows the shape, not a
 * level. With fewer than two readings only the base is drawn.
 */
export function Spark({ points: raw }: { points: { t: number; v: number }[] }) {
  const points = smooth(raw, 48);
  if (points.length < 2) return <div className="inst" aria-hidden="true"><span className="inst-base" /></div>;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  // In a 100 by 40 box: the trace keeps clear of the base below it and of the top.
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * 100;
  const y = (v: number) => 33 - ((v - lo) / (hi - lo)) * 29;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`).join('');
  const last = points[points.length - 1];
  return (
    <div className="inst" aria-hidden="true">
      <span className="inst-base" />
      <svg className="spark" viewBox="0 0 100 40" preserveAspectRatio="none">
        <path d={`${d}L${x(last.t).toFixed(2)},40L${x(points[0].t).toFixed(2)},40Z`} className="spark-area" />
        <path d={d} className="spark-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="inst-dot" style={{ left: `${x(last.t)}%`, top: `${(y(last.v) / 40) * 100}%` }} />
    </div>
  );
}

/**
 * A needle on a straight scale, over the instruments' shared base. With a
 * `scale` of its own (humidity's 0 to 100) the scale is ticked every tenth;
 * without one the scale is the reading's last 24 hours, widened a little, and
 * marks only the day's low and high. On its own scale the heavier stretch is the
 * level, from the scale's start to now; on the day's scale it is the day's low
 * to high. No history: the needle sits on its own scale if it has one,
 * otherwise only the base is drawn.
 */
export function Scale({ now, range, scale }: { now: number; range: { low: number; high: number } | null; scale?: [number, number] }) {
  let lo: number;
  let hi: number;
  if (scale) [lo, hi] = scale;
  else if (range) {
    const span = Math.max(range.high - range.low, Math.abs(now) * 0.002, 1e-6);
    lo = Math.min(range.low, now) - span * 0.3;
    hi = Math.max(range.high, now) + span * 0.3;
  } else return <div className="inst" aria-hidden="true"><span className="inst-base" /></div>;
  const at = (v: number) => (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * 100;
  // Its own scale is ticked every tenth; the day's scale only marks the day's low and high.
  const ticks = scale ? Array.from({ length: 11 }, (_, i) => scale[0] + (i / 10) * (scale[1] - scale[0])) : range ? [range.low, range.high] : [];
  return (
    <div className="inst" aria-hidden="true">
      <span className="inst-base" />
      {ticks.map((t, i) => <span key={i} className="inst-tick" data-major={!scale || i % 5 === 0 ? '' : undefined} style={{ left: `${at(t)}%` }} />)}
      {scale ? <span className="inst-band" data-level="" style={{ left: 0, width: `${at(now)}%` }} />
        : range && <span className="inst-band" style={{ left: `${at(range.low)}%`, width: `${Math.max(0.8, at(range.high) - at(range.low))}%` }} />}
      <span className="inst-needle" style={{ left: `${at(now)}%` }} />
    </div>
  );
}

/** Rising, falling or steady: the last hour's average against the hour before, measured against the day's spread. */
export function trend(points: { t: number; v: number }[], now: number): 'rising' | 'falling' | 'steady' | null {
  const HOUR = 3600_000;
  const avg = (from: number, to: number) => {
    const inside = points.filter((p) => p.t >= from && p.t < to);
    return inside.length ? inside.reduce((sum, p) => sum + p.v, 0) / inside.length : null;
  };
  const last = avg(now - HOUR, now + 1);
  const before = avg(now - 2 * HOUR, now - HOUR);
  if (last === null || before === null) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
  const spread = hi - lo;
  if (spread < 1e-9 || Math.abs(last - before) < spread * 0.15) return 'steady';
  return last > before ? 'rising' : 'falling';
}

/** Averages a trace into at most `count` even steps, so jitter reads as a line. */
function smooth(points: { t: number; v: number }[], count: number): { t: number; v: number }[] {
  if (points.length <= count) return points;
  const t0 = points[0].t;
  const step = (points[points.length - 1].t - t0) / count || 1;
  const out: { t: number; v: number }[] = [];
  let bucket = -1;
  let sum = 0;
  let at = 0;
  let n = 0;
  for (const p of points) {
    const b = Math.min(count - 1, Math.floor((p.t - t0) / step));
    if (b !== bucket && n) { out.push({ t: at / n, v: sum / n }); sum = 0; at = 0; n = 0; }
    bucket = b;
    sum += p.v;
    at += p.t;
    n++;
  }
  if (n) out.push({ t: at / n, v: sum / n });
  return out;
}

/**
 * Twelve stems over the reading's recent history, the newest brightest, on the
 * instruments' shared base. Each stem is an hour, or less when the history is
 * shorter, so a new sensor still draws a full row; an hour with no reading draws
 * no stem.
 */
export function Bars({ points, now, count = 12 }: { points: { t: number; v: number }[]; now: number; count?: number }) {
  const HOUR = 3600_000;
  const first = points.length ? points[0].t : now;
  const width = Math.max(5 * 60_000, Math.min(HOUR, (now - first) / count));
  const buckets: (number | null)[] = Array.from({ length: count }, (_, i) => {
    const from = now - (count - i) * width;
    const inside = points.filter((p) => p.t >= from && p.t < from + width);
    return inside.length ? inside.reduce((sum, p) => sum + p.v, 0) / inside.length : null;
  });
  const known = buckets.filter((b): b is number => b !== null);
  if (!known.length) return <div className="bars bars-empty" aria-hidden="true"><span className="inst-base" /></div>;
  let lo = Math.min(...known);
  const hi = Math.max(...known);
  lo -= (hi - lo || 1) * 0.6;
  return (
    <div className="bars" aria-hidden="true">
      <span className="inst-base" />
      {buckets.map((b, i) => (
        <span key={i} className="bar" style={{ height: b === null ? '0%' : `${12 + ((b - lo) / (hi - lo || 1)) * 88}%` }} data-last={i === count - 1 ? '' : undefined} />
      ))}
    </div>
  );
}

/**
 * NASA's levels round an arc: a hairline from end to end, each zone its own
 * heavier stretch in its status colour, a tick across it at each level with the
 * level marked outside, and a dot at now, coloured once now passes a level.
 */
export function ArcGauge({ value, min, max, zones, marks }: { value: number; min: number; max: number; zones: Zone[]; marks: { at: number; label: string }[] }) {
  const R = 46;
  const C = { x: 60, y: 58 };
  const angle = (v: number) => Math.PI * (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min));
  const at = (a: number, r = R) => [C.x + Math.cos(a) * r, C.y - Math.sin(a) * r];
  const arc = (from: number, to: number) => {
    const [x1, y1] = at(angle(from));
    const [x2, y2] = at(angle(to));
    return `M${x1.toFixed(2)},${y1.toFixed(2)}A${R},${R} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
  };
  const gap = (max - min) * 0.012;
  const [dx, dy] = at(angle(value));
  const tone = toneOf(value, zones);
  return (
    <svg className="arcgauge" viewBox="0 0 120 66" aria-hidden="true">
      <path d={arc(min, max)} className="arc-base" vectorEffect="non-scaling-stroke" />
      {zones.map((z, i) => (
        <path key={z.from} d={arc(z.from + (i ? gap : 0), z.to - (i < zones.length - 1 ? gap : 0))} className="arc-band" data-tone={z.tone} vectorEffect="non-scaling-stroke" />
      ))}
      {marks.map((m) => {
        const [x1, y1] = at(angle(m.at), R - 4);
        const [x2, y2] = at(angle(m.at), R + 4);
        const [x, y] = at(angle(m.at), R + 11);
        return (
          <g key={m.at}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className="arc-tick" vectorEffect="non-scaling-stroke" />
            <text x={x} y={y} className="arc-mark" textAnchor="middle">{m.label}</text>
          </g>
        );
      })}
      <circle cx={dx} cy={dy} r={4} className="arc-dot" data-tone={tone === 'ok' ? undefined : tone} />
    </svg>
  );
}
