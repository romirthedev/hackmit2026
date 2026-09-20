# Mobile recording, history cleanup, and conditional mail routing

The mobile page now opens directly into Your day, with a tappable recording orb
and a visible Record/Stop button in the first card. Camera scanning follows it.
The Computer and Connections tabs and panels are removed from mobile; the desktop
workspace retains those tools. Existing voice routing, durable originals,
interruption handling, and evidence review remain connected.

The earlier cleanup only removed today's sampled events. It left older events,
spoken/text conversation history, and full recordings visible on the phone.
The user subsequently requested removal of all old history. The live workspace
was cleared while its API was stopped: 324 sampled media items, 10 answers,
10 conversation turns, five full recordings, and two scanned documents. Their
original files and dependent search/review rows were removed. Credentials,
account connections, settings, and unrelated account sources were retained.
The public phone was checked for zero old answers, recordings, scans, and turns.

A persistent reset cutoff rejects old captured frames, speech utterances, and
video sessions with HTTP 410. The phone discards these deliberately cleared
uploads from its offline queue, rather than retrying them into the workspace.
Fresh recording remains accepted. No personal data or credentials are committed.

## Scan behavior

Every Scan retains its actual camera JPEG. In hackathon mode, ASUS performs a
small visual classification first, without transcribing every detail:

| Visible content | Result |
| --- | --- |
| Ordinary objects/scene, shopping receipt, blank paper | Moments only |
| Personal letter/postcard | Matching fixed postcard details in Notes |
| Medical bill | Matching fixed bill details in Calendar |
| Both types | Both corresponding deliveries, one after the other |
| Recognition unavailable or timed out | Original in Moments, visible retry message |

Template details are marked `source=model+template`; only the recognized family
is instantiated. A letter cannot create a bill or vice versa. The explicit
desktop demonstration endpoint remains separate from camera classification.
The private ASUS processor's schema allowlist was updated to accept ScanDetection.

## Validation

- Backend: 299 tests passed, including all recognition branches, failure without
  invented mail, and rejection of old offline uploads after a history reset.
- Production build, TypeScript, scoped frontend lint, and backend lint passed.
- Browser integration: ten scenarios passed, including the orb, video originals,
  stale offline upload removal, late camera permissions, evidence refresh, and
  authentication interruption. Report:
  `data/ui-integration/browser-1789886806655/report.json`.
- Voice regressions: eight scenarios passed, including blocked output, explicit
  retry, no-start timeout, duplicate suppression, and hidden-tab behavior.
  Report: `data/ui-integration/voice-1789886855785/report.json`.
- Live browser layout and animation suite: four scenarios passed at 320–1440px
  and 200% zoom, including repeated real JPEG uploads with ASUS recognition.
  Report: `data/ui-integration/demo-1789886614452/report.json`.
- Six live camera-routing scenarios passed separately: ordinary scene, letter,
  medical bill, both, shopping receipt, and blank paper. They check actual saved
  JPEGs, recognition results, phone notices, and the corresponding desktop cards.
  Report: `data/voice-mail-live/run-1789886804/browser/routing-report.json`.
- Four live voice/mail scenarios passed with Deepgram, ASUS, Codex evidence review,
  and native audio `playing`/`ended` events. Phone recording begins by tapping the
  orb. Report: `data/voice-mail-live/run-1789886679/browser/report.json`.
- Public phone check: old history absent, removed tabs absent, orb accessible,
  and Record visible without scrolling at 390×844.

Live service tests use synthetic camera images and microphone speech through
Chrome media streams. They do not certify physical camera/microphone permissions
or acoustic playback on the user's actual iPhone. Test media and reports stay
under ignored `data/` and are separate from the user's cleared workspace.
