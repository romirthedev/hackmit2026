#!/usr/bin/env python3
"""Run real local video ingestion and recall in a NEW isolated workspace.

Requires cached Ollama/Whisper/OpenCLIP weights and .[audio,video,vision].
No mocks, external inference service, manual transcript correction or auto truth grading.
The API child exits on completion/failure; originals and results remain in --output.
"""

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import secrets
import socket
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import av
import httpx

ROOT = Path(__file__).resolve().parents[1]


def code_identity():
    """Preserve provenance for an uploaded source tree without a .git directory."""
    try:
        revision = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        ).strip()
        dirty = bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).strip())
    except (subprocess.CalledProcessError, FileNotFoundError):
        revision, dirty = None, None
    files = sorted([*ROOT.glob("server/rewind/*.py"), *ROOT.glob("scripts/*.py"), ROOT / "pyproject.toml"])
    return {
        "git_revision": revision,
        "dirty_code": dirty,
        "source_hashes": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("plan", type=Path, help="Prewritten JSON questions and manual acceptance criteria")
    parser.add_argument(
        "--output", type=Path, required=True, help="New output directory, preferably under ignored data/"
    )
    parser.add_argument("--model", required=True, help="Installed Ollama model for BOTH frames and recall")
    parser.add_argument("--api", choices=["ollama", "llamacpp"], default="ollama")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434")
    parser.add_argument("--embedding-url", help="Optional separate Ollama service for text embeddings")
    parser.add_argument("--workers", type=int, default=1, choices=range(1, 9))
    parser.add_argument("--context", type=int, default=16384)
    parser.add_argument("--recall-images", type=int, default=3, choices=range(1, 17))
    parser.add_argument("--whisper-model", default="small.en")
    parser.add_argument("--fps", type=float, default=1)
    parser.add_argument("--visual-device", choices=["cpu", "mps", "cuda"], default="cpu")
    parser.add_argument("--text-only", action="store_true", help="Disable OpenCLIP for an ablation run")
    parser.add_argument("--timeout", type=float, default=3600, help="Maximum queue-drain seconds")
    args = parser.parse_args()
    if not 2048 <= args.context <= 131072:
        parser.error("context must be between 2048 and 131072")
    video, plan, output = args.video.resolve(), args.plan.resolve(), args.output.resolve()
    if output.exists():
        parser.error("--output must be a new directory; existing evaluations are never overwritten")
    plan_data = json.loads(plan.read_text())
    if not plan_data.get("questions"):
        parser.error("plan has no questions")
    with av.open(str(video)) as container:
        duration = float(container.duration or 0) / av.time_base
    if duration <= 0:
        parser.error("video container must have a known positive duration")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    output.mkdir(parents=True)
    (output / "plan.json").write_text(json.dumps(plan_data, indent=2) + "\n")
    env = dict(
        os.environ,
        REWIND_PROVIDER="ollama",
        REWIND_LOCAL_INFERENCE_API=args.api,
        REWIND_OLLAMA_URL=args.ollama_url,
        REWIND_OLLAMA_EMBEDDING_URL=args.embedding_url or args.ollama_url,
        REWIND_OLLAMA_RECALL_URL=args.ollama_url,
        REWIND_OLLAMA_RECALL_MODEL=args.model,
        REWIND_OLLAMA_RECALL_THINK="false",
        REWIND_OLLAMA_RECALL_CONTEXT=str(args.context),
        REWIND_RECALL_MAX_IMAGES=str(args.recall_images),
        REWIND_OLLAMA_CONTEXT=str(args.context),
        REWIND_OLLAMA_TIMEOUT="900",
        REWIND_ADMIN_TOKEN=secrets.token_urlsafe(32),
        REWIND_DEVICE_TOKEN=secrets.token_urlsafe(32),
        REWIND_DATA_DIR=str(output / "workspace"),
        REWIND_VISION_MODEL=args.model,
        REWIND_REASONING_MODEL=args.model,
        REWIND_WORKERS=str(args.workers),
        REWIND_OLLAMA_THINK="false",
        REWIND_VISUAL_EMBEDDINGS=str(not args.text_only).lower(),
        REWIND_EMBEDDINGS="true",
        REWIND_EMBEDDING_MODEL="nomic-embed-text",
        REWIND_VISUAL_DEVICE=args.visual_device,
        REWIND_WHISPER_MODEL=args.whisper_model,
        REWIND_WHISPER_DEVICE="cpu",
        REWIND_WHISPER_COMPUTE="int8",
        REWIND_ELASTIC_URL="",
        REWIND_TEST_LOGIN_CODE="",
    )
    url = f"http://127.0.0.1:{port}"
    recording_start = time.time() - duration - 60
    (output / "environment.json").write_text(
        json.dumps(
            {
                "python": sys.version,
                "platform": platform.platform(),
                "model": args.model,
                "api": args.api,
                "ollama_url": args.ollama_url,
                "embedding_url": args.embedding_url or args.ollama_url,
                "workers": args.workers,
                "context": args.context,
                "recall_max_images": args.recall_images,
                "fps": args.fps,
                "visual_device": args.visual_device,
                "visual_enabled": not args.text_only,
                "timeline_start": recording_start,
                "clock": "synthetic",
                "packages": {
                    name: importlib.metadata.version(name) for name in ["av", "numpy", "faster-whisper"]
                },
                **code_identity(),
            },
            indent=2,
        )
    )
    with (output / "server.log").open("w") as server_log:
        server = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "rewind.app:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--no-access-log",
            ],
            cwd=ROOT,
            env=env,
            stdout=server_log,
            stderr=subprocess.STDOUT,
        )
        try:
            with httpx.Client(
                base_url=url, headers={"Authorization": "Bearer " + env["REWIND_ADMIN_TOKEN"]}, timeout=30
            ) as client:
                for _ in range(100):
                    if server.poll() is not None:
                        raise RuntimeError("Evaluation API failed to start; see server.log")
                    try:
                        client.get("/api/health").raise_for_status()
                        break
                    except httpx.HTTPError:
                        time.sleep(0.2)
                else:
                    raise RuntimeError("Evaluation API startup timed out")
                started = time.monotonic()
                subprocess.run(
                    [
                        sys.executable,
                        str(ROOT / "scripts/import_video.py"),
                        str(video),
                        "--server",
                        url,
                        "--start",
                        str(recording_start),
                        "--synthetic-clock",
                        "--fps",
                        str(args.fps),
                        "--manifest",
                        str(output / "import.jsonl"),
                    ],
                    cwd=ROOT,
                    env=env,
                    check=True,
                )
                while True:
                    response = client.get("/api/status")
                    response.raise_for_status()
                    status = response.json()
                    if not status["pending"] and (args.text_only or not status["visual_index"]["pending"]):
                        break
                    if time.monotonic() - started > args.timeout:
                        raise TimeoutError("Inference queue did not drain; see workspace and server.log")
                    time.sleep(2)
                with sqlite3.connect(output / "workspace/rewind.sqlite3") as db:
                    db.row_factory = sqlite3.Row
                    jobs = [
                        dict(row)
                        for row in db.execute(
                            "SELECT kind,COUNT(*) count,AVG(analysis_ms) mean_ms,MIN(analysis_ms) min_ms,MAX(analysis_ms) max_ms FROM media GROUP BY kind"
                        )
                    ]
                (output / "ingest-metrics.json").write_text(
                    json.dumps(
                        {
                            "seconds": time.monotonic() - started,
                            "status": status,
                            "jobs": jobs,
                        },
                        indent=2,
                    )
                )
                print(
                    json.dumps(
                        {
                            "stage": "ingested",
                            "analyzed": status["analyzed"],
                            "failed": status["failed"],
                            "visual": status["visual_index"],
                        }
                    ),
                    flush=True,
                )
                subprocess.run(
                    [
                        sys.executable,
                        str(ROOT / "scripts/evaluate_recall.py"),
                        str(plan),
                        "--server",
                        url,
                        "--output",
                        str(output / "answers.json"),
                    ],
                    cwd=ROOT,
                    env=env,
                    check=True,
                )
                print(
                    f"Review raw answers and original evidence in {output}; truth is not automatically graded."
                )
        finally:
            server.terminate()
            try:
                server.wait(timeout=15)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


if __name__ == "__main__":
    main()
