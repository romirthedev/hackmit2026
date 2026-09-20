# Record once, then talk

> Update: the phone now answers spoken questions through the wake-word path
> (`/api/voice/*`, Deepgram in and out) described in [VOICE-AND-MAIL.md](VOICE-AND-MAIL.md).
> The conversation queue below still serves typed requests and Mac commands.

The phone's Record gesture starts continuous camera/audio capture, sampled JPEGs,
microphone speech detection, and spoken responses. A directed question or request
requires no separate Ask button or switch to computer mode. The text field and
existing Notch panel remain available for corrections and inspecting actions.

An AudioWorklet sends PCM samples to bounded browser silence detection. It retains
250 ms of pre-roll, ends an utterance after 850 ms of silence, and caps each at
20 seconds. A minimum of 180 ms of voiced samples preserves short yes/no replies
while rejecting brief clicks. Each utterance becomes a 16 kHz PCM WAV in the durable IndexedDB spool.
Authenticated uploads retain a recording identity, sequence, capture timestamp,
original bytes and SHA-256. Retries are idempotent; conflicting bytes are rejected.
Speech receives upload priority. Full original video/audio continues independently.

The ASUS transcribes speech with Whisper and uses Qwen3.5 35B to classify a direct
memory question, a computer request, a clarification, or ambient speech to ignore.
Transcribed utterances also enter ordinary recorded memory. The old ten-second
ASR loop is disabled while speech detection works, avoiding duplicate transcription.

Memory questions use original evidence and the existing Astra review, with Sol
adjudicating disagreement. Only reviewed factual responses are spoken. Checked
partial answers retain their uncertainty. Drafts and old unverified answers cannot
become spoken facts or trusted follow-up context. Completed review receipts retain
the exact original source labels, media IDs, and ingest hashes.

Recognized questions receive a short “Let me check that” acknowledgement. A fresh
checked receipt updates the answer card before the factual reply is spoken; slower
dashboard polls cannot restore an older draft card. Responses are deduplicated by
turn and revision. A bounded speech watchdog resumes listening if the browser
never reports that playback ended.

Computer requests use the actual Notch agent and an idempotent command ID. A
follow-up receives the full prior checked answer and actual action response in a
private, immutable JSON reference file, with its path and SHA-256 passed to Notch.
This preserves long answers and their uncertainty across intervening actions such
as opening an app. The file counts against storage limits and is rechecked on
retry; the current utterance remains the authority for the new action.
Existing Notch permission decisions still apply. A spoken yes/no can resolve only
the exact current request and dialog, within its short approval window; queued
speech preceding that permission request cannot approve it. Uncertain action
delivery is reported and is never silently replayed.

## Verification on September 19, 2026

A real Chrome run used the built phone page, one Record click, prerecorded speech,
and Chrome's visibly green test camera. Without another interaction, the system
detected and uploaded “What color is the screen?”, transcribed it on the ASUS,
routed it through Qwen, inspected three original JPEGs, received Astra approval,
and invoked speech synthesis with the correct green answer. It produced one
utterance, no duplicate legacy ASR uploads, and no page errors. The reviewed answer
arrived 18.15 seconds after upload, or 23.36 seconds after Record. This is a complete
browser pipeline test with synthetic input, not physical-phone validation.

A separate Chrome regression kept speech playback active across two recording
starts: zero assistant utterances entered the request queue, nine original-video
fragments were retained, and user speech was detected again after playback ended.
Explicit UI fixtures also confirmed that the checked label and receipt appear
before final answer playback. All browser reports and media remain in ignored
`data/voice-qa`.

A separate speech-to-action test uploaded “Open TextEdit on my Mac” into an
isolated workspace using the real ASUS and native Notch. The transcript appeared
after 2.03 seconds; Notch began acting after 3.04 seconds and reported completion
after 20.17 seconds. The durable command ID matched, and independent macOS
accessibility inspection confirmed TextEdit with the existing test document open.
This verifies that particular action, not arbitrary Mac automation.

A final follow-up used a backup of that genuinely checked green-answer workspace:
“Save that answer in a new plain text file at /tmp/rewind-handsfree-answer.txt.”
Qwen routed the request, Notch read the full reference JSON, and the real output
file exactly matched the checked answer, including its evidence IDs. The action
completed in 17.18 seconds with matching command and context hashes. No synthetic
answer was inserted to provide the handoff context.

An actual failed object-location question exposed two separate problems:
retrieval discarded adjacent placement views, and image attachment ordinals did
not consistently match source labels. Object-location retrieval now preserves
the reference object, nearby views around a strong match, and competing instances.
Every image carries its exact source label into inference. In a replay against
the user's unchanged originals, Qwen still confused a seat with a lap; Astra
corrected the factual answer and Sol agreed. The first twelve-image corrected
replay took 49.5 seconds. Private recording contents and receipts stay in ignored
local data, never in this repository.

A bounded eight-image variant preserved the key neighboring views, the initial
reference, a competing instance, and an older alternative. The same historical
replay remained correctly resolved by Astra and Sol and took 33.28 seconds;
Qwen's draft stage fell from 31.10 to 14.55 seconds. This is the retained
object-location budget. It is a single-case improvement, not a general latency
or accuracy guarantee; whole-day coverage retains its separate twelve-image budget.
After deployment, the same question was submitted through the production phone
API and produced the corrected, cited partial answer in 28.09 seconds, again with
Astra's correction and Sol's agreement. The production answer remains available
in the phone's answer history.

## Current limits

This is turn-taking speech. Microphone request routing pauses while the phone
speaks to prevent the assistant's voice from generating its own commands; full
recording continues. Barge-in during speech is not supported. Browser permission,
foreground capture, audio playback restrictions, noise, and network conditions
still matter. Physical iPhone/Android behavior and day-long use need validation.

Intent classification does not establish who spoke. Without speaker recognition
or a wake phrase, it cannot reliably distinguish every bystander request from an
owner request. Ambiguous or quoted speech should be ignored or clarified, and
Notch's existing permissions remain in force. Neither model agreement nor a saved
full video guarantees that an answer is correct. The measured answer latencies
above are not human-speed conversation.
