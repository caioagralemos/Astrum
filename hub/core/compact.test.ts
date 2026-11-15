import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from './db.ts';
import { STAND_IN } from './server.ts';
import { compact } from './compact.ts';
import { lockFile } from './paths.ts';
import type { Row } from '../engine/types.ts';

const T0 = Date.UTC(2026, 10, 14, 12);

/** A database written the old way: every row kept, ten minutes of everything a second. */
function oldDatabase(dir: string): string {
  const file = join(dir, 'astrum-3.sqlite');
  const store = new Store(file, { thin: false });
  const rows: Row[] = [];
  for (let s = 0; s < 600; s++) {
    const t = T0 + s * 1000;
    rows.push({ t, signal: 'pressure', value: 1013 + (s % 3) / 100, unit: 'hPa', kind: 'simulated', source: STAND_IN, room: 'lab' });
    rows.push({ t, signal: 'noise', value: s === 300 ? 4095 : 240, unit: 'raw', kind: 'measured', source: 'chip:cabin-1', room: 'galley' });
    if (s % 5 === 0) rows.push({ t, signal: 'heart_rate', value: 60, unit: 'bpm', kind: 'simulated', source: 'sim:crew', person: 'reyes', room: 'lab' });
  }
  rows.push({ t: T0, signal: 'checkin.headache', value: 1, unit: 'yes/no', kind: 'reported', source: 'checkin:reyes', person: 'reyes', room: 'lab' });
  rows.push({ t: T0, signal: 'blood.glucose', value: 90, unit: 'mg/dL', kind: 'measured', source: 'istat:typed', person: 'reyes' });
  store.addRows(rows);
  store.close();
  return file;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  await new Promise((done) => server.close(done));
  return port;
}

const count = (file: string, where = '1') => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return (db.prepare(`SELECT COUNT(*) AS n FROM readings WHERE ${where}`).get() as { n: number }).n; } finally { db.close(); }
};

test('compaction copies the database aside, then removes only what the rule would not have written', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'astrum-compact-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = oldDatabase(dir);
  const before = count(file);
  // The write-time rule only: the retention tiers have their own tests (core/retention.test.ts).
  const report = await compact(file, { port: await freePort(), backup: join(dir, 'copy.sqlite'), retention: false });

  assert.equal(count(report.backup), before, 'the copy holds every row');
  assert.equal(report.rowsBefore, before);
  assert.equal(count(file), report.rowsAfter);
  assert.equal(count(file, "source = 'sim:crew'"), 120, 'the simulated crew is untouched');
  assert.equal(count(file, "signal LIKE 'checkin.%' OR signal LIKE 'blood.%'"), 2, 'nothing reported or typed is removed');
  assert.equal(count(file, `source = '${STAND_IN}'`), 10, 'the stand-in: one row a minute (its values move less than a step)');
  // The chip: one row every 10 seconds (the clap falls on one of them), plus the reading after the clap.
  assert.equal(count(file, "source = 'chip:cabin-1'"), 61);
  assert.equal(count(file, "source = 'chip:cabin-1' AND value = 4095"), 1, 'the clap is kept');
  const reopened = new Store(file);
  assert.equal(reopened.recent(0).length, 5, 'it opens as a hub database, newest rows and all');
  reopened.close();
});

test('compaction refuses while a hub has the database: its lock, or something on its port', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'astrum-compact-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = oldDatabase(dir);
  const before = count(file);

  writeFileSync(lockFile(file), String(process.pid));
  await assert.rejects(compact(file, { port: await freePort() }), /has the database open/);
  writeFileSync(lockFile(file), '999999999');
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  await assert.rejects(compact(file, { port: (server.address() as { port: number }).port }), /listening on port/);

  assert.equal(count(file), before, 'nothing changed');
  assert.ok(!existsSync(join(dir, 'copy.sqlite')));
});
