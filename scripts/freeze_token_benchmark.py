#!/usr/bin/env python3
"""Freeze source hashes and pre-run criteria; never overwrite an existing manifest.

Public clip bytes stay in ignored data/. New object labels are explicitly agent
annotations, not human ground truth. The shape video is a deterministic synthetic
stress case, not a recording of a person's day. No model is called by this script.
"""

import argparse
import hashlib
import json
import time
from pathlib import Path

import av
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def synthetic_video(path):
    """A 40-second mostly static image; a small square appears and moves."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise FileExistsError(path)
    with av.open(str(path), "w") as container:
        stream = container.add_stream("libx264", rate=1)
        stream.width, stream.height, stream.pix_fmt = 640, 480, "yuv420p"
        stream.options = {"crf": "0", "preset": "veryfast"}
        for second in range(40):
            image = Image.new("RGB", (640, 480), "#dddddd")
            draw = ImageDraw.Draw(image)
            draw.rectangle((25, 260, 615, 460), fill="#b5916a")
            draw.ellipse((110, 300, 175, 365), fill="#235cdc")
            if 10 <= second < 30:
                x = 300 if second < 20 else 410
                draw.rectangle((x, 310, x + 31, 341), fill="#ed1515")
            frame = av.VideoFrame.from_image(image)
            frame.pts = second
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def real_clip(identifier, path, plan_path, keyframes, excluded=()):
    plan = json.loads(plan_path.read_text())
    with av.open(str(path)) as container:
        duration = container.duration / av.time_base
    questions = []
    for i, question in enumerate(plan["questions"]):
        if i in excluded:
            continue
        questions.append(
            {
                "id": f"{identifier}-q{i + 1}",
                **question,
                "unanswerable": i >= len(plan["questions"]) - 2,
            }
        )
    return {
        "id": identifier,
        "cohort": "short_real_video",
        "path": str(path.relative_to(ROOT)),
        "sha256": digest(path),
        "duration_seconds": duration,
        "fps": 1,
        "source_url": plan["source_url"],
        "criteria_origin": {
            "path": str(plan_path.relative_to(ROOT)),
            "sha256": digest(plan_path),
            "note": "Existing prewritten source-review criteria; human authorship not independently verified.",
        },
        "questions": questions,
        "excluded_original_question_indices_zero_based": list(excluded),
        "keyframe_annotation": "Agent visual annotation before token benchmark; not independent human labels.",
        "keyframes": [{"offset_seconds": offset, "objects": objects} for offset, objects in keyframes],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--synthetic", type=Path, default=ROOT / "data/token-benchmark/small-object.mp4")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Manifest already exists; frozen criteria are never overwritten")
    synthetic_video(args.synthetic.resolve())
    clips = [
        real_clip(
            "daylife",
            ROOT / "data/daylife-eval/breakfast-pov.mp4",
            ROOT / "docs/evaluations/daylife-pov-plan.json",
            [
                (0, {"glove": ["glove", "gloved"], "wrapper": ["wrapper", "paper"]}),
                (10, {"bread": ["bread", "bun", "bagel", "sandwich"], "tray": ["tray"]}),
                (18, {"bottle": ["bottle"], "shelf": ["shelf", "shelves"]}),
                (22, {"cheese": ["cheese"], "glove": ["glove", "gloved"]}),
            ],
            excluded=(4,),
        ),
        real_clip(
            "outdoor",
            ROOT / "data/open-video-eval/heldout-8s.mp4",
            ROOT / "docs/evaluations/heldout-video-plan.json",
            [
                (
                    0,
                    {
                        "tripod": ["tripod"],
                        "van": ["van"],
                        "person": ["person", "people", "pedestrian", "man", "men"],
                    },
                ),
                (
                    6,
                    {
                        "tripod": ["tripod"],
                        "van": ["van"],
                        "person": ["person", "people", "pedestrian", "man", "men"],
                    },
                ),
            ],
        ),
    ]
    clips[0]["erratum"] = "docs/evaluations/daylife-pov-erratum.json; invalidated tongs criterion excluded."
    clips.append(
        {
            "id": "small-object",
            "cohort": "synthetic_localized_change",
            "path": str(args.synthetic.resolve().relative_to(ROOT)),
            "sha256": digest(args.synthetic.resolve()),
            "duration_seconds": 40,
            "fps": 1,
            "construction": "640x480 fixed gray background, brown rectangle, blue circle. A 32x32 red square appears at t=10, moves right at t=20, disappears at t=30. Not a real quiet room.",
            "keyframe_annotation": "Deterministic generator specification, not human labels.",
            "keyframes": [
                {
                    "offset_seconds": second,
                    "objects": {
                        "blue circle": ["blue circle", "blue circular", "blue disk", "blue disc"],
                        **(
                            {"red square": ["red square", "red rectangular", "red rectangle"]}
                            if 10 <= second < 30
                            else {}
                        ),
                    },
                }
                for second in [0, 9, 10, 19, 20, 29, 30, 39]
            ],
            "questions": [
                {
                    "id": "small-object-q1",
                    "question": "What color was the small square that appeared?",
                    "criterion": "Red, supported by an original frame between offsets 10 and 29 seconds.",
                    "unanswerable": False,
                },
                {
                    "id": "small-object-q2",
                    "question": "Which direction did the small red square move?",
                    "criterion": "To the right; supports ordering with frames from 10–19 and 20–29 seconds.",
                    "unanswerable": False,
                },
                {
                    "id": "small-object-q3",
                    "question": "Was the red square visible at the end of the recording?",
                    "criterion": "No, the final sampled frames from 30–39 seconds lack it. Do not generalize beyond the recording.",
                    "unanswerable": False,
                },
                {
                    "id": "small-object-q4",
                    "question": "Who owns the blue circle?",
                    "criterion": "Ownership cannot be established from the recording.",
                    "unanswerable": True,
                },
            ],
        }
    )
    manifest = {
        "schema_version": 1,
        "frozen_at_unix": time.time(),
        "purpose": "Paired pre-run token-savings benchmark; same originals and questions, new database for every variant.",
        "limitations": [
            "No 20–30 minute quiet or 10-minute busy real recording is available. Do not extrapolate observed savings to a day.",
            "Public source questions have been used for prior model debugging; they are fixed but not newly held out.",
            "Object recall is a frozen synonym-string proxy, separately reported from factual question grading.",
            "Do not call model self-confidence, citation resolution, or review agreement ground-truth accuracy.",
        ],
        "clips": clips,
        "primary_real_questions": 11,
        "synthetic_questions": 4,
        "grading": {
            "question_pass": None,
            "citation_relevance": None,
            "author": None,
            "requirement": "Explicit post-run source review against frozen criteria; leave unknowns null. Label agent grading as agent grading.",
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as stream:
        json.dump(manifest, stream, indent=2)
        stream.write("\n")
    print(
        json.dumps(
            {
                "manifest": str(args.output),
                "sha256": digest(args.output),
                "clips": len(clips),
                "questions": 15,
            }
        )
    )


if __name__ == "__main__":
    main()
