#!/usr/bin/env python3
"""Serve existing Ollama GGUF vision weights with native llama.cpp CUDA batching.

Runs in the foreground, binds loopback, and refuses CPU fallback. Does not
modify an Ollama service or download weights. Context is specified PER SLOT.
"""

import argparse
import json
import os
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, help="Installed Ollama name:tag")
    parser.add_argument("--models-dir", required=True, type=Path)
    parser.add_argument("--runtime-dir", type=Path, default=Path("/usr/local/lib/ollama"))
    parser.add_argument("--slots", type=int, choices=range(1, 9), default=8)
    parser.add_argument("--context", type=int, default=8192, help="Tokens per slot")
    parser.add_argument("--port", type=int, default=11436)
    parser.add_argument("--min-free-gib", type=float, default=0)
    parser.add_argument("--report", type=Path, required=True, help="New launch metadata file")
    args = parser.parse_args()
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
    for key in ("model", "projector"):
        if key not in layers or not layers[key].is_file():
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
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(
            {
                "model": args.model,
                "manifest": manifest,
                "command": command,
                "devices": devices,
                "available_bytes_before_load": available,
                "slots": args.slots,
                "context_per_slot": args.context,
                "version": subprocess.check_output(
                    [str(binary), "--version"], env=env, text=True, stderr=subprocess.STDOUT
                ),
            },
            indent=2,
        )
        + "\n"
    )
    print(devices, flush=True)
    os.execve(binary, command, env)


if __name__ == "__main__":
    main()
