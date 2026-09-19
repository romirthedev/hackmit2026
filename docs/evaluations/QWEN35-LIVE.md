# Qwen3.5 35B live processing: measured results

September 19, 2026. The selected model is `qwen3.5:35b-a3b-q4_K_M` on the ASUS
GB10 with 121 GiB unified memory. Ollama metadata counts 36.0B parameters including
vision components. Its main GGUF is 23,869,179,840 bytes, SHA-256
`900dde62fb7ebe8a5a25e35d5b7633f403f226a310965fed51d50f5238ba145a`.

The working runtime is Ollama 0.34.2's native `llama-server`, with the same
monolithic file supplied as model and projector, CUDA0 and all 42 layers on GPU,
flash attention, thinking disabled, and eight independent slots. The current
configuration reserves 32,768 context tokens per slot. The model-author chat
template is pinned to Hugging Face revision
`59d61f3ce65a6d9863b86d2e96597125219dc754`; launch receipts hash its bytes.
System Ollama remains available for the separate text embedding model.

## Capture replay

`scripts/benchmark_live.py` verifies original hashes, records warm-up separately,
submits originals at one frame per second, and asks two questions during labeling.
Results are saved incrementally, including failures and raw model outputs.
Schema/citation checks are not an independent factual grade.

| Native profile | Completed | Elapsed including drain | Capture-to-result p95 | Last frame queue wait | Two question times |
| --- | --- | --- | --- | --- | --- |
| Public 640×360 originals, 16 frames, 4 workers | 16/16 | 22.979 s | 10.109 s | 5.356 s | 4.560 / 2.068 s |
| Actual 540×960 phone originals, 32 frames, 7 workers, older longer prompt | 32/32 | 42.932 s | 14.965 s | 8.522 s | 10.080 / 7.589 s |
| Same phone originals, 7 workers, 24-word observations / 128-token cap | 32/32 | 33.796 s | 7.586 s | 0.586 s | 8.708 / 9.498 s |
| Deployed 32K slots, same phone originals and brief prompt, 7 workers | 32/32 | 34.406 s | 7.554 s | 0.469 s | 6.952 / 7.816 s |

The final deployed 32K profile achieved 0.930 completed frames/s including final
drain; its median capture-to-result delay was 6.766 s. The short replay approached the
one-frame-per-second input rate with little final queuing. It does not establish
day-long throughput, thermal behavior, or complete video understanding. These
first three profiles used 8,192-token slots. The final row repeats the workload
after deploying 32,768-token slots under systemd, with no other queued vision work.

An earlier single-worker Ollama run produced 0.278 frames/s but overlapped with
the QA server draining its backlog. It is retained as a contaminated run, not
an isolated model/runtime comparison. A short eight-frame phone burst is also
retained but is not a steady-state estimate. Private phone pixels and caption
outputs remain in ignored local/ASUS data directories, outside Git.

## Actual phone API and Codex review

A public original frame was uploaded through the real application, then queried
before labeling. The question asked whether the preparation counter was metallic
or wooden. The 35B answer took **9.239 s**; Astra inspected the original pixels in
**6.353 s**, and the API published a checked answer at **16.300 s** total. The
production archive was concurrently reprocessing with seven workers. This is one
question, not a latency guarantee. Receipt: ignored
`data/qwen35-native-phone-api-check/result.json`.

A later day-overview integration test selected twelve originals across the same
30-second public clip. Qwen took 16.333 s and Astra took 12.919 s, with the API
finishing at 29.463 s. Both treated the clip as a partial view rather
than a full day. The final response remained `mode=insufficient`, `grounded=false`,
with `claims_reviewed=true` and `answer_complete=false`. Its receipt retained all
twelve original ingest hashes and coverage metadata. This verifies the broader
retrieval/review path; it is not a full-day accuracy test. Raw receipt: ignored
`data/day-native-phone-api-check-v2/result.json`.

The initial multi-sentence overview probe exposed a routing bug: extra wording
selected only three recent images. That failed run was preserved; the fixed
detector is covered by regression tests and the twelve-image live retest above.

The public HTTPS phone smoke passed single-use pairing, a secure HttpOnly session,
connected Notch scopes, computer-bridge connectivity, anonymous-access rejection
and a 390-pixel layout without overflow or browser errors. A prior smoke during
the twelve-image request briefly observed readiness false; the service reported
ready again afterward. This transient health observation is retained rather than
reported as uninterrupted availability.

A separate negative control deliberately asserted a nonexistent white floor mat.
Astra rejected it and Sol chose the correction in 12.05 s total. This demonstrates
the disagreement path, not an observed Qwen error. Review is performed by separate
ephemeral Codex jobs using the Mac's login; Astra/Sol inference is cloud-hosted.

The 127 retained production samples were successfully reprocessed on ASUS:
113 Qwen35B frame descriptions and 14 Whisper-small.en transcripts. The database
was backed up and all original hashes checked before replacing older 3B labels.
All 113 visual embeddings were retained. Nine text embeddings interrupted by a
service transition were repaired without relabeling or changing originals.

## Why Astra can look stronger: a controlled input comparison

Both models received the same 31 original JPEGs from the public 30-second
[workday kitchen excerpt](https://www.youtube.com/watch?v=SzZ6KcqlAgY&t=60s), six
questions, and the same structured output contract. No video title, acceptance
answers or previous model output was supplied. The original source hash is
`03b82f243750de109ca56856313f65ef109c4be8ee604caffb801bd92bdabfe5`.
The earlier incorrect utensil expectation was excluded before this comparison.

Astra's combined response took 13.764 s; native Qwen35B took 18.815 s. Both
returned valid question IDs/citation labels, identified red/yellow colors and
bottle-before-cheese order, and abstained on missing keys/shift-start evidence.
Astra described the bottle's horizontal position more precisely. Its exact
claim of two sandwiches was not established by the inspected frames, so it must
not be treated as ground truth simply because it came from Astra.

The old system Ollama 0.32.15 crashed on the same 31-image 35B input; the native
0.34.2 runtime succeeded. Earlier 27B testing also uncovered lost images in the
transport. Thus input handling, retrieval, prompt/output budget, runtime and
model ability all contribute to observed differences. This small test cannot
attribute the remaining gap to undocumented training or architecture, and larger
RAM alone does not remove it. Source verification remains necessary for both.

Raw comparison responses and failures are preserved under ignored
`data/model-gap-probes/`. No model-internal video token-compression patch was
installed; see [the research and implementation record](../../research/LONG-DAY-MEMORY.md)
for the application-level temporal selection and remaining dense-video limits.
