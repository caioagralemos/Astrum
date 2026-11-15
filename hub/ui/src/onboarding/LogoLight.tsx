// The full logo (public/brand/logo.svg) drawn inline, with the loading mark's
// orbit light (AstraMark.tsx) running round its ring: the ring in the logo is
// the mark's ring at the same place and scale, so the light sits on it with no
// transform. The logo's own paths come from the file itself (all but its ring,
// which OrbitLight draws), so the cross and the letters are drawn above the light.
// Same lap and look as the loading screen; with reduced motion the light rests.

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { LAP, OrbitLight } from '../AstraMark.tsx';
import logo from '../../public/brand/logo.svg?raw';

const PATHS = (logo.match(/<path[^>]*\/>/g) ?? []).filter((p) => !p.includes('rotate(')).join('');
const VIEW_BOX = /viewBox="([^"]+)"/.exec(logo)?.[1] ?? '0 0 505 104';

export function LogoLight({ label, className }: { label: string; className?: string }) {
  // Set once: a new phase on every redraw of the page would make the light jump ahead.
  const [phase] = useState(() => `${-(performance.now() % LAP)}ms`);
  return (
    <svg className={className} viewBox={VIEW_BOX} role="img" aria-label={label} data-working=""
      style={{ '--orbit-phase': phase, color: '#fff' } as CSSProperties}>
      <OrbitLight />
      <g dangerouslySetInnerHTML={{ __html: PATHS }} />
    </svg>
  );
}
