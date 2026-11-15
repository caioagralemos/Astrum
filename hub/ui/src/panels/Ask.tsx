// Ask Astra: a conversation with the hub's model (POST /api/ask), the same flow
// as the phone's chat (phone AskThread / AskAnswerView): the crewmate's
// messages on the right, Astra's on the left, a 2-second minimum before a reply
// that is not urgent, typing dots while she works, the medical lead's questions
// as reply chips, a card's "Start help" opening the hub's step-by-step screen,
// the check-in after Done, and "Call for help" confirmed inline.
//
// "Asking as" says who the questions are asked as. The shared screen (nobody
// chosen) gets rooms and NASA's text only (POST /api/ask { shared: true }). Each
// person's thread is kept in this page's memory only, never mixed, until Clear.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { personWords } from '../../../engine/answer.ts';
import type { FactItem, QuotedPassage, Who } from '../../../engine/answer.ts';
import type { CardView } from '../../../engine/cards.ts';
import type { Lang } from '../../../engine/strings.ts';
import type { Person } from '../../../engine/types.ts';
import type { AskResult as HubResult } from '../../../core/ai.ts';
import { AstraMark } from '../AstraMark.tsx';
import { hubAddress, isReplay } from '../data.ts';
import { Steps } from '../emergency/Steps.tsx';
import { Sheet } from './Sheet.tsx';
import { HubSaid, usePoll, viewerOf } from './common.tsx';
import type { ModelStatus, S } from './common.tsx';

type AskResult = HubResult;
type Progress = { state: 'sending' } | { state: 'queued'; position: number } | { state: 'working'; ms: number };

/** "Asking as" nobody: rooms and NASA only. */
const SHARED = '';
/** The phone's minimum before a reply that is not urgent shows (AskThread.minimumReplyTime). */
const MIN_REPLY_MS = 2000;
/** The hub forgets a conversation after 30 minutes of quiet (THREAD_IDLE_MS); history items it takes (MAX_HISTORY). */
const MEMORY_MS = 30 * 60_000;
const MAX_HISTORY = 6;

type Help = { state: 'confirm' } | { state: 'calling' } | { state: 'failed' } | { state: 'sent'; text: string };
type Msg =
  | { id: number; from: 'me'; text: string }
  | { id: number; from: 'astra'; question: string | null; result: AskResult; at: number; stepsShown?: boolean; help?: Help }
  | { id: number; from: 'error'; error: string };

/** Every thread, by who asks (SHARED for the shared screen): this page's memory only. */
const threads = new Map<string, Msg[]>();
let nextId = 1;

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

const urgentReply = (r: AskResult) => r.urgent || r.card?.level === 'dangerous';

export interface AskProps {
  crew: Person[];
  /** The person selected on the station, if any. */
  selected: string | null;
  lang: Lang;
  /** The place's gravity, for the steps screen. */
  gravity: number | null;
  s: S;
  onClose: () => void;
}

export function AskPanel(props: AskProps) {
  // The model lives on the hub's computer; a recorded story in the browser has none: it shows answers recorded on a hub.
  if (isReplay()) return <AskReplay {...props} />;
  return <AskWithHub {...props} />;
}

/** One answer recorded on a live hub (hub/scripts/record-astra.ts): the hub's response, untouched. */
interface Recorded { question: string; person: string; response: AskResult }

/** The recorded answers beside the story: "x.json" → "x.astra.json". Null if there are none. */
function useRecorded(): Recorded[] | null | undefined {
  const [answers, setAnswers] = useState<Recorded[] | null | undefined>(undefined);
  useEffect(() => {
    const story = new URLSearchParams(location.search).get('replay') ?? '';
    if (!story.endsWith('.json')) { setAnswers(null); return; }
    let live = true;
    fetch(`${story.slice(0, -5)}.astra.json`).then((res) => (res.ok ? res.json() : null))
      .then((f: { answers?: Recorded[] } | null) => { if (live) setAnswers(f?.answers?.length ? f.answers : null); })
      .catch(() => { if (live) setAnswers(null); });
    return () => { live = false; };
  }, []);
  return answers;
}

/** The replay's sheet: the recorded questions as choices; a choice shows its answer as the live sheet renders it. */
function AskReplay({ lang, gravity, s, onClose }: AskProps) {
  const answers = useRecorded();
  const [shown, setShown] = useState<number | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [steps, setSteps] = useState<string | null>(null);
  const pick = (i: number) => { setShown(i); setSourcesOpen(false); };
  const chosen = shown !== null && answers ? answers[shown] : null;

  return (
    <Sheet id="ask" title="Astra" s={s} onClose={onClose} mark={<AstraMark size={30} activity="rest" />}>
      {answers === null && <p className="quiet">{s('ask.notOnWeb')}</p>}
      {answers && (
        <>
          <div className="ask-chips" role="group" aria-label={s('ask.recordedChoose')}>
            {answers.map((a, i) => (
              <button key={i} type="button" className="ask-chip" lang="en" aria-pressed={shown === i} onClick={() => pick(i)}>{a.question}</button>
            ))}
          </div>
          {chosen && (
            <div className="ask-log" role="log" aria-live="polite" aria-label={s('ask.thread')}>
              <p className="ask-seen">{s('ask.recorded')}</p>
              <p className="quiet ask-seen">{s('ask.recordedNote')}</p>
              <p className="ask-msg" data-me="" lang="en"><span className="visually-hidden">{s('ask.you')}: </span>{chosen.question}</p>
              <Reply key={shown} m={{ id: shown ?? 0, from: 'astra', question: chosen.question, result: chosen.response, at: 0 }} newest={false}
                lang={lang} s={s} shared={false} sourcesOpen={sourcesOpen} onSources={() => setSourcesOpen((o) => !o)}
                onReply={() => {}} onSteps={(card) => setSteps(card.id)} onHelp={() => {}} onCall={() => {}} onChoose={() => {}} />
            </div>
          )}
          {lang === 'pt' && <p className="quiet">{s('bench.ask.englishNote')}</p>}
          <p className="quiet">{s('ask.typingNeedsHub')}</p>
        </>
      )}
      {steps && createPortal(
        <Steps key={steps} alert={null} cardId={steps} gravity={gravity} lang={lang} s={s} onClose={() => setSteps(null)} />,
        document.querySelector('main.hub') ?? document.body,
      )}
    </Sheet>
  );
}

function AskWithHub({ crew, lang, gravity, s, onClose }: AskProps) {
  const { viewer } = viewerOf();
  const status = usePoll<ModelStatus>('/api/ask/status', 5000);
  const signedIn = viewer && crew.some((p) => p.id === viewer) ? viewer : null;
  const [asker, setAsker] = useState<string>(signedIn ?? SHARED);
  const [msgs, setMsgs] = useState<Msg[]>(() => threads.get(asker) ?? []);
  const [text, setText] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [picking, setPicking] = useState(false);
  const [steps, setSteps] = useState<{ card: string; msg: number } | null>(null);
  const [openSources, setOpenSources] = useState<Set<number>>(() => new Set());
  const box = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const live = useRef(asker);
  live.current = asker;

  // The thread on screen is the chosen person's; every change is kept under their id.
  const update = (owner: string, fn: (m: Msg[]) => Msg[]) => {
    const next = fn(threads.get(owner) ?? []);
    threads.set(owner, next);
    if (live.current === owner) setMsgs(next);
  };
  const choose = (id: string) => {
    setPicking(false);
    setAsker(id);
    live.current = id;
    setMsgs(threads.get(id) ?? []);
    setProgress(null);
    box.current?.focus();
  };

  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, progress]);

  const nameOf = (id: string) => crew.find((p) => p.id === id)?.name ?? id;
  const shared = asker === SHARED;
  const busy = progress !== null;

  /** One request to POST /api/ask, read to its result; at least 2 s unless the reply is urgent. */
  const request = async (owner: string, body: Record<string, unknown>, question: string | null) => {
    const started = Date.now();
    setProgress({ state: 'sending' });
    try {
      const res = await fetch(`http://${hubAddress()}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        update(owner, (m) => [...m, { id: nextId++, from: 'error', error: err?.error ?? String(res.status) }]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let held = '';
      let result: AskResult | null = null;
      let error: string | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        held += decoder.decode(value, { stream: !done });
        const lines = held.split('\n');
        held = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as AskResult | { type: 'status'; state: 'queued'; position: number } | { type: 'status'; state: 'thinking'; ms: number } | { error: string };
          if ('error' in msg) error = msg.error;
          else if (msg.type === 'status') { if (live.current === owner) setProgress(msg.state === 'queued' ? { state: 'queued', position: msg.position } : { state: 'working', ms: msg.ms }); }
          else result = msg;
        }
        if (done) break;
      }
      if (result && !urgentReply(result)) {
        const wait = MIN_REPLY_MS - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      const got = result;
      if (got) update(owner, (m) => [...m, { id: nextId++, from: 'astra', question, result: got, at: Date.now() }]);
      else update(owner, (m) => [...m, { id: nextId++, from: 'error', error: error ?? '' }]);
      if (got?.choosePerson && live.current === owner) setPicking(true);
    } catch {
      update(owner, (m) => [...m, { id: nextId++, from: 'error', error: '' }]);
    } finally {
      if (live.current === owner) setProgress(null);
      status.reload();
    }
  };

  /** The hub's `history`: the answered exchanges it would still remember, oldest first (phone AskThread.history). */
  const historyOf = (thread: Msg[]) => {
    const out: { question: string; route?: string; card?: string; understoodAs?: string }[] = [];
    let after = Date.now();
    for (const m of [...thread].reverse()) {
      if (m.from !== 'astra' || m.question === null) continue;
      if (after - m.at > MEMORY_MS) break;
      const item: (typeof out)[number] = { question: m.question.slice(0, 600), route: m.result.route };
      if (m.result.card) item.card = m.result.card.id;
      if (m.result.understoodAs) item.understoodAs = m.result.understoodAs.slice(0, 600);
      out.push(item);
      after = m.at;
      if (out.length === MAX_HISTORY) break;
    }
    return out.reverse();
  };

  const send = (raw: string) => {
    const question = raw.trim();
    box.current?.focus();
    if (!question || busy) return;
    setText('');
    const owner = asker;
    const history = historyOf(threads.get(owner) ?? []);
    update(owner, (m) => [...m, { id: nextId++, from: 'me', text: question }]);
    void request(owner, owner === SHARED ? { shared: true, question, lang } : { person: owner, question, lang, history }, question);
  };

  /** Done on a card's steps, the first time: the hub's check-in follows ("Are you feeling better?"). */
  const stepsDone = (msgId: number, card: string) => {
    const owner = asker;
    const first = (threads.get(owner) ?? []).some((m) => m.id === msgId && m.from === 'astra' && !m.stepsShown);
    setSteps(null);
    box.current?.focus();
    if (!first || owner === SHARED) return;
    update(owner, (m) => m.map((x) => (x.id === msgId && x.from === 'astra' ? { ...x, stepsShown: true } : x)));
    void request(owner, { person: owner, stepsDone: card, lang }, null);
  };

  const setHelp = (owner: string, msgId: number, help: Help | undefined) =>
    update(owner, (m) => m.map((x) => (x.id === msgId && x.from === 'astra' ? { ...x, help } : x)));
  const callHelp = async (msgId: number) => {
    const owner = asker;
    setHelp(owner, msgId, { state: 'calling' });
    try {
      const res = await fetch(`http://${hubAddress()}/api/ask/help`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person: owner, lang }) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; text?: string } | null;
      setHelp(owner, msgId, res.ok && body?.text ? { state: 'sent', text: body.text } : { state: 'failed' });
    } catch {
      setHelp(owner, msgId, { state: 'failed' });
    }
  };

  const clear = () => {
    threads.delete(asker);
    setMsgs([]);
    setOpenSources(new Set());
    box.current?.focus();
  };

  const st = status.data;
  const stateWord = busy ? s('ask.mark.working').toLowerCase() : st ? s(`ask.state.${st.state}`) : s('settings.loading').toLowerCase();
  const lastAstra = [...msgs].reverse().find((m) => m.from === 'astra')?.id;
  const examples = shared ? ['ask.exShared1', 'ask.exShared2'] : ['bench.ask.ex1', 'bench.ask.ex2', 'bench.ask.ex3'];

  const actions = (
    <div className="ask-head-actions">
      <div className="ask-as">
        <button type="button" className="ask-as-btn" aria-haspopup="true" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
          {s('ask.askingAsName', { name: shared ? s('ask.shared') : nameOf(asker) })} <span aria-hidden="true">▾</span>
        </button>
        {picking && (
          <div className="ask-picker frame" role="group" aria-label={s('ask.askingAs')}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setPicking(false); box.current?.focus(); } }}>
            <p className="ask-picker-title">{s('ask.askingAs')}</p>
            <ul>
              {crew.map((p) => (
                <li key={p.id}>
                  <button type="button" className="ask-pick" aria-pressed={asker === p.id} onClick={() => choose(p.id)}>
                    <span className="ask-av" aria-hidden="true">{p.name.slice(0, 1)}</span>{p.name}
                  </button>
                </li>
              ))}
              <li>
                <button type="button" className="ask-pick" aria-pressed={shared} onClick={() => choose(SHARED)}>
                  {s('ask.shared')}<span className="ask-pick-note">{s('ask.sharedOnly')}</span>
                </button>
              </li>
            </ul>
            <p className="quiet">{s('ask.sharedNote')}</p>
          </div>
        )}
      </div>
      {msgs.length > 0 && <button type="button" className="xlink ask-clear" onClick={clear}>{s('ask.clear')}</button>}
    </div>
  );

  return (
    <Sheet id="ask" title="Astra" s={s} onClose={onClose} focus={box} actions={actions}
      mark={<AstraMark size={30} activity={busy || st?.state === 'loading' ? 'working' : st?.state === 'ready' ? 'ready' : 'rest'} />}
      sub={<span className="status-word astra-status" data-status={st?.state === 'ready' ? 'live' : st?.state === 'unavailable' ? 'off' : undefined}>
        {stateWord}{st && st.waiting > 0 ? ` · ${s('bench.ask.waiting', { count: st.waiting })}` : ''}
      </span>}>
      {!shared && asker !== signedIn && <p className="quiet ask-seen">{s('ask.seenByOthers')}</p>}
      {st?.reason && st.state !== 'ready' && <p className="quiet ask-seen" lang="en">{st.reason}</p>}

      <div ref={log} className="ask-log" role="log" aria-live="polite" aria-label={s('ask.thread')} aria-busy={busy}>
        {msgs.length === 0 && (
          <div className="ask-empty">
            <div className="ask-chips" role="group" aria-label={s('ask.examples')}>
              {examples.map((key) => <button key={key} type="button" className="ask-chip" disabled={busy} onClick={() => send(s(key))}>{s(key)}</button>)}
            </div>
            {lang === 'pt' && <p className="quiet">{s('bench.ask.englishNote')}</p>}
          </div>
        )}
        {msgs.map((m) => {
          if (m.from === 'me') return <p key={m.id} className="ask-msg" data-me=""><span className="visually-hidden">{s('ask.you')}: </span>{m.text}</p>;
          if (m.from === 'error') return <div key={m.id} className="ask-msg"><HubSaid error={m.error} s={s} /></div>;
          return (
            <Reply key={m.id} m={m} newest={m.id === lastAstra && !busy} lang={lang} s={s} shared={shared}
              sourcesOpen={openSources.has(m.id)}
              onSources={() => setOpenSources((o) => { const n = new Set(o); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}
              onReply={send} onSteps={(card) => setSteps({ card: card.id, msg: m.id })}
              onHelp={(h) => (h ? setHelp(asker, m.id, h) : setHelp(asker, m.id, undefined))} onCall={() => void callHelp(m.id)}
              onChoose={() => setPicking(true)} />
          );
        })}
        {progress && (
          <div className="ask-msg ask-typing" role="status">
            <span className="ask-dots" aria-hidden="true"><i /><i /><i /></span>
            <span className="visually-hidden">
              {progress.state === 'queued' ? s('ask.queued', { position: progress.position }) : s('ask.typing')}
            </span>
          </div>
        )}
      </div>

      <form className="ask-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input ref={box} type="text" value={text} placeholder={s('ask.placeholder')} aria-label={s('ask.placeholder')}
          enterKeyHint="send" autoComplete="off" onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="ask-send" aria-label={s('ask.sendLabel')} disabled={busy || !text.trim()}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
        </button>
      </form>

      {steps && createPortal(
        <Steps key={steps.card} alert={null} cardId={steps.card} gravity={gravity} lang={lang} s={s} onClose={() => stepsDone(steps.msg, steps.card)} />,
        document.querySelector('main.hub') ?? document.body,
      )}
    </Sheet>
  );
}

interface ReplyProps {
  m: Extract<Msg, { from: 'astra' }>;
  /** The newest reply, with nothing pending: its chips are live. */
  newest: boolean;
  lang: Lang;
  s: S;
  shared: boolean;
  sourcesOpen: boolean;
  onSources: () => void;
  onReply: (text: string) => void;
  onSteps: (card: CardView) => void;
  onHelp: (help: Help | null) => void;
  onCall: () => void;
  onChoose: () => void;
}

/** One reply of Astra's: her bubble, the hub's facts and NASA's sources, the card's "Start help", and the reply chips. */
function Reply({ m, newest, lang, s, shared, sourcesOpen, onSources, onReply, onSteps, onHelp, onCall, onChoose }: ReplyProps) {
  const r = m.result;
  const who: Who = r.facts?.who ?? { name: '', pronouns: 'they', self: true };
  const facts = r.facts ? factLines(r.facts.items, who, s) : [];
  const hubWrote = r.by === 'hub' && facts.length > 0;
  // A fixed text has a key in the string table; the hub's sentences are in the screen's language; Astra writes English.
  // When the hub wrote the answer, its first sentence (or her lead) is the bubble and the rest are the facts block.
  const lead = hubWrote ? r.lead?.text ?? facts[0].text : null;
  const bubble = r.key ? s(r.key) : hubWrote ? lead ?? '' : r.text;
  const block = hubWrote ? (r.lead ? facts : facts.slice(1)) : r.route === 'crisis' || r.route === 'card' ? [] : facts;
  const leadLabels = hubWrote && !r.lead ? facts[0].labels : [];
  const passages: QuotedPassage[] = r.facts?.passages.length ? r.facts.passages : r.passages;
  const showSources = r.route !== 'crisis' && passages.length > 0;
  const pending = r.pendingQuestion;
  const helpDone = m.help?.state === 'sent';
  const options = pending ? (pending.options.length === 1 ? [{ value: 'yes', label: s('ask.yes') }, { value: 'no', label: s('ask.no') }] : pending.options) : [];
  const meta = [
    s(`ask.by.${r.by}`),
    r.urgent ? s('bench.ask.urgent') : null,
    r.route !== 'answer' && r.route !== 'fixed' ? s(`bench.ask.route.${r.route}`) : null,
    s('bench.ask.took', { seconds: (r.ms / 1000).toFixed(1) }),
  ].filter(Boolean).join(' · ');

  const helpChip = (label: string) => (
    <button type="button" className="ask-chip" disabled={!newest || !!m.help} onClick={() => onHelp({ state: 'confirm' })}>{label}</button>
  );

  return (
    <div className="ask-reply" data-urgent={r.urgent ? '' : undefined}>
      {bubble && (
        <p className="ask-msg" lang={r.key || hubWrote ? lang : 'en'}>
          <span className="visually-hidden">Astra: </span>{bubble}
          {leadLabels.length > 0 && <span className="xfact-labels">{leadLabels.map((l) => <span key={l} className="kind">{l}</span>)}</span>}
        </p>
      )}
      {r.aside && bubble !== r.text && <p className="quiet ask-aside">{r.aside}</p>}
      {r.understoodAs && <p className="quiet ask-aside">{r.understoodAs}</p>}

      {(block.length > 0 || showSources) && (
        <div className="ask-facts">
          {block.length > 0 && (
            <ul className="ask-facts-list" aria-label={s('bench.ask.facts')}>
              {block.map((f, i) => (
                <li key={i}>{f.text}{f.labels.length > 0 && <span className="xfact-labels">{f.labels.map((l) => <span key={l} className="kind">{l}</span>)}</span>}</li>
              ))}
            </ul>
          )}
          {showSources && (
            <>
              <button type="button" className="ask-sources" aria-expanded={sourcesOpen} onClick={onSources}>
                {passages.length === 1 ? s('ask.source') : s('ask.sources', { count: passages.length })}
                {!sourcesOpen && ` · ${[...new Set(passages.map((p) => p.name))].join(', ')}`}
              </button>
              {sourcesOpen && (
                <div className="ask-passages">
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
                </div>
              )}
            </>
          )}
        </div>
      )}

      {r.card ? (
        <>
          <p className="ask-msg" lang={r.card.lang}>{r.card.title}</p>
          <div className="ask-chips">
            {m.stepsShown
              ? <button type="button" className="ask-steps-shown" onClick={() => r.card && onSteps(r.card)}>{s('ask.stepsShown')}</button>
              : <button type="button" className="ask-chip" aria-label={s('ask.startHelpFor', { title: r.card.title })} onClick={() => r.card && onSteps(r.card)}>{s('ask.startHelp')}</button>}
          </div>
        </>
      ) : (r.route === 'card' || r.urgent) && r.route !== 'crisis' && <p className="quiet ask-aside">{s('ask.noCard')}</p>}

      {pending && options.length > 0 && !helpDone && (
        <div className="ask-chips" role="group" aria-label={pending.text}>
          {options.map((o) => (pending.purpose === 'offerHelp' && o.value === 'help'
            ? <span key={o.value}>{helpChip(o.label)}</span>
            : <button key={o.value} type="button" className="ask-chip" disabled={!newest} onClick={() => onReply(o.label)}>{o.label}</button>))}
        </div>
      )}
      {r.offerHelp && !pending && !helpDone && <div className="ask-chips">{helpChip(s('ask.callHelp'))}</div>}
      {m.help?.state === 'confirm' || m.help?.state === 'calling' ? (
        <div className="ask-confirm" role="group" aria-label={s('ask.callConfirm')}>
          <p className="ask-msg">{s('ask.callConfirm')}</p>
          <div className="ask-chips">
            <button type="button" className="ask-chip" disabled={m.help.state === 'calling'} onClick={() => onHelp(null)}>{s('ask.cancel')}</button>
            <button type="button" className="ask-chip" data-solid="" disabled={m.help.state === 'calling'} onClick={onCall}>{s('ask.call')}</button>
          </div>
        </div>
      ) : null}
      {m.help?.state === 'sent' && <p className="ask-msg"><span className="visually-hidden">Astra: </span>{m.help.text}</p>}
      {m.help?.state === 'failed' && <p className="quiet ask-aside">{s('ask.callFailed')}</p>}
      {r.choosePerson && shared && <div className="ask-chips"><button type="button" className="ask-chip" onClick={onChoose}>{s('ask.askingAs')} ▾</button></div>}

      <p className="ask-meta">
        {meta}
        {r.by === 'model' && lang === 'pt' && ` · ${s('ask.englishAnswer')}`}
        {r.source && ` · ${s('bench.ask.cites', { source: r.source })}`}
        {r.check?.discarded && ` · ${s('ask.discarded')}`}
      </p>
    </div>
  );
}
