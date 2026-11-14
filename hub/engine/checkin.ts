// A crewmate's check-in: their own answers, turned into timeline rows marked
// "reported". Pure: the hub core calls it with the body it received.
//
// Every answer becomes one row with the signal under "checkin." (an answer
// named "headache" is stored as "checkin.headache"), the person set, and the
// source "checkin:<person>". Values: 1/0 for yes/no questions, 0 to 100 for
// sliders, or null with a text for a typed answer. Nothing here judges them.

import type { Row } from './types.ts';
import { rowProblem } from './timeline.ts';

export const CHECKIN_PREFIX = 'checkin.';

export interface CheckinAnswer {
  signal: string;
  value: number | null;
  text?: string | null;
  unit?: string;
}

/**
 * Checks a check-in body and returns its rows, or the first problem.
 * `crew` is the profile's crew ids; `roomOf` says where the person is now, if known.
 */
export function checkinRows(body: unknown, crew: string[], now: number, roomOf: (person: string) => string | null = () => null): { rows: Row[] } | { error: string } {
  const b = body as { person?: unknown; answers?: unknown };
  if (typeof b?.person !== 'string' || !crew.includes(b.person)) return { error: 'person must be a crewmate in the profile' };
  if (!Array.isArray(b.answers) || b.answers.length === 0 || b.answers.length > 100) return { error: 'answers must be a list of 1 to 100' };
  const person = b.person;
  const room = roomOf(person);
  const rows: Row[] = [];
  for (const [i, raw] of b.answers.entries()) {
    const a = raw as Partial<CheckinAnswer> | null;
    if (typeof a?.signal !== 'string') return { error: `answer ${i}: signal must be a string` };
    const signal = a.signal.startsWith(CHECKIN_PREFIX) ? a.signal : `${CHECKIN_PREFIX}${a.signal}`;
    const row: Row = {
      t: now, signal, value: a.value === undefined ? null : (a.value as number | null), text: a.text ?? null,
      unit: a.unit ?? '', kind: 'reported', source: `checkin:${person}`, person, room,
    };
    // The same rules as any other row from outside the hub.
    const problem = rowProblem(row);
    if (problem) return { error: `answer ${i}: ${problem}` };
    if (row.value === null && !row.text) return { error: `answer ${i}: needs a value or a text` };
    rows.push(row);
  }
  return { rows };
}
