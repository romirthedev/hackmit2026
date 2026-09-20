# Voice and hackathon mail demo

RaghavOjha’s original dashboard from `e21b9bf` (`origin/ui-mobile`) is restored,
including all thirteen Rose widgets and the caretaker views. Voice and mail are
integrated into that layout. Lifestyle widgets retain the original hackathon fixtures;
recordings, voice answers and scanned mail use the real server. The detailed restoration and validation
record is [UI voice restoration](evaluations/UI-VOICE-RESTORE-2026-09-20.md).

## Demo flow

1. Open the phone QR and press Record. The deployed hackathon workspace uses
   `REWIND_BROWSER_OPEN_ACCESS=true`, so `/phone/` opens directly without a code
   or sign-in. Its QR is reusable and does not expire. This opt-in setting grants
   workspace access to anyone who can reach the server; private installations
   retain authenticated access by default.
2. Ask “Rewind, when is my doctor bill due?” after scanning the demo mail.
   Clear personal questions also work without the wake word. Contextual
   follow-ups and computer requests retain the existing conversation router.
3. Scan uses the phone camera and saves the image. With
   `REWIND_SCAN_DEMO_TEMPLATE=true`, it immediately files the two fixed print
   documents. The postcard flies to Notes and the bill to September 30 on the
   new calendar, without waiting for a vision service. Re-scanning replays it.
4. The original dashboard recall card also accepts a spoken question through
   its original dark orb or microphone button. Test voice and Retry voice remain available.

## Voice

Set `REWIND_DEEPGRAM_API_KEY` only in the ignored server environment. Nova-3
transcribes utterances; Aura-2 Thalia synthesizes speech. Phone utterances use
the durable conversation queue, which preserves originals and retries uploads.
Answers are spoken only after evidence review, keeping qualifications. Actual
playback start/end events determine delivery. Blocked or stalled output shows
an explicit retry. With no key, local Whisper and browser speech remain available.
Deepgram receives the audio submitted for transcription and response text for
speech synthesis. Wake-word checking happens after transcription.

## Fixed scan behavior

The user selected fixed mail for this hackathon demo. Template rows retain
`source=template`; no vision recognition is claimed. Originals are still saved.
The configured demo always files the known Emma postcard and $45 medical bill.
The calendar is within this workspace; this does not create an external calendar
event or write to an external notes account. Turning template mode off selects
the existing model-reading path, which reports failures instead of inserting
sample mail. General scanner accuracy is outside this demo's acceptance scope.

## Run checks

Build `web` first. Run `scripts/run_ui_integration.py` for isolated browser
regressions, or pass `--script scripts/test_voice_playback.mjs` for playback
regressions. `scripts/run_voice_mail_live.py --node /path/to/node` runs actual
Deepgram, local Ollama inference, signed-in Codex review and native browser audio
in an isolated synthetic workspace. Set `NODE_PATH` to the installed Playwright
packages if needed. It requires ffmpeg and Chrome. No personal recordings are
used by the live browser harness.

Use `--asus --env-file data/phone-demo.env` to require the live ASUS model through
Tailscale, without a local inference fallback.

For the direct-access layout and repeated animated deliveries, run
`scripts/run_ui_integration.py --open-workspace --script scripts/test_demo_ui.mjs`.
It checks six screen widths, 200% zoom, independent browser contexts, two scans,
postcard flip/original viewing, persistence, and the reusable phone QR.
