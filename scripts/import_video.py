#!/usr/bin/env python3
"""Import timestamped video samples and complete audio via PyAV and the real API.

Default: 1 fps (first decoded frame on/after each interval). --fps 0 keeps every
frame. Supply the recording start, or explicitly mark a synthetic timeline.
Reruns with identical bytes/settings/start resume idempotently.
"""

import argparse
import hashlib
import itertools
import json
import math
import os
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values
from rewind.video import audio_samples, video_samples


def send(client, url, headers, data):
    for attempt in range(8):
        try:
            response = client.post(url, headers=headers, content=data)
            if response.status_code in (200, 201):
                return response.json()
            if response.status_code < 500 and response.status_code != 429:
                response.raise_for_status()
        except httpx.TransportError:
            pass
        time.sleep(min(30, 2**attempt))
    raise RuntimeError("Upload failed; rerun with the same start/settings to resume.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--server", default="http://localhost:8000")
    parser.add_argument("--start", type=float, required=True, help="Recording start in Unix seconds")
    parser.add_argument(
        "--synthetic-clock", action="store_true", help="Start is an import timeline, not known capture time"
    )
    parser.add_argument("--fps", type=float, default=1, help="Sampling rate; 0 uploads every decoded frame")
    parser.add_argument("--clip-seconds", type=int, default=30, choices=range(1, 61), metavar="1..60")
    parser.add_argument(
        "--manifest", type=Path, help="JSONL audit manifest (overwritten on each resumable run)"
    )
    args = parser.parse_args()
    if not math.isfinite(args.fps) or not 0 <= args.fps <= 120:
        parser.error("fps must be between 0 and 120")
    if not math.isfinite(args.start) or not 0 < args.start <= time.time():
        parser.error("start must be a positive Unix timestamp in the past")
    env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
    token = os.environ.get("REWIND_ADMIN_TOKEN") or env.get("REWIND_ADMIN_TOKEN")
    if not token:
        parser.error("REWIND_ADMIN_TOKEN is missing")
    with args.video.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    config = {
        "version": 2,
        "sha256": digest,
        "fps": args.fps,
        "clip_seconds": args.clip_seconds,
        "start": args.start,
        "clock": "synthetic" if args.synthetic_clock else "recording_start",
    }
    boot = "video2-" + hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:40]
    manifest = args.manifest or Path("data/imports") / (boot + ".jsonl")
    manifest.parent.mkdir(parents=True, exist_ok=True)
    counts = {"frame": 0, "audio": 0}
    with manifest.open("w") as audit, httpx.Client(timeout=60) as client:
        audit.write(json.dumps({"import": config, "boot": boot}) + "\n")
        for sample in itertools.chain(
            video_samples(args.video, args.fps, args.clip_seconds),
            audio_samples(args.video, args.clip_seconds),
        ):
            metadata = {
                "source_sha256": digest,
                "source_offset": sample.offset,
                "source_pts": sample.pts,
                "time_base": sample.time_base,
                "frame_index": sample.frame_index,
                "clip_index": sample.clip_index,
                "sample_fps": args.fps,
                "clock": config["clock"],
            }
            receipt = send(
                client,
                args.server.rstrip("/") + "/api/ingest/" + sample.kind,
                {
                    "Authorization": "Bearer " + token,
                    "Content-Type": "image/jpeg" if sample.kind == "frame" else "audio/wav",
                    "X-Boot-ID": boot,
                    "X-Sequence": str(sample.sequence),
                    "X-Captured-At": str(args.start + sample.offset),
                    "X-Video-Provenance": json.dumps(metadata),
                },
                sample.data,
            )
            audit.write(
                json.dumps(
                    {
                        "kind": sample.kind,
                        "sequence": sample.sequence,
                        **metadata,
                        "payload_sha256": hashlib.sha256(sample.data).hexdigest(),
                        **receipt,
                    }
                )
                + "\n"
            )
            audit.flush()
            counts[sample.kind] += 1
            if sum(counts.values()) % 100 == 0:
                print(json.dumps(counts), flush=True)
    print(json.dumps({**counts, "manifest": str(manifest), "boot": boot}))
    print(
        "Uploads saved. Caption, transcription, and optional visual-index jobs continue in the durable queue."
    )


if __name__ == "__main__":
    main()
