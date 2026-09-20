# Continuous phone originals

The Record button now starts both a continuous camera-and-microphone recording
and the existing sampled inference stream. The browser requests 1280 × 720 video,
targets 1.5 Mbps video and 64 Kbps audio, and retains the bytes produced by
MediaRecorder. These are the original browser-encoded recordings, not raw sensor
data. Sampled JPEGs and silence-separated speech utterances drive live analysis.
The continuous recorder stays independent of speech detection and spoken replies.
See [HANDS-FREE.md](HANDS-FREE.md) for automatic questions and Notch commands.
Saving a full video does not mean every detail has been analyzed.

## Durability and playback

The continuous recorder requests a data event every two seconds. Its fragments
belong to **one container stream**; later fragments are not standalone videos.
Large delayed data events are split at 4 MiB transport boundaries without changing
their bytes. IndexedDB stores each fragment and its session progress in one
transaction before upload. Retries retain the session UUID, sequence and original
bytes. The server rejects conflicting retries, records SHA-256 hashes, and only
offers the complete original when every declared sequence is present.
Playback verifies saved SHA-256 hashes with bounded memory, rejects missing or
changed fragments, and checks file identity while streaming. Successful checks
are cached only for unchanged files. Recording data and renamed directory entries
are synced before acknowledging a durable upload.

Authenticated endpoints under `/api/continuous-recordings` provide a list,
per-session manifests, fragment uploads, finalization and exact ordered original
playback/download. The original endpoint supports byte ranges across fragment
boundaries. The phone's **Saved full recordings** disclosure links to recent
originals. Browser WebM recordings may have no finite duration/seek index until
remuxed; originals are never silently rewritten to add one.

`continuous_recordings.id` matches `media.boot` for the inference samples from the
same recording. `started_at`, `ended_at`, each fragment's `captured_at`, and the
sample timestamps let retrieval map sampled evidence back to its original session.
The fragment timestamp is delivery time, not a precise independent segment start.
Use encoded container timestamps when extracting an exact moment.

On Stop, the UI displays **Saving last seconds…** while the final data event and
completion marker are persisted. A hidden page stops recording explicitly.
Previously saved fragments retry after reopening; an unfinished session is closed
with an interruption reason. Where Web Locks is available, another tab cannot
start a second capture or mistakenly finalize the active tab's session.
After an active tab closes unexpectedly, another already-open tab recovers its
unfinished session when it next acquires the capture lock, without requiring a reload.

The upload spool stops capture at 120 MiB, reserving room up to the 150 MiB hard
limit for final data. Browser storage quota can be lower. A storage write failure
is reported as possible loss, not successful capture. Server quotas include full
originals and sampled media together. No originals are automatically deleted.

## Verified and remaining limits

Backend tests cover authentication, MP4/WebM headers, out-of-order upload,
idempotency/conflicts, missing fragments, interrupted finalization, storage and
request limits, and byte ranges crossing fragment boundaries.

A real Chrome MediaRecorder test with fake camera/microphone produced 1280 × 720
VP8 video and Opus audio. The test successfully played the reconstructed originals
after normal Stop, upload failure followed by reload/retry, and closing the page
mid-recording followed by recovery. No browser page errors occurred. Test media
and reports remain in ignored `data/continuous-recording-qa`, not in Git.
A second Chrome regression test opened another tab during active recording,
simulated loss of the first tab's completion callback, then started recording in
the already-open second tab. It recovered the prior session from `open` to
`complete` with a `page_closed` interruption reason before beginning new capture.

Physical iPhone/Safari and Android background behavior, battery/heat, day-long
recording, storage-pressure behavior, and actual network outages still need device
validation. A web page cannot guarantee capture while the phone is locked, the
browser is suspended, or the process is killed. An abrupt shutdown can lose the
current not-yet-persisted data event; the requested two-second timeslice is not a
hard bound imposed on the browser. A native capture application would be needed
for reliable supported background recording.

The existing one-frame-per-second inference can miss brief events even though
they appear in the full recording. Continuous originals preserve an opportunity
to inspect those events later; exact dense recall still requires retrieval and
source inspection of the relevant original time span. This feature does not
claim perfect recording, perfect understanding, or lossless model memory.
