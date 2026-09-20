# Orb, memory reset and demo layout — September 20, 2026

The Safari dashboard was served from `codex/ui-backend-integration`, three commits ahead of master. Changes preserve that running design and its Python API / ASUS processing architecture.

## Changes

- A second desktop orb/microphone tap finishes and submits the clip instead of aborting and discarding it. Silence still submits automatically. Explicit cancellation on unmount/sign-out never sends the clip.
- Resume the audio context inside the initial gesture, detect quieter speech, use elapsed silence time, release microphone tracks on every exit, and expose transcription as a distinct busy state with a bounded wait.
- Playback unlock happens after cancellation. No-evidence responses get an honest spoken explanation; unreviewed model answers remain silent.
- Calendar and Notes follow the primary controls in both dashboard views. Smaller gaps preserve the existing visual style. Phone Record remains visible at narrow widths.
- Memory is an un-underlined action on desktop and phone. The existing accessible alert-dialog primitive presents Cancel and OK, focuses Cancel, traps focus, and shows deletion errors. Only OK calls the authenticated reset endpoint.
- Reset removes local stored evidence and derived memory, stops connected-context sync, and prevents pre-reset offline uploads from restoring it. Other open views detect the cutoff and refresh. Original data in external source apps, pairing and configuration remain intact.
- The phone and desktop device card show real optional battery telemetry. When the browser does not expose battery data (including iPhone Safari), show `Battery —` with an unavailable explanation instead of inventing a number. Stale phone percentages are not displayed.

## Validation

- Backend: 301 tests passed; Python lint passed.
- Web: TypeScript and production build passed; lint passed for all changed web source files. Whole-repository web lint still reports existing violations in unrelated scaffold/UI files.
- Browser integration: all 10 existing cases passed, including real encoded video/audio retention, scan uploads, offline replay, sign-in, stale-response rejection, answer updates and source opening.
- Speech playback: all 8 cases passed, including blocked/no-start retries, reviewed-only automatic speech, cancellation and duplicate prevention.
- New orb/memory regression: real browser MediaRecorder data with deterministic recognition/review responses; manual finish submits once, failure permits retry, Cancel does not clear, OK clears, other views refresh, and battery unsupported/supported paths work.
- Responsive checks: Rose and Caretaker at 320, 390, 768, 1024, 1280 and 1440 pixels; phone at 320, 375, 390, 430 and 768 pixels. Checked overflow and visible Record controls; inspected screenshots.
- Live services in an isolated workspace: all four voice/mail cases passed against the ASUS Qwen3.5 model and Deepgram. Desktop microphone capture reached recognition, evidence review and actual audio `playing`/`ended` events. Phone Record reached hands-free transcription, a checked response and completed speech. Scanned bill/postcard animations and recall also passed.
- Safari on the running desktop: refreshed the updated page and checked opening/cancelling the Memory dialog. The actual workspace was not cleared. Its server was restarted with its existing configuration and seven processing workers; readiness and new route validation were checked.

Browser test audio/video uses synthetic fixtures. Actual iPhone hardware permissions, battery APIs and acoustic speaker output were not measured; browser viewport emulation is not a physical iPhone test. Test artifacts remain in ignored local `data/` directories and no credentials or personal recordings are committed.

Reproduce with the project's Python environment, Node and Playwright:

```sh
cd web
pnpm exec tsc --noEmit
pnpm build
cd ..
python -m pytest -q
python scripts/run_ui_integration.py
python scripts/run_ui_integration.py --script scripts/test_voice_playback.mjs
python scripts/run_ui_integration.py --script scripts/test_orb_memory_ui.mjs
python scripts/run_voice_mail_live.py --asus --env-file PATH_TO_LOCAL_SERVICE_CONFIG
```
