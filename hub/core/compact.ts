// npm run compact: a one-off clean-up of a database written before the hub
// thinned what it stores (core/persist.ts). Run by hand, with the hub closed.
//
// It applies the same rule the hub now applies as rows arrive to every row
// already stored: the stand-in's and the NASA replay's repeats, and measured
// rows that only repeated the one before within a few seconds. Nothing
// reported, typed, estimated or from the simulated crew is touched; no row is
// changed, only rows the rule would not have written are removed. Then the
// file is rebuilt (VACUUM) so it actually shrinks.
//
// Safety: it refuses while a hub has the database open (the hub's lock file,
// a hub answering on its port, or any process holding the file), and copies
// the database aside before it changes anything. Nothing runs it on its own.

import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import type { Row } from '../engine/types.ts';
import { Persistence } from './persist.ts';
import { STAND_IN } from './server.ts';
import { NASA_SOURCE } from './nasa.ts';
import { databaseFile, lockFile, missionName } from './paths.ts';
import { Retention } from './retention.ts';

export interface CompactOptions {
  /** The port a running hub would answer on. */
  port?: number;
  /** Where the copy goes; by default beside the database, stamped with the time. */
  backup?: string;
  /** Also run the retention tiers (core/retention.ts) to the end. On unless false. */
  retention?: boolean;
}

export interface CompactReport {
  file: string;
  backup: string;
  rowsBefore: number;
  rowsAfter: number;
  bytesBefore: number;
  bytesAfter: number;
}

/** Why the database may be in use, or null if nothing holds it. */
export async function inUse(file: string, port: number): Promise<string | null> {
  const lock = lockFile(file);
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8').trim());
    let alive = false;
    try { process.kill(pid, 0); alive = Number.isInteger(pid) && pid > 0; } catch (err) { alive = (err as NodeJS.ErrnoException).code === 'EPERM'; }
    if (alive) return `a hub (process ${pid}) has the database open; close it first`;
  }
  const answering = await new Promise<boolean>((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (yes: boolean) => { socket.destroy(); done(yes); };
    socket.setTimeout(1000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
  if (answering) return `something is listening on port ${port}, probably a hub; close it first`;
  try {
    // lsof is on every Mac; where it is missing the two checks above stand.
    const holders = execFileSync('lsof', ['-t', file, `${file}-wal`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (holders) return `process ${holders.split('\n').join(', ')} has the database open; close it first`;
  } catch { /* lsof exits 1 when nothing has the file open, or is not installed */ }
  return null;
}

function size(file: string): number {
  return ['', '-wal', '-shm'].reduce((total, end) => total + (existsSync(file + end) ? statSync(file + end).size : 0), 0);
}

/** Thins one database file in place, after copying it aside. Throws without changing anything if it is in use. */
export async function compact(file: string, options: CompactOptions = {}): Promise<CompactReport> {
  if (!existsSync(file)) throw new Error(`no database at ${file}`);
  const busy = await inUse(file, options.port ?? 4310);
  if (busy) throw new Error(`not compacting: ${busy}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = options.backup ?? file.replace(/\.sqlite$/, '') + `.before-compact-${stamp}.sqlite`;
  // The copy has its write-ahead log beside it under the matching name, so it opens as the same database.
  for (const end of ['', '-wal']) if (existsSync(file + end)) copyFileSync(file + end, backup + end);
  const bytesBefore = size(file);

  const db = new DatabaseSync(file);
  try {
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM readings').get() as { n: number }).n;
    const rowsBefore = count();
    db.exec('CREATE INDEX IF NOT EXISTS readings_series_t ON readings (source, signal, person, room, t)');
    // Each series in time order, as the rows first arrived; only the kinds the rule can thin.
    const candidates = db.prepare(`
      SELECT id, t, signal, value, text, unit, kind, source, person, room FROM readings
      WHERE (source = ? AND kind = 'simulated') OR (source = ? AND kind = 'replayed') OR kind = 'measured'
      ORDER BY source, signal, person, room, unit, t, id`);
    const rule = new Persistence();
    const drop: number[] = [];
    for (const row of candidates.iterate(STAND_IN, NASA_SOURCE) as Iterable<Row & { id: number }>) {
      if (!rule.keep(row)) drop.push(row.id);
    }
    db.exec('CREATE TEMP TABLE dropped (id INTEGER PRIMARY KEY)');
    db.exec('BEGIN');
    try {
      const add = db.prepare('INSERT INTO dropped (id) VALUES (?)');
      for (const id of drop) add.run(id);
      db.exec('DELETE FROM readings WHERE id IN (SELECT id FROM dropped)');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    // Then the same tiers the hub runs by itself (core/retention.ts), all at once.
    if (!(db.prepare('PRAGMA table_info(readings)').all() as { name: string }[]).some((c) => c.name === 'summary')) db.exec('ALTER TABLE readings ADD COLUMN summary TEXT');
    db.exec('CREATE TABLE IF NOT EXISTS raw_holds (key TEXT PRIMARY KEY, t_from INTEGER NOT NULL, t_until INTEGER)');
    if (options.retention !== false) new Retention(db).runAll(Date.now());
    const rowsAfter = count();
    // From now on the file returns freed space by itself (VACUUM applies the setting to an existing file).
    db.exec('PRAGMA auto_vacuum = INCREMENTAL');
    db.exec('VACUUM');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
    return { file, backup, rowsBefore, rowsAfter, bytesBefore, bytesAfter: size(file) };
  } catch (err) {
    if (db.isOpen) db.close();
    throw err;
  }
}

if (import.meta.main) {
  // The mission's own database: ASTRUM_MISSION=iss npm run compact compacts the ISS's.
  const file = databaseFile(undefined, missionName());
  const port = Number(process.env.ASTRUM_PORT ?? 4310);
  const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
  console.log(`Compacting ${file}`);
  compact(file, { port }).then((r) => {
    console.log(`Copied the database first to ${r.backup}`);
    console.log(`Rows: ${r.rowsBefore} -> ${r.rowsAfter} (${r.rowsBefore - r.rowsAfter} repeats removed)`);
    console.log(`Size: ${mb(r.bytesBefore)} -> ${mb(r.bytesAfter)}`);
    console.log('Once the hub has started and looks right, the copy can be deleted.');
  }).catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
}
