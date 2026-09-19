# Long-day memory: compression with recoverable evidence

Research checked September 19, 2026. This is an implementation decision record,
not a claim that a published benchmark score has been reproduced on the ASUS.

Keep original capture as the durable record; compress the working representation
used to find and reason about it. Lossy summaries, visual-token pruning, and KV
quantization cannot guarantee arbitrary exact details from a day remain in the
active context. A question about a discarded detail needs recovery from the
original source. Even an original cannot recover an event the camera missed,
unreadable text, occluded actions, or speech the microphone did not capture.

## Five relevant recent approaches

All results below are the authors' reported results on their stated protocols.
They are neither directly comparable across papers nor latency forecasts for a
128 GB GB10 running Qwen3.5-35B-A3B.

| Work and verified date | Mechanism and relevant result | Fit for this project |
| --- | --- | --- |
| **StreamMeCo**, April 10, 2026; ACL 2026 Findings. SJTU, Fudan and collaborators. | Removes redundant text nodes using diversity and graph connections, then allocates retrieval across temporal segments with a recency term. Reports 70% graph compression, 1.87× faster retrieval and an average 1.0% accuracy improvement. [Paper](https://arxiv.org/abs/2604.09000), [method](https://arxiv.org/html/2604.09000v1). | Closest application-level match to Notch's graph. Adopt a bounded *working index* while retaining source IDs and a full archive. Do not evict the only evidence for rare events, and do not apply unconditional recency decay to “this morning” queries. |
| **TaskMem**, May 29, 2026. ByteDance Seed and Fudan. | Learns a policy for what episodic details to retain; a second training phase adapts it to encountered tasks. On streaming versions of EgoLife/VideoMME/EgoTempo, its memory-only evaluation disallows going back to raw video. Reports a 7.0-point EgoLife improvement over its Qwen3-VL baseline. [Paper](https://arxiv.org/html/2605.31075v1), [official code](https://github.com/ByteDance-Seed/TaskMem). | Strongest match to an egocentric personal assistant. Use its lesson to retain task-relevant fields such as object placements and explicit commitments. A policy trained on past questions may discard a detail needed by a novel question; keep a raw-source escape path. |
| **FluxMem: Adaptive Hierarchical Memory for Streaming Video Understanding**, March 2, 2026; CVPR 2026. Fudan/SII and collaborators. | Dense short-term memory gives way to temporal redundancy removal and then spatial consolidation. Compression thresholds adapt to scene statistics. Reports 69.9% lower latency and 34.5% less peak GPU memory on its OVO-Bench setup. [Paper](https://arxiv.org/abs/2603.02096), [accepted paper/affiliations](https://openaccess.thecvf.com/content/CVPR2026/papers/Xie_FluxMem_Adaptive_Hierarchical_Memory_for_Streaming_Video_Understanding_CVPR_2026_paper.pdf). | Good architecture for a recent dense buffer plus a cheaper distant history. Useful to test after baseline deployment; a stationary frame can still contain a crucial changing digit or hand action. This is the video FluxMem, not the other agent-memory projects with the same name. |
| **StreamingTOM**, October 21, 2025; CVPR 2026. Westlake/CUHK/Zhejiang/SII. | Prunes visual tokens before the LLM and keeps a quantized, retrievable KV memory. Reports 15.7× KV compression and 2× faster time to first token relative to LiveVLM in its evaluation. [Paper](https://arxiv.org/abs/2510.18269), [authors' project](https://yige24.github.io/StreamingTOM/). | A model-runtime optimization, separate from durable memory. Could reduce video prefill, but quantizing weights to Q4 does **not** implement this method or make the memory lossless. |
| **NovaCov / Think in Sets**, August 2, 2026 preprint. Beijing Jiaotong/Zhongguancun Academy/Tsinghua. | Selects a complementary set of tokens rather than independently taking the highest scores. A bounded historical bank tracks what the stream already represented. With LLaVA-OV-7B/ReKV at 0.5 fps, it keeps 50 of 196 tokens per frame; reports roughly 46% less prefill latency. [Paper and implementation protocol](https://arxiv.org/html/2608.01169v1). | The newest narrow match found in this review. The useful principle is coverage of new information rather than repeated near-duplicates. Its submodular approximation guarantee is for a mathematical selection objective, **not** exact recall or factual accuracy. |

## Code, license and runtime constraints

- **StreamMeCo:** the repository has an [MIT license](https://raw.githubusercontent.com/Celina-love-sweet/StreamMeCo/main/LICENSE).
  Its [setup](https://github.com/Celina-love-sweet/StreamMeCo) depends on the
  M3-Agent models and memory graphs. Copying the whole pipeline would introduce
  additional models and infrastructure; a small original implementation of the
  retrieval principle fits the existing archive better.
- **TaskMem:** [code license](https://raw.githubusercontent.com/ByteDance-Seed/TaskMem/main/LICENSE)
  is Apache-2.0; the [released checkpoint](https://huggingface.co/ByteDance-Seed/TaskMem)
  is labeled Apache-2.0, 31B BF16, but has an empty explanatory model card.
  The code's local path targets Qwen3-VL/vLLM; default ASR and evaluation paths
  expect Gemini/GPT credentials. That is not the currently requested Qwen3.5
  GGUF + local Whisper + signed-in Codex configuration. Optional face/voice
  dependencies need their own weight licenses checked; the repository license
  does not license every dependent checkpoint.
- **FluxMem:** [Apache-2.0](https://raw.githubusercontent.com/ShareLab-SII/FluxMem/main/LICENSE).
  The [released implementation](https://github.com/ShareLab-SII/FluxMem) patches
  the Qwen2.5-VL Python model and processor and uses FlashAttention. Its example
  wheel is Linux x86-64; this ASUS is ARM64, so that wheel is unsuitable.
- **StreamingTOM:** the [public repository](https://github.com/YIGE24/StreamingTOM)
  and its root README did not expose a root license in this review. No code was
  copied. Its documented stack pins Torch 2.5.1, Transformers 4.53.3 and
  FlashAttention 2.8, with a LLaVA-OneVision evaluation path. Verify permissions
  and port feasibility before vendoring any implementation.
- **NovaCov:** the checked paper/abstract did not link an official code release
  or code license. No implementation was copied. Its experiment uses a Triton
  kernel and a single RTX 5090; that is not a demonstrated GB10/Qwen3.5 backend.

None of these reviewed releases establishes a supported drop-in implementation
for our current Qwen3.5-35B-A3B Ollama/llama.cpp service. Turning them on would
require model-internal integration and a new accuracy/latency comparison. The
application-level selection below must not be advertised as deploying their
token algorithms.

## Immediately applicable design

The current application already preserves source records, original frame files,
audio, transcripts, visual embeddings and citation IDs. It retrieves with
lexical/text/visual search and sends a bounded set of original frames to Qwen,
then to Codex review. This is a sound starting point, but top similarity matches
can cluster around one activity. `memory.ask()` previously kept only six initial
matches before neighboring audio and context, so “summarize my day” could miss
the morning even when morning evidence existed.

Use four separate representations, all keyed back to immutable evidence:

1. **Capture archive:** original video/audio chunks, manifest hashes, wall-clock
   quality, device/session IDs, upload receipts, and explicit capture gaps.
   Sampled JPEGs alone do not amount to continuous video. Preserve original
   timing even when later decoding more frames from a saved clip.
2. **Fine index:** per-frame pixels/embeddings, per-segment speech with timestamps,
   explicit observations and uncertainty. Keep small transient details, especially
   where an object was last seen, as candidates rather than inferred permanence.
3. **Event windows:** bounded minute-scale records with start/end, participating
   source IDs, candidate entities/actions, model/version and unresolved conflicts.
   These summaries route retrieval; their text is not independent source evidence.
4. **Day navigation:** coarse hour/activity windows and verified Notch links. Use
   this to visit different periods, then reopen finer windows and exact originals
   for the user's question. Do not treat a calendar plan as attendance or a
   contact name as an image identity.

For a focused question, retrieve broadly by content, inspect originals, expand
around the best candidate in the **same recording stream**, and recover more
frames or audio if the decisive detail is absent. For a day overview, cover the
requested local day before zooming into events. Model-generated captions and
transcripts remain fallible; keeping them longer does not turn them into facts.

Keep named people as explicit, user-confirmed graph relationships and source
references. Automatic face/name matching is not implemented by this work. A
contact book or a textual mention cannot establish who appears in a frame.

## Implemented application-level integration

`server/rewind/temporal.py` is a dependency-free application-level selector. It
does not mutate originals, write the database, alter the model, or delete history.
Its tests use synthetic metadata only.

- `is_day_overview(question)` opts in only for conservative, explicit requests
  such as “summarize my entire day” or “what did I do today?”. Object, person and
  relative-time queries retain existing retrieval. An explicit opening overview
  still matches when followed by source qualifiers or additional sentences, such
  as “from the available recordings. What visible actions are established?”.
- `select_temporal_evidence(ranked, pool, limit=6, relevance_slots=2)` preserves
  top relevance, then favors unrepresented streams and separated times. Returned
  records retain exactly their input IDs, timestamps, clock quality and provenance.
  It does not assert that a selected sample represents everything in its interval.
- `evidence_coverage(pool, after=..., before=...)` reports available sample counts,
  first/last timestamps, gaps between sampled timestamps, queued analysis and
  missing boundary samples. Synthetic clocks are excluded from historical-day
  claims. `continuous_coverage_established` stays false: sample density is not a
  recording continuity receipt.

`memory.py` now uses the selector for day overviews, with these boundaries:

1. Today/yesterday use the configured local timezone and daylight-saving calendar
   boundaries; explicit time filters take precedence. The pool reads `media`
   metadata across the entire interval, including queued originals. Synthetic
   import clocks do not establish what happened on a historical day.
2. The overview branch selects up to twelve original frames and four audio
   records across time, hydrates only selected IDs, then merges same-stream audio
   neighbors and authorized Notch sources. All twelve frames can be attached,
   independently of the focused-query image limit. Metadata selection runs off
   the async event loop so it does not stall incoming phone uploads. Focused
   object/temporal queries retain their existing retrieval path and image budget.
3. Coverage receipts reach Qwen, Astra and Sol. A deterministic qualification
   states that the answer covers available samples, identifies substantial gaps
   between timestamps and pending analysis, and survives reviewer corrections.
   The initial answer API exposes `recording_coverage`; reviewed history retains
   it in `verification.receipt.recording_coverage` and in qualified answer text.
4. Existing citation validation, original hashes and source-revocation checks
   remain in place. An unattached generated caption still cannot verify a visual
   fact, regardless of whether its timestamp increases temporal coverage.

Cited partial answers also receive source review: setting `insufficient_evidence`
does not bypass Astra. Supported partial facts and citations remain available, but
the answer stays `grounded=false`, `mode=insufficient`, with
`receipt.claims_reviewed=true` and `receipt.answer_complete=false`. A Sol-selected
correction cannot silently promote the original insufficiency flag. Unverified
relative-time anchors likewise stay unresolved through review. A fully supported,
adequate answer continues to use `mode=verified` and `grounded=true`; this assesses
the supplied answer, not complete recording of a person's day.

Mocked integration tests cover distant originals, the larger overview image
budget, local-day and DST boundaries, synthetic-clock exclusion, unchanged
focused queries, and qualification surviving an Astra correction selected by Sol.
This establishes code behavior, not live multi-day answer accuracy. Durable
hierarchical event windows and model-level token compression are still separate
future work; no reviewed paper's token patch is deployed by this integration.

## Details between sampled frames: current boundary and next implementation

The phone now retains exact ordered `MediaRecorder` fragments in addition to the
one-second JPEG samples. `PhoneCapture.boot`, sample `X-Boot-ID`, and
`continuous_recordings.id` share the same UUID. This is a useful session link,
but it is not an exact time alignment: `started_at` is assigned before IndexedDB
initialization and `recorder.start()`, and fragment `captured_at` is the time the
browser delivers `dataavailable`, not a container presentation timestamp.

`sampled_evidence.py` now links cited physical samples to their exact session
manifest. `original_recording.original_url` is present only for a finalized,
contiguous, nonempty recording whose saved fragments match their recorded sizes
and SHA-256 hashes.
The route remains workspace-authenticated and streams the unchanged concatenated
bytes. Open, uploading, empty and missing-fragment states stay explicit; an
interrupted session retains its end reason even when every reported byte arrived.
Successful hash checks are cached against file identity, size and change
timestamps; modified fragments are rechecked and lose their original-video link.
Playback preflights hashes off the request loop and rejects unavailable or corrupt
fragments. This verifies retained bytes, not what those bytes depict.

Focused Qwen/Astra/Sol packets and verification receipts include `evidence_scope`:
selected still images were inspected, continuous video was not decoded, and brief
events between samples may be missing. Simple answers retain concise wording.
Exhaustive questions and unqualified historical absence claims get an explicit
sample limitation; day overviews keep their stronger coverage qualification.
Public evidence dictionaries preserve the authenticated full-original link for
the phone to display. This does **not** claim automatic dense video retrieval.

A bounded dense-recovery implementation should satisfy all of the following:

1. Trigger for a focused unresolved detail or explicit small time window, not
   every day overview. Use a retrieved sample's exact session UUID; never select
   another recording merely because its wall-clock timestamp is similar.
2. Require a finalized contiguous original. Verify its immutable fragment
   manifest and content hashes. If fragments are missing, uploading or changed,
   retain the sample-based result and expose why dense recovery was unavailable.
3. Decode at most one four-second candidate window and twelve additional frames
   per question, with a fixed decoder timeout and output-byte budget. Prioritize
   genuinely different adjacent frames. Keep original resolution for the small
   regions/detail questions that warrant it, without pretending that compression
   can restore unreadable sensor data.
4. Decode through a seekable ordered-fragment source or a quota-accounted reusable
   exact concatenation. Do not rebuild an entire hour-long file for every question,
   assume each fragment is independently playable, or charge heavy decoding to an
   already busy web event loop. Keep heavy inference on the ASUS.
5. Persist each recovered frame as a derived source with its own ID/hash and
   provenance: recording UUID, manifest hash, actual container PTS, time base and
   source offset. Mark its conversion to wall-clock time approximate unless a
   measured recording-clock anchor proves alignment. Existing phone metadata
   alone cannot prove subsecond wall-clock timing.
6. Add recovered sources to the existing bounded original-image packet and pass
   the same pixels through Qwen and Astra/Sol. Distinguish retrieval candidates
   from established actions; handle deletion/revocation and cache quotas before
   calling the result durable evidence.
7. Validate with a controlled fast action occurring entirely between the ordinary
   JPEG samples, a variable-frame-rate recording, delayed fragment delivery,
   missing/reordered fragments and a wall-clock jump. Report evidence recovery
   and additional end-to-end latency separately.

No dense decoder was added in this change. Implementing only FFmpeg extraction
without the alignment, provenance, quota and verification pieces would create
misleading timestamps and an unbounded latency path.

## Acceptance measurements

Evaluate detail recall and capture continuity separately from throughput. A small
controlled recording should include an object placed briefly, an object moved
twice, a visible digit changing, similar scenes hours apart, an ambiguous spoken
name, a calendar event that never happens, and a deliberate capture interruption.
Create expected answers from original human-inspected evidence, not the model's
own summaries. Compare the same model with no selection, bounded temporal
selection and any later token patch; report abstentions and false assertions as
well as correct answers.

Measure capture-to-durable-save, capture-to-index, queue growth, retrieval time,
Qwen answer time, and Astra/Sol review time separately at sustained capture load.
For multi-hour evaluation, report retrieval of the decisive original, not just
plausible narrative quality. No benchmark establishes that every future question
about arbitrary details will be answerable.
