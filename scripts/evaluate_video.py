#!/usr/bin/env python3
"""Run real local video ingestion and recall in a NEW isolated workspace.

Requires local cached weights or an explicitly configured authenticated processing service.
No mocks, manual transcript correction or automatic truth grading.
The API child exits on completion/failure; originals and results remain in --output.
"""

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import av
import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
BENCHMARK_FLAGS = {
    "usage_ledger": True,
    "change_gate": False,
    "change_gate_sim": 0.97,
    "change_gate_block": 0.06,
    "change_gate_heartbeat_s": 30,
    "recall_packet_compact": False,
    "compressor": "none",
    "compressor_aggressiveness": 0.2,
    "llmlingua_rate": 0.8,
    "dense_captions": False,
    "labeler_long_side": 0,
    "rule_gate": False,
    "rule_gate_threshold": 0.45,
    "cache_prompt": False,
}


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
    parser.add_argument(
        "--pace",
        action="store_true",
        help="Pace frame replay at source cadence; use no-audio sources for live-cadence tests",
    )
    parser.add_argument("--visual-device", choices=["cpu", "mps", "cuda"], default="cpu")
    parser.add_argument("--text-only", action="store_true", help="Disable OpenCLIP for an ablation run")
    parser.add_argument("--timeout", type=float, default=3600, help="Maximum queue-drain seconds")
    parser.add_argument("--variant", default="R0")
    parser.add_argument(
        "--processing-env", type=Path, help="Read only processing URL/token from a private dotenv file"
    )
    parser.add_argument("--verify", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument(
        "--skip-recall", action="store_true", help="Frame-only ablation, not a question-accuracy run"
    )
    parser.add_argument(
        "--reuse-ingest",
        type=Path,
        help="Completed baseline run; copy originals/captions to a fresh workspace and measure recall only",
    )
    parser.add_argument("--manifest-sha256", help="Digest of the previously frozen paired manifest")
    parser.add_argument(
        "--timeline-start", type=float, help="Explicit shared synthetic timestamp for paired runs"
    )
    for name, default in BENCHMARK_FLAGS.items():
        options = {"default": default}
        if isinstance(default, bool):
            options["action"] = argparse.BooleanOptionalAction
        else:
            options["type"] = type(default)
        if name == "compressor":
            options["choices"] = ["none", "bear2", "llmlingua"]
        parser.add_argument("--" + name.replace("_", "-"), **options)
    args = parser.parse_args()
    if not 2048 <= args.context <= 131072:
        parser.error("context must be between 2048 and 131072")
    if args.timeline_start is not None and not 0 < args.timeline_start < time.time():
        parser.error("timeline start must be a positive past Unix timestamp")
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
        REWIND_PUBLIC_URL="",
        REWIND_NOTCH_URL="",
        REWIND_NOTCH_CONTROL_URL="",
        REWIND_PROCESSING_URL="",
        REWIND_PROCESSING_TOKEN="",
        REWIND_COOKIE_SECURE="false",
        REWIND_CODEX_VERIFY=str(args.verify).lower(),
        REWIND_COMPACT_OBSERVATIONS="true",
        REWIND_OBSERVATION_MAX_TOKENS="128",
        REWIND_USAGE_VARIANT=args.variant,
        REWIND_MIN_FREE_GB="0",
    )
    if args.processing_env:
        private = dotenv_values(args.processing_env)
        for key in ("REWIND_PROCESSING_URL", "REWIND_PROCESSING_TOKEN"):
            env[key] = private.get(key) or ""
        if not all(env[key] for key in ("REWIND_PROCESSING_URL", "REWIND_PROCESSING_TOKEN")):
            parser.error("processing env needs an authenticated REWIND_PROCESSING_URL and TOKEN")
    flags = {name: getattr(args, name) for name in BENCHMARK_FLAGS}
    for name, value in flags.items():
        env["REWIND_" + name.upper()] = str(value).lower() if isinstance(value, bool) else str(value)
    url = f"http://127.0.0.1:{port}"
    recording_start = args.timeline_start or time.time() - duration - 60
    if args.reuse_ingest:
        baseline = args.reuse_ingest.resolve()
        old_environment = json.loads((baseline / "environment.json").read_text())
        if old_environment["source_sha256"] != hashlib.sha256(video.read_bytes()).hexdigest():
            parser.error("Reused captions must belong to the exact same source bytes")
        recording_start = old_environment["timeline_start"]
        previous = baseline / "workspace"
        target = output / "workspace"
        shutil.copytree(
            previous, target, ignore=shutil.ignore_patterns("*.sqlite3", "*.sqlite3-wal", "*.sqlite3-shm")
        )
        with (
            sqlite3.connect(f"file:{previous / 'rewind.sqlite3'}?mode=ro", uri=True) as source_db,
            sqlite3.connect(target / "rewind.sqlite3") as target_db,
        ):
            source_db.backup(target_db)
            tables = {r[0] for r in target_db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for table in ("answer_reviews", "answers", "usage", "usage_events"):
                if table in tables:
                    target_db.execute("DELETE FROM " + table)
            for media_id, media_path in target_db.execute("SELECT id,path FROM media").fetchall():
                relative = Path(media_path).relative_to(previous)
                target_db.execute("UPDATE media SET path=? WHERE id=?", (str(target / relative), media_id))
        shutil.copy2(baseline / "import.jsonl", output / "import.jsonl")
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
                "paced_frame_replay": args.pace,
                "visual_device": args.visual_device,
                "visual_enabled": not args.text_only,
                "timeline_start": recording_start,
                "clock": "synthetic",
                "source_sha256": hashlib.sha256(video.read_bytes()).hexdigest(),
                "source_duration_seconds": duration,
                "plan_sha256": hashlib.sha256(plan.read_bytes()).hexdigest(),
                "manifest_sha256": args.manifest_sha256,
                "variant": args.variant,
                "flags": flags,
                "codex_verify": args.verify,
                "skip_recall": args.skip_recall,
                "reuse_ingest": str(args.reuse_ingest) if args.reuse_ingest else None,
                "remote_processing": bool(env["REWIND_PROCESSING_URL"]),
                "measurement_note": (
                    "Paced offline frame replay, not live camera capture; "
                    if args.pace
                    else "Offline bulk import, not sustained live capture; "
                )
                + "inference_seconds is summed call latency, not measured GPU utilization.",
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
                if not args.reuse_ingest:
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
                            *(["--pace"] if args.pace else []),
                        ],
                        cwd=ROOT,
                        env=env,
                        check=True,
                    )
                upload_finished = time.monotonic()
                pending_after_upload = None
                while True:
                    response = client.get("/api/status")
                    response.raise_for_status()
                    status = response.json()
                    if pending_after_upload is None:
                        pending_after_upload = status["pending"]
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
                    # Original evidence remains local; no blob/vector payloads in this report.
                    event_columns = [
                        r[1] for r in db.execute("PRAGMA table_info(events)") if r[1] != "embedding"
                    ]
                    observations = [
                        dict(row)
                        for row in db.execute(
                            "SELECT " + ",".join(event_columns) + " FROM events ORDER BY captured_at"
                        )
                    ]
                    (output / "observations.json").write_text(json.dumps(observations, indent=2) + "\n")
                    delays = [
                        r[0]
                        for r in db.execute(
                            "SELECT e.created_at-m.received_at FROM events e JOIN media m ON m.id=e.id ORDER BY e.created_at-m.received_at"
                        )
                    ]
                (output / "ingest-metrics.json").write_text(
                    json.dumps(
                        {
                            "seconds": time.monotonic() - started,
                            "upload_seconds": None if args.reuse_ingest else upload_finished - started,
                            "post_upload_drain_seconds": None
                            if args.reuse_ingest
                            else time.monotonic() - upload_finished,
                            "pending_at_first_post_upload_poll": None
                            if args.reuse_ingest
                            else pending_after_upload,
                            "peak_pending_during_upload": None,
                            "queue_sampling_note": "Queue status first polled after upload finishes; peak backlog during upload was not sampled.",
                            "status": status,
                            "jobs": jobs,
                            "frames_per_minute": sum(j["count"] for j in jobs if j["kind"] == "frame")
                            * 60
                            / (time.monotonic() - started),
                            "upload_to_event_seconds": delays,
                            "capture_to_result_seconds": None,
                            "capture_latency_note": "Synthetic historical clock; upload-to-event delay is not live capture latency.",
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
                if not args.skip_recall:
                    subprocess.run(
                        [
                            sys.executable,
                            str(ROOT / "scripts/evaluate_recall.py"),
                            str(plan),
                            "--server",
                            url,
                            "--output",
                            str(output / "answers.json"),
                            *(["--wait-review"] if args.verify else []),
                        ],
                        cwd=ROOT,
                        env=env,
                        check=True,
                    )
                summary = client.get("/api/usage/summary")
                summary.raise_for_status()
                (output / "usage-summary.json").write_text(json.dumps(summary.json(), indent=2) + "\n")
                with sqlite3.connect(output / "workspace/rewind.sqlite3") as db:
                    db.row_factory = sqlite3.Row
                    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    for table in ("usage", "gate_decisions"):
                        if table in tables:
                            rows = [dict(row) for row in db.execute("SELECT * FROM " + table)]
                            (output / (table + ".json")).write_text(json.dumps(rows, indent=2) + "\n")
                complete = {
                    "pipeline_completed": not status["failed"] and not status["visual_index"]["failed"],
                    "failed_media": status["failed"],
                    "failed_visual_index": status["visual_index"]["failed"],
                    "quality_graded": False,
                }
                (output / "completion.json").write_text(json.dumps(complete, indent=2) + "\n")
                if not complete["pipeline_completed"]:
                    raise RuntimeError(
                        "Processing failures retained in the run artifacts; this is not a complete baseline"
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
