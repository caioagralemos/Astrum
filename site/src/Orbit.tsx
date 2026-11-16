// The logo with the light running round its ring, as the hub's onboarding
// draws it (hub/ui/src/AstraMark.tsx + onboarding/LogoLight.tsx), trimmed to
// what the page needs. With reduced motion the light rests.

import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import logo from '../public/brand/logo.svg?raw';

const PATHS = (logo.match(/<path[^>]*\/>/g) ?? []).filter((p) => !p.includes('rotate(')).join('');
const VIEW_BOX = /viewBox="([^"]+)"/.exec(logo)?.[1] ?? '0 0 505 104';

const OUTER = [53.56, 10.01] as const;
const INNER = [36.44, 6.76] as const;
const RING_FRAME = 'translate(43.33 33.8) rotate(142.38)';
const FLATTEN = 'scale(1 0.1869)';
const ORBIT = 'M45 0A45 45 0 1 1 -45 0A45 45 0 1 1 45 0';
const LAP = 1800;
type Spans = [number, number, number][];
const LIGHT: Spans = [[-40, 0, 0.08], [-30, 0, 0.1], [-22, 0, 0.13], [-15, 0, 0.17], [-9, 0, 0.24], [-4.5, 0.5, 0.4], [-2, 1, 0.8], [0, 2, 0.35], [0, 3.2, 0.15]];
const GLOW: Spans = [[-10, 0, 0.35], [-4, 1.5, 0.7]];
const HEAD = 50;

const ellipse = (a: number, b: number) => `M${-a} 0a${a} ${b} 0 1 0 ${2 * a} 0a${a} ${b} 0 1 0 ${-2 * a} 0Z`;
const band = (grow: number) => ellipse(OUTER[0] + grow, OUTER[1] + grow) + ellipse(INNER[0] - grow, INNER[1] - grow);
const VIEW_W = Number(VIEW_BOX.split(/\s+/)[2]) || 505;
// As the hub does (AstraMark.tsx growFor): at small sizes the band grows so it stays about 1.75 px thick.
const growFor = (width: number) => Math.max(0, (1.75 * VIEW_W / width - (OUTER[1] - INNER[1])) / 2);

function Light({ spans, clip, width }: { spans: Spans; clip: string; width: number }) {
  return (
    <g clipPath={`url(#${clip})`}>
      <g className="orbit-light" transform={FLATTEN}>
        {spans.map(([from, to, o]) => (
          <path key={from + ':' + to} d={ORBIT} pathLength={100} strokeWidth={width} strokeOpacity={o} strokeDasharray={`0 ${HEAD + from} ${to - from} ${100 - HEAD - to}`} />
        ))}
      </g>
    </g>
  );
}

/** `width`: the size it is drawn at, in CSS px, when small. An empty `label` makes it decorative. */
export function LogoLight({ label, className, width }: { label: string; className?: string; width?: number }) {
  const id = useId();
  const grow = width ? growFor(width) : 0;
  const BAND = band(grow);
  const lightWidth = 18 + (2 * grow) / 0.1869;
  const [phase] = useState(() => `${-(performance.now() % LAP)}ms`);
  return (
    <svg className={className} viewBox={VIEW_BOX} role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true} style={{ '--orbit-phase': phase } as CSSProperties}>
      <defs>
        <clipPath id={`${id}b`}><path d={BAND} clipRule="evenodd" /></clipPath>
        <filter id={`${id}g`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6" /></filter>
      </defs>
      <g transform={RING_FRAME}>
        <path className="orbit-ring" d={BAND} fillRule="evenodd" />
        <g filter={`url(#${id}g)`}><Light spans={GLOW} clip={`${id}b`} width={lightWidth} /></g>
        <Light spans={LIGHT} clip={`${id}b`} width={lightWidth} />
      </g>
      <g fill="currentColor" dangerouslySetInnerHTML={{ __html: PATHS }} />
    </svg>
  );
}
