import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import './loading.css';

// The mark, as in public/brand/mark.svg. The ring is drawn in its own frame
// (moved to the centre, turned to its tilt), where it is an ellipse band.
const CROSS = [
  'M34 11C34 7.13401 37.134 4 41 4H47C50.866 4 54 7.13401 54 11V57C54 60.866 50.866 64 47 64H41C37.134 64 34 60.866 34 57V11Z',
  'M67 24C70.866 24 74 27.134 74 31V37C74 40.866 70.866 44 67 44H21C17.134 44 14 40.866 14 37V31C14 27.134 17.134 24 21 24H67Z',
];
const RING = 'M-53.56 0a53.56 10.01 0 1 0 107.12 0a53.56 10.01 0 1 0 -107.12 0ZM-36.44 0a36.44 6.76 0 1 0 72.88 0a36.44 6.76 0 1 0 -72.88 0Z';
const RING_FRAME = 'translate(43.33 33.8) rotate(142.38)';

// Squashed back to a circle, the band is a ring 45 out and 17 wide: the light
// runs round that circle at an even pace, which reads as an orbit seen at a tilt.
const FLATTEN = 'scale(1 0.1869)';
const ORBIT = 'M45 0A45 45 0 1 1 -45 0A45 45 0 1 1 45 0';

// The light, as spans of the orbit (out of 100) around its head at 50:
// a long faint tail behind, a bright core, a short soft edge ahead.
const LIGHT: [number, number, number][] = [
  [-40, 0, 0.08], [-30, 0, 0.1], [-22, 0, 0.13], [-15, 0, 0.17], [-9, 0, 0.24], [-4.5, 0.5, 0.4],
  [-2, 1, 0.8], [0, 2, 0.35], [0, 3.2, 0.15],
];
// A blurred copy of the head, so it glows a little past the edges of the band.
const GLOW: [number, number, number][] = [[-10, 0, 0.35], [-4, 1.5, 0.7]];
const HEAD = 50;

const LAP = 1800;   // ms for one lap of the light
const DELAY = 200;  // a fast connection never sees this screen
const HOLD = 500;   // once seen, it stays at least this long
const FADE = 200;

// index.html paints this same mark before any script runs. When it is there,
// the screen has been showing since the page started.
let fromSplash = document.getElementById('splash') !== null;

// Every copy of the light is set to one clock, so a copy taking over carries on where the last one was.
const phase = () => `${-(performance.now() % LAP)}ms`;

type Props = { message: string; quiet: boolean };

export function Loading({ message, quiet }: Props) {
  const id = useId();
  const node = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(fromSplash);
  const shownAt = useRef<number | null>(fromSplash ? 0 : null);
  const [start] = useState(phase);

  useEffect(() => {
    fromSplash = false;
    if (shownAt.current !== null) return;
    const timer = setTimeout(() => {
      shownAt.current = performance.now();
      setShown(true);
    }, DELAY);
    return () => clearTimeout(timer);
  }, []);

  // When the data arrives this screen is taken away at once; a copy of it
  // stays over the hub until it has been seen long enough, then fades.
  useLayoutEffect(() => {
    const screen = node.current;
    return () => {
      const at = shownAt.current;
      if (!screen || at === null) return;
      const copy = screen.cloneNode(true) as HTMLElement;
      queueMicrotask(() => {
        if (!screen.isConnected) linger(copy, at);
      });
    };
  }, []);

  return (
    <div ref={node} className="loading" role="status" aria-live="polite" data-shown={shown ? '' : undefined} style={{ '--loading-phase': start } as CSSProperties}>
      <svg className="loading-mark" viewBox="0 0 88 68" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id={`${id}band`}>
            <path d={RING} clipRule="evenodd" />
          </clipPath>
          <filter id={`${id}glow`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
        <g transform={RING_FRAME}>
          <path className="loading-ring" d={RING} fillRule="evenodd" />
          <g filter={`url(#${id}glow)`}>
            <Light spans={GLOW} band={`${id}band`} />
          </g>
          <Light spans={LIGHT} band={`${id}band`} />
        </g>
        {CROSS.map((d) => <path key={d} className="loading-cross" d={d} />)}
      </svg>
      <p className={quiet ? 'loading-text loading-unseen' : 'loading-text'}>{message}</p>
    </div>
  );
}

function Light({ spans, band }: { spans: [number, number, number][]; band: string }) {
  return (
    <g clipPath={`url(#${band})`}>
      <g className="loading-light" transform={FLATTEN}>
        {spans.map(([from, to, opacity]) => (
          <path key={from + ':' + to} d={ORBIT} pathLength={100} strokeOpacity={opacity} strokeDasharray={`0 ${HEAD + from} ${to - from} ${100 - HEAD - to}`} />
        ))}
      </g>
    </g>
  );
}

function linger(copy: HTMLElement, shownAt: number) {
  copy.removeAttribute('role');
  copy.removeAttribute('aria-live');
  copy.setAttribute('aria-hidden', 'true');
  copy.dataset.leaving = '';
  copy.style.setProperty('--loading-phase', phase());
  document.body.append(copy);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => {
    if (still) return copy.remove();
    getComputedStyle(copy).opacity; // settle its first style, so the fade has somewhere to start from
    copy.dataset.gone = '';
    setTimeout(() => copy.remove(), FADE);
  }, Math.max(0, shownAt + HOLD - performance.now()));
}
