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
- Connect actual authorized account data. Do not populate invented friends,
  emails, appointments, or memories to make the interface look complete.
- Support both reactive questions and proactive context-driven reminders.
- Keep every answer connected to inspectable source evidence. Calendar plans
  do not prove attendance; contacts do not identify faces; missing footage
  does not establish that an event never happened.
- Use the 128 GB ASUS over Tailscale for stronger vision models. Measure real
  parallel labeling throughput and question latency before choosing concurrency.

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
