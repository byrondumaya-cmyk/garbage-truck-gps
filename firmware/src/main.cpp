#include <Arduino.h>
#include <ArduinoJson.h>
#include <TinyGsmClient.h>

// --- Configuration ---
#define APN "internet" // Update based on local telecom provider
#define DEVICE_ID "TRUCK-001"
#define API_KEY "dummy-preview-anon-key-12345"
#define SUPABASE_URL "dummy-preview-project.supabase.co"

// --- Hardware Pins (LILYGO T-Call A7670) ---
#define MODEM_TX 27
#define MODEM_RX 26
#define MODEM_PWRKEY 4
#define MODEM_DTR 32
#define MODEM_RI 33
#define MODEM_FLIGHT 25
#define MODEM_STATUS 34
#define BAT_ADC 35

// --- Global Objects ---
HardwareSerial SerialAT(1);
TinyGsm modem(SerialAT);
TinyGsmClientSecure client(modem);

// --- RTOS Data Structures ---
struct GPSRecord {
  float lat;
  float lon;
  float speed_kmh;
  float heading_deg;
  float hdop;
  int satellites;
  int battery_pct;
  bool gps_fix;
};

QueueHandle_t gpsQueue;
TaskHandle_t GPSManagerTaskHandle;
TaskHandle_t LTEManagerTaskHandle;

// Function prototypes
void TaskGPSManager(void *pvParameters);
void TaskLTEManager(void *pvParameters);
void modemPowerOn();
int readBatteryPercentage();

void setup() {
  Serial.begin(115200);
  delay(10);
  Serial.println("Garbage Truck GPS Tracking System - Starting...");

  // Initialize Queues (buffer up to 20 records)
  gpsQueue = xQueueCreate(20, sizeof(GPSRecord));

  // Initialize Hardware
  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);

  modemPowerOn();

  // Initialize FreeRTOS Tasks
  xTaskCreatePinnedToCore(TaskGPSManager, "GPSManager", 4096, NULL, 1,
                          &GPSManagerTaskHandle, 1);
  xTaskCreatePinnedToCore(TaskLTEManager, "LTEManager", 8192, NULL, 2,
                          &LTEManagerTaskHandle, 1);
}

void modemPowerOn() {
  pinMode(MODEM_PWRKEY, OUTPUT);
  digitalWrite(MODEM_PWRKEY, LOW);
  delay(100);
  digitalWrite(MODEM_PWRKEY, HIGH);
  delay(1000);
  digitalWrite(MODEM_PWRKEY, LOW);
  Serial.println("Modem powered on.");
}

int readBatteryPercentage() {
  int raw = analogRead(BAT_ADC);
  float voltage = (raw / 4095.0) * 3.3 * 2.0;
  int pct = map(voltage * 100, 320, 420, 0, 100);
  if (pct > 100)
    return 100;
  if (pct < 0)
    return 0;
  return pct;
}

void loop() { vTaskDelay(pdMS_TO_TICKS(1000)); }

void TaskGPSManager(void *pvParameters) {
  GPSRecord record;
  TickType_t lastSendTime = xTaskGetTickCount();
  const TickType_t sendInterval = pdMS_TO_TICKS(15000); // 15 seconds

  // Wait for modem to initialize before turning on GPS
  vTaskDelay(pdMS_TO_TICKS(5000));
  Serial.println("[GPS] Enabling Integrated Modem GPS...");
  modem.enableGPS();

  for (;;) {
    if (xTaskGetTickCount() - lastSendTime >= sendInterval) {

      float lat = 0, lon = 0, speed = 0, alt = 0, accuracy = 0;
      int vsat = 0, usat = 0;
      int year = 0, month = 0, day = 0, hour = 0, min = 0, sec = 0;

      // Query the modem's integrated GNSS module
      bool fix = modem.getGPS(&lat, &lon, &speed, &alt, &vsat, &usat, &accuracy,
                              &year, &month, &day, &hour, &min, &sec);

      if (fix && lat != 0.0) {
        record.lat = lat;
        record.lon = lon;
        record.speed_kmh = speed;
        record.heading_deg = 0; // A7670 GPS doesn't easily expose heading via
                                // basic TinyGSM getGPS
        record.hdop = accuracy;
        record.satellites = usat;
        record.battery_pct = readBatteryPercentage();
        record.gps_fix = true;

        if (xQueueSend(gpsQueue, &record, 0) != pdPASS) {
          Serial.println("[GPS] Queue Full! Dropping record.");
        } else {
          Serial.printf("[GPS] Queued Fix: %f, %f\n", record.lat, record.lon);
        }
      } else {
        Serial.println("[GPS] No valid fix from modem yet.");
      }
      lastSendTime = xTaskGetTickCount();
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

void TaskLTEManager(void *pvParameters) {
  Serial.println("[LTE] Initializing modem...");

  if (!modem.restart()) {
    Serial.println("[LTE] Failed to restart modem");
  }

  String modemInfo = modem.getModemInfo();
  Serial.print("[LTE] Modem Info: ");
  Serial.println(modemInfo);

  client.setInsecure(); // Disable SSL validation for testing

  for (;;) {
    if (!modem.isNetworkConnected()) {
      Serial.println("[LTE] Waiting for network...");
      if (!modem.waitForNetwork(600000L, true)) {
        vTaskDelay(pdMS_TO_TICKS(5000));
        continue;
      }
    }

    if (!modem.isGprsConnected()) {
      Serial.println("[LTE] Connecting to APN...");
      if (!modem.gprsConnect(APN, "", "")) {
        vTaskDelay(pdMS_TO_TICKS(5000));
        continue;
      }
    }

    GPSRecord record;
    if (xQueueReceive(gpsQueue, &record, pdMS_TO_TICKS(5000)) == pdPASS) {
      Serial.println("[LTE] Uploading data to Supabase...");

      StaticJsonDocument<512> doc;
      JsonArray array = doc.to<JsonArray>();
      JsonObject obj = array.createNestedObject();
      obj["timestamp"] = "2026-07-17T00:00:00Z";
      obj["lat"] = record.lat;
      obj["lon"] = record.lon;
      obj["speed_kmh"] = record.speed_kmh;
      obj["heading_deg"] = record.heading_deg;
      obj["hdop"] = record.hdop;
      obj["satellites"] = record.satellites;
      obj["battery_pct"] = record.battery_pct;
      obj["gps_fix"] = record.gps_fix;

      String payload;
      serializeJson(doc, payload);

      if (client.connect(SUPABASE_URL, 443)) {
        client.println("POST /functions/v1/ingest HTTP/1.1");
        client.println("Host: " + String(SUPABASE_URL));
        client.println("Content-Type: application/json");
        client.println("X-Device-ID: " + String(DEVICE_ID));
        client.println("X-API-Key: " + String(API_KEY));
        client.print("Content-Length: ");
        client.println(payload.length());
        client.println();
        client.println(payload);

        long timeout = millis();
        while (client.connected() && millis() - timeout < 10000L) {
          while (client.available()) {
            char c = client.read();
            Serial.print(c);
            timeout = millis();
          }
        }
        client.stop();
        Serial.println("\n[LTE] Data pushed successfully");
      } else {
        Serial.println("[LTE] Connection to Supabase failed");
      }
    }
  }
}
