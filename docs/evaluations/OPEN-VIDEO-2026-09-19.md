# Open-source video pipeline evaluation — September 19, 2026

**Pixel retrieval and timestamped ingestion work locally; the 3B answer model still fails factual recall.** This report preserves failures as well as improvements. Source association, completed jobs and the `grounded` flag are not truth checks.

## Integrated components

The [source/license audit](../../research/VIDEO-MEMORY.md) inspected OMI/OmiGlass, HKUDS VideoRAG, Screenpipe, OpenCLIP and PyAV implementations. This run uses the actual **OpenCLIP 3.3.0** inference library and pinned MIT LAION ViT-B/32 safetensors checkpoint, **PyAV 18.1.0** decoding/resampling, and the existing faster-whisper/Ollama pipeline. OMI, VideoRAG and Screenpipe were researched but their full stacks were not deployed or copied.

Local environment: Apple M5 / 16 GiB, macOS ARM64, Python 3.12.13, torch 2.14.0, torchvision 0.29.0, NumPy 2.5.3, faster-whisper 1.2.1 / CTranslate2 4.8.2. OpenCLIP ran on CPU with two threads. VLM/recall remained `qwen2.5vl:3b` Q4_K_M, Ollama digest `fb90415cde1ef08aa669ae74b082d49b158729b6db1ab183c941417d507e71a1`; text embeddings remained `nomic-embed-text`; speech remained `small.en` CPU/int8. No paid inference API was used. SSH was discontinued at the user's request; no ASUS results are claimed.

## Unchanged zoo source and prewritten questions

The exact cached original and lossless 1 fps proxy from the [earlier evaluation](YOUTUBE-VIDEO-2026-09-19.md) were copied to a separate workspace. Original SHA-256 remains `fa641f62991920e9598d8abdec497c84e2a9bd64e071beaa6b4ffcf73e08f72d`; proxy SHA-256 is `90eec9dbd55d8137067135c00f6276069798d9dc3eadd66cf35e3074472530d8`. All 19 sampled frames and complete audio were freshly ingested and inferred on port 8002. Neither title nor human captions was supplied to ingestion.

PyAV now encodes the sampled JPEGs using Pillow quality 95, so the JPEG payloads differ from the old FFmpeg extraction, although the source frames are unchanged. PyAV detected a small audio PTS discontinuity and produced two chunks rather than one. Concatenating their PCM yields **304,208 samples, byte-identical to an independent FFmpeg decode**, SHA-256 `b7ad3067376136cfef0c16b774d284925dd1d80a84c0fdc44c9b8299f43643bb`. Chunking can still affect ASR context. This is an end-to-end comparison, not a single-variable ablation or a controlled speed benchmark.

| Measurement | Observed |
|---|---:|
| Frames / audio chunks | 19 / 2 |
| Caption/transcription jobs completed / failed | 21 / 0 |
| OpenCLIP frames indexed / failed | 19 / 0 |
| Import through both drained queues | 286.66 seconds |
| Frame analysis mean / median | 14.59 / 14.03 seconds |
| Frame analysis range | 12.52–19.44 seconds |
| OpenCLIP cold first image, including model load | 8.70 seconds |
| OpenCLIP subsequent image mean | 0.181 seconds |
| OpenCLIP mean including cold load | 0.629 seconds |
| First-time weights download + setup smoke test | 126.70 seconds |
| Cached offline setup smoke test | 10.77 seconds |

Captioning remains much slower than 1 fps, so the Mac **cannot sustain full per-frame VLM analysis at the wearable's capture rate**. Fast image indexing does not fix that backlog. Runtime versions, caches and execution conditions differ from the earlier 347.8-second run; do not attribute the timing change to OpenCLIP.

| Original criterion | New result | Seconds | Pass? |
|---|---|---:|---|
| Names elephants with frame evidence | Named elephants; resolvable original-frame citations | 35.646 | Yes |
| Describes barrier with frame evidence | Response rejected; evidence-only fallback | 35.322 | No |
| Jacket: red, gray and black | Named red/gray, omitted black | 15.077 | No |
| Spoken notable feature: long trunks | Repeated ASR's incorrect “clumps” | 34.772 | No |
| Absent keys location | Invented a location inside the fence, behind an elephant | 14.247 | No |
| Absent arrival time | Invented arrival 10 seconds after the video started | 33.353 | No |

**1/6 meets the unchanged prewritten criteria, versus 0/6 in each earlier full run. This is not an acceptance pass.** Five outputs had resolvable citations and `grounded=true`, including wrong claims. Synthetic wall-clock exclusion prevented copying the import date in this run, but did **not** prevent inventing a relative event time. Removing the audio summary stopped propagation of its earlier “hair” substitution, but the original ASR error remained. Short source labels improved usable output without establishing factual reliability.

The earlier baseline databases and result files were not modified. New raw answers, manifests, per-frame observations, package versions, payload checksums, timing metrics and audio comparison are under ignored `data/open-video-eval/`.

## First-person everyday work segment

The user requested a day-in-the-life style example. The selected source is [Stephen Patula's “McDonald's POV: 30 Minutes of Breakfast,” 01:00–01:30](https://www.youtube.com/watch?v=SzZ6KcqlAgY&t=60s), a first-person slice of a worker's day. It includes moving hands, ingredient handling, object placement, occlusion and camera motion. It is **not** a continuous full-day or physical ESP32-camera test.

The downloaded section is 640×360, about 29.97 fps, 30.063 seconds; SHA-256 `03b82f243750de109ca56856313f65ef109c4be8ee604caffb801bd92bdabfe5`. Section cutting required transcoding. Creator-owned footage is retained only in ignored local evaluation data and is not redistributed in Git. The source title/creator and acceptance criteria are not fed into frame analysis.

[Seven questions and criteria](daylife-pov-plan.json) were written after inspecting source frames and **before** running recall. They cover the assembled food, bottle placement, colors, ordering, utensils, missing keys and an unknown shift-start time. The pipeline is unchanged for these questions. A fresh workspace on port 8003 receives 31 selected frames at 1 fps (including the short tail after second 30) plus decoded audio.

Manual source review: approximately 0–6 seconds shows wrappers laid out; 8–12 seconds shows bread halves fetched and placed; 14–17 seconds shows a squeeze bottle used; by 18 seconds it is back horizontally on the upper shelf; roughly 19–26 seconds shows yellow slices added; 27–30 seconds shows a gloved hand reaching for bacon in a warmer. **Post-inference erratum:** this was originally mislabeled as tongs; the original frozen criterion remains in the plan for audit, with the [correction recorded separately](daylife-pov-erratum.json). These observations are the reviewer's notes, not generated REWIND output. Full-resolution review corrected an initial draft criterion that incorrectly expected visible egg portions; this correction was made **before recall**, with the original draft retained in local audit data.

Audio accounting: PyAV decodes 1,323,008 samples at 44.1 kHz, eight more than the container's declared duration. Resampling yields 480,003 samples at 16 kHz: a 30-second chunk and a three-sample residual. All decoded samples are retained. An independent FFmpeg command yields 480,000 samples; 13 samples differ in the common range, with maximum integer amplitude difference 19. Thus this clip's audio is **not byte-identical** across decoders, unlike the zoo clip. The extra 0.1875 ms is consistent with decoder padding/resampling; it is not meaningful extra recorded activity. Saved PCM SHA-256: `2270d468ff6c4e931a7cb93e407c764d27d903c6419b138d2a32516ce81f854a`.

| Measurement | Observed |
|---|---:|
| Frames / audio chunks | 31 / 2 |
| Caption/transcription completed / failed | 33 / 0 |
| OpenCLIP indexed / failed | 31 / 0 |
| Import through both drained queues | 780.14 seconds |
| Frame analysis mean / median | 25.06 / 16.13 seconds |
| Frame analysis range | 10.44–133.50 seconds |
| OpenCLIP cold first image | 9.01 seconds |
| OpenCLIP subsequent image mean | 0.143 seconds |
| OpenCLIP mean including cold load | 0.429 seconds |

Both audio chunks produced empty speech transcripts. A live search while caption jobs were still pending returned 17 uncaptioned frames among 31 results in 0.192 seconds. That verifies retrieval independence, not precision: requesting every frame in this tiny archive cannot measure relevance. Several generated captions were demonstrably incorrect, including calling bread “oranges” and a bottle a “red fish.”

| Criterion | Actual result | Seconds | Meets criterion? |
|---|---|---:|---|
| Bread halves with yellow cheese; no invented preparation | Called them cheeseburgers and invented placing them in a warmer/vending machine | 33.249 | No |
| Bottle horizontally on the upper shelf to the right | Correct broad location, “back on the shelf,” but omitted the specified placement detail | 32.209 | Partial; no strict pass |
| Red bottle cap and yellow slices | Both correct, with visible frame evidence | 27.456 | Yes |
| Bottle used before adding yellow slices | Reversed the sequence, saying after | 25.202 | No |
| Utensil question — original tongs criterion invalidated after inference | Named tongs and cited cheese-handling frames plus empty audio; reinspection shows gloved hands handling bacon | 27.484 | Excluded from frozen-criterion comparisons; model answer also wrong under corrected observation |
| Keys location unknown | Asserted keys were not put in an oven and supplied unrelated invented orange-handling details | 29.920 | No |
| Shift start unknown | Invented “15:00 (3:00 PM)” | 27.245 | No |

**The original reported score was 1/7.** Excluding the invalidated utensil criterion leaves **1/6** on unchanged valid criteria. The broad bottle location is a partial result; the “tongs” noun was incorrect, including in the reviewer’s original expectation. All seven responses had structurally valid source links. Five carried `grounded=true`; four of those failed the criteria. The two temporal questions were marked `grounded=false` by the unverified-anchor safeguard, which did not prevent the model from writing a wrong action sequence.

Total question time was 202.765 seconds. This establishes neither useful everyday recall reliability nor real-time caption throughput. The actual first-person run exposes motion, object identity, sequencing, citation relevance and abstention failures beyond the static zoo example. Reimporting the same clip/settings/start returned **33/33 duplicate receipts**, with no new originals. Raw answers, source frames, both plan drafts, manifests and measurements remain under ignored `data/daylife-eval/`.

## Additional held-out camera footage

An eight-second section of the official [OpenCV vtest sample](https://github.com/opencv/opencv/blob/4.x/samples/data/vtest.avi) provides another environment: pedestrians, a tripod, a road and a parked van. The [prewritten criteria](heldout-video-plan.json) also ask about unavailable speech and a departure time. This is a tiny smoke test, not a dataset-level benchmark.

Original AVI SHA-256: `45cddc9490be69345cbdab64ca583be65987e864ca408038e648db99e10516cf`. The first eight seconds were transcoded with FFmpeg/libx264 CRF 0 and no audio; MP4 SHA-256: `7be7358dcc647d8a3debc4b13d8eb2fbe1a9734d9cfc13e719fee908d803e94a`. The new reusable `scripts/evaluate_video.py` performs this run in a fresh directory and records its environment automatically. This is also the runner's real end-to-end smoke test.

All **8/8 frame-analysis jobs and 8/8 visual-index jobs completed, zero failures**, in 264.53 seconds. Mean frame analysis was 32.81 seconds (range 17.84–96.72); image indexing averaged 2.234 seconds including cold initialization. These sequential test runs shared a working Mac with other processes and are not controlled comparative speed benchmarks.

| Criterion | Actual result | Seconds | Meets criterion? |
|---|---|---:|---|
| People walking outdoors on pavement | Described walking near grass, with visible scene details | 28.253 | Yes |
| Three-legged foreground object is a tripod | Named tripod with relevant original-frame citations | 28.244 | Yes |
| Parked van is white | Correct color with frame citations | 26.112 | Yes |
| Speech is unavailable | Declined to determine dialogue from the images | 7.883 | Yes |
| Departure time is unavailable | Said exact time cannot be determined; no invented departure time | 11.627 | Yes |

**5/5 meets this small smoke test's prewritten criteria**, in 102.119 seconds of recall. The departure answer is generic about unavailable time rather than explicitly discussing leaving home. All source links resolved. Both abstentions still carried the model's `grounded=true` flag, reinforcing that this flag is not a reliable sufficiency or truth grader.

This clearer, static camera view performed much better than the moving workday clip. It does not invalidate that clip's failures or establish general accuracy. The runner exited successfully and shut down its child API; raw results are under ignored `data/heldout-video-eval/`. The workday API on port 8003 remains available for local inspection; the completed zoo API on port 8002 was stopped.

## Reproduce

Install and cache dependencies/models using [the integration guide](../../research/VIDEO-MEMORY.md). The reusable runner starts a loopback API with fresh random credentials and a new database, imports through HTTP, waits for both queues, records answers and timings, then stops its child server. It never changes a production `.env`, overwrites an existing evaluation folder, or silently grades truth.

```bash
python scripts/evaluate_video.py \
  data/open-video-eval/evaluation-1fps.mp4 \
  docs/evaluations/youtube-3b-plan.json \
  --model qwen2.5vl:3b --output data/reproduce-zoo

python scripts/evaluate_video.py \
  data/daylife-eval/breakfast-pov.mp4 \
  docs/evaluations/daylife-pov-plan.json \
  --model qwen2.5vl:3b --output data/reproduce-workday

python scripts/evaluate_video.py \
  data/open-video-eval/heldout-8s.mp4 \
  docs/evaluations/heldout-video-plan.json \
  --model qwen2.5vl:3b --output data/reproduce-outdoor
```

To obtain the same source interval (YouTube encodings can change):

```bash
yt-dlp --no-playlist -f 'worst[ext=mp4]/worst' \
  --download-sections '*60-90' --force-keyframes-at-cuts --write-info-json \
  -o 'data/daylife-eval/breakfast-pov.%(ext)s' \
  'https://www.youtube.com/watch?v=SzZ6KcqlAgY'
```

Keep exact cached bytes for repeat comparisons and confirm checksums. Use a new output directory per configuration. `--text-only` supports an image-index ablation; it was not run in this evaluation. A larger-model run must replace **both** ingestion and reasoning in a fresh workspace to count as an end-to-end comparison. Model weights are not committed.

## Follow-up: model versus evidence-pipeline diagnosis

The user asked why this assistant could inspect the clip more successfully than the local model. A [separate diagnosis](../../research/MODEL-GAP.md) documents the unequal context/workflow and three actual same-model probes with six selected chronological frames. Better evidence fixed action order and correctly described gloved hands (initially misgraded due to the reviewer’s tongs error), but the model still invented a shift start. These diagnostic probes do not change the scores above. The document also verifies the available GPT-6 Astra API path; no cloud API evaluation was run because no key was configured.
