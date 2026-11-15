// Each crewmate's face: the portrait they were given (the setup's own photo or a
// chosen picture), else a default from the hub's six crew pictures (ui/public/crew,
// AI-made pictures of nobody), paired by pronoun or, for the names the hub picks
// (engine/names.ts), by name. The hub puts it on every crewmate in its state, so
// the hub's screens and the phone show the same face for the same person.
// Pure, no imports.

/**
 * Placeholder portraits for a simulated crew (public/crew, each marked "AI"): three of women, three of men.
 * A crewmate gets one from the set that goes with their pronouns or, for the names the hub picks
 * (engine/names.ts), with the name; anyone else keeps the line figure. Handed out in crew order.
 */
const PORTRAITS = { she: ['crew/crew-2.jpg', 'crew/crew-1.jpg', 'crew/crew-3.jpg'], he: ['crew/crew-4.jpg', 'crew/crew-5.jpg', 'crew/crew-6.jpg'] };
const NAMES_SHE = new Set(['Sally', 'Mae', 'Peggy', 'Christina', 'Jessica', 'Kathleen', 'Anne', 'Nicole', 'Kayla', 'Jasmin', 'Serena', 'Megan', 'Karen',
  'Tracy', 'Ellen', 'Eileen', 'Mary', 'Joan', 'Shannon', 'Kate', 'Sunita', 'Kalpana', 'Valentina', 'Elena', 'Anna', 'Svetlana', 'Marina', 'Samantha',
  'Sophie', 'Rosemary', 'Sara', 'Naoko', 'Chiaki', 'Yaping', 'Julie', 'Roberta', 'Jenni', 'Katya', 'Soyeon', 'Reyes', 'Okafor']);
const NAMES_HE = new Set(['Marcos', 'Pedro', 'José', 'Fernando', 'Carlos', 'Victor', 'Raja', 'Michael', 'Scott', 'Mark', 'Robert', 'Warren', 'Frank',
  'Franklin', 'Neil', 'Sidney', 'Reid', 'Yuri', 'Alexei', 'Sergei', 'Oleg', 'Gennady', 'Anton', 'Mikhail', 'Dmitri', 'Pyotr', 'Andrei', 'Nikolai', 'Ivan',
  'Talgat', 'Leonid', 'Luca', 'Thomas', 'Alexander', 'Matthias', 'Tim', 'André', 'Andreas', 'Christer', 'Marcus', 'Pablo', 'Paolo', 'Umberto', 'Dirk',
  'Franz', 'Bertalan', 'Tibor', 'Vladimír', 'Dumitru', 'Georgi', 'Mirosław', 'Raphaël', 'John', 'Koichi', 'Satoshi', 'Akihiko', 'Kimiya', 'Norishige',
  'Soichi', 'Takuya', 'Mamoru', 'Makoto', 'Liwei', 'Haipeng', 'Zhigang', 'Haisheng', 'Chris', 'Marc', 'David', 'Jeremy', 'Joshua', 'Rakesh', 'Sultan',
  'Ali', 'Mohammed', 'Rodolfo', 'Arnaldo', 'Abdul', 'Ilan', 'Eytan', 'Alper', 'Leo', 'Tanaka',
  // Once in the list, and still saved on missions started then.
  'Claude']);
export function demoPortraits(people: { id: string; name: string; pronouns?: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = { she: 0, he: 0 };
  for (const p of people) {
    const set = p.pronouns === 'she' ? 'she' : p.pronouns === 'he' ? 'he' : NAMES_SHE.has(p.name) ? 'she' : NAMES_HE.has(p.name) ? 'he' : null;
    if (set) out[p.id] = PORTRAITS[set][used[set]++ % PORTRAITS[set].length];
  }
  return out;
}

/** The crew with a portrait on everyone: their own when they have one, else the default pairing; anyone the pairing leaves out takes the next picture in turn. */
export function withPortraits<P extends { id: string; name: string; pronouns?: string; portrait?: string }>(people: P[]): P[] {
  const faces = demoPortraits(people);
  const all = [...PORTRAITS.she, ...PORTRAITS.he];
  let next = 0;
  return people.map((p) => (p.portrait ? p : { ...p, portrait: faces[p.id] ?? all[next++ % all.length] }));
}
