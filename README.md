# Astrum

A health system that reads each crewmate’s body and the room they are in, on one timeline.

NASA Space Apps Challenge 2026 · Create Health Monitoring Software for Astronauts on Space Missions.

## The pieces

| Piece | Folder | What it does |
|---|---|---|
| Hub | `hub/` | The desktop app. Collects every reading, raises alerts, shows the emergency steps, runs the on-board model. |
| iPhone app | `phone/` | One per crewmate. Sends their readings, shows alerts and steps, the daily check-in, the chat with Astra. |
| Cabin board | `chip/` | An ESP32 with sensors, plugged into the hub by USB. |
| Astra | inside the hub | A small language model that runs on the hub's own computer. No internet. |

The hub is the centre. Phones find it over Wi-Fi; the board talks to it over USB. Start with the hub; the other two are optional.

## 1. The hub

Needs Node 24 or newer.

```sh
cd hub
npm install
npm run build
npm run core
```

Open <http://localhost:4310>. It starts in demo mode: a simulated crew and readings, each labelled on screen.

- The real thing, with nothing simulated: `ASTRUM_MODE=production npm run core`. The first start walks you through the setup.
- The recorded story, no hardware needed: <http://localhost:4310/?replay=scenario/reyes-night.json>

### Astra (optional)

Without it the hub still runs, with the model off.

1. `brew install llama.cpp`
2. Download `LFM3-1.7B-Q8_0.gguf` from Hugging Face, repository `LiquidAI/LFM3-1.7B-GGUF`.
3. Start the hub with it: `ASTRUM_MODEL=/path/to/LFM3-1.7B-Q8_0.gguf npm run core`

## 2. The iPhone app

1. Open `phone/Astrum.xcodeproj` in Xcode and pick your team under Signing & Capabilities.
2. Run it on a real iPhone, on the same Wi-Fi as the hub, with the hub running.
3. Allow Health, notifications, Bluetooth, local network and camera when asked.

The app finds the hub by itself.

## 3. The cabin board

An ESP32 DevKit. Wiring: [`chip/README.md`](chip/README.md).

1. Quit the hub (it holds the serial port) and plug the board in by USB.
2. Once: `arduino-cli core install esp32:esp32`
3. Find the port with `arduino-cli board list`, then:

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 chip/astrum_chip
arduino-cli upload -p /dev/cu.usbserial-XXXX --fqbn esp32:esp32:esp32 chip/astrum_chip
```

4. Start the hub again with the board plugged in.

It measures pressure, temperature, humidity, light, noise and vibration. It gives no CO2 reading.

## Packaged apps

One app that carries the hub, Node and the model, in production mode.

```sh
hub/scripts/package-mac.sh   # Mac, Apple silicon  -> dist-mac/
hub/scripts/package-win.sh   # Windows x64         -> dist-win/
```

Add `--no-model` for a small build. Neither is signed by a store: on a Mac choose Open Anyway in Privacy & Security; on Windows choose More info, then Run anyway. Windows also needs Microsoft's Visual C++ Redistributable (x64).

## More

What is real and what is simulated, results, limits, NASA data, use of AI and credits: [`docs/about.md`](docs/about.md).
