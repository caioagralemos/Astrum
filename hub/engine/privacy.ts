// What each screen may receive about another person. Pure.
//
// The medical lead's rule (hub/medical/README.md): what a person writes for
// the mood, psychosis and gynecologic cards is never shown to the crew. The
// hub cannot tell which card a typed check-in answer was for, so it keeps every
// typed check-in answer to the person who wrote it: other screens get the row
// (its time, its signal, its number) with the text taken out. Alerts go through
// alertFor (engine/alerts.ts). The one typed text meant for everyone is the
// note on a base-wide event a crewmate declared (Alert.declared.note): it is
// addressed to all, so it reaches every screen as written. A viewer is a crew id, or 'common' for a shared
// screen and anything that did not say who it is.

import { alertFor } from './alerts.ts';
import type { Alert } from './alerts.ts';
import { CHECKIN_PREFIX } from './checkin.ts';
import { EARTH_SIGNAL } from './earth.ts';
import type { Evidence } from './evidence.ts';
import type { Row } from './types.ts';

export type Viewer = string | 'common';

/** Words a crewmate typed: a check-in answer, or a message to Earth (engine/earth.ts). */
export function isTyped(row: Pick<Row, 'signal' | 'text'>): boolean {
  return Boolean(row.text) && (row.signal.startsWith(CHECKIN_PREFIX) || row.signal === EARTH_SIGNAL);
}

/** A row as one viewer receives it: typed words keep their text only for their author. */
export function rowFor<R extends Pick<Row, 'signal' | 'text'> & { person?: string | null }>(row: R, viewer: Viewer): R {
  if (!isTyped(row) || (row.person && row.person === viewer)) return row;
  return { ...row, text: null };
}

export function rowsFor<R extends Pick<Row, 'signal' | 'text'> & { person?: string | null }>(rows: R[], viewer: Viewer): R[] {
  return rows.some(isTyped) ? rows.map((r) => rowFor(r, viewer)) : rows;
}

/**
 * The newest rows a screen starts from (`latest` in the state message): readings only.
 * A message to Earth is not a reading; it reaches screens in `earthMessages`.
 */
export function latestFor<R extends Pick<Row, 'signal' | 'text'> & { person?: string | null }>(rows: R[], viewer: Viewer): R[] {
  return rowsFor(rows.filter((r) => r.signal !== EARTH_SIGNAL), viewer);
}

/** One person's evidence card as a viewer receives it: their reported rows lose their text for anyone else. */
export function evidenceFor<E extends Evidence>(evidence: E, viewer: Viewer): E {
  if (evidence.person === viewer || !evidence.reported.rows.some((r) => r.text)) return evidence;
  return { ...evidence, reported: { ...evidence.reported, rows: evidence.reported.rows.map((r) => ({ ...r, text: null })) } };
}

export function alertsFor(alerts: Alert[], viewer: Viewer): Alert[] {
  return alerts.some((a) => a.private) ? alerts.map((a) => alertFor(a, viewer)) : alerts;
}
