# Rewind technical presentation evidence

The sponsor presentation explains mechanisms that exist in the code and labels
measured experiments separately from the current demo configuration. Editable
PowerPoint exports and personal film/photo assets stay outside Git.

## Sponsor sections

- **Long Lake:** original source inspection, source identity, timestamps, and
  ingest SHA-256 validation. Sources: `server/rewind/verification.py`,
  `server/rewind/sampled_evidence.py`. The medicine film is an illustration, not
  a skeptical-user adoption study.
- **ASUS:** Qwen3.5 35B-A3B Q4_K_M on the 128 GB-class GX10, eight native runtime
  slots with 32,768 context tokens per slot, all 42 layers on CUDA, and flash
  attention. Questions receive admission priority over background labels, without
  preempting in-flight work. In a 32-frame paced phone replay, 32/32 completed and
  capture-to-result p95 was 7.554 s. A separate application question completed
  with review in 16.300 s. Source: `docs/evaluations/QWEN35-LIVE.md`.
- **Cognition:** team-attested Devin interface work, illustrated with the actual
  capture state machine and recovery contract. IndexedDB persists original
  fragments before upload. Source: `docs/CONTINUOUS-RECORDING.md`. Attribution
  does not imply Devin independently authored every capture implementation.
- **The Token Company:** shared-column JSON-array packets, retained timestamps
  and source keys, and an independent uncompressed review packet. Eleven recall
  and planning questions on two short clips used 40,874 baseline versus 32,205
  compact tokens (21.2% less). A separate 448px observation experiment used
  15,715 versus 10,077 (35.9% less). Separate stages/configurations are not
  additive. Reviewer tokens are excluded. Sources: `server/rewind/prompt_packets.py`,
  `docs/PROMPT-COMPRESSION.md`, `docs/evaluations/TOKEN-SAVINGS-2026-09-19.md`.
  Neither token savings nor the small evaluation establishes equal quality,
  day-long exact recall, latency gains, or a Token Company API integration.
- **Dropbox:** physical capture plus authorized digital context, snapshot sync,
  dependent-answer invalidation, and document routing. Context sync runs every
  minute. Changed or disconnected sources invalidate dependent cached answers.
  Sources: `server/rewind/context.py`, `docs/PHONE-NOTCH.md`. This is challenge
  fit, not a Dropbox storage/API claim.
- **Deepgram:** Nova-3 transcription and Aura-2 Thalia speech, with the memory
  answer review gate before speech and explicit browser playback states. Four
  live browser flows passed using synthetic camera/microphone inputs. Source:
  `docs/VOICE-AND-MAIL.md`. Physical-device acoustic performance remains a
  separate validation requirement.
- **Healthcare:** upcoming-event reminders depend on source freshness,
  cancellation/rescheduling, and deduplication. Sources: `server/rewind/context.py`
  and `server/tests/test_context.py`. This is a memory-support prototype without
  measured clinical, diagnostic, treatment, or adherence outcomes.
- **OpenAI:** original-evidence review through signed-in ephemeral Codex jobs.
  Astra checks a Qwen candidate; Sol adjudicates disagreement. A deliberate
  unsupported floor-mat control exercised rejection and correction in 12.05 s.
  Sources: `docs/LIVE-PROCESSING.md`, `server/rewind/verification.py`. This is
  neither proof of universal correctness nor a demonstrated paid Platform API
  integration.

## Demo and architecture distinctions

Mac storage holds original media and the personal workspace. ASUS performs local
perception/retrieval. Selected review evidence goes to Codex and speech audio goes
to Deepgram. The architecture is hybrid.

The full Notch source is bundled under `integrations/notch`; `UPSTREAM.json`
retains original source hashes. The context bridge and computer agent preserve
authorization boundaries. Recorded speech and quoted account content do not
independently authorize computer actions.

The prepared walkthrough path explicitly reports `demo_cached` and
`fresh_model_review=false` for operator-reviewed cached responses. It must not be
presented as a fresh model run. See `docs/DEMO.md` and `server/rewind/demo.py`.

Mail scanning currently recognizes the document family and merges controlled
fixture details when template mode is enabled. Six live routing cases passed;
this is not an arbitrary OCR-accuracy benchmark or an external calendar write.
See `docs/evaluations/MOBILE-CAPTURE-SCAN-2026-09-20.md`.
