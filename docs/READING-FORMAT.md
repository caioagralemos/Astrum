# Sending readings to the hub

Any device on the station's network can send readings to the hub. The iPhone app is the first client; anything that can make an HTTP request can be another.

## Where

`POST http://<hub>:4310/api/readings` with a JSON body. The hub also announces itself on the local network over Bonjour as `_astrum._tcp` (name "Astrum hub").

The same body can be sent over the hub's WebSocket at `ws://<hub>:4310/ws` as `{"type": "readings", "source": ..., "rows": [...]}`.

## The body

```json
{
  "source": "phone:reyes",
  "rows": [
    { "t": 1763136000000, "signal": "heart_rate", "value": 62, "unit": "bpm", "kind": "measured", "person": "reyes" }
  ]
}
```

- `source`: who is sending, a short id of lowercase letters, digits and `: . _ -` (up to 64), such as `phone:reyes` or `chip:cabin-1`.
- `rows`: up to 5000 per request; the phone sends at most 500. Each row:
  - `t`: when it was true, in milliseconds since 1970 (UTC).
  - `signal`: what was read, lowercase letters, digits, `_` and `.`.
  - `value`: a number, or `null` for a row that carries only `text`.
  - `text`: optional free text, up to 2000 characters.
  - `unit`: up to 16 characters.
  - `kind`: how the value came to exist (below).
  - `person` and `room`: short ids (lowercase letters, digits, `-`). A row needs at least one: `person` for a body reading, `room` for a cabin reading.

The hub answers `200 {"accepted": n}`, or `400 {"error": "..."}` naming the first bad row. One bad row rejects the whole request.

## Kinds

- `measured`: a sensor read it here and now.
- `estimated`: worked out from something measured.
- `reported`: said by the person: a check-in answer such as "I have a headache". A typed blood result is `measured`, because an instrument read it.
- `replayed`: a real measurement from somewhere else (NASA's ISS record), played back here.
- `simulated`: made up.

A hub in production keeps only `measured`, `estimated` and `reported`, and silently drops the other two. Demo mode keeps all five and labels them on screen.

## Signals the phone sends

All are `measured`, with `person` set to the phone's owner.

| Signal | Unit | What one row is |
|---|---|---|
| `heart_rate` | bpm | One Health sample |
| `resting_heart_rate` | bpm | One Health sample |
| `hrv` | ms | One sample of heart rate variability (SDNN) |
| `breathing_rate` | breaths/min | One sample |
| `blood_oxygen` | % | One sample, 0 to 100 |
| `sound_level` | dBA | One sample of sound around the person |
| `steps` | count | The day's total so far |
| `exercise_minutes` | min | The day's total so far |
| `active_energy` | kcal | The day's total so far |
| `sleep_duration` | min | Minutes asleep in the night (18:00 to 18:00), sent at waking |

For the day totals, each update sends a new, larger total for the same day; the newest row is the current one.

## Example

```sh
curl -X POST http://192.168.1.20:4310/api/readings \
  -H 'content-type: application/json' \
  -d '{"source":"phone:reyes","rows":[{"t":1763136000000,"signal":"heart_rate","value":62,"unit":"bpm","kind":"measured","person":"reyes"}]}'
```
