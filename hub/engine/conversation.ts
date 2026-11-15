// A short conversation with Astra, held by the hub's rules. Pure: no I/O, no model.
//
// Every message is still answered as one complete question by the single-question
// pipeline (core/ai.ts), with all its checks. Around it, the hub alone:
//   - answers small talk ("hi", "thanks", "who are you?") with its own sentences;
//   - rewrites a message that leans on the one before ("and yesterday?", "why?",
//     "is that bad?", "and my heart rate?", "what about Leo?") into a complete
//     question, from the previous question's topic, and says how it understood it;
//     when it cannot tell what "that" means, it asks which one, from the topics it has;
//   - reads a reply to a question it asked (her follow-up questions, a card's own
//     questions, "Did it get better?", "which one?") against that question's answers.
// Nothing typed in an earlier turn is ever sent to the model: a topic is a word
// from the fixed list below, found by rule.

import { isComplaint } from './prompt.ts';
import { nearCopy, presenceAgain } from './glue.ts';
import type { DayPart } from './glue.ts';

export type Lang = 'en' | 'pt';

// ---------- small talk ----------

export type SmallTalk = 'greeting' | 'thanks' | 'ack' | 'who' | 'abilities' | 'bye' | 'howAreYou';

/**
 * The hub's own small-talk sentences, a few of each so they do not read as
 * canned, in one voice: calm, plain, warm, second person. "who" and "abilities"
 * say what Astra can and cannot do; the rest are only the human part of a turn,
 * and the model may write that part instead (engine/glue.ts), checked.
 */
export const SMALL_TALK: Record<SmallTalk, { en: string[]; pt: string[] }> = {
  greeting: {
    en: ["Hi, I'm Astra. I can look at your readings, your sleep, the air in a room or what NASA's text says with you. If someone is hurt or unwell, tell me what is happening.",
      "Hello. I'm Astra. Ask me about a reading, the air in your room or what NASA's text says. I can't diagnose, but I can tell you what the numbers show.",
      'Hi again. What would you like to look at: a reading, your sleep, the air, or a NASA limit?'],
    pt: ['Oi, eu sou a Astra. Posso olhar com você suas leituras, seu sono, o ar de um ambiente ou o que diz o texto da NASA. Se alguém estiver machucado ou passando mal, me diga o que está acontecendo.',
      'Olá. Eu sou a Astra. Pergunte sobre uma leitura, o ar do seu ambiente ou o que diz o texto da NASA. Não faço diagnóstico, mas posso dizer o que os números mostram.',
      'Oi de novo. O que você quer olhar: uma leitura, seu sono, o ar ou um limite da NASA?'],
  },
  thanks: {
    en: ["You're welcome. I'm here if you want to look at anything else.", 'Glad it helped. I am around whenever you want another look.', 'Any time.'],
    pt: ['De nada. Estou aqui se quiser olhar mais alguma coisa.', 'Que bom que ajudou. Estou por perto quando quiser olhar de novo.', 'Sempre que precisar.'],
  },
  ack: {
    en: ['Okay. I am here when you want me.', 'Got it.', 'Alright. Ask me whenever you like.'],
    pt: ['Certo. Estou aqui quando quiser.', 'Entendi.', 'Combinado. Pergunte quando quiser.'],
  },
  who: {
    en: ["I'm Astra, the voice of the Astrum hub. I answer from your readings and from NASA's text, and I say where each fact comes from. I don't diagnose or recommend treatment: for that, your Crew Medical Officer, or Contact Earth.",
      "I'm Astra. I read you the hub's numbers and NASA's documents, nothing else. I can't diagnose, and in an emergency I show the medical lead's steps card."],
    pt: ['Sou a Astra, a voz do hub Astrum. Respondo a partir das suas leituras e do texto da NASA, e digo de onde vem cada fato. Não faço diagnóstico nem indico tratamento: para isso, o oficial médico da tripulação, ou Contatar a Terra.',
      'Sou a Astra. Leio para você os números do hub e os documentos da NASA, nada mais. Não faço diagnóstico, e numa emergência mostro o cartão de passos da responsável médica.'],
  },
  abilities: {
    en: ['I can tell you what your readings show against your own normal, what the air in a room reads against NASA\'s limits, and what NASA\'s text says. I can\'t diagnose or tell you which medicine to take. You could start with "How did I sleep?" or "Is the CO2 in my room under the limit?"',
      'Ask me about a reading (sleep, heart rate, blood oxygen), the air in a room, your radiation dose, or a NASA limit. I answer only from the hub\'s numbers and NASA\'s documents, and I never diagnose.'],
    pt: ['Posso dizer o que suas leituras mostram em relação ao seu normal, o que o ar de um ambiente mostra em relação aos limites da NASA e o que diz o texto da NASA. Não faço diagnóstico nem digo que remédio tomar. Dá para começar com "Como eu dormi?" ou "O CO2 do meu alojamento está abaixo do limite?"',
      'Pergunte sobre uma leitura (sono, frequência cardíaca, oxigênio no sangue), o ar de um ambiente, sua dose de radiação ou um limite da NASA. Respondo só com os números do hub e os documentos da NASA, e nunca faço diagnóstico.'],
  },
  bye: {
    en: ['Bye for now. I am here whenever you need me.', 'See you later.', 'Take care. I am around.'],
    pt: ['Até logo. Estou aqui sempre que precisar.', 'Até mais.', 'Se cuida. Estou por perto.'],
  },
  howAreYou: {
    en: ['Running steady, thanks for asking. What would you like to look at?', 'All quiet on my side. What would you like to look at?'],
    pt: ['Tudo funcionando por aqui, obrigada por perguntar. O que você quer olhar?', 'Tudo tranquilo do meu lado. O que você quer olhar?'],
  },
};

/** A greeting's human part by the hub's time of day: the model may write it instead. Never anything that implies she watched them. */
export const GREETING_LEAD: Record<DayPart, { en: string[]; pt: string[] }> = {
  night: { en: ['Hi. Still up?', 'Hey. Quiet hour on the station.', 'Hi. Late one tonight.'], pt: ['Oi. Ainda acordado?', 'Oi. Hora quieta na estação.', 'Oi. Noite longa hoje.'] },
  morning: { en: ['Good morning.', 'Morning.', 'Hi. A new day out here.'], pt: ['Bom dia.', 'Oi, bom dia.', 'Oi. Dia novo por aqui.'] },
  afternoon: { en: ['Hi.', 'Good afternoon.', 'Hey, good to hear from you.'], pt: ['Oi.', 'Boa tarde.', 'Oi, bom te ouvir.'] },
  evening: { en: ['Good evening.', 'Hi. Evening already.', 'Hey. Winding down?'], pt: ['Boa noite.', 'Oi. Já é noite.', 'Oi. Fim de dia?'] },
};

/** What the hub says after a greeting's human part: who Astra is the first time in a thread, a plain invitation after. */
export const GREETING_NEXT = {
  first: {
    en: "I'm Astra. I can look at your readings, your sleep, the air in a room or what NASA's text says with you. If someone is hurt or unwell, tell me what is happening.",
    pt: 'Eu sou a Astra. Posso olhar com você suas leituras, seu sono, o ar de um ambiente ou o que diz o texto da NASA. Se alguém estiver machucado ou passando mal, me diga o que está acontecendo.',
  },
  again: { en: 'What would you like to look at?', pt: 'O que você quer olhar?' },
} as const;

/** A quiet line kept under every reply for the rest of a conversation in which a crisis phrase was written. */
export const AFTER_CRISIS = {
  en: 'If you want someone with you, a crewmate or Contact Earth is one tap away.',
  pt: 'Se quiser alguém com você, um colega ou Contatar a Terra está a um toque.',
} as const;

/** The opener of a sentence: its first two words, lower case. */
export function openerWords(text: string): string {
  return plain(text).replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
}

/**
 * One of a list of lines, starting at the turn number so a thread varies, and
 * skipping any line that opens like one of her recent replies or repeats one.
 */
export function pickLine(list: readonly string[], turn: number, recent: readonly string[] = []): string {
  const used = new Set(recent.slice(-3).map(openerWords));
  const said = new Set(recent.slice(-3));
  for (let i = 0; i < list.length; i++) {
    const line = list[(Math.abs(turn) + i) % list.length];
    if (!used.has(openerWords(line)) && !said.has(line) && !recent.slice(-2).some((r) => nearCopy(line, r)) && !presenceAgain(line, recent)) return line;
  }
  for (let i = 0; i < list.length; i++) {
    const line = list[(Math.abs(turn) + i) % list.length];
    if (!used.has(openerWords(line)) && !said.has(line)) return line;
  }
  return list[Math.abs(turn) % list.length];
}

/** Words that never belong to small talk: a symptom, a body part, a reading, help. Any of them, and the message is a real one. */
const NOT_SMALL_TALK = /\b(help|socorro|ajuda|hurt\w*|pain|dor\w*|sick|ill|unwell|feel\w*|sinto|dizzy|tont\w*|bleed\w*|blood|sangue|breath\w*|respir\w*|chest|peito|head\w*|cabe[cç]a|heart|cora[cç][aã]o|sleep\w*|sono|dormi\w*|co2|oxygen|oxig[eê]nio|pressure|press[aã]o|reading\w*|leitura\w*|limit\w*|room|quarters|alojamento|radiation|radia[cç][aã]o|dose)\b/i;

const SMALL_TALK_PATTERNS: [SmallTalk, RegExp][] = [
  ['who', /^(who|what) are you\b|^what('?s| is) (your name|astra)\b|^(quem|o que) (é|e) (voc[eê]|a astra)\b|^quem (é|e) voc[eê]\b|^qual (é |e )?(o )?seu nome\b/],
  ['abilities', /^what can (you|i) (do|ask)\b|^how (do|can) i use (you|this)\b|^what do you (do|know)\b|^o que (voc[eê] )?(pode|sabe|faz)\b|^o que (eu )?posso (perguntar|te perguntar)\b|^como (eu )?(uso|te uso)\b/],
  ['howAreYou', /^(how are you|how'?s it going|how are you doing|how do you do|tudo bem|como vai|como voc[eê] est[aá])\b/],
  ['bye', /^(bye|goodbye|good night|see you|see ya|later|tchau|at[eé] (logo|mais|amanh[aã])|boa noite)\b/],
  ['thanks', /^(thanks|thank you|thx|ty|cheers|obrigad[oa]|valeu|vlw)\b/],
  ['ack', /^(ok|okay|k|kk|cool|nice|great|alright|got it|sure|fine|certo|beleza|blz|entendi|t[aá] bom|show|that('?s| is)? (helps?|helped|helpful)|(very |really )?helpful|ajudou)\b/],
  ['greeting', /^(hello|hi|hey|heya|hiya|yo|howdy|greetings|good (morning|afternoon|evening)|gm|test|testing|ping|ol[aá]|oi|opa|e a[ií]|eae|bom dia|boa tarde|teste|testando|astra)\b/],
];

/**
 * The kind of small talk a message is, or null for a real message. By rule,
 * conservatively: short, made of small-talk words only, and never with a
 * symptom, a body part, a reading or "help" in it.
 */
export function smallTalkKind(text: string): SmallTalk | null {
  // Accents are taken off first: a JavaScript word boundary does not see "ê" as part of a word.
  const q = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[‘’ʼ`]/g, "'").replace(/[!?.,;:…\s]+/g, ' ').replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return 'greeting';
  // A goodbye with a few plain words around it ("ok, going to try to rest. bye", "valeu, vou dormir, boa noite"):
  // still a goodbye, when every other word is one of a short fixed list. Never with a question mark.
  if (!text.includes('?') && q.split(' ').length <= 10 && new RegExp(BYE_ANYWHERE.source).test(q) && !q.replace(BYE_ANYWHERE, ' ').replace(BYE_FILLER, ' ').trim()) return 'bye';
  if (q.split(' ').length > 8 || NOT_SMALL_TALK.test(q)) return null;
  // After the small-talk words, only a name ("hi Astra") or a few small words may follow.
  const rest = (re: RegExp) => q.replace(re, '').replace(/\b(astra|astrum|there|everyone|all|you|too|a lot|so much|very much|muito|again|de novo|for (now|that)|then|ent[aã]o|e|and|that('?s| is)? (helps?|helped|helpful)|it (helps?|helped)|(very |really )?helpful|ajudou)\b/g, '').trim();
  for (const [kind, re] of SMALL_TALK_PATTERNS) {
    if (!re.test(q)) continue;
    if (kind === 'who' || kind === 'abilities') return kind;
    const left = rest(re);
    if (!left || SMALL_TALK_PATTERNS.some(([, other]) => other.test(left))) return kind;
  }
  return null;
}

const BYE_ANYWHERE = /\b(bye|goodbye|good night|night night|see you( later| tomorrow)?|later|tchau|at[eé] (logo|mais|amanh[aã])|boa noite)\b/g;
const BYE_FILLER = /\b(ok|okay|alright|right|well|so|thanks|thank you|thx|cheers|astra|i'?m|i am|im|going to|gonna|off to|heading to|try to|time to|time for|get some|go to|to|now|for now|for today|for tonight|then|again|some|sleep|bed|rest|nap|valeu|obrigad[oa]|vou|tentar|dormir|descansar|deitar|agora|por hoje|ent[aã]o|e|and)\b|[,.;:!…\s]+/g;

/** Portuguese words that are not English words, accents off. Two signs (two words, or a word and an accent mark) make a message Portuguese. */
const PT_QUESTION_WORDS = /\b(como|eu|dormi|dormiu|meu|minha|meus|minhas|esta|estou|estava|hoje|ontem|por que|porque|quanto|quanta|qual|quais|obrigad[oa]|voce|nao|tudo|bem|sono|cansad[oa]|cabeca|dor|tenho|estou|noite|agora|ainda|isso|muito|frequencia|cardiaca|pressao|oxigenio|ajuda|valeu|tchau|oi|ola|bom dia|boa noite|boa tarde)\b/g;
const PT_MARKS = /[ãõáéíóúâêôç]/i;

/**
 * The language to reply in: the screen's, unless the message itself is plainly Portuguese
 * (two signs of it among accent marks and Portuguese words: "como eu dormi?"). Conservative: never switches to English.
 */
export function messageLang(text: string, screen: Lang): Lang {
  if (screen === 'pt') return 'pt';
  const q = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = new Set([...q.matchAll(PT_QUESTION_WORDS)].map((m) => m[1])).size;
  return words + (PT_MARKS.test(text) ? 1 : 0) >= 2 ? 'pt' : 'en';
}

/** One of the hub's small-talk sentences, picked by the turn number so a thread does not repeat itself. */
export function smallTalkReply(kind: SmallTalk, lang: Lang, turn: number, recent: readonly string[] = []): string {
  return pickLine(SMALL_TALK[kind][lang], turn, recent);
}

// ---------- remarks ----------

/**
 * A remark or a reaction to the previous answer: not a question, not a
 * complaint, not small talk ("I really did sense something weird", "that makes
 * sense", "hm, that's worrying", "interessante").
 */
export type Remark = 'noticed' | 'worry' | 'agree' | 'disagree' | 'surprise';

/** A symptom, a body part, a reading, a medicine, an urgent word: any of them, and the message is not a remark. */
const NOT_REMARK = /\b(help|socorro|ajuda|hurt\w*|pain\w*|ache\w*|dor\w*|doi\w*|sick|ill|unwell|feel\w*|sinto|sentindo|dizz\w*|tont\w*|nause\w*|enjo\w*|vomit\w*|bleed\w*|blood|sangu\w*|breath\w*|respir\w*|chest|peito|head\w*|cabe[cç]a|heart|cora[cç][aã]o|stomach|barriga|est[oô]mago|leg|perna|arm|bra[cç]o|eye\w*|olho\w*|throat|garganta|skin|pele|tired\w*|cansad\w*|fever|febre|cough\w*|tosse|rash|swell\w*|swollen|inchad\w*|numb\w*|faint\w*|desmai\w*|confus\w*|seiz\w*|convuls\w*|anxi\w*|ansi\w*|panic\w*|depress\w*|sleep\w*|slept|sono|dormi\w*|insomnia|ins[oô]nia|co2|oxygen|oxig[eê]nio|pressure|press[aã]o|reading\w*|leitura\w*|limit\w*|radiation|radia[cç][aã]o|dose\w*|medic\w*|rem[eé]dio\w*|pill\w*|comprimido\w*|drug\w*|tablet\w*|ibuprofen\w*|paracetamol|aspirin\w*|dipirona|emergenc\w*|emerg[eê]ncia|urgent\w*|urg[eê]n\w*|die|dying|morr\w*|kill\w*|suic\w*|hurt)\b/i;

const FILLERS = /^((hm+|hmm+|uh+|ah+|oh+|ok|okay|well|so|yeah|yes|wow|hum+|ah+|eh+|bom|bem|nossa|puxa|n[eé]|tipo)\b[\s,.!]*)+/;

const AGREE = /^(that makes sense|makes sense|that explains (it|a lot)|i (thought|figured|guessed|suspected) (so|as much)|i see|i get it|right|true|exactly|fair enough|agreed|i agree|of course|faz sentido|isso explica|imaginei|eu imaginei|eu (achei|pensei) (mesmo|isso)|verdade|exato|exatamente|pois [eé]|concordo|tem raz[aã]o|claro)\b/;

const REMARK_PATTERNS: [Remark, RegExp][] = [
  ['noticed', /\b(i (really |kind of |kinda )?(did |do )?(sense|sensed|noticed|notice|knew|suspected|suspect)|i (knew|thought) (it|something)|something (was |is |felt |seemed )?(weird|off|wrong|strange|odd|different)|(weird|off|strange|odd) lately|(eu )?(bem que (eu )?(senti|achei|sabia|percebi))|eu (sabia|percebi|desconfiei|notei)|(tinha|havia|tem) (algo|alguma coisa) (estranho|esquisito|errado|diferente)|algo (estranho|esquisito|errado|diferente))\b/],
  ['surprise', /\b(i (did ?n'?t|did not|had no idea|never) (know|knew|realis\w*|realiz\w*|thought|expect\w*)|i had no idea|interesting|no way|who knew|^really$|^seriously$|^huh$|didn'?t expect|n[aã]o sabia|nem sabia|n[aã]o fazia ideia|interessante|curioso|s[eé]rio|caramba|uau|olha s[oó]|quem diria)\b/],
  ['disagree', /\b(i (don'?t|do not) (think so|agree|buy (it|that)|believe (it|that))|that'?s not (right|true)|i doubt (it|that)|not sure about that|n[aã]o (acho|concordo|acredito)|duvido|n[aã]o (é|e) bem assim)\b/],
  ['worry', /\b(worr\w*|scar(y|ed)|concern\w*|afraid|nervous|uh oh|yikes|not good|preocup\w*|medo|assust\w*|tenso|tensa|nervos[oa])\b/],
  ['agree', AGREE],
];

/**
 * The kind of remark a message is, or null. By rule, conservatively: at most
 * 14 words, not a question (a short "really?" is surprise), and never with a
 * symptom, a body part, a reading, a medicine or an urgent word in it (a remark
 * that names a new symptom is a complaint, and goes through every rule).
 */
export function remarkKind(text: string): Remark | null {
  if (isComplaint(text)) return null;
  const q = plain(text).replace(/[‘’ʼ`]/g, "'").replace(/[^\p{L}\p{N}'?\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!q || q.split(' ').length > 14 || NOT_REMARK.test(q)) return null;
  if (TOPICS.some((t) => t.re.test(q))) return null;
  const body = q.replace(/\?/g, '').trim().replace(FILLERS, '').trim();
  if (!body) return null;
  if (q.includes('?') && !/^(really|seriously|s[eé]rio|mesmo|is that so|no way|huh)\b/.test(body)) return null;
  if (QUESTION_WORDS.test(body) && !AGREE.test(body)) return null;
  for (const [kind, re] of REMARK_PATTERNS) if (re.test(body)) return kind;
  return null;
}

/** The hub's sentence for each kind of remark: it acknowledges, never judges, diagnoses or reassures. {topic} is the previous exchange's topic, in the hub's words. */
export const REMARK_TEXTS: Record<Remark, { en: string[]; pt: string[] }> = {
  noticed: {
    en: ['Good that you noticed. What you sense about {topic} is worth keeping track of.', 'You know your own days best. It helps to keep track of {topic} when something seems different.', 'That is worth holding on to. Changes in {topic} are easier to see when you write them down.'],
    pt: ['Que bom que você percebeu. O que você sente sobre {topic} vale ser acompanhado.', 'Você conhece seus dias melhor que ninguém. Ajuda acompanhar {topic} quando algo parece diferente.', 'Vale guardar isso. Anotar ajuda a ver como {topic} muda.'],
  },
  worry: {
    en: ['That is a fair thing to wonder about, with {topic}.', 'It makes sense to want to understand {topic} better.', 'I hear you. It is fair to want to understand {topic}.'],
    pt: ['É uma dúvida justa, sobre {topic}.', 'Faz sentido querer entender melhor {topic}.', 'Entendo. É justo querer entender {topic}.'],
  },
  agree: {
    en: ['Glad that helps make sense of {topic}.', 'Okay. That is the picture of {topic} for now.', 'Good. It helps when the numbers on {topic} match what you sense.'],
    pt: ['Que bom que isso ajuda a entender {topic}.', 'Certo. Esse é o retrato de {topic} por enquanto.', 'Bom. Ajuda quando os números sobre {topic} batem com o que você sente.'],
  },
  disagree: {
    en: ['Fair enough. The numbers are only part of the picture of {topic}; how you feel counts too.', 'That is okay. You know how {topic} feels for you better than the readings do.'],
    pt: ['Tudo bem. Os números contam só uma parte sobre {topic}; o que você sente também conta.', 'Tudo bem. Você sabe melhor que as leituras como está {topic}.'],
  },
  surprise: {
    en: ['It is a lot to take in about {topic}.', 'It can be surprising to see {topic} in numbers.', 'Good to know, right? Numbers on {topic} can say more than you expect.'],
    pt: ['É bastante coisa sobre {topic}.', 'Pode surpreender ver {topic} em números.', 'Bom saber, né? Os números sobre {topic} às vezes dizem mais do que a gente espera.'],
  },
};

/** The hub's next steps after a remark, each honest about what happens. */
export const REMARK_NEXT = {
  offer: { en: 'I can show you {options}. Which one?', pt: 'Posso mostrar {options}. Qual deles?' },
  offerOne: { en: 'Want to see {options}?', pt: 'Quer ver {options}?' },
  declined: { en: 'Okay. Ask me whenever you like.', pt: 'Certo. Pergunte quando quiser.' },
  note: { en: 'Do you want me to save what you noticed as a check-in note? Only you can read the words.', pt: 'Quer que eu salve o que você percebeu como uma nota de check-in? Só você pode ler o texto.' },
  noTopic: { en: 'Tell me what you noticed, or ask me about a reading.', pt: 'Me conte o que você percebeu, ou pergunte sobre uma leitura.' },
  saved: { en: 'Saved as a check-in note. Only you can read it.', pt: 'Salvo como nota de check-in. Só você pode ler.' },
  notSaved: { en: 'Okay, I did not save it. Ask me anything about your readings.', pt: 'Certo, não salvei. Pergunte o que quiser sobre suas leituras.' },
} as const;

/** Symptom words the hub may name a previous topic by ("your headache"). A fixed list; never the words typed. */
const SYMPTOM_TOPICS: { re: RegExp; en: string; pt: string }[] = [
  { re: /\b(headaches?|head hurts|dor de cabe[cç]a)\b/, en: 'your headache', pt: 'a sua dor de cabeça' },
  { re: /\b(nause\w*|enjo\w*)\b/, en: 'your nausea', pt: 'o seu enjoo' },
  { re: /\b(dizz\w*|tontur\w*|tont[oa])\b/, en: 'your dizziness', pt: 'a sua tontura' },
  { re: /\b(tired\w*|fatigue|cansa\w*)\b/, en: 'your tiredness', pt: 'o seu cansaço' },
];

/** How the hub names the previous exchange's topic in a remark reply: a symptom from its fixed list, else a signal topic, else "this". */
export function remarkTopic(previousText: string | null, signals: readonly string[], lang: Lang): string {
  const q = plain(previousText ?? '');
  const symptom = SYMPTOM_TOPICS.find((s) => s.re.test(q));
  if (symptom) return symptom[lang];
  if (signals[0]) return topicName(signals[0], lang, true, '').replace(/\bmy\b/g, 'your').replace(/\bo meu\b/g, 'o seu').replace(/\ba minha\b/g, 'a sua').replace(/\bdo meu\b/g, 'do seu');
  return lang === 'pt' ? 'isso' : 'this';
}

/** The acknowledgement sentence, picked by the turn number so a thread does not repeat itself. */
export function remarkReply(kind: Remark, lang: Lang, turn: number, topic: string, recent: readonly string[] = []): string {
  return pickLine(REMARK_TEXTS[kind][lang].map((l) => l.replace('{topic}', topic)), turn, recent);
}

/** "your sleep or the CO2 in your room", for the hub's offer. */
export function offerText(options: readonly string[], lang: Lang): string {
  const names = options.map((id) => remarkTopic(null, [id], lang));
  const last = names.pop();
  const list = names.length ? `${names.join(', ')} ${lang === 'pt' ? 'ou' : 'or'} ${last}` : last ?? '';
  return REMARK_NEXT[options.length === 1 ? 'offerOne' : 'offer'][lang].replace('{options}', list);
}

// ---------- topics ----------

/** What the hub can name a topic by. A topic is always one of these, found by rule; never the words a person typed. */
export interface SignalTopic {
  id: string;
  en: string;
  /** Portuguese noun and its gender, for "o meu sono", "a minha frequência cardíaca". */
  pt: { noun: string; g: 'm' | 'f' };
  re: RegExp;
}

export const TOPICS: SignalTopic[] = [
  { id: 'sleep', en: 'sleep', pt: { noun: 'sono', g: 'm' }, re: /\b(sleep\w*|slept|sono|dormi\w*|dormiu)\b/i },
  { id: 'heart_rate', en: 'heart rate', pt: { noun: 'frequência cardíaca', g: 'f' }, re: /\b(heart ?rate|pulse|bpm|frequ[eê]ncia card[ií]aca|batimentos?|pulso)\b/i },
  { id: 'hrv', en: 'HRV', pt: { noun: 'variabilidade cardíaca', g: 'f' }, re: /\b(hrv|heart rate variability|variabilidade)\b/i },
  { id: 'blood_oxygen', en: 'blood oxygen', pt: { noun: 'oxigênio no sangue', g: 'm' }, re: /\b(blood oxygen|spo2|oxygen saturation|satura[cç][aã]o|oxig[eê]nio no sangue)\b/i },
  { id: 'co2', en: 'CO2', pt: { noun: 'CO2', g: 'm' }, re: /\b(co2|c02|carbon dioxide|air|ar)\b/i },
  { id: 'steps', en: 'steps', pt: { noun: 'número de passos', g: 'm' }, re: /\b(steps|passos)\b/i },
  { id: 'exercise', en: 'exercise', pt: { noun: 'exercício', g: 'm' }, re: /\b(exercis\w*|workout|exerc[ií]cio|treino)\b/i },
  { id: 'radiation', en: 'radiation dose', pt: { noun: 'dose de radiação', g: 'f' }, re: /\b(radiation|dose|msv|radia[cç][aã]o)\b/i },
];

const WINDOWS: { id: string; en: string; pt: string; re: RegExp }[] = [
  { id: 'yesterday', en: 'yesterday', pt: 'ontem', re: /\b(yesterday|ontem)\b/i },
  { id: 'last-night', en: 'last night', pt: 'ontem à noite', re: /\b(last night|tonight|ontem [aà] noite|esta noite|hoje [aà] noite)\b/i },
  { id: 'today', en: 'today', pt: 'hoje', re: /\b(today|hoje)\b/i },
  { id: 'this-week', en: 'this week', pt: 'esta semana', re: /\b(this week|esta semana|nesta semana)\b/i },
];

export interface Topic {
  /** Topic ids from TOPICS, in the order the message names them. */
  signals: string[];
  /** The crewmate the question is about. */
  about: string;
  /** A time window id from WINDOWS, or null. */
  window: string | null;
}

export interface CrewName { id: string; name: string }

/** Lower case, accents off (a JavaScript word boundary does not see "ê" as a letter), one space. */
function plain(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[‘’ʼ`]/g, "'").replace(/\s+/g, ' ').trim();
}

function namedCrewmate(text: string, crew: readonly CrewName[], asker: string): string | null {
  const q = plain(text);
  for (const c of crew) {
    if (c.id === asker) continue;
    const n = plain(c.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (n && new RegExp(`\\b${n}('s)?\\b`, 'i').test(q)) return c.id;
  }
  return null;
}

/** The topic of a message, by rule: which of the hub's topics it names, about whom, and when. */
export function topicOf(text: string, crew: readonly CrewName[], asker: string, about = asker): Topic {
  const q = plain(text);
  const signals = TOPICS.filter((t) => t.re.test(q)).map((t) => t.id);
  return { signals, about: namedCrewmate(q, crew, asker) ?? about, window: WINDOWS.find((w) => w.re.test(q))?.id ?? null };
}

// ---------- follow-ups ----------

/** What the previous exchange was about, kept by the hub. */
export interface Previous {
  /** The complete question the hub answered (its own rewrite, or what was typed). */
  question: string;
  topic: Topic;
  /** True when the previous message reported a symptom (a complaint): "what should I do?" then repeats it. */
  complaint: boolean;
}

export type Resolution =
  | { kind: 'standalone' }
  | { kind: 'rewritten'; question: string; topic: Topic }
  | { kind: 'clarify'; text: string; options: string[]; base: FollowUpShape };

type FollowUpShape = 'how' | 'when' | 'why' | 'bad' | 'whatDo';

const LEAD = /^(and|also|plus|so|what about|how about|e|tamb[eé]m|e quanto (a|ao|à)|e sobre|e o|e a|e os|e as)\b/i;
const WHY = /^(why|how come|por ?qu[eê]|porque)\b/i;
const BAD = /^(is (that|it|this) (bad|ok|okay|normal|a problem|dangerous|serious|good|fine)|isso (é|e) (ruim|normal|grave|perigoso|um problema|bom)|(é|e) (ruim|normal|grave|perigoso))\b/i;
const WHAT_DO = /^(what (should|do|can) i do|what now|and now|o que (eu )?(fa[cç]o|devo fazer|posso fazer)|e agora)\b/i;
const REFERS = /\b(that|it|this|those|these|isso|isto|esse|essa|ele|ela)\b/i;
const QUESTION_WORDS = /^(what|how|why|is|are|was|were|do|does|did|can|could|should|will|when|where|which|who|o que|como|por que|qual|quais|quando|onde|est[aá]|tem|posso|devo)\b/i;

function shapeOf(q: string): FollowUpShape | null {
  if (WHY.test(q)) return 'why';
  if (BAD.test(q)) return 'bad';
  if (WHAT_DO.test(q)) return 'whatDo';
  return null;
}

function topicName(id: string, lang: Lang, self: boolean, whose: string): string {
  const t = TOPICS.find((x) => x.id === id);
  if (!t) return id;
  if (lang === 'pt') {
    if (t.id === 'co2') return self ? 'o CO2 do meu ambiente' : `o CO2 do ambiente de ${whose}`;
    return self ? `${t.pt.g === 'f' ? 'a minha' : 'o meu'} ${t.pt.noun}` : `${t.pt.g === 'f' ? 'a' : 'o'} ${t.pt.noun} de ${whose}`;
  }
  if (t.id === 'co2') return self ? 'the CO2 in my room' : `the CO2 in ${whose}'s room`;
  return self ? `my ${t.en}` : `${whose}'s ${t.en}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A complete question about one topic, in the hub's words. */
export function standaloneQuestion(shape: FollowUpShape, signal: string, topic: Topic, asker: string, crew: readonly CrewName[], lang: Lang): string {
  const self = topic.about === asker;
  const whose = crew.find((c) => c.id === topic.about)?.name ?? topic.about;
  const x = topicName(signal, lang, self, whose);
  const w = WINDOWS.find((v) => v.id === topic.window);
  // Sleep is asked about as people ask it: "How did I sleep last night?", not "How is my sleep?".
  if (signal === 'sleep' && (shape === 'how' || shape === 'when')) {
    const when = shape === 'when' && w ? ` ${w[lang]}` : '';
    if (lang === 'pt') return self ? `Como eu dormi${when}?` : `Como ${whose} dormiu${when}?`;
    return self ? `How did I sleep${when}?` : `How did ${whose} sleep${when}?`;
  }
  // Steps are plural in English.
  if (signal === 'steps' && lang === 'en') {
    if (shape === 'bad') return `Are ${x} a problem?`;
    if (shape === 'when' && w) return `How were ${x} ${w.en}?`;
    if (shape === 'how') return `How are ${x}?`;
  }
  if (lang === 'pt') {
    if (shape === 'why') return `Por que ${x} está assim?`;
    if (shape === 'bad') return `${cap(x)} é um problema?`;
    if (shape === 'whatDo') return `O que devo fazer sobre ${x}?`;
    if (shape === 'when' && w) return `Como estava ${x} ${w.pt}?`;
    return `Como está ${x}?`;
  }
  if (shape === 'why') return `Why is ${x} like this?`;
  if (shape === 'bad') return `Is ${x} a problem?`;
  if (shape === 'whatDo') return `What should I do about ${x}?`;
  if (shape === 'when' && w) return `How was ${x} ${w.en}?`;
  return `How is ${x}?`;
}

/** "Do you mean your sleep or your heart rate?", from the topics the hub has. */
export function clarifyText(options: string[], topic: Topic, asker: string, crew: readonly CrewName[], lang: Lang): string {
  const self = topic.about === asker;
  const whose = crew.find((c) => c.id === topic.about)?.name ?? topic.about;
  const names = options.map((id) => topicName(id, lang, self, whose)
    .replace(/\bmy\b/g, 'your').replace(/\bo meu\b/g, 'o seu').replace(/\ba minha\b/g, 'a sua').replace(/\bdo meu\b/g, 'do seu'));
  const last = names.pop();
  if (lang === 'pt') return `Você quer dizer ${names.length ? `${names.join(', ')} ou ${last}` : last}?`;
  return `Do you mean ${names.length ? `${names.join(', ')} or ${last}` : last}?`;
}

/**
 * Whether a message leans on the one before, and if so the complete question
 * the hub makes of it. With nothing to lean on, or more than one thing "that"
 * could mean, it asks which one (from `candidates`, the topics the hub has),
 * rather than guess.
 */
export function resolveFollowUp(text: string, previous: Previous | null, crew: readonly CrewName[], asker: string, lang: Lang, candidates: string[] = []): Resolution {
  const q = plain(text).replace(/[?!.]+$/, '').trim();
  // A complaint always stands on its own: it goes through every rule as typed.
  if (!q || isComplaint(text)) return { kind: 'standalone' };
  const words = q.split(/\s+/).length;
  const own = topicOf(q, crew, asker, previous?.topic.about ?? asker);
  const lead = LEAD.test(q);
  const shape = shapeOf(q);
  const refers = REFERS.test(q) && words <= 8;
  const windowOnly = !!own.window && own.signals.length === 0 && (words <= 2 || (lead && words <= 4));
  const personOnly = own.about !== (previous?.topic.about ?? asker) && own.signals.length === 0 && words <= 5;
  // A full question of its own: it names its topic and does not lean on anything.
  const dependent = (lead && words <= 8) || (!!shape && words <= 8 && own.signals.length === 0) || (refers && own.signals.length === 0 && !QUESTION_WORDS.test(q.replace(REFERS, '').trim()) ) || windowOnly || personOnly
    || (!!shape && words <= 4);
  if (!dependent) return { kind: 'standalone' };

  // "and my heart rate?": a topic of its own, the rest from before.
  if (own.signals.length === 1 && (lead || !!shape)) {
    const topic: Topic = { signals: own.signals, about: own.about, window: own.window };
    return { kind: 'rewritten', question: standaloneQuestion(shape ?? (topic.window ? 'when' : 'how'), own.signals[0], topic, asker, crew, lang), topic };
  }
  if (own.signals.length > 1) return { kind: 'standalone' };

  // "what should I do?" after a complaint: the complaint again, through every rule it went through the first time.
  if (shape === 'whatDo' && previous?.complaint) return { kind: 'rewritten', question: previous.question, topic: previous.topic };

  const base: FollowUpShape = shape ?? (own.window ? 'when' : 'how');
  const prevSignals = previous?.topic.signals ?? [];
  const topic: Topic = { signals: prevSignals, about: own.about, window: own.window ?? (base === 'when' ? null : previous?.topic.window ?? null) };
  if (prevSignals.length === 1) {
    return { kind: 'rewritten', question: standaloneQuestion(base, prevSignals[0], topic, asker, crew, lang), topic: { ...topic, signals: prevSignals } };
  }
  const options = (prevSignals.length > 1 ? prevSignals : candidates).slice(0, 3);
  if (options.length === 0) return { kind: 'standalone' };
  if (options.length === 1) return { kind: 'rewritten', question: standaloneQuestion(base, options[0], topic, asker, crew, lang), topic: { ...topic, signals: options } };
  return { kind: 'clarify', text: clarifyText(options, topic, asker, crew, lang), options, base };
}

// ---------- replies to a question the hub asked ----------

export interface PendingOption { value: string; label: { en: string; pt: string } }

/** A question the hub asked and waits on, one at a time. */
export interface Pending {
  /**
   * askFirst: her follow-up.json question. card: a card's own check-in question. better: "Did it get better?".
   * clarify: which topic (also the hub's offer after a remark). note: save a remark as a check-in note.
   * feeling: "Are you feeling better?" after any card's steps but hers for no card fitting (nothing stored, nothing raised).
   * offerHelp: after a "no" to it, "Do you want to call for help?" (the screen's "Call for help" confirms, then calls).
   */
  purpose: 'askFirst' | 'card' | 'better' | 'clarify' | 'note' | 'feeling' | 'offerHelp';
  kind: 'yes_no' | 'value' | 'choice';
  /** Where the answer is stored (a check-in signal), for askFirst, card and better. */
  signal?: string;
  text: { en: string; pt: string };
  options: PendingOption[];
  unit?: string;
  /** The complaint that led here, as typed then (already through every screen). Asked again after the answer, to follow her rules. */
  complaint?: string;
  /** Who the answers are about. */
  about: string;
  /** For clarify: how to finish the question once the topic is known. */
  shape?: FollowUpShape;
  topic?: Topic;
  /** For note: the words to save, the crewmate's own, kept only on the hub until answered. */
  note?: string;
  /** How many times it has been asked. */
  asked: number;
}

export const YES_NO: PendingOption[] = [
  { value: 'yes', label: { en: 'Yes', pt: 'Sim' } },
  { value: 'no', label: { en: 'No', pt: 'Não' } },
];

/** The options of "Do you want to call for help?". A screen opens its own confirmation for HELP_OPTION instead of sending it. */
export const HELP_OPTION = 'help';
export const NOT_NOW_OPTION = 'notNow';
export const OFFER_HELP: PendingOption[] = [
  { value: HELP_OPTION, label: { en: 'Call for help', pt: 'Pedir ajuda' } },
  { value: NOT_NOW_OPTION, label: { en: 'Not now', pt: 'Agora não' } },
];

const YES = /^(yes|yeah|yep|yup|y|sure|i do|i did|it is|it did|a (little|bit)|a little bit|somewhat|kind of|sort of|sim|s|claro|um pouco|mais ou menos|tomei|dormi|estou|tenho|aham|uhum|isso)\b/i;
const NO = /^(no|nope|nah|n|not really|not at all|i don'?t|i didn'?t|it isn'?t|it didn'?t|never|n[aã]o|nada|nunca|nem um pouco)\b/i;

export type Reply = { value: number | null; text: string | null; option?: string };

/**
 * A reply read against the question waiting, or null when it does not answer
 * it. yes/no: 1 or 0 ("a little" is yes). value: a number, or the words as
 * typed (a blood pressure "150/95", "since yesterday"). choice: one option, by
 * its name or its place ("the first").
 */
export function interpretReply(text: string, pending: Pending): Reply | null {
  const q = plain(text).replace(/[!.]+$/, '').trim();
  if (!q) return null;
  if (pending.kind === 'yes_no') {
    const yes = YES.test(q);
    const no = NO.test(q);
    if (yes === no) return null;
    return { value: yes ? 1 : 0, text: null, option: yes ? 'yes' : 'no' };
  }
  if (pending.kind === 'value') {
    if (q.length > 80) return null;
    const nums = q.match(/\d+(?:[.,]\d+)?/g) ?? [];
    if (nums.length === 1 && /^\D{0,20}\d+(?:[.,]\d+)?\s*\D{0,20}$/.test(q)) return { value: Number(nums[0].replace(',', '.')), text: q };
    return nums.length || q.split(' ').length <= 6 ? { value: null, text: q } : null;
  }
  // "Do you want to call for help?": yes or no, or either option by name ("not now", "agora não").
  if (pending.purpose === 'offerHelp') {
    const yes = YES.test(q), no = NO.test(q);
    if (yes !== no) return { value: yes ? 1 : 0, text: null, option: yes ? HELP_OPTION : NOT_NOW_OPTION };
    const named = pending.options.filter((o) => q.includes(plain(o.label.en)) || q.includes(plain(o.label.pt)));
    return named.length === 1 ? { value: named[0].value === HELP_OPTION ? 1 : 0, text: null, option: named[0].value } : null;
  }
  // A single offer ("Want to see your sleep?") is answered yes or no too.
  if (pending.options.length === 1 && q.split(' ').length <= 3 && YES.test(q) !== NO.test(q) && !remarkKind(text)) return YES.test(q) ? { value: 1, text: null, option: pending.options[0].value } : { value: 0, text: null };
  const n = /^(the )?(first|1|one|primeir[oa])\b/.test(q) ? 0 : /^(the )?(second|2|two|segund[oa])\b/.test(q) ? 1 : /^(the )?(third|3|three|terceir[oa])\b/.test(q) ? 2 : -1;
  if (n >= 0 && pending.options[n]) return { value: null, text: null, option: pending.options[n].value };
  const hit = pending.options.filter((o) => TOPICS.find((t) => t.id === o.value)?.re.test(q) || q.includes(o.label.en.toLowerCase()) || q.includes(o.label.pt.toLowerCase()));
  return hit.length === 1 ? { value: null, text: null, option: hit[0].value } : null;
}

/**
 * True when a message that does not answer the waiting question still looks
 * like an attempt to (short, no question of its own): the question is asked
 * again with its options. Anything else is a new message, and the question is dropped.
 */
export function looksLikeReply(text: string): boolean {
  const q = plain(text).replace(/[?!.]+$/, '').trim();
  if (!q) return false;
  return q.split(' ').length <= 4 && !QUESTION_WORDS.test(q) && TOPICS.every((t) => !t.re.test(q));
}

/** The choice options for a clarifying question. */
export function topicOptions(ids: string[]): PendingOption[] {
  return ids.map((id) => {
    const t = TOPICS.find((x) => x.id === id);
    return { value: id, label: { en: t ? cap(t.en) : id, pt: t ? cap(t.pt.noun) : id } };
  });
}

// ---------- history from a screen ----------

/** One earlier exchange as a screen sends it back. Every string in it is the crewmate's own text: data, never instructions. */
export interface HistoryItem {
  question: string;
  route?: string;
  card?: string | null;
  understoodAs?: string | null;
}

export const MAX_HISTORY = 6;
const MAX_HISTORY_TEXT = 600;

/** A screen's history, checked strictly: at most six exchanges of plain strings, each at most 600 characters. Null when it is not that. */
export function parseHistory(raw: unknown): HistoryItem[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_HISTORY) return null;
  const out: HistoryItem[] = [];
  for (const h of raw) {
    if (typeof h !== 'object' || h === null || Array.isArray(h)) return null;
    const o = h as Record<string, unknown>;
    if (typeof o.question !== 'string' || o.question.length > MAX_HISTORY_TEXT) return null;
    for (const k of ['route', 'card', 'understoodAs'] as const) {
      if (o[k] !== undefined && o[k] !== null && (typeof o[k] !== 'string' || (o[k] as string).length > MAX_HISTORY_TEXT)) return null;
    }
    const item: HistoryItem = { question: o.question };
    if (typeof o.route === 'string') item.route = o.route;
    if (typeof o.card === 'string') item.card = o.card;
    if (typeof o.understoodAs === 'string') item.understoodAs = o.understoodAs;
    out.push(item);
  }
  return out;
}

// ---------- the thread, per crewmate ----------

export interface Thread {
  at: number;
  turn: number;
  previous: Previous | null;
  pending: Pending | null;
  /** Astra's last few replies in this thread (her own words and the hub's lines), newest last: no opener twice in a row, no near-copy. */
  said?: string[];
  /** When a crisis phrase was written in this thread: later ordinary messages carry the quiet help line. */
  crisisAt?: number | null;
}

/** Keeps a reply's words in the thread, for the next turn's variety checks. */
export function remember(thread: Thread, text: string): void {
  thread.said = [...(thread.said ?? []), text].slice(-4);
}

/** Idle this long, and a thread is forgotten. */
export const THREAD_IDLE_MS = 30 * 60_000;

/**
 * Each crewmate's thread, kept on the hub for 30 minutes of quiet. Keyed by
 * the person asking: nothing of one crewmate's thread is used for another's.
 */
export class Threads {
  private map = new Map<string, Thread>();

  get(person: string, now: number): Thread {
    const held = this.map.get(person);
    if (held && now - held.at <= THREAD_IDLE_MS && now >= held.at) return held;
    const fresh: Thread = { at: now, turn: 0, previous: null, pending: null };
    this.map.set(person, fresh);
    return fresh;
  }

  save(person: string, thread: Thread, now: number): void {
    thread.at = now;
    this.map.set(person, thread);
    for (const [k, v] of this.map) if (now - v.at > THREAD_IDLE_MS) this.map.delete(k);
  }

  clear(person: string): void {
    this.map.delete(person);
  }
}

// ---------- the hub's own sentences around her questions ----------

export const CONVERSATION_TEXTS = {
  again: { en: "I didn't catch that. {question}", pt: 'Não entendi. {question}' },
  noted: { en: 'Thank you. I have noted that.', pt: 'Obrigada. Anotei.' },
  notedCard: { en: "Thank you, noted. Here is the medical lead's steps card.", pt: 'Obrigada, anotado. Aqui está o cartão de passos da responsável médica.' },
  // Said once, in the intro before her questions ('followup.intro'); not repeated here.
  notedNoRule: { en: "Thank you, noted. Here is the medical lead's steps card.", pt: 'Obrigada, anotado. Aqui está o cartão de passos da responsável médica.' },
  betterYes: { en: 'Good to hear. I have noted that it got better.', pt: 'Que bom. Anotei que melhorou.' },
  betterNo: { en: 'Noted: it did not get better. By the medical lead\'s rule, the hub tells your Crew Medical Officer.', pt: 'Anotado: não melhorou. Pela regra da responsável médica, o hub avisa o oficial médico da tripulação.' },
  next: { en: '{question}', pt: '{question}' },
  // After a card's steps (any card but her no-card-fits one). Interface words, not hers: nothing is stored or raised.
  feeling: { en: 'Are you feeling better?', pt: 'Você está se sentindo melhor?' },
  feelingYes: { en: 'Good to hear.', pt: 'Que bom.' },
  offerHelp: { en: 'Do you want to call for help?', pt: 'Quer pedir ajuda?' },
  notNow: { en: "Okay. I'm here if that changes.", pt: 'Certo. Estou aqui se isso mudar.' },
  // A typed "yes" to the offer: the call itself is always confirmed on the screen.
  helpTap: { en: 'Tap Call for help to confirm.', pt: 'Toque em Pedir ajuda para confirmar.' },
  // Before a card that is not urgent: its questions come first, then the card.
  oneFirst: { en: 'One question first.', pt: 'Uma pergunta antes.' },
  fewFirst: { en: 'A few questions first.', pt: 'Primeiro, algumas perguntas.' },
} as const;

export function conversationText(key: keyof typeof CONVERSATION_TEXTS, lang: Lang, vars: Record<string, string> = {}): string {
  return CONVERSATION_TEXTS[key][lang].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

/** The hub's line for the model about the turn before: topic words only. */
export function earlierLine(previous: Previous | null): string[] {
  const names = (previous?.topic.signals ?? []).map((id) => TOPICS.find((t) => t.id === id)?.en).filter(Boolean);
  return names.length ? [`This question follows one about ${names.join(' and ')}.`] : [];
}

/** The previous exchange from a screen's history, when the hub has none (after a restart): its topic only, found by rule. */
export function previousFromHistory(history: readonly HistoryItem[], crew: readonly CrewName[], asker: string): Previous | null {
  const last = history[history.length - 1];
  if (!last) return null;
  const text = last.understoodAs ?? last.question;
  const topic = topicOf(text, crew, asker);
  // Only the topic is kept. The text itself is never sent anywhere.
  return topic.signals.length ? { question: standaloneQuestion('how', topic.signals[0], topic, asker, crew, 'en'), topic, complaint: false } : null;
}
