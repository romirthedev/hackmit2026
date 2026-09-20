# Token-saving benchmark protocol

The frozen [manifest](token-savings-frozen.json) was created before these token
benchmark runs. Its SHA-256 is
`79992628d441da5a59715b66fb8e8d8686344695873f61571f1f44a06fb1099d`.
The existing source questions have been used during earlier model debugging:
they are fixed criteria, not a new held-out test set.

The available real corpus is **30.063 seconds of moving first-person kitchen
footage and 8 seconds of a static outdoor camera**, with 11 valid questions.
The earlier kitchen utensil criterion was invalidated after source review and is
excluded from the primary score, preserving its separate erratum. There is no
20–30 minute quiet-room or 10-minute busy recording in this corpus. A separate
40-second deterministic shape video tests a small object's appearance, movement,
disappearance, and the 30-second heartbeat. It is synthetic, not a simulated
human recording or evidence of day-long performance.

New keyframe objects were annotated by an agent after inspecting original
frames, before the token runs. They are not independent human labels. The
synonym-string object score tests omissions in each frame's stored caption,
including inherited captions; it does not measure hallucination precision.
Question accuracy and citation relevance require an explicitly labeled human or
agent source review. No answer-confidence flag or citation-resolution check is
used as a truth label.

## Execution

Run from the repository root with the existing backend environment. Model
weights, credentials, source media, databases, raw responses, and grading sheets
stay under ignored `data/`. The runner refuses existing run directories and
changed source/manifest hashes. Each full pipeline run creates new credentials
and a fresh database. One worker keeps the causal gate comparison deterministic;
the ASUS native model retains its existing eight slots. This is offline bulk
ingestion, so throughput and upload-to-event latency are not live capture latency.

```bash
.venv/bin/python scripts/token_benchmark.py \
  --output data/token-benchmark/runs \
  --processing-env data/phone-demo.env \
  --run R0

.venv/bin/python scripts/token_benchmark.py \
  --output data/token-benchmark/runs \
  --processing-env data/phone-demo.env \
  --run R1 R2 R5 R6-448 R6-640 R8 R9
```

R0 explicitly disables every saving flag and uses the current compact caption
cap of 128 output tokens. R1 changes only the frame gate. R2 copies R0's completed
originals and captions into a separate database, clears answers/usage, and
compares recall-stage usage against the same stage of R0; previously paid
ingestion is not counted as a saving. R3/R4 use this same design with bear-2 at
0.1/0.2 only when a working key and consent to that configured service exist.
Missing-key fallbacks must be reported as unexecuted compression, not savings.
R5/R6/R8 are frame-only dense-caption, resolution, and cache ablations, compared
with R0's observe stage. R7 needs the separate frozen rule/observation-pair
benchmark, because no alert rules are enabled for these source clips.
R9 is preselected gate+compact+cache; it is not silently tuned on scored answers.
R10-llmlingua is a separately predeclared compact+LLMLingua-2 CPU run at rate 0.8,
reusing R0 captions. It is not a bear-2 trial or a substitute for the missing-key
R3/R4 results. Compressor tokenizer counts are recorded separately from actual
downstream Qwen usage.
All model runs are sequential. Concurrent local code/tests are permitted.

A separate seven-worker cadence check can use the no-audio synthetic clip. Keep
its output separate from the one-worker bulk runs:

```bash
.venv/bin/python scripts/token_benchmark.py \
  --output data/token-benchmark/cadence-runs \
  --processing-env data/phone-demo.env \
  --clips small-object --workers 7 --pace --run R0 R1
```

`--pace` waits for each source frame's relative timestamp before upload. It is
wall-clock-paced source replay, not capture from a physical camera. The importer
continues to upload audio after all frames, so this mode does not establish
real-time audio/visual interaction on sources containing speech.

The default measures raw Qwen responses. `--verify` additionally waits for real
Codex review and records the draft and final response separately; both sides of
a latency comparison must use the same setting. Review agreement remains
distinct from the frozen source-accuracy grade.

## Reports and grading

Every run retains its plan, source/code digests, feature flags, import manifest,
original media, observations, raw responses, ledger rows and summary. A generated
`grading-template.json` binds grades to the exact manifest and answer-file hash.
Copy it to `grading.json`, label the reviewer `human` or `agent`, and record
pass/fail, relevant citations, abstention correctness, and source-review notes.
Missing grades remain unknown.

```bash
.venv/bin/python scripts/token_benchmark.py --output data/token-benchmark/runs
```

This refreshes `report.json` and `report.md`. Tables separate real and synthetic
cohorts, model-measured totals from estimated avoided calls, and full-pipeline
from stage-only comparisons. A paired question bootstrap uses 10,000 seeded
resamples and reports the number of paired questions. These few correlated
questions from two short real clips cannot support population-wide confidence
or daily savings claims.

Summed inference request time is not measured GPU occupancy. Cloud-equivalent
dollars use an explicit illustrative rate and are not the user's local cost or
Codex subscription bill. Unknown counters remain unknown; OpenCLIP and Whisper
are not counted as generative-LLM token savings.
