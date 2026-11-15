// Ask Astra: a question to the hub's model (POST /api/ask), shown as an
// instrument, not a person. While it works the panel says where the question
// is; then the answer, who wrote it (Astra, the hub from the readings, or a
// fixed text), the hub's facts each with its label, and NASA's words quoted
// with their source. The urgent, card and crisis routes are said for what they are.
//
// On the hub's own screen anyone can ask, about anyone; on a crewmate's screen
// (?person=) the one asking, and the one asked about, is that crewmate.

import { useEffect, useRef, useState } from 'react';
import { personWords } from '../../../engine/answer.ts';
import type { FactItem, HubAnswer, QuotedPassage, Who } from '../../../engine/answer.ts';
import type { CardView } from '../../../engine/cards.ts';
import type { Lang } from '../../../engine/strings.ts';
import type { Person } from '../../../engine/types.ts';
import { AstraMark } from '../AstraMark.tsx';
import { hubAddress } from '../data.ts';
import { Sheet } from './Sheet.tsx';
import { HubSaid, usePoll, viewerOf } from './common.tsx';
import type { ModelStatus, S } from './common.tsx';

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

type Progress = { state: 'sending' } | { state: 'queued'; position: number } | { state: 'working'; ms: number };

const EXAMPLES = ['bench.ask.ex1', 'bench.ask.ex2', 'bench.ask.ex3'];

/** Uses a person word ({You}, {your}, ...)? The first such sentence names the person (engine/answer.ts). */
const PERSON_BLANK = /\{(You|you|Your|your|them|Voce|voce|de_voce)\}/;

/** The hub's sentences in the screen's language, each with the labels of what it was built from. */
function factLines(items: FactItem[], who: Who, s: S): { text: string; labels: string[] }[] {
  let named = false;
  return items.map((item) => {
    const usesPerson = PERSON_BLANK.test(s(item.key));
    const text = s(item.key, { ...personWords(who, usesPerson && !named), ...item.vars });
    if (usesPerson) named = true;
    const kindWord = (kind: string) => (kind === 'hub' ? s('bench.labelHub') : s(`kind.${kind}`));
    const parts = item.labels ?? [];
    const labels = parts.length > 1 && new Set(parts.map((p) => p.kind)).size > 1
      ? parts.map((p) => s('bench.labelPart', { what: s(`bench.what.${p.what === 'CO2' ? 'co2' : 'location'}`), kind: kindWord(p.kind) }))
      : [kindWord(item.label)];
    return { text, labels: item.key === 'answer.notExact' ? [] : labels };
  });
}

export interface AskProps {
  crew: Person[];
  /** The person selected on the station, if any: who asks, by default. */
  selected: string | null;
  lang: Lang;
  s: S;
  onClose: () => void;
}

export function AskPanel({ crew, selected, lang, s, onClose }: AskProps) {
  const { viewer } = viewerOf();
  const status = usePoll<ModelStatus>('/api/ask/status', 5000);
  const first = viewer ?? (selected && crew.some((p) => p.id === selected) ? selected : crew[0]?.id ?? '');
  const [asker, setAsker] = useState(first);
  const [about, setAbout] = useState(first);
  const [question, setQuestion] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [asked, setAsked] = useState<{ person: string; about: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // "About" follows "Who is asking" until it is changed on its own.
  const follow = useRef(true);
  useEffect(() => { if (follow.current) setAbout(asker); }, [asker]);

  const ask = async (text: string) => {
    if (!text.trim()) { setError(s('bench.ask.empty')); box.current?.focus(); return; }
    setError(null);
    setResult(null);
    setProgress({ state: 'sending' });
    setAsked({ person: asker, about });
    try {
      const res = await fetch(`http://${hubAddress()}/api/ask`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ person: asker, about, question: text, lang }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? String(res.status));
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
          if ('error' in msg) setError(msg.error);
          else if (msg.type === 'status') setProgress(msg.state === 'queued' ? { state: 'queued', position: msg.position } : { state: 'working', ms: msg.ms });
          else setResult(msg);
        }
        if (done) break;
      }
    } catch {
      setError('');
    } finally {
      setProgress(null);
      status.reload();
    }
  };

  const st = status.data;
  const nameOf = (id: string) => crew.find((p) => p.id === id)?.name ?? id;
  const who: Who | null = result?.facts?.who ?? (asked ? { name: nameOf(asked.about), pronouns: 'they', self: asked.about === asked.person } : null);
  const facts = result?.facts && who ? factLines(result.facts.items, who, s) : [];
  const hubWrote = result?.by === 'hub' && facts.length > 0;
  // A fixed text has a key in the string table; the hub's sentences are in the screen's language; Astra writes English.
  // When the hub wrote the answer, its sentences are the facts below, each with its label: not said twice.
  const answerText = !result ? '' : result.key ? s(result.key) : hubWrote ? '' : result.text;
  const passages = result?.facts?.passages.length ? result.facts.passages : result?.passages ?? [];
  const busy = progress !== null;

  return (
    <Sheet id="ask" title="Astra" s={s} onClose={onClose} focus={box}
      mark={<AstraMark size={64} activity={busy || st?.state === 'loading' ? 'working' : st?.state === 'ready' ? 'ready' : 'rest'} />}
      sub={<span className="status-word astra-status" data-status={st?.state === 'ready' ? 'live' : st?.state === 'unavailable' ? 'off' : undefined}>
        {busy ? s('ask.mark.working') : st ? s(`ask.mark.${st.state}`) : s('settings.loading')}
        {st && st.waiting > 0 ? ` · ${s('bench.ask.waiting', { count: st.waiting })}` : ''}
      </span>}>
      {st?.reason && st.state !== 'ready' && <p className="quiet xhub" lang="en">{st.reason}</p>}

      <form className="xform" onSubmit={(e) => { e.preventDefault(); void ask(question); }}>
        {!viewer && (
          <div className="xrow">
            <label className="xfield">
              <span className="label">{s('ask.who')}</span>
              <select value={asker} onChange={(e) => setAsker(e.target.value)}>
                {crew.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="xfield">
              <span className="label">{s('ask.about')}</span>
              <select value={about} onChange={(e) => { follow.current = e.target.value === asker; setAbout(e.target.value); }}>
                {crew.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
        )}
        <label className="xfield">
          <span className="label">{s('ask.question')}</span>
          <textarea ref={box} rows={2} value={question} onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(question); } }} />
        </label>
        <div className="actions">
          <button type="submit" className="btn btn-solid" disabled={busy}>{s('ask.send')}</button>
        </div>
      </form>

      <div className="xexamples" role="group" aria-label={s('ask.examples')}>
        <p className="label">{s('ask.examples')}</p>
        {EXAMPLES.map((key) => (
          <button key={key} type="button" className="xchip" disabled={busy} onClick={() => { setQuestion(s(key)); void ask(s(key)); }}>{s(key)}</button>
        ))}
      </div>
      {lang === 'pt' && <p className="quiet">{s('bench.ask.englishNote')}</p>}

      <div className="xlive" aria-live="polite" aria-busy={busy}>
        {progress && (
          <p className="xprogress" role="status">
            {progress.state === 'sending' ? s('ask.sending')
              : progress.state === 'queued' ? s('ask.queued', { position: progress.position })
                : s('ask.working', { seconds: Math.round(progress.ms / 1000) })}
          </p>
        )}
        {error !== null && <HubSaid error={error} s={s} />}
        {result && (
          <article className="rule xanswer" aria-labelledby="ask-answer">
            <h3 id="ask-answer" className="visually-hidden">{s('ask.answer')}</h3>
            <p className="xtags">
              <span className="xtag" data-by={result.by}>{s(`ask.by.${result.by}`)}</span>
              {result.urgent && <span className="xtag" data-urgent="">{s('bench.ask.urgent')}</span>}
            </p>
            {result.route !== 'answer' && <p className="quiet">{s(`bench.ask.route.${result.route}`)}</p>}
            {answerText && <p className="xanswer-text" lang={result.key || hubWrote ? lang : 'en'}>{answerText}</p>}
            {result.by === 'model' && lang === 'pt' && <p className="quiet">{s('ask.englishAnswer')}</p>}
            {result.source && <p className="quiet">{s('bench.ask.cites', { source: result.source })}</p>}
            {result.check?.discarded && <p className="quiet">{s('ask.discarded')}</p>}
            {result.card ? <StepsCard card={result.card} s={s} /> : (result.route === 'card' || result.urgent) && <p className="quiet">{s('ask.noCard')}</p>}

            {result.route !== 'crisis' && result.route !== 'card' && (
              <>
                <h4 className="label xsub">{s('bench.ask.facts')}</h4>
                {facts.length ? (
                  <ul className="xfacts">
                    {facts.map((f, i) => (
                      <li key={i}>
                        {f.text}
                        {f.labels.length > 0 && <span className="xfact-labels">{f.labels.map((l) => <span key={l} className="kind">{l}</span>)}</span>}
                      </li>
                    ))}
                  </ul>
                ) : <p className="quiet">{s('bench.ask.noFacts')}</p>}

                <h4 className="label xsub">{s('bench.ask.passages')}</h4>
                {passages.length ? (
                  <>
                    <p className="quiet">{s('bench.ask.quotedEnglish')}</p>
                    {passages.map((p, i) => (
                      <figure key={i} className="xquote">
                        <blockquote lang="en">{p.text}</blockquote>
                        <figcaption>
                          {s('bench.ask.passageFrom', { name: p.name })}
                          {p.url && <> · <a href={p.url} target="_blank" rel="noreferrer">{s('bench.ask.open', { name: p.name })}</a></>}
                        </figcaption>
                      </figure>
                    ))}
                  </>
                ) : <p className="quiet">{s('bench.ask.noPassages')}</p>}
              </>
            )}
            <p className="quiet">{s('bench.ask.took', { seconds: (result.ms / 1000).toFixed(1) })}</p>
          </article>
        )}
      </div>
    </Sheet>
  );
}

/** A steps card as the medical lead wrote it, in the language it has. */
function StepsCard({ card, s }: { card: CardView; s: S }) {
  return (
    <div className="xcard" lang={card.lang}>
      <h4>{s('bench.card.title', { title: card.title })}</h4>
      <ol>{card.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
      {card.doNot.length > 0 && <><p className="label">{s('bench.card.doNot')}</p><ul>{card.doNot.map((d, i) => <li key={i}>{d}</li>)}</ul></>}
      {card.messageHouston && <p className="quiet">{s('bench.card.houston')}</p>}
      {card.unverified.length > 0 && <p className="quiet">{s('bench.card.unverified')}</p>}
    </div>
  );
}
