// After "vite build": removes from dist/ the copies a syncing Desktop makes of files while they are written
// ("index 2.html", "reyes-night 3.json") and anything that is not part of the site (a filming aid's page).
// Usage: node scripts/clean-dist.mjs
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!existsSync(dist)) process.exit(0);
let removed = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (/ \d+(\.[^./]+)*$/.test(name) || /^cue([ .]|$)/.test(name)) { rmSync(path, { recursive: true, force: true }); removed++; continue; }
    if (statSync(path).isDirectory()) walk(path);
  }
};
walk(dist);
console.log(`dist cleaned: ${removed} stray file${removed === 1 ? '' : 's'} removed`);
