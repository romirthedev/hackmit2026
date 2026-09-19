#!/usr/bin/env python3
"""Import every decoded video frame and 30-second audio chunks. Requires ffmpeg + ffprobe.
Resume uses the file digest as the boot ID, so server ingestion is idempotent.
"""

import argparse
import hashlib
import json
import subprocess
import tempfile
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values


def send(client, url, headers, data):
    for attempt in range(8):
        try:
            r = client.post(url, headers=headers, content=data)
            if r.status_code in (200, 201):
                return
            if r.status_code < 500 and r.status_code != 429:
                r.raise_for_status()
        except httpx.TransportError:
            pass
        time.sleep(min(30, 2**attempt))
    raise RuntimeError("Upload failed; rerun to resume without duplicating received frames.")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("video", type=Path)
    p.add_argument("--server", default="http://localhost:8000")
    p.add_argument("--start", type=float, required=True, help="Actual recording start in Unix seconds")
    args = p.parse_args()
    env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
    token = env["REWIND_ADMIN_TOKEN"]
    digest = hashlib.sha256()
    with args.video.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            digest.update(chunk)
    boot = "video-" + digest.hexdigest()[:40]
    probe = json.loads(
        subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_frames",
                "-select_streams",
                "v:0",
                "-show_entries",
                "frame=best_effort_timestamp_time",
                "-of",
                "json",
                str(args.video),
            ]
        )
    )
    timestamps = [float(x["best_effort_timestamp_time"]) for x in probe["frames"]]
    if not timestamps:
        raise SystemExit("No video frames found.")
    with tempfile.TemporaryDirectory(prefix="rewind-video-") as td, httpx.Client(timeout=60) as client:
        directory = Path(td)
        # Bounded 20-hour prototype importer uses temporary disk, not unbounded RAM tensors.
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-i",
                str(args.video),
                "-map",
                "0:v:0",
                "-fps_mode",
                "passthrough",
                "-q:v",
                "2",
                str(directory / "%09d.jpg"),
            ],
            check=True,
        )
        for i, path in enumerate(sorted(directory.glob("*.jpg"))):
            at = args.start + timestamps[i] - timestamps[0]
            send(
                client,
                args.server + "/api/ingest/frame",
                {
                    "Authorization": "Bearer " + token,
                    "Content-Type": "image/jpeg",
                    "X-Boot-ID": boot,
                    "X-Sequence": str(i),
                    "X-Captured-At": str(at),
                },
                path.read_bytes(),
            )
            path.unlink()
            if i % 100 == 0:
                print(f"Imported {i + 1}/{len(timestamps)} frames")
        streams = json.loads(
            subprocess.check_output(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-select_streams",
                    "a",
                    "-show_entries",
                    "stream=index",
                    "-of",
                    "json",
                    str(args.video),
                ]
            )
        )
        if streams["streams"]:
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-i",
                    str(args.video),
                    "-map",
                    "0:a:0",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-c:a",
                    "pcm_s16le",
                    "-f",
                    "segment",
                    "-segment_time",
                    "30",
                    str(directory / "audio-%06d.wav"),
                ],
                check=True,
            )
            for i, path in enumerate(sorted(directory.glob("audio-*.wav"))):
                send(
                    client,
                    args.server + "/api/ingest/audio",
                    {
                        "Authorization": "Bearer " + token,
                        "Content-Type": "audio/wav",
                        "X-Boot-ID": boot,
                        "X-Sequence": str(i),
                        "X-Captured-At": str(args.start + i * 30),
                    },
                    path.read_bytes(),
                )
                path.unlink()
    print("All decoded frames and audio uploaded. Analysis continues in the durable queue.")


if __name__ == "__main__":
    main()
