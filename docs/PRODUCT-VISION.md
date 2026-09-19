# REWIND × Notch: shared physical and digital memory

User-confirmed product direction, September 19, 2026.

## The experience

Grandma scans a QR code with her phone and enters her personal workspace.
She taps one large **Record** button and clips the phone to her chest. The phone
stays awake and captures her surroundings and conversations. She can ask a
question at any time, by voice or text, and receive an answer grounded in what
was recorded and what her connected sources establish.

The same workspace initializes her digital context through **Notch**, specifically
`https://github.com/romirthedev/notch`. Its memory graph connects emails,
appointments, friends, family, notes, and physical moments. The phone capture
experience and digital context belong to one coherent personal memory.

The system should be proactive: for example, an appointment on a connected
calendar can trigger a reminder 30 minutes before it begins. Departure advice
requires actual location/travel information; the product must not invent it.

The central objective is to connect a **physical intelligence layer** to a
**digital intelligence layer**, with an experience simple enough for Grandma.
Phone capture is the primary path. The existing microcontroller capture path
is an optional additional input.

## Source and implementation requirements

- Copy the complete user-owned Notch repository and preserve its provenance.
- Reuse Notch's graph/notes and existing digital context. Build the bridge needed
  for the browser phone client and ASUS-backed analysis.
- Pair by QR without asking the phone user for server keys, terminal commands,
  or model configuration.
- Make recording, stopping, asking, and hearing a reminder clear and accessible.
- Keep the screen awake during foreground capture. Show interruptions explicitly.
- Keep originals, retry interrupted uploads, and distinguish saved from analyzed.
- Record continuous video and audio alongside the lightweight live samples.
  Preserve the original container fragments and interruption state; do not call
  a sequence of sampled images a complete recording.
- Use bounded working memory and temporal retrieval for long days, while keeping
  original evidence recoverable. Research recent streaming-video compression,
  but never promise that lossy token compression preserves every possible detail.
- Cover different periods for whole-day questions, show missing coverage, and
  distinguish inspected samples from full recordings that were merely saved.
- Remember face-to-name links only through explicit confirmation. Keep uncertain
  reappearances tentative, allow corrections/revocation, and never infer identity
  from the contact book alone.
- Connect actual authorized account data. Do not populate invented friends,
  emails, appointments, or memories to make the interface look complete.
- Support both reactive questions and proactive context-driven reminders.
- Keep every answer connected to inspectable source evidence. Calendar plans
  do not prove attendance; contacts do not identify faces; missing footage
  does not establish that an event never happened.
- Use the 128 GB ASUS over Tailscale for stronger vision models. Measure real
  parallel labeling throughput and question latency before choosing concurrency.
- Target Qwen3.5 35B-A3B for live ASUS vision and recall; retain originals and
  measure capture-to-answer delay, queue growth, and source accuracy under load.
- Run original-evidence review through this Mac's signed-in Codex: GPT-6 Astra
  checks the proposed answer; GPT-5.6 Sol adjudicates disagreements against the
  same sources. Drafts remain visibly unverified and are not automatically spoken.
  Agreement is evidence review, not a guarantee of truth. Missing evidence means
  abstention. Never claim a job ran in the active desktop chat when it ran in a
  separate ephemeral Codex session.
- Give the paired phone a computer-command mode using the actual Notch agent,
  with progress, cancellation, and its existing permission decisions. Captured
  audio, frame text, emails and memories must not silently become commands.

## Acceptance scenarios

1. A fresh phone scans a one-use QR link, opens the workspace, and records with
   one tap after normal camera/microphone permissions.
2. A recording continues with the screen awake; switching away or an interrupted
   camera produces a visible paused state. Saved uploads survive a reload.
3. A question retrieves original physical evidence and relevant Notch sources,
   presenting citations that the user can inspect.
4. Connected notes and explicit relationships appear in the memory graph;
   physical mentions are distinguished from verified relationships.
5. An actual upcoming calendar event produces one reminder in the 30-minute
   window; cancellation, changed times, stale sync, and disconnect are handled.
6. The UI exposes connection/analysis failures instead of claiming that it
   recorded or understood everything successfully.

This file preserves the intended product. Check the implementation and test
reports for which parts are running or awaiting account/device setup.
