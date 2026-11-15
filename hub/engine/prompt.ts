// What the model is sent, and what the hub checks before and after. Pure: no
// I/O, no model.
//
// Astra, the voice the crew talks to, only relates what the hub hands it: the
// hub's own numbers and NASA's words. Around the model:
//   - screenInput: a crisis, an urgent word, medicine or a dose, and anything
//     shaped like the hub's own message never reach it;
//   - the urgent check: one label, URGENT or ROUTINE. It can only add urgency;
//   - checkAnswer: the model's text is shown only when every check passes, and
//     a refusal is always replaced by the hub's fixed text.
// The hub writes its own answer as well, each fact with its label
// (engine/answer.ts), and core/ai.ts decides which one the crew sees.
// Emergencies are the medical lead's cards, picked by rules (engine/cards.ts),
// never by the model.
//
// History, plainly: a first draft of this prompt, its examples, the urgent
// check, its word list and the refusal text was written on 9 Nov 2026, before
// the hackathon, in the planning spec (~/Desktop/NASA/AI-CORE-SPEC.md). It was
// copied in here on 14 Nov and rewritten during the event for the hub as it is
// now. The NASA passages in the examples are NASA's own words, unchanged, each
// cited by its document.

// ---------- the fixed texts ----------

/** Shown in place of every refusal, so a refusal can never contain a drug name or an amount. No delay is named: it depends on the place. */
export const REFUSAL_TEXT =
  "I don't have that in NASA's text or in your readings, so I won't guess. Tap Ask Houston and the question goes to your flight surgeon.";

/** Fixed texts the hub shows instead of a model answer, by string-table key. English here; engine/strings.ts holds both languages. */
export const FIXED_TEXTS = {
  'ai.refusal': REFUSAL_TEXT,
  'ai.unavailable': "The AI isn't available right now. Here are the readings and NASA's text as they are. Tap Ask Houston to ask your flight surgeon.",
  'ai.slow': "I couldn't finish an answer in time. Here are the readings and NASA's text as they are. Tap Ask Houston to ask your flight surgeon.",
  'ai.busy': "Too many questions are waiting. Ask again in a moment, or tap Ask Houston.",
  'ai.card': 'This needs the steps card, not an answer from me. The card is on screen.',
  'ai.crisis': 'This needs a person, not me. Please go to a crewmate or your Crew Medical Officer now.',
  'ai.crisisTold': "This needs a person, not me. I've asked a crewmate to come and be with you.",
} as const;

export type FixedKey = keyof typeof FIXED_TEXTS;

// ---------- the explainer's rules ----------

/**
 * Astra's rules. The examples that follow them are built further down, by the
 * same code that builds a real message (buildUserMessage), so they look
 * exactly like what the model is sent. Changing a word here changes answers:
 * rerun ai-eval/run.ts after any edit.
 */
export const SYSTEM_PROMPT = `You are Astra, the voice of Astrum, the crew health hub on this space mission. You talk with crew members. They are not medical professionals.

Every message gives you an ASKER line, the READINGS (the hub's own numbers, already compared with the person's normal and with NASA's limits), sometimes one or more PASSAGE blocks that quote NASA word for word, and the QUESTION. Those are your only facts.

How to reply:
- Follow the ASKER line. A person asking about themself is "you" in every sentence, never their name and never she or he, even though the READINGS name them.
- Give the answer to the question first. Then support it with the hub's numbers: the reading, the person's normal, the gap between them, and NASA's limit when one is given. Use each gap exactly as the hub wrote it; never work out a difference, a percentage or a total yourself.
- Mention each reading that is outside the person's normal. When every reading is inside it, say so simply and do not hunt for a problem.
- A trend can be described from the readings alone; it needs no passage.
- If the crew member believes something a passage contradicts or leaves out, tell them, and state what the passage does say.
- When a passage describes what NASA does about the problem, include that, in NASA's terms.
- If the readings say where the hub's comparison points (a room or a person), you may repeat it. It is where the data points, not a cause.
- Never add advice, orders, causes, diagnoses, treatments, medicines, or any number missing from the readings and passages.
- After using a passage, end with the line Source: [the passage's name exactly as in its PASSAGE brackets]. Without a passage, write no source line at all.
- If answering would need something the facts do not hold (a medicine, an amount, how long, which illness), your reply must start with "I don't know." Then say that NASA's text and the readings do not cover it, and that Ask Houston sends the question to the flight surgeon. Add no advice of your own.
- Two to five short sentences, in plain and calm words.`;

/**
 * Words that appear only in the examples. A sentence of an answer that uses
 * one, when the crew's message doesn't, was copied from an example and is
 * dropped. Keep in step with EXAMPLES.
 */
export const EXAMPLE_ONLY_WORDS = [
  'dana', 'kofi', 'third mission', 'career', 'all ages and sexes', 'respiratory rate', 'breaths',
  'neuro-ocular', 'sans', 'swelling', 'times awake', 'workshop',
];

// ---------- the urgent check ----------

export const URGENT_SYSTEM = `You triage messages for Astrum, the crew health hub on this space mission. Answer with one label: URGENT or ROUTINE.

URGENT: someone may be in danger right now. For example: fainting or about to, not responding, confused or slurring, struggling to breathe or choking, chest pain or pressure, bleeding, a burn, a limb that may be broken, sudden numbness or weakness, pain or tingling after a spacewalk, cabin pressure falling, CO2 of 15 mmHg and above, a radiation storm alert.
ROUTINE: anything else, such as questions about limits, trends, sleep, exercise or medicine, a summary of someone's week, why an alert went off, a mild headache, feeling tired, low or worried while the readings are normal.

An off reading or a detector anomaly is ROUTINE on its own. It is URGENT only together with a symptom or an event on the URGENT list.

Return JSON: {"label": "..."}`;

export const URGENT_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'astrum', strict: true, schema: {
      type: 'object', properties: { label: { type: 'string', enum: ['URGENT', 'ROUTINE'] } },
      required: ['label'], additionalProperties: false,
    },
  },
} as const;

/**
 * What sends a typed message straight to the card, before any model runs,
 * grouped by what it means. It can only add urgency: a match never reaches
 * the model. Everything the first draft caught is still caught.
 */
const URGENT_PHRASES = [
  // bleeding
  'bleed', 'blood',
  // not awake, not answering
  'unconscious', 'unresponsive', 'not responding', "won'?t wake", 'collapsed', 'fainted', 'passed out',
  // breathing
  'choking', "can'?t breathe", 'cannot breathe', 'not breathing', 'stopped breathing', 'blue lips',
  // chest and brain
  'chest pain', 'seizure', 'slurr(ed|ing)', "can'?t (stand|move|see|speak)",
  // falls, bones, burns
  'fell\\b', 'fall\\b', 'broken', 'fracture', 'swelling', 'swollen', 'burn(ed|t)?\\b', 'blister',
];
export const URGENT_WORDS = new RegExp(URGENT_PHRASES.join('|'));

/** The same list in Portuguese, for a crewmate who types in Portuguese. */
export const URGENT_WORDS_PT = /sangr|sangue|inconsciente|n[aã]o responde|n[aã]o acorda|desmai|engasg|sufoc|n[aã]o consigo respirar|n[aã]o est[aá] respirando|dor no peito|convuls|\bcaiu\b|\bca[ií]\b|quebr|fratur|inchad|inchaço|queimad|queimou|bolha|l[aá]bios roxos|fala enrolada|n[aã]o consigo (ficar de p[eé]|mexer|ver|falar)/;

export function parseUrgentLabel(text: string): 'URGENT' | 'ROUTINE' | null {
  const m = /"label"\s*:\s*"(URGENT|ROUTINE)"/.exec(text) ?? /\b(URGENT|ROUTINE)\b/.exec(text.toUpperCase());
  return m ? (m[1] as 'URGENT' | 'ROUTINE') : null;
}

// ---------- the readings block ----------

/**
 * How a value came to exist, as the screen labels it. The model sees a short
 * mark after the name: "(est.)", "(reported)", "(replayed)", "(simulated)".
 * A measured value carries no mark.
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

/** One reading as one sentence. The hub does the subtraction; the model only reads it. A table confused the small model, so: one line each. */
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


/** How the ASKER line names the person. */
const REFLEXIVE = { she: 'herself', he: 'himself', they: 'themself' } as const;
const PRONOUN_PAIR = { she: 'she/her', he: 'he/him', they: 'they/them' } as const;

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

/** The crew message: the ASKER line, the readings, each passage with its name (or "(no passages)"), the question. */
export function buildUserMessage(input: MessageInput): string {
  const readings = readingsBlock(input.readings, input.detectorLine, input.evidence);
  const question = `QUESTION: ${oneLine(input.question)}`;
  const asker = input.asker ? `${askerLine(input.asker)}\n` : '';
  if (input.passages.length === 0) return `${asker}${readings ? `${readings}\n` : ''}(no passages)\n\n${question}`;
  return asker + [readings, ...input.passages.map(passageBlock), question].filter(Boolean).join('\n\n');
}

// ---------- the examples ----------

/** NASA's own words, quoted as the hub quotes any passage. */
const NASA_CAREER_LIMIT: PromptPassage = {
  name: 'NASA-STD-3001 Radiation Protection Technical Brief',
  text: "[V1 4030] Career Space Permissible Exposure Limit for Space Flight Radiation An individual astronaut's total career effective radiation dose due to space flight radiation exposure shall be less than 600 mSv. This limit is universal for all ages and sexes.",
};
const NASA_SANS: PromptPassage = {
  name: 'NASA Risk of Spaceflight Associated Neuro-ocular Syndrome (SANS)',
  text: 'Approximately 70 percent of astronauts aboard the International Space Station experience some swelling in the back of their eyes.',
};
const NASA_CO2_LIMIT: PromptPassage = {
  name: 'NASA-STD-3001 CO2 Technical Brief',
  text: 'Current NASA-STD-3001 Volume 2 [V2 6004] limits the average 1-hour CO2 partial pressure (ppCO2) in the habitable volume to no more than 3 mmHg.',
};

/** The examples' crew member. No profile has this name, so a name copied from an example is easy to catch. */
const DANA = { name: 'Dana', pronouns: 'she' as const };
const dana = (readings: Reading[]): PersonReadings => ({ name: DANA.name, pronoun: 'her', readings });
const DANA_ASKS: Asker = { ...DANA, self: true, askerName: DANA.name };

/**
 * The explainer's examples, as [crew message, answer]. Each crew message is
 * built by buildUserMessage, exactly as a real one. One example per thing the
 * hub needs from the model:
 *   1. a belief the passage corrects, with the hub's numbers and the source line;
 *   2. a crewmate asking about a trend, with no passage: describe, no cause;
 *   3. a question NASA's text does not answer: "I don't know." (the hub then shows REFUSAL_TEXT);
 *   4. readings inside the person's normal: say so, and look for nothing more;
 *   5. the hub's comparison pointing to a room: repeat it, never as a cause.
 * Every answer passes checkAnswer against its own message (prompt.test.ts).
 */
export const EXAMPLES: [string, string][] = [
  [
    buildUserMessage({
      asker: DANA_ASKS, readings: dana([{ type: 'value', name: 'radiation dose this mission', value: 212, unit: 'mSv', label: 'measured' }]),
      detectorLine: 'Detector: normal.', passages: [NASA_CAREER_LIMIT], question: 'This is my third mission. Does the limit start over each time?',
    }),
    `No. NASA's limit covers a whole career: a total effective dose under 600 mSv, the same for all ages and sexes. Your dose on this mission is 212 mSv so far. The hub has no reading from your earlier missions, so I can't give your career total.\nSource: [${NASA_CAREER_LIMIT.name}]`,
  ],
  [
    buildUserMessage({
      asker: { ...DANA, self: false, askerName: 'Kofi' },
      readings: dana([{ type: 'series', name: 'respiratory rate', values: [14, 14, 15, 17, 18], unit: 'breaths/min', window: 'last 5 days', label: 'measured', normal: [12, 16] }]),
      detectorLine: 'Detector: anomaly 0.61. Main signal: respiratory rate trend.', passages: [], question: 'How has Dana been this week?',
    }),
    "Dana's respiratory rate has gone up over the last 5 days, from 14 to 18 breaths/min. The first three days were inside her normal range of 12-16, the last two were above it, and the latest, 18, is 2 over the top of her range. The detector flags the same trend (anomaly 0.61). I have no NASA passage about it, so I can't say why it is rising.",
  ],
  [
    buildUserMessage({
      asker: DANA_ASKS, readings: dana([{ type: 'note', text: 'blurry close-up vision for 10 days', label: 'reported' }]),
      detectorLine: null, passages: [NASA_SANS], question: 'How long until my eyes are back to normal?',
    }),
    `I don't know. The passage says about 70 percent of astronauts on the space station get some swelling in the back of their eyes, but it gives no time for that to go away, so I won't guess. Ask Houston can take the question to your flight surgeon.\nSource: [${NASA_SANS.name}]`,
  ],
  [
    buildUserMessage({
      asker: DANA_ASKS, readings: dana([{ type: 'normal', name: 'times awake in the night', value: 2, unit: '', label: 'measured', normal: [1, 3] }]),
      detectorLine: 'Detector: normal.', passages: [], question: 'I keep waking up at night. Am I sleeping badly?',
    }),
    'Your reading says no. You woke 2 times in the night, inside your usual range of 1-3, and the detector shows nothing unusual. How rested you feel is not something the readings measure, and I have no NASA passage on it.',
  ],
  [
    buildUserMessage({
      asker: DANA_ASKS,
      readings: dana([{ type: 'limit', name: 'cabin CO2', value: 2.7, unit: 'mmHg', label: 'estimated', window: '1-hour average', limit: 3 }]),
      evidence: [
        'CO2 exposure, last 72 hours: 8 h in the workshop above 2.8 mmHg, 0 h above 3 mmHg; crewmates at most 0.5 h above 2.8 mmHg (estimated).',
        'No body reading is unusual for Dana.',
        "The hub's comparison points to the room (the workshop), not to Dana.",
      ],
      detectorLine: 'Detector: normal.', passages: [NASA_CO2_LIMIT], question: 'Is something wrong with me, or is it the workshop?',
    }),
    `The hub's comparison points to the room, the workshop, not to you. In the last 72 hours you spent 8 h there above 2.8 mmHg, and your crewmates at most 0.5 h. Its CO2 now is 2.7 mmHg, 0.3 mmHg below the NASA limit of 3 mmHg, and none of your body readings is unusual. The passage gives the limit; it does not say what the workshop's air does to you.\nSource: [${NASA_CO2_LIMIT.name}]`,
  ],
];

/** The urgent check's crew message: the readings block, then the question. It never carries passages. */
function urgentUserMessage(readings: PersonReadings | null, question: string, detector: string | null = null, evidence: string[] = []): string {
  const block = readingsBlock(readings, detector, evidence);
  return `${block ? `${block}\n\n` : ''}QUESTION: ${oneLine(question)}`;
}

/** The urgent check's examples: three of each label, in the layout the hub sends. */
export const URGENT_EXAMPLES: [string, 'URGENT' | 'ROUTINE'][] = [
  [urgentUserMessage(dana([
    { type: 'note', text: 'hit her head on a hatch; the cut above her eye is bleeding through the cloth', label: 'reported' },
    { type: 'normal', name: 'heart rate', value: 109, unit: 'bpm', label: 'measured', normal: 63 },
  ]), 'What now?'), 'URGENT'],
  [urgentUserMessage(dana([{ type: 'normal', name: 'sleep last night', value: 6.9, unit: 'h', label: 'measured', normal: [6.5, 7.5] }]), 'Why do I feel so groggy this morning?', 'Detector: normal.'), 'ROUTINE'],
  [urgentUserMessage(dana([
    { type: 'normal', name: 'resting heart rate', value: 81, unit: 'bpm', label: 'measured', normal: 62 },
    { type: 'normal', name: 'HRV', value: 36, unit: 'ms', label: 'measured', normal: 54 },
    { type: 'limit', name: 'cabin CO2', value: 3.3, unit: 'mmHg', label: 'estimated', window: '1-hour average', limit: 3 },
  ]), "Why did Dana's alert go off?", 'Detector: anomaly 0.84. Main signals: resting heart rate, HRV.'), 'ROUTINE'],
  [urgentUserMessage(dana([
    { type: 'note', text: 'cabin pressure has been dropping for 4 minutes', label: 'measured' },
    { type: 'note', text: 'her fingertips are numb and she says she cannot think clearly', label: 'reported' },
  ]), 'Is this bad?'), 'URGENT'],
  [urgentUserMessage(null, 'Why does the hub watch CO2 in every room?'), 'ROUTINE'],
  [urgentUserMessage(dana([{ type: 'note', text: 'back from a spacewalk an hour ago: aching left shoulder and pins and needles down the arm', label: 'reported' }]), 'Should I be worried?'), 'URGENT'],
];

/** The explainer's messages: the rules, the examples as chat turns, then the crew message. */
export function buildMessages(input: MessageInput): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...EXAMPLES.flatMap(([u, a]): ChatMessage[] => [{ role: 'user', content: u }, { role: 'assistant', content: a }]),
    { role: 'user', content: buildUserMessage(input) },
  ];
}

/** The urgent check's messages: its rules, its examples, then the crew message without any passage. */
export function buildUrgentMessages(input: Omit<MessageInput, 'passages'>): ChatMessage[] {
  const user = urgentUserMessage(input.readings, input.question, input.detectorLine, input.evidence);
  return [
    { role: 'system', content: URGENT_SYSTEM },
    ...URGENT_EXAMPLES.flatMap(([u, a]): ChatMessage[] => [{ role: 'user', content: u }, { role: 'assistant', content: `{"label": "${a}"}` }]),
    { role: 'user', content: user },
  ];
}

// ---------- the input screen ----------

/**
 * Words that mean a crewmate may be in crisis. Kept short and literal on purpose. A match never reaches the model: the hub
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
 *   3. the urgent word list (English and Portuguese): the card;
 *   4. a question about medicine or a dose: the fixed refusal. The model is
 *      told to refuse these too; the hub makes it certain by never asking it.
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

/**
 * Phrases the crew must never be shown, by why: being told to wait for Earth,
 * help only Earth has, comfort the readings can't give, or being kept from
 * oxygen or the storm shelter. Each covers at least what the first draft did.
 */
const UNSAFE: [RegExp, string][] = [
  [/\b(wait|hold off|hold on)\b[^.]{0,30}\b(houston|earth|reply|response|answer|instructions?|guidance|approval|go-ahead)\b|\buntil (houston|earth|mission control|the flight surgeon)\b|\bbefore (you )?(do|doing|take|taking) any(thing| action)\b|\bwithout (authori[sz]ation|permission|approval|the go-ahead)\b|\b(ask|asking|get|getting) (houston('s)? )?(for )?(permission|approval)\b|\bawait(ing)?\b/i, 'waiting for Houston'],
  [/\b(9-?1-?1|ambulances?|helicopters?|hospitals?|emergency (room|department))\b/i, 'help only Earth has'],
  [/\b(no|don'?t|do not) need to (worry|be (worried|concerned))\b|\bnothing to (worry|be worried|be concerned) about\b|\bsafe to (continue|carry on|keep going)\b|\byou('re| are) (fine|okay|ok|safe|healthy|all right|alright|in the clear)\b|\bno (cause|reason) for (concern|worry|alarm)\b/i, 'false comfort'],
  [/\b(do not|don'?t|never|no need to) (try to )?(breathe|give|use|apply|put on|start) (the |any )?(100% |extra |supplemental )?(o2|oxygen|mask)\b/i, 'withholding oxygen'],
  [/\b(do not|don'?t|never|no need to) (go|relocate|move|head|stay|shelter)\b.{0,30}\bshelter/i, 'keeping the crew out of shelter'],
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
  /** Sentences dropped for words that exist only in the examples (EXAMPLE_ONLY_WORDS). */
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

/** Every check on a model answer. Any one that fails replaces the answer; core/ai.ts then shows the hub's own answer or a fixed text. */
export function checkAnswer(input: CheckInput): CheckResult {
  const refuse = (reasons: string[], discarded: boolean, dropped: string[] = []): CheckResult =>
    ({ text: REFUSAL_TEXT, by: 'fixed', fixed: 'ai.refusal', discarded, reasons, dropped, source: null });

  let t = input.answer.replace(/^\s*<think>\s*<\/think>\s*/, '').trim();
  if (/<\/?think>/.test(t)) return refuse(['the answer has thinking markers in it'], true);
  if (!t) return { text: '', by: 'fixed', fixed: 'fallback', discarded: false, reasons: ['the answer was empty'], dropped: [], source: null };

  // 1. A refusal is always the fixed text, so it can never carry a dose or a drug.
  // Any answer that opens with "I don't know" (or "Não sei") is a refusal, whatever follows.
  if (/^\W*(i (don'?t|do not) know|n[aã]o sei)\b/i.test(t)) return refuse(['the model said it does not know'], false);

  // 2. Nothing after the source line. 3. The source must be one that was sent.
  let source: string | null = null;
  const src = /\bSource:\s*\[?([^\]\n]*)\]?/i.exec(t);
  if (src) {
    const name = src[1].trim();
    t = t.slice(0, src.index).trim();
    // "Source: [none]" and the like name no source: only the line is dropped.
    // Any other name that wasn't sent is a made-up source, and the whole answer goes.
    if (NO_SOURCE.test(name)) source = null;
    else if (!input.passageNames.includes(name)) return refuse([`it cites "${name}", which was not sent`], true);
    else source = name;
  }
  for (const m of t.matchAll(/\[([^\]\n]+)\]/g)) {
    if (!input.passageNames.includes(m[1].trim())) return refuse([`it names "${m[1].trim()}", which was not sent`], true);
  }

  // 4. A sentence using a word that only the examples contain was copied from them: drop it.
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
