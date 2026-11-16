# Cabin chip

An ESP32 DevKit board with sensors, plugged into the hub's computer by USB. It sends one line of JSON a second, and sounds a buzzer when the hub asks.

## Run it

1. Quit the hub, whether the Astrum app or `npm run core` (it holds the serial port).
2. Plug the board into the Mac. Find its port: `arduino-cli board list`
3. Once: `arduino-cli core install esp32:esp32`
4. Compile and upload (replace the port):

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 chip/astrum_chip
arduino-cli upload -p /dev/cu.usbserial-XXXX --fqbn esp32:esp32:esp32 chip/astrum_chip
```

5. Arduino IDE instead: open `astrum_chip/astrum_chip.ino`, Board "ESP32 Dev Module", the `usbserial` port, Upload. If it stops at "Connecting", hold the BOOT button.
6. Check: serial monitor at 115200 baud shows a line a second with `"fw":"0.3"`. Close it, then start the hub: open the Astrum app, or `cd hub && npm run core`.
7. No tools? Flash the ready-made file from the [latest release](https://github.com/caioagralemos/Astrum/releases/latest): `esptool.py --chip esp32 write_flash 0x0 Astrum-board-firmware-0.3-esp32.bin`. On Windows the board needs Silicon Labs' CP210x driver if Windows does not install it by itself.

## Folders

- `astrum_chip/astrum_chip.ino`: the firmware
- `wiring-blueprint.pdf`: the wiring drawing (also `.html`)

## What is real and what is simulated

- Measured: pressure (BMP280), temperature and humidity (AHT21), vibration (MPU6050), noise (microphone), light (LDR).
- Noise and light are raw values from 0 to 4095, not calibrated units.
- This build's board gives no CO2 reading. The ENS160 only estimates it; the chip lists it as missing. Oxygen and radiation have no part.
- The chip never invents a value. In demo mode the hub fills a missing reading and labels it simulated.

## Wiring

| Part | Reads | Pins |
|---|---|---|
| BMP280 | pressure | SDA 16, SCL 15 |
| AHT21 | temperature, humidity | SDA 23, SCL 22 |
| MPU6050 | vibration | SDA 4, SCL 5 |
| Microphone | noise | GPIO 34 |
| LDR | light | GPIO 35 |
| Buzzer | alarm | GPIO 25 |

Everything runs at 3.3 V. The board also sends a Bluetooth beacon (service `A5A273B7-39C1-4BF4-B86C-5D4BB3B06B1F`, name `cabin-1`) so the phone knows it is near. It cannot be connected to.
