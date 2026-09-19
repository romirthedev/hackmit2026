# Video-memory reuse: source audit and implementation

Inspected September 19, 2026. This is an implementation decision under the hardware build's roughly 20-hour constraint. Repository claims and paper benchmarks are not measurements of REWIND. A model cannot extract every detail, reconstruct missed frames, or prove an event did not happen.

## What the repositories actually implement

| Project / inspected revision | Input and actual code | License / setup cost | Decision |
|---|---|---|---|
| [OMI](https://github.com/BasedHardware/omi/tree/094514cb9464f19c8058ebf99d145364e7dc389e) | Conversation audio, desktop screen capture, **and genuine camera photos through OmiGlass**. `omiGlass/firmware/src/app.cpp` captures images and transfers photo packets over BLE. `backend/utils/llm/openglass.py` calls a vision service; `models/conversation_photo.py` stores photo timestamps/descriptions. | Root MIT. Glass firmware targets Seeed XIAO ESP32-S3; the full mobile/backend stack introduces Flutter and cloud service configuration. | Do not flash this onto the FORIOT/AI-Thinker ESP32-CAM. Its packet protocol and target differ from our Wi-Fi/SD spool. No OMI code copied. |
| [OMI's older Glass agent](https://github.com/BasedHardware/omi/blob/094514cb9464f19c8058ebf99d145364e7dc389e/omiGlass/sources/agent/imageDescription.ts) | `imageDescription` uses local Ollama/Moondream; `llamaFind` answers from descriptions using Groq. This is camera-image captioning plus text recall, not guaranteed full video understanding. | Same MIT repository; the inspected recall path depends on a hosted provider. | Keeping our existing local Ollama adapter is simpler; replacing it with this agent would retain the caption bottleneck exposed by our baseline. |
| [HKUDS VideoRAG](https://github.com/HKUDS/VideoRAG/tree/c412a093a820ef7a0e0dda31076ed871136198b3) | **Actual videos**: `_videoutil/split.py` cuts time segments and audio; `caption.py` samples frames and transcribes/captions segments, including query-dependent recaptioning; `feature.py` embeds video segments and queries with ImageBind. | Its root license distinguishes MIT framework architecture from integrated models. ImageBind has CC BY-NC-SA 4.0 restrictions. The algorithm setup pins older PyTorch 2.1.2, NumPy 1.26.4, Transformers 4.37.1, bitsandbytes, and MiniCPM/ImageBind/Whisper checkpoints. | Do not drop the complete stack into this NumPy 2/Python 3.12 app. Adopt the useful retrieve-original-visual-evidence pattern, implemented using OpenCLIP below. No VideoRAG source copied; no claim to reproduce its algorithm/benchmark. |
| [Screenpipe](https://github.com/screenpipe/screenpipe/tree/c52f8897dc794ffacc4f6ab0d754f4a00f724296) | Primarily desktop **screen** and audio history. Inspected Rust `screenpipe-db` frame/video-chunk storage; a chunk/frame database is not itself a wearable-camera semantic pipeline. | This snapshot's [LICENSE.md](https://github.com/screenpipe/screenpipe/blob/c52f8897dc794ffacc4f6ab0d754f4a00f724296/LICENSE.md) is a custom **commercial/source-available license**, not unrestricted MIT. Rust/native desktop integrations also add setup. | Not integrated. Do not infer its current license from older descriptions calling it open source. |
| [OpenCLIP](https://github.com/mlfoundations/open_clip) | `create_model_and_transforms`, `encode_image`, `encode_text`: shared image/text embeddings from **pixels**, independent of generated captions. This does not model motion, transcribe speech, or generate answers. | MIT implementation; pinned runtime `open_clip_torch==3.3.0`. Inspected current source `2d5346092bf447ff73a782d372a8e018fb269ffc` and installed inference code. CPU/MPS/CUDA through PyTorch. | **Integrated and run** as a separate durable image-index worker and a third retrieval channel. |
| [PyAV](https://github.com/PyAV-Org/PyAV/tree/v18.1.0) | FFmpeg-backed demuxing, frame decoding, exact PTS/time-base access, audio resampling. Processes real video containers, including variable frame rates. | BSD-3-Clause wrapper, pinned `av==18.1.0`; FFmpeg libraries have their own notices. Prebuilt wheels avoid a local compiler on the tested Mac. | **Integrated and run** in the streaming importer; replaces whole-video temporary JPEG extraction. |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Actual audio transcription with segment/word timings through CTranslate2. | MIT implementation; already used in REWIND. Whisper weights and CTranslate2 remain separate dependencies. | Retained. Automatic transcripts remain fallible and separate from visual evidence. |

Source inspection consisted of actual Git checkouts and reading implementations/licenses, not only README marketing. Ignored checkouts reside under `data/upstream`; none are vendored into the application. The detailed research does not assert that any complete upstream stack was deployed or benchmarked here.

## The integrated path

1. **Capture:** keep Espressif's camera driver and the existing hardware-specific SD/Wi-Fi upload protocol. Each received JPEG still receives its own caption job; identical frames are not discarded.
2. **Video import:** PyAV streams decoded frames. Default sampling chooses the first original frame at/after each one-second interval. `--fps 0` preserves every decoded frame; missing frames are not interpolated. Sampling changes must be explicit.
3. **Provenance:** every imported item records source SHA-256, PTS, rational time base, source-relative seconds, zero-based original decoded frame index (frames only), and zero-based fixed-duration clip index. Clip numbers describe time windows, not detected semantic scenes or tracked actions. Upload sequence numbers count selected frames, so subsampling does not create false device-gap alarms.
4. **Audio:** PyAV decodes/resamples all audio to PCM16 mono/16 kHz, with bounded chunks. Chunk starts follow resampled PTS; a gap/overlap larger than one sample starts a new chunk rather than silently changing time. This can create short chunks in discontinuous source containers. Speech jobs use the original automatic transcript for recall, not a generated summary as a substitute.
5. **Image index:** the maintained OpenCLIP implementation encodes every original image into a normalized 512-float vector. Separate durable jobs mean a caption failure does not block pixel retrieval. Restarted jobs recover expired leases; failures remain visible and retryable; deleted originals cascade to their vectors. A changed model identity cannot mix vectors with another model's index.
6. **Retrieval:** lexical FTS, text embeddings, and image embeddings contribute reciprocal ranks. Similarity scores order candidates; they are **not calibrated confidence or proof of object presence**. Scans stream the time-filtered SQLite vectors with bounded working memory. Time cost still grows linearly with archive size; this is not a million-frame ANN engine.
7. **Recall:** neighboring audio/frames are fetched only within the same device/recording session. Up to three temporally separated originals are attached. Attached images take precedence over their generated captions. Short model-facing source labels map deterministically back to the real recording IDs; unknown labels, uncited assertions, and ID-only prose fail closed. The non-temporal query path skips the fragile LLM search planner.
8. **Review:** the existing dashboard displays originals, provenance, clock quality, visual-index counts and failures. `grounded` continues to mean source association plus model-reported sufficiency, **not verified truth**.

This reuses the upstream decoder, resampler, model architecture, preprocessing, tokenizer and pretrained embedding weights. REWIND's persistence, queue integration, rank fusion, provenance protocol and citation validation are adapter code written for this app; they are not represented as copied OMI/VideoRAG components.

## Pinned image model and attribution

- Architecture: `ViT-B-32`, 224px model input. Tiny objects and text can disappear during preprocessing.
- Weights: [LAION CLIP ViT-B/32](https://huggingface.co/laion/CLIP-ViT-B-32-laion2B-s34B-b79K/tree/1a25a446712ba5ee05982a381eed697ef9b435cf), revision `1a25a446712ba5ee05982a381eed697ef9b435cf`, `open_clip_model.safetensors`. The model card declares MIT. About 605 MB of weights; PyTorch/runtime dependencies require additional disk/RAM.
- Code attribution: Gabriel Ilharco, Mitchell Wortsman and OpenCLIP contributors. Full upstream notices are preserved in [licenses/OpenCLIP-MIT.txt](licenses/OpenCLIP-MIT.txt) and [licenses/PyAV-BSD-3-Clause.txt](licenses/PyAV-BSD-3-Clause.txt). Installed packages retain their own dependency licenses. Weights are cached outside Git, never committed.
- Runtime loads only the pinned local safetensors checkpoint. Setup explicitly downloads it once; normal indexing/querying does not download model weights or call a paid inference API. No remote Python model code is executed.

## Enable, verify, and roll back

From the project root in its virtual environment:

```bash
python -m pip install -e '.[audio,video,vision,dev]'
python scripts/setup_visual.py --device cpu
python scripts/setup_visual.py --device cpu --offline
```

Set `REWIND_VISUAL_EMBEDDINGS=true` and `REWIND_VISUAL_DEVICE=cpu` in your private `.env`, then restart the server. CPU is the tested portable default; MPS/CUDA are selectable only after checking that the installed PyTorch build supports the target hardware. A 128 GB RAM specification alone does not establish GPU compatibility. Linux ARM64/CUDA installation is **not tested** in this work.

The option defaults to false so existing minimal installs remain usable. Enabling it backfills existing frames automatically and indexes new wearable JPEGs too; video provenance is optional. `/api/status` → `visual_index` reports enabled/model/indexed/pending/failed/average_ms. `/api/retry` retries caption/transcription and failed visual jobs. Missing dependencies or weights appear as failures, not fabricated embeddings.

Set `REWIND_VISUAL_EMBEDDINGS=false` and restart to return to text-only retrieval; originals and captions remain available. The additive SQLite migration preserves old rows. Existing old imports with no provenance cannot retroactively establish historical clock accuracy; reimport into a separate evaluation workspace to obtain new metadata.

```bash
python scripts/import_video.py /path/to/recording.mp4 \
  --start 1789819200 --fps 1 --manifest data/import-audit.jsonl
```

Use the **actual** recording-start Unix timestamp. If it is unknown, choose a past timeline start and add `--synthetic-clock`; the app will explicitly mark it as synthetic and omit that wall clock from model evidence. Same source/settings/start yields the same import identity and resumable uploads. Different sampling/start settings intentionally create a different import; do not treat those as the same recording. The JSONL manifest contains original-media associations, receipt IDs and payload checksums, never credentials. Keep source video and manifests locally if you need to revisit unsampled frames; the server stores selected JPEGs and decoded audio, not the full source video container.

## Verification and measured limits

See [the comparison report](../docs/evaluations/OPEN-VIDEO-2026-09-19.md) for local timings, unchanged baseline questions, held-out footage and failures. Original baseline evidence remains in [the earlier report](../docs/evaluations/YOUTUBE-VIDEO-2026-09-19.md). Unit tests use explicitly fake providers for storage/routing faults and generated media for timestamp/sample invariants; those are not accuracy tests.

For Docker, the default image includes audio/video dependencies. An optional
CPU pixel-index image can be built with
`docker compose build --build-arg REWIND_PYTHON_EXTRAS=audio,video,vision`, followed
by `docker compose run --rm rewind python scripts/setup_visual.py --device cpu`.
The existing model-cache volume retains weights. Set the visual environment
option and start normally. These container commands are documented but **not run**
in this Mac validation; GPU container passthrough remains a separate setup task.

Relative-time anchors deserve additional care: matching an image to the words
"moving the notebook" does not prove a movement occurred. Candidate anchors are
marked uncertain in the model context and prevent `grounded=true`; only explicit caller-supplied time filters
narrow the search interval. The server does not silently cut off evidence at the
highest-similarity candidate.
