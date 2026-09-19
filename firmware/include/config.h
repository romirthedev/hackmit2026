#pragma once
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif
// FORIOT OV2640 kits commonly use the AI-Thinker ESP32-CAM pinout. Verify the board.
#define CAPTURE_INTERVAL_MS 1000
#define JPEG_QUALITY 12
#define MAX_PACKET_BYTES (512 * 1024)
#define MIN_FREE_SD_BYTES (8ULL * 1024 * 1024)
// Optional INMP441 (not included with a camera-only kit). See hardware guide.
#ifndef ENABLE_MIC
#define ENABLE_MIC 0
#endif
#define MIC_BCLK 13
#define MIC_WS 12
#define MIC_DATA 3
#define AUDIO_SECONDS 8
#define AUDIO_RATE 16000
// GPIO33 is the small red board LED, active low; large GPIO4 flash stays off.
#define STATUS_LED 33
