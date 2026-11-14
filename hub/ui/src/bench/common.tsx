// What every panel of the workbench shares: talking to the hub, naming
// sources and signals in words, and the small pieces each panel repeats.

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { hubAddress } from '../data.ts';
import type { World } from '../data.ts';
import { hasString, t } from '../../../engine/strings.ts';
import type { Lang } from '../../../engine/strings.ts';
import type { Kind, Profile } from '../../../engine/types.ts';

export type S = (key: string, vars?: Record<string, string | number>) => string;

/** What every panel gets. `me` is who is asking and whose data is shown. */
export interface PanelProps {
  world: World;
  profile: Profile;
  me: string;
  lang: Lang;
  s: S;
}

export function makeS(lang: Lang): S {
  return (key, vars) => t(key, lang, vars);
}

export function api(path: string): string {
  return `http://${hubAddress()}${path}`;
}

/** On failure, `body` is whatever the hub sent with its error (problems, refusals). */
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string; body?: unknown };

/** One request to the hub. Never throws: a failure comes back as words. */
export async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<Reply<T>> {
  try {
    const res = await fetch(api(path), {
      method: init?.method ?? 'GET',
      headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const d = data as { error?: string; problems?: string[] } | null;
      return { ok: false, error: d?.error ?? `${res.status}`, body: data };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: '' };
  }
}

/** A GET kept fresh: loads now, again every `everyMs` (0: never) and on `reload()`. */
export function usePoll<T>(path: string | null, everyMs = 0): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!path) return;
    let live = true;
    const load = () => void call<T>(path).then((r) => {
      if (!live) return;
      if (r.ok) { setData(r.data); setError(null); } else setError(r.error);
    });
    load();
    const timer = everyMs ? setInterval(load, everyMs) : undefined;
    return () => { live = false; clearInterval(timer); };
  }, [path, everyMs, tick]);
  return { data, error, reload };
}

/** The words for a failed request. */
export function failure(s: S, error: string): string {
  return error ? s('bench.error', { error }) : s('bench.unreachable');
}

export function personName(profile: Profile, id: string): string {
  return profile.crew.find((p) => p.id === id)?.name ?? id;
}

export function roomName(profile: Profile, s: S, id: string | null | undefined): string {
  if (!id) return '';
  const room = profile.rooms.find((r) => r.id === id);
  return room ? s(room.name) : id;
}

/** A source id in plain words: never "nasa:osdr-rr1" on its own. */
export function sourceName(source: string, profile: Profile, s: S, sensorNames: Record<string, string> = {}): string {
  const [head, rest = ''] = source.split(/:(.*)/s);
  if (head === 'chip') return s('bench.source.chip');
  if (source === 'nasa:osdr-rr1') return s('bench.source.nasaIss');
  if (source === 'nasa:osdr-inspiration4') return s('bench.source.nasaI4');
  if (head === 'sim') return s('bench.source.simulated');
  if (head === 'phone') return s('bench.source.phone', { name: personName(profile, rest) });
  if (head === 'checkin') return s('bench.source.checkin', { name: personName(profile, rest) });
  if (head === 'sensor') return s('bench.source.sensor', { name: sensorNames[rest] ?? rest });
  if (source === 'istat:typed') return s('bench.source.typed');
  return s('bench.source.other', { id: source });
}

/** A signal in words: the string table first, then a registered sensor's name, then the key made readable. */
export function signalName(signal: string, s: S, custom: Record<string, string> = {}): string {
  if (hasString(`signal.${signal}`)) return s(`signal.${signal}`);
  if (hasString(`bench.signal.${signal}`)) return s(`bench.signal.${signal}`);
  if (custom[signal]) return custom[signal];
  return signal.replace(/^(checkin|blood)\./, '').replace(/[._]+/g, ' ');
}

export function kindName(kind: Kind | 'hub' | null | undefined, s: S): string {
  if (!kind) return '';
  return kind === 'hub' ? s('bench.labelHub') : s(`kind.${kind}`);
}

export function num(value: number, digits = 2): string {
  return String(Number(value.toFixed(digits)));
}

export const hours = (ms: number) => num(ms / 3600_000, 1);

/** "m:ss", or "h:mm:ss" past an hour. */
export function clock(seconds: number): string {
  const sec = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function ago(t: number, now: number, s: S): string {
  const sec = Math.max(0, Math.round((now - t) / 1000));
  return sec < 120 ? s('bench.agoSeconds', { seconds: sec }) : s('bench.agoMinutes', { minutes: Math.round(sec / 60) });
}

export function timeOf(t: number, lang: Lang): string {
  return new Date(t).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** One panel of the page: a titled section the nav can jump to. */
export function Panel({ id, title, children, wide }: { id: string; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section id={id} className={wide ? 'panel wide' : 'panel'} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
    </section>
  );
}

/** A label tag beside a value: "Replayed", "Measured"... always in words. */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="kind-tag">{children}</span>;
}

/** The result of an action, said in words and announced. */
export function Said({ text, bad }: { text: string | null; bad?: boolean }) {
  return <p className={bad ? 'said bad' : 'said'} role="status" aria-live="polite">{text ?? ''}</p>;
}

/** The hub's own English sentences (problems, notices, reasons), marked as such. */
export function HubWords({ lines, s }: { lines: string[]; s: S }) {
  if (!lines.length) return null;
  return (
    <div className="hubwords">
      <p className="muted">{s('bench.hubWords')}</p>
      <ul>{lines.map((l, i) => <li key={i} lang="en">{l}</li>)}</ul>
    </div>
  );
}
