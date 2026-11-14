// Names for a simulated crew: given names of real astronauts and cosmonauts,
// from many agencies and countries (NASA, Roscosmos, ESA, JAXA, CSA, CNSA, ISRO,
// the UAE, Brazil and others). Only first names, never a surname or anything
// that goes with one: the screens attach invented health events to these
// people, and that must never land on a real, identifiable person. For the
// same reason the list leaves out mononyms, nicknames and given names so rare
// that the first name alone would point at one living person.
//
// Pure data and functions, no runtime imports, so this file loads anywhere.

export const ASTRONAUT_FIRST_NAMES: readonly string[] = [
  // Brazil and Portuguese-speaking names.
  'Marcos', 'Pedro', 'José', 'Fernando', 'Carlos',
  // NASA and the United States.
  'Sally', 'Mae', 'Peggy', 'Christina', 'Jessica', 'Kathleen', 'Anne', 'Nicole', 'Kayla', 'Jasmin',
  'Serena', 'Megan', 'Karen', 'Tracy', 'Ellen', 'Eileen', 'Mary', 'Joan', 'Shannon', 'Victor',
  'Raja', 'Michael', 'Scott', 'Mark', 'Robert', 'Warren', 'Frank', 'Franklin', 'Neil', 'Sidney',
  'Kate', 'Reid', 'Sunita', 'Kalpana',
  // Russia and the former Soviet Union.
  'Yuri', 'Valentina', 'Alexei', 'Sergei', 'Elena', 'Anna', 'Oleg', 'Gennady', 'Anton', 'Mikhail',
  'Dmitri', 'Svetlana', 'Pyotr', 'Andrei', 'Nikolai', 'Ivan', 'Talgat', 'Marina', 'Leonid',
  // Europe.
  'Samantha', 'Luca', 'Thomas', 'Alexander', 'Matthias', 'Tim', 'André', 'Andreas', 'Christer', 'Marcus',
  'Sophie', 'Rosemary', 'Pablo', 'Sara', 'Paolo', 'Umberto', 'Dirk', 'Franz', 'Bertalan',
  'Tibor', 'Vladimír', 'Dumitru', 'Georgi', 'Mirosław', 'Raphaël', 'John',
  // Japan.
  'Koichi', 'Satoshi', 'Akihiko', 'Kimiya', 'Norishige', 'Soichi', 'Takuya', 'Naoko', 'Chiaki', 'Mamoru', 'Makoto',
  // China.
  'Liwei', 'Yaping', 'Haipeng', 'Zhigang', 'Haisheng',
  // Canada.
  'Chris', 'Julie', 'Roberta', 'Marc', 'David', 'Jenni', 'Jeremy', 'Joshua',
  // India, the Gulf, the Americas, Asia and Africa.
  'Rakesh', 'Sultan', 'Ali', 'Mohammed', 'Rodolfo', 'Katya', 'Arnaldo', 'Abdul', 'Soyeon', 'Ilan', 'Eytan', 'Alper',
];

/** A repeatable stream of numbers from 0 to 1 for a seed (mulberry32). */
function stream(seed: number | string): () => number {
  let s = 0;
  if (typeof seed === 'number') s = Math.floor(seed) >>> 0;
  else for (let i = 0; i < seed.length; i++) s = (Math.imul(s, 31) + seed.charCodeAt(i)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fold = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * `count` different first names from the list, none of them in `taken`
 * (compared without case or accents). The same seed always gives the same
 * names. Fewer come back only when the list runs out.
 */
export function pickNames(count: number, seed: number | string, taken: readonly string[] = []): string[] {
  const used = new Set(taken.map(fold));
  const pool = ASTRONAUT_FIRST_NAMES.filter((n) => !used.has(fold(n)));
  const next = stream(seed);
  const out: string[] = [];
  for (let i = 0; i < count && i < pool.length; i++) {
    const j = i + Math.floor(next() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    out.push(pool[i]);
  }
  return out;
}
