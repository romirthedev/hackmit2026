#!/usr/bin/env python3
"""Measure real labeling throughput and a simultaneous question against Ollama.

Uses the original JPEGs/manifest from evaluate_vision.py. No automatic accuracy
score. The inference server's OLLAMA_NUM_PARALLEL must be configured separately.
Run on an otherwise idle model server; retain failed/truncated outputs.
"""

import argparse
import asyncio
import base64
import hashlib
import json
import statistics
import time
from pathlib import Path

import httpx
from rewind.inference import chat_request, chat_result
from rewind.models import Observation, RecallAnswer
from rewind.providers import OBSERVE


async def run(args):
    manifest = json.loads(args.manifest.read_text())
    frames = manifest["frames"]
    if len(frames) < 8:
        raise ValueError("At least eight frames are required")
    chosen = [frames[round(i * (len(frames) - 1) / 7)] for i in range(8)]
    encoded = {}
    for frame in chosen + [frames[len(frames) // 2]]:
        label = frame["id"]
        data = (args.manifest.parent / f"{label}.jpg").read_bytes()
        if hashlib.sha256(data).hexdigest() != frame["sha256"]:
            raise ValueError("Frame differs from input manifest")
        encoded[label] = base64.b64encode(data).decode()
    report = {
        "model": args.model,
        "api": args.api,
        "observation_prompt": OBSERVE,
        "source_sha256": manifest["source_sha256"],
        "frames": chosen,
        "context": 8192,
        "think": False,
        "started_at": time.time(),
        "runs": [],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)

    def save():
        tmp = args.output.with_suffix(".tmp")
        tmp.write_text(json.dumps(report, indent=2) + "\n")
        tmp.replace(args.output)

    async with httpx.AsyncClient(base_url=args.ollama_url.rstrip("/"), timeout=600) as client:
        report["runtime"] = (await client.get("/props" if args.api == "llamacpp" else "/api/version")).json()
        if args.api == "llamacpp":
            report["slots"] = (await client.get("/slots")).json()

        async def request(frame, question=False):
            schema = RecallAnswer if question else Observation
            system = (
                "Answer only from this image, labeled E1. If uncertain, say so. Return the requested JSON."
                if question
                else OBSERVE
            )
            content = args.question if question else "Analyze this recorded frame."
            start = time.monotonic()
            path, payload = chat_request(
                args.api,
                args.model,
                [
                    {"role": "system", "content": system},
                    {"role": "user", "content": content, "images": [encoded[frame["id"]]]},
                ],
                schema.model_json_schema(),
                context=8192,
                max_tokens=2048,
            )
            response = await client.post(path, json=payload)
            response.raise_for_status()
            raw = response.json()
            output, complete = chat_result(args.api, raw)
            result = {
                "frame": frame["id"],
                "seconds": round(time.monotonic() - start, 3),
                "raw": raw,
                "complete": complete,
            }
            try:
                result["parsed"] = schema.model_validate_json(output).model_dump()
                result["schema_valid"] = True
                if question:
                    ids = set(result["parsed"]["evidence_ids"])
                    result["citations_valid"] = ids <= {"E1"} and bool(ids)
            except (KeyError, ValueError):
                result["schema_valid"] = False
            return result

        # Warm-up is recorded separately, not hidden in the first measured batch.
        report["warmup"] = await request(chosen[0])
        save()
        for concurrency in args.concurrency:
            semaphore = asyncio.Semaphore(concurrency)
            started = time.monotonic()

            async def label(frame):
                async with semaphore:
                    result = await request(frame)
                    result["completed_after_seconds"] = round(time.monotonic() - started, 3)
                    return result

            tasks = [asyncio.create_task(label(frame)) for frame in chosen]
            # Submit after the labeling burst has entered the inference queue.
            await asyncio.sleep(0.5)
            question_task = asyncio.create_task(request(frames[len(frames) // 2], question=True))
            try:
                labels = await asyncio.gather(*tasks)
                label_seconds = time.monotonic() - started
                question = await question_task
            except BaseException:
                for task in tasks + [question_task]:
                    task.cancel()
                await asyncio.gather(*tasks, question_task, return_exceptions=True)
                raise
            measurement = {
                "concurrency": concurrency,
                "label_seconds": round(label_seconds, 3),
                "frames_per_minute": round(60 * len(labels) / label_seconds, 2),
                "mean_request_seconds": round(statistics.mean(r["seconds"] for r in labels), 3),
                "question_seconds": question["seconds"],
                "question_usable_format": bool(
                    question["schema_valid"] and question["complete"] and question.get("citations_valid")
                ),
                "valid_complete_labels": sum(r["schema_valid"] and r["complete"] for r in labels),
                "labels": labels,
                "question": question,
                "models": (await client.get("/v1/models" if args.api == "llamacpp" else "/api/ps")).json(),
            }
            report["runs"].append(measurement)
            save()
            print(
                json.dumps(
                    {k: v for k, v in measurement.items() if k not in ("labels", "question", "models")}
                ),
                flush=True,
            )
    report["finished_at"] = time.time()
    save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--model", required=True)
    parser.add_argument("--api", choices=["ollama", "llamacpp"], default="ollama")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434")
    parser.add_argument("--concurrency", type=int, nargs="+", default=[1, 2, 4, 7, 8])
    parser.add_argument("--question", default="What color is the squeeze bottle's cap?")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output exists; choose a new filename")
    if not args.concurrency or any(not 1 <= n <= 8 for n in args.concurrency):
        parser.error("Concurrency levels must be between 1 and 8")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
