# Recall packet compression

All switches default off. The original recordings, transcripts, source provenance,
stored answer evidence, and Astra/Sol review packet remain unchanged. The change
is confined to the Qwen recall and rule-evaluation inputs.

`REWIND_RECALL_PACKET_COMPACT=true` projects storage provenance to a minimal
`source_timeline` and removes Whisper's word arrays/token IDs from the inference
copy. Imported clips keep exact relative `source_offset_seconds`, frame/clip
indices and clock. Deterministic per-packet `source_key` values (`V1`, `V2`, …)
group rows from the same full source hash and distinguish different hashes,
without repeating hashes or decoder PTS/time base/sample-rate metadata. The
unchanged original review packet retains those identities and decoder fields.
These fields preserve relative time and distinguish separate recording streams,
including synthetic clocks that intentionally have no wall-clock `recorded_at`.
Audio segments retain their exact
start/end seconds and text. An identical duplicate transcript is omitted; different
transcript and segment text both remain. Evidence becomes one JSON-array row per
source, with shared column names. Newlines and Unicode line separators inside text
are escaped, so recorded text cannot manufacture a new source row. This is a
custom compact format, not a TOON implementation.

The question, time zone, source labels, source times, clock quality, image order,
coverage gaps, temporal warnings, inherited-caption warning and system constraints
are unchanged. Rule packets retain the exact instruction and collapse object
records to labels. That rule projection removes geometry/descriptions and needs
its own accuracy comparison; it is not a guarantee of equivalent rule behavior.

`REWIND_COMPRESSOR=bear2` additionally sends only caption/transcript text to TTC's
HTTPS API. Labels, timestamps, the question, rule instructions, and digital account
source documents are excluded. `REWIND_COMPRESSOR_AGGRESSIVENESS=0.1` and `0.2` are
separate benchmark settings. Set `REWIND_TTC_API_KEY` in a private environment file;
never put its value in this repository, command output or benchmark artifacts.

The implementation calls `POST https://api.thetokencompany.com/v1/compress` with
`model="bear-2"`, `input`, and `compression_settings.aggressiveness`. Current raw
HTTP responses contain `output`, `output_tokens`, and `original_input_tokens`.
The SDK renames the latter to `input_tokens` and computes `tokens_saved` and the
ratio; those computed fields are not required HTTP response fields. This distinction
was checked against the [official quickstart](https://thetokencompany.com/docs/quickstart)
and [official SDK response type](https://github.com/TheTokenCompany/the-token-company-python/blob/main/src/thetokencompany/_types.py)
on September 19, 2026.

At most four TTC requests run concurrently, sharing a packet deadline controlled
by `REWIND_COMPRESSOR_TIMEOUT_S` (default 10). Missing credentials, HTTP failures,
timeouts, invalid counts, empty output or invented/reordered characters preserve
the original text and record `status=fallback` with an explicit error. A missing-key
benchmark is **not an executed bear-2 trial**. Neither a fallback nor an unmeasured
character reduction establishes token savings. Deletion-only text can still lose a
negation or important attribute; unchanged originals are supplied to verification.

Each compressor call records its own model, backend, status, tokenizer counts,
latency, whether the request was attempted and vendor tokens removed. Those counts
are separate from generative-model totals. Packet character counts are labeled as
characters, not tokens. Public [TTC pricing](https://thetokencompany.com/pricing)
bills by removed tokens but does not publish an account-independent numeric rate,
so attempted TTC request cost remains unknown until the account's quote is supplied.
The integration does not claim that account-level retention settings are enabled;
see the vendor's [retention documentation](https://thetokencompany.com/docs/data-retention).

`REWIND_COMPRESSOR=llmlingua` is an explicit alternative, never a silent substitution
for bear-2. Install the optional package with `pip install '.[compression]'`; the
pinned package is `llmlingua==0.2.2`. Its default checkpoint is
`microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank`, initialized lazily
with `use_llmlingua2=True` and `device_map="cpu"`. The retained rate defaults to
`REWIND_LLMLINGUA_RATE=0.8`. Loading may download the checkpoint on first explicit
use. When the ASUS processing service is configured, the authenticated
`/compress_text` endpoint performs this work there; an unreachable ASUS returns
unchanged text with an audited failure, never a Mac inference fallback.
Long packets use sequential requests of at most 32 texts and 80,000 characters,
sharing one packet deadline. Oversized individual texts and unattempted texts
after that deadline remain unchanged and receive individual fallback records.
Each attempted LLMLingua batch has a shared audit UUID, `batch_size`, zero-based
`field_index`, and `timing_scope=batch_request_wall`. Only its first field records
the batch's elapsed `total_ms`; other fields use null, while retaining their own
token counts and status. This is batch request wall time, not per-field CPU time.
Earlier R10 audit rows repeat batch time per field and remain unchanged; they do
not establish isolated compressor CPU cost or a valid sum of compressor latency.
Only one CPU batch can run at a time; a timed-out batch may finish in the
background, while subsequent requests retain original text instead of adding work.
The [official LLMLingua repository](https://github.com/microsoft/LLMLingua) documents
this small model and API; the [LLMLingua-2 paper](https://arxiv.org/abs/2403.12968)
describes task-agnostic token classification. No paper's reported compression or
accuracy numbers are treated as measurements of REWIND.

Network-mocked tests cover both bear-2 settings, response schema mismatches,
fail-open behavior, secret-free metrics, injected row syntax, CPU-only selection,
unchanged timestamps and warnings, and a deliberately removed negation reaching
Astra's **uncompressed** review packet. Actual latency, token reduction, and answer
quality require the separately controlled baseline/variant benchmark.
