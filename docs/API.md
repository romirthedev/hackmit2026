# API / device protocol

All endpoints are under `/api`. Device upload and heartbeat require:

```text
Authorization: Bearer <REWIND_DEVICE_TOKEN>
X-Device-ID: necklace-01
```

Workspace endpoints require the distinct `REWIND_ADMIN_TOKEN` as a Bearer token, or a session from `POST /api/login` with JSON `{ "token": "..." }`. Browser requests use the same origin; do not put credentials in query strings. There is no public recording endpoint.

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
