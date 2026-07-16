#include <Arduino.h>
#include <ArduinoJson.h>
#include <TinyGsmClient.h>
#include <Preferences.h>          // ESP32 NVS flash storage
#include <esp_task_wdt.h>         // Hardware watchdog timer
#include "secrets.h"              // Credentials — NOT committed to git

// ─────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────
#define APN           "internet"   // SIM APN (Smart/Globe/DITO)
#define DEVICE_ID     "TRUCK-001"

// Timing
#define GPS_INTERVAL_MS       15000   // GPS poll interval
#define LTE_CONNECT_TIMEOUT_MS 60000  // APN connect timeout
#define WDT_TIMEOUT_S           120   // Watchdog: reset if hung >2 min
#define UPLOAD_FAIL_REBOOT_LIMIT  10  // Reboot after N consecutive failures

// Flash queue settings
#define FLASH_NS          "gpsq"      // NVS namespace
#define FLASH_KEY_COUNT   "count"     // NVS key: number of stored records
#define FLASH_MAX_RECORDS  200        // Max records in flash (≈ 50 min offline)

// ─────────────────────────────────────────────────────────────
// Hardware Pins — LILYGO T-Call A7670E
// ─────────────────────────────────────────────────────────────
#define MODEM_TX      27
#define MODEM_RX      26
#define MODEM_PWRKEY   4
#define MODEM_DTR     32
#define MODEM_RI      33
#define MODEM_FLIGHT  25
#define MODEM_STATUS  34
#define BAT_ADC       35

// ─────────────────────────────────────────────────────────────
// Global Objects
// ─────────────────────────────────────────────────────────────
HardwareSerial       SerialAT(1);
TinyGsm              modem(SerialAT);
TinyGsmClientSecure  secureClient(modem);
Preferences          prefs;           // NVS flash storage handle

struct GPSRecord {
  float lat, lon, speed_kmh, heading_deg, hdop;
  int   satellites, battery_pct;
  bool  gps_fix;
  int   year, month, day, hour, min, sec;
};

// Inter-task communication
QueueHandle_t  gpsQueue;
volatile int   consecutiveFailures = 0;

// Function prototypes
void  TaskGPSManager(void *pvParameters);
void  TaskLTEManager(void *pvParameters);
void  modemPowerOn();
int   readBatteryPercentage();
bool  ensureNetwork();
void  buildTimestamp(const GPSRecord &r, char *buf, size_t len);
bool  uploadRecord(const GPSRecord &r);
// Flash queue
void  flashSave(const GPSRecord &r);
bool  flashLoad(GPSRecord &out);
void  flashPop();
int   flashCount();

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(50);
  Serial.println("[BOOT] GarbageTrack GPS v3 — Starting");

  // ── Watchdog ─────────────────────────────────────────────
  esp_task_wdt_init(WDT_TIMEOUT_S, true);   // panic on timeout
  esp_task_wdt_add(NULL);                   // watch setup task

  // ── Queue ────────────────────────────────────────────────
  gpsQueue = xQueueCreate(20, sizeof(GPSRecord));
  if (!gpsQueue) {
    Serial.println("[BOOT] FATAL: Queue creation failed");
    esp_restart();
  }

  // ── NVS flash ────────────────────────────────────────────
  prefs.begin(FLASH_NS, false);
  int saved = flashCount();
  if (saved > 0) {
    Serial.printf("[BOOT] Flash: %d records from previous session\n", saved);
  }

  // ── Modem ────────────────────────────────────────────────
  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  modemPowerOn();

  esp_task_wdt_reset();

  // ── FreeRTOS tasks ───────────────────────────────────────
  xTaskCreatePinnedToCore(TaskGPSManager, "GPSManager", 4096, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(TaskLTEManager, "LTEManager", 8192, NULL, 2, NULL, 1);

  esp_task_wdt_delete(NULL);  // remove setup task from watchdog
}

void loop() {
  vTaskDelay(pdMS_TO_TICKS(1000));
}

// ─────────────────────────────────────────────────────────────
// Modem Power-On Sequence
// ─────────────────────────────────────────────────────────────
void modemPowerOn() {
  pinMode(MODEM_PWRKEY, OUTPUT);
  digitalWrite(MODEM_PWRKEY, LOW);  delay(100);
  digitalWrite(MODEM_PWRKEY, HIGH); delay(1000);
  digitalWrite(MODEM_PWRKEY, LOW);
  Serial.println("[BOOT] Modem power-on complete");
}

// ─────────────────────────────────────────────────────────────
// Battery Percentage (ADC → voltage → percentage)
// ─────────────────────────────────────────────────────────────
int readBatteryPercentage() {
  int   raw  = analogRead(BAT_ADC);
  float volt = (raw / 4095.0f) * 3.3f * 2.0f;
  int   pct  = (int)((volt - 3.2f) / (4.2f - 3.2f) * 100.0f);
  return constrain(pct, 0, 100);
}

// ─────────────────────────────────────────────────────────────
// ISO-8601 UTC Timestamp from GNSS fields
// ─────────────────────────────────────────────────────────────
void buildTimestamp(const GPSRecord &r, char *buf, size_t len) {
  snprintf(buf, len, "%04d-%02d-%02dT%02d:%02d:%02dZ",
           r.year, r.month, r.day, r.hour, r.min, r.sec);
}

// ─────────────────────────────────────────────────────────────
// Network: ensure LTE registration + GPRS data context
// ─────────────────────────────────────────────────────────────
bool ensureNetwork() {
  if (!modem.isNetworkConnected()) {
    Serial.println("[LTE] Waiting for network...");
    if (!modem.waitForNetwork(LTE_CONNECT_TIMEOUT_MS, true)) {
      Serial.println("[LTE] Network timeout");
      return false;
    }
  }
  if (!modem.isGprsConnected()) {
    Serial.println("[LTE] Connecting GPRS...");
    if (!modem.gprsConnect(APN, "", "")) {
      Serial.println("[LTE] GPRS failed");
      return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// Flash Queue — NVS-backed persistent ring buffer
// Keys: "r000", "r001", ... "r199" (record slots)
//       "head" (oldest record index), "count" (number stored)
// ─────────────────────────────────────────────────────────────
int flashCount() {
  return prefs.getInt(FLASH_KEY_COUNT, 0);
}

void flashSave(const GPSRecord &r) {
  int  count = prefs.getInt(FLASH_KEY_COUNT, 0);
  int  head  = prefs.getInt("head", 0);
  if (count >= FLASH_MAX_RECORDS) {
    // Overwrite oldest record (circular)
    head = (head + 1) % FLASH_MAX_RECORDS;
    prefs.putInt("head", head);
    count = FLASH_MAX_RECORDS - 1;
  }
  int slot = (head + count) % FLASH_MAX_RECORDS;
  char key[8]; snprintf(key, sizeof(key), "r%03d", slot);

  // Serialize record to compact JSON string for NVS
  char buf[256];
  snprintf(buf, sizeof(buf),
           "{\"la\":%.6f,\"lo\":%.6f,\"sp\":%.1f,\"bp\":%d,\"fx\":%d,"
           "\"yr\":%d,\"mo\":%d,\"dy\":%d,\"hr\":%d,\"mn\":%d,\"sc\":%d}",
           r.lat, r.lon, r.speed_kmh, r.battery_pct, r.gps_fix ? 1 : 0,
           r.year, r.month, r.day, r.hour, r.min, r.sec);

  prefs.putString(key, buf);
  prefs.putInt(FLASH_KEY_COUNT, count + 1);
  Serial.printf("[FLASH] Saved slot %d (%d total)\n", slot, count + 1);
}

bool flashLoad(GPSRecord &out) {
  int count = prefs.getInt(FLASH_KEY_COUNT, 0);
  if (count == 0) return false;

  int  head = prefs.getInt("head", 0);
  char key[8]; snprintf(key, sizeof(key), "r%03d", head);
  String raw = prefs.getString(key, "");
  if (raw.isEmpty()) return false;

  // Deserialize
  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, raw) != DeserializationError::Ok) return false;

  out.lat        = doc["la"] | 0.0f;
  out.lon        = doc["lo"] | 0.0f;
  out.speed_kmh  = doc["sp"] | 0.0f;
  out.battery_pct= doc["bp"] | 0;
  out.gps_fix    = (doc["fx"] | 0) == 1;
  out.year       = doc["yr"] | 2026;
  out.month      = doc["mo"] | 1;
  out.day        = doc["dy"] | 1;
  out.hour       = doc["hr"] | 0;
  out.min        = doc["mn"] | 0;
  out.sec        = doc["sc"] | 0;
  return true;
}

void flashPop() {
  int count = prefs.getInt(FLASH_KEY_COUNT, 0);
  if (count == 0) return;
  int head  = prefs.getInt("head", 0);
  char key[8]; snprintf(key, sizeof(key), "r%03d", head);
  prefs.remove(key);
  prefs.putInt("head", (head + 1) % FLASH_MAX_RECORDS);
  prefs.putInt(FLASH_KEY_COUNT, count - 1);
}

// ─────────────────────────────────────────────────────────────
// HTTP Upload — POST one record to Supabase ingest function
// Returns true on HTTP 200/201
// ─────────────────────────────────────────────────────────────
bool uploadRecord(const GPSRecord &r) {
  char ts[32];
  buildTimestamp(r, ts, sizeof(ts));

  StaticJsonDocument<384> doc;
  JsonArray arr = doc.to<JsonArray>();
  JsonObject obj = arr.createNestedObject();
  obj["device_id"]   = DEVICE_ID;
  obj["timestamp"]   = ts;
  obj["lat"]         = r.lat;
  obj["lon"]         = r.lon;
  obj["speed_kmh"]   = r.speed_kmh;
  obj["heading_deg"] = r.heading_deg;
  obj["hdop"]        = r.hdop;
  obj["satellites"]  = r.satellites;
  obj["battery_pct"] = r.battery_pct;
  obj["gps_fix"]     = r.gps_fix;

  String payload;
  serializeJson(doc, payload);

  if (!secureClient.connect(SUPABASE_HOST, 443)) {
    Serial.println("[LTE] TCP connect failed");
    return false;
  }

  secureClient.println("POST /functions/v1/ingest HTTP/1.1");
  secureClient.println("Host: " + String(SUPABASE_HOST));
  secureClient.println("Content-Type: application/json");
  secureClient.println("X-Device-ID: " DEVICE_ID);
  secureClient.println("X-API-Key: " DEVICE_API_KEY);
  secureClient.print("Content-Length: ");
  secureClient.println(payload.length());
  secureClient.println("Connection: close");
  secureClient.println();
  secureClient.print(payload);

  // Read response status line
  unsigned long deadline = millis() + 10000UL;
  String status;
  while (secureClient.connected() && millis() < deadline) {
    if (secureClient.available()) {
      status = secureClient.readStringUntil('\n');
      status.trim();
      break;
    }
  }
  secureClient.stop();
  Serial.println("[LTE] Response: " + status);
  return status.indexOf("200") >= 0 || status.indexOf("201") >= 0;
}

// ─────────────────────────────────────────────────────────────
// Task: GPS Manager
// Polls integrated GNSS every GPS_INTERVAL_MS.
// On valid fix → queue; if queue full → write to flash.
// On no fix → still sends heartbeat to detect offline mode.
// ─────────────────────────────────────────────────────────────
void TaskGPSManager(void *pvParameters) {
  esp_task_wdt_add(NULL);

  vTaskDelay(pdMS_TO_TICKS(8000));  // Let modem initialize first
  Serial.println("[GPS] Enabling integrated GNSS...");
  modem.enableGPS();
  vTaskDelay(pdMS_TO_TICKS(2000));

  TickType_t lastPoll = xTaskGetTickCount();
  const TickType_t pollInterval = pdMS_TO_TICKS(GPS_INTERVAL_MS);

  for (;;) {
    esp_task_wdt_reset();

    if ((xTaskGetTickCount() - lastPoll) >= pollInterval) {
      GPSRecord rec = {};
      float lat=0, lon=0, speed=0, alt=0, acc=0;
      int vsat=0, usat=0;

      bool fix = modem.getGPS(&lat, &lon, &speed, &alt,
                               &vsat, &usat, &acc,
                               &rec.year, &rec.month, &rec.day,
                               &rec.hour, &rec.min, &rec.sec);

      rec.lat         = lat;
      rec.lon         = lon;
      rec.speed_kmh   = speed;
      rec.heading_deg = 0;   // A7670 basic API doesn't expose heading
      rec.hdop        = acc;
      rec.satellites  = usat;
      rec.battery_pct = readBatteryPercentage();
      rec.gps_fix     = fix && (lat != 0.0f) && (lon != 0.0f);

      if (rec.gps_fix) {
        Serial.printf("[GPS] Fix: %.6f, %.6f | spd:%.1fkm/h | bat:%d%%\n",
                      lat, lon, speed, rec.battery_pct);
      } else {
        Serial.printf("[GPS] No fix (sats visible:%d used:%d)\n", vsat, usat);
      }

      // Try RAM queue first; fall back to flash
      if (xQueueSend(gpsQueue, &rec, 0) != pdPASS) {
        Serial.println("[GPS] RAM queue full → writing to flash");
        flashSave(rec);
      }

      lastPoll = xTaskGetTickCount();
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

// ─────────────────────────────────────────────────────────────
// Task: LTE Manager
// Priority order: drain flash records first, then live queue.
// ─────────────────────────────────────────────────────────────
void TaskLTEManager(void *pvParameters) {
  esp_task_wdt_add(NULL);

  Serial.println("[LTE] Restarting modem...");
  modem.restart();
  delay(3000);
  Serial.println("[LTE] Modem: " + modem.getModemInfo());

  secureClient.setInsecure();  // TODO: add setCACert() for production

  int backoffMs    = 5000;    // Exponential backoff seed
  const int maxMs  = 120000;  // Cap at 2 minutes

  for (;;) {
    esp_task_wdt_reset();

    if (!ensureNetwork()) {
      Serial.printf("[LTE] Retrying in %dms\n", backoffMs);
      vTaskDelay(pdMS_TO_TICKS(backoffMs));
      backoffMs = min(backoffMs * 2, maxMs);  // exponential backoff
      continue;
    }
    backoffMs = 5000;  // reset backoff on success

    // ── Drain flash records first (offline buffer) ──────────
    GPSRecord rec;
    bool uploaded = false;
    while (flashCount() > 0) {
      esp_task_wdt_reset();
      if (!flashLoad(rec)) break;
      Serial.printf("[LTE] Uploading flash record (%d remaining)...\n",
                    flashCount());
      if (uploadRecord(rec)) {
        flashPop();
        consecutiveFailures = 0;
        uploaded = true;
      } else {
        consecutiveFailures++;
        Serial.printf("[LTE] Flash upload failed (failures: %d)\n",
                      consecutiveFailures);
        if (consecutiveFailures >= UPLOAD_FAIL_REBOOT_LIMIT) {
          Serial.println("[LTE] Too many failures — rebooting");
          esp_restart();
        }
        break;  // Wait for next cycle
      }
      vTaskDelay(pdMS_TO_TICKS(500));  // Short pause between records
    }

    // ── Then drain live RAM queue ───────────────────────────
    if (xQueueReceive(gpsQueue, &rec, pdMS_TO_TICKS(uploaded ? 100 : 5000)) == pdPASS) {
      Serial.println("[LTE] Uploading live record...");
      if (uploadRecord(rec)) {
        consecutiveFailures = 0;
        Serial.println("[LTE] Upload OK");
      } else {
        consecutiveFailures++;
        Serial.println("[LTE] Upload failed — saving to flash");
        flashSave(rec);  // Preserve the record in flash for next cycle
        if (consecutiveFailures >= UPLOAD_FAIL_REBOOT_LIMIT) {
          Serial.println("[LTE] Too many failures — rebooting");
          esp_restart();
        }
      }
    }
  }
}
