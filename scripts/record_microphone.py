#!/usr/bin/env python3
"""Continuous computer/USB microphone capture with an on-disk upload queue.
Linux example: python scripts/record_microphone.py --input-format alsa --input default
macOS example: python scripts/record_microphone.py --input-format avfoundation --input :0
Use a microphone with informed participants. Ctrl-C stops capture and preserves unuploaded chunks.
"""

import argparse
import csv
import json
import signal
import subprocess
import time
import uuid
from pathlib import Path

import httpx
from dotenv import dotenv_values


def flush(spool, client, server, token):
    for session in sorted(spool.glob("*/session.json")):
        meta = json.loads(session.read_text())
        listing = session.parent / "segments.csv"
        if not listing.exists():
            continue
        for row in csv.reader(listing.read_text().splitlines()):
            if len(row) < 3:
                continue
            name = Path(row[0]).name
            path = session.parent / name
            if not path.exists():
                continue
            seq = int(path.stem)
            try:
                r = client.post(
                    server + "/api/ingest/audio",
                    content=path.read_bytes(),
                    headers={
                        "Authorization": "Bearer " + token,
                        "Content-Type": "audio/wav",
                        "X-Boot-ID": meta["boot"],
                        "X-Sequence": str(seq),
                        "X-Captured-At": str(meta["started_at"] + float(row[1])),
                    },
                )
                if r.status_code in (200, 201):
                    path.unlink()
                else:
                    print(f"Upload pending: HTTP {r.status_code}")
                    return
            except httpx.TransportError:
                return


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input-format", required=True)
    p.add_argument("--input", required=True)
    p.add_argument("--server", default="http://localhost:8000")
    p.add_argument("--spool", type=Path, default=Path("data/microphone-spool"))
    args = p.parse_args()
    env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
    token = env.get("REWIND_ADMIN_TOKEN")
    if not token:
        raise SystemExit("Run setup.py and configure the server key first.")
    boot = uuid.uuid4().hex
    folder = (args.spool / boot).resolve()
    folder.mkdir(parents=True)
    (folder / "session.json").write_text(json.dumps({"boot": boot, "started_at": time.time()}))
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        args.input_format,
        "-i",
        args.input,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-f",
        "segment",
        "-segment_time",
        "8",
        "-segment_list",
        str(folder / "segments.csv"),
        "-segment_list_type",
        "csv",
        str(folder / "%09d.wav"),
    ]
    process = subprocess.Popen(cmd, stdin=subprocess.DEVNULL)
    print("Microphone recording is ON. Eight-second chunks are buffered locally. Ctrl-C to stop.")
    with httpx.Client(timeout=30) as client:
        try:
            while process.poll() is None:
                flush(args.spool, client, args.server, token)
                time.sleep(1)
        except KeyboardInterrupt:
            process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=5)
        finally:
            flush(args.spool, client, args.server, token)
    print("Capture stopped. Pending recordings remain in", args.spool)


if __name__ == "__main__":
    main()
