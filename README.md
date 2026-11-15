# Astrum

A health system that reads each crewmate’s body and the room they are in, on one timeline.

NASA Space Apps Challenge 2026 · Create Health Monitoring Software for Astronauts on Space Missions.

## What it is

Astrum runs on board, with no link to Earth. It keeps one record of how each crewmate is, the air in each room and where everyone has been. When something changes it shows what that is based on, tells the right people in order, and walks whoever is helping through first-aid steps written by the medical lead.

- **The hub** (`hub/`): a desktop app. It collects every reading, raises alerts, shows the emergency flow and runs the on-board model. Works offline.
- **The iPhone app** (`phone/`): native SwiftUI. Sends its owner's readings, asks "Are you OK?", shows alerts and the steps, a daily check-in, a chat with Astra, and reads a blood analyser's screen with the camera (it is not a connection to the analyser).
- **The cabin board** (`chip/`): an ESP32 with sensors, on USB, with a Bluetooth beacon and a buzzer as the room alarm.
- **Astra**: a small language model (LFM3, 1.7 billion parameters, through llama.cpp) on the hub's own computer. It answers only from the hub's readings and quoted NASA text. Emergency steps are never generated. Its text is shown only when it passes the hub's checks; otherwise the hub's own sentence is shown.

Alerts have three levels: only the person (never while they sleep); "Are you OK?" plus the Crew Medical Officer; then everyone, with the step card and an incident report to Earth, the delay counted. In a psychological crisis the hub says only that the person needs someone with them; their words are never shown.

## Run it

### The hub (the desktop program)

Needs Node 24 or newer. For the on-board model: `brew install llama.cpp` (gives `llama-server`).

```sh
cd hub
npm install
npm run build
npm run core
```

Open <http://localhost:4310>.

- The model file is not in this repository: `LFM3-1.7B-Q8_0.gguf`. Download it from Hugging Face, repository `LiquidAI/LFM3-1.7B-GGUF`.
- Put it at `~/Desktop/NASA/astrum-model-test/gguf/LFM3-1.7B-Q8_0.gguf`, or point to it: `ASTRUM_MODEL=/path/to/LFM3-1.7B-Q8_0.gguf npm run core`.
- No model file or no `llama-server`: the hub still starts, with the on-board model off.
- Demo mode is the default (simulated crew and readings, labelled). Production, with no simulated values: `ASTRUM_MODE=production npm run core`.
- Tests: `npm test`. The medical cases: `npm run cases`.

### The Mac app (optional)

One app that carries its own Node, the hub and the model server. Apple silicon only.

1. Build it (needs Rust and the Tauri CLI; Homebrew's `llama-server` installed):
   ```
   cd hub
   scripts/package-mac.sh            # with the model, about 1.9 GB
   scripts/package-mac.sh --no-model # without it, about 226 MB
   ```
2. The app and its zip land in `dist-mac/`.
3. Open `Astrum.app`. It is not notarised, so macOS blocks a downloaded copy: go to System Settings, Privacy & Security, and choose Open Anyway.
4. It starts the hub in production mode on port 4310. Closing the window keeps the hub running; Quit stops it.
5. Data lives in `~/Library/Application Support/Astrum`. For demo mode, put `ASTRUM_MODE=demo` in a file named `launch.env` in that folder.

Built with `--no-model`, the app tells you which folder to put the model file in.

### The iPhone app

1. Open `phone/Astrum.xcodeproj` in Xcode.
2. Target Astrum, Signing & Capabilities: pick your team. Change the bundle id if Xcode says it is taken.
3. Run it on a real iPhone, on the same Wi-Fi as the hub, with the hub running.
4. Allow Health, notifications, Bluetooth, local network and camera when asked.
5. The app finds the hub by itself, or tap "Scan the hub's code" in the first-run screens.

### The cabin board (ESP32 DevKit)

1. Quit the hub (it holds the serial port).
2. Plug the board into the Mac by USB. Find its port: `arduino-cli board list`
3. Install the board package once: `arduino-cli core install esp32:esp32`
4. Compile and upload (replace the port):

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 chip/astrum_chip
arduino-cli upload -p /dev/cu.usbserial-XXXX --fqbn esp32:esp32:esp32 chip/astrum_chip
```

5. Start the hub again with the board still plugged in.

The board measures pressure, temperature, humidity, light, noise and vibration. Light and noise are raw values. This build's board gives no CO2 reading.

### See it without any hardware

1. Build the hub page once (`cd hub && npm install && npm run build`).
2. Start the hub: `npm run core`.
3. Open <http://localhost:4310/?replay=scenario/reyes-night.json> to watch the recorded story.
4. A mock danger alert, nothing sent: <http://localhost:4310/?demoEmergency=high-co2>

## Folders

| Folder | What is in it |
|---|---|
| `chip/` | The cabin chip: ESP32 firmware and wiring |
| `hub/` | The hub: desktop app, local server, interface |
| `phone/` | The iPhone app |
| `detector/` | The cabin maths and the per-person baseline |
| `docs/` | The reading format and notes |

## What is real and what is simulated

Real:
- The software on all three devices.
- The board's measurements of pressure, temperature, humidity, light, noise and vibration. Light and noise are raw, uncalibrated values.
- A phone's own readings.
- NASA's records and text, replayed and quoted unchanged.

Simulated or replayed, and labelled on screen:
- The crew. Their portraits are AI-generated images and carry a visible "AI" mark.
- Most body readings, and where people are.
- The recorded story ("Reyes's night"): a recording of the system running on simulated and replayed data.
- In demo mode, Earth's reply to a message.

**The board gives no CO2 reading.** Its air-quality sensor does not answer, and it has no oxygen or radiation sensor. All CO2 shown is NASA's replayed record or simulated. Every radiation dose is an estimate from room rates and time spent.

Production mode (the packaged app's default) makes no simulated value and shows none.

## Measured, 15 Nov 2026

- Astra, 96 test questions, one run each: 0 unsafe answers shown. 84 passed, 6 failed the scoring (an answer was shown that was incomplete or missed a required point), 6 were discarded by the hub's checks and replaced with a fixed refusal. In 54 conversation turns: 0 unsafe shown. Results: `hub/ai-eval/results/`.
- The medical lead's own test set: 79 of 96 cases pass on the hub's rules; 17 fail.
- Crisis phrases recognised: 7 of 14. The weakest piece.
- Blood reader, on Abbott's own result-screen pictures shown on a monitor: 29 of 32 values read right, 0 wrong values filled in. Not tested on a real analyser.
- Hub automated tests: 513 pass, 1 skipped, 0 fail.

## Limits

- One board and one real phone; the crew is simulated.
- The 42 first-aid cards were approved line by line by the medical lead, but most steps are not yet checked against a published source. Each card lists what is unchecked.
- The step animations are not yet reviewed by the medical lead, and say so on screen.
- Astra answers in English only.
- False-alarm rates over long runs are not measured.
- Astrum does not diagnose or treat. It is not a medical device.

## NASA data

- **NASA OSDR, ISS cabin telemetry, Rodent Research-1 (SpaceX-4), 2014.** 12,087 readings each of CO2, temperature and humidity, replayed unchanged as the rooms' air. <https://visualization.osdr.nasa.gov/eda/api/missions/RR-1/co2/>
- **NASA OSDR, Inspiration4 blood panels, OSD-569 and OSD-575.** One simulated crewmate's blood results, labelled Replayed. <https://osdr.nasa.gov/osdr/data/osd/files/569> · <https://osdr.nasa.gov/osdr/data/osd/files/575>
- **NASA-STD-3001 CO2 Technical Brief (OCHMO-TB-004).** The room alarm's 3 mmHg one-hour limit and the headache band from 2.8 mmHg. <https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-004-carbon-dioxide.pdf>
- **NASA Human Research Program hazard and risk pages, and technical briefs.** 90 passages from 26 pages, quoted word for word: the only NASA text the model is given. <https://www.nasa.gov/hrp/risks/>
- **NASA Life Sciences Portal.** The centres of the simulated crew's values. <https://nlsp.nasa.gov/>
- **NASA Appendix E, table E.2-2.** The conditions the cards were written against. <https://www.nasa.gov/reference/appendix-e-health-and-medical-care-technical-requirements/>

Other references: Curiosity RAD dose rates (Zeitlin et al., Science 2013; Hassler et al., Science 2014). The medical guidelines each card cites are listed on the card (`hub/medical/cards.json`).

## Use of AI

- The code, tests and documents were written largely with AI coding tools, directed and reviewed by the developer.
- A small language model runs inside the product, restricted as described above.
- The first-aid cards were drafted with an AI tool, then reviewed, corrected and approved line by line by the medical lead. An AI-run check against public guidelines found 17 conflicts, which she resolved one by one.
- The six crew portraits are AI-generated images, marked "AI" on the image.
- The step animations are drawn by code (three.js) written with AI coding tools. They are not generated images.
- In demo mode, Earth's reply is simulated and labelled.
- No dataset was generated by AI.

## Credits

- Caio Agra Lemos: design and engineering.
- Leticia Alves Barbosa Leite, medical lead: the emergency cards, test cases and blood values. She decided the rules, the levels and who is told, and approved every card.
- Language model: LFM3 1.7B, Liquid AI, LFM Open License v1.0. Runtime: llama.cpp.
- Software: React, three.js, Vite, TypeScript, Tauri, Node.js, ws, serialport, bonjour-service; Arduino core for the ESP32 (Espressif). Licences of what the Mac app bundles: `THIRD-PARTY.txt` beside the app.
- The 3D scenes and step animations are drawn by this project's own code. No outside 3D models or fonts are used.
