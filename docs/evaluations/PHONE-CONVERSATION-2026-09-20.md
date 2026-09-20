# Phone conversation and capture acceptance — September 20, 2026

The repaired phone flow passed repeated conversation, spoken response, photo and
video capture checks in Chrome 153.0.8010.50 and desktop WebKit 26.5 with mobile
viewports. The final phone suites recorded no JavaScript errors or console
errors. These are browser-engine results, not physical iPhone or Android
certification.

## Actual service path

Six turns passed through the built phone UI, browser microphone encoding,
Deepgram transcription, the actual ASUS model service, Deepgram synthesis and
native browser playback completion. No conversation, transcription or synthesis
response was replaced in this tier. The source utterances were synthetic audio,
played into browser MediaStreams; no personal recordings or accounts were used.

The model was `qwen3.5:35b-a3b-q4_K_M`, reported as ready on ASUS via Tailscale.
Each browser completed these consecutive turns:

1. “Hi, can you hear me? What's your name?” — introduced itself as Rewind.
2. “Tell me a short joke.” — gave a joke rather than searching recordings.
3. “Tell me another one.” — gave another joke using conversational context.

Each answer appeared in the UI and completed actual browser audio playback.
Elapsed time from orb tap through the end of the spoken response was approximately
15–23 seconds, including the synthetic question, silence detection and answer
audio duration. Neither engine requested a camera from the orb.

Canonical live report:
`data/ui-integration/phone-live-1789893484/report.json` — **6/6 passed**.

## Browser regression matrix

The deterministic tier used the real isolated backend for pairing, conversation
routing, turn state, uploads and retained originals. Microphone/camera streams
were synthetic. Only STT and TTS network results were fixed; audio recording,
decoding, playback events, UI actions and backend persistence remained real.

Eight scenarios passed in both browser engines:

- Three successive orb questions returned conversational text and completed audio.
- Successive typed questions returned new responses through the actual backend.
- A completed answer arriving before delayed submission acknowledgement was shown
  and spoken once, including when it arrived in the first history poll.
- A microphone denial remained visible across normal status polling; Camera then
  saved a JPEG and Record saved a new continuous video. Downloaded video matched
  actual MediaRecorder output **byte for byte** in both browsers.
- Interrupting spoken output with the orb produced the new response without
  automatically replaying the interrupted answer.
- A denied camera request showed a useful error and the next permitted request
  saved a photo.
- Cancelling a pending camera permission request stopped tracks returned later
  and never began recording.
- Controls fit 320, 375, 390, 430 and 768 pixel portrait widths and an 844×390
  landscape viewport, with no horizontal overflow and usable touch targets.

Canonical report:
`data/ui-integration/phone-conversation-1789893477258/report.json` — **16/16 passed**.
Screenshots and per-scenario state are in the same directory. An additional
2/2 layout smoke run verified the runner's frozen-build snapshot at
`data/ui-integration/phone-conversation-1789893553953/report.json`.

## Broader checks retained

| Suite | Result | Canonical local report |
| --- | --- | --- |
| Pairing, offline uploads, retained originals, auth races, source review transitions | 10/10; no JS or unexpected console errors | `data/ui-integration/browser-1789893228379/report.json` |
| Native speech callback failure, timeout, explicit retry, history suppression and duplicate prevention | 8/8; no JS or unexpected console errors | `data/ui-integration/voice-1789893228379/report.json` |
| Desktop orb, recognition error recovery, Rose/Caretaker responsive layouts, memory confirmation, battery honesty | 6/6; no JS errors | `data/ui-integration/orb-memory-1789893228426/report.json` |
| Actual ASUS scan routing for ordinary photo, letter, bill, combined mail, receipt and blank input | 6/6; no browser errors | `data/voice-mail-live/run-1789893285/browser/routing-report.json` |
| Actual voice, scanned source recall, evidence review and spoken checked answers | 4/4; no browser errors | `data/voice-mail-live/run-1789893523/browser/report.json` |

The final small speech change after those broader runs replaced the silent
unlock Blob URL with a fixed WAV data URL. Both affected phone suites and the
actual native-fallback helper were rerun after that change.

## Defects the added coverage exposed

The previous broad suite still asserted that the orb started video and still
looked for a Scan button. Those expectations did not cover the requested phone
conversation behavior. The revised tests distinguish orb, Camera and Record and
exercise repeated responses through the real backend.

WebKit also rejected Blob values in IndexedDB with an `UnknownError`. The upload
queue now persists original encoded bytes plus MIME type and recreates upload
Blobs on reading. A separate cross-engine storage regression verifies reload,
interrupted-session recovery and exact bytes. Legacy queued Blob rows remain
readable.

Strict browser-console checks found that revoking the silent unlock audio URL
immediately after `play()` could race WebKit's deferred media read. The fixed
WAV data URL removes that race; the final phone reports contain no corresponding
media-loader errors.

## Limits and reproduction

See [Phone testing](../PHONE-TESTING.md) for commands, deliberate substitutes and
the physical-device acceptance sequence. Test runners create fresh workspaces
and freeze the built client assets so another build cannot replace bundles
mid-run. Reports contain synthetic data and stay under ignored `data/`.

Physical camera permission prompts, microphone acoustics, speaker volume,
Bluetooth output, locking the screen and iOS background behavior still require
an actual device. Desktop WebKit playback events establish that browser audio
completed, not that a particular phone's speaker was audible to its user.
