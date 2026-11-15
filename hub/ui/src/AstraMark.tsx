// The orbit light: the ring of the mark (public/brand/mark.svg) with the
// light that runs round it. The loading screen draws it under the cross;
// Astra's mark is the ring alone, at the logo's own tilt and proportions.
// Decorative: the words beside it say what is happening.

import { useId } from 'react';
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

/** How much to grow the band so its narrowest part stays about 1.75 px wide at `width` px. */
const growFor = (width: number) => Math.max(0, (1.75 * BOX[0] / width - (OUTER[1] - INNER[1])) / 2);

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

function Light({ spans, band, width }: { spans: Spans; band: string; width: number }) {
  return (
    <g clipPath={`url(#${band})`}>
      <g className="orbit-light" transform={FLATTEN}>
        {spans.map(([from, to, opacity]) => (
          <path key={from + ':' + to} d={ORBIT} pathLength={100} strokeWidth={width} strokeOpacity={opacity} strokeDasharray={`0 ${HEAD + from} ${to - from} ${100 - HEAD - to}`} />
        ))}
      </g>
    </g>
  );
}

/** Astra's mark: the orbit light without the cross, `size` px wide. Idle, the light rests; working, it runs. */
export function AstraMark({ size, working = false, className }: { size: number; working?: boolean; className?: string }) {
  const grow = growFor(size);
  return (
    <svg className={className ? `astra-mark ${className}` : 'astra-mark'} data-working={working ? '' : undefined}
      viewBox={`${-grow} ${-grow} ${BOX[0] + 2 * grow} ${BOX[1] + 2 * grow}`} width={size} aria-hidden="true" focusable="false">
      <OrbitLight grow={grow} rest={!working} />
    </svg>
  );
}
