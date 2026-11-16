// The page's two sounds, synthesised with the Web Audio API (no files): the
// emergency tone, repeated gently while the "Emergency" screen waits for a tap,
// and one soft tone when a new reply from Earth arrives. Nothing else on the page
// makes a sound. Sound is never the only cue: the screens show everything.
// Browsers keep audio locked until a gesture: the first pointer or key event on
// the page creates (or resumes) the one AudioContext. A tone never starts later
// to make up for a locked moment. Muted in Settings, nothing plays.

import { useEffect, useRef, useState } from 'react';

const KEY = 'astrum.sound';

export function soundOn(): boolean {
  // The recorded web demo always has its sound (a mute left from an earlier visit does not carry over).
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('replay')) return true;
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setSoundOn(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* not saved, still applies until reload */ }
  if (!on) stopAll();
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const voices = new Set<() => void>();

/** Audio can play now (a gesture has unlocked it). */
export function audioReady(): boolean {
  return ctx?.state === 'running';
}

function unlock() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state !== 'running') void ctx.resume().then(release, () => { /* still locked: the next gesture tries again */ });
    else release();
  } catch { /* no Web Audio: the page stays silent */ }
}

const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'] as const;
function release() {
  if (ctx?.state !== 'running') return;
  for (const e of GESTURES) window.removeEventListener(e, unlock, true);
}
if (typeof window !== 'undefined') for (const e of GESTURES) window.addEventListener(e, unlock, true);

interface Note { f: number; at: number; peak: number; tail: number }
type Partials = [ratio: number, gain: number][];

/** The emergency tone: a rising A-major chime, A5 C#6 E6, 0.2 s apart, sine partials, a 12 ms attack and a short tail (audible about 1.3 s). */
const EMERGENCY: Note[] = [
  { f: 880.0, at: 0, peak: 0.5, tail: 0.9 },
  { f: 1108.73, at: 0.2, peak: 0.5, tail: 0.9 },
  { f: 1318.51, at: 0.4, peak: 0.52, tail: 1.2 },
];
const EMERGENCY_PARTIALS: Partials = [[1, 1], [2, 0.22], [3, 0.06]];
/** Repeated, start to start, while the screen waits. */
export const EMERGENCY_EVERY_MS = 4000;

/** Earth's reply: two soft, lower notes, E5 then B4, 0.16 s apart (about 1 s). */
const EARTH: Note[] = [
  { f: 659.25, at: 0, peak: 0.18, tail: 0.7 },
  { f: 493.88, at: 0.16, peak: 0.18, tail: 0.9 },
];
const EARTH_PARTIALS: Partials = [[1, 1], [2, 0.12]];

const ATTACK = 0.012;

/** Schedules a tone on any context's clock; returns how to stop it early (a 30 ms fade, no click). */
function schedule(c: BaseAudioContext, dest: AudioNode, notes: Note[], partials: Partials, when: number): () => void {
  const voice = c.createGain();
  voice.connect(dest);
  const oscs: OscillatorNode[] = [];
  let end = when;
  for (const n of notes) {
    const t0 = when + n.at;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(n.peak, t0 + ATTACK);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + ATTACK + n.tail);
    env.gain.linearRampToValueAtTime(0, t0 + ATTACK + n.tail + 0.02);
    env.connect(voice);
    const stopAt = t0 + ATTACK + n.tail + 0.05;
    end = Math.max(end, stopAt);
    for (const [ratio, g] of partials) {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = n.f * ratio;
      const pg = c.createGain();
      pg.gain.value = g;
      osc.connect(pg).connect(env);
      osc.start(t0);
      osc.stop(stopAt);
      oscs.push(osc);
    }
  }
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    voices.delete(stop);
    const now = c.currentTime;
    voice.gain.cancelScheduledValues(now);
    voice.gain.setValueAtTime(voice.gain.value, now);
    voice.gain.linearRampToValueAtTime(0, now + 0.03);
    for (const o of oscs) { try { o.stop(now + 0.05); } catch { /* already stopped */ } }
  };
  oscs[oscs.length - 1]?.addEventListener('ended', () => { voices.delete(stop); done = true; voice.disconnect(); });
  voices.add(stop);
  return stop;
}

/** For an offline render (verification): the emergency tone once into `dest` at `when`. */
export function scheduleEmergency(c: BaseAudioContext, dest: AudioNode, when = 0) {
  return schedule(c, dest, EMERGENCY, EMERGENCY_PARTIALS, when);
}

function play(notes: Note[], partials: Partials): () => void {
  if (!soundOn() || !ctx || !master || ctx.state !== 'running') return () => {};
  return schedule(ctx, master, notes, partials, ctx.currentTime + 0.02);
}

function stopAll() {
  for (const stop of [...voices]) stop();
}

/** Settings' test buttons: one tone once ('emergency' by default, or 'earth'). The click itself unlocks audio. */
export function testTone(which: 'emergency' | 'earth' = 'emergency') {
  unlock();
  if (!ctx) return;
  const go = () => (which === 'earth' ? play(EARTH, EARTH_PARTIALS) : play(EMERGENCY, EMERGENCY_PARTIALS));
  if (ctx.state === 'running') go();
  else void ctx.resume().then(go, () => {});
}

/**
 * The emergency tone while `shown` (the occurrence on screen) is set: at once, then every
 * 4 s, until it changes or the screen unmounts. Paused while the tab is hidden (no tones
 * stacking up on return). If audio is still locked it does not play at all, and says so:
 * the returned flag is true then, for the screen's quiet line.
 */
export function useEmergencyTone(shown: string | null): boolean {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (!shown || !soundOn()) { setLocked(false); return; }
    let timer: number | undefined;
    let stop: (() => void) | null = null;
    const ring = () => {
      stop?.();
      stop = play(EMERGENCY, EMERGENCY_PARTIALS);
      timer = window.setTimeout(ring, EMERGENCY_EVERY_MS);
    };
    const halt = () => { window.clearTimeout(timer); timer = undefined; stop?.(); stop = null; };
    const onVisibility = () => { halt(); if (!document.hidden && audioReady()) ring(); };
    // Audio may still be waking (the gesture that unlocked it was a moment ago): try again briefly before calling it locked.
    let tries = 0;
    const start = () => {
      if (audioReady()) { setLocked(false); if (!document.hidden) ring(); return; }
      unlock();
      if (++tries < 10) timer = window.setTimeout(start, 200); else setLocked(true);
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); halt(); };
  }, [shown]);
  return locked;
}

/**
 * One soft tone when a reply from Earth appears that this page has not seen. The replies
 * present when the page first has the hub's state are taken as seen, silently. Several
 * appearing at once (a recorded story skipping ahead) still make one tone.
 */
export function useEarthReplyTone(messages: readonly { id: string; reply?: unknown }[], ready: boolean) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!ready) return;
    const ids = messages.filter((m) => m.reply).map((m) => m.id);
    if (!seen.current) { seen.current = new Set(ids); return; }
    const fresh = ids.filter((id) => !seen.current!.has(id));
    for (const id of fresh) seen.current.add(id);
    if (fresh.length && !document.hidden) play(EARTH, EARTH_PARTIALS);
  }, [messages, ready]);
}
