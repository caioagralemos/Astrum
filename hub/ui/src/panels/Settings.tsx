// Settings: the place the hub runs (and places the crew made from one), the
// language, the connection, and in demo mode the tools for the recorded story.
// Switching the place restarts the hub; the screens reconnect by themselves.
// The running place is edited in place ("Edit this place"): its edits are kept
// by the hub over the built-in file, and saving restarts the hub with them.
// On a crewmate's phone it shows the language and the connection only: a
// phone never switches the place or starts the story.

import { useEffect, useState } from 'react';
import type { World } from '../data.ts';
import { hubAddress } from '../data.ts';
import { hasString } from '../../../engine/strings.ts';
import type { Lang } from '../../../engine/strings.ts';
import { changesOf } from '../../../engine/custom.ts';
import type { Mission } from '../../../engine/mission.ts';
import { soundOn, setSoundOn, testTone } from '../sound.ts';
import { Sheet } from './Sheet.tsx';
import { MissionEditor } from './MissionEditor.tsx';
import { boardName } from '../onboarding/boardName.ts';
import { HubSaid, call, delayShort, takeAfterRestart, usePoll, viewerOf } from './common.tsx';
import type { ModelStatus, S } from './common.tsx';

interface Entry {
  id: string;
  kind: 'ship' | 'station' | 'base' | null;
  name: string | null;
  nameText?: string | null;
  basedOn?: string | null;
  custom?: boolean;
  edited?: boolean;
  overrideProblems?: string[];
  where: { body: 'earth' | 'moon' | 'mars' | null; situation: 'orbit' | 'transit' | 'surface' } | null;
  gravity: number | null;
  delayToEarthSeconds: number | null;
  rooms: number;
  problems: string[];
}
interface MissionList { running: string | null; locked: string | null; supervised: boolean; mode: 'demo' | 'production'; missions: Entry[] }
interface StoryStatus { playing: string | null }

const STORY = 'reyes-night';

/**
 * "Make my own from this one": copies a place into a new one the crew edits.
 * Hidden for now (places are edited in place); the hub's routes for it still
 * work, for the app to bring it back by turning this on.
 */
export const ALLOW_COPIES = false;

export interface SettingsProps {
  world: World;
  lang: Lang;
  onLang: (lang: Lang) => void;
  onSetup?: () => void;
  s: S;
  onClose: () => void;
}

export function SettingsPanel({ world, lang, onLang, onSetup, s, onClose }: SettingsProps) {
  const { viewer } = viewerOf();
  const crewScreen = viewer !== null;
  const list = usePoll<MissionList>(crewScreen ? null : '/api/missions');
  const model = usePoll<ModelStatus>('/api/ask/status', 5000);
  const demo = !crewScreen && list.data?.mode === 'demo';
  // The real app: one mission, set up once. No list of places to switch between; one button erases everything.
  const real = !crewScreen && list.data?.mode === 'production';
  const reset = async () => {
    if (sure !== 'reset') { setSure('reset'); return; }
    setSure(null);
    const r = await call('/api/reset', { method: 'POST', body: { confirm: 'erase everything' } });
    if (!r.ok) setSaid({ error: r.error });
  };
  const story = usePoll<StoryStatus>(demo ? '/api/scenario' : null, 3000);
  const [editing, setEditing] = useState<string | null>(null);
  const [said, setSaid] = useState<{ ok: string } | { error: string } | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const [sound, setSound] = useState(soundOn);
  // Back after a restart this panel asked for: say how it went.
  useEffect(() => { const key = takeAfterRestart(); if (key) setSaid({ ok: s(key) }); }, []);

  const nameOf = (e: Entry | undefined) => (e ? e.nameText || (e.name ? s(e.name) : e.id) : '');
  const entries = list.data?.missions ?? [];
  const byId = (id: string | null | undefined) => entries.find((e) => e.id === id);

  const select = async (id: string) => {
    setSaid(null);
    const r = await call<{ restarting: boolean }>('/api/missions/select', { method: 'POST', body: { id } });
    setSaid(r.ok ? { ok: s('settings.restarting', { place: nameOf(byId(id)) }) } : { error: r.error });
  };
  const makeOwn = async (basedOn: string) => {
    setSaid(null);
    // Named in the screen's language from the start; the editor then opens on the copy.
    const base = await call<{ mission: Mission }>(`/api/missions/${basedOn}`);
    if (!base.ok) return setSaid({ error: base.error });
    const c = changesOf(base.data.mission);
    const changes = { ...c, nameText: s('custom.copyName', { name: nameOf(byId(basedOn)) }), destination: hasString(c.destination) ? s(c.destination) : c.destination };
    const r = await call<{ id: string }>('/api/missions', { method: 'POST', body: { basedOn, changes } });
    if (!r.ok) return setSaid({ error: r.error });
    list.reload();
    setEditing(r.data.id);
  };
  const remove = async (e: Entry) => {
    if (sure !== e.id) return setSure(e.id);
    setSure(null);
    const r = await call(`/api/missions/${e.id}`, { method: 'DELETE' });
    setSaid(r.ok ? { ok: s('settings.deleted', { name: nameOf(e) }) } : { error: r.error });
    list.reload();
  };
  const startStory = async (start: boolean) => {
    const r = await call(start ? '/api/scenario/start' : '/api/scenario/stop', { method: 'POST', body: start ? { id: STORY } : undefined });
    if (!r.ok) setSaid({ error: r.error });
    story.reload();
  };

  const status = world.status;
  const off = status === 'offline';
  const boards = world.sources.filter((src) => src.id.startsWith('chip:'));
  const benchHref = `./bench.html${new URLSearchParams(location.search).has('hub') ? `?hub=${encodeURIComponent(hubAddress())}` : ''}`;
  const editingEntry = byId(editing);

  return (
    <Sheet id="settings" title={s('settings.title')} s={s} onClose={onClose}>
      {editing && editingEntry ? (
        <MissionEditor id={editing} custom={Boolean(editingEntry.custom)} placeName={nameOf(editingEntry)}
          basedOnName={editingEntry.custom ? nameOf(byId(editingEntry.basedOn)) : nameOf(editingEntry)}
          running={list.data?.running === editing} production={list.data?.mode === 'production'} storyPlaying={Boolean(story.data?.playing)} s={s}
          onBack={() => { setEditing(null); list.reload(); }} onSaved={() => list.reload()} />
      ) : (
        <>
          {!crewScreen && !real && (
            <div className="rule xplaces">
              <h3 className="label">{s('settings.place')}</h3>
              <p className="quiet xnote">{s('settings.placeNote')}</p>
              {list.data?.locked && <p className="quiet">{s('settings.locked')} <span lang="en">{list.data.locked}</span></p>}
              <div aria-live="polite">{said && ('ok' in said ? <p className="xsaid">{said.ok}</p> : <HubSaid error={said.error} s={s} />)}</div>
              {list.error !== null && !list.data && <HubSaid error={list.error} s={s} />}
              {!list.data && list.error === null && <p className="quiet" role="status">{s('settings.loading')}</p>}
              <ul className="xplace-list">
                {entries.map((e) => {
                  const running = list.data?.running === e.id;
                  const broken = e.problems.length > 0;
                  return (
                    <li key={e.id} className="xplace" aria-current={running ? 'true' : undefined}>
                      <div className="xplace-head">
                        <h4>{nameOf(e)}</h4>
                        {running && <span className="status-word" data-status="live">{s('settings.running')}</span>}
                      </div>
                      {broken ? <p className="quiet">{s('settings.cannotRun')}</p> : (
                        <p className="xplace-facts">
                          {e.kind && <span>{s(`custom.kind.${e.kind}`)}</span>}
                          {e.where && <span>{s(`custom.situation.${e.where.situation}`)}{e.where.body ? `, ${s(`custom.body.${e.where.body}`)}` : ''}</span>}
                          {e.delayToEarthSeconds !== null && <span>{s('settings.toEarth', { time: delayShort(e.delayToEarthSeconds) })}</span>}
                          {e.gravity !== null && <span>{e.gravity === 0 ? s('settings.weightless') : s('settings.gravity', { g: e.gravity })}</span>}
                          <span>{s('settings.rooms', { count: e.rooms })}</span>
                        </p>
                      )}
                      {e.custom && <p className="quiet">{s('settings.made', { name: nameOf(byId(e.basedOn)) })}</p>}
                      {e.edited && !e.overrideProblems?.length && <p className="quiet">{s('settings.edited')}</p>}
                      {e.overrideProblems?.length ? <p className="quiet" data-bad="">{s('settings.overrideIgnored')} <span lang="en">{e.overrideProblems.join(' ')}</span></p> : null}
                      {!broken && (
                        <div className="xplace-actions">
                          {!running && <button type="button" className="btn" disabled={Boolean(list.data?.locked)} onClick={() => void select(e.id)}>{s('settings.switch')}</button>}
                          {running && <button type="button" className="btn" onClick={() => { setSure(null); setSaid(null); setEditing(e.id); }}>{s('settings.editPlace')}</button>}
                          {ALLOW_COPIES && <button type="button" className="xlink" onClick={() => void makeOwn(e.id)}>{s('settings.makeOwn')}</button>}
                          {e.custom && !running && <button type="button" className="xlink" onClick={() => { setSure(null); setEditing(e.id); }}>{s('settings.edit')}</button>}
                          {e.custom && !running && (
                            <button type="button" className="xlink" data-danger={sure === e.id ? '' : undefined} onClick={() => void remove(e)}>
                              {s(sure === e.id ? 'settings.deleteSure' : 'settings.delete')}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="rule">
            <h3 className="label" id="settings-lang">{s('top.language')}</h3>
            <div className="choice" role="group" aria-labelledby="settings-lang">
              {(['en', 'pt'] as const).map((code) => (
                <button key={code} type="button" lang={code} aria-pressed={lang === code} onClick={() => onLang(code)}>
                  {code === 'en' ? 'English' : 'Português'}
                </button>
              ))}
            </div>
          </div>

          <div className="rule">
            <h3 className="label">{s('settings.sound')}</h3>
            <div className="actions">
              <label className="xswitch">
                <input type="checkbox" role="switch" checked={sound} onChange={(e) => { setSoundOn(e.target.checked); setSound(e.target.checked); }} />
                {' '}{s('settings.soundTones')}
              </label>
              <button type="button" className="btn" disabled={!sound} onClick={() => testTone('emergency')}>{s('settings.soundTestEmergency')}</button>
              {' '}<button type="button" className="btn" disabled={!sound} onClick={() => testTone('earth')}>{s('settings.soundTestEarth')}</button>
            </div>
          </div>

          {real && (
            <div className="rule">
              <h3 className="label">{s('reset.title')}</h3>
              <p className="quiet">{s('reset.note')}</p>
              <div aria-live="polite">{said && 'error' in said && <HubSaid error={said.error} s={s} />}</div>
              <div className="actions">
                <button type="button" className="btn" data-danger={sure === 'reset' ? '' : undefined} onClick={() => void reset()}>{s(sure === 'reset' ? 'reset.sure' : 'reset.button')}</button>
                {sure === 'reset' && <>{' '}<button type="button" className="btn" onClick={() => setSure(null)}>{s('setup.cancel')}</button></>}
              </div>
            </div>
          )}

          {onSetup && !real && (
            <div className="rule">
              <h3 className="label">{s('setup.again.title')}</h3>
              <p className="quiet">{s('setup.again.note')}</p>
              <div className="actions"><button type="button" className="btn" onClick={onSetup}>{s('setup.again')}</button></div>
            </div>
          )}

          <div className="rule">
            <h3 className="label">{s('top.link')}</h3>
            <p><span className="status-word" data-status={off ? 'off' : 'live'}>{s(off ? 'hub.offline' : status === 'replay' ? 'top.link.replay' : 'top.link.live')}</span></p>
            <dl className="xfacts-list">
              <div><dt>{s('settings.address')}</dt><dd className="mono">{hubAddress()}</dd></div>
              <div>
                <dt>{s('settings.board')}</dt>
                <dd>
                  {boards.length === 0 ? s('settings.boardNone') : boards.map((b) => (
                    <span key={b.id} className="xboard">
                      {world.profile && <>{boardName(b, world.sources, world.profile, s)} · </>}
                      <span className="status-word" data-status={b.connected ? 'live' : 'off'}>{s(b.connected ? 'source.connected' : 'source.disconnected')}</span>
                      {b.connected && <> · {b.missing.length ? s('source.missing', { list: b.missing.map((k) => s(`signal.${k}`)).join(', ') }) : s('settings.allAnswering')}</>}
                    </span>
                  ))}
                </dd>
              </div>
              <div>
                <dt>{s('ask.name')}</dt>
                <dd>
                  {model.data ? (
                    <>
                      <span className="status-word" data-status={model.data.state === 'ready' ? 'live' : model.data.state === 'unavailable' ? 'off' : undefined}>{s(`ask.state.${model.data.state}`)}</span>
                      {model.data.reason && model.data.state !== 'ready' && <> · <span lang="en">{model.data.reason}</span></>}
                    </>
                  ) : s('settings.loading')}
                </dd>
              </div>
            </dl>
          </div>

          {demo && (
            <div className="rule">
              <h3 className="label">{s('settings.demo')}</h3>
              <p className="quiet xwarn">{s('bench.st.warning')}</p>
              <p role="status" className="xvalue-sm">{story.data?.playing ? s('settings.storyPlaying') : s('settings.storyIdle')}</p>
              <div className="actions">
                {story.data?.playing
                  ? <button type="button" className="btn" onClick={() => void startStory(false)}>{s('settings.storyStop')}</button>
                  : <button type="button" className="btn" onClick={() => void startStory(true)}>{s('settings.storyStart')}</button>}
                <a className="btn xbtn-link" href={benchHref} target="_blank" rel="noreferrer">{s('settings.bench')}</a>
              </div>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
