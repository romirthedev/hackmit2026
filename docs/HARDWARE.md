# Hardware: FORIOT OV2640 / ESP32-CAM

## Required for untethered visual capture

1. ESP32-CAM with OV2640 and PSRAM, using the AI-Thinker pinout below. “FORIOT 3Pcs OV2640” may describe a kit; confirm the actual board markings and connectors.
2. FAT32 microSD card (16–32 GB is convenient). The firmware deliberately refuses to record without it; otherwise offline data would disappear on reset.
3. Regulated 5 V power from a suitable USB battery bank through the board's USB programmer/base or its 5 V/GND inputs. The board is **not** a battery charger. Do not connect a bare LiPo to 5 V or 3.3 V pins without a suitable regulator/charger.
4. USB-to-serial programmer or ESP32-CAM-MB base for the initial flash.
5. Wi-Fi/hotspot reachable by both the server and necklace. Use 2.4 GHz. Many event Wi-Fi networks isolate devices; a dedicated phone/router hotspot avoids that problem.

A battery removes the computer tether. It does not remove the need for power. Measure real current and battery life; no 20-hour battery runtime is claimed. At roughly 1 W average, 20 hours means about 20 Wh delivered before conversion losses. Bring a charged spare and test power-bank auto-sleep.

## Camera pinout used in this repository

| Signal | GPIO |
|---|---:|
| PWDN / RESET | 32 / unused |
| XCLK | 0 |
| SCCB SDA / SCL | 26 / 27 |
| D0–D7 | 5, 18, 19, 21, 36, 39, 34, 35 |
| VSYNC / HREF / PCLK | 25 / 23 / 22 |
| 1-bit SD CMD / CLK / DATA0 | 15 / 14 / 2 |
| Small red status LED (active low) | 33 |

The large white flash LED on GPIO4 is not used. GPIO33 is not present as an LED on every clone. Confirm the indicator works and add a visible recording indicator if your board differs.

Camera reference: [Espressif esp32-camera](https://github.com/espressif/esp32-camera). Platform and Arduino core versions are pinned in `firmware/platformio.ini`.

## Flash

1. Run `python scripts/provision_firmware.py`. It reads the device token from `.env` and prompts for Wi-Fi and the ASUS LAN URL without printing secrets.
2. Use `pio run -d firmware -e esp32cam -t upload`.
3. On boards without automatic boot circuitry, connect GPIO0 to GND **only for flashing**, reset, flash, then disconnect GPIO0 from GND and reset again. GPIO0 is the camera clock during normal operation.
4. Disconnect the programmer and power from the battery. `pio device monitor -b 115200` is useful while connected for initial checks; it never prints the Wi-Fi password or access token.
5. Confirm a heartbeat in **Device & storage**, then check actual received/analyzed counters.

## Optional conversation microphone

The OV2640 is a camera sensor, not a microphone. The quickest deadline-safe approach is the computer microphone. For a wearable INMP441 module, the optional compiled target `esp32cam_mic` uses:

| INMP441 | ESP32-CAM |
|---|---|
| VDD | 3.3 V |
| GND | GND |
| L/R | GND (left channel) |
| SCK/BCLK | GPIO13 |
| WS/LRCLK | GPIO12 |
| SD/DOUT | GPIO3 |

Camera uses I2S0; microphone uses I2S1. Keep SD in 1-bit mode. GPIO12 is a boot strap: it must not be pulled high during reset; the microphone WS pin must behave as an input. GPIO3 is UART RX: unplug the serial adapter after flashing so its TX does not drive the microphone data line. If your breakout or board conflicts, use a separate audio board or the computer fallback rather than improvising pin assignments.

Compile/flash with `pio run -d firmware -e esp32cam_mic -t upload`. This wiring and audio gain still need a physical test. Check clipping, intelligibility, dropped samples, SD contention, and chunk transitions. There is no speaker/amplifier included in the camera-only setup; answers play on the computer. A fully standalone speaking necklace requires additional audio output hardware and pin planning beyond this prototype.

## Offline behavior

Capture writes a header and original JPEG/WAV to `/queue` on SD before any network upload. Records include a random boot/session ID and independent sequence counters per stream. Only HTTP 200/201 removes a packet. A reset preserves completed packets; a partial SD write interrupted by power loss is not guaranteed recoverable. If the server has no space, HTTP 507 leaves the original on SD. If SD fills, new capture fails visibly; old recordings are never evicted to pretend recording continues.

Heartbeat reports on-device queue, failed captures, RSSI, free space, and error text. Reconnection retries every 15 seconds. Pause reaches a connected camera on the next heartbeat; it is not instantaneous and cannot remotely pause an offline device. For immediate physical privacy, switch the power off or cover the camera and disconnect the mic. After reconnect, buffered originals continue uploading.

Server time and NTP synchronize capture timestamps. A cold boot offline has no trustworthy wall clock: such recordings are explicitly labeled receive-time-only rather than assigned a fabricated capture time. Add an RTC if accurate cold-boot offline timestamps are a requirement.

## Wireless transport

On a dedicated trusted LAN, HTTP is the simplest bring-up path. On other networks, use HTTPS with the server's CA certificate in `ROOT_CA`; the firmware never disables TLS validation. Keep the server and model endpoints private. Do not expose port 8000 or Ollama directly to the Internet. This deployment is one wearer / one private workspace, not a multi-user service.
