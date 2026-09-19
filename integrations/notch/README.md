# Notch

**The laptop is the assistant.** Notch is a voice-native computer-use agent
that lives in your MacBook's notch — not another chatbot, not another tab.
Hold the `fn` key, say what you want, and it works your apps like you would:
seeing the screen, clicking, typing, and verifying the result with its own
eyes.

https://github.com/user-attachments/assets/b8436d68-b78d-4bb1-9541-7e4f8704e63d

*This demo was fully recorded, generated, edited, and scripted by Notch — with
no human interaction.*

## What it does

- **Hold `fn`, just talk.** Push-to-talk from anywhere in macOS. The panel
  blooms out of the physical notch, streams your words live, and answers out
  loud (ElevenLabs voice, Apple fallback). Half-duplex by design — it never
  listens to itself. An Apple-Intelligence-style glow sweeps the screen edges
  while it works.
- **Real computer use.** It drives your actual apps — Safari with your
  signed-in sessions, Mail, Calendar, Sheets, Slack, Terminal — via
  AppleScript, Accessibility, and the keyboard/mouse.
- **Perceive → act → verify.** Screenshot before and after every UI action;
  it checks its own work before claiming success. "I clicked save" is not
  done; "the event exists, in the right color, verified in three week views"
  is.
- **Deictic context.** It knows what you're looking at. "Reply to *this*"
  works because the frontmost window rides along with every request.
- **Skills that compound.** Anything it figures out once it saves as a tested
  script and reuses forever (`~/.notch/skills`). First calendar task:
  minutes. Every one after: seconds.
- **A memory that grows.** A markdown vault (`journal.md`, `lessons.md`,
  `MOC.md`, per-topic notes) you can open as a graph in Obsidian — or in the
  built-in Command Center's physics-based graph view. A sleep-time
  consolidation pass distills each day into durable lessons.
- **Parallel workers + long-horizon tasks.** Big jobs spin up detached agent
  sessions (`~/.notch/sessions`) that outlive the panel; a task manager
  (`~/.notch/tasks`) tracks multi-session work, detects stalls, auto-resumes,
  and announces progress proactively.
- **Meeting mode.** Voice-activated: silently captures system audio (the
  other participants) plus your mic, transcribes continuously, and writes a
  timestamped transcript with AI meeting notes when you leave.
- **Live Translator.** Whatever your speakers are playing — a call, a video,
  a podcast in any language — becomes low-latency scrolling English captions
  under the notch.
- **Ambient awareness.** It speaks first when a calendar event is coming up.
- **Phone remote.** Scan a QR, get a notch-styled remote on your phone —
  send commands and watch live state from bed.
- **Self-modification.** Ask it to change its own source; it edits, rebuilds
  (`build/Notch.app.bak` kept as rollback), and relaunches itself. Several
  features in this repo were committed by Notch's own worker sessions.

## How it works

Notch is a thin native macOS body around a headless [Claude
Code](https://claude.com/claude-code) brain. Voice goes in through Groq
Whisper; intent runs through `claude -p` (stream-json) with a screen-context
block attached; actions come back out through AppleScript/Accessibility; a
screenshot loop closes the verification cycle. The window itself is an
`NSPanel` pinned to the physical notch geometry (pulled from real safe-area
insets — never hardcoded).

```
Sources/Notch/
├── Core/           state machine, view model, notch window geometry, edge glow
├── Voice/          push-to-talk, Groq transcription, TTS, meeting + translator modes
├── Agent/          Claude Code invoker, sessions, skills, task manager, workers
├── Context/        screen context (frontmost app/window, deictic layer)
├── Actions/        AppleScript runner, permission preflights
├── Ambient/        calendar nudger, memory consolidation scheduler
├── Remote/         local HTTP remote-control server (+ phone remote page)
├── CommandCenter/  hub window: sessions, request log, vault, memory graph
└── UI/             the panel (bloom, shimmer, steps, waveform, captions)
```

## Getting started

Requirements: Apple Silicon Mac (a notch helps; a synthetic one is drawn on
other displays), macOS 14+, Xcode Command Line Tools (no Xcode needed), and
the `claude` CLI (`npm i -g @anthropic-ai/claude-code`, then
`claude setup-token`).

```bash
git clone https://github.com/romirthedev/notch && cd notch
scripts/build-app.sh --run
```

First launch requests Microphone, Accessibility, Screen Recording, and
Automation permissions — grant all four; they are the product. Run
`scripts/setup-signing.sh` once to create a stable `Notch Dev Signing`
identity so those grants survive rebuilds.

### Configuration — `~/.notch/config`

```ini
GROQ_API_KEY=...            # voice transcription + translation (required for voice)
ELEVENLABS_API_KEY=...      # spoken responses (optional; Apple voice fallback)
ELEVENLABS_VOICE_ID=...     # pick a voice (optional)
NOTCH_TTS=1                 # 0 = silent mode
NOTCH_MODEL=...             # override the agent model (optional)
NOTCH_AGENT_TIMEOUT=...     # per-task time budgets (optional)
NOTCH_CONSOLIDATE_HOURS=... # memory consolidation cadence (optional)
```

### Using it

- **Hold `fn`** and speak; release to send. `⌥Space` toggles the panel.
- Say "start meeting mode" / "translate this" to enter the live modes.
- Menu bar sparkle → Voice Responses, Phone Remote, Permissions.
- Scripting hooks (no permissions needed, work from Raycast/BTT/shell):
  `com.romir.notch.toggle`, `com.romir.notch.commandcenter` distributed
  notifications.
- Files it produces land in `~/NotchOutbox`.

### Remote API

A tokenized local HTTP server on port `8737` (token at
`~/.notch/remote-token`) exposes `/state`, `/command`, `/cancel`, `/graph`,
`/vault`, and `/outbox` — the same API the phone remote uses, handy for
scripting and supervision:

```bash
TOKEN=$(cat ~/.notch/remote-token)
curl -X POST "http://127.0.0.1:8737/t/$TOKEN/command" \
  -H 'Content-Type: application/json' \
  -d '{"text": "What is on my screen right now?"}'
```

## Also in this repo

- **`launch/`** — the Remotion-built launch film (typography, poses, SFX, and
  voiceover all generated programmatically). `cd launch && npm i && npx
  remotion render src/index.ts Launch out/launch.mp4`. Music: *DON'T STOP
  NOW!* by LOFIN & Jasq — an [NCS](https://ncs.io) release, free to use with
  this credit.
- **`demo/`** — the autonomous demo director: one command records the screen,
  drives Notch through its own remote API, then edits and narrates the
  footage into a finished demo video.

Built with Fable 5 in Claude Code.
