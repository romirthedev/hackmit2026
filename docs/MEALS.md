# Meals: eating detection from 1 FPS frames

Experimental. Lives in `server/rewind/meals.py`, hooked into the worker right
after a frame's caption is stored.

## The rule

1. Every frame gets one row in `food_sightings`. If the caption (summary,
   tags, objects) has no food word in it, the row says "no food" and nothing
   else happens. No model call.
2. If the caption mentions food, the vision model is asked one small
   structured question about that frame: `food_visible`, `food` (one to three
   words), `at_mouth`. `at_mouth` is defined as food at or in a mouth, being
   bitten, or, for a chest-worn camera, held up large and close to the lens.
3. A frame with `at_mouth` opens a meal (or extends the open one). Frames with
   food merely in view keep the meal open. Food on a table never starts one.
4. The meal is concluded as "eaten" when the next `REWIND_MEAL_CONFIRM_FRAMES`
   (default 2) frames after the last food sighting show no food, and no frame
   in between is still waiting to be labelled. Workers finish frames out of
   order, so the tracker waits for the gaps.
5. If the recording stops right after the last bite, the meal settles after
   `REWIND_MEAL_SETTLE_SECONDS` (default 90) of wall-clock quiet.
6. Food reappearing within `REWIND_MEAL_GAP_SECONDS` (default 120) of a
   concluded meal with a matching name reopens it, so two empty frames in the
   middle of a sandwich do not produce two sandwiches. Food showing up later
   than that is a new meal.

The change gate's inherited captions reuse the parent frame's sighting: an
unchanged picture has the food where it was.

## What gets remembered

`meals` rows: food, status (`open`/`eaten`), started_at, last_seen_at,
gone_at, reason (`food_gone`, `settled`, `no_later_frames`, `gap`), the list of
bite photo IDs, and every label the model gave (the most common one wins).

Recall (`/api/ask`) adds matching meals to the evidence packet as a `meal`
source next to Notch and scanned mail, and puts the last bite photo first so
it is among the attached originals. Questions such as "what did I eat today",
"did I have lunch" or "have I eaten" are routed to memory, never to general
chat. Day recaps include meals inside the day's bounds.

## Endpoints

- `GET /api/meals?limit=20` (settles open meals first)
- `GET /api/meals/sightings?limit=50` (per-frame decisions, for debugging)
- `DELETE /api/meals/{id}`

The dashboard shows a Meals card in both views. Clearing memory clears meals.

## Settings

```
REWIND_MEAL_TRACKING=true
REWIND_MEAL_CONFIRM_FRAMES=2
REWIND_MEAL_GAP_SECONDS=120
REWIND_MEAL_SETTLE_SECONDS=90
```

## Testing on the machine

Wear the phone, hold a banana or cookie up to your mouth for two or three
seconds, then put it out of view. Watch `GET /api/meals/sightings` to see the
per-frame decisions come in, then `GET /api/meals` once the frames after the
bite are labelled. Ask "What did I eat?".

If the model never says `at_mouth`, look at the sightings first: `source`
tells you whether the caption prefilter (`caption`) or the model (`model`)
made the call. A `caption` row with food in the picture means the caption did
not name the food; a `model` row with `at_mouth=0` means the food question
answered no.

`server/tests/test_meals.py` runs the whole flow against a scripted vision
model.
