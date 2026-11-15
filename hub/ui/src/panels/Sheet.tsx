// The shell every main-screen panel here shares: the same glass sheet as the
// connection and alerts panels (.panel.frame), a head with a title and a close
// button, and the behaviour around it. Opening moves focus inside; closing
// (the button, or Escape on the main screen) gives it back to the button that
// opened it. While it is open, the station is framed in the space it leaves free.

import { useLayoutEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { S } from './common.tsx';

export interface SheetProps {
  id: string;
  title: string;
  sub?: ReactNode;
  /** Drawn above the title, centred over it with the line under it. */
  mark?: ReactNode;
  s: S;
  onClose: () => void;
  /** Controls at the head's right, before the close button (Ask Astra's "Asking as" and "Clear"). */
  actions?: ReactNode;
  /** What gets focus on opening; the sheet itself when absent. */
  focus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

const SIDES = ['--scene-inset-right', '--scene-inset-bottom'] as const;

export function Sheet({ id, title, sub, mark, actions, s, onClose, focus, children }: SheetProps) {
  const node = useRef<HTMLElement>(null);

  // Focus in on open, back to the opener on close.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (focus?.current ?? node.current)?.focus({ preventScroll: true });
    return () => {
      const back = opener?.isConnected ? opener : document.querySelector<HTMLElement>('.xtop-more');
      // Only when focus was inside (or is lost): a tap elsewhere keeps its own focus.
      if (!document.activeElement || document.activeElement === document.body || node.current?.contains(document.activeElement)) back?.focus({ preventScroll: true });
    };
  }, []);

  // Tell the station what this sheet covers: its right edge on a wide screen, the bottom on a tall one.
  useLayoutEffect(() => {
    const el = node.current;
    const station = document.querySelector<HTMLElement>('.station');
    if (!el || !station) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const tall = box.left < window.innerWidth / 3;
      // Only the covered side is set; the other keeps whatever the main screen gives it.
      const [side, other] = tall ? SIDES.slice().reverse() : SIDES;
      station.style.setProperty(side, `${Math.round(tall ? window.innerHeight - box.top : window.innerWidth - box.left)}`);
      station.style.removeProperty(other);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', measure);
      for (const side of SIDES) station.style.removeProperty(side);
    };
  }, []);

  return (
    <section ref={node} id={`panel-${id}`} className="panel frame xpanel" aria-labelledby={`panel-${id}-title`} tabIndex={-1}>
      <div className="panel-head">
        <div className={mark ? 'panel-named' : undefined}>
          {mark}
          <h2 id={`panel-${id}-title`}>{title}</h2>
          {sub && <div className="panel-sub">{sub}</div>}
        </div>
        {actions}
        <button type="button" className="panel-close" aria-label={s('top.close')} onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7L7 17" /></svg>
        </button>
      </div>
      {children}
    </section>
  );
}
