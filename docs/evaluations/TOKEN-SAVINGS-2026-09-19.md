# Token savings: measured results

Status: R0 baseline, R1 change gate, and R2 compact packet completed. Additional
caption/resolution/cache/compressor trials are pending and are not claimed below.

On the two short real clips, the compact packet used **21.2% fewer recall/plan
tokens**. The change gate avoided **zero** real-clip vision calls. On the separate
synthetic shape clip, it avoided **30 of 40 vision calls** and reduced total
pipeline tokens **35.4%**. These findings do not establish day-long savings or
flawless recall.

The [pre-run protocol](TOKEN-SAVINGS-PROTOCOL.md) and
[frozen manifest](token-savings-frozen.json) define the exact source hashes,
questions, keyframes, exclusions, and limits. All generation used the same ASUS
Qwen3.5 35B-A3B service, one worker, 1 fps sampling, 128-token compact observation
cap, and up to eight recall images. The main runs use raw Qwen answers; Codex
verification is deliberately disabled identically in this performance comparison.
Production reviewed answers are a separate path.

Each complete pipeline run has a fresh workspace. R2 reuses the exact R0 captions
and originals in a separate database and compares only recall/plan token usage;
it does not count reused ingestion as free savings. Runtime counts were present
for every generative call in these completed runs. OpenCLIP/Whisper and compressor
tokenizers are excluded from generative-LLM savings.

## Short real clips: 38.063 seconds total

The moving kitchen clip is 30.063 seconds and the outdoor-camera clip is 8 seconds.
They contain 39 sampled frames and 11 previously written, valid questions. There
is no 20–30 minute quiet-room or 10-minute busy recording in this evaluation.

| Configuration | Full-pipeline tokens | Recall/plan tokens | Frozen criteria met | Whole-answer supported |
|---|---:|---:|---:|---:|
| R0 baseline | 56,589 | 40,874 | 8/11 | 8/11 |
| R1 change gate | 59,719 | 44,004 | 9/11 | 8/11 |
| R2 compact packet, same R0 captions | Not rerun | 32,205 | 9/11 | 8/11 |

The gate made all 31 kitchen and all eight outdoor vision calls. R1's higher recall
token count and changed answer score are run variation, not demonstrated gate
savings. No run is discarded because its token count or latency is worse.

## Synthetic localized-object stress: 40 seconds

A 32×32 red square appears, moves right, and disappears against an otherwise fixed
640×480 image. This is generated test data, not a recorded quiet room or human day.

| Configuration | Full-pipeline tokens | Recall/plan tokens | Vision calls | Frozen criteria met | Whole-answer supported |
|---|---:|---:|---:|---:|---:|
| R0 baseline | 32,018 | 14,598 | 40/40 | 3/4 | 2/4 |
| R1 change gate | 20,674 | 16,318 | 10/40 | 3/4 | 3/4 |
| R2 compact packet, same R0 captions | Not rerun | 11,773 | Not rerun | 3/4 | 1/4 |

Seven R1 descriptions were conservative fallbacks because a visual vector was not
available at the gate decision. All 40 originals and all 40 final visual-index
entries were retained. The final-disappearance question failed in all three raw
answer runs because retrieval selected earlier frames that still showed the
square. R2 additionally asserted an incorrect left-of-blue-circle explanation for
the otherwise correct direction answer. The compact packet is not lossless
reasoning, and a short correct conclusion does not excuse unsupported explanation.

## How quality was assessed

All grades are labeled **agent source review**, not human or independent external
judging. The frozen criterion score remains separate from an additional
whole-answer-faithfulness rubric introduced after baseline inspection. That second
column checks every material claim, including unsolicited explanation. Object
synonym-string recall is reported separately in the raw report and is not a truth
score; it can match object names while captions invent actions or locations.

The kitchen bottle-placement criterion requires horizontal placement, so omitting
that detail does not pass the full frozen criterion even when the broad shelf
location is correct. A source-audit note treats “right” as viewpoint-dependent.
The previously invalidated tongs criterion remains excluded, with its original
erratum preserved. Unknown source grades are not scored as failures or successes.

`data/token-benchmark/runs/report.json` and `report.md` preserve per-clip counts,
paired 95% question-bootstrap intervals (10,000 seeded resamples), latency,
object checks, source-grade hashes, and runtime condition notes. Eleven correlated
questions from two short real clips are too few to establish population-level
accuracy or equivalence. Some evaluation time overlapped renewed access to the
production phone link; latency is retained and qualified for possible contention.
Summed inference service time is not measured GPU occupancy.

R3/R4 bear-2 trials were **not executed** because no TTC API key was available.
No diet savings are attributed to bear-2. R10 LLMLingua, when executed, will remain
a separate CPU-compressor trial. Cloud-equivalent dollar figures use explicitly
configured illustrative rates; they are not this user's bill.

Original media, private runtime settings, raw answers, SQLite workspaces, and
grading artifacts remain in ignored local data and are not redistributed here.
