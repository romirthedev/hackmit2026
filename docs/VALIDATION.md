# Validation performed in this workspace

Date: 2026-09-19. Development host: macOS ARM64, Python 3.12. Unit tests inject deterministic model responses unless explicitly testing the HTTP provider adapter. A separate [real YouTube video evaluation](evaluations/YOUTUBE-VIDEO-2026-09-19.md) now records actual local model inference; it does not validate physical necklace capture or ASUS inference.

| Check | Result |
|---|---|
| Backend suite | 45 tests passed, including browser invitations, citation validation, pixel indexing, additive migration, provenance conflicts, generated variable-frame-rate video and delayed audio |
| Python lint | `ruff check server scripts` passed |
| Python source compilation | Passed |
| Dashboard type checking | TypeScript `--noEmit` passed |
| Production dashboard | Vinext static export passed; served by FastAPI |
| ESP32-CAM | PlatformIO compile/link success; ~15.9% static RAM, ~34.5% application flash |
| ESP32-CAM + INMP441 | PlatformIO compile/link success; ~15.9% static RAM, ~35.1% application flash |
| Live local API smoke check | Static dashboard, health, session login, authorized read/write, scene unavailable state, logout passed |
| Development proxy | Same-origin authenticated cookie writes passed |
| Credentials | Generated `.env` and firmware secrets are ignored; model/API keys are not in browser code |
| Latest September 19 interface rebuild | Actual pinned React Bits sources plus installed shadcn components; OGL and Motion bundled locally |
| Interface code checks | Changed React files passed Oxlint; TypeScript and the final production export passed |
| Updated production smoke check | Root page, seven linked production assets, seven authenticated read routes, 0000 0000 sign-in, remembered cookie, logout and unauthorized access passed on production and dev proxy; no recordings changed |
| Real local video inference | Qwen2.5-VL 3B, M5/16 GiB: 19 sampled frames plus complete audio processed, zero failed jobs; recall inaccurate/unusable, not an acceptance pass |
| ASUS connection attempt | `asus@10.189.60.212` timed out before authentication, including a separate Wi-Fi-bound TCP check; larger-model comparison not run |
| Final video-test code smoke check | Restarted production and isolated evaluation APIs; root/status, denied unauthorized access, test-code login, cookie access and logout passed on both ports |

The tests exercise auth separation, original storage, idempotent retries/conflicts, restart persistence, stale leases, per-frame job processing, failure/retry, bounded uploads, time filters, citation validation, voice question routing, monitoring cooldowns, deletion, sequence gaps, model request formats and malformed responses, and point-cloud export.

Not yet verified: physical FORIOT pinout, camera focus, battery lifetime, Wi-Fi/SD endurance, actual INMP441 wiring/audio quality, representative model accuracy, ASUS GPU/PyTorch/Ollama setup and latency, LingBot GPU inference, Docker execution, or comprehensive browser visual/interaction QA. The short Mac video tests are not a general accuracy benchmark. A limited browser check is recorded below.

Interface review covered stale-search cancellation, empty/error states, keyboard handlers, original-recording selection across polling, bounded thumbnail rendering, microphone permission/unmount cleanup, and reduced-motion paths. External component sites were inspected with computer use. This does not constitute browser interaction or visual QA of REWIND itself.

Browser authentication tests cover protected invitation creation, code/link single-use behavior, concurrent redemption, expiration and replacement, hashed storage, remembered-cookie duration, CSRF rejection, per-peer and global rate limits, persisted counters, and the reusable test code's opt-in/loopback restrictions. Device-token scope remains separate.

Live HTTP checks also verified reusable test-code sign-in/logout on both port 8000 and the development proxy, 30-day cookie duration, and the rebuilt production assets. The launcher created a real invitation and its ticket successfully authenticated; OS browser opening was stubbed during that check. Browser UI interaction testing had not yet been performed at that stage.

Known prototype limits are documented in README and architecture/hardware guides. In particular, no promise of perfect recall, perpetual capture, complete speaker identification, or real-time 30 fps reasoning is made.

## Latest sourced-component rebuild

- TypeScript `--noEmit` passed after the final source changes.
- Oxlint passed for every changed React file, including all vendored React Bits components and the new composition/navigation helpers. Whole-project lint still reports existing issues in untouched shadcn primitives, `brand.tsx`, `hooks/use-mobile.ts`, and `lib/api.ts`; those were not hidden or changed in this UI pass.
- Production static export passed. The bundler reports a client chunk above 500 kB after adding the shader/motion primitives; this is a size warning, not a compilation failure.
- Source review checked explicit form submit buttons, pairing-code sanitization, preserved magic-link handling, mobile navigation dismissal, actual image URLs, auth scopes, and animation cleanup.
- At that interface rebuild, the actual local app had not undergone browser visual or interaction QA. The later targeted check below covers only the video-memory additions.

## Open-source video integration follow-up

- Backend suite: **45 passed**, with two upstream Starlette/AnyIO deprecation warnings. `ruff check server scripts`, Python compilation and `git diff --check` passed.
- TypeScript, Oxlint on changed interface files, and the production export passed. The existing large client-chunk warning remains.
- Real OpenCLIP weights were downloaded once and subsequently loaded with the offline setup check. Real video tests, timings and factual failures are in [the comparison report](evaluations/OPEN-VIDEO-2026-09-19.md). These tests use separate databases and preserve the earlier failed baseline.
- Repeating the actual workday import with the same source/settings/start returned 33 duplicate receipts for 33 uploads, with no new recordings. Audio sample accounting was compared with an independent FFmpeg decode; the report records both the byte-identical zoo result and the small decoder-padding difference on the workday clip.
- Actual browser check on the isolated workday workspace: test-code login without remembered access, recorded-frame viewing, synthetic-clock labels, evidence dialog with source hash/frame/offset, and Device & storage's independent image-index counts. Visual inspection caught provenance overlapping the image; the flex-layout fix was rebuilt and visually rechecked. This was desktop spot checking, not a comprehensive responsive/accessibility audit.
- Physical wearable and ASUS tests remain outstanding. No further SSH attempt was made after the user requested stopping it.
