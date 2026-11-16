// The web replay's "Hub | iPhone" switch: a scenario filmed in one take on both sides (meta.phone) can show
// the phone app's screen recording instead of the hub, at the same moment. The video never runs on its own:
// its time follows the replay clock (data.ts PhoneTake.videoTime), so Replay, Skip and the end move it too.
// Replay mode only (App.tsx); the scenario keeps playing while either side is shown.

import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { PhoneTake } from '../data.ts';
import '../onboarding/onboarding.css';
import './phone-take.css';

export type TakeSide = 'hub' | 'phone';

/** The segmented switch, a radio group: arrow keys move it. */
export function TakeSwitch({ side, onSide, s }: { side: TakeSide; onSide: (side: TakeSide) => void; s: (key: string) => string }) {
  const sides: TakeSide[] = ['hub', 'phone'];
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = sides[(sides.indexOf(side) + step + sides.length) % sides.length];
    onSide(next);
    buttons.current[sides.indexOf(next)]?.focus();
  };
  return (
    <div className="ob-seg take-switch" role="radiogroup" aria-label={s('scenario.view')} onKeyDown={onKey}>
      {sides.map((one, i) => (
        <button key={one} ref={(el) => { buttons.current[i] = el; }} type="button" role="radio" aria-checked={side === one}
          tabIndex={side === one ? 0 : -1} onClick={() => onSide(one)}>
          {s(one === 'hub' ? 'scenario.view.hub' : 'scenario.view.phone')}
        </button>
      ))}
    </div>
  );
}

/** Seconds of drift tolerated before the video is put back on the replay clock. */
const DRIFT_S = 0.15;

/** The phone recording in a phone frame, its time driven by the replay clock `now`. Kept mounted; plays only while shown. */
export function PhoneView({ take, now, playing, shown, s }: { take: PhoneTake; now: number; playing: boolean; shown: boolean; s: (key: string) => string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const end = Number.isFinite(v.duration) ? v.duration - 0.04 : Infinity;
    const at = Math.min(Math.max(0, take.videoTime(now)), end);
    // Once the scenario (or the video) is over, the frame holds.
    const run = shown && playing && now < take.endsAt && at < end;
    if (Math.abs(v.currentTime - at) > DRIFT_S) v.currentTime = at;
    if (run && v.paused) void v.play().catch(() => {});
    else if (!run && !v.paused) v.pause();
  }, [take, now, playing, shown]);
  return (
    <div className="take-phone" hidden={!shown}>
      <figure className="take-figure">
        <div className="take-frame">
          <video ref={video} src={take.src} muted playsInline preload="auto" disablePictureInPicture
            onLoadedMetadata={(e) => { e.currentTarget.currentTime = Math.max(0, take.videoTime(now)); }}
            aria-label={s('scenario.phone.caption')} />
        </div>
        <figcaption>{s('scenario.phone.caption')}</figcaption>
      </figure>
    </div>
  );
}
