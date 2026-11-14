// Astrum cabin chip. ESP32 DevKit, sensors on the pins listed in chip/README.md.
//
// Once a second it sends one line of JSON over USB serial (115200 baud):
//   {"chip":"cabin-1","fw":"0.1","r":[["pressure",1009.2,"hPa","m"],...],"missing":["co2"]}
// Each reading is [signal, value, unit, kind]; kind is "m" measured or "e" estimated.
// The chip never invents a value. A part that does not answer is listed in
// "missing" and probed again every cycle, so it is picked up the moment it answers.
//
// The hub can send a line back:
//   {"buzz":"alarm"}  repeating alarm tone, stops by itself after 60 s unless sent again
//   {"buzz":"beep"}   one short beep
//   {"buzz":"off"}

#include <Wire.h>

const char *CHIP_ID = "cabin-1";
const char *FW = "0.1";

const int PIN_MIC = 34, PIN_LDR = 35, PIN_BUZZER = 25;
const int BMP_SDA = 16, BMP_SCL = 15;   // pressure
const int AIR_SDA = 23, AIR_SCL = 22;   // AHT21 + ENS160 board
const int MPU_SDA = 4, MPU_SCL = 5;     // vibration, on the second I2C controller

// ---------- I2C helpers ----------

// The pressure board and the air board share the first controller, on
// different pins, so the bus is moved before talking to each.
void useBus(int sda, int scl) {
  Wire.end();
  Wire.begin(sda, scl);
  Wire.setTimeOut(20);
  delay(3);
}

bool ping(TwoWire &w, uint8_t addr) {
  w.beginTransmission(addr);
  return w.endTransmission() == 0;
}

bool readReg(TwoWire &w, uint8_t addr, uint8_t reg, uint8_t *buf, uint8_t n) {
  w.beginTransmission(addr);
  w.write(reg);
  if (w.endTransmission(false) != 0) return false;
  if (w.requestFrom(addr, n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = w.read();
  return true;
}

bool writeReg(TwoWire &w, uint8_t addr, uint8_t reg, uint8_t value) {
  w.beginTransmission(addr);
  w.write(reg);
  w.write(value);
  return w.endTransmission() == 0;
}

// ---------- BMP280: pressure ----------

uint8_t bmpAddr = 0;
uint16_t digT1, digP1;
int16_t digT2, digT3, digP2, digP3, digP4, digP5, digP6, digP7, digP8, digP9;

bool bmpSetup() {
  bmpAddr = ping(Wire, 0x76) ? 0x76 : (ping(Wire, 0x77) ? 0x77 : 0);
  if (!bmpAddr) return false;
  uint8_t c[24];
  if (!readReg(Wire, bmpAddr, 0x88, c, 24)) return false;
  digT1 = c[0] | c[1] << 8;   digT2 = c[2] | c[3] << 8;   digT3 = c[4] | c[5] << 8;
  digP1 = c[6] | c[7] << 8;   digP2 = c[8] | c[9] << 8;   digP3 = c[10] | c[11] << 8;
  digP4 = c[12] | c[13] << 8; digP5 = c[14] | c[15] << 8; digP6 = c[16] | c[17] << 8;
  digP7 = c[18] | c[19] << 8; digP8 = c[20] | c[21] << 8; digP9 = c[22] | c[23] << 8;
  // Normal mode, temperature and pressure sampled once each, light filtering.
  return writeReg(Wire, bmpAddr, 0xF5, 0x08) && writeReg(Wire, bmpAddr, 0xF4, 0x27);
}

// Bosch's compensation formula from the BMP280 datasheet. Result in hPa.
bool bmpRead(float &hPa) {
  uint8_t d[6];
  if (!readReg(Wire, bmpAddr, 0xF7, d, 6)) return false;
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

bool ahtRead(float &celsius, float &percent) {
  Wire.beginTransmission(0x38);
  Wire.write(0xAC); Wire.write(0x33); Wire.write(0x00);
  if (Wire.endTransmission() != 0) return false;
  delay(85);
  if (Wire.requestFrom((uint8_t)0x38, (uint8_t)6) != 6) return false;
  uint8_t b[6];
  for (int i = 0; i < 6; i++) b[i] = Wire.read();
  if (b[0] & 0x80) return false;  // still measuring
  percent = (((uint32_t)b[1] << 12) | ((uint32_t)b[2] << 4) | (b[3] >> 4)) * 100.0 / 1048576.0;
  celsius = ((((uint32_t)b[3] & 0x0F) << 16) | ((uint32_t)b[4] << 8) | b[5]) * 200.0 / 1048576.0 - 50.0;
  return true;
}

// ---------- ENS160: estimated CO2 and air quality ----------
// Written from the datasheet and never run: the part on this board does not
// answer. Its values are sent only when the part itself marks them valid
// (after its warm-up), and always as estimated, because it estimates CO2 from
// other gases.

uint8_t ensAddr = 0;

bool ensSetup() {
  ensAddr = ping(Wire, 0x53) ? 0x53 : (ping(Wire, 0x52) ? 0x52 : 0);
  if (!ensAddr) return false;
  uint8_t id[2];
  if (!readReg(Wire, ensAddr, 0x00, id, 2) || id[0] != 0x60 || id[1] != 0x01) return false;
  return writeReg(Wire, ensAddr, 0x10, 0x02);  // standard operating mode
}

bool ensRead(float &co2ppm, float &aqi) {
  uint8_t status, a, c[2];
  if (!readReg(Wire, ensAddr, 0x20, &status, 1)) return false;
  if (((status >> 2) & 0x03) != 0) return false;  // warming up or invalid
  if (!readReg(Wire, ensAddr, 0x21, &a, 1) || !readReg(Wire, ensAddr, 0x24, c, 2)) return false;
  aqi = a & 0x07;
  co2ppm = c[0] | c[1] << 8;
  return true;
}

// ---------- MPU6050: vibration ----------

bool mpuReady = false;

bool mpuSetup() {
  return ping(Wire1, 0x68) && writeReg(Wire1, 0x68, 0x6B, 0x00);  // wake up
}

bool mpuMagnitude(float &g) {
  uint8_t d[6];
  if (!readReg(Wire1, 0x68, 0x3B, d, 6)) return false;
  float x = (int16_t)(d[0] << 8 | d[1]) / 16384.0;
  float y = (int16_t)(d[2] << 8 | d[3]) / 16384.0;
  float z = (int16_t)(d[4] << 8 | d[5]) / 16384.0;
  g = sqrtf(x * x + y * y + z * z);
  return true;
}

// ---------- Buzzer ----------

enum Buzz { BUZZ_OFF, BUZZ_ALARM };
Buzz buzz = BUZZ_OFF;
unsigned long alarmSince = 0;

void buzzerTick() {
  if (buzz != BUZZ_ALARM) return;
  if (millis() - alarmSince > 60000UL) { buzz = BUZZ_OFF; noTone(PIN_BUZZER); return; }
  // Half a second on, half a second off.
  if ((millis() - alarmSince) % 1000 < 500) tone(PIN_BUZZER, 2000); else noTone(PIN_BUZZER);
}

void handleCommand(const String &line) {
  if (line.indexOf("\"buzz\"") < 0) return;
  if (line.indexOf("\"alarm\"") >= 0) { buzz = BUZZ_ALARM; alarmSince = millis(); }
  else if (line.indexOf("\"beep\"") >= 0) { buzz = BUZZ_OFF; tone(PIN_BUZZER, 2000, 150); }
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

// ---------- Main loop ----------

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUZZER, OUTPUT);
  analogReadResolution(12);
  Wire1.begin(MPU_SDA, MPU_SCL);
  Wire1.setTimeOut(20);
  delay(200);
  tone(PIN_BUZZER, 2000, 80);  // one short beep: the chip started
}

void loop() {
  // For one second: listen to the room, feel for vibration, keep the buzzer
  // and the hub's commands served.
  int noisePeak = 0;
  float sum = 0, sumSq = 0;
  int samples = 0;
  unsigned long cycleStart = millis();
  while (millis() - cycleStart < 900) {
    int lo = 4095, hi = 0;
    unsigned long windowStart = millis();
    while (millis() - windowStart < 40) {
      int v = analogRead(PIN_MIC);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo > noisePeak) noisePeak = hi - lo;

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
  useBus(BMP_SDA, BMP_SCL);
  float hPa;
  if (bmpSetup() && (delay(10), bmpRead(hPa))) add("pressure", hPa, 1, "hPa", "m"); else miss("pressure");

  // Temperature, humidity, and the air sensor on the same board.
  useBus(AIR_SDA, AIR_SCL);
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

  Serial.print("{\"chip\":\"");
  Serial.print(CHIP_ID);
  Serial.print("\",\"fw\":\"");
  Serial.print(FW);
  Serial.print("\",\"r\":[");
  Serial.print(readings);
  Serial.print("],\"missing\":[");
  Serial.print(missing);
  Serial.println("]}");
}
