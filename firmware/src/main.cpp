#include <Arduino.h>
#include <ArduinoJson.h>
#include <TinyGsmClient.h>
#include <time.h>

// ─────────────────────────────────────────────────────────────
// CONFIGURATION — replace these with your real values
// ─────────────────────────────────────────────────────────────
#define APN           "internet"          // Your SIM's APN (Smart/Globe/Dito)
#define DEVICE_ID     "TRUCK-001"

// Your Supabase project ref (e.g. "abcxyz123.supabase.co")
// Do NOT include "https://"
#define SUPABASE_HOST  "YOUR_PROJECT_REF.supabase.co"

// Your Supabase SERVICE ROLE key (not anon key).
// The service role key bypasses RLS — keep it secret and
// never expose it in client-side code.
#define SUPABASE_SERVICE_KEY "your-service-role-key-here"

// ─────────────────────────────────────────────────────────────
// Hardware Pins — LILYGO T-Call A7670E
// ─────────────────────────────────────────────────────────────
#define MODEM_TX      27
#define MODEM_RX      26
#define MODEM_PWRKEY  4
#define MODEM_DTR     32
#define MODEM_RI      33
#define MODEM_FLIGHT  25
#define MODEM_STATUS  34
#define BAT_ADC       35

// ─────────────────────────────────────────────────────────────
// Upload / GPS intervals
// ─────────────────────────────────────────────────────────────
#define GPS_POLL_INTERVAL_MS   15000   // Poll GPS every 15 s
#define LTE_CONNECT_TIMEOUT_MS 60000   // APN connect timeout

// ─────────────────────────────────────────────────────────────
// Global Objects
// ─────────────────────────────────────────────────────────────
HardwareSerial SerialAT(1);
TinyGsm              modem(SerialAT);
TinyGsmClientSecure  secureClient(modem);

struct GPSRecord {
  float lat;
  float lon;
  float speed_kmh;
  float heading_deg;
  float hdop;
  int   satellites;
  int   battery_pct;
  bool  gps_fix;
  // Timestamp from GNSS (UTC)
  int   year, month, day, hour, min, sec;
};

QueueHandle_t gpsQueue;
TaskHandle_t  GPSManagerTaskHandle;
TaskHandle_t  LTEManagerTaskHandle;

// ─────────────────────────────────────────────────────────────
// Function prototypes
// ─────────────────────────────────────────────────────────────
void TaskGPSManager(void *pvParameters);
void TaskLTEManager(void *pvParameters);
void modemPowerOn();
int  readBatteryPercentage();
bool ensureNetwork();
void buildTimestamp(const GPSRecord &r, char *buf, size_t bufLen);

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(50);
  Serial.println("[BOOT] GarbageTrack GPS System v2 — Starting...");

  gpsQueue = xQueueCreate(20, sizeof(GPSRecord));
  if (!gpsQueue) {
    Serial.println("[BOOT] FATAL: Could not create GPS queue");
    while (true) delay(1000);
  }

  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  modemPowerOn();

  xTaskCreatePinnedToCore(TaskGPSManager, "GPSManager", 4096, NULL, 1,
                          &GPSManagerTaskHandle, 1);
  xTaskCreatePinnedToCore(TaskLTEManager, "LTEManager", 8192, NULL, 2,
                          &LTEManagerTaskHandle, 1);
}

void loop() {
  // All work is done in FreeRTOS tasks
  vTaskDelay(pdMS_TO_TICKS(1000));
}

// ─────────────────────────────────────────────────────────────
// Modem power-on sequence (A7670E)
// ─────────────────────────────────────────────────────────────
void modemPowerOn() {
  pinMode(MODEM_PWRKEY, OUTPUT);
  digitalWrite(MODEM_PWRKEY, LOW);
  delay(100);
  digitalWrite(MODEM_PWRKEY, HIGH);
  delay(1000);
  digitalWrite(MODEM_PWRKEY, LOW);
  Serial.println("[BOOT] Modem power-on sequence complete");
}

// ─────────────────────────────────────────────────────────────
// Battery: read ADC, convert to percentage
// ─────────────────────────────────────────────────────────────
int readBatteryPercentage() {
  int   raw     = analogRead(BAT_ADC);
  float voltage = (raw / 4095.0f) * 3.3f * 2.0f;
  int   pct     = (int)((voltage - 3.2f) / (4.2f - 3.2f) * 100.0f);
  return constrain(pct, 0, 100);
}

// ─────────────────────────────────────────────────────────────
// Build ISO-8601 timestamp from GNSS fields
// e.g. "2026-07-17T12:34:56Z"
// ─────────────────────────────────────────────────────────────
void buildTimestamp(const GPSRecord &r, char *buf, size_t bufLen) {
  snprintf(buf, bufLen, "%04d-%02d-%02dT%02d:%02d:%02dZ",
           r.year, r.month, r.day, r.hour, r.min, r.sec);
}

// ─────────────────────────────────────────────────────────────
// Ensure LTE network + GPRS are connected.
// Returns true when ready.
// ─────────────────────────────────────────────────────────────
bool ensureNetwork() {
  if (!modem.isNetworkConnected()) {
    Serial.println("[LTE] Waiting for network registration...");
    if (!modem.waitForNetwork(LTE_CONNECT_TIMEOUT_MS, true)) {
      Serial.println("[LTE] Network registration timed out");
      return false;
    }
  }
  if (!modem.isGprsConnected()) {
    Serial.println("[LTE] Connecting to APN: " APN);
    if (!modem.gprsConnect(APN, "", "")) {
      Serial.println("[LTE] GPRS connect failed");
      return false;
    }
    Serial.println("[LTE] GPRS connected");
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// Task: GPS Manager
// Polls the A7670E's integrated GNSS every GPS_POLL_INTERVAL_MS
// and pushes valid fixes onto the queue.
// ─────────────────────────────────────────────────────────────
void TaskGPSManager(void *pvParameters) {
  // Give the LTE manager time to initialize the modem first
  vTaskDelay(pdMS_TO_TICKS(8000));

  Serial.println("[GPS] Enabling integrated GNSS...");
  modem.enableGPS();
  vTaskDelay(pdMS_TO_TICKS(2000)); // brief warm-up

  TickType_t lastSend = xTaskGetTickCount();
  const TickType_t interval = pdMS_TO_TICKS(GPS_POLL_INTERVAL_MS);

  for (;;) {
    if ((xTaskGetTickCount() - lastSend) >= interval) {
      GPSRecord record = {};

      float lat = 0, lon = 0, speed = 0, alt = 0, accuracy = 0;
      int   vsat = 0, usat = 0;

      bool fix = modem.getGPS(&lat, &lon, &speed, &alt,
                               &vsat, &usat, &accuracy,
                               &record.year, &record.month, &record.day,
                               &record.hour, &record.min, &record.sec);

      if (fix && lat != 0.0f && lon != 0.0f) {
        record.lat         = lat;
        record.lon         = lon;
        record.speed_kmh   = speed;
        record.heading_deg = 0; // A7670 basic GNSS API does not expose heading
        record.hdop        = accuracy;
        record.satellites  = usat;
        record.battery_pct = readBatteryPercentage();
        record.gps_fix     = true;

        if (xQueueSend(gpsQueue, &record, 0) == pdPASS) {
          Serial.printf("[GPS] Fix queued — %.6f, %.6f  spd:%.1f  bat:%d%%\n",
                        lat, lon, speed, record.battery_pct);
        } else {
          Serial.println("[GPS] Queue full — dropping record");
        }
      } else {
        // Still send a heartbeat with gps_fix=false so the dashboard
        // knows the device is alive but searching.
        record.battery_pct = readBatteryPercentage();
        record.gps_fix     = false;
        // Use epoch time fields zeroed — dashboard will display "Searching"
        xQueueSend(gpsQueue, &record, 0);
        Serial.printf("[GPS] No fix yet (sats: %d/%d)\n", usat, vsat);
      }

      lastSend = xTaskGetTickCount();
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

// ─────────────────────────────────────────────────────────────
// Task: LTE Manager
// Drains the GPS queue and POSTs each record to Supabase Edge
// Function /functions/v1/ingest using the SERVICE ROLE key.
// ─────────────────────────────────────────────────────────────
void TaskLTEManager(void *pvParameters) {
  Serial.println("[LTE] Restarting modem...");
  modem.restart();
  delay(3000);

  String info = modem.getModemInfo();
  Serial.println("[LTE] Modem: " + info);

  // NOTE: setInsecure() skips cert validation.
  // For production, supply the Supabase root CA with setCACert().
  secureClient.setInsecure();

  for (;;) {
    if (!ensureNetwork()) {
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }

    GPSRecord record;
    if (xQueueReceive(gpsQueue, &record, pdMS_TO_TICKS(5000)) != pdPASS) {
      continue; // Nothing in queue yet
    }

    // Build ISO-8601 timestamp
    char tsBuffer[32];
    buildTimestamp(record, tsBuffer, sizeof(tsBuffer));

    // Serialize payload
    StaticJsonDocument<512> doc;
    JsonArray arr = doc.to<JsonArray>();
    JsonObject obj = arr.createNestedObject();
    obj["device_id"]   = DEVICE_ID;
    obj["timestamp"]   = tsBuffer;
    obj["lat"]         = record.lat;
    obj["lon"]         = record.lon;
    obj["speed_kmh"]   = record.speed_kmh;
    obj["heading_deg"] = record.heading_deg;
    obj["hdop"]        = record.hdop;
    obj["satellites"]  = record.satellites;
    obj["battery_pct"] = record.battery_pct;
    obj["gps_fix"]     = record.gps_fix;

    String payload;
    serializeJson(doc, payload);

    Serial.println("[LTE] Uploading to Supabase...");

    if (secureClient.connect(SUPABASE_HOST, 443)) {
      secureClient.println("POST /functions/v1/ingest HTTP/1.1");
      secureClient.println("Host: " + String(SUPABASE_HOST));
      secureClient.println("Content-Type: application/json");
      secureClient.println("Authorization: Bearer " SUPABASE_SERVICE_KEY);
      secureClient.print("Content-Length: ");
      secureClient.println(payload.length());
      secureClient.println("Connection: close");
      secureClient.println();
      secureClient.print(payload);

      // Read response (with 10 s timeout)
      unsigned long deadline = millis() + 10000UL;
      bool headersDone = false;
      String statusLine;
      while (secureClient.connected() && millis() < deadline) {
        while (secureClient.available()) {
          String line = secureClient.readStringUntil('\n');
          line.trim();
          if (!headersDone) {
            if (statusLine.isEmpty()) statusLine = line;
            if (line.isEmpty()) headersDone = true;
          } else {
            Serial.println("[LTE] Body: " + line);
          }
          deadline = millis() + 5000UL; // extend while receiving
        }
      }
      secureClient.stop();
      Serial.println("[LTE] Response: " + statusLine);
      if (statusLine.indexOf("200") >= 0 || statusLine.indexOf("201") >= 0) {
        Serial.println("[LTE] Upload OK");
      } else {
        Serial.println("[LTE] Upload error — will retry next interval");
      }
    } else {
      Serial.println("[LTE] TCP connect to Supabase failed");
    }
  }
}
