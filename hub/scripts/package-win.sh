#!/usr/bin/env bash
# Packages the hub for Windows x64, cross-built on this Mac: dist-win/Astrum/ (a portable
# folder: Astrum.exe with everything it needs beside it) and a zip of it. No installer.
#
#   hub/scripts/package-win.sh              the folder with the model inside (about 2 GB)
#   hub/scripts/package-win.sh --no-model   without it: the hub then looks for
#                                           %APPDATA%\Astrum\models\LFM3-1.7B-Q8_0.gguf
#                                           and says on screen when it is missing
#
# What it does:
#   1. stages the hub's code, the npm packages it needs at run time (Windows x64 prebuilds only)
#      and a fresh UI build (built into the stage, never into hub/ui/dist);
#   2. downloads the official Windows x64 Node (this Mac's version) and llama.cpp CPU build
#      (this Mac's build number, else the latest), checked and cached in ~/Library/Caches;
#   3. cross-builds the window (src-tauri) with cargo-xwin as Astrum.exe;
#   4. checks every DLL the programs load is either beside them or part of Windows, and that
#      no Mac binary is left, then writes THIRD-PARTY.txt and the zip.
#
# The folder, as src-tauri/src/lib.rs looks for it on Windows (beside Astrum.exe):
#   hub/ (core/run.ts ...), runtime/bin/ (node.exe, llama-server.exe, DLLs), model/ (optional).
# Settings: %APPDATA%\Astrum\launch.env (KEY=VALUE lines, as on the Mac). Log:
# %LOCALAPPDATA%\Astrum\Logs\hub.log. Production mode by default. No key or secret is bundled.
#
# llama.cpp's DLLs need the Microsoft Visual C++ Redistributable (x64), which this folder does
# not carry: without it the window and hub work, and the AI says it is off.
#
# Needs: cargo with the x86_64-pc-windows-msvc target, cargo-xwin (cargo install cargo-xwin;
# it downloads Microsoft's CRT and SDK and accepts their licence), clang-cl and lld-link on PATH
# (any LLVM; swiftly's is picked up), rsvg-convert, curl, zip, the hub's node_modules.

set -euo pipefail

WITH_MODEL=1
for arg in "$@"; do
  case "$arg" in
    --no-model) WITH_MODEL=0 ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

HUB="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$HUB/.." && pwd)"
OUT="$REPO/dist-win"
VERSION="1.0.0"
# Assembled outside the repo: ~/Desktop syncs with iCloud, which gets in the way of half-written folders.
WORK="$(mktemp -d -t astrum-package-win)"
trap 'rm -rf "$WORK"' EXIT
CACHE="$HOME/Library/Caches/astrum-package-win"
STAGE="$WORK/stage"
APP="$WORK/Astrum"
SUFFIX="$([ "$WITH_MODEL" = 0 ] && echo -no-model || true)"
ZIP_NAME="Astrum-$VERSION-win-x64$SUFFIX.zip"
MODEL_NAME="LFM3-1.7B-Q8_0.gguf"
MODEL_SRC="${ASTRUM_MODEL:-$HOME/Desktop/NASA/astrum-model-test/gguf/$MODEL_NAME}"
TARGET="x86_64-pc-windows-msvc"
[ -d "$HOME/.swiftly/bin" ] && PATH="$PATH:$HOME/.swiftly/bin"

step() { printf '\n== %s\n' "$*"; }
fail() { echo "error: $*" >&2; exit 1; }

command -v cargo >/dev/null || fail "cargo is missing (rustup.rs)"
command -v cargo-xwin >/dev/null || fail "cargo-xwin is missing (cargo install cargo-xwin)"
rustup target list --installed | grep -qx "$TARGET" || fail "run: rustup target add $TARGET"
command -v clang-cl >/dev/null && command -v lld-link >/dev/null || fail "clang-cl and lld-link are missing (any LLVM toolchain)"
command -v rsvg-convert >/dev/null || fail "rsvg-convert is missing (brew install librsvg)"
command -v llvm-objdump >/dev/null || fail "llvm-objdump is missing (any LLVM toolchain)"
[ -d "$HUB/node_modules" ] || fail "run npm install in hub/ first"
[ "$WITH_MODEL" = 0 ] || [ -f "$MODEL_SRC" ] || fail "the model is not at $MODEL_SRC (set ASTRUM_MODEL, or use --no-model)"

mkdir -p "$CACHE" "$STAGE/hub" "$APP/runtime/bin" "$STAGE/icons"

# ---------------------------------------------------------------------------
step "1/4 The hub's code, its run-time npm packages and the UI"
rsync -a --exclude '*.test.ts' --exclude 'README.md' \
  "$HUB/core" "$HUB/engine" "$HUB/medical" "$HUB/profiles" "$HUB/data-nasa" \
  "$HUB/package.json" "$HUB/package-lock.json" "$STAGE/hub/"
mkdir -p "$STAGE/hub/ui/public"
rsync -a "$HUB/ui/public/scenario" "$STAGE/hub/ui/public/"
(cd "$HUB" && npm ls --omit=dev --all --parseable 2>/dev/null | tail -n +2) | while read -r dir; do
  rel="${dir#"$HUB"/}"
  case "$rel" in */fsevents) continue ;; esac # macOS only (an optional dependency of nodemon's watcher)
  mkdir -p "$STAGE/hub/$(dirname "$rel")"
  rsync -a --exclude node_modules "$dir/" "$STAGE/hub/$rel/"
done
# Native modules: keep only the Windows x64 prebuild, and no build made on this Mac.
find "$STAGE/hub/node_modules" -type d -name prebuilds | while read -r pre; do
  find "$pre" -mindepth 1 -maxdepth 1 -type d ! -name win32-x64 -exec rm -rf {} +
done
find "$STAGE/hub/node_modules" -type d -path '*/build/Release' -prune -exec rm -rf {} +
[ -n "$(find "$STAGE/hub/node_modules" -path '*win32-x64*' -name '*.node')" ] || fail "no win32-x64 prebuild for the serial port module"
(cd "$HUB" && npx vite build ui --outDir "$STAGE/hub/ui/dist" --emptyOutDir --logLevel warn)
[ -f "$STAGE/hub/ui/dist/index.html" ] || fail "the UI build produced no index.html"

# ---------------------------------------------------------------------------
step "2/4 Node and llama-server for Windows x64"
NODE_VERSION="$(node --version)"
NODE_ZIP="node-$NODE_VERSION-win-x64.zip"
if [ ! -f "$CACHE/$NODE_ZIP" ]; then
  curl -fsSL -o "$CACHE/$NODE_ZIP.part" "https://nodejs.org/dist/$NODE_VERSION/$NODE_ZIP"
  mv "$CACHE/$NODE_ZIP.part" "$CACHE/$NODE_ZIP"
fi
want="$(curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" | awk -v f="$NODE_ZIP" '$2==f{print $1}')"
[ "$(shasum -a 256 "$CACHE/$NODE_ZIP" | cut -d' ' -f1)" = "$want" ] || { rm -f "$CACHE/$NODE_ZIP"; fail "$NODE_ZIP does not match nodejs.org's checksum"; }
mkdir -p "$WORK/node" && unzip -q "$CACHE/$NODE_ZIP" -d "$WORK/node"
cp "$WORK/node/node-$NODE_VERSION-win-x64/node.exe" "$APP/runtime/bin/"
cp "$WORK/node/node-$NODE_VERSION-win-x64/LICENSE" "$WORK/node-LICENSE"

LLAMA_BUILD="$(llama-server --version 2>&1 | sed -n 's/.*(build \([0-9]*\).*/\1/p' | head -1 || true)"
LLAMA_TAG="b${LLAMA_BUILD:-0}"
llama_zip() { echo "llama-$1-bin-win-cpu-x64.zip"; }
if [ -z "$LLAMA_BUILD" ] || ! curl -fsIL -o /dev/null "https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_TAG/$(llama_zip "$LLAMA_TAG")"; then
  LLAMA_TAG="$(curl -fsSL https://api.github.com/repos/ggml-org/llama.cpp/releases/latest | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
  [ -n "$LLAMA_TAG" ] || fail "cannot find the latest llama.cpp release"
  echo "llama.cpp build $LLAMA_BUILD has no Windows CPU release; using $LLAMA_TAG"
fi
LLAMA_ZIP="$(llama_zip "$LLAMA_TAG")"
if [ ! -f "$CACHE/$LLAMA_ZIP" ]; then
  curl -fsSL -o "$CACHE/$LLAMA_ZIP.part" "https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_TAG/$LLAMA_ZIP"
  mv "$CACHE/$LLAMA_ZIP.part" "$CACHE/$LLAMA_ZIP"
fi
mkdir -p "$WORK/llama" && unzip -q "$CACHE/$LLAMA_ZIP" -d "$WORK/llama"
cp "$WORK/llama/llama-server.exe" "$APP/runtime/bin/"
# Every DLL but the other tools' own (the CPU backends are loaded at run time, so all stay).
for f in "$WORK"/llama/*.dll; do
  case "$(basename "$f")" in *-impl.dll) [ "$(basename "$f")" = llama-server-impl.dll ] || continue ;; esac
  cp "$f" "$APP/runtime/bin/"
done
echo "Node $NODE_VERSION, llama.cpp $LLAMA_TAG, $(ls "$APP/runtime/bin" | wc -l | tr -d ' ') files in runtime/bin"

# ---------------------------------------------------------------------------
step "3/4 The window (src-tauri), cross-built for $TARGET"
node -e '
  const fs = require("fs");
  const svg = fs.readFileSync(process.argv[1], "utf8");
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  fs.writeFileSync(process.argv[2], `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="100" y="100" width="824" height="824" rx="185" fill="#000"/><g transform="translate(204 274) scale(7)">${inner}</g></svg>`);
' "$HUB/ui/public/brand/mark.svg" "$STAGE/icons/icon.svg"
rsvg-convert -w 1024 -h 1024 "$STAGE/icons/icon.svg" -o "$STAGE/icons/icon.png"
(cd "$HUB" && npx tauri icon "$STAGE/icons/icon.png" -o "$STAGE/icons/out" >/dev/null 2>&1)
# Tauri's build compiles a small resource file (the icon, and the manifest the window needs) with
# llvm-rc. Without one on this Mac, scripts/win-rc.mjs stands in for it.
if ! command -v llvm-rc >/dev/null; then
  mkdir -p "$WORK/rcbin"
  printf '#!/bin/sh\nexec node "%s" "$@"\n' "$HUB/scripts/win-rc.mjs" > "$WORK/rcbin/llvm-rc"
  chmod +x "$WORK/rcbin/llvm-rc"
  PATH="$WORK/rcbin:$PATH"
fi
CONFIG=$(printf '{"version":"%s","build":{"beforeBuildCommand":"","frontendDist":"shell"},"bundle":{"active":false,"icon":["%s"]}}' "$VERSION" "$STAGE/icons/out/icon.ico")
# Built outside src-tauri/target, so the Mac build there is never touched.
export CARGO_TARGET_DIR="$CACHE/target" XWIN_ACCEPT_LICENSE=1
(cd "$HUB" && npx tauri build --runner cargo-xwin --target "$TARGET" --no-bundle --config "$CONFIG")
BUILT="$CARGO_TARGET_DIR/$TARGET/release/astrum-hub.exe"
[ -f "$BUILT" ] || fail "the build produced no astrum-hub.exe"
cp "$BUILT" "$APP/Astrum.exe"
ditto "$STAGE/hub" "$APP/hub"
if [ "$WITH_MODEL" = 1 ]; then
  mkdir -p "$APP/model"
  cp -c "$MODEL_SRC" "$APP/model/$MODEL_NAME" 2>/dev/null || cp "$MODEL_SRC" "$APP/model/$MODEL_NAME"
fi

# ---------------------------------------------------------------------------
step "4/4 Checks, THIRD-PARTY.txt and the zip"
file -b "$APP/Astrum.exe" | grep -q 'PE32+ executable (GUI) x86-64' || fail "Astrum.exe is not a Windows x64 program"
# Windows' own DLLs (and the Universal CRT that ships with Windows 10 and 11).
is_system() {
  case "$(echo "$1" | tr 'A-Z' 'a-z')" in
    api-ms-win-*|ext-ms-win-*|kernel32.dll|kernelbase.dll|ntdll.dll|user32.dll|gdi32.dll|shell32.dll|ole32.dll|oleaut32.dll|combase.dll|advapi32.dll|ws2_32.dll|crypt32.dll|psapi.dll|dwmapi.dll|shlwapi.dll|comctl32.dll|imm32.dll|bcrypt.dll|bcryptprimitives.dll|winmm.dll|dbghelp.dll|iphlpapi.dll|userenv.dll|uxtheme.dll|version.dll|setupapi.dll|cfgmgr32.dll|secur32.dll|ncrypt.dll|powrprof.dll|wtsapi32.dll|comdlg32.dll|winspool.drv|dnsapi.dll|netapi32.dll|uiautomationcore.dll|propsys.dll|msimg32.dll|usp10.dll|rpcrt4.dll|ucrtbase.dll|wininet.dll|winhttp.dll|mpr.dll|wldap32.dll|normaliz.dll|hid.dll|d3d11.dll|dxgi.dll) return 0 ;;
    *) return 1 ;;
  esac
}
VC_NEEDED=""
check_imports() { # a program or DLL -> fails on any DLL that is neither beside it nor part of Windows
  local f="$1" dir dll; dir="$(dirname "$f")"
  for dll in $(llvm-objdump -p "$f" | awk '/DLL Name:/{print $3}'); do
    is_system "$dll" && continue
    [ -n "$(find "$dir" -maxdepth 1 -iname "$dll" | head -1)" ] && continue
    case "$(echo "$dll" | tr 'A-Z' 'a-z')" in
      msvcp140*.dll|vcruntime140*.dll|concrt140.dll) VC_NEEDED="$VC_NEEDED $dll"; continue ;;
      node.exe) continue ;; # Node's native modules link against the node.exe that loads them
    esac
    fail "$(basename "$f") loads $dll, which is not in the folder"
  done
}
check_imports "$APP/Astrum.exe"
for f in "$APP"/runtime/bin/*.exe "$APP"/runtime/bin/*.dll; do check_imports "$f"; done
while IFS= read -r -d '' f; do check_imports "$f"; done < <(find "$APP/hub/node_modules" -name '*.node' -print0)
VC_NEEDED="$(echo "$VC_NEEDED" | tr ' ' '\n' | sort -fu | tr '\n' ' ')"
macho="$(find "$APP" -type f \( -name '*.node' -o -name '*.dylib' -o -name '*.so' \) -exec file {} + | grep -i 'Mach-O' || true)"
[ -z "$macho" ] || fail "Mac binaries left in the folder: $macho"
for p in hub/core/run.ts hub/ui/dist/index.html runtime/bin/node.exe runtime/bin/llama-server.exe; do
  [ -f "$APP/$p" ] || fail "$p is missing from the folder"
done
echo "imports ok; from the Visual C++ Redistributable:${VC_NEEDED:- none}"

licence_of() { # a folder -> the licence named in its LICENSE/COPYING file
  local f; f="$(ls "$1"/LICEN[CS]E* "$1"/COPYING* 2>/dev/null | head -1 || true)"
  [ -n "$f" ] || { echo "no licence file found in $1"; return; }
  local name
  name="$(grep -m1 -oE 'MIT License|MIT|Apache License|BSD [0-9]-Clause|BSD|ISC License' "$f" || true)"
  echo "${name:-see file} ($(basename "$f"))"
}
{
  echo "Astrum $VERSION for Windows x64: third-party software in this folder"
  echo "Generated by hub/scripts/package-win.sh on $(date +%Y-%m-%d)."
  echo
  echo "Runtime (runtime/bin)"
  echo "  Node.js $NODE_VERSION (official win-x64 build, nodejs.org): $(licence_of "$WORK/node/node-$NODE_VERSION-win-x64")"
  echo "  llama.cpp / llama-server $LLAMA_TAG and ggml (official Windows CPU x64 release, github.com/ggml-org/llama.cpp): MIT"
  echo "  libomp.dll (LLVM OpenMP, shipped with that release): Apache License 2.0 with LLVM Exceptions"
  echo "  Needs the Microsoft Visual C++ Redistributable (x64), installed separately:$VC_NEEDED"
  echo
  echo "The window (Astrum.exe): Tauri 2 and its Rust crates (MIT or Apache-2.0), statically linked;"
  echo "  the Microsoft C runtime and Windows SDK import libraries fetched by cargo-xwin."
  echo
  echo "The model (model/, or %APPDATA%\\Astrum\\models with --no-model)"
  echo "  $MODEL_NAME (LFM3 1.7B, Q8_0 GGUF): NO LICENCE FILE was found beside it on the build Mac."
  echo "  Its licence must be checked at the model's source before this folder is distributed."
  echo
  echo "npm packages (hub/node_modules)"
  node -e '
    const fs = require("fs"), path = require("path");
    const root = process.argv[1], out = [];
    const walk = (dir) => { for (const e of fs.readdirSync(dir)) {
      if (e.startsWith(".")) continue;
      const p = path.join(dir, e);
      if (e.startsWith("@")) { walk(p); continue; }
      const pkg = path.join(p, "package.json");
      if (fs.existsSync(pkg)) { const j = JSON.parse(fs.readFileSync(pkg, "utf8")); out.push(`  ${j.name} ${j.version}: ${j.license ?? ((j.licenses ?? []).map((l) => l.type).join(", ") || "no licence field")}`); }
      if (fs.existsSync(path.join(p, "node_modules"))) walk(path.join(p, "node_modules"));
    } };
    walk(root);
    console.log([...new Set(out)].sort().join("\n"));
  ' "$APP/hub/node_modules"
} > "$APP/THIRD-PARTY.txt"
cp "$WORK/node-LICENSE" "$APP/runtime/bin/node-LICENSE.txt"
[ -f "$WORK/llama/LICENSE-LLVM-OpenMP" ] && cp "$WORK/llama/LICENSE-LLVM-OpenMP" "$APP/runtime/bin/"

(cd "$WORK" && zip -qr -X "$ZIP_NAME" Astrum)
# Copied to the repo only once complete.
mkdir -p "$OUT"
rm -rf "$OUT/Astrum" "$OUT"/Astrum-*-win-x64*.zip
ditto "$APP" "$OUT/Astrum"
cp "$WORK/$ZIP_NAME" "$OUT/"
step "Done"
echo "$OUT/Astrum  $(du -sh "$OUT/Astrum" | cut -f1)$([ "$WITH_MODEL" = 0 ] && echo ', without the model' || true)"
echo "$OUT/$ZIP_NAME  $(du -sh "$OUT/$ZIP_NAME" | cut -f1)"
[ -z "$VC_NEEDED" ] || echo "On Windows, install the Microsoft Visual C++ Redistributable (x64) first (llama-server needs$VC_NEEDED)."
