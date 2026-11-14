// Small pictures of a reading, so a glance says what a number would make you
// work out:
//   Gauge    where a value sits against NASA's levels (only for a signal that
//            has a verified NASA limit), the zones drawn in the status colours;
//   DayRange the Weather-app bar: the last 24 hours' low and high as a capsule,
//            a dot where it is now;
//   Spark    the trace of the last hours, no axes.
// Each one is described in words for screen readers by its caller.

export interface Zone { from: number; to: number; tone: 'ok' | 'watch' | 'over' }

/** A capsule split into NASA's zones, with a dot at the value and the levels marked under it. */
export function Gauge({ value, min, max, zones, marks }: { value: number; min: number; max: number; zones: Zone[]; marks: { at: number; label: string }[] }) {
  const pos = (v: number) => `${(Math.min(max, Math.max(min, v)) - min) / (max - min) * 100}%`;
  return (
    <div className="gauge" aria-hidden="true">
      {/* One continuous spectrum, each zone's colour blending into the next at NASA's level, as Apple's air-quality bar does. */}
      <div className="gauge-track" style={{ background: `linear-gradient(90deg, ${zones.map((z, i) => {
        const c = `var(--soft-${z.tone})`;
        const a = i === 0 ? '0%' : `calc(${pos(z.from)} + 2%)`;
        const b = i === zones.length - 1 ? '100%' : `calc(${pos(z.to)} - 2%)`;
        return `${c} ${a}, ${c} ${b}`;
      }).join(', ')})` }}>
        <span className="gauge-dot" style={{ left: pos(value) }} />
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

/** A bare trace, drawn to fit its box. */
export function Spark({ points: raw, tone }: { points: { t: number; v: number }[]; tone?: 'ok' | 'watch' | 'over' }) {
  const points = smooth(raw, 48);
  if (points.length < 2) return null;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / (t1 - t0 || 1)) * 100).toFixed(2)},${(36 - ((p.v - lo) / (hi - lo)) * 32).toFixed(2)}`).join('');
  return (
    <svg className="spark" data-tone={tone} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d}L100,40L0,40Z`} className="spark-fill" />
      <path d={d} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
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

/**
 * A dial, the way a barometer reads: ticks round three quarters of a circle,
 * the day's low-to-high span drawn heavier, a needle at now. The scale is the
 * reading's own last 24 hours (widened a little), not a judgement.
 */
export function Dial({ low, high, now }: { low: number; high: number; now: number }) {
  const span = Math.max(high - low, Math.abs(now) * 0.002, 1e-6);
  const lo = low - span * 1.5;
  const hi = high + span * 1.5;
  const angle = (v: number) => (-135 + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 270) * (Math.PI / 180);
  const at = (a: number, r: number) => [50 + Math.sin(a) * r, 50 - Math.cos(a) * r];
  const ticks = Array.from({ length: 41 }, (_, i) => -135 + i * (270 / 40));
  const inDay = (deg: number) => {
    const rad = deg * (Math.PI / 180);
    return rad >= angle(low) - 1e-6 && rad <= angle(high) + 1e-6;
  };
  const [nx, ny] = at(angle(now), 30);
  return (
    <svg className="dial" viewBox="0 0 100 100" aria-hidden="true">
      {ticks.map((deg) => {
        const rad = deg * (Math.PI / 180);
        const [x1, y1] = at(rad, 46);
        const [x2, y2] = at(rad, inDay(deg) ? 37 : 41);
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} className={inDay(deg) ? 'dial-tick dial-day' : 'dial-tick'} />;
      })}
      <line x1={50} y1={50} x2={nx} y2={ny} className="dial-needle" />
      <circle cx={50} cy={50} r={3} className="dial-hub" />
    </svg>
  );
}

/** A thermometer: its fill rises to where now sits in the last 24 hours, low and high marked. */
export function Thermo({ low, high, now }: { low: number; high: number; now: number }) {
  const span = high - low || 1;
  const lo = low - span * 0.4;
  const hi = high + span * 0.4;
  const y = (v: number) => 58 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 50;
  return (
    <svg className="thermo" viewBox="0 0 24 80" aria-hidden="true">
      <path className="thermo-glass" d="M8 8a4 4 0 0 1 8 0v54a7 7 0 1 1-8 0z" />
      <rect className="thermo-day" x={10.5} y={y(high)} width={3} height={Math.max(1, y(low) - y(high))} rx={1.5} />
      <defs>
        <linearGradient id="thermo-g" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" className="thermo-cool" />
          <stop offset="1" className="thermo-warm" />
        </linearGradient>
      </defs>
      <path d={`M10 ${y(now)}h4V66a2 2 0 0 1-4 0z`} fill="url(#thermo-g)" />
      <circle className="thermo-bulb" cx={12} cy={68} r={4.5} />
    </svg>
  );
}

/** A drop, filled to the reading's percent (humidity's own 0 to 100 scale). */
export function Drop({ percent, id }: { percent: number; id: string }) {
  const level = 90 - (Math.min(100, Math.max(0, percent)) / 100) * 80;
  const shape = 'M30 6C30 6 8 32 8 52a22 22 0 0 0 44 0C52 32 30 6 30 6z';
  return (
    <svg className="drop" viewBox="0 0 60 80" aria-hidden="true">
      <defs><clipPath id={id}><path d={shape} /></clipPath></defs>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="drop-top" />
          <stop offset="1" className="drop-bottom" />
        </linearGradient>
      </defs>
      <rect x={0} y={level} width={60} height={80} clipPath={`url(#${id})`} fill={`url(#${id}-g)`} />
      <path className="drop-glass" d={shape} />
    </svg>
  );
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
 * Twelve bars over the reading's recent history, the newest brightest. Each
 * bar is an hour, or less when the history is shorter, so a new sensor still
 * draws a full row.
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
  if (!known.length) return <div className="bars bars-empty" aria-hidden="true" />;
  let lo = Math.min(...known);
  const hi = Math.max(...known);
  lo -= (hi - lo || 1) * 0.6;
  return (
    <div className="bars" aria-hidden="true">
      {buckets.map((b, i) => (
        <span key={i} style={{ height: b === null ? '0%' : `${12 + ((b - lo) / (hi - lo || 1)) * 88}%` }} data-last={i === count - 1 ? '' : undefined} />
      ))}
    </div>
  );
}

/**
 * NASA's zones round an arc, the way Apple draws a gauge in a widget: each zone
 * its own stretch of the arc, a dot at now, the levels marked outside it.
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
  return (
    <svg className="arcgauge" viewBox="0 0 120 66" aria-hidden="true">
      {zones.map((z, i) => (
        <path key={z.from} d={arc(z.from + (i ? gap : 0), z.to - (i < zones.length - 1 ? gap : 0))} className="arc-zone" data-tone={z.tone} />
      ))}
      {marks.map((m) => {
        const [x, y] = at(angle(m.at), R + 10);
        return <text key={m.at} x={x} y={y} className="arc-mark" textAnchor="middle">{m.label}</text>;
      })}
      <circle cx={dx} cy={dy} r={5.5} className="arc-dot" />
    </svg>
  );
}
