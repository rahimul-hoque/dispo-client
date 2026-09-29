#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>

#define DEVICE_NAME "EZConnect-Min"

// ─── Backend & HiveMQ Cloud Configuration ─────────────────────────
static const char* SERVER_BASE_URL       = "https://vending-server.vercel.app";
static const char* FALLBACK_DEVICE_TOKEN = "6bb54de2-db42-420d-943e-1d2c2bf087e0"; // Default token for testing

static const char* MQTT_BROKER = "97bee182514646a19ef2298dec106c52.s1.eu.hivemq.cloud"; 
static const int   MQTT_PORT   = 8883;
static const char* MQTT_USER   = "frontend_Server";
static const char* MQTT_PASS   = "samm258258";

// ─── BLE UUIDs ───────────────────────────────────────────────────
static const char *SVC_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
static const char *RX_UUID  = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";
static const char *TX_UUID  = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";

// ─── Hardware & Pin Configuration ────────────────────────────────
const uint8_t BUTTON_PIN = 27; // Hold 3s to toggle Setup Mode
const uint8_t MAX_SLOTS = 4;
const uint8_t SLOT_PINS[MAX_SLOTS] = {12, 13, 14, 15};
const uint32_t RELAY_PULSE_MS = 500;
const uint32_t DISPENSE_SETTLE_MS = 800;
const uint32_t ORDER_MAX_DURATION_MS = 60000;

static const uint8_t RELAY_ACTIVE_LEVEL = LOW;
static const uint8_t RELAY_IDLE_LEVEL   = HIGH;

// ─── Setup Mode & BLE State ──────────────────────────────────────
static bool setupMode = false;
static uint32_t setupStartTime = 0;
static const uint32_t SETUP_TIMEOUT_MS = 60000;

static BLEServer *bleServer = nullptr;
static BLECharacteristic *txChar = nullptr;
static bool bleConnected = false;
static uint16_t bleConnId = 0;

// ─── System Globals ──────────────────────────────────────────────
static const uint32_t TELEMETRY_INTERVAL_MS = 30000;

Preferences prefs;
static portMUX_TYPE payloadMux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool havePayload = false;
static String payload = "";
static String g_deviceId = FALLBACK_DEVICE_TOKEN;

// ─── MQTT Globals ────────────────────────────────────────────────
WiFiClientSecure secureClient;
PubSubClient mqtt(secureClient);
static uint32_t lastReconnectAttempt = 0;

// ─── Relay State ─────────────────────────────────────────────────
struct RelayState {
  bool pulseActive;
  uint32_t pulseEndAt;
};
static RelayState relayState[MAX_SLOTS];
static portMUX_TYPE relayMux = portMUX_INITIALIZER_UNLOCKED;

// ─── Order Dispense State Machine ────────────────────────────────
struct OrderItem {
  uint8_t slotNumber;
  uint8_t qty;
};
static bool orderActive = false;
static String orderId = "";
static OrderItem orderItems[MAX_SLOTS];
static uint8_t orderItemCount = 0;
static uint8_t orderItemIdx = 0;
static uint8_t orderUnitIdx = 0;
static uint32_t orderSettleUntil = 0;
static uint32_t orderStartedAt = 0;

// ─── Forward Declarations ────────────────────────────────────────
static void notifyStatus(const String &msg);
static bool triggerSlot(uint8_t idx);
static void disableSetupMode();
static void enableSetupMode();
static uint32_t getEpochTime();
static void advanceOrderProgress();
static void completeOrder(const String &id);
static void failOrder(const String &id, const String &reason);
static void reportProgress(const String &id, uint8_t slotNumber);
static void pollPendingOrders();

// ─── Order Parser (Handles both MQTT push & HTTP poll) ────────────
void handleIncomingOrder(const String &json) {
  if (orderActive) {
    Serial.printf("[ordr] already dispensing order %s — ignoring trigger\n", orderId.c_str());
    return;
  }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, json);
  if (err) {
    Serial.printf("[ordr] JSON parse error: %s\n", err.c_str());
    return;
  }

  if (doc["slot"].is<int>()) {
    triggerSlot((uint8_t)(doc["slot"].as<int>() - 1));
    return;
  }

  if (doc["orderId"].isNull()) return;

  orderId = doc["orderId"].as<String>();
  orderItemCount = 0;

  for (JsonObject item : doc["items"].as<JsonArray>()) {
    if (orderItemCount >= MAX_SLOTS) break;
    int slot = item["slotNumber"] | 0;
    int qty = item["qty"] | 0;
    if (slot >= 1 && slot <= MAX_SLOTS && qty >= 1) {
      orderItems[orderItemCount++] = OrderItem{(uint8_t)slot, (uint8_t)qty};
    }
  }

  if (orderItemCount == 0) {
    Serial.printf("[ordr] order %s had no valid items — skipping\n", orderId.c_str());
    return;
  }

  orderItemIdx = 0;
  orderUnitIdx = 0;
  orderSettleUntil = 0;
  orderStartedAt = millis();
  orderActive = true;
  Serial.printf("\n=========================================\n");
  Serial.printf("[ordr] DISPENSING ORDER: %s\n", orderId.c_str());
  Serial.printf("[ordr] %u line item(s) to dispense\n", orderItemCount);
  Serial.printf("=========================================\n");
}

void mqttCallback(char* topic, byte* message, unsigned int length) {
  String json = "";
  for (unsigned int i = 0; i < length; i++) json += (char)message[i];
  Serial.printf("[mqtt] push arrived on %s\n", topic);
  handleIncomingOrder(json);
}

// ─── MQTT Connection & Topics ────────────────────────────────────
void connectMQTT() {
  if (mqtt.connected() || g_deviceId == "unprovisioned" || WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastReconnectAttempt < 5000) return;
  lastReconnectAttempt = millis();

  Serial.printf("[mqtt] Connecting to HiveMQ Cloud as %s...\n", g_deviceId.c_str());

  String statusTopic = "devices/" + g_deviceId + "/status";
  String cmdTopic    = "devices/" + g_deviceId + "/dispense";

  // Connect with Last Will & Testament (LWT)
  if (mqtt.connect(g_deviceId.c_str(), MQTT_USER, MQTT_PASS, statusTopic.c_str(), 1, true, "offline")) {
    Serial.println("[mqtt] CONNECTED!");
    mqtt.publish(statusTopic.c_str(), "online", true);
    mqtt.subscribe(cmdTopic.c_str(), 1);
    Serial.printf("[mqtt] Subscribed to %s\n", cmdTopic.c_str());
  } else {
    Serial.printf("[mqtt] connect failed, rc=%d. Retrying in 5s\n", mqtt.state());
  }
}

// ─── HTTP Polling Backup (Guarantees orders are never missed) ─────
static void pollPendingOrders() {
  if (orderActive || WiFi.status() != WL_CONNECTED || g_deviceId == "unprovisioned") return;

  HTTPClient http;
  String url = String(SERVER_BASE_URL) + "/api/devices/by-token/" + g_deviceId + "/pending-orders";
  http.begin(url);
  int code = http.GET();
  if (code == 200) {
    String json = http.getString();
    if (json.indexOf("\"orderId\"") != -1) {
      Serial.printf("[http] Found pending order via HTTP backup!\n");
      handleIncomingOrder(json);
    }
  }
  http.end();
}

// ─── Order Reporting (Sends BOTH MQTT & HTTP PATCH) ───────────────
static void completeOrder(const String &id) {
  // 1. Publish to MQTT
  if (mqtt.connected()) {
    String topic = "devices/" + g_deviceId + "/complete";
    String body = "{\"orderId\":\"" + id + "\"}";
    mqtt.publish(topic.c_str(), body.c_str(), true);
  }

  // 2. Also send HTTP PATCH (ensures Vercel updates even if MQTT listener is asleep)
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String url = String(SERVER_BASE_URL) + "/api/devices/by-token/" + g_deviceId + "/orders/" + id + "/complete";
    http.begin(url);
    int code = http.PATCH("");
    Serial.printf("[http] complete PATCH -> %d\n", code);
    http.end();
  }

  Serial.printf("[ordr] Order %s complete reported to cloud\n", id.c_str());
}

static void reportProgress(const String &id, uint8_t slotNumber) {
  if (mqtt.connected()) {
    String topic = "devices/" + g_deviceId + "/progress";
    String body = "{\"orderId\":\"" + id + "\",\"slotNumber\":" + String(slotNumber) + "}";
    mqtt.publish(topic.c_str(), body.c_str());
  }

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String url = String(SERVER_BASE_URL) + "/api/devices/by-token/" + g_deviceId + "/orders/" + id + "/items/" + String(slotNumber) + "/progress";
    http.begin(url);
    http.PATCH("");
    http.end();
  }
}

static void failOrder(const String &id, const String &reason) {
  if (mqtt.connected()) {
    String topic = "devices/" + g_deviceId + "/fail";
    String body = "{\"orderId\":\"" + id + "\",\"reason\":\"" + reason + "\"}";
    mqtt.publish(topic.c_str(), body.c_str(), true);
  }

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String url = String(SERVER_BASE_URL) + "/api/devices/by-token/" + g_deviceId + "/orders/" + id + "/fail";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.PATCH("{\"reason\":\"" + reason + "\"}");
    http.end();
  }
  Serial.printf("[ordr] Order %s failed reported: %s\n", id.c_str(), reason.c_str());
}

static void sendTelemetry() {
  if (!mqtt.connected()) return;

  JsonDocument doc;
  doc["deviceId"] = g_deviceId;
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["setupMode"] = setupMode;
  doc["timestamp"] = getEpochTime();

  String body;
  serializeJson(doc, body);
  String telTopic = "devices/" + g_deviceId + "/telemetry";
  mqtt.publish(telTopic.c_str(), body.c_str());
}

// ─── Dispense State Machine Driver ───────────────────────────────
static void driveOrder() {
  if (!orderActive) return;

  if (millis() - orderStartedAt > ORDER_MAX_DURATION_MS) {
    Serial.printf("[ordr] Order %s timed out — reporting failure\n", orderId.c_str());
    failOrder(orderId, "device_timeout");
    orderActive = false;
    return;
  }

  if (millis() < orderSettleUntil) return;

  uint8_t slotIdx = orderItems[orderItemIdx].slotNumber - 1;
  if (!relayState[slotIdx].pulseActive) {
    triggerSlot(slotIdx);
  }
}

static void advanceOrderProgress() {
  reportProgress(orderId, orderItems[orderItemIdx].slotNumber);

  orderUnitIdx++;
  if (orderUnitIdx < orderItems[orderItemIdx].qty) {
    orderSettleUntil = millis() + DISPENSE_SETTLE_MS;
    return;
  }

  orderItemIdx++;
  orderUnitIdx = 0;
  if (orderItemIdx < orderItemCount) {
    orderSettleUntil = millis() + DISPENSE_SETTLE_MS;
    return;
  }

  Serial.printf("[ordr] order %s fully dispensed!\n", orderId.c_str());
  completeOrder(orderId);
  orderActive = false;
}

// ─── Relay Service & Completion ──────────────────────────────────
static inline void relayWrite(uint8_t idx, bool on) {
  digitalWrite(SLOT_PINS[idx], on ? RELAY_ACTIVE_LEVEL : RELAY_IDLE_LEVEL);
}

static bool triggerSlot(uint8_t idx) {
  if (idx >= MAX_SLOTS) return false;
  if (setupMode) {
    notifyStatus("ERROR_SETUP_MODE_ACTIVE");
    return false;
  }

  bool started = false;
  portENTER_CRITICAL(&relayMux);
  if (!relayState[idx].pulseActive) {
    relayState[idx].pulseActive = true;
    relayState[idx].pulseEndAt = millis() + RELAY_PULSE_MS;
    started = true;
  }
  portEXIT_CRITICAL(&relayMux);

  if (started) {
    relayWrite(idx, true);
    notifyStatus("SLOT_" + String(idx + 1) + "_ACTIVE");
    Serial.printf("[slot] %u energized (500ms pulse)\n", idx + 1);
  }
  return started;
}

static void serviceRelays() {
  uint32_t now = millis();
  for (uint8_t i = 0; i < MAX_SLOTS; i++) {
    bool finished = false;
    portENTER_CRITICAL(&relayMux);
    if (relayState[i].pulseActive && (int32_t)(now - relayState[i].pulseEndAt) >= 0) {
      relayState[i].pulseActive = false;
      finished = true;
    }
    portEXIT_CRITICAL(&relayMux);

    if (finished) {
      relayWrite(i, false);
      uint8_t slotNum = i + 1;
      notifyStatus("SLOT_" + String(slotNum) + "_DONE");
      Serial.printf("[slot] %u pulse complete\n", slotNum);

      if (orderActive && orderItems[orderItemIdx].slotNumber == slotNum) {
        advanceOrderProgress();
      }
    }
  }
}

// ─── Bluetooth Callbacks ─────────────────────────────────────────
class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    uint8_t *data = c->getData();
    size_t n = c->getLength();
    if (!n) return;

    if (setupMode) setupStartTime = millis(); 

    portENTER_CRITICAL(&payloadMux);
    for (size_t i = 0; i < n; i++) payload += (char)data[i];
    havePayload = true;
    portEXIT_CRITICAL(&payloadMux);
  }
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *s, esp_ble_gatts_cb_param_t *param) override {
    bleConnected = true;
    bleConnId = param->connect.conn_id;
    Serial.println("[ble ] client connected");
  }
  void onDisconnect(BLEServer *s) override {
    bleConnected = false;
    Serial.println("[ble ] client disconnected");
    if (setupMode) {
      delay(300);
      BLEDevice::startAdvertising();
    }
  }
};

static void notifyStatus(const String &msg) {
  if (!txChar || !bleConnected) return;
  txChar->setValue(msg.c_str());
  txChar->notify();
}

static void enableSetupMode() {
  if (setupMode) return;
  setupMode = true;
  setupStartTime = millis();
  BLEDevice::startAdvertising();
  Serial.println("\n[mode] 🟢 SETUP MODE ENABLED (BLE active for 60s)");
}

static void disableSetupMode() {
  if (!setupMode) return;
  setupMode = false;
  if (bleConnected && bleServer != nullptr) {
    bleServer->disconnect(bleConnId);
    delay(100); 
  }
  BLEDevice::getAdvertising()->stop();
  Serial.println("\n[mode] 🔴 SETUP MODE DISABLED (BLE stopped)");
}

static void handleButtonAndTimeout() {
  static bool lastBtnState = HIGH;
  static uint32_t btnPressTime = 0;
  static bool btnHandled = false;

  bool currentBtnState = digitalRead(BUTTON_PIN);
  if (currentBtnState == LOW && lastBtnState == HIGH) {
    btnPressTime = millis();
    btnHandled = false;
  }
  
  if (currentBtnState == LOW && !btnHandled) {
    if (millis() - btnPressTime >= 3000) {
      if (setupMode) disableSetupMode();
      else enableSetupMode();
      btnHandled = true;
    }
  }
  lastBtnState = currentBtnState;

  if (setupMode && (millis() - setupStartTime >= SETUP_TIMEOUT_MS)) {
    disableSetupMode();
  }
}

// ─── WiFi & Credentials ──────────────────────────────────────────
static void connectWiFi(const String &ssid, const String &pass) {
  notifyStatus("CONNECTING");
  Serial.printf("[wifi] connecting to \"%s\"...\n", ssid.c_str());
  WiFi.disconnect(true, false);
  delay(150);
  WiFi.begin(ssid.c_str(), pass.length() ? pass.c_str() : nullptr);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    handleButtonAndTimeout(); 
    delay(10); 
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] CONNECTED! IP: %s\n", WiFi.localIP().toString().c_str());
    notifyStatus("CONNECTED," + WiFi.localIP().toString());
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  } else {
    Serial.println("[wifi] connection failed");
    notifyStatus("FAILED");
  }
}

static void handlePayload(String text) {
  text.trim();
  Serial.printf("[ble ] payload received: \"%s\"\n", text.c_str());

  if (text.startsWith("dvi_")) {
    g_deviceId = text.substring(4);
    prefs.begin("device", false);
    prefs.putString("id", g_deviceId);
    prefs.end();
    Serial.printf("[dvi ] saved device ID: %s\n", g_deviceId.c_str());
    if (mqtt.connected()) mqtt.disconnect(); 
    notifyStatus("DEVICEID_SET");
    return;
  }

  if (text.startsWith("slot_")) {
    int s = text.substring(5).toInt();
    triggerSlot((uint8_t)(s - 1));
    return;
  }

  int comma = text.indexOf(',');
  if (comma > 0) {
    String ssid = text.substring(0, comma);
    String pass = text.substring(comma + 1);
    prefs.begin("wifi", false);
    prefs.putString("ssid", ssid);
    prefs.putString("pass", pass);
    prefs.end();
    connectWiFi(ssid, pass);
  }
}

static uint32_t getEpochTime() {
  time_t now = time(nullptr);
  return now > 1700000000UL ? (uint32_t)now : 0;
}

// ─── Setup & Main Loop ───────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP); 

  for (uint8_t i = 0; i < MAX_SLOTS; i++) {
    relayState[i].pulseActive = false;
    relayState[i].pulseEndAt = 0;
    pinMode(SLOT_PINS[i], OUTPUT);
    relayWrite(i, false);
  }

  WiFi.mode(WIFI_STA);
  secureClient.setInsecure();
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(2048);

  BLEDevice::init(DEVICE_NAME);
  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());
  BLEService *svc = bleServer->createService(SVC_UUID);

  BLECharacteristic *rx = svc->createCharacteristic(RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCallbacks());

  txChar = svc->createCharacteristic(TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  txChar->addDescriptor(new BLE2902());
  svc->start();
  
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SVC_UUID);
  adv->setScanResponse(true);

  prefs.begin("wifi", true);
  String ssid = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");
  prefs.end();

  prefs.begin("device", true);
  String savedId = prefs.getString("id", "");
  if (savedId.length() > 0) {
    g_deviceId = savedId;
  } else {
    g_deviceId = FALLBACK_DEVICE_TOKEN; // Default to active token
  }
  prefs.end();

  Serial.printf("\n=========================================\n");
  Serial.printf("  Dispo Controller Active\n");
  Serial.printf("  Device Token: %s\n", g_deviceId.c_str());
  Serial.printf("=========================================\n");

  if (ssid.length()) {
    connectWiFi(ssid, pass);
  } else {
    Serial.println("[boot] No WiFi configured — entering Setup Mode automatically");
    enableSetupMode();
  }
}

void loop() {
  handleButtonAndTimeout();

  if (havePayload) {
    String text;
    portENTER_CRITICAL(&payloadMux);
    text = payload;
    payload = "";
    havePayload = false;
    portEXIT_CRITICAL(&payloadMux);
    handlePayload(text);
  }

  serviceRelays();
  driveOrder();

  if (WiFi.status() == WL_CONNECTED) {
    if (!mqtt.connected()) {
      connectMQTT();
    } else {
      mqtt.loop();
    }
  }

  // Backup HTTP Poller: Checks for orders every 5s in case MQTT dropped
  static uint32_t lastPoll = 0;
  if (!orderActive && WiFi.status() == WL_CONNECTED && millis() - lastPoll > 5000) {
    lastPoll = millis();
    pollPendingOrders();
  }

  static uint32_t lastTelemetry = 0;
  if (millis() - lastTelemetry > TELEMETRY_INTERVAL_MS) {
    lastTelemetry = millis();
    sendTelemetry();
  }
  
  delay(10); 
}
