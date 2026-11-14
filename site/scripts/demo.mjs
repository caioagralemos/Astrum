// Builds the hub's interface (../hub/ui) straight into public/demo/, so the
// site serves the real interface at ./demo/ and "Run the demo" plays the
// recorded story with no server. The copy is build output: git ignores it.
//
//   npm run demo          build the hub interface into public/demo/
//   npm run build:all     the above, then the site itself

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

for (const file of ['index.html', join('scenario', 'reyes-night.json')]) {
  if (!existsSync(join(out, file))) {
    console.error(`public/demo/${file} is missing after the build.`);
    process.exit(1);
  }
}
console.log('Demo ready: public/demo/index.html?replay=scenario/reyes-night.json');
