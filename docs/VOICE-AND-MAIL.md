# Voice and mail

Two features added for the phone-first demo: spoken questions with spoken
answers, and scanned mail that files itself. Both are implemented and tested;
the numbers below come from a MacBook running `qwen3.5:4b` through Ollama, so
the ASUS with the 35B model should be at least as good.

## Spoken questions

Files: `server/rewind/voice.py`, `web/lib/voice.ts`, `web/app/phone/page.tsx`,
`web/components/dashboard/ask-card.tsx`.

While the phone records, the existing voice-activity detector cuts the
microphone into utterances (about 0.85 s of quiet ends one). Each utterance
goes to `POST /api/voice/hear?wake=true`:

1. Deepgram Nova-3 transcribes it (`keyterm=Rewind` biases the recognizer
   toward the wake word). Measured 0.13 to 0.26 s per clip.
2. The server checks whether the sentence starts with the wake word. Accepted
   spellings include "Rewind", "Re-wind", "Re wind", "Hey Rewind", "Okay,
   Rewind". "I told him to rewind the tape" is ignored, and so is anything
   without the word. Nothing else is sent to a model, so background talk costs
   nothing.
3. If directed, the phone plays a pre-made filler line ("Let me look through
   your day for that") and calls `POST /api/voice/ask` with the question.
4. `memory.ask` answers from recorded frames, transcripts, Notch documents and
   scanned mail. The server trims the answer to its first paragraph, drops
   citations, and synthesizes it with Deepgram Aura-2 (`aura-2-thalia-en`).
   The mp3 is cached by text hash under `data/voice/`.
5. The phone plays it. Listening is paused while audio plays so the answer is
   not heard as a new question.

The dashboard's Ask card does the same without the wake word: tap the orb (or
the microphone button), speak, pause. Typed questions are spoken back too. A
speaker toggle mutes playback on either page.

Without `REWIND_DEEPGRAM_API_KEY`, `/hear` falls back to faster-whisper on the
server and the browser's `speechSynthesis` reads answers.

### The answer prompt

`RECALL_PROMPT` in `server/rewind/memory.py` asks for one or two short,
friendly sentences in everyday words ("Your glasses were last on the kitchen
counter, next to the kettle, around 2:40"), and forbids the technical
vocabulary the old prompt produced. The source rules are unchanged: attached
images beat captions, a calendar entry does not prove attendance, quotes are
never invented, and every answer must cite `E1..En` labels that the server
validates. `today_local` is included in the packet so "due September 30"
comes out as "is due", not "was due".

Measured on the laptop model:

| Question | Answer | Time |
|---|---|---|
| When is my doctor bill due? | Your doctor's bill is due on September 30, 2026. | 8.8 s |
| What did Emma write to me? | Emma wrote on the back that she's in Portland, the kids picked apples and drew you a picture. She says they're counting down to Thanksgiving and asks if you'll save her some pie. | ~9 s |
| Where did I leave my glasses? (nothing recorded) | I couldn't find that in your day yet. Try describing it another way, or ask about a different time. | 0.3 s |

### Grammar-safe schemas

Ollama 0.32 rejected the recall and observation schemas with "failed to parse
grammar" because pydantic emits `maxLength: 8000` for long strings and
llama.cpp expands that into an enormous repetition rule. `grammar_safe()` in
`server/rewind/inference.py` strips `maxLength` from the schema sent to the
local sampler; pydantic still enforces every limit when the reply is parsed.
This fixed frame labeling and recall on the laptop and removes a way the ASUS
could fail after an Ollama upgrade.

## Scanned mail

Files: `server/rewind/scans.py`, `web/components/dashboard/mail-cards.tsx`,
`web/components/dashboard/arrivals.tsx`, `web/components/dashboard/letter.tsx`,
`web/app/print/`.

Scan mail on the phone uploads one JPEG with `X-Intent: scan`. The frame is
stored like any other moment, then `Scans.analyze` asks the vision model to
list the documents in the photo (kind, title, sender, recipient, date, due
date, amount, one-line message) with a deadline of `REWIND_SCAN_MODEL_DEADLINE_S`
(default 8 s).

The demo mail comes from `/print`, so its text is known. With
`REWIND_SCAN_DEMO_TEMPLATE=true` (the default) the printed text is treated as
ground truth: the model's reading decides which documents are present and
fills anything the template leaves blank; if the model is slow or fails, the
template is used outright. `source` on each row says `model`, `template`, or
`model+template`. Scanning the same mail again replaces the earlier copy.

On the laptop the 4B model read both documents correctly in about 20 s. With
the default 8 s deadline the animation starts from the template and the
model's reading is discarded; raise the deadline to wait for it.

`GET /api/scans` returns the documents newest first. The dashboard polls it
every 3 s. New rows queue as arrivals, oldest first, so the postcard lands
before the bill:

1. The page blurs and a cloud forms above the destination card (the page
   scrolls the card into view first).
2. An envelope drops out of the cloud with a small bounce. Postcards ride in
   a cream envelope; bills in a white one with a blue seal.
3. The flap opens and the document rises out.
4. It glides into its slot: the postcard stack, or the due-date cell on the
   calendar, which pulses and gets a red marker.
5. The card shows the real thing and the next letter starts.

Scanned documents are also recall evidence. `Scans.search` scores rows by
word overlap plus a boost for bill words ("pay", "owe", "due", "doctor") and
letter words ("postcard", "wrote", "Emma"). Matches join the packet as
`source: scan` with the document text; the reviewer treats them like Notch
documents rather than camera samples.

### Dashboard widgets

- Calendar: month grid, previous/next/today, dots per event, tap a day to
  list it, tap an event to open the scanned original. Bills from scans and
  reminders from a connected Notch calendar share the grid.
- Letters: a stack of postcards. The newest sits on top, message side up; tap
  to turn it over, arrows for older letters, a button to open the scan.
- Scanned mail (caretaker view): every document with its source, a remove
  button, and "File the printed demo mail", which inserts the two template
  documents without a phone so the arrival can be rehearsed.

### Limits

- The template is a demo aid. For real mail turn it off; the model's reading
  then stands alone and blank fields stay blank.
- Due dates become calendar entries only when they parse as `YYYY-MM-DD`.
- Deepgram is a cloud service: audio clips that start with the wake word and
  the answer text leave the machine. Frames never do.
- Wake-word detection happens after transcription, so a sentence that
  includes "rewind" mid-way is ignored and one that starts with it is treated
  as a question even in conversation.
