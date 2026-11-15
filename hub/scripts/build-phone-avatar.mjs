// Builds the crew avatar for the iPhone app as one self-contained HTML file
// (three.js inlined, nothing fetched) and copies it into the app bundle's
// resources. Leaves ui/dist alone. Run from hub/: node scripts/build-phone-avatar.mjs
import { build } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ui = fileURLToPath(new URL('../ui/', import.meta.url));
const outDir = process.env.PHONE_AVATAR_OUT ?? join(tmpdir(), 'astrum-phone-avatar');
const target = fileURLToPath(new URL('../../phone/Astrum/Resources/avatar.html', import.meta.url));

await build({
  configFile: false,
  root: ui,
  base: './',
  publicDir: false,
  cacheDir: join(outDir, '.vite'),
  logLevel: 'warn',
  build: {
    outDir: join(outDir, 'dist'),
    emptyOutDir: true,
    modulePreload: false,
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: { input: join(ui, 'phone-avatar.html') },
  },
});

const dist = join(outDir, 'dist');
let html = readFileSync(join(dist, 'phone-avatar.html'), 'utf8');
const assets = join(dist, 'assets');
html = html.replace(/<script type="module" crossorigin src="\.\/assets\/([^"]+)"><\/script>/, (_, file) =>
  `<script type="module">${readFileSync(join(assets, file), 'utf8').replaceAll('</script', '<\\/script')}</script>`);
if (/src="\.\/assets\//.test(html) || readdirSync(assets).some(file => !file.endsWith('.js'))) throw new Error('Something was not inlined');
const single = join(outDir, 'avatar.html');
writeFileSync(single, html);
mkdirSync(join(target, '..'), { recursive: true });
writeFileSync(target, html);
console.log(`${single} -> ${target} (${Math.round(html.length / 1024)} KB)`);
