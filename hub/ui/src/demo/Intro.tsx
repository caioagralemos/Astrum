// The web replay's context card: one full-window frame, in the onboarding's
// look, before a recorded scenario plays. Its words come from the file
// (meta.intro), so each scenario has its own. Nothing plays until Start;
// Enter, Space and Escape start it too. Replay mode only (App.tsx).

import { useEffect, useRef } from 'react';
import type { Intro, IntroText } from '../data.ts';
import type { Lang } from '../../../engine/strings.ts';
import { Frame } from '../onboarding/Onboarding.tsx';
import '../onboarding/onboarding.css';

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

  return (
    <div className="ob" role="dialog" aria-modal="true" aria-labelledby="intro-title" aria-describedby="intro-lines">
      <section className="ob-step">
        <Frame className="center">
          <p className="ob-small">{s('scenario.intro.label')}</p>
          <div className="ob-sp" />
          <h1 id="intro-title" className="ob-title">{text(intro.title)}</h1>
          <div id="intro-lines">
            {intro.lines.map((line, i) => <p key={i} className="ob-lede">{text(line)}</p>)}
            <p className="ob-lede">{s('scenario.intro.watch')}</p>
          </div>
          <div className="ob-sp" />
          <button ref={button} type="button" className="ob-btn fill" onClick={onStart}>{s('scenario.intro.start')}</button>
        </Frame>
      </section>
    </div>
  );
}
