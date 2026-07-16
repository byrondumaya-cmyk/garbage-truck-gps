#include <Arduino.h>

// Task handles
TaskHandle_t GPSManagerTaskHandle;
TaskHandle_t LTEManagerTaskHandle;

// Function prototypes
void TaskGPSManager(void *pvParameters);
void TaskLTEManager(void *pvParameters);

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    ; // wait for serial port to connect
  }
  
  Serial.println("Garbage Truck GPS Tracking System - Starting...");

  // Initialize FreeRTOS Tasks
  xTaskCreatePinnedToCore(
      TaskGPSManager,       // Function that implements the task
      "GPSManager",         // Text name for the task
      4096,                 // Stack size in words, not bytes
      NULL,                 // Parameter passed into the task
      1,                    // Task priority
      &GPSManagerTaskHandle,// Pointer to store the task handle
      1                     // Core where the task should run
  );

  xTaskCreatePinnedToCore(
      TaskLTEManager,
      "LTEManager",
      8192,
      NULL,
      2,
      &LTEManagerTaskHandle,
      1
  );
}

void loop() {
  // Empty. Everything is handled by FreeRTOS tasks.
  vTaskDelay(pdMS_TO_TICKS(1000));
}

void TaskGPSManager(void *pvParameters) {
  for (;;) {
    // TODO: Implement GPS acquisition and parsing
    Serial.println("[GPS] Task Running...");
    vTaskDelay(pdMS_TO_TICKS(5000));
  }
}

void TaskLTEManager(void *pvParameters) {
  for (;;) {
    // TODO: Implement LTE connection logic
    Serial.println("[LTE] Task Running...");
    vTaskDelay(pdMS_TO_TICKS(10000));
  }
}
