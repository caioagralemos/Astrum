# Hub

The program that runs on the station computer. It reads the cabin board and the phones, works out alerts, and serves the page at port 4310.

## Run it

Needs Node 24 or newer. For the on-board model: `brew install llama.cpp`.

```sh
npm install
npm run build
npm run core
```

Open <http://localhost:4310>.

1. The model file is not in this repository: `LFM3-1.7B-Q8_0.gguf`. Download it from Hugging Face, repository `LiquidAI/LFM3-1.7B-GGUF`.
2. Put it at `~/Desktop/NASA/astrum-model-test/gguf/LFM3-1.7B-Q8_0.gguf`, or set `ASTRUM_MODEL=/path/to/file.gguf`.
3. Without the model or `llama-server`, the hub still starts, with the model off.
4. Production mode (no simulated values): `ASTRUM_MODE=production npm run core`. The default is demo mode.
5. Tests: `npm test`. Medical cases: `npm run cases`.

The Mac app: `scripts/package-mac.sh` (add `--no-model` to leave the 2 GB model out). The app lands in `../dist-mac/`. See the main README for opening an app that is not notarised.

No hardware: open `http://localhost:4310/?replay=scenario/reyes-night.json`.

## Folders

- `core/`: the server, alerts, drills, events, serial link to the board
- `engine/`: the maths: baselines, limits, readings
- `ui/`: the page (React), built into `ui/dist`
- `medical/`: the medical lead's cards, blood list and test cases
- `profiles/`, `data/`: crew and places, the database
- `scripts/`: helper scripts (fake board, end-to-end checks)
- `src-tauri/`: the desktop app shell

## What is real and what is simulated

- In demo mode the hub fills the crew's gaps with simulated readings and labels them.
- In production mode it makes no simulated value; a missing reading shows as missing.
- A recorded story is a recording, not a live feed.
- The hub has no weather or radiation sensor; a base-wide event is declared by a crewmate.

## Try the alert flow (demo mode)

```sh
# A drill for Reyes: simulated CO2 in her room, ends by itself after 10 minutes
curl -X POST http://localhost:4310/api/drill/start -H 'content-type: application/json' -d '{"person":"reyes"}'
curl -X POST http://localhost:4310/api/drill/stop

# A crewmate declares a dust storm (kinds: dust_storm, solar_particle_event, pressure_loss, fire, other)
curl -X POST http://localhost:4310/api/events/declare -H 'content-type: application/json' -d '{"kind":"dust_storm","by":"reyes"}'
curl http://localhost:4310/api/events
```
