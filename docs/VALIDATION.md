# Validation performed in this workspace

Date: 2026-09-19. Development host: macOS ARM64, Python 3.12. Server tests inject deterministic model responses unless explicitly testing the HTTP provider adapter. No real model inference or real camera footage was claimed.

| Check | Result |
|---|---|
| Backend suite | 22 tests passed |
| Python lint | `ruff check server scripts` passed |
| Python source compilation | Passed |
| Dashboard type checking | TypeScript `--noEmit` passed |
| Production dashboard | Vinext static export passed; served by FastAPI |
| ESP32-CAM | PlatformIO compile/link success; ~15.9% static RAM, ~34.5% application flash |
| ESP32-CAM + INMP441 | PlatformIO compile/link success; ~15.9% static RAM, ~35.1% application flash |
| Live local API smoke check | Static dashboard, health, session login, authorized read/write, scene unavailable state, logout passed |
| Development proxy | Same-origin authenticated cookie writes passed |
| Credentials | Generated `.env` and firmware secrets are ignored; model/API keys are not in browser code |

The tests exercise auth separation, original storage, idempotent retries/conflicts, restart persistence, stale leases, per-frame job processing, failure/retry, bounded uploads, time filters, citation validation, voice question routing, monitoring cooldowns, deletion, sequence gaps, model request formats and malformed responses, and point-cloud export.

Not yet verified: physical FORIOT pinout, camera focus, battery lifetime, Wi-Fi/SD endurance, actual INMP441 wiring/audio quality, real model accuracy or latency, ASUS GPU/PyTorch/Ollama setup, LingBot GPU inference, Docker execution, or browser visual/interaction QA. Browser QA was not requested; the dashboard was type-checked, built, and its server responses checked.

Known prototype limits are documented in README and architecture/hardware guides. In particular, no promise of perfect recall, perpetual capture, complete speaker identification, or real-time 30 fps reasoning is made.
