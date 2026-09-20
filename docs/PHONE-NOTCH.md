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
```

Generate `.env` with `scripts/setup.py` first if needed. The helper copies the
existing Notch capability token into the private server environment without
printing it. Bridge-only mode binds **127.0.0.1:8738** and serves only authenticated
GET/POST context requests. It does not start desktop automation, microphones,
calendar nudging, or model-driven memory consolidation. Launching Notch normally
still provides the complete upstream application on its original port.

Restart REWIND after environment changes. Select sources in **Your connections**
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

## Verified and pending

- Native Swift release build and signed app bundle succeed.
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
