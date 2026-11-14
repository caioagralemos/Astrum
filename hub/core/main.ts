// Starts the hub core: database, local server, the chip adapter, and the
// announcement that lets phones find the hub on the station's network.

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, networkInterfaces } from 'node:os';
import { Bonjour } from 'bonjour-service';
import { Store } from './db.ts';
import { Hub } from './server.ts';
import { ChipAdapter } from './chip.ts';
import { StandIn } from './standin.ts';
import { SimulatedCrew } from './crew.ts';
import { NasaReplay } from './nasa.ts';
import { RoomAlarms } from './alarms.ts';
import { AlertWatcher } from './alerts.ts';
import { USUAL, roomAt } from '../engine/crew.ts';
import { Baselines } from './baseline.ts';
import { evidenceRoute, evidenceNow } from './evidence.ts';
import { ScenarioPlayer, listRecordings, loadRecording, scenarioRoute } from './scenario.ts';
import { handleBlood, demoBloodRows, loadInspiration4, INSPIRATION4_SOURCE } from './blood.ts';
import type { Profile } from '../engine/types.ts';
import { AiRuntime, handleAsk } from './ai.ts';
import { buildIndex } from '../engine/search.ts';
import type { Passage } from '../engine/search.ts';
import { parseCards } from '../engine/cards.ts';
import type { ParsedCards } from '../engine/cards.ts';
import { detectorLine } from '../engine/baseline.ts';
import type { Reading } from '../engine/prompt.ts';
import { LIMITS, windowAverage } from '../engine/cabin.ts';
import { t } from '../engine/strings.ts';
import { KIND_RANK } from '../engine/types.ts';
import type { Kind } from '../engine/types.ts';
import { SensorRegistry, handleSensors } from './sensors.ts';
import { SerialJsonAdapter } from './serial-json.ts';

const here = dirname(fileURLToPath(import.meta.url));
const hubDir = join(here, '..');
const port = Number(process.env.ASTRUM_PORT ?? 4310);
// The database lives in the user's app-data folder, not in the project: a
// synced folder (iCloud Desktop) copies a live database and can corrupt it.
const appData = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
  : process.platform === 'win32' ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
  : (process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'));
const dataDir = process.env.ASTRUM_DATA ?? join(appData, 'Astrum');

mkdirSync(dataDir, { recursive: true });
const profile = JSON.parse(readFileSync(join(hubDir, 'profiles', `${process.env.ASTRUM_PROFILE ?? 'mars-orbit'}.json`), 'utf8')) as Profile;
// The file name changes when the table's CHECK rules change: an older file keeps
// its old rules, so a new file is started rather than rewriting the old one.
const store = new Store(join(dataDir, 'astrum-3.sqlite'));
// ASTRUM_MODE=production: the hub makes no simulated value and keeps none. Anything else is demo mode.
const production = process.env.ASTRUM_MODE === 'production';
const hub = new Hub(store, profile, join(hubDir, 'ui', 'dist'), production);

const chip = new ChipAdapter(
  { rows: (rows) => void hub.ingest(rows), status: (status) => hub.setSource(status) },
  (id) => profile.chips[id] ?? null,
  process.env.ASTRUM_CHIP_PORT,
);

// Demo mode only: fill every room's gaps, so the station has each reading a real one would.
const standIn = production ? null : new StandIn(hub, profile.rooms.map((r) => r.id));hub.chipCommand = (command) => chip.send(command);

const crew = production ? null : new SimulatedCrew(hub, store, profile.crew.map((p) => p.id));
const nasa = production ? null : new NasaReplay(hub, store, join(hubDir, 'data-nasa', 'osdr-rr1'), profile.rooms.map((r) => r.id));
const alarms = new RoomAlarms(hub, store, profile.rooms.map((r) => r.id));
hub.acknowledgeAlarm = (room) => alarms.acknowledge(room);
const alerts = new AlertWatcher(hub, store, profile, alarms);
hub.answerAlert = (id, answer) => alerts.answer(id, answer);
hub.seeAlert = (id, by) => alerts.see(id, by);
const baselines = new Baselines(store, profile.crew.map((p) => p.id));
alerts.unusual = (now) => baselines.sustained(now);
hub.routes.push(evidenceRoute({ store, profile, baselines, alarms }));
// The recorded story ("npm run scenario"), played to every screen for filming. Production refuses it.
const scenarioDir = join(hubDir, 'ui', 'public', 'scenario');
const scenarios = new ScenarioPlayer({ hub, load: (id) => loadRecording(scenarioDir, id), list: () => listRecordings(scenarioDir) });
hub.routes.push(scenarioRoute(scenarios, production));

// Blood tests. The ranges are the medical lead's file; until it has entries, no result can be typed.
const bloodFile = process.env.ASTRUM_BLOOD ?? join(hubDir, 'medical', 'blood.json');
hub.routes.push((req, res, url) => handleBlood(req, res, url, { store, ingest: (rows) => hub.ingest(rows), bloodFile, crew: profile.crew.map((p) => p.id) }));
// Demo mode knows when the simulated crew sleeps: in their own quarters, 22:00 to 06:00.
if (!production) {
  alerts.asleep = (now) => {
    const date = new Date(now);
    const hour = date.getHours() + date.getMinutes() / 60;
    return profile.crew.map((p) => p.id).filter((id) => USUAL[id] && (hour < 6 || hour >= 22) && roomAt(id, hour) === USUAL[id].quarters);
  };
}

// The local model. It answers only from this person's readings and NASA's text; steps
// come from the medical lead's cards, chosen by rule. If the model or its server is
// missing, the hub runs without it and says so.
const ai = new AiRuntime();
void ai.start();
const passageIndex = buildIndex(JSON.parse(readFileSync(join(hubDir, 'data-nasa', 'passages', 'passages.json'), 'utf8')) as Passage[]);
const cardsFile = process.env.ASTRUM_CARDS ?? join(hubDir, 'medical', 'cards.json');
const loadCards = (): ParsedCards => { try { return parseCards(JSON.parse(readFileSync(cardsFile, 'utf8'))); } catch { return parseCards([]); } };
const CARD_SIGNAL: Record<string, string> = { co2: 'cabin_co2', pressure: 'cabin_pressure', temperature: 'cabin_temperature', humidity: 'cabin_humidity', noise: 'cabin_noise', light: 'cabin_light', oxygen: 'cabin_oxygen' };
const nameOf = (signal: string) => { const n = t(`signal.${signal}`, 'en'); return n === n.toUpperCase() ? n : n.toLowerCase(); };
const round1 = (v: number) => Math.round(v * 10) / 10;
const summaryOf = (person: string) => baselines.all(Date.now()).find((s) => s.person === person) ?? null;
const roomOf = (person: string) => store.stays(Date.now(), Date.now(), person).find((s) => s.until === null)?.room ?? null;
hub.routes.push((req, res, url) => handleAsk(req, res, url, {
  ai, index: passageIndex, cards: loadCards,
  readingsFor: (person) => {
    const p = profile.crew.find((c) => c.id === person);
    if (!p) return null;
    const now = Date.now();
    const readings: Reading[] = [];
    for (const s of summaryOf(person)?.signals ?? []) {
      if (s.status !== 'judged') continue;
      const label = (Object.keys(s.kinds) as Kind[]).sort((a, b) => KIND_RANK[b] - KIND_RANK[a])[0] ?? 'simulated';
      const unit = store.rows({ person, signal: s.signal, limit: 1 })[0]?.unit ?? '';
      readings.push({ type: 'normal', name: nameOf(s.signal), value: round1(s.recent), unit, label, normal: round1(s.usual), judged: s.unusual ? (s.direction === 'high' ? 'above' : 'below') : 'inside' });
    }
    const room = roomOf(person);
    if (room) for (const limit of LIMITS) {
      const avg = windowAverage(store.rows({ room, signal: limit.signal, from: now - limit.windowMs }), room, limit.signal, now, limit.windowMs);
      if (avg) readings.push({ type: 'limit', name: `cabin ${nameOf(limit.signal)}`, value: round1(avg.value), unit: limit.unit, label: avg.kind, window: '1-hour average', limit: limit.max });
    }
    return { name: p.name, readings };
  },
  detectorLineFor: (person) => { const s = summaryOf(person); return s ? detectorLine(s, Object.fromEntries(s.signals.map((x) => [x.signal, nameOf(x.signal)]))) : null; },
  facts: (person) => { const room = roomOf(person); return { readings: alarms.list().filter((a) => a.room === room).map((a) => ({ signal: CARD_SIGNAL[a.signal] ?? a.signal, direction: 'high' as const, basis: 'nasa_limit' as const, value: a.value, unit: a.unit })), answers: [] }; },
  // Not built yet: telling a crewmate "<name> needs someone with them", never the words.
  onCrisis: () => false,
  evidenceFor: (person) => evidenceNow(person, { store, profile, baselines, alarms }),
  roomName: (id) => { const r = profile.rooms.find((x) => x.id === id); return r ? t(r.name, 'en') : id; },
  personName: (id) => profile.crew.find((p) => p.id === id)?.name ?? id,
  pronounsOf: (id) => profile.crew.find((p) => p.id === id)?.pronouns,
}));

// Sensors the crew adds. Each one describes its signals; readings outside what the
// device can give are refused on arrival. Levels the crew sets are kept apart from NASA's.
const sensors = new SensorRegistry(join(dataDir, 'sensors.json'), profile);
const ingestRows = hub.ingest.bind(hub);
hub.ingest = (rows) => ingestRows(sensors.checkRows(rows));
hub.routes.push((req, res, url) => handleSensors(req, res, url, { store, registry: sensors, profile }));
const serialSensors = (process.env.ASTRUM_SENSOR_PORTS ?? '').split(',').filter(Boolean)
  .map((path) => new SerialJsonAdapter({ rows: (rows) => void hub.ingest(rows), status: (status) => hub.setSource(status) }, sensors, path));

hub.http.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`Port ${port} is taken: another Astrum hub is already running on this computer. Close it first.`);
  process.exit(1);
});

hub.http.listen(port, '0.0.0.0', () => {
  const addresses = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a!.address);
  console.log(`Astrum hub on http://localhost:${port} (${production ? 'production: no simulated values' : 'demo mode: gaps are filled with labelled simulated values'})`);
  for (const address of addresses) console.log(`  on the network: http://${address}:${port}`);
  chip.start();
  for (const sensor of serialSensors) sensor.start();
  crew?.start();
  // Demo mode, once: one crewmate shows a real Inspiration4 astronaut's blood values, labelled replayed.
  if (!production && store.lastTime(INSPIRATION4_SOURCE) == null) {
    const now = Date.now();
    hub.ingest(demoBloodRows(loadInspiration4(join(hubDir, 'data-nasa', 'inspiration4')), 'C001', 'okafor',
      [{ timepoint: 'L-3', t: now - 14 * 86_400_000 }, { timepoint: 'R+1', t: now - 2 * 86_400_000 }]));
  }
  nasa?.start();
  alarms.start();
  alerts.start();
  hub.startClock();
  // Give real sources a few seconds to answer before filling any gap.
  setTimeout(() => standIn?.start(), 5000);
});

let bonjour: Bonjour | null = null;
if (process.env.ASTRUM_NO_MDNS !== '1') {
  bonjour = new Bonjour();
  bonjour.publish({ name: 'Astrum hub', type: 'astrum', port });
}

function shutdown(): void {
  scenarios.stop();
  hub.stopClock();
  hub.buzz('off');
  chip.stop();
  for (const sensor of serialSensors) sensor.stop();
  crew?.stop();
  nasa?.stop();
  alarms.stop();
  alerts.stop();
  standIn?.stop();
  bonjour?.unpublishAll(() => bonjour?.destroy());
  hub.http.close();
  store.close();
  void ai.stop();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
