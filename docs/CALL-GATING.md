# Optional caption and rule gates

The flags are off by default. Originals, ingest hashes, and per-frame OpenCLIP
retrieval remain available when a caption is reused. A reused caption is retrieval
metadata, not an independent observation of the new frame.

## Caption gate (Plan B)

`REWIND_CHANGE_GATE=true` enables the gate. Defaults are cosine greater than
`REWIND_CHANGE_GATE_SIM=0.97`, local pixel delta below
`REWIND_CHANGE_GATE_BLOCK=0.06`, and less than
`REWIND_CHANGE_GATE_HEARTBEAT_S=30` since an actual description.

The pixel signature is a 64×48 grayscale image. Its 8×6 blocks each contain
8×8 pixels. The score is the maximum block **mean absolute pixel difference**.
Taking the absolute difference before averaging avoids cancelling a small object's
movement within one block. It still can miss changes below its size/contrast
threshold; neither embedding similarity nor this signature proves identical
semantics. A heartbeat limits caption age, not every possible missed event.

Each decision is serialized per database, device, and boot. It can reuse only a
completed description with both an earlier sequence number and a non-future
capture timestamp in the same stream. Inherited captions never become anchors.
Other model calls can remain in flight: their incomplete or future results are
ineligible. This permits seven workers to avoid calls after a completed anchor
without serializing all expensive inference. Frame questions always receive a
fresh description. Missing or malformed vectors fail open to a description.

The gate reuses an already indexed OpenCLIP vector or schedules that frame through
the existing visual indexer; it does not drop frames from retrieval. It cooperates
with an indexer's live lease. An unavailable vector causes a fresh caption.

Events expose `label_mode` (`described`, `inherited`, `transcribed`, or migrated
`legacy`), `inherited_from`, `visual_similarity`, and `block_delta`. Reused captions
have confidence zero to avoid implying an independent model confidence. Their
timestamps still locate the original frame, not a new confirmed observation.

## Rule gate (Plan F)

`REWIND_RULE_GATE=true` permits a rule-model call when the instruction and event
share a lexical cue or their text-embedding cosine is above
`REWIND_RULE_GATE_THRESHOLD=0.45`. Missing, incompatible, or malformed embeddings
fail open. The lexical fallback includes summary/transcript words, tags, and
object labels; it is deliberately broader than grammatical noun extraction.
Negation stays in the complete instruction and evidence sent to the model.
The gate never establishes a true alert by itself.

Independently of the rule-gate flag, an inherited caption cannot establish a fresh
trigger and is excluded from rule evidence. Existing historical-backlog and
cooldown checks run first. Their already-avoided calls are not counted again.

`gate_decisions` stores each attempted decision, reason, current source, anchor,
scores, and threshold metadata. `Provider.record_avoided` sends skipped model calls
to the shared ledger. Any avoided-token values are estimates from measured prior
calls, not tokens measured from a counterfactual execution.

## Validation and benchmark scope

Tests cover static reuse, heartbeat from the actual source description, localized
object appearance and movement, seven overlapping workers, out-of-order uploads,
different streams, question frames, missing vectors, changed originals, edited
rule embeddings, negation routing, and preventing inherited-caption alerts.

`docs/evaluations/token-rule-gate-frozen.json` freezes eight synthetic text-only
observation/rule pairs before inference. `scripts/evaluate_rule_gate.py` runs R0
and R7 in new private workspaces and reports each model decision, true-trigger
recall, false alerts, runtime usage, and skipped evaluations. These observations
are not photographic ground truth and do not measure visual perception.

Use the current eight-slot 35B deployment as the control. The handoff document's
older serial Ollama throughput assumptions do not describe the current service.
Measured short-clip savings must not be extrapolated to a full day or called
lossless recall.
