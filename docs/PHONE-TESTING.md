# Phone conversation and capture testing

Run tests against the built UI in a fresh local workspace. The default runner
copies the built assets, creates a temporary database, disables the model and processing workers, and
never loads the normal workspace's `.env`. It preserves API logs and browser
reports under ignored `data/ui-integration/`.

Use the project's virtual environment, a Node 22+ executable, and Playwright.
Set `NODE_PATH` if Playwright is installed outside this repository. Install its
Chromium and WebKit browsers with `playwright install chromium webkit`.
Build `web` with `pnpm --dir web build` before each browser run.

| Command after building | What it verifies | Deliberate substitutes |
| --- | --- | --- |
| `.venv/bin/python scripts/run_ui_integration.py --script scripts/test_phone_conversation.mjs` | Three consecutive phone orb requests through actual conversation routing, repeated typed chat, camera JPEG uploads, video originals, permission recovery, cancellation, delayed submission acknowledgement, interrupted speech, portrait and landscape layout in Chromium and WebKit | Synthetic media streams; deterministic STT and WAV TTS responses. Audio decoding and playback completion are real browser events. |
| `.venv/bin/python scripts/run_ui_integration.py` | Pairing, authenticated originals, offline retry queues, interrupted permission requests, source review state, and session expiry across phone and desktop pages | Synthetic camera/audio; selected network failures and review states |
| `.venv/bin/python scripts/run_ui_integration.py --script scripts/test_voice_playback.mjs` | Speech failure, gesture retry, timeout, history suppression, and duplicate-delivery prevention | Controlled browser speech callbacks and answer states; no acoustic claim |
| `.venv/bin/python scripts/run_ui_integration.py --script scripts/test_orb_memory_ui.mjs` | Desktop orb submission, recognition failure, responsive layouts, memory confirmation and battery display | Deterministic recognition/review responses |
| `node scripts/test_phone_storage.mjs` | Exact source bytes and MIME survive real IndexedDB writes and reloads in Chromium/WebKit; interrupted sessions recover, upload batches stay bounded, legacy Blob rows remain readable in Chromium | Synthetic 4 MiB original fragment and canvas JPEG; real storage events and byte hashes |
| `node scripts/test_native_speech_fallback.mjs` | Remote speech failure falls back to actual native speech for two successive responses in Chromium/WebKit | Forced HTTP 503; real native speech start/end events, no acoustic claim |
| `node scripts/test_microphone_capture.mjs` | Audio-only capture, shared-track preservation, pending permission cancellation, late-track cleanup and Safari resume ordering | Media API doubles; no hardware claim |
| `node scripts/test_speech_lifecycle.mjs` | Blocked-output recovery, cancellation, remote fallback, auth suppression and silent gesture priming | Media/speech API doubles; no playback or acoustic claim |
| `.venv/bin/python scripts/run_phone_conversation_live.py --env-file /path/to/service.env` | Synthetic utterance → browser microphone encoding → actual Deepgram STT → actual model routing/response → actual Deepgram TTS → browser playback completion, repeated three times in Chromium and WebKit | Synthetic source utterances and microphone streams; no substituted API responses |

`UI_TEST_BROWSERS=chromium` or `UI_TEST_BROWSERS=webkit` selects one engine for the
phone suites. Both run by default. `UI_TEST_FILTER` narrows deterministic scenario names while investigating a failure. `--node /absolute/path/to/node` selects Node
when it is not on the shell PATH. `REWIND_TEST_CHROME` optionally selects a Chrome
executable. No phone conversation test disables browser autoplay restrictions.

The four focused `node` checks bundle current source directly and do not require
a UI rebuild or the API runner. The browser checks use a temporary localhost origin; all four use only
synthetic data. Storage and native-fallback reports are written under ignored
`data/ui-integration/`. Native fallback may speak the synthetic test sentences.

The live runner copies only an allowlist of voice/model service configuration;
service environment variables override the supplied file. It requires an explicit
`REWIND_PROCESSING_URL` or `REWIND_OLLAMA_URL` and a Deepgram key. It never uses
personal memory, calendars, accounts, the computer-control bridge, or live
recordings. Its temporary workspace is deleted after the run. Reports contain
only synthetic transcripts and answers. Credentials must never enter reports or
commits.

Browser automation cannot establish physical-device camera permissions, actual
microphone acoustics, speaker volume, Bluetooth routing, screen locking or iOS
background restrictions. Desktop WebKit with a mobile viewport is useful engine
coverage, not an iPhone Safari certification. Before declaring physical-phone
support verified, test this sequence on an actual iPhone Safari and Android
Chrome session:

1. Open the phone page; tap the orb; allow the microphone; ask for the assistant's
   name. Confirm a conversational text response and an audible spoken response.
2. Ask two further questions, including a follow-up. Confirm all three responses
   appear and speak once, and the orb becomes ready after every turn.
3. Tap Camera, allow the camera, and confirm a still photo saves. Tap Record and
   confirm a live camera preview, then stop and reopen the retained original.
4. Deny microphone/camera permission once and retry after enabling it. Confirm
   the message identifies the denied permission and another control still works.
5. Switch away during capture, return, and confirm the interrupted state is
   visible. Check a narrow portrait viewport and landscape without clipped
   controls or horizontal scrolling.

Do not equate a unit-test count with end-to-end success. A useful test report
identifies the browser engine, exercised user action, actual service boundaries,
substituted inputs, observed result, and remaining device-specific validation.
