#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SD_MMC.h>
#include <ArduinoJson.h>
#include <esp_camera.h>
#include <esp_timer.h>
#include <sys/time.h>
#include <driver/i2s.h>
#include "config.h"

// Persist the envelope together with the payload before attempting delivery.
struct __attribute__((packed)) PacketHeader {
  uint32_t magic;
  uint32_t boot;
  uint32_t seq;
  uint64_t capturedMs;
  uint32_t bytes;
  uint8_t kind; // 0 = JPEG, 1 = PCM16 WAV
};
static SemaphoreHandle_t sdMutex;
static volatile bool paused = false;
static volatile uint32_t dropped = 0;
static uint32_t bootId;
static portMUX_TYPE counterMux = portMUX_INITIALIZER_UNLOCKED;
static uint32_t sequence[2] = {0, 0};
static String lastError;
static SemaphoreHandle_t errorMutex;
static uint32_t nextSequence(uint8_t kind) {
  portENTER_CRITICAL(&counterMux); uint32_t v = sequence[kind]++; portEXIT_CRITICAL(&counterMux); return v;
}
static void setError(const String &s) {
  xSemaphoreTake(errorMutex, portMAX_DELAY); lastError = s; xSemaphoreGive(errorMutex);
}
static uint64_t captureTimeMs() {
  timeval tv; gettimeofday(&tv, nullptr);
  return tv.tv_sec > 1700000000 ? uint64_t(tv.tv_sec) * 1000 + tv.tv_usec / 1000 : 0;
}
static bool savePacket(const uint8_t *data, size_t length, uint8_t kind, uint64_t at) {
  if (length > MAX_PACKET_BYTES) { dropped++; setError("Capture exceeds packet size limit; reduce resolution/quality"); return false; }
  xSemaphoreTake(sdMutex, portMAX_DELAY);
  if (SD_MMC.totalBytes() - SD_MMC.usedBytes() < length + MIN_FREE_SD_BYTES) {
    xSemaphoreGive(sdMutex); setError("SD full: new captures stopped; buffered recordings retained"); dropped++; return false;
  }
  uint32_t seq = nextSequence(kind);
  char name[80]; snprintf(name, sizeof(name), "/queue/%08lx-%u-%010lu.pkt", (unsigned long)bootId, unsigned(kind), (unsigned long)seq);
  String temp = String(name) + ".tmp";
  File f = SD_MMC.open(temp, FILE_WRITE);
  PacketHeader h{0x52574E44, bootId, seq, at, uint32_t(length), kind};
  bool ok = f && f.write((uint8_t*)&h, sizeof(h)) == sizeof(h) && f.write(data, length) == length;
  if (f) { f.flush(); f.close(); }
  if (ok) ok = SD_MMC.rename(temp, name);
  if (!ok) { SD_MMC.remove(temp); dropped++; }
  xSemaphoreGive(sdMutex);
  if (!ok) setError("SD write failed");
  return ok;
}
static void cameraTask(void *) {
  TickType_t last = xTaskGetTickCount();
  for (;;) {
    if (!paused) {
      uint64_t at = captureTimeMs();
      camera_fb_t *fb = esp_camera_fb_get();
      if (fb) { savePacket(fb->buf, fb->len, 0, at); esp_camera_fb_return(fb); }
      else { dropped++; setError("Camera capture failed"); }
    }
    digitalWrite(STATUS_LED, paused ? HIGH : LOW);
    vTaskDelayUntil(&last, pdMS_TO_TICKS(CAPTURE_INTERVAL_MS));
  }
}
static bool beginRequest(HTTPClient &http, WiFiClient &plain, WiFiClientSecure &tls, const String &path) {
  String url = String(SERVER_URL) + path;
  http.setConnectTimeout(4000); http.setTimeout(12000);
  bool ok;
  if (url.startsWith("https://")) {
    if (strlen(ROOT_CA) == 0) { setError("HTTPS requires ROOT_CA"); return false; }
    tls.setCACert(ROOT_CA); ok = http.begin(tls, url);
  } else ok = http.begin(plain, url);
  if (!ok) return false;
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  http.addHeader("X-Device-ID", DEVICE_ID);
  return true;
}
static int pendingCount(uint64_t &freeBytes) {
  int n = 0; xSemaphoreTake(sdMutex, portMAX_DELAY);
  freeBytes = SD_MMC.totalBytes() - SD_MMC.usedBytes();
  File dir = SD_MMC.open("/queue");
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    if (String(f.name()).endsWith(".pkt")) n++; f.close();
  }
  dir.close(); xSemaphoreGive(sdMutex); return n;
}
static void heartbeat() {
  WiFiClient plain; WiFiClientSecure tls; HTTPClient http;
  if (!beginRequest(http, plain, tls, "/api/device/heartbeat")) return;
  uint64_t freeBytes; int queued = pendingCount(freeBytes);
  JsonDocument body; char boot[12]; snprintf(boot, sizeof(boot), "%08lx", (unsigned long)bootId);
  body["boot"] = boot; body["queued"] = queued; body["dropped"] = dropped;
  body["uptime_ms"] = uint64_t(esp_timer_get_time()) / 1000; body["free_sd_bytes"] = freeBytes; body["rssi"] = WiFi.RSSI();
  xSemaphoreTake(errorMutex, portMAX_DELAY); body["error"] = lastError; xSemaphoreGive(errorMutex);
  String payload; serializeJson(body, payload); http.addHeader("Content-Type", "application/json");
  int code = http.POST(payload);
  if (code == 200) {
    JsonDocument response;
    if (!deserializeJson(response, http.getString())) {
      paused = response["paused"] | false;
      // Synchronize from trusted server even when hotspot has no internet/NTP.
      double now = response["server_time"] | 0.0;
      if (now > 1700000000) { timeval tv{time_t(now), suseconds_t((now - time_t(now)) * 1e6)}; settimeofday(&tv, nullptr); }
      // Question answers are available on the computer dashboard (no speaker on ESP32-CAM).
    }
  }
  http.end();
}
static bool uploadOne() {
  String path; PacketHeader h{}; uint8_t *payload = nullptr;
  xSemaphoreTake(sdMutex, portMAX_DELAY);
  File dir = SD_MMC.open("/queue");
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    String name = f.name();
    if (name.endsWith(".pkt")) {
      path = name.startsWith("/") ? name : "/queue/" + name;
      if (f.read((uint8_t*)&h, sizeof(h)) == sizeof(h) && h.magic == 0x52574E44 && h.bytes <= MAX_PACKET_BYTES && f.size() == sizeof(h) + h.bytes) {
        payload = (uint8_t*)ps_malloc(h.bytes);
        if (payload && f.read(payload, h.bytes) != h.bytes) { free(payload); payload = nullptr; }
      }
      f.close(); break;
    }
    f.close();
  }
  dir.close(); xSemaphoreGive(sdMutex);
  if (path.isEmpty()) return false;
  if (!payload) { setError("Invalid queued packet or insufficient PSRAM; inspect SD card"); delay(1000); return false; }
  WiFiClient plain; WiFiClientSecure tls; HTTPClient http;
  bool ok = false;
  if (beginRequest(http, plain, tls, h.kind == 0 ? "/api/ingest/frame" : "/api/ingest/audio")) {
    char boot[12]; snprintf(boot, sizeof(boot), "%08lx", (unsigned long)h.boot);
    http.addHeader("Content-Type", h.kind == 0 ? "image/jpeg" : "audio/wav");
    http.addHeader("X-Boot-ID", boot); http.addHeader("X-Sequence", String(h.seq));
    http.addHeader("X-Captured-At", String(double(h.capturedMs) / 1000, 3));
    int code = http.POST(payload, h.bytes);
    ok = code == 200 || code == 201;
    if (!ok) setError(String("Upload pending; HTTP ") + code);
    http.end();
  }
  free(payload);
  if (ok) {
    xSemaphoreTake(sdMutex, portMAX_DELAY); SD_MMC.remove(path); xSemaphoreGive(sdMutex);
    setError("");
  }
  return ok;
}
#if ENABLE_MIC
static void put16(uint8_t *p, uint16_t x) { p[0]=x; p[1]=x>>8; }
static void put32(uint8_t *p, uint32_t x) { for(int i=0;i<4;i++) p[i]=x>>(8*i); }
static void audioTask(void *) {
  // Camera uses I2S0. INMP441 uses I2S1, with 1-bit SD mode to free GPIO13.
  i2s_config_t cfg{}; cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  cfg.sample_rate = AUDIO_RATE; cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT; cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1; cfg.dma_buf_count = 8; cfg.dma_buf_len = 256;
  i2s_pin_config_t pins{}; pins.bck_io_num=MIC_BCLK; pins.ws_io_num=MIC_WS; pins.data_out_num=-1; pins.data_in_num=MIC_DATA;
  if (i2s_driver_install(I2S_NUM_1, &cfg, 0, nullptr) != ESP_OK || i2s_set_pin(I2S_NUM_1, &pins) != ESP_OK) {
    setError("Microphone initialization failed"); vTaskDelete(nullptr); return;
  }
  const size_t samples = AUDIO_RATE * AUDIO_SECONDS;
  uint8_t *wav = (uint8_t*)ps_malloc(44 + samples * 2);
  if (!wav) { setError("Audio PSRAM allocation failed"); vTaskDelete(nullptr); return; }
  memcpy(wav, "RIFF", 4); put32(wav+4, 36+samples*2); memcpy(wav+8, "WAVEfmt ", 8);
  put32(wav+16,16); put16(wav+20,1); put16(wav+22,1); put32(wav+24,AUDIO_RATE);
  put32(wav+28,AUDIO_RATE*2); put16(wav+32,2); put16(wav+34,16); memcpy(wav+36,"data",4); put32(wav+40,samples*2);
  for (;;) {
    size_t got=0; uint64_t at=captureTimeMs();
    while (got < samples) {
      int32_t block[256]; size_t bytes=0;
      i2s_read(I2S_NUM_1, block, sizeof(block), &bytes, portMAX_DELAY);
      for(size_t i=0; i<bytes/4 && got<samples;i++,got++) put16(wav+44+got*2, int16_t(block[i]>>16));
    }
    if (!paused) savePacket(wav,44+samples*2,1,at);
  }
}
#endif
void setup() {
  Serial.begin(115200); pinMode(STATUS_LED, OUTPUT); digitalWrite(STATUS_LED, HIGH);
  sdMutex=xSemaphoreCreateMutex(); errorMutex=xSemaphoreCreateMutex(); bootId=esp_random();
  if (!psramFound()) { Serial.println("PSRAM required. Check board configuration."); while(true) delay(1000); }
  camera_config_t c{};
  c.ledc_channel=LEDC_CHANNEL_0; c.ledc_timer=LEDC_TIMER_0;
  c.pin_d0=5; c.pin_d1=18; c.pin_d2=19; c.pin_d3=21; c.pin_d4=36; c.pin_d5=39; c.pin_d6=34; c.pin_d7=35;
  c.pin_xclk=0; c.pin_pclk=22; c.pin_vsync=25; c.pin_href=23; c.pin_sccb_sda=26; c.pin_sccb_scl=27;
  c.pin_pwdn=32; c.pin_reset=-1; c.xclk_freq_hz=20000000; c.pixel_format=PIXFORMAT_JPEG;
  c.frame_size=FRAMESIZE_SVGA; c.jpeg_quality=JPEG_QUALITY; c.fb_count=2; c.grab_mode=CAMERA_GRAB_LATEST; c.fb_location=CAMERA_FB_IN_PSRAM;
  if (esp_camera_init(&c) != ESP_OK) { Serial.println("Camera init failed; verify AI-Thinker pinout."); while(true) delay(1000); }
  if (!SD_MMC.begin("/sdcard", true)) { Serial.println("FAT32 microSD required; recording halted."); while(true) delay(1000); }
  SD_MMC.mkdir("/queue");
  WiFi.mode(WIFI_STA); WiFi.setSleep(false); WiFi.setAutoReconnect(true); WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
  configTime(0,0,"pool.ntp.org","time.nist.gov");
  // Wait briefly for a server clock, then permit offline capture with explicit unknown timestamps.
  for(int i=0;i<30 && WiFi.status()!=WL_CONNECTED;i++) delay(300);
  if(WiFi.status()==WL_CONNECTED) heartbeat();
  xTaskCreatePinnedToCore(cameraTask,"capture",8192,nullptr,1,nullptr,1);
#if ENABLE_MIC
  xTaskCreatePinnedToCore(audioTask,"audio",8192,nullptr,1,nullptr,1);
#endif
}
void loop() {
  static uint32_t lastHeartbeat=0, lastReconnect=0;
  if (WiFi.status()!=WL_CONNECTED) {
    if(millis()-lastReconnect>15000) { WiFi.reconnect(); lastReconnect=millis(); }
    delay(500); return;
  }
  if(millis()-lastHeartbeat>10000) { heartbeat(); lastHeartbeat=millis(); }
  if(!uploadOne()) delay(500);
}
