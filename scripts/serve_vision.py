#!/usr/bin/env python3
"""Serve existing Ollama GGUF vision weights with native llama.cpp CUDA batching.

Runs in the foreground, binds loopback, and refuses CPU fallback. Does not
modify an Ollama service or download weights. Context is specified PER SLOT.
"""

import argparse
import hashlib
import json
import os
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, help="Installed Ollama name:tag")
    parser.add_argument("--models-dir", required=True, type=Path)
    parser.add_argument("--runtime-dir", type=Path, default=Path("/usr/local/lib/ollama"))
    parser.add_argument("--slots", type=int, choices=range(1, 9), default=8)
    parser.add_argument("--context", type=int, default=8192, help="Tokens per slot")
    parser.add_argument("--port", type=int, default=11436)
    parser.add_argument(
        "--embedded-projector",
        action="store_true",
        help="Use one monolithic GGUF for both loaders (requires Ollama's compatible runtime)",
    )
    parser.add_argument("--chat-template", type=Path, help="Explicit model-author chat template")
    parser.add_argument("--min-free-gib", type=float, default=0)
    reports = parser.add_mutually_exclusive_group(required=True)
    reports.add_argument("--report", type=Path, help="New launch metadata file")
    reports.add_argument("--report-dir", type=Path, help="Create a unique launch report on every startup")
    args = parser.parse_args()
    if args.report_dir:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        args.report = args.report_dir / f"vision-{stamp}-{uuid.uuid4().hex[:8]}.json"
    if not 2048 <= args.context <= 131072 or not 1024 <= args.port <= 65535:
        parser.error("Invalid context or port")
    if args.report.exists():
        parser.error("Report exists; use a new launch report")
    name, sep, tag = args.model.partition(":")
    if not sep or not name or not tag or "/" in name + tag or ".." in name + tag:
        parser.error("Use a library model in name:tag form")
    manifest_path = args.models_dir / "manifests/registry.ollama.ai/library" / name / tag
    manifest = json.loads(manifest_path.read_text())
    layers = {
        layer["mediaType"].rsplit(".", 1)[-1]: args.models_dir / "blobs" / layer["digest"].replace(":", "-")
        for layer in manifest["layers"]
    }
    if args.embedded_projector and "projector" not in layers:
        layers["projector"] = layers.get("model")
    for key in ("model", "projector"):
        if key not in layers or layers[key] is None or not layers[key].is_file():
            parser.error(f"Missing {key} weights")
    available = (
        int(
            next(
                line.split()[1]
                for line in Path("/proc/meminfo").read_text().splitlines()
                if line.startswith("MemAvailable:")
            )
        )
        * 1024
    )
    if available < args.min_free_gib * 1024**3:
        parser.error("Insufficient free unified memory; no other workload was stopped")
    runtime = args.runtime_dir.resolve()
    binary = runtime / "llama-server"
    cuda = runtime / "cuda_v13"
    env = dict(
        os.environ, LD_LIBRARY_PATH=f"{runtime}:{cuda}", GGML_BACKEND_PATH=str(cuda / "libggml-cuda.so")
    )
    devices = subprocess.check_output(
        [str(binary), "--list-devices"], env=env, text=True, stderr=subprocess.STDOUT
    )
    if "CUDA0:" not in devices:
        raise SystemExit("CUDA0 was not discovered; refusing a silent CPU benchmark.\n" + devices)
    command = [
        str(binary),
        "--model",
        str(layers["model"].resolve()),
        "--mmproj",
        str(layers["projector"].resolve()),
        "--alias",
        args.model,
        "--host",
        "127.0.0.1",
        "--port",
        str(args.port),
        "--no-webui",
        "--parallel",
        str(args.slots),
        "--ctx-size",
        str(args.context * args.slots),
        "--device",
        "CUDA0",
        "--gpu-layers",
        "all",
        "--flash-attn",
        "on",
        "--jinja",
        "--chat-template-kwargs",
        '{"enable_thinking":false}',
        "--cache-ram",
        "0",
        "--ctx-checkpoints",
        "0",
        "--slots",
        "--metrics",
        "--log-verbosity",
        "4",
    ]
    if args.chat_template:
        if not args.chat_template.is_file():
            parser.error("Chat template does not exist")
        command.extend(["--chat-template-file", str(args.chat_template.resolve())])
    args.report.parent.mkdir(parents=True, exist_ok=True)
    report_text = (
        json.dumps(
            {
                "model": args.model,
                "manifest": manifest,
                "command": command,
                "devices": devices,
                "available_bytes_before_load": available,
                "slots": args.slots,
                "context_per_slot": args.context,
                "embedded_projector": args.embedded_projector,
                "chat_template_sha256": (
                    hashlib.sha256(args.chat_template.read_bytes()).hexdigest()
                    if args.chat_template
                    else None
                ),
                "version": subprocess.check_output(
                    [str(binary), "--version"], env=env, text=True, stderr=subprocess.STDOUT
                ),
            },
            indent=2,
        )
        + "\n"
    )
    with args.report.open("x") as report:
        report.write(report_text)
    print(devices, flush=True)
    os.execve(binary, command, env)


if __name__ == "__main__":
    main()
