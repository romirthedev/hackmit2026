# Restore the working UI and add voice and demo mail

The dashboard is restored directly from **RaghavOjha's `e21b9bf`** on
`origin/ui-mobile` (the `4448454` card grid plus phone/letter hand-off). This is
before the integration merge rewrote its widgets, not the journal or that merge's
reduced grid. `care-cards.tsx` is the original and `dashboard.css` adds only the Ask flex-sizing fix;
`rose-cards.tsx` only clarifies the simulated call label. All thirteen Rose widgets
and the original caretaker filters and widgets are present. The lifestyle fixtures are never inserted into live memory or used as
answer evidence. The user requested removal of the Demo widgets label. Recordings and answers still use the authenticated live hook.

The original dark orb now captures actual speech. Calendar and scanned Notes are
added without deleting the original widgets. Cloud/envelope hand-offs deliver each
fixed document. The phone retains the original card/orb/scanner styling plus the
durable recording, permission, connection, and spoken-answer controls.

Phone speech retains the durable conversation queue, Notch intent routing,
follow-up context, evidence review, and explicit playback retry. Deepgram Nova-3
transcribes captured utterances; Aura-2 reads responses. Playback completion is
based on native browser `playing` and `ended` events, with bounded timeouts.
Unreviewed answers remain silent. No API key is included in browser assets or Git.

The user explicitly selected a fixed hackathon scan. With
`REWIND_SCAN_DEMO_TEMPLATE=true`, Scan retains the camera photo and immediately
files the known postcard and medical bill from `/print`, without invoking vision.
The postcard flies into Notes; the $45 bill flies to September 30, 2026 on Calendar.
Rows explicitly retain `source=template`. Repeated scans replace the prior demo
copies and replay the arrival. Both documents remain recall evidence. This is a
fixed demo, not general document recognition or a write to an external calendar.

## Verification

- Backend suite: 292 passing tests, including fixed demo scans without vision
  and explicit failure reporting when template mode is disabled.
- Restored browser integration: 9 scenarios passed (pairing, camera, durable
  originals, scan upload/retry, evidence updates, disconnected controls and auth).
- Restored browser voice regression suite: 8 scenarios passed, including blocked
  output, no-start timeout, retry, duplicate suppression and hidden-tab delivery.
- Live Deepgram audio synthesis and transcription passed with a synthetic question.
- Live model + real Codex evidence review returned a verified bill due-date answer
  in approximately 10 seconds, and the protected speech route returned real MP3.
- TypeScript, scoped frontend lint, backend lint and production static build pass.

Browser end-to-end results and screenshots are saved under
`data/voice-mail-live/run-*/browser/` (ignored). Microphone test input is synthesized
speech through Chrome's fake audio device; native audio decode/playback events are
observed. This does not certify acoustic output or permissions on an actual iPhone.

The ASUS was initially offline because it had lost Wi-Fi. A local Qwen2.5-VL
3B run was used to diagnose the UI and voice path. After Wi-Fi was restored,
Tailscale and the SSH tunnel reconnected; both ASUS services were active and
`/health` reported the Qwen3.5 35B-A3B model ready. The private processor's inference
schema compatibility update was deployed with its previous files retained.
The running public demo was switched back to ASUS processing (7 workers), with
Deepgram and fixed template mail enabled. A separate live browser run explicitly
requires `processing_host=ASUS via Tailscale`; no silent local fallback is allowed.

A phone test reproduced the small router model asking which bill rather than
searching. Clear first-person memory questions now go directly to retrieval;
contextual follow-ups and computer commands still use the existing intent router.
The fast path never executes computer commands. Its regression tests pass.

## Final restored-UI run

- Browser integration: `data/ui-integration/browser-1789885121070/report.json` — 9/9.
- Voice regressions: `data/ui-integration/voice-1789885041540/report.json` — 8/8.
- Live ASUS + Deepgram: `data/voice-mail-live/run-1789885039/browser/report.json` — 4/4.
  Includes actual camera upload, visible postcard/bill flight, reviewed bill reply,
  reviewed postcard reply, and hands-free phone conversation with completed audio.
  No browser JavaScript errors were observed.

One preceding live run correctly withheld an unreviewed postcard answer when the
second reviewer process failed. A direct service check and the final end-to-end
run succeeded, including the corrected postcard answer. External inference and
speech services remain dependencies; failures are surfaced rather than treated
as successful voice playback.

## Direct phone access and final animation polish

At the user's request the running hackathon environment enables
`REWIND_BROWSER_OPEN_ACCESS=true`. Fresh browsers open the root and `/phone/`
without codes or invitations. `/api/pairing` returns a reusable direct phone URL
configuration in this mode; private deployments retain the original auth by
default. Cross-origin writes and device provisioning checks remain enforced.

The Ask input can shrink within its flex row and the send/microphone buttons
cannot shrink out of view. Layout checks cover 320–1440px and 200% zoom. The
calendar bill and postcard stay hidden until each envelope reaches its target;
landing triggers the date highlight, bill-row reveal and postcard shadow settle.
Two consecutive scans replace the fixed documents and replay both flights.

The direct-access demo checks passed all four scenarios in
`data/ui-integration/demo-1789885286988/report.json`: fresh independent desktop and
phone sessions, responsive Ask controls, two consecutive animated camera scans,
correct calendar month, document persistence without replay, original-photo
viewing, and a reusable QR without a code. The original-photo viewer now fills the
screen and has an accessible close button above the photograph. Sign-out controls
are hidden when open access is enabled.
