// The emergency takeover, its first screen: when an alert this screen may see reaches
// level 3, the station blurs behind one projection frame that says "Emergency" and
// where. It waits for a tap (or Enter, Space, Escape) and then opens the alert itself.
// Each alert shows it once per time it reaches level 3 (its id and levelSince).

import { useEffect, useRef, useState } from 'react';
import type { Alert } from '../../../engine/alerts.ts';
import { NEEDS_SOMEONE } from '../../../engine/alerts.ts';
import './emergency.css';

type S = (key: string, vars?: Record<string, string | number>) => string;

interface Props {
  alerts: Alert[];
  rooms: { id: string; name: string }[];
  crew: { id: string; name: string }[];
  s: S;
  onOpen: (alert: Alert) => void;
  /** Occurrences not to show (already opened before a reload, or settled). */
  skip?: (alert: Alert) => boolean;
}

const keyOf = (a: Alert) => `${a.id}|${a.levelSince}`;

export function Emergency({ alerts, rooms, crew, s, onOpen, skip }: Props) {
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  // Several at once: the newest to reach level 3.
  const alert = alerts
    .filter((a) => a.level === 3 && !a.held && !opened.has(keyOf(a)) && !skip?.(a))
    .sort((a, b) => b.levelSince - a.levelSince)[0];

  const button = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);
  const shownKey = alert ? keyOf(alert) : null;
  useEffect(() => {
    if (!shownKey) return;
    if (!before.current) before.current = document.activeElement;
    button.current?.focus({ preventScroll: true });
  }, [shownKey]);

  if (!alert) return null;

  // Only what the hub sent: a private alert names the person and nothing more.
  const person = crew.find((p) => p.id === alert.person)?.name ?? alert.person;
  const where = alert.signal === NEEDS_SOMEONE
    ? s('alert.needsSomeone', { person })
    : alert.declared && !alert.room
      ? s(`event.${alert.declared.kind}`)
      : alert.stationWide
        ? s('bench.al.stationWide')
        : alert.room
          ? s(rooms.find((r) => r.id === alert.room)?.name ?? alert.room)
          : person;
  const title = s('emergency.title');
  const drill = alert.drill ? s('drill.badge') : null;

  const open = () => {
    const back = before.current;
    before.current = null;
    setOpened((prev) => new Set(prev).add(keyOf(alert)));
    onOpen(alert);
    // If the details take no focus, it goes back where it was.
    requestAnimationFrame(() => {
      if ((!document.activeElement || document.activeElement === document.body) && back instanceof HTMLElement) back.focus({ preventScroll: true });
    });
  };

  return (
    <div className="emergency" role="alertdialog" aria-modal="true" aria-label={[drill, title, where].filter(Boolean).join(', ')}>
      <button ref={button} type="button" className="emergency-frame frame" aria-label={`${[drill, title, where].filter(Boolean).join(', ')}. ${s('emergency.tap')}`}
        onClick={open} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); open(); } }}>
        <span className="emergency-body" aria-hidden="true">
          <svg className="emergency-sign" viewBox="0 0 100 88" focusable="false">
            <path d="M50 3L97.5 85.5H2.5Z" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M45.4 30.5h9.2l-2.2 32.5h-4.8z" fill="currentColor" stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" />
            <circle cx="50" cy="72" r="4.4" fill="currentColor" />
          </svg>
          {drill && <span className="emergency-drill">{drill}</span>}
          <span className="emergency-title">{title}</span>
          <span className="emergency-where">{where}</span>
        </span>
        <span className="emergency-tap" aria-hidden="true">{s('emergency.tap')}</span>
      </button>
    </div>
  );
}
