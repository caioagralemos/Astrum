// What the model is sent, and what the hub checks before and after. Pure: no
// I/O, no model. The source of truth is ~/Desktop/NASA/AI-CORE-SPEC.md:
//   §5.1-5.2  the system prompt and the four examples, word for word (frozen)
//   §5.3      the message layout; the hub does the arithmetic, the model only reads it
//   §5.6      the urgent check (one label) and the hub's word list
//   §6        the hub checks on every answer
//
// The spec's §6 checks are all here. On top of them, the output check throws
// an answer away (and shows the fixed refusal text) when it holds an invented
// step, a number that is in neither the readings nor the passages, medicine or
// dose talk, diagnosis language, a source that wasn't sent, or one of the unsafe
// phrases the spec's test cases fail on. The spec tested a number check and
// only logged it; here it discards, as asked for the hub.

// ---------- the fixed texts ----------

/** §6: shown instead of any refusal, so a refusal can never carry a dose or a drug. */
export const REFUSAL_TEXT =
  "I don't know. My NASA sources don't cover that, and I won't guess. Tap Ask Houston to send it to your flight surgeon. The reply takes about 40 minutes.";

/** Fixed texts the hub shows instead of a model answer, by string-table key. English here; the table holds both. */
export const FIXED_TEXTS = {
  'ai.refusal': REFUSAL_TEXT,
  // Not in the spec: neutral wording, waiting for the owner's approval.
  'ai.unavailable': "The AI isn't available right now. Here are the readings and NASA's text as they are. Tap Ask Houston to ask your flight surgeon.",
  'ai.slow': "I couldn't finish an answer in time. Here are the readings and NASA's text as they are. Tap Ask Houston to ask your flight surgeon.",
  'ai.busy': "Too many questions are waiting. Ask again in a moment, or tap Ask Houston.",
  'ai.card': 'This needs the steps card, not an answer from me. The card is on screen.',
  'ai.crisis': 'This needs a person, not me. Please go to a crewmate or your Crew Medical Officer now.',
  'ai.crisisTold': "This needs a person, not me. I've asked a crewmate to come and be with you.",
} as const;

export type FixedKey = keyof typeof FIXED_TEXTS;

// ---------- §5.1 and §5.2: frozen ----------

export const SYSTEM_PROMPT = `You are Astrum, the health assistant on a crewed Mars mission. You talk to the crew. They are not doctors.

Each message has READINGS, sometimes NASA PASSAGES, and a QUESTION. The readings and passages are your only facts.

How to answer:
- Answer the question in the first sentence. Then explain with the numbers: the reading, the person's own normal, the difference, and the NASA limit if a passage gives one.
- Mention every reading that is off the person's normal.
- If the crew member believes something the passage contradicts or does not say, tell them, and give what the passage says.
- If the passage says what is done about the problem, say it.
- When asked what is going on: say which readings are off, what the passage links them to, and what the passage says is done about it.
- Never add advice, causes, treatments, drugs or numbers that are not in the readings or passages.
- When the readings are inside the person's normal, say so plainly. Do not look for a problem.
- Readings alone are enough to describe a trend. No passage is needed for that.
- End with "Source: [exact passage name]" for the passage you used. If you used no passage, write no source line.
- If the question asks for something the readings and passages don't contain (which drug, what dose, how long, a diagnosis): start your answer with the words "I don't know." Then say the NASA sources don't cover it, and suggest Ask Houston (the reply takes about 40 minutes). Give no advice of your own.
- 2 to 5 sentences. Plain words. Calm.`;

const X_DOSE = `PASSAGE [NASA-STD-3001 Radiation Protection Technical Brief]:
"[V1 4030] Career Space Permissible Exposure Limit for Space Flight Radiation An individual astronaut's total career effective radiation dose due to space flight radiation exposure shall be less than 600 mSv. This limit is universal for all ages and sexes."`;

const X_BARO = `PASSAGE [NASA-STD-3001 Habitable Atmosphere Technical Brief]:
"Barotrauma is injury to your body caused by changes in barometric (air) or water pressure. Barotrauma is most often experienced in the ear and sinuses but is also experienced in the lungs or other major organs.
Prevention includes gradually controlled pressure changes, crew training in equalizing techniques, and pharmaceuticals including decongestants, pain medication and supplemental or supportive care when required."`;

/** The four examples, as [crew message, answer], in the spec's order. */
export const EXAMPLES: [string, string][] = [
  [
    `READINGS (Sam): radiation dose this mission 212 mSv. Detector: normal.\n\n${X_DOSE}\n\nQUESTION: I heard the limit is lower for women. Am I getting close to it?`,
    'No. The limit is the same for everyone: total career dose under 600 mSv, for all ages and sexes. You are at 212 mSv this mission, which is 388 mSv under the limit. The limit counts your whole career, and I only have this mission\'s reading.\nSource: [NASA-STD-3001 Radiation Protection Technical Brief]',
  ],
  [
    'READINGS (Sam), HRV, last 6 days: 58, 57, 55, 49, 44, 41 ms. His normal: 54-60 ms.\nDetector: anomaly 0.66. Main signal: HRV trend.\n(no passages)\n\nQUESTION: How is Sam doing this week?',
    "Sam's HRV has been falling all week, from 58 to 41 ms. The first three days were inside his normal 54-60 ms. The last three are below it, and today's 41 ms is 13 under the bottom of his range. The detector flags this trend (anomaly 0.66). I have no NASA passage about the cause, so I can't say why.",
  ],
  [
    `READINGS (Sam): ear pain after a suit pressure check. Vitals within his normal.\n\n${X_BARO}\n\nQUESTION: Which decongestant should I take, and how much?`,
    "I don't know. The passage says decongestants are used to prevent barotrauma, but it names no medicine and gives no amount, and I won't guess. Tap Ask Houston to send this to your flight surgeon. The reply takes about 40 minutes.\nSource: [NASA-STD-3001 Habitable Atmosphere Technical Brief]",
  ],
  [
    'READINGS (Sam): sleep last night 7.0 h (his normal range 6.8-7.4 h). Detector: normal.\n(no passages)\n\nQUESTION: I feel like I barely slept. Is my sleep off?',
    'Your sleep reading is normal. You slept 7.0 h, inside your usual 6.8-7.4 h, and the detector shows nothing unusual. I have no NASA passage about how rested you feel, so I can\'t say more than that.',
  ],
];

/**
 * Not in the spec: a fifth example, after the four frozen ones, that shows how
 * to use the hub's evidence lines with "points to" wording and no cause. The
 * passage is the first sentence of NASA's CO2 brief, unchanged.
 */
EXAMPLES.push([
  'READINGS (Sam):\ncabin CO2 (est.) 2.7 mmHg, 1-hour average: 0.3 mmHg below the NASA limit of 3 mmHg.\nCO2 exposure, last 72 hours: 8 h in the workshop above 2.8 mmHg, 0 h above 3 mmHg; crewmates at most 0.5 h above 2.8 mmHg (estimated).\nNo body reading is unusual for Sam.\nThe hub\'s comparison points to the room (the workshop), not to Sam.\nDetector: normal.\n\nPASSAGE [NASA-STD-3001 CO2 Technical Brief]:\n"Current NASA-STD-3001 Volume 2 [V2 6004] limits the average 1-hour CO2 partial pressure (ppCO2) in the habitable volume to no more than 3 mmHg."\n\nQUESTION: Is something wrong with me, or is it the workshop?',
  "The hub's comparison points to the room, the workshop, not to you. In the last 72 hours you spent 8 h there above 2.8 mmHg, and your crewmates at most 0.5 h. Its CO2 now is 2.7 mmHg, 0.3 mmHg below the NASA limit of 3 mmHg, and none of your body readings is unusual. The passage gives the limit; it does not say what the workshop's air does to you.\nSource: [NASA-STD-3001 CO2 Technical Brief]",
]);

/** How the ASKER line names the person (used by the examples below and by askerLine). */
const REFLEXIVE = { she: 'herself', he: 'himself', they: 'themself' } as const;
const PRONOUN_PAIR = { she: 'she/her', he: 'he/him', they: 'they/them' } as const;

/**
 * Not in the spec: each example's crew message opens with the ASKER line the
 * hub now sends, so the model sees when to say "you" and when to use a name.
 * The examples' own words are unchanged: 1, 3, 4 and 5 already answer "you";
 * 2 answers a crewmate asking about Sam.
 */
const EXAMPLE_ASKERS: [boolean, string][] = [[true, ''], [false, 'Lee'], [true, ''], [true, ''], [true, '']];
EXAMPLE_ASKERS.forEach(([self, askerName], i) => {
  EXAMPLES[i][0] = `${askerLine({ name: 'Sam', pronouns: 'he', self, askerName })}\n${EXAMPLES[i][0]}`;
});

/** §6 check 4: words that exist only in the examples. Keep in step with EXAMPLES. */
export const EXAMPLE_ONLY_WORDS = ['sam', 'lee', 'decongestant', 'barotrauma', 'hyperoxia', 'career', 'ear pain', 'suit pressure check', 'all ages and sexes', 'equalizing', 'workshop'];

// ---------- §5.6: the urgent check ----------

export const URGENT_SYSTEM = `You sort messages for a crew health system on a Mars mission. Answer with ONE word: URGENT or ROUTINE.

URGENT: someone is in danger right now. Examples: confused, fainted, not responding, can't breathe, choking, chest pain, bleeding, a burn, a broken or badly swollen limb, pain or tingling after an EVA, cabin pressure dropping, CO2 at 15 mmHg or more, a solar flare or particle alert.
ROUTINE: everything else. Questions about limits, sleep, exercise, medicine, summaries of a week, explaining an alert or a trend, a mild headache, feeling tired or anxious with normal readings.

A detector anomaly, or a reading above the person's normal, is NOT urgent by itself. It is urgent only with a symptom or event from the URGENT list.

Reply as JSON: {"label": "..."}`;

export const URGENT_EXAMPLES: [string, 'URGENT' | 'ROUTINE'][] = [
  ['READINGS (Sam): cut his forearm on a panel edge. Bleeding, pale. Heart rate 118 bpm (his normal 61).\n\nQUESTION: What do we do?', 'URGENT'],
  ['READINGS (Sam): sleep last night 7.0 h (his normal range 6.8-7.4 h). Detector: normal.\n\nQUESTION: I feel like I barely slept. Is my sleep off?', 'ROUTINE'],
  ["READINGS (Sam): resting heart rate 79 bpm (his normal 61), HRV 38 ms (his normal 55). Detector: anomaly 0.88.\nCABIN: CO2 (est.) 3.4 mmHg.\n\nQUESTION: What's going on with Sam?", 'ROUTINE'],
  ['CABIN: pressure falling for 6 minutes.\nREADINGS (Sam): says his vision is going grey.\n\nQUESTION: What is happening?', 'URGENT'],
  ['QUESTION: Why do we have to wear the dosimeter all day?', 'ROUTINE'],
  ["READINGS (Sam): vomiting, says the room is spinning, can't stand up.\n\nQUESTION: Help, what do I do?", 'URGENT'],
];

export const URGENT_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'astrum', strict: true, schema: {
      type: 'object', properties: { label: { type: 'string', enum: ['URGENT', 'ROUTINE'] } },
      required: ['label'], additionalProperties: false,
    },
  },
} as const;

/** §5.6: the hub's word list. It can only add urgency. */
export const URGENT_WORDS = /bleed|blood|unconscious|not responding|won'?t wake|collapsed|fainted|passed out|choking|can'?t breathe|cannot breathe|not breathing|chest pain|seizure|fell\b|fall\b|broken|fracture|swelling|swollen|burn(ed|t)?\b|blister|blue lips|slurred|can'?t (stand|move|see|speak)/;

/** Not in the spec: the same list in Portuguese, for a crewmate who types in Portuguese. Waiting for approval. */
export const URGENT_WORDS_PT = /sangr|sangue|inconsciente|n[aã]o responde|n[aã]o acorda|desmai|engasg|sufoc|n[aã]o consigo respirar|n[aã]o est[aá] respirando|dor no peito|convuls|\bcaiu\b|\bca[ií]\b|quebr|fratur|inchad|inchaço|queimad|queimou|bolha|l[aá]bios roxos|fala enrolada|n[aã]o consigo (ficar de p[eé]|mexer|ver|falar)/;

export function parseUrgentLabel(text: string): 'URGENT' | 'ROUTINE' | null {
  const m = /"label"\s*:\s*"(URGENT|ROUTINE)"/.exec(text) ?? /\b(URGENT|ROUTINE)\b/.exec(text.toUpperCase());
  return m ? (m[1] as 'URGENT' | 'ROUTINE') : null;
}

// ---------- §5.3: the readings block ----------

/**
 * How a value came to exist, as the screen labels it. The spec's prompt
 * marked only estimates, as "(est.)"; the others follow the same style.
 * Measured values carry no mark, as in the spec's tested layout.
 */
export type ReadingLabel = 'measured' | 'estimated' | 'reported' | 'replayed' | 'simulated';

const TAG: Record<ReadingLabel, string> = { measured: '', estimated: ' (est.)', reported: ' (reported)', replayed: ' (replayed)', simulated: ' (simulated)' };

/** A person's normal: one value, or a range [low, high]. */
export type Normal = number | [number, number];

/** One reading the hub hands the prompt. The hub's numbers; this file only does the subtraction. */
export type Reading =
  /** A body reading against the person's own normal. `judged` is the baseline's verdict when the hub has one. */
  | { type: 'normal'; name: string; value: number; unit: string; label: ReadingLabel; normal: Normal; judged?: 'above' | 'below' | 'inside' }
  /** Several values over time, oldest first, e.g. "last 6 days". */
  | { type: 'series'; name: string; values: number[]; unit: string; window: string; label: ReadingLabel; normal?: Normal }
  /**
   * A reading against a NASA limit the hub keeps, e.g. cabin CO2. No limit: the value alone.
   * `room` is the room it was read in and `here` whether the person is there now; the hub's
   * own sentences (answer.ts) use them to name the room. The model's line is the same either way.
   */
  | { type: 'limit'; name: string; value: number; unit: string; label: ReadingLabel; window?: string; limit?: number; room?: string; here?: boolean }
  /** A value with no normal and no limit, e.g. a dose so far. */
  | { type: 'value'; name: string; value: number; unit: string; label: ReadingLabel }
  /** Words, e.g. a symptom the person reported in a check-in. */
  | { type: 'note'; text: string; label: ReadingLabel };

export interface PersonReadings {
  /** The name the crew uses. */
  name: string;
  pronoun?: 'her' | 'his' | 'their';
  readings: Reading[];
}

function decimals(n: number): number {
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** a - b, rounded to the precision of the inputs, so 4.5 - 7.2 is -2.7. */
function minus(a: number, b: number): number {
  const d = Math.max(decimals(a), decimals(b));
  return Number((a - b).toFixed(d));
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function unitSp(unit: string): string {
  return unit ? ` ${unit}` : '';
}

function normalText(normal: Normal): string {
  return typeof normal === 'number' ? `normal ${normal}` : `normal range ${normal[0]}-${normal[1]}`;
}

/** "+20 bpm (+31%), above normal." or "+10 bpm above the top of her normal range." */
function against(value: number, normal: Normal, unit: string, pronoun: string, judged?: 'above' | 'below' | 'inside'): string {
  if (typeof normal === 'number') {
    const diff = minus(value, normal);
    const side = judged ?? (diff > 0 ? 'above' : diff < 0 ? 'below' : 'inside');
    if (side === 'inside') return `${signed(diff)}${unitSp(unit)}, inside normal.`;
    const pct = normal !== 0 ? ` (${signed(Math.sign(diff) * Math.round(Math.abs((100 * diff) / normal)))}%)` : '';
    return `${signed(diff)}${unitSp(unit)}${pct}, ${side} normal.`;
  }
  const [low, high] = normal;
  if (value > high) return `${signed(minus(value, high))}${unitSp(unit)} above the top of ${pronoun} normal range.`;
  if (value < low) return `${signed(minus(value, low))}${unitSp(unit)} below the bottom of ${pronoun} normal range.`;
  return `inside ${pronoun} normal range.`;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** One reading as one sentence, the way §5.3 lays it out. */
export function readingLine(r: Reading, pronoun: string): string {
  if (r.type === 'note') return /[.!?]$/.test(oneLine(r.text)) ? oneLine(r.text) : `${oneLine(r.text)}.`;
  const name = `${oneLine(r.name)}${TAG[r.label]}`;
  if (r.type === 'normal') {
    const unit = r.unit;
    return `${name} ${r.value}${unitSp(unit)} (${pronoun} ${normalText(r.normal)}): ${against(r.value, r.normal, unit, pronoun, r.judged)}`;
  }
  if (r.type === 'series') {
    const list = `${name}, ${oneLine(r.window)}: ${r.values.join(', ')}${unitSp(r.unit)}`;
    if (!r.normal || r.values.length === 0) return `${list}.`;
    const latest = r.values[r.values.length - 1];
    return `${list} (${pronoun} ${normalText(r.normal)}): latest ${latest}${unitSp(r.unit)}, ${against(latest, r.normal, r.unit, pronoun)}`;
  }
  if (r.type === 'limit') {
    const head = `${name} ${r.value}${unitSp(r.unit)}${r.window ? `, ${oneLine(r.window)}` : ''}`;
    if (r.limit === undefined) return `${head}.`;
    const diff = minus(r.value, r.limit);
    if (diff === 0) return `${head}: at the NASA limit of ${r.limit}${unitSp(r.unit)}.`;
    return `${head}: ${Math.abs(diff)}${unitSp(r.unit)} ${diff > 0 ? 'above' : 'below'} the NASA limit of ${r.limit}${unitSp(r.unit)}.`;
  }
  return `${name} ${r.value}${unitSp(r.unit)}.`;
}

/** The detector line exactly as baseline.ts writes it, or nothing. */
export function cleanDetectorLine(line: string | null | undefined): string | null {
  const s = oneLine(line ?? '');
  return /^Detector: (normal\.|anomaly [01](\.\d+)?\. Main signals?: [^\n]+\.)$/.test(s) ? s : null;
}

export function readingsBlock(p: PersonReadings | null, detector: string | null, extra: string[] = []): string | null {
  const det = cleanDetectorLine(detector);
  const lines = p ? p.readings.map((r) => readingLine(r, p.pronoun ?? 'their')) : [];
  lines.push(...extra.map(oneLine).filter(Boolean));
  if (det) lines.push(det);
  if (lines.length === 0) return null;
  return `READINGS (${oneLine(p?.name ?? 'crew')}):\n${lines.join('\n')}`;
}

// ---------- the whole message ----------

/** A passage as the prompt quotes it: its short fixed name and NASA's words, unchanged. */
export interface PromptPassage {
  name: string;
  text: string;
}

export interface MessageInput {
  readings: PersonReadings | null;
  detectorLine: string | null;
  passages: PromptPassage[];
  question: string;
  /** The hub's evidence lines (answer.ts evidenceLines), after the readings. */
  evidence?: string[];
  /** Who asks, and about whom. Gives the model the person and the pronouns to use. */
  asker?: Asker;
}

/** Who asks, about whom, and how to refer to that person. */
export interface Asker {
  /** The person the question is about. */
  name: string;
  pronouns: 'she' | 'he' | 'they';
  /** True when the person asking is that person. */
  self: boolean;
  /** The name of the person asking. */
  askerName: string;
}


/** One plain line before the readings: who is asking, and how to address the person. */
export function askerLine(a: Asker): string {
  return a.self
    ? `ASKER: ${oneLine(a.name)} is asking about ${REFLEXIVE[a.pronouns]}. Answer ${oneLine(a.name)} as "you". Never use the name or "${PRONOUN_PAIR[a.pronouns]}" for ${oneLine(a.name)}.`
    : `ASKER: ${oneLine(a.askerName)}, a crewmate, is asking about ${oneLine(a.name)}. Refer to ${oneLine(a.name)} as "${PRONOUN_PAIR[a.pronouns]}".`;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function passageBlock(p: PromptPassage): string {
  return `PASSAGE [${oneLine(p.name)}]:\n"${p.text.trim()}"`;
}

/** The crew message, laid out as §5.3 and the tested examples lay it out. */
export function buildUserMessage(input: MessageInput): string {
  const readings = readingsBlock(input.readings, input.detectorLine, input.evidence);
  const question = `QUESTION: ${oneLine(input.question)}`;
  const asker = input.asker ? `${askerLine(input.asker)}\n` : '';
  if (input.passages.length === 0) return `${asker}${readings ? `${readings}\n` : ''}(no passages)\n\n${question}`;
  return asker + [readings, ...input.passages.map(passageBlock), question].filter(Boolean).join('\n\n');
}

/** The explainer's messages: system prompt, the four examples as chat turns, then the crew message. */
export function buildMessages(input: MessageInput): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...EXAMPLES.flatMap(([u, a]): ChatMessage[] => [{ role: 'user', content: u }, { role: 'assistant', content: a }]),
    { role: 'user', content: buildUserMessage(input) },
  ];
}

/** The urgent check's messages. It sees the readings and the question, not the passages. */
export function buildUrgentMessages(input: Omit<MessageInput, 'passages'>): ChatMessage[] {
  const readings = readingsBlock(input.readings, input.detectorLine, input.evidence);
  const user = `${readings ? `${readings}\n\n` : ''}QUESTION: ${oneLine(input.question)}`;
  return [
    { role: 'system', content: URGENT_SYSTEM },
    ...URGENT_EXAMPLES.flatMap(([u, a]): ChatMessage[] => [{ role: 'user', content: u }, { role: 'assistant', content: `{"label": "${a}"}` }]),
    { role: 'user', content: user },
  ];
}

// ---------- the input screen ----------

/**
 * Not in the spec, which found nothing covering a crewmate in crisis (§10).
 * Kept short and literal on purpose. A match never reaches the model: the hub
 * sends a person. Misses are listed in the eval results.
 */
export const CRISIS_WORDS = [
  /better off without me/, /(don'?t|do not) want to (live|be alive|exist|wake up|be here any ?more)/, /want to die/,
  /wish (i|that i) (was|were) dead/, /kill(ing)? myself/, /end (it all|my life|things)\b/, /suicid/, /(hurt|harm)(ing)? myself/,
  /self[- ]?harm/, /no (reason|point) (to|in) (live|living|go on|going on|being here)/,
  /(don'?t|do not|can'?t|cannot) see the point (of|in) (any of this|anything|living|going on|being here)/,
  /(can'?t|cannot) go on( like this| any ?more)?\s*$/, /(can'?t|cannot) go on (like this|any ?more)/, /take my (own )?life/, /not worth living/,
  /nobody would (care|miss me|notice)/,
  // Portuguese
  /melhor sem mim/, /n[aã]o quero (mais )?(viver|existir|acordar)/, /quero morrer/, /me matar/, /acabar com (tudo|a minha vida|minha vida)/,
  /suic[ií]d/, /me (machucar|ferir)/, /n[aã]o vejo (mais )?sentido (em|na|de) (nada|viver|continuar)/, /n[aã]o aguento mais/,
];

/** What would make a typed question a request for medicine or a dose. The hub answers those with the fixed refusal. */
const MEDICINE = /\b(dosage|doses|(what|which|how much|right|correct) dose|dose of (?!radiation)|\d+\s?(mg|mcg|ml|iu)\b|milligrams?|pills?|tablets?|capsules?|medicines?|medications?|meds\b|drugs?|painkillers?|ibuprofen|acetaminophen|paracetamol|tylenol|advil|aspirin|melatonin|antihistamines?|antibiotics?|hydrocortisone|steroids?|creams?|ointments?|decongestants?|sedatives?|sleeping pills?|injections?)\b|\b(rem[eé]dio|medicamento|comprimido|dosagem|pomada|ibuprofeno|paracetamol|melatonina|dipirona|antibi[oó]tico)/;

/** Text the crew would never type, but that would pass for part of the hub's own message. */
const FORMAT = /\b(READINGS|PASSAGE|QUESTION|PERGUNTA)\b\s*[[(:]|^\s*Source:|Detector:|<\/?think>|<\|/im;

export const MAX_QUESTION = 600;

export type Screen =
  | { route: 'crisis' }
  | { route: 'card'; reason: 'urgent-words'; words: string[] }
  | { route: 'fixed'; reason: 'empty' | 'too-long' | 'format' | 'medicine'; key: FixedKey }
  | { route: 'model' };

function lowerPlain(s: string): string {
  return s.toLowerCase().replace(/[‘’ʼ`]/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * What must never reach the model, in this order:
 *   1. anything that looks like a crisis: a person, never the model;
 *   2. empty, too long, or shaped like the hub's own message: fixed text;
 *   3. the urgent word list (spec §5.6, plus the Portuguese list): the card;
 *   4. a question about medicine or a dose: the fixed refusal. The spec leaves
 *      this to the model, which refused every time in the tests; the hub
 *      makes it certain.
 */
export function screenInput(question: string): Screen {
  const q = lowerPlain(question);
  if (CRISIS_WORDS.some((re) => re.test(q))) return { route: 'crisis' };
  if (!q) return { route: 'fixed', reason: 'empty', key: 'ai.refusal' };
  if (question.length > MAX_QUESTION) return { route: 'fixed', reason: 'too-long', key: 'ai.refusal' };
  if (FORMAT.test(question)) return { route: 'fixed', reason: 'format', key: 'ai.refusal' };
  const words = [...new Set([...(q.match(new RegExp(URGENT_WORDS.source, 'g')) ?? []), ...(q.match(new RegExp(URGENT_WORDS_PT.source, 'g')) ?? [])])];
  if (words.length) return { route: 'card', reason: 'urgent-words', words };
  if (MEDICINE.test(q)) return { route: 'fixed', reason: 'medicine', key: 'ai.refusal' };
  return { route: 'model' };
}

// ---------- the output check ----------

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

/** Advice or orders: the model may only report what a passage says is done. */
const STEPS: [RegExp, string][] = [
  [/\bdo this now\b|\bstep \d/i, 'emergency steps'],
  [/^(please |so |now |first,? |then |next,? |also,? )?(take|go|put|stop|start|call|apply|drink|eat|lie down|sit|breathe|leave|wear|give|try|avoid|keep|get|increase|reduce|raise|switch|open|close|remove|add|monitor|tell|contact|follow|begin|continue|skip|hydrate|relax|wait|seek|consider|ensure|talk to|inform|notify|don'?t|do not|never)\b/i, 'an order to the crew'],
  [/\byou (should|must|need to|have to|ought to|'d better|had better|could try|can try|might want to|may want to)\b/i, 'advice'],
  [/\b(he|she|they|we|everyone|the crew)( all)? (should|must|needs? to|has to|have to|ought to)\b/i, 'advice'],
  [/\b[A-Z][a-z]+ (should|must|needs to|has to|ought to)\b/, 'advice'],
  [/\b(i|we) (would )?(recommend|suggest|advise)\b|\b(it'?s|it is) (best|important|recommended|advisable|a good idea) to\b|\btry to\b|\bmake sure\b/i, 'advice'],
];

const MEDICINE_OUT = /\b(dose of|dosage|doses|\d+\s?(mg|mcg|µg|ml|iu|units?|tablets?|pills?|capsules?|drops?)\b|milligrams?|pills?|tablets?|capsules?|medicines?|medications?|meds|drugs?|painkillers?|analgesics?|pharmaceuticals?|ibuprofen|acetaminophen|paracetamol|tylenol|advil|aspirin|melatonin|antihistamines?|antibiotics?|hydrocortisone|steroids?|creams?|ointments?|decongestants?|sedatives?|sleeping pills?|injections?|prescri\w*)\b/i;

const CONDITION = '(condition|disease|disorder|infection|syndrome|illness|hypoxia|hypercapnia|hyperoxia|decompression sickness|dcs|the bends|sans|concussion|fracture|stroke|heart attack|heart problem|heart condition|arrhythmia|tachycardia|bradycardia|flu|covid|a cold|anemia|anaemia|diabetes|depression|anxiety disorder|insomnia|burnout|migraine|dehydration|hypertension|hypotension|cancer|pneumonia|sepsis|motion sickness|space sickness|altitude sickness|ptsd|panic attack|seizure|epilepsy|asthma|allergic reaction|allergy|poisoning|co2 poisoning|co2 toxicity|barotrauma)';

const DIAGNOSIS: RegExp[] = [
  new RegExp(`\\b(have|has|had|having|developed|developing|suffer|suffers|suffering)( from)?( an?| the| some)? ${CONDITION}\\b`, 'i'),
  new RegExp(`\\b(this|that|it|which) (is|could be|might be|may be|looks like|sounds like|seems like|seems to be|is probably|is likely|is consistent with|suggests|points to|indicates)( an?| the)? ${CONDITION}\\b`, 'i'),
  new RegExp(`\\b(sign|signs|symptom|symptoms|case) of( an?| the)? ${CONDITION}\\b`, 'i'),
  /\b(you|he|she|they|[A-Z][a-z]+)('re|'s| are| is)( not|n't)? (sick|ill|unwell|healthy)\b/i,
];

/**
 * A cause stated as fact about the person ("you're waking with headaches because
 * of the CO2"). The passages give associations, not causes, and the hub shows
 * exposure, never cause. The system prompt already forbids added causes.
 */
const CAUSE: RegExp[] = [
  /\b(you|you're|your|he|she|they|his|her|their)\b[^.!?]*\b(because of|caused by|due to)\b/i,
  /\b(is|are|was|were) (what'?s )?(causing|giving) (you|your|him|her|them|the crew)\b/i,
];

const GENDERED: Record<'she' | 'he', RegExp> = { she: /\b(she|her|hers|herself)\b/i, he: /\b(he|him|his|himself)\b/i };

/** Why an answer refers to the person wrongly, or null. */
export function personProblem(text: string, subject: NonNullable<CheckInput['subject']>): string | null {
  const name = subject.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (subject.self) {
    if (name && new RegExp(`\\b${name}\\b`, 'i').test(text)) return `it calls the person asking "${subject.name}" instead of "you"`;
    for (const g of ['she', 'he'] as const) if (GENDERED[g].test(text)) return 'it uses "she" or "he" for the person asking';
    return null;
  }
  for (const g of ['she', 'he'] as const) {
    if (g !== subject.pronouns && GENDERED[g].test(text)) return `it uses "${g}" for ${subject.name}, whose profile says ${subject.pronouns}`;
  }
  return null;
}

/** A duration said to be "above the limit", in either order: "6.1 h above the 3 mmHg limit", "over the limit for 2 hours". */
const DURATION_OVER_LIMIT = [
  /\b\d+(\.\d+)?\s*(h|hrs?|hours?|minutes?|mins?)\b[^.]{0,60}?\b(above|over|exceed\w*|beyond|past)\b[^.]{0,30}?\blimit\b/i,
  /\b(above|over|exceed\w*|beyond|past)\b[^.]{0,30}?\blimit\b[^.]{0,40}?\b(for|during)\b[^.]{0,20}?\b\d+(\.\d+)?\s*(h|hrs?|hours?|minutes?|mins?)\b/i,
];

/** True when the text states a cause as fact about a person. */
export function statesCause(text: string): boolean {
  return CAUSE.some((re) => re.test(text));
}

/** Unsafe phrases from the spec's test cases (cases.py): waiting for Houston, Earth-only help, false comfort, withholding oxygen or shelter. */
const UNSAFE: [RegExp, string][] = [
  [/wait (for|until) (houston|a (reply|response|answer)|their (reply|response|answer)|the (reply|response|answer)|instructions)|until houston|before (you )?(do|doing|take|taking) any(thing| action)|without (authori[sz]ation|permission|approval)|ask(ing)? (houston )?(for )?permission|await (further |their |the |a )?(instructions?|reply|response|answer|houston|guidance)/i, 'waiting for Houston'],
  [/9-?1-?1|\bambulance|helicopter|\bhospital\b|emergency room/i, 'help only Earth has'],
  [/(do not|don'?t|no) need to worry|nothing to worry about|safe to continue|\byou('re| are) (fine|okay|ok|safe|healthy|all right|alright)\b|\bno cause for concern\b/i, 'false comfort'],
  [/(do not|don'?t) (try to )?(breathe|give|use|apply|put on) (the )?(100% )?(o2|oxygen|mask)/i, 'withholding oxygen'],
  [/(do not|don'?t|no need to) (go|relocate|move|shelter)\b.{0,30}shelter/i, 'keeping the crew out of shelter'],
];

/**
 * The output check's diagnosis and unsafe-phrase rules on any text, sentence by
 * sentence, as the reasons checkAnswer would give. For the hub's own fixed
 * texts (medical/run-cases.ts), which never go through the model.
 */
export function phraseProblems(text: string): { diagnosis: string[]; unsafe: string[] } {
  const out = { diagnosis: [] as string[], unsafe: [] as string[] };
  for (const s of text.split(SENTENCE_SPLIT).map((x) => x.trim()).filter(Boolean)) {
    if (DIAGNOSIS.some((re) => re.test(s))) out.diagnosis.push(s);
    for (const [re, why] of UNSAFE) if (re.test(s)) out.unsafe.push(`${why}: "${s}"`);
  }
  return out;
}

const WORD_NUMBERS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100, thousand: 1000,
};
/** A number word counts as a claim when it measures something: "two hours", not "the first three days". */
const MEASURE = '(hours?|hrs?|minutes?|mins?|seconds?|mg|mmhg|msv|bpm|ms|percent|%|milligrams?|doses?|times? a (day|night))';

/**
 * Numbers stated in a text. Names such as "NASA-STD-3001", "V2 6004" and "CO2" are not numbers.
 * words 'measure': number words before a unit ("two hours"), for answers.
 * words 'all': every number word ("Six to seven days"), for the readings and passages, where a spelled number is still there.
 */
export function numbersIn(text: string, words: false | 'measure' | 'all' | true = false): number[] {
  const s = text
    .replace(/\b[A-Z]+-[A-Z]*-?\d+\b|\bV\d \d{4}\b/g, ' ')
    .replace(/(\d),(\d{3})\b/g, '$1$2')
    .replace(/(\d),(\d)/g, '$1.$2');
  const out = [...s.matchAll(/(?<![A-Za-z\d.])\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (words) {
    const tail = words === 'all' ? '\\b' : `\\s+${MEASURE}`;
    for (const m of s.toLowerCase().matchAll(new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join('|')})${tail}`, 'g'))) out.push(WORD_NUMBERS[m[1]]);
  }
  return out;
}

export interface CheckInput {
  /** The model's whole answer, as it came. */
  answer: string;
  /** The source names of the passages that were sent. */
  passageNames: string[];
  /** The readings block and the passages as sent: the only places a number may come from. */
  facts: string;
  /** The whole crew message, for the example-words check. */
  message: string;
  /** The person the answer is about: wrong pronouns, or naming the asker in the third person, throw it away. */
  subject?: Omit<Asker, 'askerName'>;
  /**
   * True only when the evidence shows a 1-hour average over NASA's limit. Otherwise a
   * duration spent "above the limit" is wrong: the limit is a 1-hour average, not single readings.
   */
  hourOverLimit?: boolean;
}

export interface CheckResult {
  /** What the crew is shown. */
  text: string;
  /** 'model': the model's words (perhaps with sentences dropped). 'fixed': a fixed text replaced them. */
  by: 'model' | 'fixed';
  /** Which fixed text, when by is 'fixed'. 'fallback' means: show the readings card, no text. */
  fixed: 'ai.refusal' | 'fallback' | null;
  /** True when a check threw the model's answer away (not when the model itself said it doesn't know). */
  discarded: boolean;
  /** Why it was thrown away or replaced, in plain words. */
  reasons: string[];
  /** Sentences dropped for words that exist only in the examples (§6 check 4). */
  dropped: string[];
  /** The source the answer cites, if it was one that was sent. */
  source: string | null;
}

function sentences(text: string): string[] {
  return text.split(/\n+/).flatMap((line) => line.split(SENTENCE_SPLIT)).map((s) => s.trim()).filter(Boolean);
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?\\b`, 'i').test(text);
}

/** What the model writes on the source line when it used no passage. */
const NO_SOURCE = /^\(?\s*(none|n\/a|no (nasa )?(passages?|sources?)\b.*|none[ ,(].*|readings\b.*|[^\][]*\breadings?\b( only| alone)?)\s*\)?\.?$/i;

/** Every check, in the spec's order, then the hub's own. */
export function checkAnswer(input: CheckInput): CheckResult {
  const refuse = (reasons: string[], discarded: boolean, dropped: string[] = []): CheckResult =>
    ({ text: REFUSAL_TEXT, by: 'fixed', fixed: 'ai.refusal', discarded, reasons, dropped, source: null });

  let t = input.answer.replace(/^\s*<think>\s*<\/think>\s*/, '').trim();
  if (/<\/?think>/.test(t)) return refuse(['the answer has thinking markers in it'], true);
  if (!t) return { text: '', by: 'fixed', fixed: 'fallback', discarded: false, reasons: ['the answer was empty'], dropped: [], source: null };

  // 1. A refusal is always the fixed text, so it can never carry a dose or a drug.
  // Stricter than the spec's "I don't know." with a stop: any answer that opens with "I don't know" is a refusal.
  if (/^\W*(i (don'?t|do not) know|n[aã]o sei)\b/i.test(t)) return refuse(['the model said it does not know'], false);

  // 2. Nothing after the source line. 3. The source must be one that was sent.
  let source: string | null = null;
  const src = /\bSource:\s*\[?([^\]\n]*)\]?/i.exec(t);
  if (src) {
    const name = src[1].trim();
    t = t.slice(0, src.index).trim();
    // "Source: [none]" and the like name no source: the line is dropped, as spec check 3 does.
    // Any other name that wasn't sent is a made-up source, and the whole answer goes.
    if (NO_SOURCE.test(name)) source = null;
    else if (!input.passageNames.includes(name)) return refuse([`it cites "${name}", which was not sent`], true);
    else source = name;
  }
  for (const m of t.matchAll(/\[([^\]\n]+)\]/g)) {
    if (!input.passageNames.includes(m[1].trim())) return refuse([`it names "${m[1].trim()}", which was not sent`], true);
  }

  // 4. Drop sentences carrying a word that exists only in the examples.
  const leaked = EXAMPLE_ONLY_WORDS.filter((w) => !hasWord(input.message, w));
  const dropped: string[] = [];
  const kept = sentences(t).filter((s) => {
    const bad = leaked.some((w) => hasWord(s, w));
    if (bad) dropped.push(s);
    return !bad;
  });

  // The hub's own checks: any one throws the whole answer away.
  const reasons: string[] = [];
  // A list is steps, whatever its lines say. Checked on whole lines, before they are split into sentences.
  if (/^\s*(\d+[.)]|[-*•])\s+/m.test(t)) reasons.push('a numbered or bulleted list');
  const allowed = new Set(numbersIn(input.facts, 'all').map(String));
  allowed.add('40'); // the Houston reply time the system prompt tells the model to give
  for (const s of kept) {
    const houston = /houston|flight surgeon/i.test(s);
    if (!houston) for (const [re, why] of STEPS) if (re.test(s)) reasons.push(`${why}: "${s}"`);
    if (MEDICINE_OUT.test(s)) reasons.push(`medicine or dose: "${s}"`);
    if (DIAGNOSIS.some((re) => re.test(s))) reasons.push(`diagnosis language: "${s}"`);
    if (CAUSE.some((re) => re.test(s))) reasons.push(`a cause stated as fact: "${s}"`);
    if (/\bdiagnos\w*/i.test(s) && !/(can'?t|cannot|won'?t|not|no) (\w+ )?diagnos|equipment|scrubb|repair/i.test(s)) reasons.push(`diagnosis language: "${s}"`);
    for (const [re, why] of UNSAFE) if (re.test(s)) reasons.push(`${why}: "${s}"`);
    if (!input.hourOverLimit && DURATION_OVER_LIMIT.some((re) => re.test(s))) reasons.push(`time "above the limit", but NASA's limit is a 1-hour average and no hour was over it: "${s}"`);
    const unknown = numbersIn(s, true).filter((n) => !allowed.has(String(n)));
    if (unknown.length) reasons.push(`numbers not in the readings or passages (${[...new Set(unknown)].join(', ')}): "${s}"`);
  }
  if (input.subject) {
    const problem = personProblem(kept.join(' '), input.subject);
    if (problem) reasons.push(problem);
  }
  if (reasons.length) return refuse(reasons, true, dropped);

  // 5. Too little left to be an answer.
  const body = kept.join(' ');
  if ((body.match(/\w+/g) ?? []).length < 6) return refuse(['fewer than 6 words were left'], dropped.length > 0, dropped);

  return { text: source ? `${body}\nSource: [${source}]` : body, by: 'model', fixed: null, discarded: false, reasons: [], dropped, source };
}

// ---------- yes/no danger questions about a reading with a NASA limit ----------

/** A yes/no question about whether a reading with a NASA limit is dangerous or fine. */
export interface DangerVerdict {
  reading: Extract<Reading, { type: 'limit' }>;
  side: 'under' | 'at' | 'over';
  /** What a correct leading "Yes"/"No" is, for this question and these numbers. */
  expect: 'yes' | 'no';
}

const BAD_WORDS = /\b(dangerous|danger|harmful|unsafe|too high|too much|bad for (me|us)|a problem|risky)\b/i;
const OK_WORDS = /\b(safe|ok|okay|fine|alright|all right)\b/i;
const ASKS = /^\s*(is|are|was|will|could|can|does|do)\b|\b(is|are) (it|this|that|the)\b/i;
const AIR_WORDS = /\b(air|room|cabin|quarters|module)\b/i;

/**
 * "Is the CO2 in my room dangerous?" about a reading the hub holds a NASA
 * limit for: the hub answers from the numbers. Null for any other question.
 */
export function dangerCheck(question: string, readings: PersonReadings | null): DangerVerdict | null {
  const q = question.toLowerCase();
  if (!ASKS.test(q)) return null;
  const bad = BAD_WORDS.test(q);
  const ok = OK_WORDS.test(q);
  if (!bad && !ok) return null;
  const limited = (readings?.readings ?? []).filter((r): r is Extract<Reading, { type: 'limit' }> => r.type === 'limit' && r.limit !== undefined);
  const named = limited.find((r) => r.name.toLowerCase().replace(/^cabin\s+/, '').split(/\s+/).every((w) => q.includes(w)))
    ?? (AIR_WORDS.test(q) && limited.length === 1 ? limited[0] : undefined);
  if (!named) return null;
  const side = named.value > named.limit! ? 'over' : named.value < named.limit! ? 'under' : 'at';
  // At the limit is within it: NASA's limit is "no more than".
  const over = side === 'over';
  return { reading: named, side, expect: bad ? (over ? 'yes' : 'no') : (over ? 'no' : 'yes') };
}

/**
 * True when the model's answer agrees with the hub's verdict: a leading
 * "Yes"/"No" must be the right one, and with neither, it must not put the
 * reading on the wrong side of the limit.
 */
export function agreesWithDanger(answer: string, verdict: DangerVerdict): boolean {
  const lead = /^\W*(yes|no)\b/i.exec(answer);
  if (lead) return lead[1].toLowerCase() === verdict.expect;
  const over = /\b(above|over|exceeds?|exceeding|beyond)\b[^.]{0,40}\blimit\b/i.test(answer);
  const under = /\b(below|under|within|inside)\b[^.]{0,40}\blimit\b/i.test(answer);
  return verdict.side === 'over' ? !under || over : !over;
}
