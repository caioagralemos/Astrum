// The hub's database: one timeline table and one location table, in a local
// SQLite file. Nothing leaves the machine.

import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';
import type { Kind, Row, Stay } from '../engine/types.ts';
import { KIND_RANK } from '../engine/types.ts';
import { Persistence } from './persist.ts';

/** How far back "current values" reach: a newest row older than this is not current. */
export const RECENT_MS = 24 * 3600_000;
/** How often the newest-row map drops entries older than RECENT_MS. */
const PRUNE_EVERY_MS = 10 * 60_000;

export interface StoreOptions {
  /** Writes only what the persistence rule keeps (core/persist.ts). On unless turned off. */
  thin?: boolean;
}

/**
 * The key of "the newest row" for one signal, place and source. A body
 * reading belongs to the person wherever it was taken, so the room only
 * separates cabin readings.
 */
export function newestKey(row: Pick<Row, 'signal' | 'person' | 'room' | 'source'>): string {
  return `${row.signal}|${row.person ?? ''}|${row.person ? '' : (row.room ?? '')}|${row.source}`;
}

const COLUMNS = 'id, t, signal, value, text, unit, kind, source, person, room';

export class Store {
  private db: DatabaseSync;
  private persistence: Persistence | null;
  /** The newest row per signal, place and source, kept as rows arrive (written or not). */
  private newest = new Map<string, Row>();
  /** The newest time any row has carried, and when the map was last pruned against it. */
  private newestT = -Infinity;
  private prunedAt = -Infinity;
  private insert: StatementSync;

  constructor(file: string, options: StoreOptions = {}) {
    this.persistence = options.thin === false ? null : new Persistence();
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
      -- One room's history of one signal: the alarm check, a room's CO2 chart.
      CREATE INDEX IF NOT EXISTS readings_room_signal_t ON readings (room, signal, t);
      -- Finds the newest row of every series without reading the table (loadNewest).
      CREATE INDEX IF NOT EXISTS readings_series_t ON readings (source, signal, person, room, t);

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
    this.insert = this.db.prepare(
      'INSERT INTO readings (t, signal, value, text, unit, kind, source, person, room, received) VALUES (?,?,?,?,?,?,?,?,?,?)',
    );
    this.loadNewest();
  }

  /**
   * Adds rows to the timeline. Every row is returned, in order; the ones the
   * persistence rule wrote carry their id, the others have none (they were
   * still current values, and are sent live).
   */
  addRows(rows: Row[], received = Date.now()): Row[] {
    const out: Row[] = [];
    this.db.exec('BEGIN');
    try {
      for (const r of rows) {
        if (this.persistence && !this.persistence.keep(r)) { out.push({ ...r }); continue; }
        const done = this.insert.run(r.t, r.signal, r.value, r.text ?? null, r.unit, r.kind, r.source, r.person ?? null, r.room ?? null, received);
        out.push({ ...r, id: Number(done.lastInsertRowid) });
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    for (const r of out) this.remember(r);
    return out;
  }

  private remember(r: Row): void {
    const key = newestKey(r);
    const held = this.newest.get(key);
    if (!held || r.t >= held.t) this.newest.set(key, { id: r.id, t: r.t, signal: r.signal, value: r.value, text: r.text ?? null, unit: r.unit, kind: r.kind, source: r.source, person: r.person ?? null, room: r.room ?? null });
    // Pruning follows the rows' own clock (a scenario runs on its own), but a
    // row stamped far ahead of this computer's clock never moves it.
    if (r.t > this.newestT && r.t <= Date.now() + RECENT_MS) this.newestT = r.t;
    if (this.newestT - this.prunedAt >= PRUNE_EVERY_MS) this.prune();
  }

  /** Drops newest rows that are no longer current. */
  private prune(): void {
    this.prunedAt = this.newestT;
    for (const [k, row] of this.newest) if (row.t < this.newestT - RECENT_MS) this.newest.delete(k);
  }

  /**
   * Fills the newest-row map once, at startup. It walks the series index one
   * distinct value at a time (source, then signal, person and room) and reads
   * one row per series, so it costs a few hundred index lookups whatever the
   * size of the table.
   */
  private loadNewest(): void {
    const next = new Map<string, StatementSync>();
    const distinct = (column: string, where: string, args: (string | null)[]): (string | null)[] => {
      const scope = where ? `${where} AND ` : '';
      const out: (string | null)[] = [];
      if (column !== 'source' && column !== 'signal') {
        const sql = `SELECT 1 AS x FROM readings WHERE ${scope}${column} IS NULL LIMIT 1`;
        if ((next.get(sql) ?? next.set(sql, this.db.prepare(sql)).get(sql)!).get(...args)) out.push(null);
      }
      const sql = `SELECT ${column} AS v FROM readings WHERE ${scope}${column} > ? ORDER BY ${column} LIMIT 1`;
      const step = next.get(sql) ?? next.set(sql, this.db.prepare(sql)).get(sql)!;
      for (let v = ''; ;) {
        const hit = step.get(...args, v) as { v: string } | undefined;
        if (!hit) break;
        out.push(hit.v);
        v = hit.v;
      }
      return out;
    };
    const newestOf = this.db.prepare(`SELECT ${COLUMNS} FROM readings WHERE source = ? AND signal = ? AND person IS ? AND room IS ? ORDER BY t DESC LIMIT 1`);
    for (const source of distinct('source', '', [])) {
      for (const signal of distinct('signal', 'source = ?', [source])) {
        for (const person of distinct('person', 'source = ? AND signal = ?', [source, signal])) {
          for (const room of distinct('room', 'source = ? AND signal = ? AND person IS ?', [source, signal, person])) {
            const row = newestOf.get(source, signal, person, room) as unknown as Row | undefined;
            if (row) this.remember(row);
          }
        }
      }
    }
    this.prune();
  }

  rows(q: { signal?: string; signalPrefix?: string; person?: string; room?: string; kind?: Kind; from?: number; to?: number; limit?: number }): Row[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.signal) { where.push('signal = ?'); args.push(q.signal); }
    if (q.signalPrefix) {
      // The range lets the signal index find them; the substr keeps the match exact.
      const upper = q.signalPrefix.slice(0, -1) + String.fromCharCode(q.signalPrefix.charCodeAt(q.signalPrefix.length - 1) + 1);
      where.push('signal >= ? AND signal < ? AND substr(signal, 1, ?) = ?');
      args.push(q.signalPrefix, upper, q.signalPrefix.length, q.signalPrefix);
    }
    if (q.person) { where.push('person = ?'); args.push(q.person); }
    if (q.room) { where.push('room = ?'); args.push(q.room); }
    if (q.kind) { where.push('kind = ?'); args.push(q.kind); }
    if (q.from != null) { where.push('t >= ?'); args.push(q.from); }
    if (q.to != null) { where.push('t <= ?'); args.push(q.to); }
    // Without statistics SQLite picks the room index and reads every signal of the room; name the better one.
    const index = q.room && q.signal && !q.person ? 'INDEXED BY readings_room_signal_t' : '';
    const sql = `SELECT ${COLUMNS} FROM readings ${index}
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

  /**
   * The newest row of every source for every signal and place, no older than
   * `since` (and never older than RECENT_MS before the newest row). From
   * memory: no database work. Includes rows the persistence rule did not
   * write, which carry no id.
   */
  recent(since: number): Row[] {
    const out: Row[] = [];
    for (const row of this.newest.values()) if (row.t >= since) out.push(row);
    // In the order the database grouped them before, so screens and recordings see the same list.
    const text = (v: string | null | undefined) => v ?? '';
    const order = (a: string | null | undefined, b: string | null | undefined) => (a == null ? (b == null ? 0 : -1) : b == null ? 1 : text(a) < text(b) ? -1 : text(a) > text(b) ? 1 : 0);
    return out.sort((a, b) => order(a.signal, b.signal) || order(a.person, b.person)
      || order(a.person ? null : a.room, b.person ? null : b.room) || order(a.source, b.source));
  }

  /** When a source last gave a row, or null if it never has. Counts rows that were not written. */
  lastTime(source: string): number | null {
    const hit = this.db.prepare('SELECT MAX(t) AS t FROM readings WHERE source = ?').get(source) as { t: number | null };
    let t = hit.t;
    for (const row of this.newest.values()) if (row.source === source && (t === null || row.t > t)) t = row.t;
    return t;
  }

  /** Records that someone is now in a room: closes their open stay and opens a new one. */
  moveTo(person: string, room: string, t: number, kind: Kind, source: string): Stay[] {
    const open = this.db.prepare('SELECT id, room, kind FROM stays WHERE person = ? AND t_until IS NULL').get(person) as { id: number; room: string; kind: Kind } | undefined;
    // Same room: nothing changes, unless the new word is better labelled (a measured stay replaces a simulated one).
    if (open?.room === room && KIND_RANK[kind] >= KIND_RANK[open.kind]) return [];
    const changed: Stay[] = [];
    if (open) {
      this.db.prepare('UPDATE stays SET t_until = ? WHERE id = ?').run(t, open.id);
      changed.push(this.stay(open.id));
    }
    const done = this.db.prepare('INSERT INTO stays (person, room, t_from, t_until, kind, source) VALUES (?,?,?,NULL,?,?)').run(person, room, t, kind, source);
    changed.push(this.stay(Number(done.lastInsertRowid)));
    return changed;
  }

  /**
   * Ends a person's open stay without saying where they went: their place is
   * then unknown. Only the source that opened the stay can end it this way.
   */
  leave(person: string, t: number, source: string): Stay[] {
    const open = this.db.prepare('SELECT id, t_from AS "from", source FROM stays WHERE person = ? AND t_until IS NULL').get(person) as { id: number; from: number; source: string } | undefined;
    if (!open || open.source !== source || t < open.from) return [];
    this.db.prepare('UPDATE stays SET t_until = ? WHERE id = ?').run(t, open.id);
    return [this.stay(open.id)];
  }

  /** A person's most recent stay, open or ended. */
  lastStay(person: string): Stay | undefined {
    return this.db.prepare('SELECT id, person, room, t_from AS "from", t_until AS until, kind, source FROM stays WHERE person = ? ORDER BY t_from DESC, id DESC LIMIT 1').get(person) as unknown as Stay | undefined;
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
