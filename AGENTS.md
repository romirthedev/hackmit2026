# Project direction

Read `docs/PRODUCT-VISION.md` before making product or architecture changes.
The user-confirmed direction is phone-first QR pairing and one-button recording,
connected to `romirthedev/notch` digital context and memory graph, with proactive
appointment reminders and evidence-grounded questions. Both layers belong to
one personal workspace. Preserve actual source evidence and clearly distinguish
implemented behavior from features awaiting live device/account validation.

The full Notch source is in `integrations/notch`; `UPSTREAM.json` pins its origin
and hashes the original copied files. Preserve this provenance when extending it.
Never commit personal account contents, credentials, recordings, or model weights.
