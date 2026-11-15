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

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
import { dayOf, hubProfileOf, profileOf } from '../engine/mission.ts';
import type { Mission } from '../engine/mission.ts';
import { listMissionFiles, loadAnyMission, loadMission, missionsRoute, nameCrewOnce, overrideFile, pickStartOnce } from './missions.ts';
import { EarthMail, earthRoute } from './earth.ts';
import { answerSignal, appliesAt, displayLangs, cardView } from '../engine/cards.ts';
import { FOLLOW_UP_FILE, askFirstFinding, decideFollowUp, givenFrom, nextFollowUp, parseFollowUps } from '../engine/followup.ts';
import type { AskFirst, FollowUpRow } from '../engine/followup.ts';
import type { Finding } from '../engine/alerts.ts';
import { askedHelpFinding } from '../engine/alerts.ts';
import { Baselines } from './baseline.ts';
import { EvidenceCards, evidenceRoute } from './evidence.ts';
import { CrewDose, doseRoute } from './dose.ts';
import { Retention } from './retention.ts';
import { ScenarioPlayer, listRecordings, loadRecording, scenarioRoute } from './scenario.ts';
import { Drill, drillRoute } from './drill.ts';
import { BaseEvents, eventsRoute } from './events.ts';
import { handleBlood, demoBloodRows, loadInspiration4, loadBloodFile, latestResults, INSPIRATION4_SOURCE } from './blood.ts';
import { CARD_FINDING_KEEP_MS, crisisFinding, findingsNow, parseLevelOverrides } from '../engine/medical.ts';
import type { LevelOverride } from '../engine/medical.ts';
import type { Profile } from '../engine/types.ts';
import { AiRuntime, handleAsk } from './ai.ts';
import { EarthReplies } from './earth-reply.ts';
import { EarthReports } from './earth-report.ts';
import { cloudReplyModel } from './earth-cloud.ts';
import { buildReport, reasonPhrase, reportDigest } from '../engine/earth-report.ts';
import { Threads } from '../engine/conversation.ts';
import { checkinRows } from '../engine/checkin.ts';
import { buildIndex } from '../engine/search.ts';
import type { Passage } from '../engine/search.ts';
import { parseCards } from '../engine/cards.ts';
import type { ParsedCards } from '../engine/cards.ts';
import { DEFAULTS as BASELINE_DEFAULTS, detectorLine, plainSignalName, summaryReadings } from '../engine/baseline.ts';
import type { Reading } from '../engine/prompt.ts';
import { LIMITS, QUIET_MS, windowAverage } from '../engine/cabin.ts';
import { t } from '../engine/strings.ts';
import { SensorRegistry, handleSensors } from './sensors.ts';
import { markFreshInstall, setupDone, setupRoute } from './setup.ts';
import { applyPendingReset, resetRoute } from './reset.ts';
import { withPortraits } from '../engine/portraits.ts';
import { SerialJsonAdapter } from './serial-json.ts';

const here = dirname(fileURLToPath(import.meta.url));
const hubDir = join(here, '..');
const port = Number(process.env.ASTRUM_PORT ?? 4310);
// The database lives in the user's app-data folder, not in the project (core/paths.ts).
const dataDir = appDataDir();

mkdirSync(dataDir, { recursive: true });
// "Reset Astrum" was pressed before this start (core/reset.ts): the stored data goes now, before anything is opened.
if (applyPendingReset(dataDir)) console.log('Reset: everything this hub had stored was erased. Starting at the first-run setup.');
// A hub started on an empty data folder still has its first-run setup to do (core/setup.ts).
markFreshInstall(dataDir);
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
  // A built-in place started for the first time (no override yet): in demo mode its example crew's mission start is
  // picked at random, so each place is at its own day; production keeps the file's or the crew's own date.
  const fresh = !existsSync(overrideFile(customDir, missionFile));
  // A built-in place other than the ship, started for the first time: its crew gets random first names, kept from then on.
  try { if (nameCrewOnce(missionsDir, customDir, missionFile)) console.log(`First start of "${missionFile}": its crew got new first names (Settings, Edit this place, to change them).`); } catch (err) { console.error((err as Error).message); }
  if (process.env.ASTRUM_MODE !== 'production') {
    try {
      const picked = pickStartOnce(missionsDir, customDir, missionFile, { fresh });
      if (picked) console.log(`First start of "${missionFile}": its example crew's mission start was picked at random, ${picked.slice(0, 10)} (Settings, Edit this place, to change it).`);
    } catch (err) { console.error((err as Error).message); }
  }
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
// The station clock: the hub's time zone, which the simulated crew keeps (core/crew.ts). The mission day turns at its midnight.
if (profile.mission) profile.mission.clockOffsetMinutes = -new Date().getTimezoneOffset();
if (!setupDone(dataDir)) profile.setupDone = false;
// Every crewmate carries a face in the state (engine/portraits.ts): their own, else the default pairing, so the hub's screens and the phone show the same one.
profile.crew = withPortraits(profile.crew);
/** Which room plays each part of the simulated crew's day. An old profile with no mission file keeps the ship's, as before. */
const places = mission ? placesOf(mission) : SHIP_PLACES;
const gravity = mission?.gravity ?? null;
const dbFile = databaseFile(dataDir, missionFile);
// ASTRUM_MODE=production: the hub makes no simulated value, keeps none, and reads none back from a file a demo-mode hub wrote. Anything else is demo mode.
const production = process.env.ASTRUM_MODE === 'production';
const store = new Store(dbFile, { realOnly: production });
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
hub.settleAlert = (id, by) => alerts.settle(id, by);
const baselines = new Baselines(store, profile.crew.map((p) => p.id));
alerts.unusual = (now) => baselines.sustained(now);
// Evidence cards are worked out in the background, one person per tick, and pushed to screens.
const cards = new EvidenceCards({ store, profile, baselines, alarms });
cards.onChange = (person, card) => hub.setEvidence(person, card);
alerts.onEvent = (event) => cards.refreshSoon(event.alert.person);
hub.routes.push(evidenceRoute(profile, cards));
// Each crewmate's radiation dose from the rooms they were in, worked out in the background once a minute.
const dose = new CrewDose(store, profile);
dose.onChange = (all) => hub.setDose(all);
hub.routes.push(doseRoute(profile, dose));
// Older readings become summaries by themselves, a slice at a time (core/retention.ts).
const retention = new Retention(store.handle);
// The recorded story ("npm run scenario"), played to every screen for filming. Production refuses it.
const scenarioDir = join(hubDir, 'ui', 'public', 'scenario');
const scenarios = new ScenarioPlayer({ hub, load: (id) => loadRecording(scenarioDir, id), list: () => listRecordings(scenarioDir) });
hub.routes.push(scenarioRoute(scenarios, production, missionFile));
// A drill: the real alert engine on a simulated reading, for one person (core/drill.ts). Demo mode only.
const drill = new Drill({
  profile, alarms, alerts, production,
  storyPlaying: () => scenarios.status().playing !== null,
  roomOf: (person, now) => store.stays(now, now, person).find((s) => s.until === null)?.room ?? null,
  soundBoard: () => hub.soundBoard(true),
});
hub.routes.push(drillRoute(drill));
// A base-wide event a crewmate declares (core/events.ts): one level 3 for everyone. A real report, so production too.
const baseEvents = new BaseEvents({
  profile, alerts,
  storyPlaying: () => scenarios.status().playing !== null,
  cardUsable: (id) => loadCards().cards.some((c) => c.id === id && displayLangs(c).length > 0 && appliesAt(c, gravity)),
  file: `${dbFile}.events.json`,
});
hub.routes.push(eventsRoute(baseEvents));
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

// "Reset Astrum" in Settings, production mode only (core/reset.ts): erases what is stored and starts at the setup again.
hub.routes.push(resetRoute({
  dataDir, production, supervised,
  restart: () => {
    console.log('Reset asked for: restarting to erase what is stored.');
    hub.sendToScreens({ type: 'restarting', to: 'reset' });
    shutdown(RESTART_CODE);
  },
}));

// The first-run setup saves the whole place at once and restarts the hub on it (core/setup.ts).
hub.routes.push(setupRoute({
  dir: missionsDir, customDir, dataDir, supervised, port,
  storyPlaying: () => scenarios.status().playing !== null,
  addresses: () => Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a!.address),
  restart: (to) => {
    console.log(`Setup saved: restarting on the mission "${to}".`);
    hub.sendToScreens({ type: 'restarting', to });
    shutdown(RESTART_CODE);
  },
}));

// Contact Earth: messages a crewmate writes. The simulated reply exists in demo mode only.
/** A room's name as screens show it (the string table, in English), never its key. */
const roomDisplayName = (id: string): string | null => {
  const room = profile.rooms.find((r) => r.id === id);
  return room ? t(room.name, 'en') : null;
};
// Each level 3 message to Earth carries an incident report: the hub's own facts at that moment (core/earth-report.ts).
alerts.reports = new EarthReports({
  file: `${dbFile}.earth-reports.json`,
  build: (alert, message, now) => buildReport({
    alert, message, now,
    mission: { name: missionFile ?? profile.id, day: (() => { try { return dayOf(profile, now); } catch { return null; } })(), lightDelaySeconds: profile.delayToEarthSeconds },
    roomName: (id) => roomDisplayName(id),
    personName: (id) => profile.crew.find((p) => p.id === id)?.name ?? null,
    signalName: (signal) => t(`signal.${signal}`, 'en'),
    roomRows: alert.room ? store.rows({ room: alert.room, from: now - QUIET_MS, to: now, limit: 5000 }) : [],
    // The person's own readings, never a check-in (typed or not): what the crew sees of them.
    bodyRows: store.rows({ person: alert.person, from: now - QUIET_MS, to: now, limit: 5000 }).filter((r) => !r.signal.startsWith('checkin.') && r.signal !== 'earth.message'),
    alarms: alarms.list(),
    card: (id) => {
      const c = loadCards().cards.find((x) => x.id === id);
      const v = c ? cardView(c, 'en') : null;
      return v ? { id: v.id, title: v.title, approvedBy: v.approvedBy, unverified: v.unverified } : null;
    },
    sources: hub.sourceList(),
    quietMs: QUIET_MS,
  }),
});

// Every reply is made by EarthReplies (core/earth-reply.ts), so the mail itself makes none.
const mail = new EarthMail({ store, delayMs: profile.delayToEarthSeconds * 1000, simulatedReply: null });
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

// Demo mode only: Earth's reply, simulated by the on-board model and labelled so (core/earth-reply.ts).
// ASTRUM_DEMO_EARTH_REPLY_SECONDS (demoEarthReplySeconds) shortens the wait for a filmed demo; unset, the mission's real delay.
const demoReplySeconds = Number(process.env.ASTRUM_DEMO_EARTH_REPLY_SECONDS);
const earthReplies = production ? null : new EarthReplies({
  messages: (now) => alerts.listedEarth(now),
  publish: () => alerts.publishEarth(Date.now()),
  storyPlaying: () => scenarios.status().playing !== null,
  restricted: (m) => {
    if (m.kind !== 'alert') return false;
    const alert = alerts.list().find((a) => a.earthId === m.id);
    return !alert || Boolean(alert.private) || m.report?.restricted === true;
  },
  // An alert's reply is written from its incident report: its room, its alert name, its card, and the hub's digest of it.
  facts: (m) => m.report && !m.report.restricted
    ? {
      room: m.report.where.roomName, alertKind: m.report.alert.name, card: m.report.card !== null, digest: reportDigest(m.report), report: true,
      place: t(profile.place, 'en'), reason: reasonPhrase(m.report.alert.reason),
      reading: (() => {
        const r = m.report.readings.find((x) => x.signal === m.about.signal);
        return r && r.value !== null ? { value: r.value, unit: r.unit, kind: r.kind, limit: r.limit } : null;
      })(),
    }
    : {
      room: m.about.room ? roomDisplayName(m.about.room) : null,
      alertKind: m.kind === 'alert' && m.about.signal ? t(`signal.${m.about.signal}`, 'en') : null,
      card: m.kind === 'alert' && Boolean(alerts.list().find((a) => a.earthId === m.id)?.card),
    },
  delayMs: profile.delayToEarthSeconds * 1000,
  demoSeconds: Number.isFinite(demoReplySeconds) && demoReplySeconds > 0 ? demoReplySeconds : null,
  rooms: profile.rooms.map((r) => t(r.name, 'en')),
  names: profile.crew.map((p) => p.name),
  // Demo only, and only when the key is in the environment at start: a cloud model tried first, from the same brief and checks.
  cloud: process.env.GROQ_API_KEY ? cloudReplyModel({ key: process.env.GROQ_API_KEY, model: process.env.ASTRUM_DEMO_EARTH_MODEL }) : null,
  model: {
    ready: () => ai.state === 'ready',
    chat: (messages) => ai.enqueue(() => ai.client.chat({ messages, maxTokens: 110, firstTokenMs: ai.firstTokenMs, totalMs: 20_000, stop: ['\n\n', '<think>'] }), () => {}),
  },
});
if (earthReplies) {
  alerts.decorateEarth = (list, now) => earthReplies.apply(list, now);
  earthReplies.start();
}
const passageIndex = buildIndex(JSON.parse(readFileSync(join(hubDir, 'data-nasa', 'passages', 'passages.json'), 'utf8')) as Passage[]);
const cardsFile = process.env.ASTRUM_CARDS ?? join(hubDir, 'medical', 'cards.json');
// Read again only when the file changes, so the alert watcher can look every tick.
let cardsCache: { mtimeMs: number; parsed: ParsedCards } | null = null;
const loadCards = (): ParsedCards => {
  try {
    const { mtimeMs } = statSync(cardsFile);
    if (cardsCache?.mtimeMs !== mtimeMs) cardsCache = { mtimeMs, parsed: parseCards(JSON.parse(readFileSync(cardsFile, 'utf8'))) };
    return cardsCache.parsed;
  } catch { return parseCards([]); }
};
// Her levels per situation (engine/medical.ts cardLevel), read again when the file or her cards change.
const overridesFile = join(hubDir, 'medical', 'level-overrides.json');
let overridesCache: { key: string; rows: LevelOverride[] } | null = null;
const loadLevelOverrides = (): LevelOverride[] => {
  try {
    const parsed = loadCards();
    const key = `${statSync(overridesFile).mtimeMs}:${cardsCache?.mtimeMs ?? ''}`;
    if (overridesCache?.key !== key) {
      const { overrides, problems } = parseLevelOverrides(JSON.parse(readFileSync(overridesFile, 'utf8')), parsed.cards);
      for (const p of problems) console.warn(p);
      overridesCache = { key, rows: overrides };
    }
    return overridesCache.rows;
  } catch { return []; }
};

// Her ask-first questions (medical/follow-up.json, engine/followup.ts), read again when the file or her cards change.
const followUpsFile = join(hubDir, 'medical', FOLLOW_UP_FILE);
let followUpsCache: { key: string; rows: FollowUpRow[] } | null = null;
const loadFollowUps = (): FollowUpRow[] => {
  try {
    const parsed = loadCards();
    const key = `${statSync(followUpsFile).mtimeMs}:${cardsCache?.mtimeMs ?? ''}`;
    if (followUpsCache?.key !== key) {
      const { rows, problems } = parseFollowUps(JSON.parse(readFileSync(followUpsFile, 'utf8')), parsed.cards);
      for (const p of problems) console.warn(p);
      followUpsCache = { key, rows };
    }
    return followUpsCache.rows;
  } catch { return []; }
};
/** One person's check-in answers of the last hour, newest per signal. */
const recentCheckins = (person: string, now = Date.now()) => store.rows({ person, signalPrefix: 'checkin.', from: now - CARD_FINDING_KEEP_MS, to: now });
/**
 * Her card questions a person has answered in the last hour, as facts for the card picker: a screen
 * posts the answer to /api/checkin under answerSignal(question), 1 yes, 0 no.
 */
const checkinAnswers = (person: string): { question: string; answer: string }[] => {
  const bySignal = new Map<string, string>();
  for (const c of loadCards().cards) for (const a of c.signs.answers) bySignal.set(answerSignal(a.question), a.question);
  const latest = new Map<string, { t: number; value: number | null }>();
  for (const r of recentCheckins(person)) {
    if (!bySignal.has(r.signal)) continue;
    const held = latest.get(r.signal);
    if (!held || r.t > held.t) latest.set(r.signal, { t: r.t, value: r.value });
  }
  const out: { question: string; answer: string }[] = [];
  for (const [signal, { value }] of latest) if (value === 1 || value === 0) out.push({ question: bySignal.get(signal)!, answer: value === 1 ? 'yes' : 'no' });
  return out;
};
// A card waiting for her questions, per person: once the answers meet a rule of hers, its level is raised (engine/followup.ts).
const askingFirst = new Map<string, { askFirst: AskFirst; t: number }>();
const askFirstFindings = (now: number): Finding[] => {
  const out: Finding[] = [];
  for (const [person, held] of askingFirst) {
    if (now - held.t > CARD_FINDING_KEEP_MS) { askingFirst.delete(person); continue; }
    const rows = loadFollowUps().filter((r) => held.askFirst.rows.includes(r.id));
    const finding = askFirstFinding({ ...held.askFirst, rule: decideFollowUp(rows, givenFrom(recentCheckins(person, now))) }, person);
    if (finding) out.push(finding);
  }
  return out;
};
// The next of her questions still waiting for a person, for their own screen only (core/server.ts refreshFollowUps).
hub.followUpOf = (person) => {
  const held = askingFirst.get(person);
  const now = Date.now();
  if (!held || now - held.t > CARD_FINDING_KEEP_MS) return null;
  const rows = loadFollowUps().filter((r) => held.askFirst.rows.includes(r.id));
  return nextFollowUp(person, rows, givenFrom(recentCheckins(person, now)), held.t);
};

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
    // Every card above is approved by the medical lead (her README: approved means the Portuguese, the
    // levels and who is alerted; not that the steps are sourced). Each card lists its sources (is_nasa
    // says which are NASA's) and what is unverified, for the screen to show beside the steps.
    approvedBy: 'medical_lead',
    // Her urgent card (xABCDE): shown beside any card on a level 3 alert (alert.alsoCard).
    urgentCard: 'unknown-urgent',
  };
  res.writeHead(200, { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }).end(JSON.stringify(body));
  return true;
});
// Her rules on the hub's own records (engine/medical.ts): SpO2 from the watches, blood results, "it did not get better".
// Worked out at most every 5 seconds; the blood file is read again only when it changes.
let bloodCache: { mtimeMs: number; entries: ReturnType<typeof loadBloodFile>['entries'] } | null = null;
const bloodEntries = () => {
  try {
    const { mtimeMs } = statSync(bloodFile);
    if (bloodCache?.mtimeMs !== mtimeMs) bloodCache = { mtimeMs, entries: loadBloodFile(bloodFile).entries };
    return bloodCache.entries;
  } catch { return []; }
};
let findingsCache: { at: number; findings: ReturnType<typeof findingsNow> } | null = null;
alerts.findings = (now) => {
  if (findingsCache && now - findingsCache.at < 5000 && now >= findingsCache.at) return findingsCache.findings;
  const entries = bloodEntries();
  const findings = findingsNow({
    people: crewIds, now, cards: loadCards().cards, entries,
    rowsOf: (person, signal, from) => store.rows({ person, signal, from, to: now }),
    latestBlood: Object.values(latestResults(store, entries)).flat().map((r) => r.row),
  });
  findings.push(...askFirstFindings(now));
  findingsCache = { at: now, findings };
  return findings;
};
// What a screen shows for the cards on an alert: her text as /api/cards gives it.
hub.cardViews = (ids, lang) => {
  const parsed = loadCards();
  return ids.map((id) => parsed.cards.find((c) => c.id === id)).filter((c) => !!c).map((c) => cardView(c, lang)).filter((v) => !!v);
};
const CARD_SIGNAL: Record<string, string> = { co2: 'cabin_co2', pressure: 'cabin_pressure', temperature: 'cabin_temperature', humidity: 'cabin_humidity', noise: 'cabin_noise', light: 'cabin_light', oxygen: 'cabin_oxygen' };
// A level the crew set brings a steps card only if one of hers names that signal, for this gravity.
alerts.cardFor = (signal) => loadCards().cards.find((c) => c.id !== 'unknown-urgent' && displayLangs(c).length > 0 && appliesAt(c, gravity)
  && c.signs.readings.some((r) => r.signal === (CARD_SIGNAL[signal] ?? signal)))?.id ?? null;
const nameOf = (signal: string) => { const n = plainSignalName(signal, t(`signal.${signal}`, 'en')); return n === n.toUpperCase() ? n : n.toLowerCase(); };
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
const askThreads = new Threads();
hub.routes.push((req, res, url) => handleAsk(req, res, url, {
  ai, index: passageIndex, cards: loadCards,
  readingsFor: (person) => {
    const p = profile.crew.find((c) => c.id === person);
    if (!p) return null;
    const now = Date.now();
    // Only readings inside their freshness window; a daily value is named with its time (engine/baseline.ts summaryReadings).
    const readings: Reading[] = summaryReadings(summaryOf(person), nameOf, (signal) => store.recent(0).find((r) => r.person === person && r.signal === signal)?.unit ?? '');
    const room = roomOf(person);
    if (room) readings.push(...limitReadings(room, true, now));
    return { name: p.name, readings };
  },
  detectorLineFor: (person) => { const s = summaryOf(person); return s ? detectorLine(s, Object.fromEntries(s.signals.map((x) => [x.signal, nameOf(x.signal)]))) : null; },
  // Only NASA's limits are "nasa_limit" facts: a level the crew set never matches her NASA-limit signs.
  facts: (person) => { const room = roomOf(person); return { readings: alarms.list().filter((a) => a.room === room && a.limitSource !== 'crew').map((a) => ({ signal: CARD_SIGNAL[a.signal] ?? a.signal, direction: 'high' as const, basis: 'nasa_limit' as const, value: a.value, unit: a.unit })), answers: checkinAnswers(person) }; },
  // A crisis: the medical officer (or the commander in her place) is told "<name> needs someone with them", never the words.
  onCrisis: (person) => { alerts.raise(crisisFinding(person), CARD_FINDING_KEEP_MS); return true; },
  // "Call for help" in the chat: the level 3 an answer of "help" brings, everyone told (engine/alerts.ts askedHelpFinding).
  onHelp: (person) => { alerts.raise(askedHelpFinding(person), CARD_FINDING_KEEP_MS); return true; },
  // A card her signs picked raises the alert her level gives; a private card's name stays with the person (engine/alerts.ts alertFor).
  onFinding: (finding, keepMs) => alerts.raise(finding, keepMs),
  levelOverrides: loadLevelOverrides,
  followUps: loadFollowUps,
  followUpAnswers: (person) => givenFrom(recentCheckins(person)),
  onAskFirst: (person, askFirst) => { askingFirst.set(person, { askFirst, t: Date.now() }); findingsCache = null; hub.refreshFollowUps(); },
  evidenceFor: (person) => cards.get(person),
  roomName: (id) => { const r = profile.rooms.find((x) => x.id === id); return r ? t(r.name, 'en') : id; },
  personName: (id) => profile.crew.find((p) => p.id === id)?.name ?? id,
  pronounsOf: (id) => profile.crew.find((p) => p.id === id)?.pronouns,
  gravity,
  quartersOf: (id) => places[id]?.quarters ?? null,
  roomReadings: (room) => limitReadings(room, false),
  // Each crewmate's conversation with Astra, kept here for 30 minutes of quiet (engine/conversation.ts).
  threads: askThreads,
  crew: () => profile.crew.map((p) => ({ id: p.id, name: p.name })),
  // The shared screen's room questions (askShared): each room's id and English name.
  rooms: () => profile.rooms.map((r) => ({ id: r.id, name: t(r.name, 'en') })),
  // Whether a body signal has a current reading, by the baseline's own freshness rule: a question about one
  // that has gone quiet gets "I have no … reading from the last hour; the last one was at …".
  signalState: (person, signal) => {
    const s = summaryOf(person)?.signals.find((x) => x.signal === signal);
    if (!s) return { state: 'none' };
    if (s.status !== 'no-recent') return { state: 'fresh' };
    return s.lastSeen === null ? { state: 'none' } : { state: 'stale', at: s.lastSeen, live: BASELINE_DEFAULTS.liveSignals.includes(signal) };
  },
  // A reply to one of her questions in the chat: the same reported check-in row POST /api/checkin makes.
  storeCheckin: (person, answer) => {
    const made = checkinRows({ person, answers: [answer] }, crewIds, Date.now(), roomOf);
    if ('error' in made) return false;
    return hub.ingest(made.rows).length > 0;
  },
}));

// Sensors the crew adds. Each one describes its signals; readings outside what the
// device can give are refused on arrival. Levels the crew sets are kept apart from NASA's.
const sensors = new SensorRegistry(sensorsFile(dataDir, missionFile), profile);
alarms.crewSensors = () => sensors.list();
let shuttingDown = false;
const ingestRows = hub.ingest.bind(hub);
// A board can still deliver a buffered line after it is told to stop; once the hub is closing, nothing is stored.
hub.ingest = (rows) => (shuttingDown ? [] : ingestRows(sensors.checkRows(rows)));
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
  dose.start();
  retention.start();
  // Give real sources a few seconds to answer before filling any gap.
  setTimeout(() => standIn?.start(), 5000);
});

let bonjour: Bonjour | null = null;
if (process.env.ASTRUM_NO_MDNS !== '1') {
  bonjour = new Bonjour();
  bonjour.publish({ name: 'Astrum hub', type: 'astrum', port });
}


/** Stops everything, the model server included, then exits with `code` (RESTART_CODE asks core/run.ts to start the hub again). */
function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  scenarios.stop();
  drill.stop();
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
  dose.stop();
  retention.stop();
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
