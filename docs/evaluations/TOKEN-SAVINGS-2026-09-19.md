# Token savings: measured results

The compact packet reduced measured recall/plan tokens **21.2% on the two short real clips**. The change gate avoided **zero real-clip vision calls**, but avoided **30/40 calls on a separate synthetic shape clip**. Combining gate, compact packet and cache reduced ingest-plus-raw-Qwen tokens **10.1% on real clips** and **45.0% on synthetic data**. Quality remained imperfect. These are short experiments, not evidence of day-long savings or exact recall.

The [pre-run protocol](TOKEN-SAVINGS-PROTOCOL.md) and [frozen manifest](token-savings-frozen.json) define source hashes, questions, keyframes and exclusions. The corpus has a 30.063-second moving kitchen clip, an 8-second outdoor clip, and a **separate generated 40-second localized-object stress clip**. There is no 20–30 minute quiet-room or 10-minute busy recording. Real questions predate these runs but were previously used in debugging; this is not a newly held-out test set. New keyframe criteria were frozen before inference and explicitly labeled agent annotation, not human gold.

The current baseline is **Qwen3.5 35B-A3B, native llama.cpp, eight 32,768-token slots, 128-token compact observation cap**, 1 fps and up to eight recall images. The main matrix uses one worker and bulk import. It does not use the old 256-token cap or serial Ollama serving assumptions in the handoff. Each pipeline run has a fresh database. R2 and R10 reuse the exact R0 captions and originals in separate databases and measure only recall/plan; previously paid ingestion is not treated as free savings. R9 was fixed as gate + compact + cache before its run, not chosen as an after-the-fact best combination.

**All question latency and quality below concern raw Qwen output. Codex verification is disabled consistently for these comparisons. They do not measure the production Astra/Sol-reviewed answer path.** Originals remain unchanged; compressed packets and downscaled images are derived inference inputs.

## Real clips: 39 frames, 11 questions

“Tokens used” compares the named scope with R0's same stages. Quality is agent source review. “Whole answer supported” is a separate exploratory check of all factual claims, including unsolicited details.

| Configuration | Measured scope | Tokens used | Tokens saved vs R0 | Reduction | Frozen criteria met | Whole answer supported | Cloud equivalent USD |
|---|---|---:|---:|---:|---:|---:|---:|
| R0 Baseline | Ingest + raw Qwen QA | 56,589 | 0 | 0.0% | 8/11 | 7/11 | $0.02678 |
| R1 Change gate | Ingest + raw Qwen QA | 59,719 | -3,130 | -5.5% | 9/11 | 8/11 | $0.02797 |
| R2 Compact packet | Recall/plan only | 32,205 | 8,669 | 21.2% | 9/11 | 8/11 | $0.01427 |
| R9 Gate + compact + cache | Ingest + raw Qwen QA | 50,862 | 5,727 | 10.1% | 9/11 | 8/11 | $0.02445 |
| R10-llmlingua Compact + LLMLingua CPU | Recall/plan only | 32,760 | 8,114 | 19.9% | 9/11 | 7/11 | $0.01463 |

R1 made all 31 kitchen and all eight outdoor vision calls. Its higher token count and changed answer score are run variation, not demonstrated gate savings. R2's diet accounts for the measured recall reduction; bear-2 receives no credit for it. R10 used **1.7% more real recall tokens than R2**, so LLMLingua did not demonstrate an incremental downstream saving in this run.

## Synthetic localized-object stress: 40 frames, four questions

A 32×32 red square appears, moves right and disappears against an otherwise fixed 640×480 image. This is generated test data, not a recorded quiet room or human day.

| Configuration | Measured scope | Tokens used | Tokens saved vs R0 | Reduction | Frozen criteria met | Whole answer supported | Cloud equivalent USD |
|---|---|---:|---:|---:|---:|---:|---:|
| R0 Baseline | Ingest + raw Qwen QA | 32,018 | 0 | 0.0% | 3/4 | 2/4 | $0.01590 |
| R1 Change gate | Ingest + raw Qwen QA | 20,674 | 11,344 | 35.4% | 3/4 | 3/4 | $0.00943 |
| R2 Compact packet | Recall/plan only | 11,773 | 2,825 | 19.4% | 3/4 | 1/4 | $0.00514 |
| R9 Gate + compact + cache | Ingest + raw Qwen QA | 17,621 | 14,397 | 45.0% | 3/4 | 1/4 | $0.00824 |
| R10-llmlingua Compact + LLMLingua CPU | Recall/plan only | 11,973 | 2,625 | 18.0% | 3/4 | 3/4 | $0.00525 |

R1 made **10/40 vision calls**, inherited 30 captions, and retained all 40 originals and all 40 final visual-index entries. Seven descriptions were conservative fallbacks because a vector was unavailable at gate decision time. R9 made 11/40 vision calls and inherited 29. R10's synthetic recall cost was **1.7% more than R2** despite fewer compressor-tokenizer tokens.

The final-disappearance question failed the frozen criterion in every main raw-answer configuration: retrieval selected earlier frames ending at 29 seconds while the square disappears at 30 seconds. R2 and R9 incorrectly answered that it was still visible. R0/R1/R10 were more cautious but did not establish the correct terminal state. R2/R9 also used an incorrect left-of-blue-circle explanation for the otherwise correct movement direction. These failures block a claim of exact recall or established quality equivalence.

## Caption-only ablations

These measure observation tokens and caption quality, not end-to-end answer accuracy. Source review covers 14 frozen keyframes across both cohorts; the exploratory rubric was assembled after seeing R0 and before reviewing later variants. Counts are non-blinded agent review, not independent human scores.

| Configuration | Real observe tokens | Reduction vs R0 | Synthetic observe tokens | Reduction vs R0 | Material unsupported claims | Any unsupported claim | Salient omissions |
|---|---:|---:|---:|---:|---:|---:|---:|
| R0 | 15,715 | 0.0% | 17,420 | 0.0% | 4/14 | 5/14 | 9/14 |
| R6-448 | 10,077 | 35.9% | 11,590 | 33.5% | 2/14 | 6/14 | 9/14 |
| R6-640 | 14,618 | 7.0% | 17,420 | 0.0% | 3/14 | 5/14 | 9/14 |
| R8 | 15,715 | 0.0% | 17,420 | 0.0% | 4/14 | 5/14 | 9/14 |

The 448-pixel variant reduced real observation tokens **35.9%**, but still omitted salient details in 9/14 reviewed frames. Every complete variant mentioned the square but omitted its center-to-right position change in captions. Fewer unsupported material claims on this tiny set do not establish better perception or safe production defaults. The resizing path also JPEG-encodes at quality 90, including images already at the target size; changes cannot all be attributed solely to pixel dimensions.

**R5 dense captions failed:** 30/31 kitchen frames were described; one exhausted five retries with truncated output under the unchanged 128-token cap. All 31 originals were visually indexed. The five failed calls lack usage telemetry, so total R5 token cost and savings are **unknown**, not zero. Successful dense outputs averaged about 106 tokens versus about 57 for baseline. The partial four-keyframe review found material unsupported claims in 2/4; it is not comparable with a full 14-frame run. Outdoor and synthetic R5 runs were not executed. No cap or prompt was retuned after the failure. An error-only telemetry fix was deployed afterward; a separate preserved-frame regression again produced truncated output and now recorded **316 prompt + 128 completion tokens, 2.587 seconds**. This verifies error telemetry only. It is not a rerun replacing R5 and cannot fill historical missing counts.

**R8 cache showed no demonstrated benefit:** all 79 frame calls reported zero cache-hit tokens; observation totals exactly equaled R0 at 33,135 tokens. Summed observation prefill was 30,209.452 ms versus 30,054.834 ms in R0 (0.5% slower). All 14 reviewed caption fields exactly matched baseline, including its errors. This is a measurement of this native runtime/configuration, not a general claim that caching never helps.

## Latency and throughput

The table pools the two real clips only within the real cohort; synthetic remains separate. Question p50/p95 is over 11 real or four synthetic questions. Frames/min is frames divided by total ingestion-and-drain elapsed time, not sustained all-day capacity. Receipt-to-observation delay is measured from server receipt to stored event and includes queueing; it is **not camera capture latency**. True capture-to-result remains unmeasured because imported timestamps are synthetic. The two kitchen audio chunks are included in its receipt-delay distribution.

| Configuration | Cohort | Raw question p50 / p95, s | Bulk frames/min | Receipt-to-observation p50 / p95, s |
|---|---|---:|---:|---:|
| R0 | Real | 5.28 / 7.23 | 31.08 | 22.40 / 52.37 |
| R0 | Synthetic | 4.60 / 4.77 | 43.05 | 29.09 / 52.03 |
| R1 | Real | 5.51 / 7.67 | 33.91 | 21.04 / 49.97 |
| R1 | Synthetic | 5.10 / 5.90 | 143.54 | 7.76 / 14.06 |
| R2 | Real | 5.67 / 9.49 | Not rerun | — |
| R2 | Synthetic | 4.12 / 4.94 | Not rerun | — |
| R6-448 | Real | — | 36.71 | 21.27 / 46.78 |
| R6-448 | Synthetic | — | 48.88 | 24.05 / 44.36 |
| R6-640 | Real | — | 37.09 | 17.89 / 45.27 |
| R6-640 | Synthetic | — | 45.18 | 26.84 / 49.99 |
| R8 | Real | — | 34.83 | 21.14 / 47.43 |
| R8 | Synthetic | — | 45.06 | 25.75 / 49.32 |
| R9 | Real | 5.24 / 8.39 | 32.52 | 25.38 / 50.68 |
| R9 | Synthetic | 4.13 / 4.57 | 143.84 | 9.54 / 14.25 |
| R10-llmlingua | Real | 5.78 / 7.49 | Not rerun | — |
| R10-llmlingua | Synthetic | 4.39 / 4.48 | Not rerun | — |

Runs were sequential and kept all calls, including slower ones. Phone QR access was renewed during evaluation, so potential shared load is recorded. The final read-only production audit found **zero new media and zero conversation turns** from Unix 1789864630 through 1789866688.266172 (01:11:28 UTC), covering both matrices; 311 production jobs were complete with none pending. Thus no production phone inference contention was observed, although this is not proof of isolation from every possible client. Processing was restarted and warmed between R2 and the next matrix to initialize the CPU compressor; the native vision service and model stayed unchanged. These single runs are not tightly controlled repeated latency trials. Summed request duration is not measured GPU occupancy.

## Separate paced replay: seven workers, one frame per second

This cohort uses new workspaces, baselines and fresh answer/source grades. It replays only the 8-second outdoor clip and the generated 40-second clip at 1 fps, with **seven workers**. It is offline paced replay, not phone networking or live camera capture, and is not pooled with the main one-worker bulk results. Native vision settings were unchanged; processing received an error-telemetry-only reload and CPU components were warmed before this cohort. All **96/96 uploaded frames** across its four runs and all corresponding visual-index rows completed without failed jobs.

| Configuration | Clip | Ingest + raw QA tokens | Saved vs paced R0 | Vision calls / frames | Frozen criteria | Whole answer supported |
|---|---|---:|---:|---:|---:|---:|
| R0 | outdoor | 22,222 | 0 (0.0%) | 8/8 | 5/5 | 4/5 |
| R0 | small-object | 31,684 | 0 (0.0%) | 40/40 | 3/4 | 2/4 |
| R1 | outdoor | 23,165 | -943 (-4.2%) | 8/8 | 5/5 | 4/5 |
| R1 | small-object | 19,804 | 11,880 (37.5%) | 9/40 | 3/4 | 3/4 |

| Configuration / clip | Receipt→observation p50 / p95, s | Raw question p50 / p95, s | Total ingest + drain, s | Frames/min | Post-upload drain, s | Pending at first post-upload poll |
|---|---:|---:|---:|---:|---:|---:|
| R0 / outdoor | 4.50 / 6.50 | 4.90 / 5.83 | 11.35 | 42.29 | 4.05 | 6 |
| R0 / small-object | 2.64 / 4.14 | 4.76 / 5.24 | 41.21 | 58.24 | 2.03 | 2 |
| R1 / outdoor | 3.86 / 5.42 | 4.80 / 6.40 | 13.93 | 34.46 | 6.62 | 4 |
| R1 / small-object | 0.54 / 3.22 | 4.35 / 4.82 | 41.19 | 58.26 | 2.04 | 1 |

On synthetic data, the paced gate avoided **31/40 calls (77.5%)** and used **37.5% fewer ingest-plus-raw-QA tokens**. It still avoided zero calls on the moving outdoor clip. Both configurations met 5/5 outdoor and 3/4 synthetic frozen criteria; both failed to establish final square absence. Their exploratory whole-answer support was 6/9 and 7/9 respectively, with the difference confined to an unsupported movement explanation. This tiny result does not establish equivalence, reliability for a full day or a latency improvement on arbitrary real scenes.

The synthetic gate made four initial conservative descriptions while a first usable anchor was unavailable, four for visual embedding changes, and one for a missing vector. Retained originals support later inspection regardless of caption inheritance. The 40-second synthetic sequence has roughly 10-second static segments, not a 30-second uninterrupted quiet interval; it is not a field validation of the 30-second heartbeat.

Queue delay is server receipt→stored observation, not true capture→result; the latter remains null. Total and drain times include importer/polling overhead (status polled every two seconds). Peak backlog during upload was not sampled, so the listed pending count is only the first post-upload snapshot. The older environment free-text note incorrectly says “bulk”; the immutable structured settings correctly record `workers=7`, `fps=1`, `paced_frame_replay=true`. A conditions entry records the correction, and future exporter text is fixed. Private results and separate paired intervals are in `data/token-benchmark/cadence-runs/report.json`.

## Separate rule and compressor measurements

R7 used eight frozen synthetic rule/observation text pairs, not video perception or live alert tests. Both R0 and R7 correctly classified **8/8**, including **4/4 true triggers**, with zero false alerts or false negatives. Rule calls fell **8→7** and measured tokens **1,731→1,495**, a **13.6% reduction**. This small set includes explicit negation and absent/uncertain cues; it cannot establish real-world alert recall.

R3/R4 bear-2 at aggressiveness 0.1/0.2 were **not executed: no TTC API key was available**. No compact-packet savings are attributed to bear-2. R10 is separately labeled **LLMLingua 0.2.2 on ASUS CPU**, model `microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank`, checkpoint revision `5f0c82792b7ea14c6484e015b6a072009496b7f2`, requested keep rate 0.8. All 27 field compression records succeeded, with no fallback, removing 130 tokens according to the compressor's tokenizer. Those are **not downstream Qwen tokens**. Actual downstream totals increased relative to compact-only R2. R10 predates the batch-timing fix: its per-field timing repeats batch elapsed time and must not be summed as CPU cost; measured question latency includes compression, but isolated CPU utilization/time was not measured. Local CPU compression has no cloud compressor bill. Future telemetry records batch wall time once, with a shared batch ID; historical R10 records remain unchanged.

## Quality, uncertainty and preservation

Frozen question criteria and exploratory whole-answer support remain separate. The latter was introduced after baseline inspection; a consistency audit corrected R0 outdoor speech-answer support for an unsupported plural-tripod claim, without changing its frozen criterion. Kitchen bottle placement requires horizontal orientation, so omitting it fails the full criterion even if shelf location is correct. “Right” is viewpoint-dependent according to pre-run source review. The previously invalidated tongs question stays excluded. Unknown grades never count as successes or failures.

Paired 95% question-bootstrap intervals use 10,000 seeded resamples. For real frozen-criterion accuracy, R1/R2/R9/R10 each differ from R0 by +1/11, interval **[0, +3/11]**. Synthetic frozen-criterion deltas are zero with **[0, 0]** empirical intervals because each run has the same four pass/fail labels. This degenerate interval is **not proof of equivalence**. Whole-answer support intervals differ and are retained in the machine-readable report. Questions are correlated within only two real clips and one synthetic clip; no population accuracy, human validation, or superiority claim follows.

Cloud equivalents use **$0.40/M input, $1.60/M output, $0.10/M cached input** and are illustrative arithmetic, not this user's invoice. Vision/recall model counts are separate from OpenCLIP, Whisper and compressor-tokenizer counts. Codex subscription usage has no inferred API-dollar bill. No extrapolation to a day or monthly cost is made.

The immutable manifest SHA-256 is `79992628d441da5a59715b66fb8e8d8686344695873f61571f1f44a06fb1099d`. Private `data/token-benchmark/runs/report.json` and `report.md` retain per-clip prompt/completion totals, paired intervals, source-bound grades, runtime conditions, and preserved failures. Caption review SHA-256 is `597178565cedce104ed2d0bf982ebf74bd0843aed0bc999227ad52510b51c17b`. Original media, raw answers, account settings, SQLite databases and grading artifacts stay in ignored local data.

Production now has **metering enabled with all savings flags off**. Longer representative recordings, source-level review and the production verification path are still needed to establish which tradeoffs to enable.
