// A stand-in for llvm-rc, used only by package-win.sh when cross-building the
// Windows window on a Mac without LLVM's resource compiler. It understands the one
// .rc file Tauri writes (an ICON line and the manifest block) and writes the .res
// the linker takes: the app icon and the Common-Controls v6 manifest, which the
// window needs to start. The version block is left out (it only labels the file).
//
// Called by embed-resource as: llvm-rc /fo <out> /C 65001 --no-preprocess -- <in.rc>

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('/?') || args.length === 0) {
  console.log('OVERVIEW: Resource Converter (Astrum stand-in)\n  /no-preprocess --no-preprocess');
  process.exit(0);
}
const out = args[args.indexOf('/fo') + 1];
const input = args[args.length - 1];
const rc = readFileSync(input, 'utf8');

const RT_ICON = 3, RT_GROUP_ICON = 14, RT_MANIFEST = 24;
const parts = [];
function resource(type, name, data, flags) {
  const head = Buffer.alloc(32);
  head.writeUInt32LE(data.length, 0);
  head.writeUInt32LE(32, 4);
  head.writeUInt16LE(0xffff, 8); head.writeUInt16LE(type, 10);
  head.writeUInt16LE(0xffff, 12); head.writeUInt16LE(name, 14);
  head.writeUInt32LE(0, 16); // data version
  head.writeUInt16LE(flags, 20);
  head.writeUInt16LE(type === 0 ? 0 : 0x0409, 22);
  parts.push(head, data, Buffer.alloc((4 - (data.length % 4)) % 4));
}
resource(0, 0, Buffer.alloc(0), 0); // every .res starts with an empty entry

const icon = /^\s*(\d+)\s+ICON\s+"([^"]+)"/m.exec(rc);
if (icon) {
  const ico = readFileSync(icon[2].replace(/\\\\/g, '\\'));
  const count = ico.readUInt16LE(4);
  const group = Buffer.alloc(6 + 14 * count);
  group.writeUInt16LE(0, 0); group.writeUInt16LE(1, 2); group.writeUInt16LE(count, 4);
  for (let i = 0; i < count; i++) {
    const e = 6 + 16 * i, size = ico.readUInt32LE(e + 8), offset = ico.readUInt32LE(e + 12);
    resource(RT_ICON, i + 1, ico.subarray(offset, offset + size), 0x1010);
    ico.copy(group, 6 + 14 * i, e, e + 12); // width .. bytes in resource
    group.writeUInt16LE(i + 1, 6 + 14 * i + 12);
  }
  resource(RT_GROUP_ICON, Number(icon[1]), group, 0x1030);
}

const manifest = /^\s*1\s+24\s*\{([\s\S]*?)^\s*\}/m.exec(rc);
if (manifest) {
  const text = [...manifest[1].matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"')).join('\n');
  resource(RT_MANIFEST, 1, Buffer.from(text, 'utf8'), 0x0030);
}
if (!manifest) { console.error('win-rc: no manifest block in ' + input); process.exit(1); }

writeFileSync(out, Buffer.concat(parts));
