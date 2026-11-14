# Adding a sensor

The spacecraft may have sensors Astrum was not built with: a radiation monitor, an oxygen sensor, a second CO2 sensor, anything. The crew can add any of them to the hub, and the hub then treats it like its own: it shows it in its room (or with its person), under the name the crew gave it, and keeps every reading on the timeline.

## Two ways in

1. **A device that can make an HTTP request** (`http-push`). It posts readings to the hub, exactly as in [READING-FORMAT.md](READING-FORMAT.md), with the source `sensor:<id>`.
2. **A device on a serial cable** (`serial-json`). It prints one JSON line per reading at 115200 baud:

   ```
   {"sensor":"rad-1","r":[["radiation",0.31,"uSv/h","m"]]}
   ```

   Each reading is `[signal, value, unit, kind]`, the same as the cabin chip: kind `m` measured, `e` estimated, `s` simulated. The hub stamps the time each line arrives. The hub reads the ports listed in `ASTRUM_SENSOR_PORTS` (comma-separated, such as `/dev/tty.usbmodem1101`).

A device that sends before anyone has registered it shows up in the sensor list as **"heard from an unknown sensor: rad-1"**. That is the usual way to find a new device: plug it in, see its id, add it.

## What to register

`POST /api/sensors` with:

| Field | What it is |
|---|---|
| `id` | Short id: lowercase letters, digits, `-`. Its readings come from the source `sensor:<id>`. |
| `name` | What the crew calls the device. |
| `room` or `person` | Where it is: a room for a cabin sensor, a crewmate for a body sensor. One of the two. |
| `transport` | `http-push` or `serial-json`. |
| `signals` | What it reads, one entry per signal (below). |

Each signal:

| Field | What it is |
|---|---|
| `signal` | The key on the timeline: lowercase letters, digits, `_`, `.` (such as `radiation`). |
| `name`, `namePt` | The name on screen, in English and (optionally) Portuguese. |
| `unit` | Up to 16 characters. |
| `decimals` | Digits shown after the point. |
| `bounds` | Optional `{min, max}`: values this device cannot give. A reading outside them is refused, not stored. |
| `limits` | Optional levels **the crew** sets: `warnAbove`, `warnBelow`, `alarmAbove`, `alarmBelow`, and `windowMinutes` to judge an average instead of the newest reading. |
| `note` | Anything worth knowing: model, where it is mounted, calibration. |

The hub answers with problems in plain words if something is off (a room that does not exist, a warning level above the alarm level), and saves nothing until they are fixed.

## Example: a radiation monitor in the lab

The numbers below are made up to show the format. **They are examples, not recommended limits.** Astrum sets no radiation level of its own; the crew, or their flight surgeon, decides.

```sh
curl -X POST http://<hub>:4310/api/sensors -H 'content-type: application/json' -d '{
  "id": "rad-1",
  "name": "Radiation monitor",
  "room": "lab",
  "transport": "http-push",
  "signals": [{
    "signal": "radiation", "name": "Radiation", "namePt": "Radiação",
    "unit": "uSv/h", "decimals": 2,
    "bounds": { "min": 0 },
    "limits": { "alarmAbove": 123 },
    "note": "Example only: 123 is a made-up number, not a recommended limit."
  }]
}'
```

Then `POST /api/sensors/test?id=rad-1`. The answer holds the exact body the device should send, and a ready-to-paste `curl` that checks the connection. The test `curl` carries the words "connection test" and no number, so it never stores a made-up reading. Ask again, and the answer says whether anything from `sensor:rad-1` has arrived since the test started.

The device then sends its real readings:

```json
{"source":"sensor:rad-1","rows":[{"t":1763136000000,"signal":"radiation","value":0.31,"unit":"uSv/h","kind":"measured","room":"lab"}]}
```

## What the hub does with it

- **Shows it** in its room (or with its person), with the crew's name for it, the device's kind label (measured, estimated, simulated: the hub never changes it), and whether readings are arriving.
- **Judges it only against levels the crew set**, labelled "set by the crew". A signal with no levels is shown and never judged. A level is never judged on a reading that is too old or an average with too little data: that is "not judged", never "fine".
- **Keeps NASA's limits apart.** If a signal has a NASA limit (today: CO2, 3 mmHg as a 1-hour average), NASA's limit is still judged on its own, whatever the crew sets, and both are shown separately. Such a signal must be registered in NASA's unit.
- **Refuses** readings outside the device's bounds, and counts them in `GET /api/sensors`.
- **In production, drops** any row marked `simulated`, as for every source.
- In demo mode, a room's simulated stand-in for a signal stops as soon as a real sensor sends that signal there.

`GET /api/sensors` lists every registered sensor with its status, the hub's built-in signals, signals arriving that nobody described, and unknown sensors. `DELETE /api/sensors?id=rad-1` removes the registration; its readings stay on the timeline.
