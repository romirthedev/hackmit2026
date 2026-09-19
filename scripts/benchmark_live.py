#!/usr/bin/env python3
"""Replay retained original frames at capture cadence; measure delay and questions.

Runs in a separate directory, never imports into the personal workspace. A format
pass is not an accuracy score. Inspect saved raw answers against the originals.
"""

import argparse
import asyncio
import hashlib
import json
import math
import time
from pathlib import Path

from rewind.config import Settings
from rewind.models import RecallAnswer
from rewind.providers import Provider


def percentile(values, fraction):
    values = sorted(values)
    return values[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


async def run(args):
    manifest = json.loads(args.manifest.read_text())
    frames = manifest["frames"][: args.frames]
    if len(frames) < 3:
        raise ValueError("At least three retained original frames are required")
    if args.output.exists():
        raise ValueError("Output exists; retain the earlier run and choose a new path")
    s = Settings(
        _env_file=None,
        vision_model=args.model,
        reasoning_model=args.model,
        ollama_url=args.url,
        local_inference_api=args.api,
        compact_observations=True,
        embeddings=False,
        ollama_timeout=300,
        ollama_context=8192,
        ollama_recall_context=8192,
    )
    provider = Provider(s)
    report = {
        "model": args.model,
        "api": args.api,
        "input_fps": args.fps,
        "concurrency": args.concurrency,
        "source_sha256": manifest["source_sha256"],
        "started_at": time.time(),
        "frames": [],
        "questions": [],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)

    def save():
        temporary = args.output.with_suffix(".tmp")
        temporary.write_text(json.dumps(report, indent=2))
        temporary.replace(args.output)

    for frame in frames:
        path = args.manifest.parent / (frame["id"] + ".jpg")
        if hashlib.sha256(path.read_bytes()).hexdigest() != frame["sha256"]:
            raise ValueError("Original frame hash mismatch")
    # Record cold/warm model readiness separately, rather than hiding it in throughput.
    warm = time.monotonic()
    try:
        result = await provider.observe(args.manifest.parent / (frames[0]["id"] + ".jpg"))
        report["warmup"] = {"seconds": time.monotonic() - warm, "result": result.model_dump()}
    except Exception as exc:
        report["warmup"] = {"seconds": time.monotonic() - warm, "error": str(exc)}
        save()
        raise
    save()
    gate = asyncio.Semaphore(args.concurrency)
    started = time.monotonic()

    async def frame_job(index, frame):
        capture_at = started + index / args.fps
        await asyncio.sleep(max(0, capture_at - time.monotonic()))
        row = {"id": frame["id"], "sha256": frame["sha256"], "capture_after_seconds": index / args.fps}
        async with gate:
            request_at = time.monotonic()
            row["queue_seconds"] = request_at - capture_at
            try:
                result = await provider.observe(args.manifest.parent / (frame["id"] + ".jpg"))
                row["result"] = result.model_dump()
                row["complete"] = True
            except Exception as exc:
                row["error"] = str(exc)
                row["complete"] = False
            row["inference_seconds"] = time.monotonic() - request_at
            row["capture_to_result_seconds"] = time.monotonic() - capture_at
        report["frames"].append(row)
        save()

    async def question_job(index):
        await asyncio.sleep(index / args.fps + 0.25)
        frame = frames[index]
        path = args.manifest.parent / (frame["id"] + ".jpg")
        start = time.monotonic()
        row = {"frame": frame["id"], "question": args.question}
        try:
            answer = await provider.structured(
                "Answer only from the attached original image E1. If evidence is insufficient, say so. "
                "Use only E1 as evidence_ids. Return JSON.",
                args.question,
                RecallAnswer,
                images=[path],
                recall=True,
            )
            row["answer"] = answer.model_dump()
            row["valid_citations"] = set(answer.evidence_ids) == {"E1"}
        except Exception as exc:
            row["error"] = str(exc)
        row["seconds"] = time.monotonic() - start
        report["questions"].append(row)
        save()

    try:
        await asyncio.gather(
            *(frame_job(i, frame) for i, frame in enumerate(frames)),
            *(question_job(i) for i in sorted({len(frames) // 3, 2 * len(frames) // 3})),
        )
        elapsed = time.monotonic() - started
        latencies = [r["capture_to_result_seconds"] for r in report["frames"]]
        by_capture = sorted(report["frames"], key=lambda r: r["capture_after_seconds"])
        completed = sum(r["complete"] for r in report["frames"])
        report["summary"] = {
            "elapsed_seconds": elapsed,
            "attempted_frames": len(frames),
            "completed_frames": completed,
            "effective_frames_per_second": completed / elapsed,
            "capture_to_result_p50_seconds": percentile(latencies, 0.5),
            "capture_to_result_p95_seconds": percentile(latencies, 0.95),
            "last_frame_queue_seconds": by_capture[-1]["queue_seconds"],
            "question_seconds": [r["seconds"] for r in report["questions"]],
            "accuracy": "Requires original-evidence review; JSON validity is not correctness.",
        }
        print(json.dumps(report["summary"], indent=2))
        save()
    finally:
        await provider.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--model", default="qwen3.5:35b-a3b-q4_K_M")
    p.add_argument("--url", default="http://127.0.0.1:11436")
    p.add_argument("--api", choices=["ollama", "llamacpp"], default="llamacpp")
    p.add_argument("--frames", type=int, default=16)
    p.add_argument("--fps", type=float, default=1)
    p.add_argument("--concurrency", type=int, default=4)
    p.add_argument("--question", default="Is the visible food-preparation counter metallic or wooden?")
    args = p.parse_args()
    if not 1 <= args.concurrency <= 8 or not 0.1 <= args.fps <= 10 or not 3 <= args.frames <= 100:
        p.error("Invalid workload bounds")
    asyncio.run(run(args))
