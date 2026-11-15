// Finds the NASA passages that answer a crew question. Keyword search (BM25)
// over NASA's own text, with a small table that turns crew words into the words
// NASA uses, and a tolerance for typos. No I/O and no model: the caller loads
// the passages (data-nasa/passages/passages.json) and builds the index once.
//
// When nothing in the library is close enough, the answer is "nothing found",
// so the hub sends "(no passages)" instead of a weak match.

import { LIMITS } from './cabin.ts';

export interface Passage {
  id: string;
  source: string;
  url: string;
  fetched: string;
  heading: string;
  text: string;
  page?: number;
}

export interface Hit {
  id: string;
  score: number;
  /** Short fixed source name for the prompt, e.g. "NASA-STD-3001 CO2 Technical Brief". */
  name: string;
  passage: Passage;
}

export type SearchResult =
  | { found: true; hits: Hit[] }
  | { found: false; hits: []; reason: string };

export interface SearchOptions {
  /** Names of the readings in play ("CO2", "sleep"). They re-rank, they never find a passage alone. */
  readings?: string[];
  /** At most this many passages (default 2, never more than 3). */
  limit?: number;
}

/** Below this score the best passage is not an answer. Set from the test table in search.test.ts. */
export const SCORE_FLOOR = 4;
/** Share of the question's weight the best passage must match. */
export const COVER_FLOOR = 0.5;
/** A second or third passage must score at least this share of the first. */
const KEEP_RATIO = 0.6;
const K1 = 1.2;
const B = 0.75;
/** Heading and page title count this many times over the body. */
const TITLE_BOOST = 2;

interface Doc {
  passage: Passage;
  tf: Map<string, number>;
  len: number;
}

export interface SearchIndex {
  docs: Doc[];
  df: Map<string, number>;
  avgLen: number;
  maxIdf: number;
}

/** One idea in the question: the words that can stand for it in NASA's text, with their weight. */
interface Concept {
  alts: Map<string, number>;
}

const STOP = new Set(`
a about above after again all also am an and any are around as at be because been before being below between both but by
can could did do does doing down during each few for from further get gets getting got had has have having he her here hers
him his how i if in into is it its itself just know let like ll lot me more most much my myself no nor not now of off on
once only or other our ours out over own please re really right same she should so some such than that the their them then
there these they this those through to too under until up us ve very want was we were what when where which while who whom
why will with would you your yours okay ok hey normal thing things feel feels feeling felt today keep keeps kept still bit
happen happening happens going go goes maybe even something anything ever anyone need needs whats im ive id dont doesnt
isnt arent wasnt cant wont didnt shouldnt thats theres youre were kind sort lately recently every day days week weeks
first time times make makes made take takes took many long little ok yeah also supposed often lot lots tell say said
gonna wanna should normally usually guess bad good worse better wrong fine since ago yet
astronaut astronauts space spaceflight nasa crew crews crewmember crewmembers member members mission missions
`.split(/\s+/).filter(Boolean));

/**
 * Crew words → NASA words. Keys are matched as whole words or phrases in the
 * lowercased question and replaced by the NASA words. Words after "|" are
 * weaker: they bring in related passages without outranking the direct ones.
 */
const SYNONYMS: [string[], string][] = [
  [['headache', 'headaches', 'head hurts', 'head hurt', 'head is pounding', 'head pounding', 'migraine', 'head ache'], 'headache headaches | co2 hypercapnia'],
  [['carbon dioxide', 'co2', 'c02'], 'co2 carbon dioxide ppco2'],
  [['cant sleep', 'cannot sleep', 'couldnt sleep', 'can not sleep', 'insomnia', 'sleepless', 'not sleeping', 'trouble sleeping', 'awake at night', 'fall asleep', 'fall back asleep', 'stay asleep', 'asleep', 'sleep', 'sleeping', 'slept'], 'sleep | sleep-wake light-dark schedules circadian'],
  [['sunrise', 'sunrises', 'sunset', 'sunsets', 'sun', 'sunlight', 'day and night', 'night and day', 'light', 'lights', 'dark'], 'sunrises sunsets light-dark | sleep-wake'],
  [['tired', 'exhausted', 'fatigue', 'fatigued', 'worn out', 'sleepy', 'drained', 'no energy', 'wiped out', 'wiped'], 'fatigue malaise | sleep'],
  [['dizzy', 'dizziness', 'vertigo', 'disoriented', 'spinning', 'off balance', 'balance'], 'motion sickness disorientation | orient vestibular'],
  [['nausea', 'nauseous', 'nauseated', 'queasy', 'throw up', 'throwing up', 'vomit', 'vomiting', 'puke', 'space sick', 'spacesick', 'motion sick', 'motion sickness'], 'motion sickness nausea'],
  [['blurry', 'blurred', 'blurry vision', 'vision', 'eyesight', 'see clearly', 'eye', 'eyes'], 'vision eyes eye | optic sans'],
  [['sad', 'depressed', 'depression', 'lonely', 'loneliness', 'homesick', 'isolated', 'isolation', 'feeling down', 'low mood', 'mood', 'miserable', 'cooped up', 'trapped', 'confined', 'stuck in here', 'stuck', 'tin can', 'mess with my head', 'mess with your head', 'messing with my head'], 'isolation confinement depression | psychological mental behavioral'],
  [['anxious', 'anxiety', 'stressed', 'stress', 'panic', 'worried', 'nervous', 'burnout', 'burned out'], 'anxiety stressors | psychological mental burnout'],
  [['argue', 'arguing', 'argument', 'fight', 'fighting', 'conflict', 'crewmate', 'crewmates', 'annoying', 'getting along', 'get along', 'tension', 'team'], 'teamwork conflicts tensions | team'],
  [['heart racing', 'heart races', 'heart is racing', 'racing heart', 'palpitations', 'heartbeat', 'heart beat', 'irregular heartbeat', 'arrhythmia', 'arrythmia', 'skipped beat', 'skipping beats', 'heart rate', 'pulse', 'heart', 'chest'], 'heart arrythmias | cardiovascular blood'],
  [['faint', 'fainting', 'fainted', 'lightheaded', 'light headed', 'blood pressure', 'stand up', 'standing up'], 'fainting blood pressure | cardiovascular'],
  [['bone', 'bones', 'fracture', 'broken bone', 'osteoporosis', 'bone density', 'brittle'], 'bone bones | density fracture fractures'],
  [['exercise', 'exercising', 'workout', 'work out', 'working out', 'gym', 'treadmill', 'training', 'train', 'muscle', 'muscles', 'strength', 'weak', 'legs', 'fitness', 'fit', 'lift', 'lifting'], 'exercise fitness muscle | resistance aerobic'],
  [['drop', 'lose', 'losing', 'loss', 'decline', 'decrease', 'weaker', 'shrink'], 'loss losses lose'],
  [['air', 'stuffy', 'stale', 'scrubber', 'scrubbers', 'scrubbing', 'filter', 'ventilation', 'fan', 'cdra'], 'removal scrubbing | co2 cdra ventilation'],
  [['max', 'maximum', 'limit', 'limits', 'allowed', 'safe level', 'safe', 'threshold', 'how high', 'too high', 'under', 'over', 'above', 'dangerous', 'danger', 'harmful', 'unsafe'], 'limit limits | requirement mmhg'],
  [['low oxygen', 'oxygen', 'o2', 'thin air', 'altitude', 'altitude sickness', 'hypoxia', 'hypoxic', 'short of breath', 'shortness of breath', 'breathless', 'cant breathe', 'breathe', 'breathing', 'cabin pressure', 'pressure'], 'hypoxia oxygen | depressurization pressure'],
  [['the bends', 'bends', 'decompression', 'joint pain', 'tingling'], 'decompression sickness bends'],
  [['spacewalk', 'spacewalks', 'eva', 'evas', 'suit', 'spacesuit'], 'spacewalk spacewalks | spacesuit extravehicular'],
  [['radiation', 'solar flare', 'solar storm', 'cosmic rays', 'cosmic ray', 'radiation dose', 'dosimeter', 'sievert', 'sieverts'], 'radiation | solar cosmic'],
  [['cancer', 'tumor', 'tumour', 'long term', 'longterm'], 'cancer cancers carcinogenesis'],
  [['cold sore', 'cold sores', 'rash', 'rashes', 'allergy', 'allergies', 'infection', 'infections', 'flu', 'virus', 'immune', 'immunity', 'shingles'], 'immune infections viruses allergies rashes'],
  [['food', 'eat', 'eating', 'meal', 'meals', 'appetite', 'hungry', 'bland', 'taste', 'diet', 'menu', 'nutrition'], 'food nutrition | menu diet'],
  [['message', 'messages', 'call home', 'call earth', 'delay', 'lag', 'talk to earth', 'mission control', 'signal', 'reply', 'contact earth'], 'communication delay | earth'],
  [['germs', 'bacteria', 'microbes', 'mold', 'mould', 'dirty', 'hygiene', 'clean'], 'microbes microorganism | microbiome infections'],
  [['gravity', 'weightless', 'weightlessness', 'zero g', 'zero gravity', 'microgravity', 'floating'], 'gravity microgravity weightlessness'],
  [['think', 'thinking', 'think straight', 'think clearly', 'focus', 'concentrate', 'concentration', 'foggy', 'brain fog', 'confused', 'confusion', 'dumb', 'memory', 'forgetful', 'decisions'], 'cognitive cognition | confusion decision-making concentration'],
  [['taller', 'height', 'grow', 'spine', 'back pain'], 'spine spines height'],
  [['landing', 'land', 'touchdown', 'reentry', 're-entry'], 'landing land'],
];

// ---------- text ----------

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ']/g, '')
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9-]+/g, ' ')
    .trim();
}

function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** Words of a text as index terms. Hyphenated words count whole and by their parts. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const raw of normalize(text).split(/\s+/)) {
    if (!raw) continue;
    const parts = raw.split('-').filter(Boolean);
    const words = parts.length > 1 ? [parts.join(''), ...parts] : parts;
    for (const w of words) {
      const t = stem(w);
      if (!STOP.has(w) && !STOP.has(t)) out.push(t);
    }
  }
  return out;
}

// ---------- index ----------

export function buildIndex(passages: Passage[]): SearchIndex {
  const docs: Doc[] = [];
  const df = new Map<string, number>();
  for (const passage of passages) {
    const tf = new Map<string, number>();
    const body = terms(passage.text);
    const title = terms(`${passage.source} ${passage.heading}`);
    for (const t of body) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of title) tf.set(t, (tf.get(t) ?? 0) + TITLE_BOOST);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    docs.push({ passage, tf, len: body.length + title.length * TITLE_BOOST });
  }
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(docs.length, 1);
  const index: SearchIndex = { docs, df, avgLen, maxIdf: 0 };
  index.maxIdf = idf(index, '');
  return index;
}

function idf(index: SearchIndex, term: string): number {
  const n = index.docs.length;
  const d = index.df.get(term) ?? 0;
  return Math.log(1 + (n - Math.max(d, 1) + 0.5) / (Math.max(d, 1) + 0.5));
}

// ---------- question ----------

/** Edit distance with adjacent swaps, stopping early past `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) rows.push([i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
      rows[i][j] = v;
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
  }
  return rows[a.length][b.length];
}

/** The closest index term to a word NASA never uses, if the word looks like a typo of it. */
function nearest(index: SearchIndex, word: string): string | null {
  if (word.length < 4) return null;
  const max = word.length >= 7 ? 2 : 1;
  let best: string | null = null;
  let bestD = max + 1;
  let bestDf = 0;
  for (const [t, d] of index.df) {
    if (Math.abs(t.length - word.length) > max) continue;
    const dist = distance(word, t, max);
    if (dist < bestD || (dist === bestD && d > bestDf)) {
      best = t;
      bestD = dist;
      bestDf = d;
    }
  }
  return bestD <= max ? best : null;
}

/**
 * How a crewmate frames a question, not what it is about: "why do I keep
 * waking up with", "what does it mean that", "in my room". These never count
 * against a question. They are ignored only after the synonym table has had
 * its turn, so "fall asleep" or "gym" still mean something. Words NASA's text
 * doesn't use that ARE the topic ("melatonin", "toilet") still count, so a
 * question the library can't answer still finds nothing.
 */
const FRAMING_PHRASES = [
  'what does it mean that', 'what does it mean when', 'is it normal that', 'is that normal', 'is this normal', 'is it bad that',
  'whats going on', 'worried about', 'worry about', 'worried that', 'scared that', 'afraid that', 'in here',
];
const FRAMING = new Set(`
mean means meaning meant wake wakes waking woke woken morning mornings evening evenings night nights tonight tomorrow yesterday
room rooms lab galley quarters bunk bed module habitat station hurt hurts hurting harm making starts start starting started
actually basically literally anymore constantly always sometimes turn turning launched launch every
two three four five six seven eight nine ten twelve
`.split(/\s+/).filter(Boolean));

const KNOWN = new Set<string>([...STOP, ...FRAMING]);
for (const [keys] of SYNONYMS) for (const k of keys) for (const w of k.split(' ')) KNOWN.add(w);

/**
 * Fixes typos word by word against the synonym table and the filler words, so
 * "hedache" reaches the table and "mision" stays filler instead of becoming "vision".
 */
function respell(index: SearchIndex, words: string[]): string[] {
  return words.map((w) => {
    if (KNOWN.has(w) || index.df.has(stem(w)) || w.length < 5 || /\d/.test(w)) return w;
    let best = w;
    let bestD = 3;
    for (const k of KNOWN) {
      if (k.length < 4) continue;
      const d = distance(w, k, w.length >= 7 ? 2 : 1);
      if (d < bestD && d <= (w.length >= 7 ? 2 : 1)) {
        best = k;
        bestD = d;
      }
    }
    return best;
  });
}

function concepts(index: SearchIndex, question: string, altWeight: number): Concept[] {
  let text = ` ${respell(index, normalize(question).split(/\s+/)).join(' ')} `;
  for (const phrase of FRAMING_PHRASES) text = text.split(` ${phrase} `).join(' ');
  const out: Concept[] = [];
  for (const [keys, nasa] of SYNONYMS) {
    let hit = false;
    for (const key of [...keys].sort((a, b) => b.length - a.length)) {
      const at = text.indexOf(` ${key} `);
      if (at >= 0) {
        text = `${text.slice(0, at)} ${text.slice(at + key.length + 1)}`;
        hit = true;
      }
    }
    if (!hit) continue;
    const alts = new Map<string, number>();
    const [strong, weak = ''] = nasa.split('|');
    for (const [words, w] of [[weak, altWeight / 2], [strong, altWeight]] as const) {
      for (const t of terms(words)) if (index.df.has(t)) alts.set(t, w);
    }
    out.push({ alts });
  }
  const leftover = normalize(text).split(/\s+/).filter((w) => w && !FRAMING.has(w) && !/^\d+(am|pm)$/.test(w)).join(' ');
  for (const t of terms(leftover)) {
    const alts = new Map<string, number>();
    if (index.df.has(t)) alts.set(t, 1);
    else {
      const near = nearest(index, t);
      if (near) alts.set(near, 0.8);
    }
    out.push({ alts });
  }
  return out;
}

// ---------- scoring ----------

function termScore(index: SearchIndex, doc: Doc, term: string): number {
  const f = doc.tf.get(term) ?? 0;
  if (f === 0) return 0;
  return idf(index, term) * (f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.len) / index.avgLen));
}

/** Best alternative counts fully; other alternatives in the same passage add a little. */
function conceptScore(index: SearchIndex, doc: Doc, c: Concept): number {
  const scores = [...c.alts].map(([t, w]) => termScore(index, doc, t) * w).sort((a, b) => b - a);
  if (scores.length === 0 || scores[0] === 0) return 0;
  return scores[0] + 0.3 * scores.slice(1).reduce((s, v) => s + v, 0);
}

function conceptWeight(index: SearchIndex, c: Concept): number {
  if (c.alts.size === 0) return index.maxIdf; // a word NASA's text never uses: the library likely can't answer it
  return Math.max(...[...c.alts.keys()].map((t) => idf(index, t)));
}

/** Short fixed name the model cites, e.g. "NASA-STD-3001 CO2 Technical Brief" or "NASA Risk of Hypoxia". */
export function sourceName(p: Passage): string {
  return p.source.startsWith('NASA') ? p.source : `NASA ${p.source}`;
}

/** The words a crewmate or the hub uses for a signal that has a NASA limit (cabin.ts LIMITS). */
const LIMIT_WORDS: Record<string, RegExp> = { co2: /\b(co2|c02|carbon dioxide|ppco2)\b/i };

/**
 * True when the passage opens by stating NASA's limit for that signal: its
 * first sentence names the signal and gives the limit's own number, unit and
 * averaging window ("limits the average 1-hour CO2 ... to no more than 3 mmHg").
 */
export function statesLimit(passage: Passage, signal: string): boolean {
  const limit = LIMITS.find((l) => l.signal === signal);
  const words = LIMIT_WORDS[signal];
  if (!limit || !words) return false;
  const first = passage.text.split(/(?<=[.!?])\s+/)[0] ?? '';
  const value = String(limit.max).replace('.', '\\.');
  const states = new RegExp(`\\b(limit|limits|no more than|not exceed|less than|below|maximum)\\b[^.]{0,120}?<?\\s*${value}(\\.0+)?\\s*${limit.unit}`, 'i');
  // The limit's own averaging window, so a 24-hour flight rule is not taken for a 1-hour limit.
  const hours = limit.windowMs / 3_600_000;
  const spelled: Record<number, string> = { 1: 'one', 24: 'twenty-four' };
  const window = new RegExp(`\\b(${hours}|${spelled[hours] ?? hours})[- ]hours?\\b`, 'i');
  return words.test(first) && states.test(first) && window.test(first);
}

/** Signals with a NASA limit that the text names. */
function limitSignals(text: string): string[] {
  return Object.entries(LIMIT_WORDS).filter(([, re]) => re.test(text)).map(([signal]) => signal);
}

export function search(index: SearchIndex, question: string, options: SearchOptions = {}): SearchResult {
  const limit = Math.min(Math.max(options.limit ?? 2, 1), 3);
  const all = rank(index, question);
  if (all.length === 0) return { found: false, hits: [], reason: 'the question has no words to search for' };
  const rs = concepts(index, (options.readings ?? []).join(' '), 1);

  const ranked = all
    .filter((r) => r.score >= SCORE_FLOOR && r.cover >= COVER_FLOOR && onTopic(question, r.doc.passage))
    .map((r) => ({ ...r, score: r.score + 0.25 * rs.reduce((s, c) => s + conceptScore(index, r.doc, c), 0) }))
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return { found: false, hits: [], reason: 'nothing relevant found in NASA sources' };
  const top = ranked[0].score;
  let kept = ranked.filter((r) => r.score >= top * KEEP_RATIO);

  // For a signal with a NASA limit, the passage that states the limit comes first:
  // when the question names the signal, from anywhere above the floors; when only
  // the readings name it, only if it made the cut on its own.
  const asked = limitSignals(question);
  const fromReadings = limitSignals((options.readings ?? []).join(' ')).filter((sig) => !asked.includes(sig));
  for (const [signals, pool] of [[fromReadings, kept], [asked, ranked]] as const) {
    const first = pool.find((r) => signals.some((sig) => statesLimit(r.doc.passage, sig)));
    if (first) kept = [first, ...kept.filter((r) => r !== first)];
  }

  const hits = kept
    .slice(0, limit)
    .map((r) => ({ id: r.doc.passage.id, score: Math.round(r.score * 100) / 100, name: sourceName(r.doc.passage), passage: r.doc.passage }));
  return { found: true, hits };
}

/**
 * Topics a question can be plainly about, each with the words a passage must use to be about it too.
 * A question that names one ("my blood pressure", "my heart rate") gets only passages on that topic:
 * a passage about radiation and cancer, or the heart's shape, is never handed over for it.
 */
const TOPIC_WORDS: { asks: RegExp; passage: RegExp }[] = [
  { asks: /\b(blood pressure|hypertens\w*|systolic|diastolic|press[aã]o arterial)\b/i, passage: /\b(blood pressure|hypertens\w*|hypotens\w*|systolic|diastolic)\b/i },
  { asks: /\b(heart ?rate|pulse|bpm|heartbeats?|frequ[eê]ncia card[ií]aca|batimentos?)\b/i, passage: /\b(heart ?rates?|pulse|bpm|heartbeats?|tachycardi\w*|bradycardi\w*|arrhythmi\w*)\b/i },
  { asks: /\b(sleep\w*|slept|insomnia|dormi\w*|sono)\b/i, passage: /\b(sleep\w*|slept|insomnia|circadian|fatigue)\b/i },
  { asks: /\b(radiation|dose|msv|radia[cç][aã]o)\b/i, passage: /\b(radiation|dose|msv|sievert\w*)\b/i },
  { asks: /\b(co2|carbon dioxide)\b/i, passage: /\b(co2|carbon dioxide)\b/i },
];

/** False when the question names a topic above and the passage is about none of the topics it names. */
export function onTopic(question: string, passage: Pick<Passage, 'heading' | 'text'>): boolean {
  const text = `${passage.heading ?? ''} ${passage.text}`;
  const asked = TOPIC_WORDS.filter((t) => t.asks.test(question));
  return asked.length === 0 || asked.some((t) => t.passage.test(text));
}

/** Every passage scored against the question, best first, before any floor. For checking and tuning. */
export function rank(index: SearchIndex, question: string): { doc: Doc; id: string; score: number; cover: number }[] {
  const qs = concepts(index, question, 1);
  if (qs.length === 0) return [];
  const total = qs.reduce((s, c) => s + conceptWeight(index, c), 0);
  return index.docs
    .map((doc) => {
      let score = 0;
      let covered = 0;
      for (const c of qs) {
        const s = conceptScore(index, doc, c);
        if (s > 0) {
          score += s;
          covered += conceptWeight(index, c);
        }
      }
      return { doc, id: doc.passage.id, score, cover: covered / total };
    })
    .sort((a, b) => b.score - a.score);
}
