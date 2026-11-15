// The orbit light: the ring of the mark (public/brand/mark.svg) with the
// light that runs round it. The loading screen draws it under the cross.
// Astra's mark is three of that same ring, crossed, with one light running
// through all three. Decorative: the words beside it say what is happening.

import { useId, useMemo } from 'react';
import type { CSSProperties } from 'react';
import './orbit.css';

// The ring is drawn in its own frame (moved to the centre, turned to its tilt), where it is an ellipse band.
const OUTER = [53.56, 10.01] as const;
const INNER = [36.44, 6.76] as const;
export const RING_FRAME = 'translate(43.33 33.8) rotate(142.38)';
export const BOX = [88, 68] as const;

/** The band, grown by `grow` on each edge so it still reads at small sizes; at 0 it is the logo's exact path. */
function ring(grow: number) {
  const n = (v: number) => +v.toFixed(2);
  const ellipse = (a: number, b: number) => `M${n(-a)} 0a${n(a)} ${n(b)} 0 1 0 ${n(2 * a)} 0a${n(a)} ${n(b)} 0 1 0 ${n(-2 * a)} 0Z`;
  return ellipse(OUTER[0] + grow, OUTER[1] + grow) + ellipse(INNER[0] - grow, INNER[1] - grow);
}

// Squashed back to a circle, the band is a ring 45 out and 17 wide: the light
// runs round that circle at an even pace, which reads as an orbit seen at a tilt.
const FLATTEN_Y = 0.1869;
const FLATTEN = `scale(1 ${FLATTEN_Y})`;
const ORBIT = 'M45 0A45 45 0 1 1 -45 0A45 45 0 1 1 45 0';
const LIGHT_WIDTH = 18;

type Spans = [number, number, number][];
// The light, as spans of the orbit (out of 100) around its head at 50:
// a long faint tail behind, a bright core, a short soft edge ahead.
const LIGHT: Spans = [
  [-40, 0, 0.08], [-30, 0, 0.1], [-22, 0, 0.13], [-15, 0, 0.17], [-9, 0, 0.24], [-4.5, 0.5, 0.4],
  [-2, 1, 0.8], [0, 2, 0.35], [0, 3.2, 0.15],
];
// At rest: the core alone, a short bright segment.
const CORE: Spans = LIGHT.slice(5);
// A blurred copy of the head, so it glows a little past the edges of the band.
const GLOW: Spans = [[-10, 0, 0.35], [-4, 1.5, 0.7]];
const HEAD = 50;

export const LAP = 1800; // ms for one lap of the light

/** How much to grow the band so its narrowest part stays about 1.75 px wide when a box `box` units wide is drawn `width` px wide. */
const growFor = (width: number, box: number) => Math.max(0, (1.75 * box / width - (OUTER[1] - INNER[1])) / 2);

/** The ring and its light, in the mark's 88 × 68 box. Its light moves only inside an element marked [data-working]. */
export function OrbitLight({ grow = 0, rest = false }: { grow?: number; rest?: boolean }) {
  const id = useId();
  const band = ring(grow);
  // Wide enough to fill the grown band where the orbit is squashed; the band clips the rest.
  const width = LIGHT_WIDTH + (2 * grow) / FLATTEN_Y;
  return (
    <>
      <defs>
        <clipPath id={`${id}band`}>
          <path d={band} clipRule="evenodd" />
        </clipPath>
        <filter id={`${id}glow`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      <g transform={RING_FRAME}>
        <path className="orbit-ring" d={band} fillRule="evenodd" />
        <g filter={`url(#${id}glow)`}>
          <Light spans={GLOW} band={`${id}band`} width={width} />
        </g>
        <Light spans={rest ? CORE : LIGHT} band={`${id}band`} width={width} />
      </g>
    </>
  );
}

type Course = { d: string; length: number; period: number; head: number; className: string };
// The whole orbit: one lap is 100, the light's head at 50.
const WHOLE: Course = { d: ORBIT, length: 100, period: 100, head: HEAD, className: 'orbit-light' };

/** The light's spans, dashed along `course` (in the flattened frame), clipped to the band. */
function Light({ spans, band, width, course = WHOLE }: { spans: Spans; band: string; width: number; course?: Course }) {
  const { d, length, period, head, className } = course;
  return (
    <g clipPath={`url(#${band})`}>
      <g className={className} transform={FLATTEN}>
        {spans.map(([from, to, opacity]) => (
          <path key={from + ':' + to} d={d} pathLength={length} strokeWidth={width} strokeOpacity={opacity} strokeDasharray={`0 ${head + from} ${to - from} ${period - head - to}`} />
        ))}
      </g>
    </g>
  );
}

// Astra's mark: three of the ring, crossed about one centre, 60° apart: the
// logo's tilt, then 120° and 240° on (an ellipse turned 180° is itself, so
// 142.38°, 82.38° and 22.38°). One light runs through all three as one closed
// route (worked out in /private/tmp/astra3/route.py): along a ring round its
// tip, on to the next ring where they cross near the centre, and so on round.
// Each ring carries the same stretch, from HALF before its tip to HALF after;
// at each hand-over the light turns 58°, the least any route allows.
const TILTS = [142.38, 262.38, 22.38];
const HALF = 1.46331; // radians either side of the tip, on the orbit circle
/** One ring's stretch, out of a whole orbit's 100; the route is three of them. */
const SEG = (HALF / Math.PI) * 100;
const ROUTE = 3 * SEG;
const n2 = (v: number) => +v.toFixed(3);
const STRETCH = `M${n2(45 * Math.cos(HALF))} ${n2(-45 * Math.sin(HALF))}A45 45 0 0 1 ${n2(45 * Math.cos(HALF))} ${n2(45 * Math.sin(HALF))}`;
/** The three rings fit a square this far out from the centre, before growing. */
const REACH = 54;

/** Ms per trip round the whole route: the working pace is the loading light's, ready a third of it. */
export const ASTRA_LAP = { ready: 7500, working: 2500 } as const;

export type AstraActivity = 'rest' | 'ready' | 'working';

/**
 * Astra's mark, `size` px square. At rest the light holds still at the top tip, a short bright
 * segment; ready, it makes a slow lap of the route; working, a fast one. With reduced motion it holds
 * still at the top tip.
 */
export function AstraMark({ size, activity = 'rest', className }: { size: number; activity?: AstraActivity; className?: string }) {
  const id = useId();
  const grow = growFor(size, 2 * REACH);
  const band = ring(grow);
  const width = LIGHT_WIDTH + (2 * grow) / FLATTEN_Y;
  const lap = activity === 'rest' ? 0 : ASTRA_LAP[activity];
  // Set to the one clock every copy shares, so a copy carries on where the last one was.
  const phase = useMemo(() => (lap ? `${-(performance.now() % lap)}ms` : '0ms'), [lap]);
  const course: Course = { d: STRETCH, length: SEG, period: ROUTE, head: ROUTE / 2, className: 'astra-light' };
  const box = REACH + grow;
  return (
    <svg className={className ? `astra-mark ${className}` : 'astra-mark'} data-lap={lap ? '' : undefined} data-small={size < 32 ? '' : undefined}
      style={lap ? ({ '--astra-lap': `${lap}ms`, '--orbit-phase': phase } as CSSProperties) : undefined}
      viewBox={`${-box} ${-box} ${2 * box} ${2 * box}`} width={size} height={size} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`${id}band`}>
          <path d={band} clipRule="evenodd" />
        </clipPath>
        <filter id={`${id}glow`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      <g className="astra-rings">
        {TILTS.map((tilt) => <path key={tilt} d={band} fillRule="evenodd" transform={`rotate(${tilt})`} />)}
      </g>
      {TILTS.map((tilt, k) => (
        <g key={tilt} transform={`rotate(${tilt})`} style={{ '--seg': `${k * SEG}px` } as CSSProperties}>
          <g filter={`url(#${id}glow)`}>
            <Light spans={GLOW} band={`${id}band`} width={width} course={course} />
          </g>
          <Light spans={activity === 'rest' ? CORE : LIGHT} band={`${id}band`} width={width} course={course} />
        </g>
      ))}
    </svg>
  );
}
