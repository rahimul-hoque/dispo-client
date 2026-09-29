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
#include "secrets.h" // gitignored — copy secrets.example.h to secrets.h and fill in real values

#define DEVICE_NAME "EZConnect-Min"

// ─── Backend Configuration ────────────────────────────────────────
// HiveMQ broker/credentials and FALLBACK_DEVICE_TOKEN now live in secrets.h,
// which is gitignored — this file used to have the real HiveMQ password
// committed in plaintext to a public repo. If you're reading this after
// that leak: the fix was rotating the credential in the HiveMQ Cloud
// console, not just moving the string to a different file.
static const char* SERVER_BASE_URL = "https://vending-server.vercel.app";

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
static const uint32_t TELEMETRY_INTERVAL_IDLE_MS = 120000; // slower cadence while nothing's happening

// ─── Idle / Active State ───────────────────────────────────────────
// WiFi and MQTT stay connected and subscribed in both states — this is
// NOT sleep, and deliberately so: the board is mains-powered (no battery
// to save), and an actually-disconnected board can't receive an instant
// MQTT push, only find out about an order on its next scheduled wake —
// exactly the unreliable polling pattern this firmware moved away from.
// "Idle" here just means quieter (slower telemetry) while resting.
enum class BoardState { IDLE, ACTIVE };
static BoardState boardState = BoardState::IDLE;
static uint32_t lastActivityAt = 0; // millis() of the last order starting or finishing
static const uint32_t IDLE_AFTER_MS = 5 * 60 * 1000; // no order activity for this long -> back to idle

Preferences prefs;
static portMUX_TYPE payloadMux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool havePayload = false;
static String payload = "";
static String g_deviceId = FALLBACK_DEVICE_TOKEN;

// ─── MQTT Globals ────────────────────────────────────────────────
WiFiClientSecure secureClient;
PubSubClient mqtt(secureClient);
static uint32_t lastReconnectAttempt = 0;
static uint32_t mqttConnectedSince = 0;
// mqtt.connected() only reflects what the local socket THINKS, not real
// liveness — a router/NAT can silently drop an idle connection without
// ever sending a close/RST, leaving the board believing it's still
// subscribed for a very long time (observed: 30+ minutes, during which
// real orders were published and never arrived). Rather than trust
// PubSubClient to detect that, proactively force a fresh session on a
// schedule so staleness is always bounded.
static const uint32_t MQTT_REFRESH_INTERVAL_MS = 2 * 60 * 1000;

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
static void enterActiveState(const String &reasonOrderId);
static void updateBoardState();
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
  enterActiveState(orderId);
  Serial.printf("\n=========================================\n");
  Serial.printf("[ordr] DISPENSING ORDER: %s\n", orderId.c_str());
  Serial.printf("[ordr] %u line item(s) to dispense\n", orderItemCount);
  Serial.printf("=========================================\n");
}

// Marks the board as active (an order just started or finished) and
// resets the idle countdown. WiFi/MQTT are untouched either way — see
// the BoardState comment above for why this never disconnects anything.
static void enterActiveState(const String &reasonOrderId) {
  lastActivityAt = millis();
  if (boardState != BoardState::ACTIVE) {
    boardState = BoardState::ACTIVE;
    Serial.printf("[state] ACTIVE - dispensing order %s\n", reasonOrderId.c_str());
  }
}

// Called every loop() iteration. Only transitions ACTIVE -> IDLE; going
// IDLE -> ACTIVE happens immediately when a new order arrives, not on a
// timer.
static void updateBoardState() {
  if (boardState == BoardState::ACTIVE && !orderActive && millis() - lastActivityAt > IDLE_AFTER_MS) {
    boardState = BoardState::IDLE;
    Serial.println("[state] IDLE");
  }
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

  // Connect with Last Will & Testament (LWT). cleanSession=false so the
  // broker keeps our subscription + queues any QoS-1 messages published
  // while we're briefly disconnected (e.g. during the periodic session
  // refresh above) and delivers them the moment we reconnect with this
  // same client ID — without this, a dispense published during that
  // reconnect window would just be dropped with nowhere to land.
  if (mqtt.connect(g_deviceId.c_str(), MQTT_USER, MQTT_PASS, statusTopic.c_str(), 1, true, "offline", false)) {
    Serial.println("[mqtt] CONNECTED!");
    mqttConnectedSince = millis();
    mqtt.publish(statusTopic.c_str(), "online", true);
    mqtt.subscribe(cmdTopic.c_str(), 1);
    Serial.printf("[mqtt] Subscribed to %s\n", cmdTopic.c_str());
  } else {
    // rc alone doesn't say WHY the transport failed — RSSI/heap here so a
    // weak-signal or memory-fragmentation cause is visible instead of
    // having to guess from the error code alone. Note WiFi.status() was
    // already WL_CONNECTED for this call to even run (checked above and
    // by the caller in loop()), so "connected" isn't the same as "good
    // enough for a TLS handshake."
    Serial.printf(
      "[mqtt] connect failed, rc=%d, rssi=%d dBm, free heap=%u — retrying in 5s\n",
      mqtt.state(), WiFi.RSSI(), (unsigned)ESP.getFreeHeap()
    );
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

// ─── Order Reporting (MQTT only) ──────────────────────────────────
// Used to also fire an equivalent HTTP PATCH alongside every MQTT publish
// "just in case MQTT was asleep." Dropped that: it was two independent
// implementations of the same event (exactly the kind of duplication that
// let the MQTT "complete" handler drift out of sync with the HTTP route's
// guards server-side before), for no real benefit — if the board's MQTT
// session is down, the HTTP calls would've needed their own WiFi/network
// path anyway, and the 5-minute stale-order sweep already exists precisely
// to recover from a board that can't report in at all.
static void completeOrder(const String &id) {
  if (mqtt.connected()) {
    String topic = "devices/" + g_deviceId + "/complete";
    String body = "{\"orderId\":\"" + id + "\"}";
    mqtt.publish(topic.c_str(), body.c_str()); // not retained — this is a one-off event, not device state
  }
  Serial.printf("[ordr] Order %s complete reported to cloud\n", id.c_str());
}

static void reportProgress(const String &id, uint8_t slotNumber) {
  if (mqtt.connected()) {
    String topic = "devices/" + g_deviceId + "/progress";
    String body = "{\"orderId\":\"" + id + "\",\"slotNumber\":" + String(slotNumber) + "}";
    mqtt.publish(topic.c_str(), body.c_str());
  }
}

static void failOrder(const String &id, const String &reason) {
  if (mqtt.connected()) {
    String topic = "devices/" + g_deviceId + "/fail";
    String body = "{\"orderId\":\"" + id + "\",\"reason\":\"" + reason + "\"}";
    mqtt.publish(topic.c_str(), body.c_str()); // not retained, same reasoning as completeOrder
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
    lastActivityAt = millis(); // idle countdown starts from when this actually ended, not when it started
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
  lastActivityAt = millis(); // idle countdown starts from when this actually ended, not when it started
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
  updateBoardState();

  if (WiFi.status() == WL_CONNECTED) {
    if (!mqtt.connected()) {
      connectMQTT();
    } else {
      mqtt.loop();

      // Proactively refresh the session — see MQTT_REFRESH_INTERVAL_MS
      // comment above. Skipped while an order is active so we never drop
      // the connection mid-dispense.
      if (!orderActive && millis() - mqttConnectedSince > MQTT_REFRESH_INTERVAL_MS) {
        Serial.println("[mqtt] proactively refreshing session (periodic health check)");
        mqtt.disconnect();
      }
    }
  }

  // Backup HTTP poller. Runs even while MQTT looks healthy, just at a much
  // slower cadence — this is what actually catches a push that silently
  // never arrived for any reason (a server-side publish that failed
  // without us knowing, a message lost in a gap we haven't found yet,
  // etc.), instead of the customer waiting out the full 90s stale-order
  // timeout for something the board could have discovered on its own in
  // under a minute. Fast (5s) fallback cadence when MQTT is actually
  // down; slow (45s) safety-net cadence otherwise. /pending-orders'
  // claim is now atomic server-side, so running this concurrently with
  // an MQTT-triggered dispatch can't double-claim the same order.
  static uint32_t lastPoll = 0;
  uint32_t pollInterval = mqtt.connected() ? 45000 : 5000;
  if (!orderActive && WiFi.status() == WL_CONNECTED && millis() - lastPoll > pollInterval) {
    lastPoll = millis();
    pollPendingOrders();
  }

  static uint32_t lastTelemetry = 0;
  uint32_t telemetryInterval = (boardState == BoardState::IDLE) ? TELEMETRY_INTERVAL_IDLE_MS : TELEMETRY_INTERVAL_MS;
  if (millis() - lastTelemetry > telemetryInterval) {
    lastTelemetry = millis();
    sendTelemetry();
  }
  
  delay(10); 
}
