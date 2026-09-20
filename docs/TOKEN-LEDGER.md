# Runtime token measurements

Set `REWIND_USAGE_LEDGER=true` before starting the API to record model calls in
the workspace SQLite `usage` table. `REWIND_USAGE_VARIANT` labels each call's
configuration. The authenticated `GET /api/usage/summary?since=0` route returns
totals, stage and variant breakdowns, compressor measurements, and the ten most
recent frame-description decisions. `since` is a nonnegative finite Unix time.
The desktop System tab displays this ledger; it does not add controls to the
phone's Record flow. Earlier unmetered recordings are not assigned invented costs.

Runtime fields were checked on the installed ASUS llama.cpp service and Ollama:

| Source | Counters retained | Timing |
|---|---|---|
| llama.cpp | `usage.prompt_tokens`, `completion_tokens`, cache-hit detail | `timings.prompt_ms`, `predicted_ms`; their sum is request inference time |
| Ollama | `prompt_eval_count`, `eval_count`; cache hits unknown | Runtime nanosecond durations converted to milliseconds |
| OpenAI Responses | Reported input/output and cached-input tokens | Client wall time; inference duration unknown when not returned |
| Local Codex CLI review | `turn.completed.usage` input/output/cached-input | CLI wall time; no invented GPU duration or subscription invoice |
| bear-2 / LLMLingua | Compressor tokenizer input/output, original/output characters | Compression wall time; not included in generative-model token totals |

The actual remote preflight returned 28 prompt and 38 completion tokens, with
57.489 ms prompt evaluation and 523.656 ms generation. A separate real Astra
CLI probe returned 9,004 input and 61 output tokens; its inference duration was
unavailable. These are integration checks, not corpus benchmark results.

Unknown counts are `null`, not zero. Partial measured subtotals include explicit
missing-call counts; an incomplete full cost or naive-token estimate is `null`.
Ledger rows contain no raw prompts, answers, recordings, or credentials. They
retain media IDs, model identity, status, wall/runtime timing and bounded audit
metadata. The full recording/answer stores remain separate and private.

Gate-avoided calls are estimates based on a previous measured call, with the
reference usage ID retained. They are not executed counterfactuals. Only paired
baseline and treatment runs establish measured token savings. A failed request
still counts tokens when the runtime reports them. A telemetry failure does not
discard an otherwise successful model answer or saved recording.

`inference_seconds` sums possibly parallel request durations. It is neither GPU
occupancy nor benchmark elapsed time. The illustrative cloud equivalent applies
configurable [$0.40/M input, $0.10/M cached input, $1.60/M output reference rates](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
to recorded tokens. Different model tokenizers and image accounting differ, so
this is not a quoted cloud deployment cost or the user's bill. Missing cache
counts are conservatively priced at the uncached rate. Actual local energy cost
and TTC account pricing are not inferred.

See the [frozen benchmark protocol](evaluations/TOKEN-SAVINGS-PROTOCOL.md),
[frame/rule gates](CALL-GATING.md), and [text compression](PROMPT-COMPRESSION.md)
for the experimental switches, evidence-preservation rules, and limitations.
