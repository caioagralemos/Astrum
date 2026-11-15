// The medical lead's follow-up question, on the screen of the one person it is
// for (the hub sends it to their socket only: engine/privacy.ts followUpFor).
// Her words as the hub gives them, in the screen's language; the answer goes
// through the check-in route like any other, 1 yes, 0 no, or a typed value.
// Announced politely when it appears; focus is never moved to it. While a
// recorded story plays it stays visible and cannot be answered.

import { useEffect, useId, useRef, useState } from 'react';
import { call } from '../panels/common.tsx';
import type { FollowUpAsk } from '../../../engine/followup.ts';
import type { Lang } from '../../../engine/strings.ts';

type S = (key: string, vars?: Record<string, string | number>) => string;

export interface FollowUpProps {
  /** The waiting question, or null. Shown only when it is this person's. */
  followUp: FollowUpAsk | null;
  person: string;
  lang: Lang;
  s: S;
  /** A recorded story is playing: nothing can be answered. */
  recorded: boolean;
  /** The class of the card when there is something to show. */
  className: string;
}

/** A typed answer as a check-in value: a plain number is a number, anything else (120/80) is text. */
function typedAnswer(text: string): { value: number | null; text: string | null } | null {
  const v = text.trim();
  if (!v) return null;
  return /^\d+(?:[.,]\d+)?$/.test(v) ? { value: Number(v.replace(',', '.')), text: null } : { value: null, text: v.slice(0, 80) };
}

export function FollowUp({ followUp, person, lang, s, recorded, className }: FollowUpProps) {
  const [answered, setAnswered] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [typed, setTyped] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  // The answered question by its asking and signal: the same question asked again later shows again.
  const keyOf = (f: FollowUpAsk) => `${f.since}|${f.signal}`;
  const open = followUp && followUp.person === person && keyOf(followUp) !== answered ? followUp : null;
  useEffect(() => { setTyped(''); setFailed(false); }, [open?.signal]);
  useEffect(() => { setAnswered(null); }, [person]);

  const send = async (answer: { value: number | null; text: string | null }) => {
    if (!open || recorded || sending) return;
    // Focus on a button that is about to go stays in this card, never lost to the page.
    const hadFocus = box.current?.contains(document.activeElement) ?? false;
    setSending(true);
    setFailed(false);
    const r = await call('/api/checkin', { method: 'POST', body: { person, answers: [{ signal: open.signal, ...answer, ...(open.unit ? { unit: open.unit } : {}) }] } });
    setSending(false);
    if (!r.ok) { setFailed(true); return; }
    setAnswered(keyOf(open));
    if (hadFocus) box.current?.focus({ preventScroll: true });
  };

  const off = recorded || sending;
  const value = typedAnswer(typed);
  return (
    <div ref={box} tabIndex={-1} className={open || answered ? className : 'visually-hidden'} data-followup="">
      <div aria-live="polite">
        {answered && <p className="followup-done">{s('followup.saved')}</p>}
        {open && (
          <>
            <p className="followup-label">{s('followup.forYou')}</p>
            <p className="followup-question" id={`${id}-q`} lang={lang}>{open.text[lang]}</p>
          </>
        )}
        {open && recorded && <p className="followup-note">{s('followup.recorded')}</p>}
        {open && failed && <p className="followup-note">{s('followup.failed')}</p>}
      </div>
      {open && open.kind === 'yes_no' && (
        <div className="actions" role="group" aria-labelledby={`${id}-q`}>
          <button type="button" className="btn" disabled={off} onClick={() => void send({ value: 1, text: null })}>{s('person.yes')}</button>
          <button type="button" className="btn" disabled={off} onClick={() => void send({ value: 0, text: null })}>{s('person.no')}</button>
        </div>
      )}
      {open && open.kind === 'value' && (
        <form className="actions followup-form" onSubmit={(e) => { e.preventDefault(); if (value) void send(value); }}>
          <input type="text" inputMode="text" autoComplete="off" maxLength={80} value={typed} disabled={recorded}
            aria-labelledby={`${id}-q`} aria-describedby={open.unit ? `${id}-u` : undefined} placeholder={s('followup.answer')}
            onChange={(e) => setTyped(e.target.value)} />
          {open.unit && <span className="followup-unit" id={`${id}-u`}>{open.unit}</span>}
          <button type="submit" className="btn btn-solid" disabled={off || !value}>{s('followup.send')}</button>
        </form>
      )}
    </div>
  );
}
