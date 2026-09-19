# Real YouTube video evaluation — September 19, 2026

**The local pipeline processed the video, but the Mac's 3B setup did not demonstrate reliable recall.** This is one short end-to-end smoke test, not a general model benchmark. Successful processing and valid citations do not establish factual correctness.

## Input and method

- Source: [Me at the zoo, uploaded by jawed](https://www.youtube.com/watch?v=jNQXAC9IVRw), downloaded with yt-dlp. The source has 284 video frames at 15 fps, 320 × 240 resolution, and approximately 19 seconds of audio.
- Evaluated **19 frames at 1 fps plus the complete audio track**, matching the necklace's default capture cadence. This does **not** test every original video frame or native continuous-video reasoning. REWIND decomposes video into independently analyzed frames and transcribed audio, then retrieves that evidence for questions.
- FFmpeg created a lossless 1 fps video proxy and copied the original compressed audio. The imported mono 16 kHz PCM was checked against a separate decode of the original audio and matched exactly.
- An isolated REWIND workspace on port 8001 received the import through the real authenticated ingestion API. Existing recordings on port 8000 were not used or modified. The importer assigned a synthetic timeline, not the original camera's historical wall-clock time.
- The evaluator inspected original frames and creator-supplied English captions independently. Neither the video title nor those captions was supplied to the model. The model's automatic transcript was not manually corrected.
- Six questions and their acceptance criteria were recorded in [the test plan](youtube-3b-plan.json) before the first recall run. Four ask about recorded content; two ask for information absent from the clip.

Source file SHA-256: `fa641f62991920e9598d8abdec497c84e2a9bd64e071beaa6b4ffcf73e08f72d`.

## Actual inference configuration

| Component | Tested configuration |
|---|---|
| Computer | Apple M5, 16 GiB unified memory |
| Runtime | Ollama 0.34.2, one parallel request, 16,384-token context |
| Vision and recall | [Qwen2.5-VL 3B](https://ollama.com/library/qwen2.5vl:3b), `qwen2.5vl:3b`, Q4_K_M, digest prefix `fb90415cde1e` |
| GPU allocation | Ollama reported 100% GPU placement; approximately 4.6 GB resident for vision/recall |
| Embeddings | `nomic-embed-text:latest`, 768 dimensions, local Ollama |
| Speech | faster-whisper 1.2.1, `small.en`, CPU/int8 |
| REWIND | One worker; durable SQLite queue; real original image/audio storage |

Ollama labels this model “3B”; its metadata reports approximately 3.8 billion total parameters. All model inference was local. No Codex or paid cloud API was used. First-time model downloads are excluded from the processing timings below.

## Ingestion and perception results

| Measurement | Result |
|---|---|
| Jobs | 19 image jobs + 1 audio job, all completed |
| Failures / retries / embedding failures | 0 / 0 / 0 |
| Whole import and queue drain | 347.8 seconds, approximately 5 minutes 48 seconds |
| Frame processing | Mean 17.75 s; median 16.98 s; range 8.95–46.98 s |
| Warm frame mean, excluding first job | 16.13 s |
| Audio job, including summary/embedding | 7.06 s |
| Stored imported media | 996,651 bytes |
| Normalized bounding boxes | 75 returned; all 75 outside the required 0–1 range |

The frame descriptions recognized elephants, a fence, and parts of the person's red/gray/black jacket. They also confused the blue shirt with red clothing and claimed a small object in a raised hand where the original shows an empty-hand gesture. These descriptions are imperfect model observations, not verified facts.

Speech recognition misheard **trunks** as **clumps**. The 3B summary then introduced **hair**, which was not supported by the original speech. The later recall answer repeated that error. This demonstrates error propagation across speech recognition, summarization, and recall.

The reconstruction exporter already discards invalid normalized boxes; their scale was not guessed or silently repaired. This run does not validate spatial reconstruction.

At roughly 18 seconds of processing per sampled frame, this Mac configuration cannot sustain the default 1 fps capture rate. A queue would grow during continuous capture.

## Recall runs

**Baseline:** all six questions returned the evidence-only fallback, taking 27.3–69.1 seconds per question. None produced a usable answer. A diagnostic trace showed a correct animal name accompanied by valid source IDs, but missing inline citation formatting. It also showed the planner interpreting the spatial word “behind” as a temporal condition.

Two integration fixes were then applied: the server renders citations from validated source IDs, and spatial descriptions cannot create a temporal filter without an explicit temporal phrase. The same six questions were rerun against the **unchanged** observations and transcript. This isolates the recall changes; it is not a second ingestion benchmark.

| Question | Second-run result | Time | Meets criterion? |
|---|---|---|---|
| Animals behind the person | Source ID in place of an answer | 89.2 s | No |
| Barrier between person and animals | Source ID in place of an answer | 75.1 s | No |
| Jacket colors | Evidence-only fallback | 82.8 s | No |
| Notable animal feature in speech | Incorrectly said long hair rather than trunks | 98.2 s | No |
| Where the keys were left | Source ID instead of acknowledging missing evidence | 55.9 s | No |
| Time the speaker arrived | Returned the synthetic import timestamp as an arrival time | 63.9 s | No |

**0/6 met the prewritten criteria in either full run.** The second run produced one fallback, three source-ID-only responses, and two incorrect answers. Source links resolved, but five unusable/incorrect responses nevertheless had `grounded=true`. That flag checks source association and the model's self-reported sufficiency, not whether the associated claim is true. It must not be interpreted as an accuracy guarantee.

The rerun also exposed answers containing only source identifiers. A final guard now rejects those as unusable, and the schema explicitly asks for plain-language answer text. That guard was regression-tested separately; results from the earlier rerun remain preserved rather than rewritten as if generated by the final code.

A final single-question diagnostic using the current code produced the correct animal name, but the model corrupted one source ID. The app correctly rejected that response and returned evidence-only mode. This diagnostic is separate from the two complete six-question runs and does not change their scores. The final backend suite passed all 34 tests, including the source-ID-only rejection; lint, Python compilation, and live authenticated/unauthenticated API checks also passed. Both local servers were restarted on the final code, and `0000 0000` sign-in/logout was checked on both loopback ports.

## ASUS comparison status

The user supplied `asus@10.189.60.212`. SSH port 22 and Ollama port 11434 timed out from the Mac. The default route used a VPN interface; a separate SSH-port check bound to Wi-Fi also timed out. No authentication was reached, no remote software was installed, and no ASUS inference result is claimed.

The next run should first inspect the ASUS GPU, OS, free memory, installed runtime, and models. Then import the same 1 fps proxy into a **fresh** workspace using the larger model for both observation and recall. Reusing the 3B observations alone would test only recall replacement, not the larger model's end-to-end video understanding. Keep `small.en` fixed for the first comparison; evaluate a different speech model separately so changes remain attributable.

## Reproduce or compare

Install this repository's backend/audio dependencies, FFmpeg, yt-dlp, Ollama, and the selected local models as described in the README. Run from the repository root. Use a new workspace directory and an unused port for each model. The following is the tested Mac configuration:

```bash
ollama pull qwen2.5vl:3b
ollama pull nomic-embed-text
mkdir -p data/video-comparison
yt-dlp -f 'worst[ext=mp4]/worst' \
  -o data/video-comparison/source.mp4 \
  'https://www.youtube.com/watch?v=jNQXAC9IVRw'
ffmpeg -i data/video-comparison/source.mp4 -vf fps=1 \
  -c:v libx264 -crf 0 -c:a copy data/video-comparison/evaluation-1fps.mp4
```

YouTube may serve different encodings later. Compare the checksum and source metadata if reproducing exact bytes; the cached original in the local artifacts provides the exact tested version.

Start the isolated API in one terminal, leaving the production `.env` unchanged:

```bash
REWIND_DATA_DIR=data/video-comparison/workspace \
REWIND_VISION_MODEL=qwen2.5vl:3b \
REWIND_REASONING_MODEL=qwen2.5vl:3b \
REWIND_WHISPER_MODEL=small.en \
REWIND_WORKERS=1 \
.venv/bin/python -m uvicorn rewind.app:create_app --factory \
  --host 127.0.0.1 --port 8001 --no-access-log
```

In another terminal, import and record its synthetic timeline explicitly:

```bash
REWIND_EVAL_START="$(.venv/bin/python -c 'import time; print(time.time()-120)')"
.venv/bin/python scripts/import_video.py \
  data/video-comparison/evaluation-1fps.mp4 \
  --server http://127.0.0.1:8001 --start "$REWIND_EVAL_START"
```

Wait for the dashboard to show all 20 jobs analyzed, no pending jobs and no failures, then run:

```bash
.venv/bin/python scripts/evaluate_recall.py \
  docs/evaluations/youtube-3b-plan.json \
  --server http://127.0.0.1:8001 \
  --output data/video-comparison/answers.json
```

The evaluation script reads authentication from the environment or `.env`, saves real answers and timings after each question, and checks citation/media links. It does **not** automatically grade truth. Review every answer against the original media and the prewritten criteria. For a larger-model comparison, change both model environment variables and use a fresh data directory; the response's `status_before.model` records the actual configured vision model rather than relying on the plan's baseline model label.

The exact local run artifacts are in `data/youtube-eval-20260919/`: source/proxy media, original frame reviews, environment/model metadata, timings, original observations, audio checks, baseline answers, rerun answers, and the isolated database/media. They are Git-ignored. Original third-party video, downloaded models, credentials, and full transcripts are not committed.
