# ASUS processing, Codex evidence review, and Notch phone control

The phone's existing HTTPS origin and workspace stay on the Mac. Original uploads
are durable there. A private authenticated inference service on the ASUS performs
vision, speech transcription, text reasoning, and embeddings. Original-pixel
OpenCLIP retrieval also runs on the ASUS, independently of queued descriptions.
Its revision must match the stored index; a different encoder cannot silently
mix incompatible vectors. An SSH loopback
forward over Tailscale connects the two; neither the model server nor the native
Notch token is published through Funnel. No Mac vision-model fallback is used
when `REWIND_PROCESSING_URL` is configured.

## Inference and latency

The target is `qwen3.5:35b-a3b-q4_K_M`. Speech uses faster-whisper on the same ASUS;
the vision model does not transcribe audio. Compact frame descriptions reduce
output tokens; originals remain available for detailed questions. Short audio
transcripts are indexed directly instead of adding another model paraphrase.
Questions receive the next available inference slot ahead of queued frame labels.
Recently received originals can be inspected before their background labels finish.

A healthy HTTP service is not proof the model is ready: `/health` checks the
configured model. While it is downloading or disconnected, recordings remain
queued without using up their processing retries. Capture-to-result latency,
sustained frames per second, question latency under load, and factual correctness
must all pass before describing a configuration as near-live. RAM capacity alone
is not a speed benchmark. The earlier native 27B concurrency experiment failed
that requirement and is not the live target.

The speech transport was measured with a clearly identified synthetic utterance:
3.786 seconds of speech took 5.130 seconds cold and 3.072 seconds warm, including
the Mac-to-ASUS round trip. Both transcripts preserved the question. This tests
speech latency and transport, not noisy real-world accuracy.

## Evidence review

Enable `REWIND_CODEX_VERIFY=true` on the Mac API. The installed Codex CLI uses
its existing ChatGPT login, with model names `gpt-6-astra` and `gpt-5.6-sol`.
No API key is required. These are separate ephemeral Codex jobs, not turns
in an already-running desktop chat.

1. Qwen proposes an answer with strictly checked source labels.
2. A durable review job marks it as a **draft / checking**, never grounded yet.
3. Astra receives the original selected JPEGs, source text, and candidate answer.
4. If Astra disagrees or is uncertain, Sol receives the same sources and both
   candidates. It can select either or reject both.
5. Only a supported result with valid citations is published as checked. Changed
   originals, changed/disconnected digital sources, invalid citations, a failed
   Codex login, and unavailable quota cannot become a verified answer.

The phone shows reviewer reasons and timing. Checking drafts are not automatically
spoken. Review jobs have no computer-control tools, use a read-only sandbox, and
ignore user configuration/plugins. Completed audit records keep the requested
model, session receipt, timing, source hashes, and decisions. Connected-source
revocation removes stale reviews with the associated answer.

Agreement is not certainty. A transcript-only source can establish what the
automatic transcript says; these image review jobs do not independently verify
original audio. The product must preserve that distinction.

A real integration probe on September 19, 2026 supplied the public day-in-the-life
clip's original frame E16 and a deliberately false claim that a white floor mat
was visible. Astra rejected it in 6.947 seconds; Sol selected the correction in
5.095 seconds. Total review time was 12.05 seconds. This validates routing and
source review, **not** Qwen 35B speed or general accuracy. Raw receipts are kept in
ignored `data/codex-live-review-probe/`.

## Actual Notch computer control

The paired phone's **Your computer** tab invokes the full copied Notch app,
not the read-only context bridge. The narrow API exposes command, state, cancel,
and a decision for one exact pending permission UUID. Commands use durable request
IDs; a retry after uncertain delivery cannot repeat the action. Native commands
reject a busy stage. The phone does not automatically execute observed text,
ambient speech, retrieved notes, or model-generated memory answers.

Notch retains its memory graph, context, skills, screen perception, activity
stream, and permission store. Set `NOTCH_AGENT_BACKEND=codex` when launching it
to use the Mac's existing Codex login and Astra. Its bundled `codex-agent.py`
adapts the supported app-server protocol to Notch's existing result events.
Codex starts read-only with approval requests routed to the existing Notch
permission store. It does not install persistent approvals or change the selected
Notch permission mode. The original Claude backend remains available.

The real phone API → Notch → Astra path was tested by creating
`/tmp/rewind-notch-phone-smoke.txt`, reading it back, and verifying the exact
contents. A second test created a document in TextEdit, saved it as
`/tmp/rewind-notch-phone-gui-smoke.txt`, and verified its contents and open document.
The first GUI attempt revealed that app launching inside Codex's read-only sandbox
can misleadingly report a missing executable. GUI commands now request individual
sandbox escalation through Notch's existing permission policy; the repeated test
succeeded. macOS Accessibility and Screen Recording permissions are separately
required for GUI interaction. The Mac must stay awake and Notch must be running.

## Launch configuration

Use `.env.example` for the settings. Store actual tokens in ignored mode-0600
files. For the ASUS service, leave `REWIND_PROCESSING_URL` empty, set a strong
`REWIND_PROCESSING_TOKEN`, and run:

```sh
.venv/bin/python -m uvicorn rewind.processing:create_processing_app \
  --factory --app-dir server --env-file data/asus.env \
  --host 127.0.0.1 --port 11440
```

Forward Mac loopback 11440 to ASUS loopback 11440 using the existing private SSH
configuration. `scripts/maintain_tunnel.py --ssh-config <private-config>` reconnects
these forwards with backoff after a network interruption. On the Mac, set the same processing token, URL
`http://127.0.0.1:11440`, compact observations, the 35B model names, and Codex
verification. Build and launch the full native app with:

```sh
bash integrations/notch/scripts/build-app.sh
NOTCH_AGENT_BACKEND=codex integrations/notch/build/Notch.app/Contents/MacOS/Notch --rewind-control
```

`--rewind-control` binds the full Notch bridge to loopback 8737. Set
`REWIND_NOTCH_CONTROL_URL=http://127.0.0.1:8737`; the existing read-only context
bridge can stay on 8738. The browser receives neither token.

Codex integration follows the [noninteractive CLI documentation](https://developers.openai.com/codex/noninteractive/)
and [app-server protocol](https://developers.openai.com/codex/app-server/).
