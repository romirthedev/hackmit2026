# Phone recording and Notch context

The product direction is recorded in [PRODUCT-VISION.md](PRODUCT-VISION.md).
The phone client is `/phone/`; the desktop workspace's System tab creates its
one-use QR invitation. The same authenticated workspace holds recordings,
Notch context, answers, and reminders.

## Run the Mac bridge

`integrations/notch` contains all 92 tracked files from the user's private
`romirthedev/notch` repository at revision
`6c74c30c31a2ce31a852209eba86f28c8371409e`. `UPSTREAM.json` records every original
file's hash. The original application, agent, assets, and graph remain included.
Local additions provide a read-only context export and a bridge-only launch mode.

Build and launch on macOS 14 or newer with Swift installed:

```sh
bash integrations/notch/scripts/build-app.sh
open -n integrations/notch/build/Notch.app --args --rewind-bridge
.venv/bin/python scripts/connect_notch.py
bash integrations/notch/scripts/run-rewind-control.sh
```

Generate `.env` with `scripts/setup.py` first if needed. The helper copies the
existing Notch capability token into the private server environment without
printing it. Bridge-only mode binds **127.0.0.1:8738** and serves only authenticated
GET/POST context requests. It does not start desktop automation, microphones,
calendar nudging, or model-driven memory consolidation. Launching Notch normally
still provides the complete upstream application on its original port.

The second process is the **actual Notch computer agent**, bound to loopback
port **8737** by `--rewind-control`. The launcher uses this Mac's signed-in Codex
and Astra through a separate ephemeral agent session. It can inspect files and
the current app, execute natural requests, and verify the result; this is not a
list of hard-coded app commands. Its permission prompts, progress, cancellation,
and final result are relayed to the paired workspace. Existing Notch permission
rules still apply, and macOS Accessibility/Screen Recording/Automation grants
must be available for the corresponding GUI operations. REWIND owns spoken
responses, so the launcher disables duplicate native speech and unattended vault
consolidation. The normal standalone Notch launch behavior is unchanged.

`connect_notch.py` saves both `REWIND_NOTCH_URL` (knowledge) and
`REWIND_NOTCH_CONTROL_URL` (actions), together with the existing private token.
The read-only bridge alone cannot execute a computer request. Keep both native
processes and REWIND running. The Mac performs the local actions; Codex inference
requires the existing signed-in account and an internet connection.

Restart REWIND after environment changes. Open **Connected life** in the dashboard
header (the link icon on the phone), then select sources
and tap **Connect Notch**. Calendar, Contacts, and Mail may display normal macOS
permission dialogs. The bridge reads the signed-in Mac user's sources; a Grandma
workspace needs her accounts and her Notch vault. Copying code does not connect
someone else's accounts automatically.

Sources currently exported:

- Up to 200 root-level markdown notes from `~/.notch`, including MOC, lessons,
  and journal, plus up to 200 saved skill names/descriptions. Script bodies,
  credentials, and agent session files are excluded.
- Calendar events from yesterday through seven days ahead, up to 500.
- Authorized Contacts names, email addresses, and explicit related-person fields,
  within the 2,000-document collection budget.
- The first 40 messages in Apple Mail's inbox, with at most 6,000 body characters
  per message. Sending and marking messages read are not part of the bridge.

Sync runs every minute while connected. A successful snapshot replaces the
cached source set; removed or changed sources invalidate cached answers using
them. Disconnect removes cached context and answers containing it. Original
Notch notes and account data remain in their native applications.

## Reach the phone over HTTPS

Camera, microphone, and screen wake lock require a secure browser context.
Use a reachable trusted HTTPS hostname. For a temporary development link:

```sh
cloudflared tunnel --protocol http2 --url http://127.0.0.1:8000
.venv/bin/python scripts/connect_notch.py --public-url https://YOUR-TUNNEL-HOST
```

Use the actual hostname printed by the tunnel, then restart REWIND. The tunnel
must target the authenticated REWIND API, **never the native Notch server**.
`REWIND_PUBLIC_URL` controls QR links; `REWIND_COOKIE_SECURE=true` protects browser
sessions over HTTPS. A temporary hostname changes when its tunnel restarts.
The tunnel process, API, Mac context bridge, and selected inference services
must remain running. The tunnel carries recordings/context through its provider;
a private trusted HTTPS deployment can replace it.

The current Mac preview instead uses **Tailscale Funnel**, since this network
blocks Cloudflare's port 7844. HTTPS/Funnel were enabled with the user's explicit
approval. It forwards `https://rewind-mac-client.tailccce39.ts.net` to the
authenticated API on port 8004. The userspace Tailscale daemon and API must stay
running. `tailscale funnel status` shows the mapping; `tailscale funnel
--https=443 off` disables it. On this development Mac, commands need
`--socket=data/tailscale-access/tailscaled.sock` before `funnel`.

Open the signed-in desktop workspace, choose System → Create phone QR code,
scan, allow camera/microphone access, and tap Record. Invitations expire after
ten minutes and work once. The phone receives a browser session, not the server
or Notch capability keys.

## Capture, questions, and reminders

The phone saves continuous video/audio originals, one JPEG per second, and
independently decodable speech utterances. Originals enter IndexedDB before upload;
two uploads run concurrently, with speech requests prioritized.
Retries keep the original stream ID, sequence, and bytes. A 150 MiB local queue
limit pauses recording visibly. Reloading preserves completed queued chunks;
the currently unfinished audio clip can be lost if the browser is terminated.

Screen wake lock keeps supported phones awake while this page is visible.
Switching apps, locking the phone, losing a media track, or hiding the page
stops recording explicitly. This browser prototype does **not** promise background
or locked-screen capture. Keep the page open and verify battery/temperature
on the actual phone before a long session. See
[MDN wake lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
and [camera requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

The orb records a microphone-only question, ending on a pause or a second tap.
It does not open the video camera. Under Your view, Camera saves a still photo
through the document-reading flow; Record starts continuous video/audio capture.
While recording, the orb reuses the microphone and pauses hands-free routing to
avoid submitting the same request twice. Greetings and general conversation have
an explicit conversation response type, separate from reviewed personal recall.

After Record, a pause in speech submits the utterance automatically. Directed
questions use evidence-grounded recall; direct Mac requests go to the actual Notch
agent. Typed requests use the same router. Speaker playback pauses request routing
to avoid hearing its own answer; full camera/audio recording continues. Original
images, audio, and digital source text can be opened under an answer. See
[HANDS-FREE.md](HANDS-FREE.md) for measured end-to-end tests and current limits.

Notch notes retain wikilinks and topic nodes. Exact unique contact email matches
connect people to mail/calendar; explicit related-person names connect contacts
only when uniquely matched. Text mentions in physical observations use dotted
edges and do not establish face identity. Digital retrieval currently uses
bounded lexical matches; it does not infer every personal relationship.

An actual, non-all-day event within 30 minutes produces one persistent reminder.
It updates its remaining minutes without repeating speech, and disappears when
canceled or rescheduled outside the window. Reminders are suppressed when sync
is over five minutes old. Enable the speaker button for spoken reminders while
the phone page is open. Background push notifications and travel-time routing
are not implemented. Calendar entries establish plans, not attendance.

## ASUS inference

The Mac can host the phone/API/context workspace and forward its configured
inference endpoints to the ASUS through authenticated Tailscale SSH. Keep those
model ports on loopback. [GX10-VISION.md](evaluations/GX10-VISION.md) records actual
model tests and the separate GPU runtime. Set labeling concurrency from measured
throughput and question latency; uploading in parallel is independent of GPU
inference slots. The temporary phone preview currently uses the Mac's 3B fallback
while the isolated ASUS benchmarks and 122B download run.

## One conversation for physical and digital life

The dashboard and phone orb submit voice and text to the same conversation
router. Saved surroundings and connected notes/calendar/mail/contacts use cited
memory retrieval and evidence review. Questions about current files, browser
tabs or app state, and requests to act on the Mac, use the actual Notch agent.
No separate mode or fixed command phrase is needed. A checked answer can be
followed by “pull that note up”; its full sources and original Notch identifiers
are handed to the agent as reference data, never as permission to act.

Active computer requests show native progress, a Stop control and the current
permission decision on both main screens. The connections panel exposes the
knowledge graph, source access state and Mac availability. In protected demo
mode, resetting live memories retains this independently connected knowledge
and its sync settings. Explicitly disconnecting Notch still removes its cache.

## Verified and pending

- Native Swift release build and signed app bundle succeed.
- On September 20, the signed-in Codex/Astra native bridge opened Calculator and
  verified its visible window in about 16 seconds. A follow-up was accepted while
  the first result was still displayed and correctly identified the current app
  in 4 seconds. Accessibility and Screen Recording were already granted on this
  Mac. These are measured examples, not a guarantee for arbitrary computer tasks.
- Full live browser checks answered from a connected note with reviewed sources,
  opened that exact note in TextEdit through a natural follow-up, and answered a
  phone question by inspecting the project folder. The protected medicine reply
  completed in 0.9 seconds. Live Mac requests varied from 6–36 seconds; a reviewed
  digital answer took 21 seconds. Arbitrary actions are not instantaneous.
- Thirty isolated browser cases cover conversation routing, action progress,
  stale permission rejection, Allow once, Stop, reviewed speech, reset protection
  and desktop/phone layouts down to 320 pixels.
- A public HTTPS browser check verifies pairing, certificate validation, a Secure/HttpOnly
  session cookie, and a configured Notch connection without starting personal capture.
- Browser automation verifies QR redemption, images/audio accepted by the real
  API, offline persistence, reconnect/reload upload recovery, and mobile layout.
  It uses explicitly synthetic browser media in a separate QA workspace.
- Backend tests cover source auth, graph links, grounded citations, cancellation,
  stale sync, rescheduling, and cached-answer removal. Production web build passes.
- Actual phone camera/microphone quality, account permissions, spoken playback on
  iOS, sustained capture, and end-to-end ASUS-backed phone answers still require
  live validation. No account contents or generated memories are seeded for a demo.
