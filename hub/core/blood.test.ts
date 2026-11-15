import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './db.ts';
import { DOUBTFUL_UNITS, INSPIRATION4_SOURCE, TIMEPOINTS, demoBloodRows, handleBlood, loadBloodFile, loadInspiration4 } from './blood.ts';
import type { BloodContext } from './blood.ts';
import { rowProblem } from '../engine/timeline.ts';

const dir = new URL('../data-nasa/inspiration4', import.meta.url).pathname;
const data = loadInspiration4(dir);

test('the Inspiration4 panels load with the file\'s own values and lab ranges', () => {
  assert.deepEqual(Object.keys(data).sort(), ['C001', 'C002', 'C003', 'C004']);
  for (const subject of Object.values(data)) assert.deepEqual(Object.keys(subject).sort(), [...TIMEPOINTS].sort());

  const glucose = data.C001['L-3'].glucose;
  const sodium = data.C001['L-3'].sodium;
  console.log('C001 L-3 glucose', glucose, 'sodium', sodium);
  assert.deepEqual(glucose, { value: 69, unit: 'mg/dL', fileUnit: 'milligram_per_deciliter', rangeMin: 65, rangeMax: 99 });
  assert.deepEqual(sodium, { value: 142, unit: 'mmol/L', fileUnit: 'millimol_per_liter', rangeMin: 135, rangeMax: 146 });
  assert.equal(data.C001['R+1'].sodium.value, 138);
  assert.equal(data.C001['L-92'].sodium.value, 141);

  // "alt_max_units_per_liter" has no "range_" in its name.
  assert.equal(data.C001['L-3'].alt.unit, 'U/L');
  assert.ok(data.C001['L-3'].alt.rangeMax != null);

  // The blood count file, read as filed.
  const hb = data.C001['L-3'].hemoglobin;
  console.log('C001 L-3 hemoglobin', hb, 'hematocrit', data.C001['L-3'].hematocrit);
  assert.deepEqual(hb, { value: 14.7, unit: '%', fileUnit: 'percent', rangeMin: 13.2, rangeMax: 17.1 });
  assert.equal(data.C001['L-3'].hematocrit.value, 44.5);

  // Every value has a short unit the timeline accepts.
  for (const subject of Object.values(data)) for (const tp of Object.values(subject)) for (const v of Object.values(tp)) {
    assert.ok(v.unit.length <= 16, `unit too long: ${v.fileUnit}`);
    assert.ok(Number.isFinite(v.value));
  }
});

test('demo rows replay one subject\'s real values, labelled, without the doubtful units', () => {
  const rows = demoBloodRows(data, 'C001', 'reyes', [{ timepoint: 'L-3', t: 1000 }, { timepoint: 'R+1', t: 2000 }, { timepoint: 'R+999', t: 3000 }]);
  const glucose = rows.find((r) => r.signal === 'blood.glucose' && r.t === 2000)!;
  assert.deepEqual(glucose, {
    t: 2000, signal: 'blood.glucose', value: 90, unit: 'mg/dL', kind: 'replayed', source: INSPIRATION4_SOURCE, person: 'reyes',
    text: 'Inspiration4 C001, R+1. Lab range 65-99.',
  });
  assert.ok(rows.every((r) => r.kind === 'replayed' && r.person === 'reyes' && rowProblem(r) === null));
  assert.ok(!rows.some((r) => r.t === 3000));
  for (const analyte of Object.keys(DOUBTFUL_UNITS)) assert.ok(!rows.some((r) => r.signal === `blood.${analyte}`));
});

test('her blood.json: missing, empty or broken files load as no entries', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'astrum-blood-'));
  try {
    assert.deepEqual(loadBloodFile(join(tmp, 'none.json')), { entries: [], problems: [] });
    writeFileSync(join(tmp, 'empty.json'), '  \n');
    assert.deepEqual(loadBloodFile(join(tmp, 'empty.json')), { entries: [], problems: [] });
    writeFileSync(join(tmp, 'broken.json'), '[{');
    const broken = loadBloodFile(join(tmp, 'broken.json'));
    assert.equal(broken.entries.length, 0);
    assert.equal(broken.problems.length, 1);
  } finally {
    rmSync(tmp, { recursive: true });
  }
});

test('/api/blood takes typed results, refuses the wrong unit, and reports the newest per person', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'astrum-blood-'));
  const bloodFile = join(tmp, 'blood.json');
  const store = new Store(':memory:');
  const ingested: unknown[] = [];
  const ctx: BloodContext = { store, bloodFile, crew: ['reyes', 'leo'], ingest: (rows) => { ingested.push(...rows); return store.addRows(rows); } };
  const server = createServer((req, res) => {
    void handleBlood(req, res, new URL(req.url ?? '/', 'http://hub'), ctx).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  const post = (body: unknown) => fetch(`${base}/api/blood`, { method: 'POST', body: JSON.stringify(body) });
  const get = async () => (await (await fetch(`${base}/api/blood`)).json()) as { entries: { id: string }[]; problems: string[]; latest: Record<string, { id: string; judgement: string; unitMatches: boolean; row: { value: number; unit: string } }[]> };
  try {
    // No file yet: a valid, empty state.
    assert.deepEqual(await get(), { entries: [], problems: [], latest: {} });
    assert.equal((await post({ person: 'reyes', t: 1000, values: { glucose: 90 } })).status, 400, 'no entry, no unit to store it in');

    // Test numbers only, not clinical ranges.
    writeFileSync(bloodFile, JSON.stringify([
      { id: 'glucose', name: { en: 'Glucose', pt: 'Glicose' }, unit: 'mg/dL', reference_range: { low: null, high: null, condition: '' }, flag_below: null, flag_above: null, urgent_below: null, urgent_above: null },
      { id: 'sodium', name: { en: 'Sodium', pt: 'Sódio' }, unit: 'mmol/L', reference_range: { low: 1, high: 2, condition: '' }, flag_below: null, flag_above: null, urgent_below: null, urgent_above: 3 },
    ]));
    const wrongUnit = await post({ person: 'reyes', t: 1000, values: { glucose: 5, sodium: 1.5 }, units: { glucose: 'mmol/L' } });
    assert.equal(wrongUnit.status, 400);
    assert.deepEqual(((await wrongUnit.json()) as { refused: { id: string }[] }).refused.map((r) => r.id), ['glucose']);
    assert.equal(ingested.length, 0, 'all or nothing');

    assert.equal((await post({ person: 'nobody', t: 1000, values: { sodium: 1 } })).status, 400);
    assert.equal((await post({ person: 'reyes', t: 1000, values: { sodium: 'high' } })).status, 400);

    const good = await post({ person: 'reyes', t: 1000, values: { glucose: 90, sodium: 4 }, units: { sodium: 'mmol/L' } });
    assert.equal(good.status, 200);
    const saved = ((await good.json()) as { saved: { row: { signal: string; kind: string; source: string; unit: string }; judgement: string }[] }).saved;
    assert.deepEqual(saved.map((s) => [s.row.signal, s.row.unit, s.row.kind, s.row.source, s.judgement]), [
      ['blood.glucose', 'mg/dL', 'measured', 'istat:typed', 'no-range'],
      ['blood.sodium', 'mmol/L', 'measured', 'istat:typed', 'urgent-above'],
    ]);
    assert.equal((await post({ person: 'reyes', t: 2000, values: { sodium: 1.5 } })).status, 200);

    // Values read from a photo of the analyser's screen are stored as such; the rest of the post stays typed.
    assert.equal((await post({ person: 'reyes', t: 1500, values: { sodium: 1.5 }, from_photo: ['glucose'] })).status, 400, 'from_photo names only ids in values');
    assert.equal((await post({ person: 'reyes', t: 1500, values: { sodium: 1.5 }, from_photo: 'sodium' })).status, 400);
    const photo = await post({ person: 'reyes', t: 500, values: { glucose: 91, sodium: 1.4 }, from_photo: ['sodium'] });
    assert.equal(photo.status, 200);
    const fromPhoto = ((await photo.json()) as { saved: { row: { signal: string; kind: string; source: string } }[] }).saved;
    assert.deepEqual(fromPhoto.map((s) => [s.row.signal, s.row.kind, s.row.source]), [
      ['blood.glucose', 'measured', 'istat:typed'],
      ['blood.sodium', 'measured', 'istat:photo'],
    ]);

    // A replayed demo row in a unit her entry does not use is shown, not judged.
    store.addRows(demoBloodRows(data, 'C002', 'leo', [{ timepoint: 'L-3', t: 500 }]));
    const state = await get();
    assert.deepEqual(state.entries.map((e) => e.id), ['glucose', 'sodium']);
    const reyes = state.latest.reyes;
    assert.deepEqual(reyes.map((r) => [r.id, r.row.value, r.judgement]), [['glucose', 90, 'no-range'], ['sodium', 1.5, 'in-range']]);
    const leoSodium = state.latest.leo.find((r) => r.id === 'sodium')!;
    assert.deepEqual([leoSodium.row.value, leoSodium.unitMatches, leoSodium.judgement], [143, true, 'urgent-above']);
    const leoAlt = state.latest.leo.find((r) => r.id === 'alt')!;
    assert.deepEqual([leoAlt.unitMatches, leoAlt.judgement], [false, 'no-range']);

    assert.equal((await fetch(`${base}/api/other`)).status, 404, 'other paths are left to the main server');
  } finally {
    server.closeAllConnections();
    server.close();
    store.close();
    rmSync(tmp, { recursive: true });
  }
});
