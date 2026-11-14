// Frame-by-frame capture of the steps demo through the DevTools Protocol.
//
//   node capture.mjs --url <page with ?capture=1> --out <dir> [--w 1920 --h 1080 --dpr 2]
//                    [--from 0 --to 10 --fps 60]   every frame in [from, to)
//                    [--at 1.5,3,4.2]               or just these moments
//                    [--reduce]                     emulate prefers-reduced-motion
//
// Each frame is drawn by the page itself at an exact time (window.__steps.at),
// then screenshot, so the result does not depend on how fast the machine is.
// Uses the headless Chrome named in ~/Desktop/NASA/side/chrome-path.txt, on the GPU.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const W = Number(args.w ?? 1920), H = Number(args.h ?? 1080), DPR = Number(args.dpr ?? 2);
const out = args.out;
mkdirSync(out, { recursive: true });
const chrome = readFileSync(join(homedir(), 'Desktop/NASA/side/chrome-path.txt'), 'utf8').split('\n')[0].trim();
const port = 9400 + Math.floor(Math.random() * 400);
const proc = spawn(chrome, [
  '--headless', `--remote-debugging-port=${port}`, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
  '--hide-scrollbars', '--mute-audio', `--window-size=${W},${H}`, `--user-data-dir=${join(out, '.profile')}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 100 && !target; i++) {
  await sleep(100);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  } catch { /* not up yet */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled') console.log('[page]', ...msg.params.args.map((a) => a.value ?? a.description));
  if (msg.method === 'Runtime.exceptionThrown') console.log('[page error]', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: W < 600 });
if (args.reduce) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
const url = new URL(args.url);
url.searchParams.set('dpr', String(DPR));
await send('Page.navigate', { url: url.toString() });
for (let i = 0; i < 300; i++) {
  await sleep(100);
  const r = await send('Runtime.evaluate', { expression: 'Boolean(window.__steps && window.__steps.ready)', returnByValue: true });
  if (r.result.value) break;
}

let times;
if (args.at) times = String(args.at).split(',').map(Number);
else {
  const fps = Number(args.fps ?? 60);
  const from = Number(args.from ?? 0);
  let to = args.to;
  if (to === undefined || to === 'end') {
    const r = await send('Runtime.evaluate', { expression: 'window.__steps.length()', returnByValue: true });
    to = r.result.value;
  }
  const n = Math.round((Number(to) - from) * fps);
  times = Array.from({ length: n }, (_, i) => from + i / fps);
}
const started = Date.now();
for (let i = 0; i < times.length; i++) {
  const t = times[i];
  if (args.permiss) await send('Runtime.evaluate', { expression: 'window.__steps.resetMisses && window.__steps.resetMisses()' });
  await send('Runtime.evaluate', { expression: `window.__steps.at(${t})`, awaitPromise: true });
  if (args.permiss) {
    const m = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__steps.misses())', returnByValue: true });
    if (JSON.parse(m.result.value).worst > 0) console.log('miss at', t.toFixed(3), m.result.value);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const name = args.at ? `t${t.toFixed(3)}.png` : `f${String(i).padStart(5, '0')}.png`;
  writeFileSync(join(out, name), Buffer.from(shot.data, 'base64'));
  if (i % 120 === 0) console.log(`${i + 1}/${times.length} t=${t.toFixed(3)} ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
const miss = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__steps.misses())', returnByValue: true });
console.log('contact misses', miss.result.value);
const info = await send('Runtime.evaluate', { expression: 'JSON.stringify({ moves: window.__steps.moves && window.__steps.moves(), broken: window.__steps.broken && window.__steps.broken() })', returnByValue: true });
console.log('library', info.result.value);
ws.close();
proc.kill();
console.log('done', times.length, 'frames');
