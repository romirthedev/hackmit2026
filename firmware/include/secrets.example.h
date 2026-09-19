#pragma once
#define WIFI_SSID "YOUR_2_4_GHZ_WIFI"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
// Dedicated trusted LAN/hotspot: HTTP. For routed networks use HTTPS and ROOT_CA.
#define SERVER_URL "http://192.168.1.20:8000"
#define DEVICE_TOKEN "COPY_REWIND_DEVICE_TOKEN_FROM_ENV"
#define DEVICE_ID "necklace-01"
// Paste the PEM CA certificate for your server when using HTTPS. TLS is never insecure.
#define ROOT_CA ""
