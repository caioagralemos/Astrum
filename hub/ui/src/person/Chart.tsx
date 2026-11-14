// A small history chart for the person view: one line over time, with the
// person's usual range as a band behind it and, for room air, NASA's levels as
// dashed lines. Where the line leaves the band it is drawn in the alert colour,
// and the band is always named in words, so nothing rests on colour alone.
//
// Drawn in plain SVG at the size it is given (a ResizeObserver measures it),
// so strokes and type stay crisp at any size. Colours come from app.css.

import { useLayoutEffect, useRef, useState } from 'react';

export interface Point { t: number; v: number }

export interface ChartProps {
  points: Point[];
  from: number;
  to: number;
  unit: string;
  /** The person's usual range, drawn as a band. */
  band?: [number, number] | null;
  /** Highlight the line where it leaves the band (only when the signal is flagged unusual). */
  flag?: boolean;
  bandLabel?: string;
  /** Reference levels (NASA's), drawn dashed with their label. */
  levels?: { value: number; label: string }[];
  /** How to write a time on the axis. */
  tick: (t: number) => string;
  /** Whether each reading is a point of its own (daily values) rather than a dense trace. */
  dots?: boolean;
  /** The chart's description for screen readers. */
  label: string;
}

const PAD = { top: 18, right: 10, bottom: 20, left: 34 };

export function Chart({ points, from, to, unit, band, flag, bandLabel, levels = [], tick, dots, label }: ChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  const { w, h } = size;
  const values = [...points.map((p) => p.v), ...(band ?? []), ...levels.map((l) => l.value)];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const room = (hi - lo) * 0.12;
  lo -= room;
  hi += room;
  const x = (t: number) => PAD.left + ((t - from) / Math.max(1, to - from)) * (w - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (h - PAD.top - PAD.bottom);
  const outside = (v: number) => Boolean(flag) && band != null && (v < band[0] || v > band[1]);

  // A dense trace is averaged to about one point every 3 px, so it reads as a line, not a smear.
  const step = ((to - from) / Math.max(1, w - PAD.left - PAD.right)) * 3;
  const shown: Point[] = [];
  if (dots) shown.push(...points);
  else {
    let bucket = -1;
    let sum = 0;
    let n = 0;
    let at = 0;
    for (const p of points) {
      const b = Math.floor((p.t - from) / step);
      if (b !== bucket && n) { shown.push({ t: at / n, v: sum / n }); sum = 0; n = 0; at = 0; }
      bucket = b;
      sum += p.v;
      at += p.t;
      n++;
    }
    if (n) shown.push({ t: at / n, v: sum / n });
  }

  // The line, split into runs inside and outside the band so the outside ones can be highlighted.
  const runs: { out: boolean; d: string }[] = [];
  shown.forEach((p, i) => {
    const out = outside(p.v);
    const at = `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
    const last = runs[runs.length - 1];
    if (!last || last.out !== out) {
      const prev = shown[i - 1];
      runs.push({ out, d: prev ? `M${x(prev.t).toFixed(1)},${y(prev.v).toFixed(1)}L${at}` : `M${at}` });
    } else last.d += `L${at}`;
  });

  const ticks = [from, (from + to) / 2, to];
  const yTicks = [lo + room, (lo + hi) / 2, hi - room];
  const fmt = (v: number) => (Math.abs(hi - lo) < 10 ? v.toFixed(1) : String(Math.round(v)));

  return (
    <div className="chart" ref={box}>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} role="img" aria-label={label}>
          <text className="chart-unit" x={PAD.left - 6} y={10} textAnchor="end">{unit}</text>
          {yTicks.map((v) => (
            <g key={v}>
              <line className="chart-grid" x1={PAD.left} x2={w - PAD.right} y1={y(v)} y2={y(v)} />
              <text className="chart-tick" x={PAD.left - 6} y={y(v) + 4} textAnchor="end">{fmt(v)}</text>
            </g>
          ))}
          {band && (
            <g>
              <rect className="chart-band" x={PAD.left} width={w - PAD.left - PAD.right} y={y(band[1])} height={Math.max(1, y(band[0]) - y(band[1]))} rx={4} />
              {bandLabel && <text className="chart-band-label" x={w - PAD.right - 6} y={y(band[0]) - 6} textAnchor="end">{bandLabel}</text>}
            </g>
          )}
          {levels.map((l) => (
            <g key={l.value}>
              <line className="chart-level" x1={PAD.left} x2={w - PAD.right} y1={y(l.value)} y2={y(l.value)} />
              <text className="chart-level-label" x={PAD.left + 4} y={y(l.value) - 4}>{l.label}</text>
            </g>
          ))}
          {runs.map((run, i) => <path key={i} className={run.out ? 'chart-line chart-line-out' : 'chart-line'} d={run.d} />)}
          {dots && points.map((p) => <circle key={p.t} className={outside(p.v) ? 'chart-dot chart-line-out' : 'chart-dot'} cx={x(p.t)} cy={y(p.v)} r={3} />)}
          {points.length > 0 && (() => {
            const p = points[points.length - 1];
            return <circle className={outside(p.v) ? 'chart-now chart-line-out' : 'chart-now'} cx={x(p.t)} cy={y(p.v)} r={3.5} />;
          })()}
          {ticks.map((t, i) => (
            <text key={t} className="chart-tick" x={x(t)} y={h - 4} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{tick(t)}</text>
          ))}
        </svg>
      )}
    </div>
  );
}
