#!/usr/bin/env python3
"""Check runtime, model availability and hardware without printing secrets."""

import importlib.util
import platform
import shutil
import subprocess
from pathlib import Path

import httpx
from rewind.config import Settings

s = Settings()
print("Host:", platform.system(), platform.machine())
print("Data:", s.data_dir.resolve(), "| free disk:", round(shutil.disk_usage(Path.cwd()).free / 1e9, 1), "GB")
print("Keys configured:", len(s.admin_token) >= 24 and len(s.device_token) >= 24)
print("Dashboard built:", Path("web/dist/client/index.html").exists())
print("Local transcription installed:", importlib.util.find_spec("faster_whisper") is not None)
if shutil.which("nvidia-smi"):
    subprocess.run(
        ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv"], check=False
    )
else:
    print("NVIDIA GPU: not detected here. This can be a client/development machine.")
if s.provider == "ollama":
    try:
        r = httpx.get(s.ollama_url + "/api/tags", timeout=5)
        r.raise_for_status()
        names = [m["name"] for m in r.json().get("models", [])]
        for model in {s.vision_model, s.reasoning_model, s.embedding_model}:
            print("Model:", model, "available" if model in names else "MISSING")
    except httpx.HTTPError:
        print("Ollama: unreachable. Start Ollama on the GPU server.")
else:
    print("Provider:", s.provider)
