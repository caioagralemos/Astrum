// The web replay's context card. The hub runs as it is for a few seconds
// (data.ts INTRO_AFTER), then this small sheet comes up in the middle, over
// the station dimmed and blurred the way the emergency takeover does it: a
// line icon for the kind of story, the scenario's words (meta.intro) and Start.
// Nothing plays until Start; Enter, Space and Escape start it too. Replay mode
// only (App.tsx).

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Intro, IntroText } from '../data.ts';
import type { Lang } from '../../../engine/strings.ts';
import './intro.css';

/** 24-unit line icons, drawn like the hub's other glyphs. */
const ICONS: Record<NonNullable<Intro['icon']>, string> = {
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  wind: 'M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8',
  flame: 'M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.4 3.7-8.3.6 1.6 1.4 2.6 2.6 3.3.2-2.6 1.3-4.8 3.2-6.8.4 3.5 3.5 5.9 3.5 10.5 0 4.6-2.6 7.5-6.5 7.5zM12 21c-1.7 0-2.8-1.2-2.8-2.8 0-1.8 1.4-2.7 2.1-4.2.9 1.1 3.5 2.3 3.5 4.4 0 1.5-1.1 2.6-2.8 2.6z',
};

export function IntroCard({ intro, lang, s, onStart }: {
  intro: Intro;
  lang: Lang;
  s: (key: string) => string;
  onStart: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const start = useRef(onStart);
  start.current = onStart;
  const text = (t: IntroText) => (typeof t === 'string' ? t : (lang === 'pt' && t.pt) || t.en);

  useEffect(() => {
    button.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      start.current();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, []);

  // On the page itself, not inside the hub's layers: there the blur would only reach its own box.
  return createPortal(
    <div className="intro" style={{ backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }} role="dialog" aria-modal="true" aria-labelledby="intro-title" aria-describedby="intro-lines">
      <section className="intro-sheet frame">
        {intro.icon && (
          <svg className="intro-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={ICONS[intro.icon]} /></svg>
        )}
        <p className="intro-label">{s('scenario.intro.label')}</p>
        <h1 id="intro-title" className="intro-title">{text(intro.title)}</h1>
        <div id="intro-lines" className="intro-lines">
          {intro.lines.map((line, i) => <p key={i}>{text(line)}</p>)}
          <p className="intro-watch">{s('scenario.intro.watch')}</p>
        </div>
        <button ref={button} type="button" className="intro-start" onClick={onStart}>{s('scenario.intro.start')}</button>
      </section>
    </div>,
    document.body,
  );
}
