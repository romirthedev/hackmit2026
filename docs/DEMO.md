# Protected walkthrough demo

This branch keeps the reviewed dorm walkthrough separate from transient captures.
The phone, voice controls, and two-document camera handoff remain the same.

## Rehearsal

Ask short questions such as “Where is my medicine?”, “Where are my Goldfish?”,
“Where are my medical papers?”, and “Where is my grandson?”. Follow with “Where
exactly?” or “Tell me more.” The named-person entry can additionally define
contextual followups such as “How is he sleeping?”. Other grounded walkthrough
items can have their own entries.

Answers show **Saved walkthrough · source reviewed** and inspectable originals.
They reuse an explicitly recorded original-evidence review; they do not claim a
new model review occurred. An initial answer is brief and details are separate.
Unrecognized questions, unsupported compound requests and explicit time filters
continue through ordinary retrieval. Newer unrelated conversation breaks the
cached followup context. A cached location is not evidence of a current move.

For the second scene, photograph the two supplied printable props together with
Camera: the personal letter and medical bill. Real ASUS vision recognizes which
document families are visible; the existing demo-template setting supplies the
known prop details. Both animations then deliver the note and calendar item.
Objects, blank pages, and shopping receipts stay in Moments. This is a prop demo,
not validation of arbitrary medical-document extraction.

**Memory → Reset live demo memories** clears scans, new recordings, and question
history, retaining the reviewed walkthrough, its derived labels, original video
fragments, and prepared speech. Single-source deletion of protected evidence is
also rejected. Missing/invalid manifests or changed originals block reset rather
than falling back to a full wipe. Reloaded phones reject delayed pre-reset uploads.

## Private data and launch

Personal recordings, reviewed facts, audio, source hashes and detailed evaluation
outputs belong under ignored `data/`, never Git. The commit contains the mechanism
and synthetic tests, not a copy of someone's dorm footage. Back up both the data
directory and SQLite database before preparing a walkthrough.

The private manifest lives at `<data_dir>/demo/manifest.json`. Its strict schema
is `DemoManifest` in `server/rewind/demo.py`:

- `version: 1`.
- `recordings`: complete recording IDs and every `{seq, sha256}` fragment.
- `media`: `{id, sha256}` for each reviewed image.
- `entries`: unique ID, aliases, exact questions, optional `detail_questions`,
  optional context-scoped `followups`, short `answer`, `details`, `evidence_ids`,
  and a `review` containing reviewer, epoch timestamp, method
  `original-evidence-review`, and honest review/scope notes.

Source IDs must already exist in the selected private workspace. Retain readable
source evidence and distinguish direct visual findings from user-supplied names,
ownership and other claims. Never mark an automatic label as a completed review.

Validate/install the private fixture and synthesize every answer in advance:

```sh
.venv/bin/python scripts/prepare_demo.py \
  --env-file /private/path/to/runtime.env \
  --manifest /private/path/to/reviewed-manifest.json \
  --install --warm-voice
```

Run from this checkout with the same private settings:

```sh
.venv/bin/python scripts/run_demo.py \
  --env-file /private/path/to/runtime.env --port 8004
```

The demo launcher forces protection on and refuses startup until the walkthrough
validates. The ordinary server defaults to `REWIND_DEMO_MODE=false`; explicitly
set it true when using another launcher. `REWIND_DEMO_RESPONSE_DELAY_S` defaults
to 0.70 seconds, plus a bounded 0–179 ms variation. Prepared voice files survive
demo reset. Keep the private app's existing HTTPS/phone pairing route.

Storage still rejects uploads at the configured reserve. On a constrained demo
machine the launcher accepts `--min-free-gb 0.5`; this changes the free-space
reserve, not the retained-storage quota, and never evicts protected originals.

## September 20 validation

- Full backend suite: 411 tests passed, including source-integrity, contextual
  followup and reset tests. Test fixtures disabled the free-disk reserve because
  the host had less than the ordinary 2 GB reserve; production retains 0.5 GB.
- Production build, TypeScript, frontend and backend lint passed.
- Built-browser checks cover cached-answer speech on desktop and phone, truthful
  source labels, disabled reset when protection is unavailable, and non-demo
  reset compatibility at multiple viewport sizes.
- Actual private evidence replay: 12 short answers and 12 detailed answers,
  exact source matches, real speech synthesis/cache and real speech recognition.
  Cached-answer HTTP latency was 0.72–0.93 s including the deliberate pause;
  audio HTTP responses were typically about 2 ms. Phone text conversation
  completion was 1.7–2.6 s. These are local measurements, not device/network SLAs.
- Fresh speech generation for the four main short answers was 2.1–3.0 s;
  their detailed replies took 5.6–7.4 s. Both sets are now prepared privately.
- Real ASUS recognition with browser camera fixtures passed letter, bill, both
  together, ordinary objects, blank paper and receipt cases. Both documents
  reached their destinations through the existing animations without page errors.
- Private original evidence was checked against independent backup hashes.
- Isolated full reset preserved all 123 images, 63 video fragments and 24 voice
  replies, removed new scans/recording/history, and left all reviewed answers
  callable. A two-document recognition replay completed in 2.44 s.

Actual handheld framing, browser audio permissions and venue network behavior
still require a physical-phone rehearsal. Tests use real services with controlled
camera inputs; they do not certify every possible photo or utterance.

## Optional live-model replacement

Not implemented or shipped. The current runtime has no configured OpenAI API
credential, and the existing Codex command runner starts individual evidence
review processes. That is not a validated persistent live-media session.
The documented OpenAI [Live session API](https://developers.openai.com/api/reference/typescript/resources/live/methods/create)
requires API authentication and a WebRTC session. Its latency and behavior with
this phone/network have not been measured. Ordinary ASUS-backed capture remains
available with its existing processing/review delays. No untested fast path is
presented as a dependable instant demo, and no second feature commit is included.
