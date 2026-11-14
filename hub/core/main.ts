// Starts the hub core: database, local server, the chip adapter, and the
// announcement that lets phones find the hub on the station's network.
//
// The hub runs one mission file (hub/profiles/missions): ASTRUM_MISSION=
// ship-mars-orbit (the default), iss, base-mars or base-moon, or a mission the
// crew made (core/missions.ts). Without ASTRUM_MISSION it runs the place chosen
// on screen (Settings), which restarts it through core/run.ts. Everything about
// the place comes from it: rooms, crew, where each sleeps and works, the
// sensor board's room, the delay to Earth and the gravity. Each mission keeps
// its own database. ASTRUM_PROFILE=<file> still runs an old profile file from
// hub/profiles instead, as before.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { Bonjour } from 'bonjour-service';
import { Store } from './db.ts';
import { SHIP_MISSION, dataDir as appDataDir, customMissionsDir, databaseFile, lockFile, missionLock, missionName, sensorsFile } from './paths.ts';
import { RESTART_CODE, SUPERVISED_ENV } from './run.ts';
import { Hub } from './server.ts';
import { ChipAdapter } from './chip.ts';
import { StandIn } from './standin.ts';
import { SimulatedCrew } from './crew.ts';
import { NasaReplay } from './nasa.ts';
import { RoomAlarms } from './alarms.ts';
import { AlertWatcher, crewActivity } from './alerts.ts';
import { SHIP_PLACES, placesOf } from '../engine/crew.ts';
import { hubProfileOf, profileOf } from '../engine/mission.ts';
import type { Mission } from '../engine/mission.ts';
import { listMissionFiles, loadAnyMission, loadMission, missionsRoute, nameCrewOnce } from './missions.ts';
import { EarthMail, earthRoute } from './earth.ts';
import { SIM_REPLY_KEY } from '../engine/earth.ts';
import { appliesAt, displayLangs, cardView } from '../engine/cards.ts';
import { Baselines } from './baseline.ts';
import { EvidenceCards, evidenceRoute } from './evidence.ts';
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
// The database lives in the user's app-data folder, not in the project (core/paths.ts).
const dataDir = appDataDir();

mkdirSync(dataDir, { recursive: true });
const missionsDir = join(hubDir, 'profiles', 'missions');
const customDir = customMissionsDir(dataDir);
let missionFile = missionName(dataDir);
let mission: Mission | null = null;
let profile: Profile;
if (missionFile === null) {
  // An old profile file, as before. If a mission file describes the same place, its crew's day and gravity are used.
  profile = JSON.parse(readFileSync(join(hubDir, 'profiles', `${process.env.ASTRUM_PROFILE}.json`), 'utf8')) as Profile;
  for (const file of listMissionFiles(missionsDir)) {
    try {
      const m = loadMission(missionsDir, file);
      if (JSON.stringify(profileOf(m)) === JSON.stringify(profile)) { mission = m; break; }
    } catch { /* a file that cannot run is not this place */ }
  }
} else {
  // A built-in place other than the ship, started for the first time: its crew gets random first names, kept from then on.
  try { if (nameCrewOnce(missionsDir, customDir, missionFile)) console.log(`First start of "${missionFile}": its crew got new first names (Settings, Edit this place, to change them).`); } catch (err) { console.error((err as Error).message); }
  try {
    mission = loadAnyMission(missionsDir, customDir, missionFile);
  } catch (err) {
    console.error((err as Error).message);
    // A place chosen on screen that can no longer run (deleted, edited by hand) falls back to the ship; ASTRUM_MISSION never does.
    if (process.env.ASTRUM_MISSION) process.exit(1);
    console.error(`Running the ship (${SHIP_MISSION}) instead.`);
    missionFile = SHIP_MISSION;
    mission = loadMission(missionsDir, missionFile);
  }
  profile = hubProfileOf(mission, missionFile);
}
/** Which room plays each part of the simulated crew's day. An old profile with no mission file keeps the ship's, as before. */
const places = mission ? placesOf(mission) : SHIP_PLACES;
const gravity = mission?.gravity ?? null;
const dbFile = databaseFile(dataDir, missionFile);
const store = new Store(dbFile);
// ASTRUM_MODE=production: the hub makes no simulated value and keeps none. Anything else is demo mode.
const production = process.env.ASTRUM_MODE === 'production';
const hub = new Hub(store, profile, join(hubDir, 'ui', 'dist'), production);

const chip = new ChipAdapter(
  { rows: (rows) => void hub.ingest(rows), status: (status) => hub.setSource(status) },
  (id) => profile.chips[id] ?? null,
  process.env.ASTRUM_CHIP_PORT,
);

// Demo mode only: fill every room's gaps, so the station has each reading a real one would.
const standIn = production ? null : new StandIn(hub, profile.rooms.map((r) => r.id), Math.random, mission ? { mission, stays: store } : null);hub.chipCommand = (command) => chip.send(command);

const crew = production ? null : new SimulatedCrew(hub, store, profile.crew.map((p) => p.id), undefined, places);
// The story's room is the first crewmate's quarters: on the ship, Quarters 2.
const subjectRoom = places[profile.crew[0]?.id]?.quarters ?? null;
const nasa = production ? null : new NasaReplay(hub, store, join(hubDir, 'data-nasa', 'osdr-rr1'), profile.rooms.map((r) => r.id), subjectRoom);
const alarms = new RoomAlarms(hub, store, profile.rooms.map((r) => r.id));
hub.acknowledgeAlarm = (room) => alarms.acknowledge(room);
const alerts = new AlertWatcher(hub, store, profile, alarms);
hub.answerAlert = (id, answer) => alerts.answer(id, answer);
hub.seeAlert = (id, by) => alerts.see(id, by);
const baselines = new Baselines(store, profile.crew.map((p) => p.id));
alerts.unusual = (now) => baselines.sustained(now);
// Evidence cards are worked out in the background, one person per tick, and pushed to screens.
const cards = new EvidenceCards({ store, profile, baselines, alarms });
cards.onChange = (person, card) => hub.setEvidence(person, card);
alerts.onEvent = (event) => cards.refreshSoon(event.alert.person);
hub.routes.push(evidenceRoute(profile, cards));
// The recorded story ("npm run scenario"), played to every screen for filming. Production refuses it.
const scenarioDir = join(hubDir, 'ui', 'public', 'scenario');
const scenarios = new ScenarioPlayer({ hub, load: (id) => loadRecording(scenarioDir, id), list: () => listRecordings(scenarioDir) });
hub.routes.push(scenarioRoute(scenarios, production, missionFile));
// Choosing the place on screen restarts the hub; that needs the supervisor (core/run.ts) to start it again.
const supervised = process.env[SUPERVISED_ENV] === '1';
hub.routes.push(missionsRoute(missionsDir, missionFile, missionFile === null ? process.env.ASTRUM_PROFILE ?? null : null, {
  customDir, dataDir, locked: missionLock(), supervised, mode: production ? 'production' : 'demo',
  storyPlaying: () => scenarios.status().playing !== null,
  hasHistory: (id) => existsSync(databaseFile(dataDir, id)),
  restart: (to) => {
    console.log(`Restarting on the mission "${to}".`);
    hub.sendToScreens({ type: 'restarting', to });
    shutdown(RESTART_CODE);
  },
}));

// Contact Earth: messages a crewmate writes. The simulated reply exists in demo mode only.
const mail = new EarthMail({ store, delayMs: profile.delayToEarthSeconds * 1000, simulatedReply: production ? null : t(SIM_REPLY_KEY, 'en') });
mail.load();
alerts.crewMessages = (now) => mail.list(now);
mail.onChange = () => alerts.publishEarth(Date.now());
hub.routes.push(earthRoute({ mail, crew: profile.crew.map((p) => p.id), delaySeconds: profile.delayToEarthSeconds, messages: () => alerts.allEarth(Date.now()) }));

// Blood tests. The ranges are the medical lead's file; until it has entries, no result can be typed.
const bloodFile = process.env.ASTRUM_BLOOD ?? join(hubDir, 'medical', 'blood.json');
hub.routes.push((req, res, url) => handleBlood(req, res, url, { store, ingest: (rows) => hub.ingest(rows), bloodFile, crew: profile.crew.map((p) => p.id) }));
// What each crewmate is doing (and so who is asleep): a real person's from their phone's own
// readings; in demo mode the simulated crew's from its day, on this computer's clock as the crew keeps it.
const crewIds = profile.crew.map((p) => p.id);
const simulatedDay = production ? null : { places, offsetMinutes: -new Date().getTimezoneOffset() };
alerts.activity = (now) => crewActivity(store, crewIds, now, simulatedDay);

// The local model. It answers only from this person's readings and NASA's text; steps
// come from the medical lead's cards, chosen by rule. If the model or its server is
// missing, the hub runs without it and says so.
const ai = new AiRuntime();
void ai.start();
const passageIndex = buildIndex(JSON.parse(readFileSync(join(hubDir, 'data-nasa', 'passages', 'passages.json'), 'utf8')) as Passage[]);
const cardsFile = process.env.ASTRUM_CARDS ?? join(hubDir, 'medical', 'cards.json');
const loadCards = (): ParsedCards => { try { return parseCards(JSON.parse(readFileSync(cardsFile, 'utf8'))); } catch { return parseCards([]); } };

// The steps cards, for the screens that show them. Only approved cards are sent as
// steps; drafts are listed by name so a screen can say "not approved yet". Re-read on
// every request, so a new export from the medical lead needs no restart.
hub.routes.push(async (req, res, url) => {
  if (url.pathname !== '/api/cards' || req.method !== 'GET') return false;
  const lang = url.searchParams.get('lang') === 'pt' ? 'pt' : 'en';
  const parsed = loadCards();
  const body = {
    lang,
    cards: parsed.cards.map((card) => cardView(card, lang)).filter(Boolean),
    // Approved, but not readable in this language yet (the other language is shown instead).
    otherLanguageOnly: parsed.cards.filter((card) => !cardView(card, lang)).map((card) => ({ id: card.id, langs: displayLangs(card) })),
    notApproved: parsed.notApproved,
    problems: parsed.problems,
  };
  res.writeHead(200, { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }).end(JSON.stringify(body));
  return true;
});
const CARD_SIGNAL: Record<string, string> = { co2: 'cabin_co2', pressure: 'cabin_pressure', temperature: 'cabin_temperature', humidity: 'cabin_humidity', noise: 'cabin_noise', light: 'cabin_light', oxygen: 'cabin_oxygen' };
// A level the crew set brings a steps card only if one of hers names that signal, for this gravity.
alerts.cardFor = (signal) => loadCards().cards.find((c) => c.id !== 'unknown-urgent' && displayLangs(c).length > 0 && appliesAt(c, gravity)
  && c.signs.readings.some((r) => r.signal === (CARD_SIGNAL[signal] ?? signal)))?.id ?? null;
const nameOf = (signal: string) => { const n = t(`signal.${signal}`, 'en'); return n === n.toUpperCase() ? n : n.toLowerCase(); };
const round1 = (v: number) => Math.round(v * 10) / 10;
// The summaries the alert watcher keeps fresh; computed here only before the first.
const summaryOf = (person: string) => baselines.cached(person) ?? baselines.refresh(person, Date.now());
const roomOf = (person: string) => store.stays(Date.now(), Date.now(), person).find((s) => s.until === null)?.room ?? null;
/** One room's current 1-hour averages against NASA's limits, as the hub's readings for the answer. */
const limitReadings = (room: string, here: boolean, now = Date.now()): Extract<Reading, { type: 'limit' }>[] => {
  const out: Extract<Reading, { type: 'limit' }>[] = [];
  for (const limit of LIMITS) {
    const avg = windowAverage(store.rows({ room, signal: limit.signal, from: now - limit.windowMs }), room, limit.signal, now, limit.windowMs);
    if (avg) out.push({ type: 'limit', name: `cabin ${nameOf(limit.signal)}`, value: round1(avg.value), unit: limit.unit, label: avg.kind, window: '1-hour average', limit: limit.max, room, here });
  }
  return out;
};
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
      const unit = store.recent(0).find((r) => r.person === person && r.signal === s.signal)?.unit ?? '';
      readings.push({ type: 'normal', name: nameOf(s.signal), value: round1(s.recent), unit, label, normal: round1(s.usual), judged: s.unusual ? (s.direction === 'high' ? 'above' : 'below') : 'inside' });
    }
    const room = roomOf(person);
    if (room) readings.push(...limitReadings(room, true, now));
    return { name: p.name, readings };
  },
  detectorLineFor: (person) => { const s = summaryOf(person); return s ? detectorLine(s, Object.fromEntries(s.signals.map((x) => [x.signal, nameOf(x.signal)]))) : null; },
  // Only NASA's limits are "nasa_limit" facts: a level the crew set never matches her NASA-limit signs.
  facts: (person) => { const room = roomOf(person); return { readings: alarms.list().filter((a) => a.room === room && a.limitSource !== 'crew').map((a) => ({ signal: CARD_SIGNAL[a.signal] ?? a.signal, direction: 'high' as const, basis: 'nasa_limit' as const, value: a.value, unit: a.unit })), answers: [] }; },
  // Not built yet: telling a crewmate "<name> needs someone with them", never the words.
  onCrisis: () => false,
  evidenceFor: (person) => cards.get(person),
  roomName: (id) => { const r = profile.rooms.find((x) => x.id === id); return r ? t(r.name, 'en') : id; },
  personName: (id) => profile.crew.find((p) => p.id === id)?.name ?? id,
  pronounsOf: (id) => profile.crew.find((p) => p.id === id)?.pronouns,
  gravity,
  quartersOf: (id) => places[id]?.quarters ?? null,
  roomReadings: (room) => limitReadings(room, false),
}));

// Sensors the crew adds. Each one describes its signals; readings outside what the
// device can give are refused on arrival. Levels the crew sets are kept apart from NASA's.
const sensors = new SensorRegistry(sensorsFile(dataDir, missionFile), profile);
alarms.crewSensors = () => sensors.list();
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
  // Tells "npm run compact" a hub has this database open. Written once this hub is surely the one running.
  writeFileSync(lockFile(dbFile), String(process.pid));
  const addresses = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a!.address);
  console.log(`Astrum hub on http://localhost:${port} (${production ? 'production: no simulated values' : 'demo mode: gaps are filled with labelled simulated values'})`);
  console.log(`  mission: ${missionFile ?? `profile ${process.env.ASTRUM_PROFILE}`} (${profile.rooms.length} rooms, gravity ${gravity ?? 'unknown'} g, ${profile.delayToEarthSeconds} s to Earth), database ${dbFile}`);
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
  cards.start();
  // Give real sources a few seconds to answer before filling any gap.
  setTimeout(() => standIn?.start(), 5000);
});

let bonjour: Bonjour | null = null;
if (process.env.ASTRUM_NO_MDNS !== '1') {
  bonjour = new Bonjour();
  bonjour.publish({ name: 'Astrum hub', type: 'astrum', port });
}

let shuttingDown = false;

/** Stops everything, the model server included, then exits with `code` (RESTART_CODE asks core/run.ts to start the hub again). */
function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  scenarios.stop();
  mail.stop();
  hub.stopClock();
  hub.buzz('off');
  chip.stop();
  for (const sensor of serialSensors) sensor.stop();
  crew?.stop();
  nasa?.stop();
  alarms.stop();
  alerts.stop();
  cards.stop();
  standIn?.stop();
  bonjour?.unpublishAll(() => bonjour?.destroy());
  hub.http.close();
  hub.http.closeAllConnections();
  store.close();
  rmSync(lockFile(dbFile), { force: true });
  // The model server is a child of this process: wait for it to go (at most 5 s), so a restart finds its port free.
  const stopped = Promise.race([ai.stop(), new Promise((r) => setTimeout(r, 5000))]);
  void stopped.then(() => setTimeout(() => process.exit(code), code === 0 ? 0 : 100));
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
