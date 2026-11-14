// The dock when nothing is selected: a smart stack in the plain sense. It
// shows the widgets that matter most right now, one to four of them, and
// nothing turns or asks to be turned.
//
//   How many: every widget that matters now (relevance 50 or more, a problem
//   always), at least one and at most four.
//   How big: one fills the row; two take halves; three are a quarter, a half
//   and a quarter, the most important in the half; four are quarters.
//
// The row only changes when what matters changes, and then it morphs into
// the new arrangement (a view transition on the cards; none under reduced
// motion). A widget showing a problem is always there.

import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { WIDGETS } from './widgets.tsx';
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

  // Show the new row only when it is a different row, and morph into it.
  const [row, setRow] = useState(next);
  const rowKey = useMemo(() => row.map((s) => `${s.widget.id}:${s.size}`).join(','), [row]);
  useEffect(() => {
    if (nextKey === rowKey) return;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) setRow(next);
    else doc.startViewTransition(() => flushSync(() => setRow(next)));
  }, [nextKey]);

  return (
    <div className="dock dock-smart" role="region" aria-label={context.s('dock.stack')}>
      <div className="dock-row">
        {row.map(({ size, widget }) => (
          <section key={widget.id} className="widget-card dw" data-size={size} data-widget={widget.id}
            data-problem={problems.has(widget.id) ? '' : undefined}
            style={{ gridColumn: `span ${SPAN[size]}`, viewTransitionName: `dw-${widget.id}` }}>
            {widget.render(context)}
          </section>
        ))}
      </div>
    </div>
  );
}
