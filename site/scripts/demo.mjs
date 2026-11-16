// Builds the hub's interface (../hub/ui) straight into public/demo/, so the
// site serves the real interface at ./demo/ and "Run the demo" plays the
// recorded story with no server. The copy is build output: git ignores it.
//
//   npm run demo          build the hub interface into public/demo/
//   npm run build:all     the above, then the site itself

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const hub = join(site, '..', 'hub');
const out = join(site, 'public', 'demo');

if (!existsSync(join(hub, 'node_modules'))) {
  console.error(`The hub has no node_modules. Run "npm install" in ${hub} first.`);
  process.exit(1);
}

// The hub's own build script ("vite build ui"), pointed at public/demo/.
const run = spawnSync('npm', ['run', 'build', '--', '--outDir', out, '--emptyOutDir'], { cwd: hub, stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status ?? 1);

// Leave out what the demo never loads: the 3D models the hub's preview pages export (astra.glb,
// astrum-chip*.glb), the developer workbench (bench.html and the files only it uses), any scenario file
// the list does not name (a draft recording), and the copies iCloud makes ("index 2.html").
const remove = (file) => rmSync(join(out, file), { force: true, recursive: true });
const bench = existsSync(join(out, 'bench.html')) ? readFileSync(join(out, 'bench.html'), 'utf8') : '';
const keep = readFileSync(join(out, 'index.html'), 'utf8');
for (const [, asset] of bench.matchAll(/assets\/([^"'?#]+)/g)) {
  const usedElsewhere = keep.includes(asset) || readdirSync(join(out, 'assets'))
    .some((other) => !bench.includes(other) && readFileSync(join(out, 'assets', other), 'utf8').includes(asset));
  if (!usedElsewhere) remove(join('assets', asset));
}
remove('bench.html');
// A filming aid (cue.html) may be in the hub's build on the owner's Mac: it never belongs in the public demo.
if (existsSync(join(out, 'cue.html'))) {
  const cue = readFileSync(join(out, 'cue.html'), 'utf8');
  for (const [, asset] of cue.matchAll(/assets\/([^"'?#]+)/g)) {
    const usedElsewhere = keep.includes(asset) || readdirSync(join(out, 'assets')).some((other) => other !== asset && !cue.includes(other) && readFileSync(join(out, 'assets', other), 'utf8').includes(asset));
    if (!usedElsewhere) remove(join('assets', asset));
  }
  remove('cue.html');
}
for (const file of readdirSync(out)) if (file.endsWith('.glb')) remove(file);
for (const file of readdirSync(out, { recursive: true })) if (/ \d+(\.[^./]+)?$/.test(String(file))) remove(String(file));

// Every scenario the list names (vite copies hub/ui/public whole), with its recorded Astra answers and its
// phone recording (meta.phone, <id>.phone.mp4) if it has them.
const listFile = join(out, 'scenario', 'index.json');
const list = existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')) : [];
if (!Array.isArray(list) || !list.length) {
  console.error('public/demo/scenario/index.json is missing or lists no scenario.');
  process.exit(1);
}
const listed = new Set(list.flatMap(({ file }) => [file, file.replace(/\.json$/, '.astra.json'), file.replace(/\.json$/, '.phone.mp4')]));
listed.add('index.json');
for (const file of readdirSync(join(out, 'scenario'))) if (!listed.has(file)) remove(join('scenario', file));
for (const file of ['index.html', ...list.map(({ file }) => join('scenario', file))]) {
  if (!existsSync(join(out, file))) {
    console.error(`public/demo/${file} is missing after the build.`);
    process.exit(1);
  }
}
console.log(`Demo ready: public/demo/index.html?replay=random (${list.length} scenarios: ${list.map(({ file }) => file).join(', ')})`);
