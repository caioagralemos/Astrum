# Cabin chip

ESP32 DevKit (ESP32-D0WD-V3) on a RoboCore expansion board, connected to the hub by USB. Firmware: `astrum_chip/astrum_chip.ino` (version 0.3). It needs no libraries beyond the ESP32 core: the Bluetooth beacon uses the core's built-in BLE library.

## Wiring

The full drawing, four sheets (board as built, schematic, pin table, slots with no part): [wiring-blueprint.pdf](wiring-blueprint.pdf). The board was wired and its parts tested on 12 Nov 2026; the firmware and the fourth sheet were made on 14 Nov.

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

## Slots with no part fitted

The design has three more readings than the board can make today. The chip names each one as missing every second, so the hub always knows what it lacks.

| Reading | Why it is missing | What would fill it |
|---|---|---|
| CO2 | The chip reports CO2 and air quality as missing today; the ENS160 only estimates CO2 from other gases. | A true CO2 sensor (SCD41 or similar) on the air board's pins |
| Oxygen | No part fitted | An electrochemical O2 sensor |
| Radiation | No part fitted | A Geiger tube or solid-state dosimeter on a free pin |

In demo mode the hub fills these from NASA's records or with simulated values, and labels them. In production they show as missing.

## What it sends

One line of JSON a second, at 115200 baud:

```json
{"chip":"cabin-1","fw":"0.3","ble":"on","r":[["pressure",1009.2,"hPa","m"],["noise",312,"raw","m"]],"missing":["co2","air_quality","oxygen","radiation"]}
```

`ble` is the Bluetooth beacon: `on` when it started advertising, `off` when the Bluetooth stack refused to start. Firmware before 0.3 leaves it out. The hub passes it on in the board's status (`sources`).

Each reading is `[signal, value, unit, kind]`. Kind is `m` (measured) or `e` (estimated). The chip never invents a value: a part that does not answer is listed in `missing` and probed again every second, so it is picked up when it answers. In demo mode the hub fills a missing signal with a simulated value and labels it; in production it shows the signal as missing.

Noise and light are raw readings from 0 to 4095, not calibrated units.

## What it accepts

`{"buzz":"alarm"}` (repeats, stops by itself after 60 seconds unless sent again), `{"buzz":"beep"}`, `{"buzz":"off"}`.

## Bluetooth room beacon

From firmware 0.3 the board also advertises a Bluetooth Low Energy beacon, so a crewmate's phone can tell it is near this board and tell the hub (`POST /api/stays`, kind measured, source `phone:<crewmate>:ble`).

| | |
|---|---|
| Service UUID | `A5A273B7-39C1-4BF4-B86C-5D4BB3B06B1F` (the same in `phone/Astrum/RoomLocator.swift`) |
| Local name | the board id, `cabin-1` |
| Type | non-connectable: nothing can connect, no readings go over the air |
| Interval | 100 to 150 ms |
| Transmit power | fixed at +3 dBm, so the phone's thresholds mean the same thing every boot |

The Bluetooth stack runs on the ESP32's other core, so the sensor loop and the serial lines keep their timing. The ESP32-D0WD-V3 on this board has Bluetooth; an ESP32-S2 would not.

**What it can and cannot tell.** The phone measures how strong the board's signal is. A strong signal means the phone is *near the board*, not that it is *inside the room*: the signal goes through walls and open hatches, and a body between phone and board weakens it. With one board the phone can only say "in the board's room" or "board not seen"; when not seen it says nothing and never guesses another room. The thresholds in `RoomLocator.swift` (enter at -65 dBm, leave below -78 dBm, 20 seconds before a change is believed) are **untuned** until someone walks around the cabin with the phone.

## Flashing (Arduino IDE)

1. Plug the board into the Mac by USB. If the hub is running, quit it first: it holds the serial port and the upload would fail.
2. Open `chip/astrum_chip/astrum_chip.ino` in the Arduino IDE.
3. Tools, Board: **esp32**, then **ESP32 Dev Module**. (Needs the "esp32" boards package by Espressif, version 3.x, from Boards Manager. It is already installed on this Mac: 3.3.12.)
4. Tools, Partition Scheme: leave it on **Default 4MB with spiffs**. Version 0.3 uses about 1.13 MB of the 1.31 MB it allows (86%), because the Bluetooth stack is big. If a later change says "Sketch too big", choose **Huge APP (3MB No OTA/1MB SPIFFS)** instead.
5. Tools, Port: the one named `/dev/cu.usbserial-…`.
6. Click Upload (the arrow). If it stops at "Connecting……", hold the board's BOOT button until the upload starts.
7. When it says "Hard resetting", open Tools, Serial Monitor at **115200** baud. You should hear one short beep, then see a line a second containing `"fw":"0.3","ble":"on"`.
8. Close the Serial Monitor (it holds the port too), then start the hub again.

To check the beacon without the Astrum app: a free BLE scanner on the phone (for example nRF Connect) should list a device named `cabin-1` with the service UUID above, its signal around -40 dBm next to the board.

## Known limits

- The ENS160 code path has not run on this board yet.
- The chip has no clock. The hub stamps each reading when it arrives.
- Firmware 0.3 compiles (arduino-cli, ESP32 core 3.3.12, ESP32 Dev Module) but has not run on the board yet; the beacon is untested on hardware.
