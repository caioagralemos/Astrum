// The library of moves, by name. Moves register themselves: any file in this
// folder named V*.ts that exports a Move (an object with `name` and `variants`)
// is picked up by import.meta.glob below. Nobody edits this file to add a move.
//
// Each file is loaded on its own, so one broken or half-written file cannot
// break the others: it is skipped and reported (console, and BROKEN below).
// Wait for `movesReady` before reading MOVES.

import type { Move } from '../step.ts';
import { goTo } from './go-to.ts';
import { rouseLeadOut } from './rouse-lead-out.ts';
import { stayAtTable } from './stay-at-table.ts';
import { compressions } from './compressions.ts';

const loaders = import.meta.glob<Record<string, unknown>>('./V*.ts');

const isMove = (x: unknown): x is Move => typeof x === 'object' && x !== null && typeof (x as Move).name === 'string' && typeof (x as Move).variants === 'object';

export const MOVES: Record<string, Move> = Object.fromEntries([goTo, rouseLeadOut, stayAtTable, compressions].map((m) => [m.name, m]));

/** Move files that failed to load, with the reason. */
export const BROKEN: Record<string, string> = {};

export const movesReady: Promise<void> = Promise.all(Object.entries(loaders).map(async ([path, load]) => {
  try {
    const mod = await load();
    for (const value of Object.values(mod)) if (isMove(value)) MOVES[value.name] = value;
  } catch (error) {
    BROKEN[path] = String(error);
    console.error(`Move file ${path} failed to load:`, error);
  }
})).then(() => undefined);
