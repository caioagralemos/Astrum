// The hub's database: one timeline table and one location table, in a local
// SQLite file. Nothing leaves the machine.

import { DatabaseSync } from 'node:sqlite';
import type { Kind, Row, Stay } from '../engine/types.ts';

export class Store {
  private db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS readings (
        id       INTEGER PRIMARY KEY,
        t        INTEGER NOT NULL,
        signal   TEXT    NOT NULL,
        value    REAL,
        text     TEXT,
        unit     TEXT    NOT NULL,
        kind     TEXT    NOT NULL CHECK (kind IN ('measured','estimated','reported','replayed','simulated')),
        source   TEXT    NOT NULL,
        person   TEXT,
        room     TEXT,
        received INTEGER NOT NULL,
        CHECK (person IS NOT NULL OR room IS NOT NULL)
      );
      CREATE INDEX IF NOT EXISTS readings_signal_t ON readings (signal, t);
      CREATE INDEX IF NOT EXISTS readings_person_t ON readings (person, t);
      CREATE INDEX IF NOT EXISTS readings_room_t   ON readings (room, t);
      CREATE INDEX IF NOT EXISTS readings_source_t ON readings (source, t);

      CREATE TABLE IF NOT EXISTS stays (
        id      INTEGER PRIMARY KEY,
        person  TEXT    NOT NULL,
        room    TEXT    NOT NULL,
        t_from  INTEGER NOT NULL,
        t_until INTEGER,
        kind    TEXT    NOT NULL CHECK (kind IN ('measured','estimated','reported','replayed','simulated')),
        source  TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS stays_person_from ON stays (person, t_from);
    `);
  }

  /** Adds rows to the timeline and returns them with their ids. */
  addRows(rows: Row[], received = Date.now()): Row[] {
    const insert = this.db.prepare(
      'INSERT INTO readings (t, signal, value, text, unit, kind, source, person, room, received) VALUES (?,?,?,?,?,?,?,?,?,?)',
    );
    const out: Row[] = [];
    this.db.exec('BEGIN');
    try {
      for (const r of rows) {
        const done = insert.run(r.t, r.signal, r.value, r.text ?? null, r.unit, r.kind, r.source, r.person ?? null, r.room ?? null, received);
        out.push({ ...r, id: Number(done.lastInsertRowid) });
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return out;
  }

  rows(q: { signal?: string; signalPrefix?: string; person?: string; room?: string; from?: number; to?: number; limit?: number }): Row[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.signal) { where.push('signal = ?'); args.push(q.signal); }
    if (q.signalPrefix) { where.push('substr(signal, 1, ?) = ?'); args.push(q.signalPrefix.length, q.signalPrefix); }
    if (q.person) { where.push('person = ?'); args.push(q.person); }
    if (q.room) { where.push('room = ?'); args.push(q.room); }
    if (q.from != null) { where.push('t >= ?'); args.push(q.from); }
    if (q.to != null) { where.push('t <= ?'); args.push(q.to); }
    const sql = `SELECT id, t, signal, value, text, unit, kind, source, person, room FROM readings
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t DESC LIMIT ?`;
    args.push(Math.min(q.limit ?? 5000, 50_000));
    return (this.db.prepare(sql).all(...args) as unknown as Row[]).reverse();
  }

  /**
   * Cabin rows of one signal thinned to the first row of each source in every
   * `everyMs` bucket, oldest first. For long looks back (exposure over 72
   * hours), where a reading every few seconds would be hundreds of thousands
   * of rows; a reading holds for up to 10 minutes, so one a minute loses nothing.
   */
  sampled(signal: string, from: number, to: number, everyMs: number, limit = 400_000): Row[] {
    return this.db.prepare(`
      SELECT id, MIN(t) AS t, signal, value, text, unit, kind, source, person, room FROM readings
      WHERE signal = ? AND person IS NULL AND t >= ? AND t <= ?
      GROUP BY room, source, CAST(t / ? AS INTEGER)
      ORDER BY t LIMIT ?`).all(signal, from, to, everyMs, limit) as unknown as Row[];
  }

  /** The newest row of every source for every signal and place, no older than `since`. */
  recent(since: number): Row[] {
    // A body reading belongs to the person wherever it was taken, so the room
    // only separates cabin readings. SQLite takes the other columns from the
    // row that holds MAX(t).
    return this.db.prepare(`
      SELECT id, MAX(t) AS t, signal, value, text, unit, kind, source, person, room FROM readings
      WHERE t >= ?
      GROUP BY signal, person, CASE WHEN person IS NULL THEN room END, source`).all(since) as unknown as Row[];
  }

  /** When a source last gave a row, or null if it never has. */
  lastTime(source: string): number | null {
    const hit = this.db.prepare('SELECT MAX(t) AS t FROM readings WHERE source = ?').get(source) as { t: number | null };
    return hit.t;
  }

  /** Records that someone is now in a room: closes their open stay and opens a new one. */
  moveTo(person: string, room: string, t: number, kind: Kind, source: string): Stay[] {
    const open = this.db.prepare('SELECT id, room FROM stays WHERE person = ? AND t_until IS NULL').get(person) as { id: number; room: string } | undefined;
    if (open?.room === room) return [];
    const changed: Stay[] = [];
    if (open) {
      this.db.prepare('UPDATE stays SET t_until = ? WHERE id = ?').run(t, open.id);
      changed.push(this.stay(open.id));
    }
    const done = this.db.prepare('INSERT INTO stays (person, room, t_from, t_until, kind, source) VALUES (?,?,?,NULL,?,?)').run(person, room, t, kind, source);
    changed.push(this.stay(Number(done.lastInsertRowid)));
    return changed;
  }

  private stay(id: number): Stay {
    return this.db.prepare('SELECT id, person, room, t_from AS "from", t_until AS until, kind, source FROM stays WHERE id = ?').get(id) as unknown as Stay;
  }

  /** Stays that overlap a period. Open stays count as still running. */
  stays(from: number, to: number, person?: string): Stay[] {
    const sql = `SELECT id, person, room, t_from AS "from", t_until AS until, kind, source FROM stays
      WHERE t_from <= ? AND (t_until IS NULL OR t_until >= ?) ${person ? 'AND person = ?' : ''} ORDER BY t_from`;
    const args: (string | number)[] = [to, from];
    if (person) args.push(person);
    return this.db.prepare(sql).all(...args) as unknown as Stay[];
  }

  close(): void {
    this.db.close();
  }
}
