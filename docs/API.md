# API / device protocol

All endpoints are under `/api`. Device upload and heartbeat require:

```text
Authorization: Bearer <REWIND_DEVICE_TOKEN>
X-Device-ID: necklace-01
```

Workspace endpoints require the distinct `REWIND_ADMIN_TOKEN` as a Bearer token, or an authenticated browser session. Normal browser sign-in uses a single-use invitation; `POST /api/login` with JSON `{ "token": "...", "remember": true }` remains an advanced fallback. Browser requests use the same origin; do not put credentials in query strings. There is no public recording endpoint.

### Browser pairing

- `POST /api/pairing` requires existing workspace authentication and returns `{code, ticket, expires_at}`. A new invitation invalidates the previous invitation. The code has eight digits and is displayed with a hyphen. Both code and ticket expire after 10 minutes.
- `POST /api/pair` accepts `{code, remember}` or `{ticket, remember}`. It atomically consumes the invitation and sets the same signed HttpOnly, SameSite=Strict cookie used by normal login. `remember` defaults to true for pairing: 30 days instead of 24 hours. `REWIND_COOKIE_SECURE` still governs HTTPS-only cookies.
- Links use `/#connect=TICKET`. The frontend removes the fragment from browser history before exchanging the ticket in a JSON POST. Codes and tickets are stored only as keyed hashes, expire, and cannot be reused. Rate limits allow at most 10 attempts per peer and 50 total per minute, persisted across server restarts.
- `python scripts/open_workspace.py` uses the server checkout's configuration to create an invitation and open the link automatically. `--no-browser` prints only the code and server address. This never prints the long-lived admin key.
- Logout clears this browser's cookie. As with the original signed-session design, it does not revoke a stolen cookie elsewhere; rotating the admin token and restarting invalidates all sessions and outstanding invitations.
- Optional `REWIND_TEST_LOGIN_CODE` accepts a reusable eight-digit code through the same `/api/pair` route, still subject to rate limiting. It defaults to empty. It is accepted only for loopback peers with localhost/loopback Host and no forwarding headers. The frontend development server binds only to loopback so it cannot expose that local path as a LAN proxy. Normal one-time pairing still supports LAN clients.

## Upload original bytes

`POST /api/ingest/frame` (`image/jpeg`) or `POST /api/ingest/audio` (`audio/wav`, `audio/webm`, `audio/ogg`, `audio/mp4`). Raw binary request body, no multipart wrapper.

```text
X-Boot-ID: unique-boot-or-session-id
X-Sequence: 0
X-Captured-At: 1789822800.125
X-Intent: memory
Content-Type: image/jpeg
```

- Timestamps are Unix **seconds**, not milliseconds. `0` explicitly means capture wall time is unknown; server receive time is used and labeled.
- Sequence numbers are independent per `device + boot + kind`. The same tuple with identical bytes is an acknowledged duplicate. Different bytes receive 409. Change boot ID after reset.
- Intent defaults to `memory`; `question` is permitted only for audio.
- Maximum body: 20 MiB. JPEG limit: 16 megapixels. WAV: PCM16, at most 120 seconds, one/two channels.
- Successful response: HTTP 201 with `{id, duplicate, status}`. Delete local packet only after 200/201.
- Retry transient/network errors. On 507 retain the packet until storage is available. On 401/403 fix provisioning. On 400/409 inspect the packet rather than discarding evidence silently.
- Admin uploads are scoped to `computer`; device uploads are scoped to the provisioned device.

`POST /api/device/heartbeat`: JSON `boot`, `queued`, `dropped`, `uptime_ms`, `free_sd_bytes`, `rssi`, `error`. Response includes `server_time`, `paused`, and latest wearable question answer if any. No raw personal memory is exposed to the device key.

## Workspace routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Minimal unauthenticated liveness |
| GET | `/status` | Capture, queue, storage, device and error counts |
| GET | `/provider` | Configured local model availability |
| POST | `/capture/pause` | `{paused: true/false}` for the next device heartbeat |
| GET | `/recordings?before=…&limit=60` | Originals and processing state, newest first |
| GET | `/events?q=wallet&after=…&before=…` | Lexical + optional semantic retrieval |
| GET | `/events/{id}` | Full evidence metadata |
| GET | `/media/{id}` | Authenticated original bytes and audio range support |
| DELETE | `/media/{id}` | Remove original/index/derived answers and invalidate scene cache |
| POST | `/ask` | `{question, after?, before?}` → answer, evidence, mode, grounded flag |
| GET | `/answers` | Recent typed/wearable/browser voice answers |
| POST | `/retry` | Requeue failed jobs; originals remain untouched |
| GET/POST | `/rules` | List/create `{instruction, cooldown_seconds}` monitoring rules |
| DELETE | `/rules/{id}` | Remove a monitoring rule |
| GET | `/alerts` | Recorded live rule matches |
| POST | `/alerts/{id}/seen` | Mark alert read |
| GET | `/objects?label=wallet&before=…` | Matching observations, newest first |
| GET | `/scene` | Real reconstructed point-cloud JSON, or explicit unavailable state |
| GET | `/export` | Versioned metadata export (not raw media) |
| POST | `/logout` | Clear workspace cookie |

Use one server process. The upload lock and device configuration are intentionally scoped to one personal prototype; this is not a public multi-tenant ingestion service.

## Video provenance and visual retrieval

The PyAV importer uses the existing authenticated ingestion routes, adding an
optional `X-Video-Provenance` JSON header (maximum 2048 characters):

```json
{"source_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","source_offset":2.4,"source_pts":2400,"time_base":"1/1000","frame_index":17,"clip_index":0,"sample_fps":1,"clock":"synthetic"}
```

`X-Captured-At` remains required for this header. `clock` is `recording_start` for a
known recording start, or `synthetic` for an assigned import timeline. Frames have
zero-based decoded `frame_index`; audio sets it to null. `clip_index` is a zero-based
fixed time window, not a detected scene. `source_offset` is relative to the shared
video/audio origin; PTS and rational time base retain decoder timing. These fields
are stored as `provenance` and returned on recordings, events, search and evidence.
Retries with conflicting provenance fail with 409. Wearable uploads need no change.

With `REWIND_VISUAL_EMBEDDINGS=true`, `/events?q=...` fuses OpenCLIP pixel similarity
with lexical/text embedding ranks and may return saved frames without captions.
An optional `visual_similarity` field is a ranking score, not calibrated confidence.
`/status.visual_index` reports `enabled`, `model`, `total`, `indexed`, `pending`,
`failed`, and `average_ms`. `/retry` also returns `visual_retried`. Deleting an
original removes its vectors through the database foreign key.
