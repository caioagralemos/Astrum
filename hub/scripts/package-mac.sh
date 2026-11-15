#!/usr/bin/env bash
# Packages the hub as one Mac app: dist-mac/Astrum.app (Apple silicon).
#
#   hub/scripts/package-mac.sh              the app with the model inside (about 2 GB)
#   hub/scripts/package-mac.sh --no-model   the app without it: the hub then looks for
#                                           ~/Library/Application Support/Astrum/models/LFM3-1.7B-Q8_0.gguf
#                                           and says on screen when it is missing
#
# What it does:
#   1. stages the hub's code, the npm packages it needs at run time, and a fresh UI build
#      (built into the stage, never into hub/ui/dist);
#   2. copies this Mac's Node and llama-server with every Homebrew library they load,
#      rewired to load from inside the app;
#   3. builds the window (src-tauri) and puts 1 and 2 (and the model) in its Resources;
#   4. signs everything ad hoc (no Developer ID, no notarisation) and writes THIRD-PARTY.txt.
#
# The app starts the hub when it opens and stops it on Quit (src-tauri/src/lib.rs).
# Its settings: ~/Library/Application Support/Astrum/launch.env, KEY=VALUE lines, e.g.
#   ASTRUM_MODE=demo                       demo mode (production is the default)
#   ASTRUM_DEMO_EARTH_REPLY_SECONDS=20     a shorter simulated Earth reply, demo mode only
#   ASTRUM_PORT=4311                       another port (default 4310)
#   ASTRUM_LLAMA_PORT=18432                another port for the model server (default 18431)
# Environment variables of the same names win over the file. No key or secret is bundled.
#
# Needs: Homebrew node and llama.cpp, cargo, the hub's node_modules (npm install), rsvg-convert.

set -euo pipefail

WITH_MODEL=1
for arg in "$@"; do
  case "$arg" in
    --no-model) WITH_MODEL=0 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

HUB="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$HUB/.." && pwd)"
OUT="$REPO/dist-mac"
VERSION="1.0.0"
# Assembled and signed outside the repo: ~/Desktop syncs with iCloud, whose File Provider adds
# extended attributes to new folders, and those break a signature while it is being made.
WORK="$(mktemp -d -t astrum-package)"
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/stage"
APP="$WORK/Astrum.app"
FINAL="$OUT/Astrum.app"
ZIP="$OUT/Astrum-$VERSION-mac$([ "$WITH_MODEL" = 0 ] && echo -no-model || true).zip"
MODEL_NAME="LFM3-1.7B-Q8_0.gguf"
MODEL_SRC="${ASTRUM_MODEL:-$HOME/Desktop/NASA/astrum-model-test/gguf/$MODEL_NAME}"
MODEL_LICENCE="$(dirname "$MODEL_SRC")/LFM-Open-License-v1.0.txt"
BREW="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"
NODE_BIN="$(realpath "$(command -v node)")"
LLAMA_BIN="$(realpath "$(command -v llama-server)")"
GGML_BACKENDS="$BREW/opt/ggml/libexec"

step() { printf '\n== %s\n' "$*"; }
fail() { echo "error: $*" >&2; exit 1; }

[ "$(uname -m)" = arm64 ] || fail "build this on an Apple silicon Mac"
command -v cargo >/dev/null || fail "cargo is missing (rustup.rs)"
command -v rsvg-convert >/dev/null || fail "rsvg-convert is missing (brew install librsvg)"
[ -d "$HUB/node_modules" ] || fail "run npm install in hub/ first"
[ "$WITH_MODEL" = 0 ] || [ -f "$MODEL_SRC" ] || fail "the model is not at $MODEL_SRC (set ASTRUM_MODEL, or use --no-model)"
[ "$WITH_MODEL" = 0 ] || [ -f "$MODEL_LICENCE" ] || fail "the model's licence text is not at $MODEL_LICENCE (from the LICENSE file of LiquidAI/LFM3-1.7B-GGUF on Hugging Face)"

rm -rf "$OUT/.stage" "$FINAL" "$OUT"/Astrum-*-mac*.zip
mkdir -p "$OUT" "$STAGE/hub" "$STAGE/runtime/bin" "$STAGE/runtime/lib" "$STAGE/icons"

# ---------------------------------------------------------------------------
step "1/4 The hub's code, its run-time npm packages and the UI"
rsync -a --exclude '*.test.ts' --exclude 'README.md' \
  "$HUB/core" "$HUB/engine" "$HUB/medical" "$HUB/profiles" "$HUB/data-nasa" \
  "$HUB/package.json" "$HUB/package-lock.json" "$STAGE/hub/"
mkdir -p "$STAGE/hub/ui/public"
rsync -a "$HUB/ui/public/scenario" "$STAGE/hub/ui/public/"
# Only the packages "dependencies" pulls in (no dev tools).
(cd "$HUB" && npm ls --omit=dev --all --parseable 2>/dev/null | tail -n +2) | while read -r dir; do
  rel="${dir#"$HUB"/}"
  mkdir -p "$STAGE/hub/$(dirname "$rel")"
  rsync -a --exclude node_modules "$dir/" "$STAGE/hub/$rel/"
done
(cd "$HUB" && npx vite build ui --outDir "$STAGE/hub/ui/dist" --emptyOutDir --logLevel warn)
[ -f "$STAGE/hub/ui/dist/index.html" ] || fail "the UI build produced no index.html"

# ---------------------------------------------------------------------------
step "2/4 Node and llama-server, with the libraries they load"
cp "$NODE_BIN" "$STAGE/runtime/bin/node"
cp "$LLAMA_BIN" "$STAGE/runtime/bin/llama-server"
# ggml loads its CPU/Metal backends at run time from the executable's folder.
cp "$GGML_BACKENDS"/*.so "$STAGE/runtime/bin/"
chmod u+w "$STAGE"/runtime/bin/*

LIB_DIRS=("$BREW/opt/node/lib" "$BREW/opt/llama.cpp/lib" "$BREW/opt/ggml/lib" "$BREW/lib")
is_system() { case "$1" in /usr/lib/*|/System/*) return 0 ;; *) return 1 ;; esac; }
deps_of() { otool -L "$1" | tail -n +2 | awk '{print $1}'; }
find_lib() { # a dependency as written in the binary -> a real file on this Mac
  local dep="$1" name; name="$(basename "$dep")"
  case "$dep" in
    @*) for d in "${LIB_DIRS[@]}" "$BREW"/opt/*/lib; do [ -e "$d/$name" ] && { realpath "$d/$name"; return; }; done ;;
    *) [ -e "$dep" ] && { realpath "$dep"; return; } ;;
  esac
  fail "cannot find $dep"
}
# Copy every non-system library, repeatedly, until nothing new turns up.
changed=1
while [ "$changed" = 1 ]; do
  changed=0
  for f in "$STAGE"/runtime/bin/* "$STAGE"/runtime/lib/*; do
    [ -f "$f" ] || continue
    for dep in $(deps_of "$f"); do
      is_system "$dep" && continue
      name="$(basename "$dep")"
      [ "$name" = "$(basename "$f")" ] && continue
      if [ ! -e "$STAGE/runtime/lib/$name" ]; then
        cp "$(find_lib "$dep")" "$STAGE/runtime/lib/$name"
        chmod u+w "$STAGE/runtime/lib/$name"
        changed=1
      fi
    done
  done
done
# Point every reference at the copies.
for f in "$STAGE"/runtime/bin/* "$STAGE"/runtime/lib/*; do
  case "$f" in "$STAGE"/runtime/lib/*) prefix="@loader_path"; install_name_tool -id "@rpath/$(basename "$f")" "$f" 2>/dev/null ;; *) prefix="@loader_path/../lib" ;; esac
  for dep in $(deps_of "$f"); do
    is_system "$dep" && continue
    [ "$(basename "$dep")" = "$(basename "$f")" ] && continue
    install_name_tool -change "$dep" "$prefix/$(basename "$dep")" "$f" 2>/dev/null
  done
  codesign --force --sign - "$f" 2>/dev/null
done
# Nothing may still point into Homebrew.
for f in "$STAGE"/runtime/bin/* "$STAGE"/runtime/lib/*; do
  if deps_of "$f" | grep -q "^$BREW"; then fail "$(basename "$f") still loads from $BREW"; fi
done
"$STAGE/runtime/bin/node" -e 'require("node:sqlite")' || fail "the bundled node does not start"
"$STAGE/runtime/bin/llama-server" --version >/dev/null 2>&1 || fail "the bundled llama-server does not start"
echo "Node $("$STAGE/runtime/bin/node" --version), $(ls "$STAGE/runtime/lib" | wc -l | tr -d ' ') libraries"

# ---------------------------------------------------------------------------
step "3/4 The window (src-tauri), the icon and the payload"
# A stand-in icon for Tauri's build (the brand mark on a rounded square); the real one replaces it below.
node -e '
  const fs = require("fs");
  const svg = fs.readFileSync(process.argv[1], "utf8");
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  // The mark is 88 x 68: scaled 7x and centred on a 1024 canvas, inside the 824 px macOS icon grid.
  fs.writeFileSync(process.argv[2], `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="100" y="100" width="824" height="824" rx="185" fill="#000"/><g transform="translate(204 274) scale(7)">${inner}</g></svg>`);
' "$HUB/ui/public/brand/mark.svg" "$STAGE/icons/icon.svg"
rsvg-convert -w 1024 -h 1024 "$STAGE/icons/icon.svg" -o "$STAGE/icons/icon.png"
(cd "$HUB" && npx tauri icon "$STAGE/icons/icon.png" -o "$STAGE/icons/out" >/dev/null 2>&1)
CONFIG=$(printf '{"version":"%s","build":{"beforeBuildCommand":"","frontendDist":"shell"},"bundle":{"active":true,"targets":["app"],"icon":["%s"],"category":"public.app-category.medical","copyright":"Astrum"}}' "$VERSION" "$STAGE/icons/out/icon.icns")
(cd "$HUB" && npx tauri build --bundles app --config "$CONFIG")
BUILT="$HUB/src-tauri/target/release/bundle/macos/Astrum.app"
[ -d "$BUILT" ] || fail "tauri build produced no Astrum.app"
ditto "$BUILT" "$APP"
RES="$APP/Contents/Resources"
# The app's icon is the iPhone app's own (phone/AppIcon.icon, the Icon Composer file), compiled for the Mac:
# Assets.car is what current macOS draws, AppIcon.icns the fallback. It replaces the icon Tauri was built with.
ICON_SRC="$HUB/../phone/AppIcon.icon"
[ -d "$ICON_SRC" ] || fail "the icon is not at $ICON_SRC"
mkdir -p "$STAGE/appicon"
xcrun actool "$ICON_SRC" --compile "$STAGE/appicon" --app-icon AppIcon --platform macosx --minimum-deployment-target 11.0 \
  --output-partial-info-plist "$STAGE/appicon/partial.plist" >/dev/null
[ -f "$STAGE/appicon/Assets.car" ] && [ -f "$STAGE/appicon/AppIcon.icns" ] || fail "actool made no icon from $ICON_SRC"
rm -f "$RES"/*.icns
cp "$STAGE/appicon/Assets.car" "$STAGE/appicon/AppIcon.icns" "$RES/"
plutil -replace CFBundleIconFile -string AppIcon "$APP/Contents/Info.plist"
plutil -replace CFBundleIconName -string AppIcon "$APP/Contents/Info.plist"
ditto "$STAGE/hub" "$RES/hub"
ditto "$STAGE/runtime" "$RES/runtime"
if [ "$WITH_MODEL" = 1 ]; then
  mkdir -p "$RES/model"
  # A copy-on-write clone when the disk allows it (instant), a plain copy otherwise.
  cp -c "$MODEL_SRC" "$RES/model/$MODEL_NAME" 2>/dev/null || cp "$MODEL_SRC" "$RES/model/$MODEL_NAME"
  # The model's licence (LFM Open License v1.0) asks that every copy of the model comes with the licence text.
  cp "$MODEL_LICENCE" "$RES/model/LFM-Open-License-v1.0.txt"
fi

# ---------------------------------------------------------------------------
step "4/4 Signing (ad hoc) and THIRD-PARTY.txt"
# Every Mach-O file inside Resources (Node's native npm modules too), then the app. Only Mach-O:
# codesign keeps the signature of any other file (the Linux and Windows prebuilds) in extended attributes.
find "$RES" -type f \( -name '*.node' -o -name '*.dylib' -o -name '*.so' -o -path '*/runtime/bin/*' \) -print0 \
  | while IFS= read -r -d '' f; do
      if file -b "$f" | grep -q '^Mach-O'; then codesign --force --sign - "$f" 2>/dev/null; fi
    done
# Extended attributes (iCloud's File Provider, Finder info) break the app's signature: drop them first.
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "signature ok (ad hoc)"

licence_of() { # a folder -> the licence named in its LICENSE/COPYING file
  local f; f="$(ls "$1"/LICEN[CS]E* "$1"/COPYING* "$1"/LICENSE.md 2>/dev/null | head -1 || true)"
  [ -n "$f" ] || { echo "no licence file found in $1"; return; }
  local name
  name="$(grep -m1 -oE 'MIT License|MIT|Apache License|BSD [0-9]-Clause|BSD|ISC License|zlib License|Unicode License|GNU Lesser General Public License|OpenSSL License' "$f" || true)"
  echo "${name:-see file} ($(basename "$f"))"
}
{
  echo "Astrum $VERSION for Mac: third-party software inside Astrum.app"
  echo "Generated by hub/scripts/package-mac.sh on $(date +%Y-%m-%d). Licence names are read from the files on the build Mac."
  echo
  echo "Runtime (Contents/Resources/runtime)"
  echo "  Node.js $("$NODE_BIN" --version): $(licence_of "$BREW/opt/node")"
  echo "  llama.cpp / llama-server $(basename "$(dirname "$(dirname "$LLAMA_BIN")")"): $(licence_of "$BREW/opt/llama.cpp")"
  echo "  ggml (and its backends): $(licence_of "$BREW/opt/ggml")"
  for lib in "$STAGE"/runtime/lib/*; do
    src="$(find_lib "@rpath/$(basename "$lib")" 2>/dev/null || true)"
    case "$src" in "$BREW"/Cellar/*) formula="$(echo "$src" | cut -d/ -f5)"; ver="$(echo "$src" | cut -d/ -f6)" ;; *) continue ;; esac
    echo "  $formula $ver ($(basename "$lib")): $(licence_of "$BREW/Cellar/$formula/$ver")"
  done | sort -u
  echo
  echo "The model (Contents/Resources/model, or Application Support/Astrum/models with --no-model)"
  echo "  $MODEL_NAME (LFM3 1.7B, Q8_0 GGUF, Liquid AI): LFM Open License v1.0. Its text is beside the model, in model/LFM-Open-License-v1.0.txt."
  echo
  echo "npm packages (Contents/Resources/hub/node_modules)"
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
  ' "$STAGE/hub/node_modules"
} > "$OUT/THIRD-PARTY.txt"

# The zip carries the signature intact (it is the copy to hand out); the folder copy is for running here.
ditto -c -k --keepParent "$APP" "$ZIP"
ditto "$APP" "$FINAL"
step "Done"
echo "$FINAL  $(du -sh "$FINAL" | cut -f1)$([ "$WITH_MODEL" = 0 ] && echo ', without the model' || true)"
echo "$ZIP  $(du -sh "$ZIP" | cut -f1)"
echo "$OUT/THIRD-PARTY.txt"
