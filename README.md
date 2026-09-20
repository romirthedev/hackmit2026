# Rewind

A memory helper for Grandma. Her phone clips to her shirt and records her day.
She talks to it ("Rewind, where did I leave my glasses?") and it answers out
loud, from what it actually saw. When she holds a postcard or a bill up to the
camera, the postcard lands in her Letters and the bill lands on her calendar,
on the big screen at home.

Everything runs on a local machine (an ASUS with a 35B vision model in the
demo). Deepgram handles hearing and speaking; nothing else leaves the house.

<p align="center">
  <img src="docs/screenshots/home.png" alt="Home dashboard: recording, Ask, calendar with a bill due, Letters with a postcard" width="900">
</p>

## What it does

**Records the day from a phone.** One tap on Record. The phone keeps the
screen awake, saves full video and audio, and sends one small photo per second
to the server for analysis. Uploads queue on the phone when the network drops.

**Answers questions, spoken and grounded.** While recording, the phone listens
for the wake word. Say "Rewind" and then the question. Deepgram Nova-3 turns
the clip into text, a filler line plays right away ("Let me look through your
day for that"), the local model answers from the recorded evidence, and
Deepgram Aura-2 reads a one- or two-sentence answer back. Every answer cites
the moments it came from. The dashboard has the same voice loop behind a tap
on the orb.

**Files mail by itself.** Tap Scan mail with a postcard and a bill in view.
The server reads both, then on the home screen a letter drops out of a cloud,
opens, and the postcard slides into Letters, message side up. A second letter
drops onto the calendar and tucks the bill into its due date. Ask "when is my
doctor's bill due?" afterwards and the answer comes from the scan.

**Two views of one home.** "My day" is for Grandma: big cards, a flippable
postcard, a calendar you can tap through. "Caretaker" is for family: alerts,
what she scanned, what she asked, device health.

<p align="center">
  <img src="docs/screenshots/letter-arrives.jpg" alt="A letter drops from a cloud, opens, and the postcard slides into the Letters card; then a bill lands on the calendar" width="900">
</p>

<p align="center">
  <img src="docs/screenshots/phone.png" alt="Phone: Record, Scan mail, and the voice card" width="260">
  &nbsp;&nbsp;
  <img src="docs/screenshots/print.png" alt="Printable demo mail: a postcard from Emma and a doctor's statement" width="560">
</p>

## Run it

Server (Python 3.11+, Ollama with a vision model):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e '.[audio,dev]'
python scripts/setup.py            # writes .env with fresh keys
ollama pull qwen3.5:35b-a3b-q4_K_M # or a smaller vision model for a laptop
ollama pull nomic-embed-text
```

Add to `.env`:

```bash
REWIND_DEEPGRAM_API_KEY=...        # spoken questions and answers
REWIND_VISION_MODEL=qwen3.5:35b-a3b-q4_K_M
REWIND_REASONING_MODEL=qwen3.5:35b-a3b-q4_K_M
```

Build the web app and start:

```bash
cd web && pnpm install --frozen-lockfile --ignore-scripts && pnpm build && cd ..
python -m uvicorn rewind.app:create_app --factory --host 0.0.0.0 --port 8000
python scripts/open_workspace.py   # opens a one-time sign-in link and prints a pairing code
```

| Page | What it is |
|---|---|
| `/` | Home dashboard. `#care` opens the caretaker view. |
| `/phone` | The recorder. Open it on the phone over HTTPS (camera and microphone need a secure origin). |
| `/print` | The two pieces of demo mail. Print at 100%, cut, scan. |
| `/workspace` | Full controls: Notch context, people, Mac commands, usage. |

Without a Deepgram key the server transcribes with faster-whisper and the
browser's built-in voice reads the answers. Everything else is the same.

## Demo script

1. Open `/` on the big screen and `/phone` on the phone. Tap Record.
2. Hold the printed postcard and bill in front of the camera. Tap Scan mail.
   Watch the home screen: postcard first, then the bill onto September 30.
3. Say: "Rewind, when is my doctor's bill due?" The phone says "Let me look
   through your day for that", then "Your copay of $45 for Dr. Shah is due
   September 30."
4. Say: "Rewind, what did Emma write to me?"
5. Tap the postcard on the home screen to turn it over. Tap the 30th on the
   calendar to open the bill.

The vision model reads the scanned photo with an 8-second deadline
(`REWIND_SCAN_MODEL_DEADLINE_S`). Because the demo mail is printed from
`/print`, the server also knows its exact text: fields the model misses are
filled from that template, and if the model is slow the template is used
outright. Each scanned document records whether it came from the model, the
template, or both. Set `REWIND_SCAN_DEMO_TEMPLATE=false` for real mail only.

## How it fits together

```
phone (/phone)                    server (FastAPI, port 8000)              home screen (/)
 Record: video+audio, 1 JPEG/s ──▶ /api/ingest/frame ─▶ worker labels frames
 Scan mail: 1 JPEG, intent=scan ─▶ /api/ingest/frame ─▶ vision model reads ─▶ /api/scans ─▶ letters drop
 "Rewind, ..." utterance ────────▶ /api/voice/hear (Deepgram Nova-3, wake word check)
                                    /api/voice/ask  (memory.ask over frames, audio, Notch, scans)
 plays filler + answer  ◀───────── /api/voice/speech/{id} (Deepgram Aura-2, cached mp3)
```

Recall stays evidence-only: the model answers from retrieved frames,
transcripts, connected Notch documents, and scanned mail, and must cite them.
The prompt asks for one or two friendly sentences in everyday words.

## Tests

```bash
.venv/bin/python -m pytest -q          # 270+ server tests, fake providers, no model downloads
cd web && pnpm exec tsc --noEmit -p . && pnpm exec oxlint app components lib
```

`server/tests/test_voice_scans.py` covers the wake word, spoken-answer
trimming, the scan template merge, the scan upload path, recall over scanned
mail, and the voice routes with a fake Deepgram.

## More

- [Voice and mail: design notes and limits](docs/VOICE-AND-MAIL.md)
- [Full setup guide: ASUS backend, ESP32 camera, wearable microphone](docs/SETUP-GUIDE.md)
- [Product brief](docs/PRODUCT-VISION.md) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md)
- [Phone and Notch setup](docs/PHONE-NOTCH.md) · [Hands-free details](docs/HANDS-FREE.md)
- [Evaluations](docs/evaluations) · [Research notes](research/README.md)

This is a working prototype, not a promise of perfect recall. Frames are one
per second; things out of view, missed captures, unclear speech, and model
mistakes are real. Originals are kept, failures are shown, and answers without
evidence say so.
