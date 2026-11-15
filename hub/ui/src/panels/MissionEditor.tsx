// The editor for a place: the one the hub runs (a built-in place, whose edits
// the hub keeps over its file) or one the crew made (engine/custom.ts). Its
// name, where it is, the delay to Earth, its dates and its crew. Gravity is
// shown, never typed; the modules are listed but not editable. The rules run
// as you type, the same ones the hub checks on Save. Saving the place the hub
// runs restarts the hub with it.

import { useEffect, useRef, useState } from 'react';
import { placeNameOf, roomsOf } from '../../../engine/mission.ts';
import type { Body, Mission, Situation } from '../../../engine/mission.ts';
import { PRONOUNS, ROLE_KEYS, bodiesFor, changeProblems, changesOf, delayFor, gravityFor, situationsFor } from '../../../engine/custom.ts';
import type { CrewChange, MissionChanges, Problem } from '../../../engine/custom.ts';
import { pickNames } from '../../../engine/names.ts';
import { hasString } from '../../../engine/strings.ts';
import { HubSaid, call, clock, rememberAfterRestart } from './common.tsx';
import type { S } from './common.tsx';

export interface EditorProps {
  id: string;
  /** A place the crew made; otherwise a built-in place, edited in place. */
  custom: boolean;
  /** The place's name as the list shows it. */
  placeName: string;
  /** The name of the mission the layout comes from. */
  basedOnName: string;
  running: boolean;
  /** Production simulates no one: say so beside each person. */
  production: boolean;
  /** The recorded story is playing: nothing can be changed until it stops. */
  storyPlaying: boolean;
  s: S;
  onBack: () => void;
  onSaved: () => void;
}

type ServerProblems = { problems?: (Problem & { text: string })[]; hubProblems?: string[] };
interface Loaded { mission: Mission; edited?: boolean; pronounsChosen?: string[]; storyCrew?: boolean }
interface Saved { mission: Mission; edited?: boolean; restarting?: boolean; restartNeeded?: boolean }

let added = 0;

export function MissionEditor({ id, custom, placeName, basedOnName, running, production, storyPlaying, s, onBack, onSaved }: EditorProps) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [form, setForm] = useState<MissionChanges | null>(null);
  /** One key per person in the form: their id, or a made-up key for someone new. */
  const [keys, setKeys] = useState<string[]>([]);
  /** Keys of the people whose pronouns were chosen by hand: a new name leaves those alone. */
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [edited, setEdited] = useState(false);
  const [storyCrew, setStoryCrew] = useState(false);
  /** The destination as a string-table key, and its words: saved as the key while the words are untouched. */
  const [destination, setDestination] = useState<{ key: string; words: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState<{ ok: string } | { error: string; body?: ServerProblems } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const resetButton = useRef<HTMLButtonElement>(null);

  const fill = (m: Mission, chosenIds: string[]) => {
    setMission(m);
    const start = changesOf(m);
    const key = start.destination;
    const words = hasString(key) ? s(key) : key;
    setDestination(hasString(key) ? { key, words } : null);
    setForm({ ...start, destination: words });
    setKeys(start.crew.map((p) => p.id!));
    setChosen(new Set(chosenIds));
  };

  useEffect(() => {
    void call<Loaded>(`/api/missions/${id}`).then((r) => {
      if (!r.ok) return setFailed(r.error);
      fill(r.data.mission, r.data.pronounsChosen ?? []);
      setEdited(Boolean(r.data.edited));
      setStoryCrew(Boolean(r.data.storyCrew));
    });
  }, [id]);
  useEffect(() => { heading.current?.focus(); }, [mission === null]);
  useEffect(() => { if (asking) cancel.current?.focus(); }, [asking]);

  if (failed !== null) return <HubSaid error={failed} s={s} />;
  if (!mission || !form) return <p className="quiet" role="status">{s('settings.loading')}</p>;

  const problems = changeProblems(mission, form, { nameOptional: !custom });
  const at = (field: string) => problems.filter((p) => p.field === field);
  const set = (change: Partial<MissionChanges>) => { setForm({ ...form, ...change }); setSaid(null); };
  const setPerson = (i: number, change: Partial<CrewChange>) => set({ crew: form.crew.map((p, j) => (j === i ? { ...p, ...change } : p)) });
  const rooms = roomsOf(mission);
  const situations = situationsFor(mission.kind);
  /** Stations and bases stay put; a ship can change orbit or be in transit. */
  const placeFixed = mission.kind !== 'ship';
  const bodies = bodiesFor(form.where.situation);
  const delay = delayFor(form.where.body, form.where.situation);
  const blocked = storyPlaying;

  /** Moving the place: pick a body that fits, and a delay that fits it. */
  const moveTo = (body: Body | null, situation: Situation) => {
    const fits = bodiesFor(situation);
    const b = fits.includes(body) ? body : fits[0];
    const allowed = delayFor(b, situation);
    const d = 'fixed' in allowed ? allowed.fixed : Math.min(allowed.max, Math.max(allowed.min, form.delayToEarthSeconds));
    set({ where: { body: b, situation }, delayToEarthSeconds: d });
  };

  /** New first names for everyone; ids stay, so readings stay with the same person. */
  const shuffle = () => {
    const names = pickNames(form.crew.length, Date.now());
    setForm({ ...form, crew: form.crew.map((p, i) => ({ ...p, name: names[i] ?? p.name, pronouns: chosen.has(keys[i]) ? p.pronouns : 'they' })) });
    setSaid({ ok: s('custom.shuffled') });
  };
  const addPerson = () => {
    const [name] = pickNames(1, Date.now(), form.crew.map((p) => p.name));
    set({ crew: [...form.crew, { name: name ?? '', role: 'role.engineer', pronouns: 'they', quarters: rooms[0]?.id ?? '', work: rooms[0]?.id ?? '' }] });
    setKeys([...keys, `new-${++added}`]);
  };
  const removePerson = (i: number) => {
    set({ crew: form.crew.filter((_, j) => j !== i) });
    setKeys(keys.filter((_, j) => j !== i));
  };
  const choosePronouns = (i: number, pronouns: CrewChange['pronouns']) => {
    setPerson(i, { pronouns });
    setChosen(new Set([...chosen, keys[i]]));
  };

  const afterChange = (r: Saved, words: { restarting: string; next: string; done: string }) => {
    setEdited(Boolean(r.edited));
    if (r.restarting) {
      rememberAfterRestart('custom.restarted');
      setSaid({ ok: s(words.restarting) });
    } else {
      setSaid({ ok: s(r.restartNeeded ? words.next : words.done) });
    }
    onSaved();
  };

  const save = async () => {
    if (blocked) return;
    setSaving(true);
    const changes = { ...form, destination: destination && form.destination === destination.words ? destination.key : form.destination };
    const pronounsChosen = form.crew.flatMap((p, i) => (p.id && chosen.has(keys[i]) ? [p.id] : []));
    const r = await call<Saved>(`/api/missions/${id}`, { method: 'PUT', body: { changes, pronounsChosen } });
    setSaving(false);
    if (!r.ok) return setSaid({ error: r.error, body: r.body as ServerProblems });
    // Keep the form as typed; take the hub's ids for anyone new.
    setKeys(r.data.mission.crew.map((p) => p.id));
    setChosen(new Set([...pronounsChosen, ...r.data.mission.crew.filter((p, i) => !form.crew[i]?.id && chosen.has(keys[i])).map((p) => p.id)]));
    setMission(r.data.mission);
    setForm({ ...form, crew: form.crew.map((p, i) => ({ ...p, id: r.data.mission.crew[i]?.id ?? p.id })) });
    afterChange(r.data, { restarting: 'custom.savedRestarting', next: 'custom.savedNextStart', done: 'custom.saved' });
  };

  const reset = async () => {
    setAsking(false);
    const r = await call<Saved & { reset: boolean }>(`/api/missions/${id}/override`, { method: 'DELETE' });
    if (!r.ok) { setSaid({ error: r.error }); resetButton.current?.focus(); return; }
    fill(r.data.mission, []);
    afterChange(r.data, { restarting: 'custom.resetRestarting', next: 'custom.resetNextStart', done: 'custom.resetDone' });
    heading.current?.focus();
  };

  const gravity = gravityFor(form.where.body, form.where.situation);
  const errorOf = (field: string) => at(field).map((p) => s(p.key, p.vars)).join(' ');
  const fieldProps = (field: string) => {
    const error = errorOf(field);
    return error ? { 'aria-invalid': true as const, 'aria-describedby': `err-${field.replace(/\./g, '-')}` } : {};
  };
  const Err = ({ field }: { field: string }) => {
    const error = errorOf(field);
    return error ? <p id={`err-${field.replace(/\./g, '-')}`} className="xerror">{error}</p> : null;
  };
  // A ship's name says where it is: it follows the form as the place is moved.
  const builtInName = s(placeNameOf({ ...mission, where: form.where }));

  return (
    <form className="xeditor" noValidate onSubmit={(e) => { e.preventDefault(); if (!problems.length) void save(); }}>
      <div className="xeditor-head">
        <button type="button" className="xlink" onClick={onBack}>{s('custom.back')}</button>
        <h3 ref={heading} tabIndex={-1}>{form.nameText.trim() || (custom ? placeName || s('custom.title') : builtInName)}</h3>
        <p className="quiet">{s('custom.kind')}: {s(`custom.kind.${mission.kind}`)}</p>
      </div>
      {blocked && <p className="xsaid" data-bad="" role="status">{s('custom.storyBlocks')}</p>}

      <label className="xfield">
        <span className="label">{s('custom.name')}</span>
        <input type="text" value={form.nameText} maxLength={80} placeholder={custom ? undefined : builtInName}
          aria-describedby={custom ? undefined : 'name-note'} onChange={(e) => set({ nameText: e.target.value })} {...fieldProps('nameText')} />
        {!custom && <p id="name-note" className="quiet">{s('custom.nameBuiltIn', { name: builtInName })}</p>}
        <Err field="nameText" />
      </label>

      {/* A station or a base is where it is: only a ship can be moved. */}
      {placeFixed && (
        <div className="xfield">
          <span className="label" id="where-label">{s('custom.where')}</span>
          <p className="xvalue" aria-labelledby="where-label">{s(`custom.situation.${form.where.situation}`)} · {s(`custom.body.${form.where.body ?? 'none'}`)}</p>
        </div>
      )}
      {!placeFixed && <div className="xrow">
        <label className="xfield">
          <span className="label">{s('custom.situation')}</span>
          <select value={form.where.situation} disabled={situations.length < 2} onChange={(e) => moveTo(form.where.body, e.target.value as Situation)} {...fieldProps('situation')}>
            {situations.map((x) => <option key={x} value={x}>{s(`custom.situation.${x}`)}</option>)}
          </select>
        </label>
        <label className="xfield">
          <span className="label">{s('custom.body')}</span>
          <select value={form.where.body ?? 'none'} disabled={bodies.length < 2} onChange={(e) => moveTo(e.target.value === 'none' ? null : e.target.value as Body, form.where.situation)} {...fieldProps('body')}>
            {bodies.map((b) => <option key={b ?? 'none'} value={b ?? 'none'}>{s(`custom.body.${b ?? 'none'}`)}</option>)}
          </select>
        </label>
      </div>}
      <Err field="situation" />
      <Err field="body" />

      <div className="xfield">
        <span className="label" id="delay-label">{s('custom.delay')}</span>
        {'fixed' in delay ? (
          <p className="xvalue" aria-labelledby="delay-label">{s('custom.delayFixed', { value: delay.fixed.toLocaleString() })}</p>
        ) : (
          <>
            <div className="xslider">
              <input type="range" min={delay.min} max={delay.max} step={1} value={form.delayToEarthSeconds} aria-labelledby="delay-label"
                aria-valuetext={clock(form.delayToEarthSeconds)} onChange={(e) => set({ delayToEarthSeconds: Number(e.target.value) })} {...fieldProps('delay')} />
              <output className="xvalue">{clock(form.delayToEarthSeconds)}</output>
            </div>
            <p className="quiet">{s(form.where.body === 'mars' ? 'custom.delayMars' : 'custom.delayTransit')}</p>
          </>
        )}
        <Err field="delay" />
      </div>

      <div className="xfield">
        <span className="label">{s('custom.gravity')}</span>
        <p className="xvalue">{gravity === 0 ? `0 g, ${s('settings.weightless')}` : s('settings.gravity', { g: gravity })}</p>
        <p className="quiet">{s('custom.gravityNote')}</p>
      </div>

      <div className="xrow">
        <label className="xfield">
          <span className="label">{s('custom.start')}</span>
          <input type="date" value={form.missionStart} onChange={(e) => set({ missionStart: e.target.value })} {...fieldProps('missionStart')} />
          <Err field="missionStart" />
        </label>
        <label className="xfield">
          <span className="label">{s('custom.days')}</span>
          <input type="number" inputMode="numeric" min={1} max={3650} step={1} value={Number.isFinite(form.plannedDays) ? form.plannedDays : ''}
            onChange={(e) => set({ plannedDays: e.target.value === '' ? Number.NaN : Number(e.target.value) })} {...fieldProps('plannedDays')} />
          <Err field="plannedDays" />
        </label>
      </div>

      {/* Only a ship is going somewhere. */}
      {mission.kind === 'ship' && <label className="xfield">
        <span className="label">{s('custom.destination')}</span>
        <input type="text" value={form.destination} maxLength={120} onChange={(e) => set({ destination: e.target.value })} {...fieldProps('destination')} />
        <Err field="destination" />
      </label>}

      <fieldset className="xcrew rule">
        <legend className="label">{s('custom.crew')}</legend>
        {storyCrew && <p className="quiet">{s('custom.storyCrew')}</p>}
        <p className="quiet" id="names-note">{s('custom.namesNote')}</p>
        <div className="actions">
          <button type="button" className="btn" aria-describedby="names-note" onClick={shuffle}>{s('custom.shuffle')}</button>
        </div>
        <Err field="crew" />
        {form.crew.map((p, i) => {
          const n = i + 1;
          const f = `crew.${i}`;
          return (
            <div key={keys[i] ?? `new-${i}`} className="xperson" role="group" aria-label={s('custom.person', { n })}>
              <div className="xperson-head">
                <span>{s('custom.person', { n })}</span>
                <button type="button" className="xlink xremove" aria-label={s('custom.removePerson', { n })} onClick={() => removePerson(i)}>{s('custom.remove')}</button>
              </div>
              <label className="xfield">
                <span className="label">{s('custom.name')}</span>
                <input type="text" value={p.name} maxLength={60} onChange={(e) => setPerson(i, { name: e.target.value })} {...fieldProps(`${f}.name`)} />
              </label>
              <div className="xrow">
                <label className="xfield">
                  <span className="label">{s('custom.role')}</span>
                  <select value={p.role} onChange={(e) => setPerson(i, { role: e.target.value })} {...fieldProps(`${f}.role`)}>
                    {!ROLE_KEYS.includes(p.role) && <option value={p.role} disabled>{p.role}</option>}
                    {ROLE_KEYS.map((r) => <option key={r} value={r}>{s(r)}</option>)}
                  </select>
                </label>
                <label className="xfield">
                  <span className="label">{s('custom.pronouns')}</span>
                  <select value={p.pronouns} onChange={(e) => choosePronouns(i, e.target.value as CrewChange['pronouns'])}>
                    {PRONOUNS.map((x) => <option key={x} value={x}>{s(`custom.pronouns.${x}`)}</option>)}
                  </select>
                </label>
              </div>
              <div className="xrow">
                <label className="xfield">
                  <span className="label">{s('custom.quarters')}</span>
                  <select value={p.quarters} onChange={(e) => setPerson(i, { quarters: e.target.value })} {...fieldProps(`${f}.quarters`)}>
                    {!rooms.some((r) => r.id === p.quarters) && <option value={p.quarters} disabled>{p.quarters}</option>}
                    {rooms.map((r) => <option key={r.id} value={r.id}>{s(r.name)}</option>)}
                  </select>
                </label>
                <label className="xfield">
                  <span className="label">{s('custom.work')}</span>
                  <select value={p.work} onChange={(e) => setPerson(i, { work: e.target.value })} {...fieldProps(`${f}.work`)}>
                    {!rooms.some((r) => r.id === p.work) && <option value={p.work} disabled>{p.work}</option>}
                    {rooms.map((r) => <option key={r.id} value={r.id}>{s(r.name)}</option>)}
                  </select>
                </label>
              </div>
              {[`${f}`, `${f}.name`, `${f}.role`, `${f}.pronouns`, `${f}.quarters`, `${f}.work`].map((field) => <Err key={field} field={field} />)}
              {production && <p className="quiet">{s('custom.noSimProduction')}</p>}
            </div>
          );
        })}
        <div className="actions">
          <button type="button" className="btn" disabled={form.crew.length >= 8} onClick={addPerson}>{s('custom.addPerson')}</button>
        </div>
      </fieldset>

      <div className="rule">
        <h4 className="label">{s('custom.modules')}</h4>
        <p className="quiet">{s('custom.modulesNote', { name: basedOnName })}</p>
        <ul className="xrooms">{rooms.map((r) => <li key={r.id}>{s(r.name)}</li>)}</ul>
      </div>

      <div className="rule xsave">
        {problems.length > 0 && (
          <div className="xerror" id="editor-problems">
            <p>{s('custom.fix')}</p>
            <ul>{problems.map((p, i) => <li key={i}>{s(p.key, p.vars)}</li>)}</ul>
          </div>
        )}
        <div className="actions">
          <button type="submit" className="btn btn-solid" aria-disabled={problems.length > 0 || saving || blocked} aria-describedby={problems.length ? 'editor-problems' : undefined}>
            {s(saving ? 'custom.saving' : 'custom.save')}
          </button>
          {!custom && edited && !asking && (
            <button ref={resetButton} type="button" className="btn" aria-disabled={blocked} onClick={() => { if (!blocked) { setSaid(null); setAsking(true); } }}>{s('custom.reset')}</button>
          )}
        </div>
        {asking && (
          <div className="xconfirm" role="group" aria-labelledby="reset-ask">
            <p id="reset-ask">{s('custom.resetAsk')}{storyCrew ? '' : ` ${s('custom.resetNames')}`}</p>
            <div className="actions">
              <button type="button" className="btn" data-danger="" onClick={() => void reset()}>{s('custom.resetSure')}</button>
              <button ref={cancel} type="button" className="btn" onClick={() => { setAsking(false); setTimeout(() => resetButton.current?.focus()); }}>{s('custom.cancel')}</button>
            </div>
          </div>
        )}
        <div aria-live="polite">
          {said && ('ok' in said ? <p className="xsaid">{said.ok}</p> : (
            <>
              {said.body?.problems?.length ? <ul className="xerror">{said.body.problems.map((p, i) => <li key={i}>{s(p.key, p.vars)}</li>)}</ul> : <HubSaid error={said.error} s={s} />}
              {said.body?.hubProblems?.length ? <ul className="quiet" lang="en">{said.body.hubProblems.map((p, i) => <li key={i}>{p}</li>)}</ul> : null}
            </>
          ))}
        </div>
      </div>
    </form>
  );
}
