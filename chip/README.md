# Cabin chip

ESP32 DevKit (ESP32-D0WD-V3) on a RoboCore expansion board, connected to the hub by USB. Firmware: `astrum_chip/astrum_chip.ino`. It needs no libraries beyond the ESP32 core.

## Wiring

The full drawing, three sheets (board as built, schematic, pin table): [wiring-blueprint.pdf](wiring-blueprint.pdf). The board was wired and its parts tested on 12 Nov 2026; the firmware was written on 14 Nov.

| Part | Reads | Pins |
|---|---|---|
| BMP280 | Cabin pressure | SDA 16, SCL 15 |
| AHT21 (on the ENS160 + AHT21 board) | Temperature, humidity | SDA 23, SCL 22 |
| ENS160 (same board) | Estimated CO2, air quality | SDA 23, SCL 22 |
| MPU6050 | Vibration | SDA 4, SCL 5 |
| Microphone | Noise | GPIO 34 |
| LDR + resistor | Light | GPIO 35 |
| Buzzer | Room alarm | GPIO 25 |

The ESP32 is a 3.3 V board. The jumper on the expansion board stays on V + 3.3V.

## What it sends

One line of JSON a second, at 115200 baud:

```json
{"chip":"cabin-1","fw":"0.1","r":[["pressure",1009.2,"hPa","m"],["noise",312,"raw","m"]],"missing":["co2","air_quality"]}
```

Each reading is `[signal, value, unit, kind]`. Kind is `m` (measured) or `e` (estimated). The chip never invents a value: a part that does not answer is listed in `missing` and probed again every second, so it is picked up when it answers. In demo mode the hub fills a missing signal with a simulated value and labels it; in production it shows the signal as missing.

Noise and light are raw readings from 0 to 4095, not calibrated units.

## What it accepts

`{"buzz":"alarm"}` (repeats, stops by itself after 60 seconds unless sent again), `{"buzz":"beep"}`, `{"buzz":"off"}`.

## Known limits

- The ENS160 on this board does not answer, so its code path has never run.
- The chip has no clock. The hub stamps each reading when it arrives.
