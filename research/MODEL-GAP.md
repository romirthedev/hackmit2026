# Diagnosing model, evidence, runtime, and reviewer errors

September 19, 2026. This diagnosis follows the [actual video evaluations](../docs/evaluations/OPEN-VIDEO-2026-09-19.md), rather than treating model size as the complete explanation.

**Post-inference correction:** the original “tongs” criterion was wrong. Reinspection of the original late frames shows gloved fingers gripping bacon. The model was right to say hands. See the [audit erratum](../docs/evaluations/daylife-pov-erratum.json) and [GX10 follow-up](../docs/evaluations/GX10-VISION.md). The earlier claims below have been corrected; raw runs and the frozen question plan are preserved.

## What differs

| Factor | REWIND's tested local path | Assistant review in this task |
|---|---|---|
| Model | `qwen2.5vl:3b`, Q4_K_M, reported 3.8B parameters including the vision stack | A GPT-6-based assistant; exact internal parameter count and training recipe are not established here |
| Visible evidence per answer | At most three retrieved originals, selected by relevance with a two-second separation; other matches may supply fallible captions | A contact sheet of the entire sampled sequence, then selected full-resolution frames |
| Time order | Images are passed in retrieval order; source offsets exist in metadata | Explicit review of successive moments before and after an action |
| Workflow | One structured answer call after retrieval; no tool for the model to request another frame | Multiple inspection steps, source checking and correction |
| Prior context | User question plus retrieved evidence | Source inspection, prewritten criteria, pipeline code, generated answers and failure history |

This was **not an equal-input, blind model comparison**. The assistant had privileged context and more opportunities to inspect evidence. It also corrected an initial mistaken expectation of egg portions after inspecting larger frames. Better review is not infallibility.

The model likely contributes to the difference, but the available results cannot isolate model architecture, training, inference effort or quantization effects. In particular, there was no Q4-versus-higher-precision experiment. The same local model scored 5/5 on the simpler outdoor sample and 1/6 under the remaining valid criteria on the moving workday sample, showing substantial scene/task sensitivity.

## Same-model evidence diagnostic

The model, Ollama settings, `RecallAnswer` schema and answer system prompt were kept unchanged. Three failed/unsupported workday questions were rerun with six human-selected originals at approximately **14, 16, 18, 21, 27 and 30 seconds**, in chronological order. Retrieval, temporal planning and generated captions were bypassed. No expected answers were supplied to the model.

This is an **oracle-context diagnostic**, not an unbiased retrieval benchmark: the reviewer already knew which frames were relevant. It changes evidence selection, image count, order and caption contamination together, so it cannot isolate which one caused an improvement. Raw inputs, source paths and responses are saved locally under ignored `data/model-gap-probes/`.

| Question | Original pipeline | Same model with selected chronological context | Seconds |
|---|---|---|---:|
| Bottle used before or after cheese? | Incorrectly said after | Correctly said before, citing the supplied frames | 50.680 |
| Which utensil picked up food? | Incorrectly said “tongs,” with unsupported frame citations | Said gloved hands, supported by the source frames after correcting the reviewer’s mistaken criterion | 7.926 |
| When did the shift begin? | Invented 3 PM | Invented 10 AM | 8.139 |

**After the explicit post-inference correction, two of the three answers are supported; the invented shift start still fails.** The previously reported 1/3 was based on an incorrect “tongs” expectation. Excluding that invalid criterion leaves 1/2 supported answers under unchanged criteria. Better evidence improved action order and produced a correct hands answer; it did not fix abstention. All three responses reported sufficient evidence, including the invented shift time.

Therefore both the evidence pipeline and model behavior need work. These calls reused a common image/prompt prefix and ran sequentially; their latency difference is not an independent model-speed comparison. They do not replace the original full-pipeline run (historically reported as 1/7; 1/6 after excluding the invalid criterion).

## Can REWIND use the stronger model?

Yes. The official [GPT-6 Astra model page](https://developers.openai.com/api/docs/models/gpt-6-astra) documents image input, reasoning, function calling and structured outputs through the Responses API. It does not accept video or audio directly: use sampled frames and separately transcribed speech. The [vision guide](https://developers.openai.com/api/docs/guides/images-vision) supports multiple image inputs, which are billed as tokens, and documents remaining perception errors.

The existing `Provider` already has a Responses API adapter. Its cloud settings are `REWIND_PROVIDER=openai`, `REWIND_OPENAI_MODEL=gpt-6-astra`, and a private `REWIND_OPENAI_API_KEY`. No API key was configured in the checked project settings or shell, so no live Astra API comparison was performed. The existing cloud switch covers both frame analysis and recall, and uses cloud transcription; it is **not yet a separate cloud-only recall route**.

Codex/ChatGPT subscription sign-in and general API authentication are different. The [official authentication documentation](https://learn.chatgpt.com/docs/auth) directs general OpenAI API calls to Platform API keys. The proposed product integration should use those credentials rather than extracting or repurposing the desktop sign-in session. As documented on the model page at inspection time, standard Astra input/output token rates are $10/$50 per million for requests below the long-context threshold; an actual per-question estimate needs image-token and output/reasoning usage measurements.

## Recommended next design and comparison

1. Keep capture, originals, image indexing and candidate search local.
2. On a question, retrieve relevant time windows and send an ordered sequence of original frames to a stronger answer model.
3. Let the answer model request additional nearby frames or crops through bounded retrieval tools when the first set does not establish the answer.
4. Check every factual claim against the cited original frame/interval; preserve “unknown” for unseen events. A second model's approval is still not a proof of truth.
5. Measure accuracy, latency and actual API usage on fresh clips with prewritten criteria.

The clean comparison is a 2×2 study: local versus Astra model, each with the same original retrieval and with the same improved chronological context. Use identical source bytes, questions and grading rules, preserve failures, and keep criteria out of inference. That separates model effects from context effects better than comparing this assistant's informed review to a single local call.

This document recommends the hybrid design; it does not claim that a cloud benchmark, hybrid routing or iterative retrieval has already been implemented or validated. A stronger model should be tested, not assumed to provide perfect recall.

## GX10 follow-up

The larger-model experiment exposed an additional runtime failure: Ollama dropped
equal-sized images supplied together in one turn. Sending each original in a
separate turn fixed the controlled color probe. The application now does this
and orders attached recall frames chronologically within each device stream.
The corrected 27B diagnostic abstained on keys and shift start and recovered
action order, but still added unsupported food details. The detailed
[GX10 evaluation](../docs/evaluations/GX10-VISION.md) separates those results from
full-pipeline accuracy and records the mistaken human tongs criterion explicitly.
This is evidence for checking pixels, transport and review quality alongside the model.
