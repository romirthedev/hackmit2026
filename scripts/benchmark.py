#!/usr/bin/env python3
"""Measure actual vision latency on real JPEGs before choosing a capture rate."""

import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path

from rewind.config import Settings
from rewind.providers import Provider


async def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", type=Path, nargs="+")
    parser.add_argument("--repeat", type=int, default=2)
    args = parser.parse_args()
    p = Provider(Settings())
    times = []
    try:
        for _ in range(args.repeat):
            for path in args.images:
                start = time.monotonic()
                o = await p.observe(path)
                elapsed = time.monotonic() - start
                times.append(elapsed)
                print(json.dumps({"file": path.name, "seconds": round(elapsed, 2), "summary": o.summary}))
        mean = statistics.mean(times)
        print(
            json.dumps(
                {
                    "mean_seconds_per_frame": mean,
                    "serial_fps": 1 / mean,
                    "suggested_capture_interval_ms": int(mean * 1500),
                    "note": "Allows 50% headroom; transcription, rules, and questions also consume compute. Measure the full pipeline.",
                }
            )
        )
    finally:
        await p.close()


if __name__ == "__main__":
    asyncio.run(run())
