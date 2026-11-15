// The dock when nothing is selected: a smart stack in the plain sense. It
// shows the widgets that matter most right now, one to four of them, and
// nothing turns or asks to be turned.
//
//   How many: every widget that matters now (relevance 50 or more, a problem
//   always), at least one and at most four.
//   How big: one fills the row; two take halves; three are a quarter, a half
//   and a quarter, the most important in the half; four are quarters.
//
// The row only changes when what matters changes, and then it moves into
// the new arrangement: cards that stay glide and resize, a new one rises in,
// one that goes fades down (flow.ts; at once under reduced motion). A widget
// showing a problem is always there.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { WIDGETS } from './widgets.tsx';
import { DockFlow } from './flow.ts';
import type { Snapshot } from './flow.ts';
import type { DockContext, Size, Widget } from './widgets.tsx';

const SPAN: Record<Size, number> = { quarter: 3, third: 4, half: 6, full: 12 };
const MATTERS = 50;

/** The arrangement for `n` widgets, and which of them (by rank) goes in each slot. */
const SHAPES: Record<number, { size: Size; rank: number }[]> = {
  1: [{ size: 'full', rank: 0 }],
  2: [{ size: 'half', rank: 0 }, { size: 'half', rank: 1 }],
  3: [{ size: 'quarter', rank: 1 }, { size: 'half', rank: 0 }, { size: 'quarter', rank: 2 }],
  4: [{ size: 'quarter', rank: 0 }, { size: 'quarter', rank: 1 }, { size: 'quarter', rank: 2 }, { size: 'quarter', rank: 3 }],
};

interface Slot { size: Size; widget: Widget }
/** A card on its way out, drawn where it was until it has faded. */
interface Leaving { key: string; slot: Slot; left: number; width: number }
let leavingCount = 0;

/** Choose the row: the widgets that matter, as many as fit an arrangement where each has a size it can take. */
function choose(ranked: { widget: Widget; score: number }[]): Slot[] {
  const wanted = Math.max(1, Math.min(4, ranked.filter((r) => r.score >= MATTERS).length));
  // The count that matters first; if no arrangement of that many fits, fewer, then more.
  const counts = [wanted, ...[3, 2, 1].filter((n) => n < wanted), ...[2, 3, 4].filter((n) => n > wanted)];
  for (const n of counts) {
    const shape = SHAPES[n];
    const pool = ranked.map((r) => r.widget);
    const slots: (Slot | null)[] = shape.map(() => null);
    // Fill in rank order: each takes the first widget (most important first) that fits its size.
    for (const slot of [...shape].sort((a, b) => a.rank - b.rank)) {
      const at = pool.findIndex((w) => w.sizes.includes(slot.size));
      if (at < 0) break;
      slots[shape.indexOf(slot)] = { size: slot.size, widget: pool.splice(at, 1)[0] };
    }
    if (slots.every(Boolean)) return slots as Slot[];
  }
  return [];
}

/**
 * The cards of the new row that change order with the others: everything but the
 * largest set that keeps its order (preferring cards that keep their size, then
 * the more important).
 */
function crossers(row: Slot[], next: Slot[]): Set<string> {
  const was = new Map(row.map((s, i) => [s.widget.id, { at: i, size: s.size }]));
  const kept = next.filter((s) => was.has(s.widget.id));
  const worth = kept.map((s, i) => 1 + (was.get(s.widget.id)?.size === s.size ? 0.1 : 0) + (kept.length - i) * 0.01);
  // Heaviest increasing run of old places, over the new order.
  const best = kept.map((_, i) => worth[i]);
  const from = kept.map(() => -1);
  kept.forEach((s, i) => {
    for (let j = 0; j < i; j++) {
      if (was.get(kept[j].widget.id)!.at < was.get(s.widget.id)!.at && best[j] + worth[i] > best[i]) { best[i] = best[j] + worth[i]; from[i] = j; }
    }
  });
  const stay = new Set<string>();
  for (let i = best.indexOf(Math.max(...best, 0)); i >= 0; i = from[i]) stay.add(kept[i].widget.id);
  return new Set(kept.filter((s) => !stay.has(s.widget.id)).map((s) => s.widget.id));
}

export function SmartDock({ context }: { context: DockContext }) {
  const ranked = WIDGETS
    .map((widget) => {
      const problem = widget.problem(context);
      return { widget, problem, score: problem ? 1000 : widget.score(context) };
    })
    .sort((a, b) => b.score - a.score);
  const problems = new Set(ranked.filter((r) => r.problem).map((r) => r.widget.id));
  const next = choose(ranked);
  const nextKey = next.map((s) => `${s.widget.id}:${s.size}`).join(',');

  // Show the new row only when it is a different row, and move into it: note where every card
  // is drawn, change the row, then send each card from there to its new place before paint.
  const [row, setRow] = useState(next);
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  const rowKey = useMemo(() => row.map((s) => `${s.widget.id}:${s.size}`).join(','), [row]);
  const rowRef = useRef<HTMLDivElement>(null);
  const flow = useRef<DockFlow | null>(null);
  const shot = useRef<Snapshot | null>(null);
  flow.current ??= new DockFlow((key) => setLeaving((all) => all.filter((l) => l.key !== key)));
  useEffect(() => () => flow.current?.stop(), []);

  useEffect(() => {
    if (nextKey === rowKey) return;
    const el = rowRef.current;
    const taken = el && flow.current ? flow.current.capture(el) : null;
    const staying = new Set(next.map((s) => s.widget.id));
    // A card never slides across another: the fewest cards that change order fade out where they
    // were and rise in where they go, while the rest slide (and resize) to make room.
    const jumps = crossers(row, next);
    const gone = row.filter((s) => !staying.has(s.widget.id) || jumps.has(s.widget.id)).flatMap((slot): Leaving[] => {
      const box = taken?.boxes.get(slot.widget.id);
      return box && box.presence > 0.01 ? [{ key: `gone-${slot.widget.id}-${++leavingCount}`, slot, left: box.left, width: box.right - box.left }] : [];
    });
    for (const id of jumps) taken?.boxes.delete(id);
    shot.current = taken;
    // A widget that comes back while its old copy is still fading rises in afresh; the copy finishes.
    setLeaving((all) => [...all, ...gone]);
    setRow(next);
  }, [nextKey]);

  useLayoutEffect(() => {
    const taken = shot.current;
    shot.current = null;
    if (taken && rowRef.current) flow.current?.play(rowRef.current, taken);
  }, [rowKey]);

  const card = ({ size, widget }: Slot, gone?: Leaving) => (
    <section key={gone?.key ?? widget.id} className="widget-card dw" data-size={size} data-widget={widget.id} data-key={gone?.key ?? widget.id}
      data-problem={problems.has(widget.id) ? '' : undefined} data-leaving={gone ? '' : undefined}
      aria-hidden={gone ? true : undefined} inert={gone ? true : undefined}
      style={gone ? { left: gone.left, width: gone.width } : { gridColumn: `span ${SPAN[size]}` }}>
      <div className="dw-frame" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="dw-was" aria-hidden="true" inert />
      <div className="dw-body">{widget.render(context)}</div>
    </section>
  );

  return (
    <div className="dock dock-smart" role="region" aria-label={context.s('dock.stack')}>
      <div className="dock-row" ref={rowRef}>
        {leaving.map((l) => card(l.slot, l))}
        {row.map((slot) => card(slot))}
      </div>
    </div>
  );
}
