# UI and current backend integration — September 19, 2026

The `ui-mobile` design (`e21b9bf`, including the desktop card-grid dashboard)
is merged onto the tested backend at `b01a204`. The new home and phone screens
use the existing authenticated APIs. The complete workspace remains available
at `/workspace`, including measured model usage, original recordings, search,
Notch context, confirmed people, pairing, and Mac commands.

## Changes and fixes

- Kept continuous original video, automatic voice requests, persistent uploads,
  review-gated speech, authentication expiry handling, and local queue recovery.
- Replaced prototype dashboard content with real notes, reminders, confirmed
  people, recordings, rules, and alerts. Removed unused fake data and mock API.
- Scan captures a real camera frame and confirms local persistence before its
  animation. Queued uploads are distinct from server-saved evidence.
- Drafts refresh after evidence review. Sources open authenticated originals;
  slow successful responses cannot reopen a signed-out session.
- Added the `/workspace` server route and navigation to existing controls.
  Disconnected Mac commands stay disabled.
- Fixed overlapping connection labels, a hidden hero icon, phone Record-button
  and camera styling, and static-export navigation prefetch errors.
- Cancelling camera permission, hiding the page, and switching tabs before
  capture starts stop the pending capture. Active recording may continue while
  using the phone's other panels.
- Disabled inference now reports `analysis_ready=false`.

The processing models, retrieval, Notch bridge, verification pipeline, and
compression settings are unchanged by the UI merge.

## Validation

- Backend: **253 passed**, with two existing dependency deprecation warnings.
- TypeScript checking, production static export, focused frontend lint, and
  Python lint passed.
- Nine browser integration scenarios use the actual FastAPI routes with a new
  temporary database, synthetic camera/audio, and inference disabled. They cover
  root/phone/workspace pairing and one-use tickets; desktop/mobile/offline states;
  Record → automatic speech upload → Stop → authenticated original retrieval;
  real scan JPEG persistence through a 503 and retry; late camera permissions;
  disconnected Mac controls; pending/checked answers and one-time speech;
  inspectable citations; and serialized polling/401/stale-200 handling.
- Nine direct capture lifecycle checks cover stop/hide/dispose during pending
  permissions, denied permissions, durable scan retry after reload, and decoded
  original video. The retained original decoded at **1280 × 720**.
- Personal, caretaker, phone, and advanced workspace screenshots were inspected.
  The caretaker's four filters passed at **1440px and 320px**; phone screens
  passed at **390px and 320px**. No horizontal overflow or JavaScript errors.
- The auth regression also checks that expiry stops recording and polling while
  keeping queued video and the final recording marker for reconnection.
- Live deployment smoke checks: `/`, `/phone/`, and `/workspace/` returned 200;
  all **17** referenced static assets returned 200; status, recordings, and
  usage APIs rejected unauthenticated requests. Recording counts and backend
  configuration were unchanged, and the usage ledger remained enabled.

Before deployment the API was idle. The previous static app, private environment,
and SQLite database were backed up locally. Old hashed assets were retained so
already-open browser sessions can finish loading their existing bundles.

Run `python scripts/run_ui_integration.py` after building `web`, with Playwright
and Chrome available. The runner clears inherited REWIND configuration and
never opens the production environment or database. It also supports
`--client-dir` and `--node` for a staged build. Browser reports and screenshots
stay in ignored `data/ui-integration/`.

## Limits

Synthetic browser media validates capture, storage, and integration behavior.
Controlled answer-review responses validate UI transitions and speech gating;
they are not actual Astra/Sol judgments or an accuracy benchmark. This run does
not establish iPhone/Safari background capture, all-day endurance, or live Mac
action success. Existing model benchmark results remain applicable.

At deployment validation the ASUS `gx10-f3bc` was offline in Tailscale. The Mac
API and saved recordings remained available, but live model answers could not
be revalidated until that machine reconnects. The UI exposes this condition.

## Visual refinement follow-up

The home screen now gives recent original photos and a chronological list the
main column, with a compact question composer, reminders, and recent questions
alongside it. Secondary tools sit in a footer navigation. The caretaker overview
focuses on recording activity and reminders; its other sections retain the full
controls. The phone uses the same warm neutral palette, restrained borders, and
clear Record control. Decorative orbs, rainbow branding, floating shadows, and
the home screen's arrival animation have been removed.

This is a frontend change; capture, authentication, model processing, retrieval,
evidence review, and stored data retain their existing behavior. Empty and
populated home layouts were inspected at 1440, 768, 390, and 320 pixels. The
populated preview was read-only against existing recordings; private screenshots
remain in ignored local storage. All nine existing browser integration scenarios
passed against the rebuilt app, with only empty-state and offline-message
selectors adapted to the new presentation. TypeScript, frontend lint, and the
phone auth/capture regression also passed. Nine phone states were inspected at
320 and 390 pixels, with no overflow or JavaScript errors.
