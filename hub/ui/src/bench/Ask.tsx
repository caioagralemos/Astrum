// 1. Ask Astrum: a question to POST /api/ask, its progress while the model
// works, then the answer, who wrote it, the hub's facts with their labels and
// NASA's passages quoted with their source.

import { useEffect, useState } from 'react';
import { personWords } from '../../../engine/answer.ts';
import type { FactItem, HubAnswer, QuotedPassage, Who } from '../../../engine/answer.ts';
import type { CardView } from '../../../engine/cards.ts';
import { api, failure, kindName, personName, Panel, Tag, usePoll } from './common.tsx';
import type { PanelProps, S } from './common.tsx';

interface AskStatus { state: 'loading' | 'ready' | 'unavailable'; reason: string | null; waiting: number }

interface AskResult {
  type: 'result';
  route: 'answer' | 'crisis' | 'card' | 'fixed' | 'unavailable' | 'fallback';
  by: 'model' | 'hub' | 'fixed';
  text: string;
  key: string | null;
  source: string | null;
  passages: QuotedPassage[];
  card: CardView | null;
  urgent: boolean;
  check: { discarded: boolean; reasons: string[] } | null;
  facts: HubAnswer | null;
  ms: number;
}

type Progress = { state: 'sending' } | { state: 'queued'; position: number } | { state: 'thinking'; ms: number };

const EXAMPLES = ['bench.ask.ex1', 'bench.ask.ex2', 'bench.ask.ex3', 'bench.ask.ex4'];

/** Uses a person word ({You}, {your}, ...)? The first such sentence names the person (engine/answer.ts renderItems). */
const PERSON_BLANK = /\{(You|you|Your|your|them|Voce|voce|de_voce)\}/;

/** The hub's sentences in the screen's language, from the string table, and the label of each. */
function factLines(items: FactItem[], who: Who, s: S): { text: string; label: string }[] {
  let named = false;
  return items.map((item) => {
    const template = s(item.key);
    const usesPerson = PERSON_BLANK.test(template);
    const text = s(item.key, { ...personWords(who, usesPerson && !named), ...item.vars });
    if (usesPerson) named = true;
    const parts = item.labels ?? [];
    const label = parts.length > 1 && new Set(parts.map((p) => p.kind)).size > 1
      ? parts.map((p) => s('bench.labelPart', { what: s(`bench.what.${p.what === 'CO2' ? 'co2' : 'location'}`), kind: kindName(p.kind, s) })).join('; ')
      : kindName(item.label, s);
    return { text, label: item.key === 'answer.notExact' ? '' : label };
  });
}

export function Ask({ profile, me, lang, s }: PanelProps) {
  const status = usePoll<AskStatus>('/api/ask/status', 5000);
  const [question, setQuestion] = useState('');
  const [about, setAbout] = useState(me);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [asked, setAsked] = useState<{ person: string; about: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setAbout(me), [me]);

  const ask = async (text: string) => {
    if (!text.trim()) { setError(s('bench.ask.empty')); return; }
    setError(null);
    setResult(null);
    setProgress({ state: 'sending' });
    setAsked({ person: me, about });
    try {
      const res = await fetch(api('/api/ask'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ person: me, about, question: text, lang }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(failure(s, body?.error ?? String(res.status)));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let held = '';
      for (;;) {
        const { value, done } = await reader.read();
        held += decoder.decode(value, { stream: !done });
        const lines = held.split('\n');
        held = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as AskResult | { type: 'status'; state: 'queued'; position: number } | { type: 'status'; state: 'thinking'; ms: number } | { error: string };
          if ('error' in msg) setError(failure(s, msg.error));
          else if (msg.type === 'status') setProgress(msg.state === 'queued' ? { state: 'queued', position: msg.position } : { state: 'thinking', ms: msg.ms });
          else setResult(msg);
        }
        if (done) break;
      }
    } catch {
      setError(failure(s, ''));
    } finally {
      setProgress(null);
      status.reload();
    }
  };

  const st = status.data;
  const who: Who | null = result?.facts?.who ?? (asked ? { name: personName(profile, asked.about), pronouns: 'they', self: asked.about === asked.person } : null);
  // A fixed text has a key in the string table; the hub's and the model's words are shown as written.
  const facts = result?.facts && who ? factLines(result.facts.items, who, s) : [];
  const hubWrote = result?.by === 'hub' && facts.length > 0;
  const answerText = !result ? '' : result.key ? s(result.key) : hubWrote ? facts.map((f) => f.text).join(' ') : result.text;
  const passages = result?.facts?.passages.length ? result.facts.passages : result?.passages ?? [];

  return (
    <Panel id="ask" title={s('bench.ask.title')} wide>
      <p>
        {st ? s('bench.ask.model', { state: s(`bench.ask.state.${st.state}`) }) : status.error !== null ? failure(s, status.error) : s('bench.loading')}
        {st && st.waiting > 0 && <> · {s('bench.ask.waiting', { count: st.waiting })}</>}
      </p>
      {st?.reason && <p className="muted"><span>{s('bench.hubWords')}</span> <span lang="en">{st.reason}</span></p>}

      <form onSubmit={(e) => { e.preventDefault(); void ask(question); }}>
        <div className="row">
          <label className="field">
            <span>{s('bench.ask.about')}</span>
            <select value={about} onChange={(e) => setAbout(e.target.value)}>
              {profile.crew.map((p) => <option key={p.id} value={p.id}>{p.id === me ? s('bench.ask.aboutSelf', { name: p.name }) : p.name}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>{s('bench.ask.question')}</span>
          <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>
        <div className="row">
          <button type="submit" disabled={progress !== null}>{s('bench.ask.send')}</button>
        </div>
      </form>
      <fieldset className="examples">
        <legend>{s('bench.ask.examples')}</legend>
        {EXAMPLES.map((key) => (
          <button key={key} type="button" disabled={progress !== null} onClick={() => { setQuestion(s(key)); void ask(s(key)); }}>{s(key)}</button>
        ))}
      </fieldset>
      {lang === 'pt' && <p className="muted">{s('bench.ask.englishNote')}</p>}

      <div aria-live="polite" aria-busy={progress !== null}>
        {progress && (
          <p role="status" className="progress">
            {progress.state === 'sending' ? s('bench.sending')
              : progress.state === 'queued' ? s('bench.ask.queued', { position: progress.position })
                : s('bench.ask.thinking', { seconds: Math.round(progress.ms / 1000) })}
          </p>
        )}
        {error && <p className="said bad">{error}</p>}
        {result && (
          <article className="answer">
            <h3>{s('bench.ask.answer')}</h3>
            <p className="tags">
              <Tag>{s(`bench.ask.by.${result.by}`)}</Tag>
              {result.urgent && <Tag>{s('bench.ask.urgent')}</Tag>}
              <span className="muted">{s(`bench.ask.route.${result.route}`)}</span>
            </p>
            {answerText && <p className="answer-text" lang={result.key || hubWrote ? lang : 'en'}>{answerText}</p>}
            {result.by === 'model' && lang === 'pt' && <p className="muted">{s('bench.ask.modelEnglish')}</p>}
            {result.source && <p className="muted">{s('bench.ask.cites', { source: result.source })}</p>}
            {result.check?.discarded && (
              <div>
                <p>{s('bench.ask.discarded')}</p>
                <HubReasons reasons={result.check.reasons} s={s} />
              </div>
            )}
            {result.card && <Card card={result.card} s={s} />}

            {result.route !== 'crisis' && result.route !== 'card' && (
              <>
                <h4>{s('bench.ask.facts')}</h4>
                {facts.length ? (
                  <ul className="facts">
                    {facts.map((f, i) => <li key={i}>{f.text} {f.label && <Tag>{f.label}</Tag>}</li>)}
                  </ul>
                ) : <p className="muted">{s('bench.ask.noFacts')}</p>}
                <h4>{s('bench.ask.passages')}</h4>
                {passages.length ? (
                  <>
                    <p className="muted">{s('bench.ask.quotedEnglish')}</p>
                    {passages.map((p, i) => (
                      <figure key={i} className="quote">
                        <blockquote lang="en">{p.text}</blockquote>
                        <figcaption>{s('bench.ask.passageFrom', { name: p.name })}{p.url && <> · <a href={p.url} target="_blank" rel="noreferrer">{s('bench.ask.open', { name: p.name })}</a></>}</figcaption>
                      </figure>
                    ))}
                  </>
                ) : <p className="muted">{s('bench.ask.noPassages')}</p>}
              </>
            )}
            <p className="muted">{s('bench.ask.took', { seconds: (result.ms / 1000).toFixed(1) })}</p>
          </article>
        )}
      </div>
    </Panel>
  );
}

function HubReasons({ reasons, s }: { reasons: string[]; s: S }) {
  if (!reasons.length) return null;
  return (
    <div className="hubwords">
      <p className="muted">{s('bench.hubWords')}</p>
      <ul>{reasons.map((r, i) => <li key={i} lang="en">{r}</li>)}</ul>
    </div>
  );
}

/** A steps card as the medical lead wrote it, in the language it has. */
export function Card({ card, s }: { card: CardView; s: S }) {
  return (
    <div className="card" lang={card.lang}>
      <h4>{s('bench.card.title', { title: card.title })} <small className="muted">({card.id})</small></h4>
      <p className="muted">{s('bench.card.steps')}</p>
      <ol>{card.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
      {card.doNot.length > 0 && <><p className="muted">{s('bench.card.doNot')}</p><ul>{card.doNot.map((d, i) => <li key={i}>{d}</li>)}</ul></>}
      {card.messageHouston && <p>{s('bench.card.houston')}</p>}
      {card.unverified.length > 0 && <p className="muted">{s('bench.card.unverified')}: <span lang="en">{card.unverified.join(', ')}</span></p>}
    </div>
  );
}
