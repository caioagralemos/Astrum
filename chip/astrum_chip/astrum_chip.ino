// Astrum cabin chip. ESP32 DevKit, sensors on the pins listed in chip/README.md.
//
// Once a second it sends one line of JSON over USB serial (115200 baud):
//   {"chip":"cabin-1","fw":"0.3","ble":"on","r":[["pressure",1009.2,"hPa","m"],...],"missing":["co2"]}
// Each reading is [signal, value, unit, kind]; kind is "m" measured or "e" estimated.
// The chip never invents a value. A part that does not answer is listed in
// "missing" and probed again every cycle, so it is picked up the moment it answers.
//
// Slots with no part fitted on this board: oxygen and radiation. They are
// always listed in "missing", so the hub knows the chip is built to carry them
// and has nothing to report. A driver goes in when a part does.
//
// The hub can send a line back:
//   {"buzz":"alarm"}  repeating alarm tone, stops by itself after 60 s unless sent again
//   {"buzz":"beep"}   one short beep
//   {"buzz":"off"}
//
// It also advertises a Bluetooth Low Energy beacon, so a crewmate's phone can
// tell it is near this board: the Astrum service UUID below and the board id as
// the local name. Nothing can connect to it and it sends no readings over the
// air. "ble" in each line is "on" when advertising started, "off" when the
// Bluetooth stack refused to start.

#include <Wire.h>
#include <BLEDevice.h>
#include <BLEAdvertising.h>

const char *CHIP_ID = "cabin-1";
const char *FW = "0.3";

// The same UUID is in the phone app (RoomLocator.swift) and chip/README.md.
const char *ASTRUM_BLE_SERVICE = "A5A273B7-39C1-4BF4-B86C-5D4BB3B06B1F";

// Analog parts and the buzzer.
const int PIN_MIC = 34, PIN_LDR = 35, PIN_BUZZER = 25;
const unsigned BUZZER_HZ = 2000;

// ---------- I2C ----------
// Each sensor board has its own pin pair. The ESP32 has two I2C controllers:
// Wire1 stays on the vibration board; Wire is moved between the pressure board
// and the air board before each one is read.

struct I2cPins { int sda, scl; };
const I2cPins PRESSURE_PINS = {16, 15};  // BMP280
const I2cPins AIR_PINS = {23, 22};       // AHT21 + ENS160 board
const I2cPins MOTION_PINS = {4, 5};      // MPU6050, on Wire1
const uint16_t I2C_TIMEOUT_MS = 20;

void attachBus(TwoWire &bus, I2cPins pins) {
  bus.begin(pins.sda, pins.scl);
  bus.setTimeOut(I2C_TIMEOUT_MS);
}

// Stopping the controller first releases the pins it was on.
void moveWire(I2cPins pins) {
  Wire.end();
  attachBus(Wire, pins);
  delay(3);  // let the lines settle on the new pins
}

// An empty write: a device acknowledges its address or it does not.
bool answers(TwoWire &bus, uint8_t addr) {
  bus.beginTransmission(addr);
  return bus.endTransmission() == 0;
}

// The first of two possible addresses that answers, or 0 when neither does.
uint8_t findAddress(TwoWire &bus, uint8_t first, uint8_t second) {
  if (answers(bus, first)) return first;
  if (answers(bus, second)) return second;
  return 0;
}

bool readBytes(TwoWire &bus, uint8_t addr, uint8_t *out, uint8_t count) {
  if (bus.requestFrom(addr, count) != count) return false;
  for (uint8_t i = 0; i < count; i++) out[i] = bus.read();
  return true;
}

// Register read: the register index, a repeated start instead of a stop, then the bytes.
bool readRegs(TwoWire &bus, uint8_t addr, uint8_t reg, uint8_t *out, uint8_t count) {
  bus.beginTransmission(addr);
  bus.write(reg);
  if (bus.endTransmission(false) != 0) return false;
  return readBytes(bus, addr, out, count);
}

bool writeBytes(TwoWire &bus, uint8_t addr, const uint8_t *data, size_t count) {
  bus.beginTransmission(addr);
  bus.write(data, count);
  return bus.endTransmission() == 0;
}

bool writeReg(TwoWire &bus, uint8_t addr, uint8_t reg, uint8_t value) {
  const uint8_t frame[2] = {reg, value};
  return writeBytes(bus, addr, frame, sizeof frame);
}

// ---------- BMP280: pressure ----------

uint8_t bmpAddr = 0;
uint16_t digT1, digP1;
int16_t digT2, digT3, digP2, digP3, digP4, digP5, digP6, digP7, digP8, digP9;

// Bosch BMP280 datasheet (BST-BMP280-DS001): address 0x76 or 0x77 by the SDO pin
// (section 5.2); calibration words little-endian from 0x88 (section 3.11.2, table 17);
// config 0xF5 and ctrl_meas 0xF4, measurements from 0xF7 (section 4.3).
bool bmpSetup() {
  bmpAddr = findAddress(Wire, 0x76, 0x77);
  if (!bmpAddr) return false;
  uint8_t c[24];
  if (!readRegs(Wire, bmpAddr, 0x88, c, 24)) return false;
  digT1 = c[0] | c[1] << 8;   digT2 = c[2] | c[3] << 8;   digT3 = c[4] | c[5] << 8;
  digP1 = c[6] | c[7] << 8;   digP2 = c[8] | c[9] << 8;   digP3 = c[10] | c[11] << 8;
  digP4 = c[12] | c[13] << 8; digP5 = c[14] | c[15] << 8; digP6 = c[16] | c[17] << 8;
  digP7 = c[18] | c[19] << 8; digP8 = c[20] | c[21] << 8; digP9 = c[22] | c[23] << 8;
  // Normal mode, temperature and pressure sampled once each, light filtering.
  return writeReg(Wire, bmpAddr, 0xF5, 0x08) && writeReg(Wire, bmpAddr, 0xF4, 0x27);
}

// Bosch's floating-point compensation formula, BMP280 datasheet section 8.1,
// unchanged. Result in hPa.
bool bmpRead(float &hPa) {
  uint8_t d[6];
  if (!readRegs(Wire, bmpAddr, 0xF7, d, 6)) return false;
  int32_t adcP = ((int32_t)d[0] << 12) | ((int32_t)d[1] << 4) | (d[2] >> 4);
  int32_t adcT = ((int32_t)d[3] << 12) | ((int32_t)d[4] << 4) | (d[5] >> 4);
  if (adcP == 0x80000 || adcT == 0x80000) return false;  // no measurement yet
  double v1 = (adcT / 16384.0 - digT1 / 1024.0) * digT2;
  double v2 = (adcT / 131072.0 - digT1 / 8192.0) * (adcT / 131072.0 - digT1 / 8192.0) * digT3;
  double tFine = v1 + v2;
  v1 = tFine / 2.0 - 64000.0;
  v2 = v1 * v1 * digP6 / 32768.0;
  v2 = v2 + v1 * digP5 * 2.0;
  v2 = v2 / 4.0 + digP4 * 65536.0;
  v1 = (digP3 * v1 * v1 / 524288.0 + digP2 * v1) / 524288.0;
  v1 = (1.0 + v1 / 32768.0) * digP1;
  if (v1 == 0) return false;
  double p = 1048576.0 - adcP;
  p = (p - v2 / 4096.0) * 6250.0 / v1;
  v1 = digP9 * p * p / 2147483648.0;
  v2 = p * digP8 / 32768.0;
  p = p + (v1 + v2 + digP7) / 16.0;
  hPa = p / 100.0;
  return hPa > 300 && hPa < 1100;
}

// ---------- AHT21: temperature and humidity ----------

// Aosong AHT21 datasheet, sensor reading process: send the trigger command
// 0xAC with its two parameters 0x33 0x00, wait at least 80 ms, then read six
// bytes with no register index. Byte 0 is the status (bit 7 set: still busy);
// bytes 1 to 5 hold two 20-bit values, humidity then temperature.
// Signal conversion: RH = S / 2^20 * 100 %, T = S / 2^20 * 200 - 50 C.

const uint8_t AHT_ADDR = 0x38;
const uint8_t AHT_TRIGGER[] = {0xAC, 0x33, 0x00};
const unsigned long AHT_MEASURE_MS = 85;  // the datasheet's 80 ms, with a margin
const double AHT_FULL_SCALE = 1048576.0;  // 2^20

bool ahtRead(float &celsius, float &percent) {
  if (!writeBytes(Wire, AHT_ADDR, AHT_TRIGGER, sizeof AHT_TRIGGER)) return false;
  delay(AHT_MEASURE_MS);
  uint8_t frame[6];
  if (!readBytes(Wire, AHT_ADDR, frame, sizeof frame)) return false;
  bool busy = frame[0] & 0x80;
  if (busy) return false;
  uint32_t humidityRaw = (uint32_t)frame[1] << 12 | (uint32_t)frame[2] << 4 | frame[3] >> 4;
  uint32_t temperatureRaw = (uint32_t)(frame[3] & 0x0F) << 16 | (uint32_t)frame[4] << 8 | frame[5];
  percent = humidityRaw / AHT_FULL_SCALE * 100.0;
  celsius = temperatureRaw / AHT_FULL_SCALE * 200.0 - 50.0;
  return true;
}

// ---------- ENS160: estimated CO2 and air quality ----------
// Written from the datasheet and never run: the part on this board does not
// answer. Its values are sent only when the part itself marks them valid
// (after its warm-up), and always as estimated, because it estimates CO2 from
// other gases.

uint8_t ensAddr = 0;

bool ensSetup() {
  ensAddr = findAddress(Wire, 0x53, 0x52);
  if (!ensAddr) return false;
  uint8_t id[2];
  if (!readRegs(Wire, ensAddr, 0x00, id, 2) || id[0] != 0x60 || id[1] != 0x01) return false;
  return writeReg(Wire, ensAddr, 0x10, 0x02);  // standard operating mode
}

bool ensRead(float &co2ppm, float &aqi) {
  uint8_t status, a, c[2];
  if (!readRegs(Wire, ensAddr, 0x20, &status, 1)) return false;
  if (((status >> 2) & 0x03) != 0) return false;  // warming up or invalid
  if (!readRegs(Wire, ensAddr, 0x21, &a, 1) || !readRegs(Wire, ensAddr, 0x24, c, 2)) return false;
  aqi = a & 0x07;
  co2ppm = c[0] | c[1] << 8;
  return true;
}

// ---------- MPU6050: vibration ----------

// MPU-6000/6050 register map: writing 0 to PWR_MGMT_1 (0x6B, section 4.28)
// takes the part out of sleep; ACCEL_XOUT_H (0x3B, section 4.17) starts six
// bytes, X, Y and Z, each a signed big-endian count. At the power-on range of
// +/-2 g, one g is 16384 counts.

const uint8_t MPU_ADDR = 0x68;
const uint8_t MPU_PWR_MGMT_1 = 0x6B, MPU_ACCEL_XOUT_H = 0x3B;
const float MPU_COUNTS_PER_G = 16384.0;

bool mpuReady = false;

bool mpuSetup() {
  return answers(Wire1, MPU_ADDR) && writeReg(Wire1, MPU_ADDR, MPU_PWR_MGMT_1, 0x00);
}

// Total acceleration, in g, from one sample of the three axes.
bool mpuMagnitude(float &g) {
  uint8_t axes[6];
  if (!readRegs(Wire1, MPU_ADDR, MPU_ACCEL_XOUT_H, axes, sizeof axes)) return false;
  float sumOfSquares = 0;
  for (int i = 0; i < 6; i += 2) {
    float a = (int16_t)(axes[i] << 8 | axes[i + 1]) / MPU_COUNTS_PER_G;
    sumOfSquares += a * a;
  }
  g = sqrtf(sumOfSquares);
  return true;
}

// ---------- Microphone: noise ----------

// Loudness over one short window: the swing between the lowest and the
// highest sample, in raw 12-bit counts.
int micSwing(unsigned long windowMs) {
  int lowest = 4095, highest = 0;
  for (unsigned long start = millis(); millis() - start < windowMs;) {
    int sample = analogRead(PIN_MIC);
    lowest = min(lowest, sample);
    highest = max(highest, sample);
  }
  return highest - lowest;
}

// ---------- Buzzer ----------

enum Buzz { BUZZ_OFF, BUZZ_ALARM };
Buzz buzz = BUZZ_OFF;
unsigned long alarmSince = 0;

void buzzerTick() {
  if (buzz != BUZZ_ALARM) return;
  if (millis() - alarmSince > 60000UL) { buzz = BUZZ_OFF; noTone(PIN_BUZZER); return; }
  // Half a second on, half a second off.
  if ((millis() - alarmSince) % 1000 < 500) tone(PIN_BUZZER, BUZZER_HZ); else noTone(PIN_BUZZER);
}

void handleCommand(const String &line) {
  if (line.indexOf("\"buzz\"") < 0) return;
  if (line.indexOf("\"alarm\"") >= 0) { buzz = BUZZ_ALARM; alarmSince = millis(); }
  else if (line.indexOf("\"beep\"") >= 0) { buzz = BUZZ_OFF; tone(PIN_BUZZER, BUZZER_HZ, 150); }
  else if (line.indexOf("\"off\"") >= 0) { buzz = BUZZ_OFF; noTone(PIN_BUZZER); }
}

String inbox;

void readCommands() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n') { handleCommand(inbox); inbox = ""; }
    else if (inbox.length() < 120) inbox += ch;
  }
}

// ---------- Bluetooth beacon ----------
// The Bluetooth stack runs in its own tasks on the other core, so the sensor
// loop and the serial lines below are not held up by it.

bool bleOn = false;

bool bleStart() {
  if (!BLEDevice::init(CHIP_ID)) return false;
  // A fixed transmit power, so the phone's signal thresholds mean the same thing every boot.
  BLEDevice::setPower(ESP_PWR_LVL_P3);
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  // Flags (3 bytes) + 128-bit service UUID (18) + "cabin-1" (9) = 30 of the 31 bytes.
  BLEAdvertisementData data;
  data.setFlags(0x06);  // general discoverable, no classic Bluetooth
  data.setCompleteServices(BLEUUID(ASTRUM_BLE_SERVICE));
  data.setName(CHIP_ID);
  adv->setAdvertisementData(data);
  adv->setScanResponse(false);
  adv->setAdvertisementType(ADV_TYPE_NONCONN_IND);  // a beacon: nothing connects
  adv->setMinInterval(160);  // 100 ms, in 0.625 ms steps
  adv->setMaxInterval(240);  // 150 ms
  return adv->start();
}

// ---------- Main loop ----------

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUZZER, OUTPUT);
  analogReadResolution(12);
  attachBus(Wire1, MOTION_PINS);
  delay(200);
  bleOn = bleStart();
  tone(PIN_BUZZER, BUZZER_HZ, 80);  // one short beep: the chip started
}

void loop() {
  // For one second: listen to the room, feel for vibration, keep the buzzer
  // and the hub's commands served.
  int noisePeak = 0;
  float sum = 0, sumSq = 0;
  int samples = 0;
  unsigned long cycleStart = millis();
  while (millis() - cycleStart < 900) {
    noisePeak = max(noisePeak, micSwing(40));

    if (!mpuReady) mpuReady = mpuSetup();
    float g;
    if (mpuReady) {
      if (mpuMagnitude(g)) { sum += g; sumSq += g * g; samples++; }
      else mpuReady = false;
    }
    readCommands();
    buzzerTick();
  }

  String readings = "";
  String missing = "";
  auto add = [&](const char *signal, float value, int decimals, const char *unit, const char *kind) {
    if (readings.length()) readings += ",";
    readings += "[\"" + String(signal) + "\"," + String(value, decimals) + ",\"" + unit + "\",\"" + kind + "\"]";
  };
  auto miss = [&](const char *signal) {
    if (missing.length()) missing += ",";
    missing += "\"" + String(signal) + "\"";
  };

  // Pressure. Set up again every cycle it is not answering.
  moveWire(PRESSURE_PINS);
  float hPa;
  if (bmpSetup() && (delay(10), bmpRead(hPa))) add("pressure", hPa, 1, "hPa", "m"); else miss("pressure");

  // Temperature, humidity, and the air sensor on the same board.
  moveWire(AIR_PINS);
  float celsius, percent;
  if (ahtRead(celsius, percent)) {
    add("temperature", celsius, 1, "C", "m");
    add("humidity", percent, 0, "%", "m");
  } else { miss("temperature"); miss("humidity"); }
  float co2, aqi;
  if ((ensAddr || ensSetup()) && ensRead(co2, aqi)) {
    add("co2", co2, 0, "ppm", "e");
    add("air_quality", aqi, 0, "index", "e");
  } else { ensAddr = 0; miss("co2"); miss("air_quality"); }

  // Noise and light are raw readings from 0 to 4095, not calibrated units.
  add("noise", noisePeak, 0, "raw", "m");
  add("light", analogRead(PIN_LDR), 0, "raw", "m");

  // Vibration: how much the acceleration shook during the second, in g.
  if (samples >= 5) {
    float mean = sum / samples;
    float variance = sumSq / samples - mean * mean;
    add("vibration", sqrtf(variance > 0 ? variance : 0), 4, "g", "m");
  } else miss("vibration");

  // Slots with no part fitted.
  miss("oxygen");
  miss("radiation");

  Serial.print("{\"chip\":\"");
  Serial.print(CHIP_ID);
  Serial.print("\",\"fw\":\"");
  Serial.print(FW);
  Serial.print("\",\"ble\":\"");
  Serial.print(bleOn ? "on" : "off");
  Serial.print("\",\"r\":[");
  Serial.print(readings);
  Serial.print("],\"missing\":[");
  Serial.print(missing);
  Serial.println("]}");
}
