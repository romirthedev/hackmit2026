#!/usr/bin/env python3
"""Validate a private walkthrough manifest, optionally install it and warm its voice.

Original recordings and reviewed personal facts stay outside Git. This command
does not alter the source media, clear memory, or change the running service.
"""

import argparse
import asyncio
import json
import os
import shutil
import tempfile
import time
from pathlib import Path

from rewind.config import Settings
from rewind.db import Database
from rewind.demo import DemoMemory
from rewind.voice import Voice


async def prepare(args):
    settings = Settings(_env_file=args.env_file, demo_mode=True)
    if args.data_dir:
        settings.data_dir = args.data_dir.resolve()
    db = Database(settings.data_dir)
    demo = DemoMemory(db, settings)
    destination = demo.path
    # Validate the candidate before replacing the installed manifest.
    demo.path = args.manifest.resolve()
    manifest = demo.manifest()
    protected = demo.protection()
    report = {
        "prepared_at": time.time(),
        "entries": len(manifest.entries),
        "protected_media": len(protected["media"]),
        "protected_recordings": len(protected["recordings"]),
        "installed": False,
        "voice": [],
    }
    if args.install and demo.path != destination.resolve():
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            backup = destination.parent / "manifest-backups"
            backup.mkdir(exist_ok=True)
            shutil.copy2(destination, backup / f"{time.time_ns()}.json")
        descriptor, temporary = tempfile.mkstemp(dir=destination.parent, prefix=".manifest-")
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(demo.path.read_bytes())
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, destination)
        finally:
            Path(temporary).unlink(missing_ok=True)
        report["installed"] = True
    if args.warm_voice:
        voice = Voice(settings, None, None)
        try:
            if not voice.enabled:
                raise ValueError("Voice is not configured; manifest validation succeeded.")
            for line in demo.speech_lines(manifest):
                cached = voice._cache_path(line).is_file()
                start = time.perf_counter()
                path = await voice.synthesize(line)
                first_ms = round((time.perf_counter() - start) * 1000, 2)
                start = time.perf_counter()
                await voice.synthesize(line)
                cached_ms = round((time.perf_counter() - start) * 1000, 2)
                report["voice"].append({
                    "text": line, "already_cached": cached,
                    "prepare_ms": first_ms, "cached_ms": cached_ms,
                    "bytes": path.stat().st_size,
                })
        finally:
            await voice.close()
    target = args.report or settings.data_dir / "demo" / "preparation.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "voice"}))
    print(f"Prepared {len(report['voice'])} voice replies. Private report: {target}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--warm-voice", action="store_true")
    parser.add_argument("--report", type=Path)
    asyncio.run(prepare(parser.parse_args()))


if __name__ == "__main__":
    main()
