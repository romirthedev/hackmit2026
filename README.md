# REWIND

**Phone-first personal memory, connected to Notch.** Scan a QR code, tap Record,
and clip the phone to your chest. Ask about recorded moments and connected
notes, emails, appointments, friends, and family in one workspace. Read the
[user-confirmed product brief](docs/PRODUCT-VISION.md) and the
[phone and Notch setup](docs/PHONE-NOTCH.md). The existing ESP32 camera is an
additional capture input.

**This is an implemented prototype, not a guarantee of perfect recall.** All received frames get their own AI job, including identical frames. The default capture rate is 1 JPEG/second, not 30 fps video. Events outside the camera view, missed captures, unclear speech, power loss, and model errors cannot be reconstructed reliably. Originals, processing failures, queue depth, device errors, and timestamp quality remain visible.

## Start here

- [Complete wiring, installation and startup guide](#connection-and-startup-guide)
- [What must stay running](#what-must-stay-running) · [Troubleshooting](#troubleshooting) · [Acceptance checklist](#acceptance-checklist-before-calling-the-setup-ready)
- [20-hour build and acceptance plan](docs/20-HOUR-PLAN.md)
- [FORIOT / ESP32-CAM hardware and wireless setup](docs/HARDWARE.md)
- [Architecture, storage, and model deployment](docs/ARCHITECTURE.md)
- [Capture protocol and API](docs/API.md)
- [Research provenance and limitations](research/README.md) · [OMI/video-memory source audit and integration](research/VIDEO-MEMORY.md)
- [Real YouTube video test: local 3B results and ASUS comparison procedure](docs/evaluations/YOUTUBE-VIDEO-2026-09-19.md)
- [OpenCLIP/PyAV evaluation: zoo, first-person workday and held-out footage](docs/evaluations/OPEN-VIDEO-2026-09-19.md)

## What is implemented

| Component | Included |
|---|---|
| Phone capture | One-use QR pairing, one-button camera/microphone, foreground screen wake lock, durable offline queue, voice/text questions and inspectable sources |
| Notch context | Complete pinned upstream codebase, read-only Mac bridge, notes/contacts/calendar/Mail graph, shared recall, 30-minute appointment reminders |
| ESP32-CAM firmware | OV2640 capture, PSRAM, FAT32 microSD spool, Wi-Fi reconnect, retries, per-stream sequence IDs, heartbeat, clock sync, recording LED, pause command |
| Optional wearable microphone | INMP441 on I2S1; camera remains on I2S0; 8-second PCM16 chunks; spoken “Hey Rewind, …” question routing |
| Capture server | Authenticated bounded uploads, validation, atomic original storage, SQLite WAL transactions, duplicate/conflicting retry handling, disk budget enforcement |
| AI processing | One durable job per frame/audio clip; local Ollama vision and reasoning; faster-whisper transcription; optional OpenAI provider |
| Recall | Full-text, optional text and OpenCLIP pixel retrieval, time filters, temporal anchors, original evidence, validated citations, evidence-only fallback |
| Dashboard | Timeline replay, searchable recordings, original audio/image viewer, typed and spoken questions, answer playback, monitoring rules, alerts, device and storage health, deletion and metadata export |
| Home dashboard (`/`) | Light card grid with a wearer view (Rose) and a caretaker view. Polls `/api/status`, `/recordings`, `/answers`, `/rules`, `/alerts`; asks, rules, alert acknowledgement and capture pause call the same API. Falls back to labelled demo data when the server is unreachable or the browser is signed out. The original workspace lives at `/workspace`. |
| Phone (`/phone`) | Light, minimal scanner in the same card style: Record, Scan, and Ask. Scan takes one frame (opening the camera on first use), folds it into a letter that floats up into a cloud, and posts it through the existing `/api/ingest/frame` queue. The dashboard polls every 2.5s and drops the same letter out of a cloud into the Moments card. `pnpm demo:api` runs a stand-in API (`web/scripts/mock-api.mjs`) so both screens can be demoed without the server. |
| 3D | Separate, pinned LingBot-Map integration for a bounded static scan; point-cloud viewer and approximate observation markers |
| Deployment | Native startup, Dockerfile/Compose, systemd template, optional Caddy HTTPS, provisioning, doctor, benchmark, video importer, continuous desktop microphone recorder |
| Optional Elastic | Durable retrying event-index mirror. Core search and storage remain local SQLite; Elastic is not required and is not the current retrieval path. |

No synthetic memories or fake model results are used in the application. Tests use explicit fake providers to verify plumbing without charging API credits or downloading model weights.

## Connection and startup guide

For the primary phone experience, start with [phone and Notch setup](docs/PHONE-NOTCH.md).
The following steps cover the optional **ESP32-CAM** path and the shared ASUS
backend. Add the wearable microphone and 3D reconstruction after the core checks
pass. The [20-hour plan](docs/20-HOUR-PLAN.md) records the earlier hardware plan.

The commands below assume **Ubuntu/Debian Linux on the ASUS**, with a working NVIDIA driver, and run from this repository's root unless a different directory is shown. The ASUS model, operating system, GPU and actual FORIOT board still need physical verification. A Windows installation requires a separate deployment plan; these are not PowerShell commands. Text such as `/path/to/rewind`, `YOUR_ASUS_USER`, and `ASUS_LAN_IP` must be replaced with your actual values.

Quick navigation: [hardware](#1-gather-and-connect-the-hardware), [ASUS prerequisites](#2-prepare-the-asus-and-copy-this-project), [backend and keys](#3-install-the-backend-and-create-the-server-keys), [models](#4-install-ollama-and-download-the-open-weight-models), [start server](#5-build-the-dashboard-and-start-the-complete-server), [flash camera](#6-wire-provision-and-flash-the-camera), [battery test](#7-switch-to-battery-and-prove-wireless-recording), [audio and capacity](#8-verify-audio-questions-and-sustainable-performance), [wearable microphone](#9-optional-add-a-wearable-inmp441-microphone).

### 1. Gather and connect the hardware

| Item | Required connection / purpose |
|---|---|
| One ESP32-CAM with OV2640 and PSRAM | The current firmware uses the AI-Thinker pinout. Check the PCB markings against [HARDWARE.md](docs/HARDWARE.md). “FORIOT 3Pcs OV2640” alone does not uniquely identify the PCB. An OV2640 camera module alone is insufficient. |
| OV2640 camera ribbon | Insert fully into the board's camera socket with the board unpowered; close the latch. Use the connector's contact orientation, not the direction of the printed ribbon label, to determine orientation. |
| FAT32 microSD, preferably 16–32 GB | Insert into the ESP32-CAM's SD socket before powering it. Back up any existing files before formatting. exFAT is not the configured filesystem. Capture halts without a working card. |
| USB-to-UART adapter, or compatible ESP32-CAM-MB base | Connect to a computer with a **data-capable** USB cable for the initial flash. A charge-only cable cannot flash firmware. |
| Regulated 5 V power / USB battery bank | Powers the board after flashing. Use a suitable USB base or regulated 5 V/GND connection. A supply capable of at least 1 A gives practical headroom; actual consumption and runtime must be measured. |
| Private router or phone hotspot | Enable a 2.4 GHz network that permits clients to communicate. Join the necklace and ASUS to this LAN. The ASUS can use Ethernet to the same router. |
| ASUS computer | Connect its power supply, network and SSD. Keep it awake while capturing or answering questions. The AI models run here. |
| Computer or USB microphone | Connect to the computer where the browser/recorder runs. This is the initial audio path; the OV2640 has no microphone. |
| Optional INMP441 microphone | Required only for audio originating on the necklace. See step 9 for the separate wiring and firmware target. |

**Normal operating connections:**

```text
USB battery bank ── regulated 5 V ── ESP32-CAM + OV2640 + microSD
                                            │
                                   2.4 GHz Wi-Fi
                                            │
                                  private router/hotspot
                                            │
                                      ASUS computer
                                            │
                            REWIND API + dashboard :8000
                                │            │
                         SSD recordings   Ollama :11434
                                          Qwen + embeddings
                                │
                         faster-whisper on CPU

Computer/USB mic ── browser or recorder script ── REWIND API
Optional INMP441 ── ESP32-CAM ── same Wi-Fi upload path
Browser ── REWIND dashboard ── evidence, questions and spoken playback
```

There is **no USB connection from the necklace to the ASUS during use**. A power bank still connects to the necklace. While Wi-Fi or the server is unavailable, completed recordings accumulate on its SD card; inference and answers wait for reconnection. After weights are cached, the core local pipeline does not need an Internet connection, but live upload still needs the local network.

The current configuration supports **one provisioned wearable per server instance**. The three-board kit does not automatically create three independent users/cameras. Bring up one board first; separate devices/workspaces need additional configuration or separate server instances.

### 2. Prepare the ASUS and copy this project

Copy the project to a permanent folder on the ASUS, such as `~/rewind`. Include `server`, `web`, `firmware`, `scripts`, `deploy`, `docs`, `research`, `pyproject.toml`, and the dotfiles such as `.env.example`. Do not copy the Mac's `.venv`, `node_modules`, or firmware build cache; rebuild those on the ASUS. Do not assume the Mac path exists there.

For example, if SSH is already enabled, run this **on the Mac**, replacing the username and address:

```bash
rsync -av --exclude='.env' --exclude='.venv*' --exclude='node_modules' \
  --exclude='data' --exclude='.pio' --exclude='secrets.h' \
  --exclude='dist' --exclude='.git' --exclude='third_party' --exclude='models' \
  /Users/romirpatel/Documents/ChatGPT/hackmit/ YOUR_ASUS_USER@ASUS_LAN_IP:rewind/
```

This example creates a fresh ASUS workspace. Existing recordings are not migrated; their database contains absolute media paths. Keep any existing installation intact until a migration is explicitly planned.

On the **ASUS**, open a terminal:

```bash
cd ~/rewind
uname -m
python3 --version
nvidia-smi
free -h
df -h .
hostname -I
sudo apt-get update
sudo apt-get install -y python3-venv python3-dev build-essential git curl \
  ca-certificates xz-utils ffmpeg libgomp1 alsa-utils
```

Expected: Python **3.11 or later** (3.12 recommended), a visible GPU/driver, and enough disk for recordings plus model weights and temporary files. If `nvidia-smi` fails, fix the ASUS/NVIDIA driver installation before promising real-time inference. The 128 GB system RAM figure alone does not tell us GPU-accessible memory. A GB10/GX10 is ARM64; use compatible ARM64 software and vendor-supported drivers, not arbitrary x86 CUDA packages.

From `hostname -I`, select the address on the shared router/hotspot, not a Docker, VPN, or loopback address. Reserve it in the router's DHCP settings if possible. We use `192.168.1.20` as an **example only** throughout the guide. If that address changes, update the firmware URL and flash again.

#### Node and pnpm for building the dashboard

Check `node --version` and `pnpm --version`. The dashboard requires Node **22.13+**; the deployment uses pnpm **11.19.0**. If needed, this Bash block installs the latest Node 22 Linux binary for x64/ARM64 in your user directory, checks its published SHA-256 checksum, and installs pnpm:

```bash
(
  set -euo pipefail
  case "$(uname -m)" in
    x86_64) REWIND_NODE_ARCH=x64 ;;
    aarch64|arm64) REWIND_NODE_ARCH=arm64 ;;
    *) echo 'Unsupported architecture for this installer'; exit 1 ;;
  esac
  REWIND_NODE_TMP="$(mktemp -d)"
  cd "$REWIND_NODE_TMP"
  curl -fsSLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
  REWIND_NODE_FILE="$(awk -v arch="$REWIND_NODE_ARCH" '$2 ~ ("-linux-" arch "[.]tar[.]xz$") {print $2}' SHASUMS256.txt)"
  test -n "$REWIND_NODE_FILE"
  curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$REWIND_NODE_FILE"
  awk -v file="$REWIND_NODE_FILE" '$2 == file' SHASUMS256.txt | sha256sum -c -
  mkdir -p "$HOME/.local/rewind-node"
  tar -xJf "$REWIND_NODE_FILE" -C "$HOME/.local/rewind-node" --strip-components=1
)
export PATH="$HOME/.local/rewind-node/bin:$PATH"
npm install --global pnpm@11.19.0
node --version
pnpm --version
```

If you used this installer, add `export PATH="$HOME/.local/rewind-node/bin:$PATH"` to `~/.bashrc` so new Bash terminals find it. Distribution and checksums come from the [official Node download directory](https://nodejs.org/dist/latest-v22.x/). Node is needed to build the dashboard; the production server serves the built files without a separate Node process.

### 3. Install the backend and create the server keys

On the ASUS, from the project root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[audio,video,dev]'
python scripts/setup.py
```

`setup.py` creates a private, Git-ignored `.env` with two different random keys. It leaves an existing `.env` unchanged. Open `.env` in your editor and keep these roles distinct:

| Setting | Used by |
|---|---|
| `REWIND_ADMIN_TOKEN` | Dashboard login and computer recording/import scripts. Never put it in wearable firmware. |
| `REWIND_DEVICE_TOKEN` | Wearable uploads/heartbeat. Provisioning copies it into the private firmware header. |
| `REWIND_DEVICE_ID=necklace-01` | Must match the firmware's device ID. |
| `REWIND_PROVIDER=ollama` | Selects local open-weight inference. |
| `REWIND_OLLAMA_URL=http://127.0.0.1:11434` | Correct when Ollama runs on the same host as the native server. |
| `REWIND_VISION_MODEL=qwen3.5:35b-a3b-q4_K_M` | Model that analyzes every received JPEG. |
| `REWIND_REASONING_MODEL=qwen3.5:35b-a3b-q4_K_M` | Model that reasons over retrieved evidence. |
| `REWIND_EMBEDDING_MODEL=nomic-embed-text` / `REWIND_EMBEDDINGS=true` | Semantic retrieval in addition to full-text search. |
| `REWIND_OLLAMA_THINK=false` | Default structured inference mode to reduce latency. |
| `REWIND_WHISPER_MODEL=small.en` | English transcription; use an appropriate multilingual Whisper model for other languages. |
| `REWIND_WHISPER_DEVICE=cpu` / `REWIND_WHISPER_COMPUTE=int8` | Avoids requiring a compatible CUDA/CTranslate2 installation for audio. |
| `REWIND_WORKERS=1` | Internal AI worker count. Start with one; zero disables background processing. |
| `REWIND_DATA_DIR=data` | Originals, database and optional scene, relative to the project root. |
| `REWIND_MAX_STORAGE_GB=100` / `REWIND_MIN_FREE_GB=2` | Original-media budget and minimum free disk reserve. Model caches, database and microphone spool consume additional space. |
| `REWIND_TIMEZONE=America/New_York` | Workspace timezone exposed by the server; timestamps are stored as Unix time. Keep host/browser clocks correct. |
| `REWIND_COOKIE_SECURE=false` | For the initial localhost/HTTP setup. Set true only when serving the dashboard over trusted HTTPS. |

Keep `REWIND_OPENAI_API_KEY`, `REWIND_ELASTIC_URL`, and `REWIND_ELASTIC_API_KEY` empty for this setup. **No Codex connection or paid API key is required for the local pipeline.** Editing `.env` requires restarting the API. Changing the device token/ID additionally requires reprovisioning and reflashing the camera.

### 4. Install Ollama and download the open-weight models

On the ASUS:

```bash
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama
curl -fsS http://127.0.0.1:11434/api/tags
ollama pull qwen3.5:35b-a3b-q4_K_M
ollama pull nomic-embed-text
ollama list
```

The install command is from [Ollama's Linux documentation](https://docs.ollama.com/linux). If your Linux environment has no systemd, run `ollama serve` in a dedicated terminal instead; leave it running. Do not start a second copy when the service already owns port 11434.

Both downloaded names must appear in `ollama list`. Qwen3.5-35B-A3B Q4 serves vision and reasoning; the [Ollama package](https://ollama.com/library/qwen3.5:35b-a3b-q4_K_M) is about **24 GB on disk** and uses Apache-2.0 licensing. Runtime memory also includes the vision encoder, context and runtime overhead. Published model scores do not establish performance of this quantization on your ASUS. Keep the default model for bring-up and measure it before considering a larger model.

Whisper weights download on the first transcription. Step 8 runs a real audio test while Internet access is still available; only claim offline readiness after that test also succeeds with Internet disconnected. Keep Ollama on localhost for the native setup: the camera contacts REWIND on port 8000, **never Ollama directly**.

#### Optional direct image retrieval (recommended for visual recall)

OpenCLIP searches original pixels as well as the existing caption/transcript index. It can retrieve an image whose caption missed the object. It does not make descriptions or answers infallible.

```bash
python -m pip install -e '.[vision]'
python scripts/setup_visual.py --device cpu
python scripts/setup_visual.py --device cpu --offline
```

Set `REWIND_VISUAL_EMBEDDINGS=true` and `REWIND_VISUAL_DEVICE=cpu` in `.env` before starting/restarting the server. The pinned MIT LAION ViT-B/32 checkpoint is approximately 605 MB, plus PyTorch dependencies. Setup downloads it once; normal use requires the cached checkpoint. Existing frames are backfilled automatically, independently of their caption status. Device & storage shows indexed/pending/failed counts; **Retry failed jobs** includes this index. CPU was tested on the Mac; CUDA/MPS and the ASUS remain unverified. See [source inspection, attribution, and exact setup](research/VIDEO-MEMORY.md).

### 5. Build the dashboard and start the complete server

On the ASUS, with `.venv` activated:

```bash
cd web
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
cd ..
python scripts/doctor.py
python -m uvicorn rewind.app:create_app --factory --host 0.0.0.0 --port 8000
```

Leave this terminal open. Expected doctor checks: keys configured, dashboard built, transcription installed, and both Ollama models available. Doctor confirms installation/reachability; it does not prove successful inference. The frontend output is `web/dist/client/index.html`. FastAPI serves that dashboard and `/api` on the **same port**. Do not run `pnpm start` or `pnpm dev` for this production setup.

In a second ASUS terminal:

```bash
cd ~/rewind
source .venv/bin/activate
curl -fsS http://127.0.0.1:8000/api/health
```

Expected response: `{"status":"ok","version":"0.1.0"}`. This is API liveness, not AI readiness. With the server running, open your workspace without copying a key:

```bash
python scripts/open_workspace.py
```

This opens a **single-use sign-in link** in the ASUS browser and prints an **eight-digit pairing code** for another browser. On a Mac running REWIND, double-click **Open REWIND.command** for the same flow. The launcher reads the existing private server configuration automatically. The server must already be running; this command does not install models or start the API.

Invitations expire after 10 minutes. Generating a new invitation replaces the previous one, and using either its link or code consumes both. Sign-in links remember the browser for 30 days; code sign-in offers a checkbox for 30 days (unchecked: 24 hours). **Sign out** clears the current browser's cookie. The access key remains available under **Advanced: use an access key** for recovery and scripts.

To print a code without opening the ASUS browser, use `python scripts/open_workspace.py --no-browser`. An already connected browser can also create an invitation under **Device & storage → Connect another browser**. A copied link uses that browser's current server address: `localhost` links work on that same computer; on another computer, open the ASUS LAN URL or your SSH tunnel and enter the code instead.

**Optional local test code:** set `REWIND_TEST_LOGIN_CODE=00000000` in the private `.env` and restart the API to accept **0000 0000** repeatedly in the pairing-code field. This is an admin sign-in for local testing, not a single-use invitation. It requires a loopback client and a localhost/loopback Host, rejects forwarding headers, and still uses the attempt limit. The development frontend also binds only to loopback. The shared `.env.example` leaves this setting empty; leave it empty on deployed servers. Remove the value and restart to disable the test code. Existing browser sessions remain valid until logout/expiry or admin-key rotation.

Use **Import recording** to upload one real JPEG. Wait for its analysis, open the original evidence, and check that the description matches the image. While it is processing, run `ollama ps` to inspect whether the model is using the GPU. This is the first end-to-end inference check; an empty but working dashboard is not sufficient.

**Run one API process.** Do not add `--workers 4`, run a second native API against the same database, or run Docker and native REWIND on the same port. Internal job concurrency is controlled by `REWIND_WORKERS`.

#### Open the dashboard from the Mac or another computer

For basic LAN access, use `http://ASUS_LAN_IP:8000`. `localhost` on the Mac means the Mac, not the ASUS. Browser audio and some browser APIs require a secure context, so use ASUS-local localhost or an SSH tunnel for the full dashboard workflow.

If SSH is available, run this **on the Mac** and leave it running:

```bash
ssh -N -L 8001:127.0.0.1:8000 YOUR_ASUS_USER@ASUS_LAN_IP
```

Then open [http://localhost:8001](http://localhost:8001) on the Mac. This forwards the ASUS dashboard while allowing browser microphone access through localhost. Enter a pairing code generated **on the ASUS** or from an already connected ASUS workspace browser. No ASUS admin key needs to be copied to the Mac just for browser sign-in. Allow browser/OS microphone permission. The necklace still uses `http://ASUS_LAN_IP:8000`, not the tunnel address.

From a different LAN computer, `curl -fsS http://ASUS_LAN_IP:8000/api/health` must succeed before trying camera uploads. If it fails, check client isolation, the selected IP, server binding and the ASUS firewall. If UFW is already active, allow **TCP 8000 from the actual trusted LAN subnet**, for example:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8000 proto tcp
```

Replace that example subnet with yours. Do not enable/change the entire firewall blindly or forward this port from the Internet.

### 6. Wire, provision and flash the camera

Do all wiring with power disconnected. Start with the **camera-only `esp32cam` target**.

#### Programmer connections

A compatible ESP32-CAM-MB base may handle the serial wiring and boot buttons; seat the board according to its matching pin labels. For a separate USB-to-UART adapter:

| USB-to-UART / power connection | ESP32-CAM pin |
|---|---|
| UART TX, **3.3 V logic** | `U0R` / GPIO3 |
| UART RX, **3.3 V logic** | `U0T` / GPIO1 |
| GND | GND; also common with an external power supply |
| Regulated 5 V supply | `5V` |
| Temporary jumper | GPIO0 → GND, **only while entering/flashing download mode** |

Do not apply 5 V UART logic to GPIOs. An adapter's voltage selector may affect its power output without changing its UART logic: check its specifications. Powering the camera from a weak adapter's 3.3 V pin often causes resets. Use one adequate 5 V source; if using external 5 V, leave the adapter's power pin disconnected and share GND. Do not connect a bare LiPo directly; the board is not a charger/regulator for that wiring.

#### Use a flashing computer with a supported PlatformIO toolchain

Flashing can happen on the ASUS if PlatformIO supports its host/toolchain, or on the Mac with the USB programmer attached. For a GB10 ARM64 host, the Mac is the practical fallback if the pinned ESP32 toolchain has no suitable Linux ARM64 package. The running AI server can remain on the ASUS.

The provisioning script reads `.env` **on the flashing computer**. If flashing from the Mac, copy only the ASUS `REWIND_DEVICE_TOKEN` and `REWIND_DEVICE_ID` values into the flashing checkout's private `.env` using an editor. Do not generate a different device key and expect it to match the ASUS. The Mac's admin token does not matter for provisioning. Never commit `.env` or `firmware/include/secrets.h`.

On the flashing computer, from its project root with its Python environment activated:

```bash
python -m pip install platformio python-dotenv
python scripts/provision_firmware.py
pio device list
```

Answer the prompts with:

- **Wi-Fi name:** the exact 2.4 GHz SSID, including case/spaces.
- **Wi-Fi password:** that network's password; it is not echoed.
- **Server LAN URL:** for example `http://192.168.1.20:8000`, using the ASUS's actual LAN address. No `/api` suffix; no `localhost` or `0.0.0.0`.

The script writes `firmware/include/secrets.h`. If you choose HTTPS instead, it also needs the PEM CA certificate that signed the server certificate; see the HTTPS notes below. The firmware validates certificates.

For a board without automatic boot circuitry:

1. Connect GPIO0 to GND. Power the board and press/release RESET to enter download mode.
2. Close any serial monitor holding the port. Choose the programmer port shown by `pio device list`.
3. Build and upload with the command below. Replace the example port: Linux is often `/dev/ttyUSB0`; macOS is often `/dev/cu.usbserial-...` or `/dev/cu.usbmodem...`.
4. **Remove GPIO0 → GND after flashing**, then reset or power-cycle. GPIO0 becomes the camera clock during normal operation.
5. Open the serial monitor for initial boot diagnostics; exit with Ctrl+C before the next flash.

```bash
pio run -d firmware -e esp32cam -t upload --upload-port /dev/ttyUSB0
pio device monitor --port /dev/ttyUSB0 --baud 115200
```

On Linux, if access to the correct serial device is denied, check its group with `ls -l /dev/ttyUSB0`. If that group is `dialout`, add your user and then log out/in before retrying:

```bash
sudo usermod -aG dialout "$USER"
```

The serial monitor may be quiet on a successful boot; the **dashboard is the success check**. In **Device & storage**, expect a recent heartbeat, SD free space, and received recordings. Heartbeats normally run about every 10 seconds when networking is healthy. Boot errors such as `PSRAM required`, `Camera init failed`, or `FAT32 microSD required` must be resolved first.

### 7. Switch to battery and prove wireless recording

1. Confirm the ASUS API and Ollama remain running; keep the hotspot/router on.
2. Disconnect the programmer/computer cable. Remove the GPIO0 flashing jumper.
3. Power the necklace from the USB battery bank through the compatible USB base or regulated 5 V/GND wiring. Keep the camera lens uncovered and the SD inserted.
4. Observe **received** and **analyzed** counts increasing in the dashboard. Open several new frames to confirm they are current and readable. The small GPIO33 status LED depends on the clone's hardware; confirm its actual behavior.
5. Temporarily turn off the hotspot for 60 seconds while leaving necklace power on. Restore it. Confirm the device reconnects, its queued count drains, and previously buffered frames arrive. Wi-Fi reconnect attempts occur about every 15 seconds; a long upload or large backlog can delay apparent recovery.
6. Pause capture in the dashboard and wait for the connected device to receive the next heartbeat response. Let pending analysis drain; resume and verify new recordings appear.

The firmware captures SVGA JPEGs at a configured **one-second interval**, subject to actual camera/SD throughput. It creates one analysis job per received frame. It does not capture or understand every instant between those frames. Completed SD packets survive normal resets; interrupted partial writes are not guaranteed recoverable. SD-full errors stop new capture rather than overwriting old recordings.

Bring the camera online once after boot so its clock synchronizes. An offline cold boot has no reliable wall clock: those frames are labeled receive-time-only. The pause control cannot reach an offline necklace; physically powering it off stops capture immediately. Buffered records may still upload after pausing.

### 8. Verify audio, questions and sustainable performance

#### Computer microphone: fastest working audio path

Use the ASUS browser at localhost or the Mac browser through the localhost SSH tunnel. The microphone belongs to the computer running that browser.

1. Click the microphone recording button, grant permission, and say a known sentence such as “The prototype uses an OV2640 camera and I left my wallet next to the notebook.”
2. Click **Stop & save**. Conversation capture automatically stops at 60 seconds.
3. Wait for the clip to be analyzed. Open it, play the original, and compare the transcript. The first clip may take longer while Whisper downloads weights.
4. Type “What did I say about the prototype?” and open the cited audio evidence.
5. Use **Ask aloud**, speak a question, and click **Stop & save**. Questions stop automatically at 30 seconds. The answer appears after transcription and retrieval; use its speaker control for browser playback.

The supported pipeline uses local Ollama plus local faster-whisper. Browser speech playback depends on installed browser/OS voices; test a local voice before relying on playback offline. A spoken answer comes from the computer's speakers, not from the camera board.

#### Continuous computer/USB microphone

On the **ASUS**, run this in a separate terminal with `.venv` activated:

```bash
arecord -l
python scripts/record_microphone.py --input-format alsa --input default
```

If `default` is not the intended microphone, use the card/device shown by `arecord -l`, for example `--input plughw:1,0` for card 1/device 0. Stop another process that has exclusive access to that device if ALSA reports it busy. Speak, then confirm new eight-second audio clips and transcripts in the timeline.

On **macOS**, list AVFoundation devices, then use the audio index from that list:

```bash
ffmpeg -f avfoundation -list_devices true -i ""
python scripts/record_microphone.py --input-format avfoundation --input :0 \
  --server http://ASUS_LAN_IP:8000
```

FFmpeg's device-list command may exit nonzero after printing devices; this is normal. The Mac needs FFmpeg, this script's Python dependencies and microphone permission. Unlike firmware provisioning, the computer recorder needs the **ASUS admin token** in its checkout's `.env`. Use `--server http://localhost:8001` instead if routing through the SSH tunnel. Merely using `localhost:8000` on the Mac would contact a Mac server, if any.

Keep the recorder process running for continuous audio. It stores completed chunks under `data/microphone-spool` until upload succeeds. Ctrl+C closes the current segment and attempts a final upload; pending chunks remain for the next run. The spool has **no separate size cap**, so watch disk space during extended outages. The script does not restart itself if FFmpeg exits. Dashboard pause controls the wearable; stop this recorder separately and stop any active browser recording.

#### Measure the actual capacity

Pause wearable capture and stop continuous audio before the isolated benchmark. Run on the ASUS with a real camera JPEG, then resume and test the full workload:

```bash
python scripts/benchmark.py /path/to/real-camera-frame.jpg --repeat 3
ollama ps
```

The script prints vision latency and a suggested capture interval with headroom. It measures vision calls, **not** embeddings, transcription, rules or competing questions. Run a 10–15 minute rehearsal with those features active. Pending jobs should stay bounded and drain when capture pauses.

If latency exceeds the arrival rate, increase `CAPTURE_INTERVAL_MS` in `firmware/include/config.h`, then recompile/reflash. For example, 5000 means a nominal frame every five seconds; it also means fewer moments are recorded. Do not claim one-frame-per-second analysis unless the real queue demonstrates it. Keep the originals and pending jobs visible while catching up. `REWIND_EMBEDDINGS=false` reduces optional work and leaves full-text retrieval; restart the API after changing it.

For a visual acceptance test, place a wallet next to a notebook in clear view, move it, then ask where it was before the move. Confirm the answer against its original cited frame. For monitoring, create a request such as “Tell me when a red mug is visible,” then show the mug after creating the rule. Alerts appear in the dashboard; they are not phone push notifications. Live monitoring skips old backlog and uses a cooldown, so it is not a replay alarm over all past recordings.

### 9. Optional: add a wearable INMP441 microphone

Only wire this after camera-only capture is working. Disconnect power and the UART adapter before connecting the mic:

| INMP441 module pin | ESP32-CAM connection |
|---|---|
| VDD | **3.3 V**, not 5 V |
| GND | GND |
| L/R | GND, selecting the left channel |
| SCK / BCLK | GPIO13 |
| WS / LRCLK | GPIO12 |
| SD / DOUT | GPIO3 / U0R |

The firmware uses camera I2S0, microphone I2S1, and **one-bit SD mode** to make these pins available. GPIO12 is a boot strap and must not be pulled high during reset. GPIO3 is also UART RX: the mic output and programmer TX must not drive it simultaneously. Disconnect the mic's GPIO3 wire while flashing; afterwards disconnect the serial adapter's TX and reconnect the mic. A programmer base that still drives RX can also conflict even when used as a power base; use separate regulated power for this configuration.

Provisioning remains the same. Flash the microphone target:

```bash
pio run -d firmware -e esp32cam_mic -t upload --upload-port /dev/ttyUSB0
```

Remove the flashing jumper, restore the mic wiring with power off, and power up from the battery. Expect both JPEG frames and eight-second PCM16 WAV clips at 16 kHz. Play a clip and check for intelligible speech, clipping, silence and lost chunks. This wiring has been compiled but still needs testing on the actual board/breakout.

Say **“Hey Rewind, where was my wallet?”** at the beginning of a recorded segment. Recognition happens on the server after transcription. It is not a robust on-device wake-word engine: a phrase split across eight-second boundaries can be missed. The dashboard's **Ask aloud** action is the more predictable question path. The necklace has **no speaker or audio-output firmware** in this build; answers appear/play on the computer.

## What must stay running

| Process or device | Where | Required during use |
|---|---|---|
| Router/hotspot | Shared local network | Yes for upload/answers; SD buffers offline capture. |
| Battery-powered necklace | Wearer | Yes for wearable capture. |
| Ollama service (`ollama serve` if no service) | ASUS, port 11434 | Yes for visual analysis and reasoning. |
| REWIND Uvicorn process | ASUS, port 8000 | Yes; it contains upload API, background workers and built dashboard. |
| Browser | ASUS or connected client | Needed for UI and browser microphone; closing it does not stop wearable/server recording. |
| Continuous microphone script | Computer with that mic | Only if using continuous computer audio. |
| SSH tunnel | Client computer | Only if accessing via the localhost tunnel. |
| Node/pnpm or PlatformIO | Build/flashing computer | Needed for builds/flashing, not normal runtime. |
| Reconstruction command | CUDA-capable ASUS environment | Only when generating an optional 3D scene. |

The ASUS must stay powered and awake. A foreground API/recorder normally stops when its terminal/session closes. For the first demo, keep those terminals open; for unattended operation, install and test a service.

### Daily restart and shutdown

After the initial install/build, on the ASUS:

```bash
cd ~/rewind
source .venv/bin/activate
sudo systemctl start ollama
python -m uvicorn rewind.app:create_app --factory --host 0.0.0.0 --port 8000
```

Then reconnect the client/tunnel, start any continuous microphone script, and power on the necklace. There is no need to regenerate keys, redownload models or reflash every day. `bash scripts/run.sh` is a convenience installer/starter; it does not start Ollama or download models, and only builds the dashboard if its existing output is missing. After frontend edits, rerun `pnpm build` in `web`, then restart the API. After firmware or network-credential changes, flash again.

For a clean shutdown: pause connected wearable capture; stop the continuous/browser microphone; wait for its SD upload queue and server jobs to drain if possible; power off the necklace; then Ctrl+C the API. Pending durable server jobs resume on restart; an interrupted processing lease can take up to 15 minutes to expire before retry. Do not remove the SD or cut power mid-write if you can avoid it.

### Storage and backups

- `data/media/` contains acknowledged original JPEG/audio files; the SQLite database in `data/` indexes them. Keep the **entire data directory** together. Upload retries are deduplicated by device, boot, stream and sequence.
- Model caches are separate from `data/`. Ollama and faster-whisper need their weights retained for offline inference. The `models/` folder is used by the optional 3D download.
- The 100 GB original-media budget is not a whole-disk quota. Leave room for the database, model caches, temporary video decoding, builds and the computer microphone spool.
- Budget examples, not measured camera output: at 100 KB/JPEG and one frame/second, originals use about **8.64 GB/day**; mono 16 kHz PCM16 audio adds about **2.76 GB/day**. Actual JPEG size and runtime overhead vary. Twenty hours of battery life must be measured independently.
- To back up, stop the API and any computer recorder, then copy the complete `data/` directory and preserve `.env` securely. The dashboard's metadata export is not a backup of original media. Restoring to a different absolute path needs media-path migration; do not assume a copied database will find moved files.
- Use the dashboard's evidence deletion controls for intentional deletion. At server disk limits, uploads receive HTTP 507 and stay on SD; at SD limits, new capture fails visibly. There is no automatic oldest-recording deletion.

## Troubleshooting

| Symptom | Check and next action |
|---|---|
| Upload says it cannot connect to ESP32 | Correct data cable and serial port; close the monitor; GPIO0 grounded **at reset**; common GND; TX/RX crossed; stable 5 V. Check Linux serial permissions. |
| Flash succeeds, but board stays in download mode | Remove GPIO0→GND and reset. |
| Repeated resets / brownout | Use a reliable regulated 5 V supply and short power wiring. A weak 3.3 V programmer supply is insufficient. Check mic bootstrap conflicts. |
| `PSRAM required` | Confirm the actual board has working PSRAM and uses the `esp32cam` target. |
| `Camera init failed` or unusable image | Check board pinout, ribbon seating/orientation with power off, lens cover/focus, lighting and power. |
| `FAT32 microSD required` | Check FAT32 format, insertion and card health; firmware halts capture without SD. Do not format a card containing needed recordings without backing it up. |
| No device heartbeat | Check exact SSID/password, 2.4 GHz, private LAN/client isolation, ASUS IP, URL with `:8000`, API binding and firewall. Verify `/api/health` from another LAN device. |
| Device uploads get HTTP 401 / 403 | Device token or `REWIND_DEVICE_ID` differs between ASUS `.env` and flashed header. Reprovision from matching values and flash. Admin key is not a substitute. |
| Device queue never drains | Check heartbeat error, server reachability/free disk, HTTP rejection and corrupted SD packets. Inspect/back up the SD before deleting anything. A corrupt queued packet can block further uploads. |
| HTTP 507 | Server storage budget/reserve reached. Back up and deliberately remove unneeded evidence or increase capacity/budget; restart API after config changes. |
| Received rises, analyzed does not | Check `doctor.py`, Ollama service/model tags, worker count, pending/failed records and API logs. Received only proves durable ingest. |
| Ollama model missing / unsupported | Use a current Ollama version and pull the **exact** configured tag. `ollama list` must match `.env`. |
| Jobs fail or time out | Read the stored error; check GPU memory, CPU fallback, installed model and logs (`journalctl -u ollama -n 100 --no-pager`). API provider calls have a 180-second timeout. Correct the cause, then use **Retry failures**. |
| Pending count grows continually | Measure full-pipeline capacity; increase the capture interval and reflash. Don't increase worker count blindly on a memory-limited GPU. |
| Doctor passes but no useful recall | Doctor is reachability only. Upload real evidence, wait for successful analysis, check transcript/description and date filters, then inspect the cited original. |
| Dashboard unavailable / blank at root | Build `web/dist/client` before starting/restarting API. Run from the project root and check the terminal for startup errors. |
| Port 8000 already in use | Stop the older REWIND process intentionally or use a different port consistently in server URL, firewall, browser and firmware. Don't start parallel instances against the same data directory. |
| Login fails / immediately returns to login | Use the newest unused pairing code from the correct server; codes expire after 10 minutes. After too many attempts, wait one minute. Keep one browser origin; `COOKIE_SECURE=true` requires HTTPS. Sessions last 30 days when remembered, otherwise 24 hours. Advanced recovery uses the ASUS admin token, not the device key. |
| Browser microphone/import fails over LAN HTTP | Use ASUS `localhost:8000`, the client SSH tunnel `localhost:8001`, or trusted HTTPS. Grant microphone permission in both browser and OS. |
| Continuous microphone is silent / busy | List devices; choose the correct ALSA/AVFoundation input; check OS permission and other programs holding exclusive access; play original audio before debugging transcription. |
| INMP441 breaks boot or produces silence | Check 3.3 V, common GND, L/R low, correct `esp32cam_mic` image, GPIO12 not pulled high, and programmer TX disconnected from GPIO3. Fall back to computer audio for the demo. |
| Transcription fails on first clip | Verify `.[audio]` installed in the running Python environment, download connectivity/cache permissions, and CPU/int8 settings; retry the clip after fixing it. |
| Capture dates are wrong | Correct host clocks; allow server clock sync at wearable boot. A cold offline boot lacks a trustworthy timestamp and cannot recover one later. |
| No 3D scene | Core capture does not generate one automatically. Run the separate reconstruction command with at least eight overlapping frames and a compatible CUDA environment. |
| Model gives an incorrect answer | Inspect originals and timestamps. Better lighting/audio and clearer views help; no model configuration guarantees perfect recall or reconstructs unseen events. |

## Acceptance checklist before calling the setup ready

- [ ] Confirm actual board pinout/PSRAM, ASUS OS/GPU, SD format, power wiring and microphone path.
- [ ] Complete a real JPEG analysis and audio transcription with the selected local models.
- [ ] Battery operation produces at least 100 readable frames without USB to a computer.
- [ ] A 60-second Wi-Fi interruption buffers recordings; reconnection drains the SD queue.
- [ ] Ask one visual and one conversation question; verify both against original cited evidence.
- [ ] Restart the API and verify stored recordings remain and pending work resumes.
- [ ] Rehearse for 10–15 minutes with audio/questions; keep the analysis queue bounded at the chosen capture interval.
- [ ] Warm every required model, disconnect Internet while retaining LAN, and repeat visual/audio recall.
- [ ] Check real battery runtime and power-bank auto-sleep; a 20-hour build window is not a 20-hour battery guarantee.
- [ ] If included in the demo, independently pass wearable mic intelligibility and real GPU 3D reconstruction checks.

**Verification boundary:** the backend tests, dashboard type/build checks and both firmware compilations passed in development. Physical flashing/radio/power/audio, ASUS GPU inference, sustained throughput, Docker startup and reconstruction on the ASUS still require the hardware. The development Mac's running page is not proof that the ASUS or wearable is connected.

## Optional: import an existing video

Install `python -m pip install -e '.[video]'` on the importing computer and configure its `.env` (or `REWIND_ADMIN_TOKEN` environment variable) with the destination server's admin key. For a known recording start, convert the actual timestamp (including timezone offset) to Unix seconds, then pass it to the importer:

```bash
REWIND_VIDEO_START="$(python -c "from datetime import datetime; print(datetime.fromisoformat('2026-09-19T14:00:00-04:00').timestamp())")"
python scripts/import_video.py /path/to/video.mp4 \
  --start "$REWIND_VIDEO_START" --server http://localhost:8000
```

Replace the example date/time and video path. Change `--server` if importing remotely. The PyAV importer defaults to **1 sampled frame/second plus all audio**, matching wearable cadence. It preserves source presentation timestamps, variable frame rates, audio offsets, source frame numbers and fixed 30-second clip numbers. Add `--fps 0` for every decoded frame (108,000 jobs/hour at 30 fps). Decoding streams through bounded memory without a temporary JPEG directory. If the real recording time is unknown, add `--synthetic-clock`; import times must not be treated as event times. Rerunning the same bytes, sampling settings and start time resumes idempotently. An audit manifest is written under `data/imports/` (or `--manifest PATH`). The server retains uploaded samples; keep the source video for access to unsampled frames. The dashboard's file upload accepts JPEG/audio; use this CLI for video. See [the detailed integration guide](research/VIDEO-MEMORY.md).

## Optional: bounded 3D scan

This needs a **separate compatible PyTorch/CUDA environment** and the actual GPU; it is not required for visual/audio recall. Exact CUDA/PyTorch installation depends on the still-unconfirmed ASUS model. Follow the GPU vendor and [upstream LingBot-Map](https://github.com/Robbyant/lingbot-map) instructions for that platform before this step. Do not assume a generic x86 wheel supports GB10 ARM64.

`scripts/install_research.sh` uses `python3` to create `.venv-research` with `--system-site-packages`, installs pinned upstream revision `849e690bb086103637e44b1e91878d9d43a8bf0c`, and downloads the checkpoint. Run it with a base interpreter/environment providing the intended compatible PyTorch; verify the resulting research environment afterwards:

```bash
bash scripts/install_research.sh
.venv-research/bin/python -c "import torch; print(torch.__version__); print(torch.version.cuda); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
```

Expected: CUDA available and the correct GPU, without an unsupported-architecture error. Capture a slow sweep of a **mostly static** table with overlapping views. Record the scan's start/end Unix timestamps, select at least eight frames, and run on the ASUS:

```bash
.venv-research/bin/python scripts/reconstruct.py \
  --checkpoint models/lingbot-map/lingbot-map.pt \
  --data data --after RECORDING_START_UNIX --before RECORDING_END_UNIX --max-frames 64
```

Replace the two time placeholders with numeric Unix seconds. `--data` must point to the same directory as the native API. The command chooses up to the most recent 64 frames in the interval, writes `data/scene.json`, and reports the exported point count. Refresh the dashboard's **3D scene** tab. If inference runs out of memory, reduce `--max-frames` (minimum eight) and free competing GPU workloads; pause capture/processing before stopping Ollama models, or the worker may load them again.

This is a bounded static reconstruction, not continuous dynamic SLAM. Coordinates have arbitrary monocular scale. Observation markers are estimated surface anchors, not persistent object identities or guaranteed metric positions. Deleting evidence invalidates the scene cache. See [research provenance](research/README.md).

## Optional deployment alternatives

Use the native steps above for first hardware bring-up. These are separate paths, not extra processes to start alongside the native API.

### Unattended systemd service

The template [deploy/rewind.service](deploy/rewind.service) assumes code and a freshly built environment at `/opt/rewind`, a `rewind` user/group with home `/home/rewind`, a readable `/opt/rewind/.env`, and writable `/opt/rewind/data` plus `/home/rewind/.cache`. **It is a template; copying it unchanged does not install or move the project.**

For an already-working `~/rewind` installation, the simpler approach is to copy the template and edit it for that installation:

```bash
sudo cp deploy/rewind.service /etc/systemd/system/rewind.service
sudoedit /etc/systemd/system/rewind.service
```

Set `User`/`Group` to your actual user/group (`id -un`, `id -gn`); use full absolute paths for `WorkingDirectory`, `EnvironmentFile` and the Python in `ExecStart`; set `ReadWritePaths` to that installation's `data` folder and your user's `.cache`. Create those writable directories before starting; service files do not expand `~`. Stop the foreground API, then:

```bash
mkdir -p data "$HOME/.cache"
sudo systemctl daemon-reload
sudo systemctl enable --now rewind
sudo systemctl status rewind --no-pager
journalctl -u rewind -n 100 --no-pager
```

Repeat the real JPEG/audio checks under the service user: its permissions and model cache may differ from your interactive shell. Later use `sudo systemctl restart rewind` after `.env` edits and `sudo systemctl stop rewind` to stop it. This template manages the API only; Ollama has its own service and the continuous microphone recorder still needs its own running process.

### HTTPS for phone/remote-browser microphone access

[deploy/Caddyfile](deploy/Caddyfile) maps `https://rewind.local` to `127.0.0.1:8000` using Caddy's internal CA. To use it, install Caddy, arrange LAN DNS or client hosts-file entries so `rewind.local` resolves to the ASUS, configure Caddy with that file, and trust its root CA on each client. For systemd Caddy on Linux the CA is normally under its service account's data directory; use the [Caddy local HTTPS documentation](https://caddyserver.com/docs/automatic-https#local-https) to locate/install the correct root certificate.

A browser certificate warning is not a finished setup: resolve trust first. Then set `REWIND_COOKIE_SECURE=true`, restart REWIND, and use HTTPS consistently. If the necklace also uses HTTPS, reprovision it with that resolvable hostname and CA PEM and flash again; keep certificate validation enabled. The SSH tunnel is the simpler existing option for a Mac client. Do not switch the cookie flag to true while continuing to rely on LAN HTTP login.

### Docker Compose

The Compose file runs the API/dashboard with named data and Whisper-cache volumes and expects Ollama on the **host**. It overrides `REWIND_OLLAMA_URL` with `http://host.docker.internal:11434`. On Linux, the host's default loopback-only Ollama listener is not accessible from that bridge.

Before choosing Docker, configure Ollama's `OLLAMA_HOST` to listen on a host address reachable from Docker's host-gateway mapping, restrict access to trusted local/container traffic, and restart Ollama. This is a Docker networking change, not a `.env` fix; see [Ollama server configuration](https://docs.ollama.com/faq). Keep the native path if you do not need container deployment.

With Docker Engine and Compose installed, the models downloaded and that bridge connectivity configured:

```bash
python3 scripts/setup.py
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 rewind
docker compose exec rewind python scripts/doctor.py
```

The container's doctor must see Ollama/models, and a real frame must analyze. Container health only checks the API. The container runs as a non-root user. It uses its named `rewind-data` volume, **not the native checkout's `data/`**; native recordings are not automatically migrated. `docker compose down` keeps volumes; **`down -v` deletes them**. Avoid it if recordings must be retained. Docker deployment has not been exercised on the ASUS.

### Other providers and integrations

The current default remains open-weight local inference. The code also contains an optional OpenAI API provider (`REWIND_PROVIDER=openai`, API key and image-capable model) and an optional Elastic event-index mirror. Neither is needed for the setup above. The API provider sends data to that configured service; a Codex login does not configure it. Elastic is not the current retrieval path. See [architecture](docs/ARCHITECTURE.md) and the [API reference](docs/API.md) for those interfaces.

## Validation

```bash
pytest -q
ruff check server scripts
cd web && pnpm exec tsc --noEmit && pnpm build
cd ..
pio run -d firmware
```

Backend tests cover real HTTP routes and database/file storage with injected deterministic inference: auth boundaries, cookies/CSRF, idempotency, conflicts, persistence, failed jobs, stale leases, per-frame processing, malformed uploads, disk limits, citations, temporal filters, audio questions, wake phrases, alert cooldowns, deletion, sequence gaps, and reconstruction export. Both firmware variants are compilation targets. Hardware radio/power/audio quality, ASUS model accuracy and GPU latency, Docker startup, and 20-hour endurance still require the actual setup.

A [real local video evaluation](docs/evaluations/YOUTUBE-VIDEO-2026-09-19.md) used Qwen2.5-VL 3B on an Apple M5 with 16 GiB RAM. All 19 sampled frames and the full audio track processed in approximately 5 minutes 48 seconds, but recall was unreliable: source-format errors, incorrect speech recognition, and unsupported details remained. This setup cannot sustain 1 fps analysis. Valid citations establish a link to a recording, **not that the answer is factually correct**. The report includes the unchanged baseline, follow-up run, exact scope, timings, and reproduction commands. `scripts/evaluate_recall.py` saves actual responses and checks source links without pretending to grade factual accuracy.

The [OpenCLIP/PyAV follow-up](docs/evaluations/OPEN-VIDEO-2026-09-19.md) adds actual pixel retrieval, timestamped decoding and an isolated end-to-end runner. It processed a 30-second first-person workday segment (31 frames and complete decoded audio) without failed jobs, but only **1/7** answers fully met the prewritten criteria; it still invented a shift start and reversed an action sequence. The unchanged zoo questions improved to **1/6**, also a failure. A simpler eight-second outdoor sample passed **5/5** questions. These tiny tests show strongly scene-dependent performance, not a general accuracy endorsement.

## Dashboard controls

Open **Quick search** or press **Command/Ctrl+K** to find a recording or jump to a workspace section. The command palette searches all time; the main search and question composer use the selected date range. Press **Command/Ctrl+Enter** to submit a typed question.

Use the filmstrip beneath the camera preview to select a moment. In **Recent memories**, switch between grid and list layouts or filter the loaded recordings by Frames/Audio. In list view, Up/Down/Home/End move between recordings and Enter opens the original evidence. The processing strip shows actual saved, pending, and analyzed counts.

The voice control displays elapsed recording time. Questions stop at 30 seconds and conversations at 60 seconds; **Stop & save** ends recording sooner. Microphone permission and localhost/HTTPS are still required. Interface motion follows your system's reduced-motion setting.

The interface uses actual React Bits Aurora, Star Border, Spotlight Card, Animated List, and Count Up sources, together with the shadcn controls listed on 21st.dev. Use the sidebar toggle (or Command/Ctrl+B) to show or hide navigation. On small screens, navigation opens in a sheet. See [component sources, license notes, and implementation details](docs/UI-REFERENCES.md).

## Project layout

```text
firmware/             PlatformIO C++ camera and optional microphone firmware
server/rewind/        FastAPI, durable jobs, providers, retrieval and alerts
server/tests/         Backend and reconstruction-export verification
web/                  React dashboard, built with the Sites/Vinext scaffold
integrations/notch/   Complete pinned Notch app plus read-only context bridge
scripts/              Setup, provisioning, recording, importing, benchmarking, 3D
research/             Upstream attribution and integration boundaries
deploy/               systemd and HTTPS deployment templates
docs/                 Hardware, architecture, protocol and 20-hour runbook
```
