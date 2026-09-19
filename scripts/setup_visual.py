#!/usr/bin/env python3
"""Cache and smoke-test the pinned local image retrieval model. No API key needed."""

import argparse
import json
import time

from rewind.visual import OpenClipEncoder

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--device", choices=["cpu", "mps", "cuda"], default="cpu")
parser.add_argument("--offline", action="store_true", help="Verify cached weights without downloading")
args = parser.parse_args()
encoder = OpenClipEncoder(args.device)
started = time.monotonic()
encoder.load(download=not args.offline)
vector = encoder.encode(text="a camera recording")
print(
    json.dumps(
        {
            "model": encoder.model_key,
            "dimensions": len(vector),
            "device": args.device,
            "seconds": round(time.monotonic() - started, 3),
        }
    )
)
