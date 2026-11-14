// 8. The story: start and stop "Reyes's night" on the hub (GET /api/scenario,
// POST /api/scenario/start and /stop), and the replay that runs in the browser alone.

import { useState } from 'react';
import { call, failure, Panel, Said, timeOf, usePoll } from './common.tsx';
import type { PanelProps } from './common.tsx';

interface ScenarioStatus { playing: string | null; at: number | null; startedAt: number | null; available: string[] }

const ID = 'reyes-night';

export function Story({ world, lang, s }: PanelProps) {
  const { data, error, reload } = usePoll<ScenarioStatus>('/api/scenario', 3000);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const name = s(`scenario.${ID}`);

  const start = async () => {
    const r = await call('/api/scenario/start', { method: 'POST', body: { id: ID } });
    setSaid(r.ok ? { text: s('bench.sent'), bad: false } : { text: failure(s, r.error), bad: true });
    reload();
  };
  const stop = async () => {
    const r = await call<{ stopped: boolean }>('/api/scenario/stop', { method: 'POST' });
    setSaid(r.ok ? { text: s(r.data.stopped ? 'bench.st.stopped' : 'bench.st.notPlaying'), bad: false } : { text: failure(s, r.error), bad: true });
    reload();
  };
  // The story's clock, as the screens show it.
  const at = world.scenario?.at ?? data?.at ?? null;
  const storyTime = at === null ? '' : new Date(at).toLocaleTimeString(lang === 'pt' ? 'pt-BR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <Panel id="story" title={s('bench.st.title')}>
      <p className="warning"><strong>{s('bench.st.warning')}</strong></p>
      {error !== null && <p className="said bad">{failure(s, error)}</p>}
      <p role="status">
        {!data ? s('bench.loading')
          : data.playing ? s('bench.st.playing', { name: s(`scenario.${data.playing}`), time: storyTime })
            : s('bench.st.idle')}
        {data?.startedAt && <> · {s('bench.st.startedAt', { time: timeOf(data.startedAt, lang) })}</>}
      </p>
      {data && <p className="muted">{s('bench.st.available', { list: data.available.map((id) => s(`scenario.${id}`)).join(', ') || s('bench.none') })}</p>}
      <div className="row">
        <button type="button" disabled={!!data?.playing} onClick={() => void start()}>{s('bench.st.start', { name })}</button>
        <button type="button" disabled={!data?.playing} onClick={() => void stop()}>{s('bench.st.stop')}</button>
      </div>
      {said && <Said text={said.text} bad={said.bad} />}
      <p><a href={`./?replay=scenario/${ID}.json`}>{s('bench.st.replay')}</a></p>
    </Panel>
  );
}
