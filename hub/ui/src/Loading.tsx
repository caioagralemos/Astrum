import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { LAP, OrbitLight } from './AstraMark.tsx';
import './loading.css';

// The mark, as in public/brand/mark.svg: the orbit light (AstraMark.tsx), the cross on top.
const CROSS = [
  'M34 11C34 7.13401 37.134 4 41 4H47C50.866 4 54 7.13401 54 11V57C54 60.866 50.866 64 47 64H41C37.134 64 34 60.866 34 57V11Z',
  'M67 24C70.866 24 74 27.134 74 31V37C74 40.866 70.866 44 67 44H21C17.134 44 14 40.866 14 37V31C14 27.134 17.134 24 21 24H67Z',
];

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
    <div ref={node} className="loading" role="status" aria-live="polite" data-shown={shown ? '' : undefined} data-working="" style={{ '--orbit-phase': start } as CSSProperties}>
      <svg className="loading-mark" viewBox="0 0 88 68" aria-hidden="true" focusable="false">
        <OrbitLight />
        {CROSS.map((d) => <path key={d} className="loading-cross" d={d} />)}
      </svg>
      <p className={quiet ? 'loading-text loading-unseen' : 'loading-text'}>{message}</p>
    </div>
  );
}

function linger(copy: HTMLElement, shownAt: number) {
  copy.removeAttribute('role');
  copy.removeAttribute('aria-live');
  copy.setAttribute('aria-hidden', 'true');
  copy.dataset.leaving = '';
  copy.style.setProperty('--orbit-phase', phase());
  document.body.append(copy);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => {
    if (still) return copy.remove();
    getComputedStyle(copy).opacity; // settle its first style, so the fade has somewhere to start from
    copy.dataset.gone = '';
    setTimeout(() => copy.remove(), FADE);
  }, Math.max(0, shownAt + HOLD - performance.now()));
}
