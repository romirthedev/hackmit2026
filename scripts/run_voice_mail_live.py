#!/usr/bin/env python3
"""Run real voice and fixed-mail browser E2E in an isolated local workspace.

Requires a built web UI, Chrome, Playwright, ffmpeg, local Ollama or --asus,
REWIND_DEEPGRAM_API_KEY in --env-file, and signed-in Codex for evidence review.
Only service credentials are reused; personal data and browser sessions are not.
"""

import argparse
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=root / ".env")
    parser.add_argument("--node", default=shutil.which("node"))
    parser.add_argument("--model", default="qwen2.5vl:3b")
    parser.add_argument("--script", type=Path, default=root / "scripts/test_voice_mail_live.mjs")
    parser.add_argument(
        "--asus", action="store_true", help="Use the configured ASUS processing service; fail if unavailable"
    )
    args = parser.parse_args()
    configured = dotenv_values(args.env_file)
    # Permit launchers to supply service credentials in memory without copying
    # them to a test file. Workspace/account settings are intentionally excluded.
    for name in ("REWIND_DEEPGRAM_API_KEY", "REWIND_PROCESSING_URL", "REWIND_PROCESSING_TOKEN"):
        if os.environ.get(name):
            configured[name] = os.environ[name]
    key = configured.get("REWIND_DEEPGRAM_API_KEY")
    if not key or not args.node or not shutil.which("ffmpeg"):
        parser.error("Requires a configured Deepgram key, Node (--node), and ffmpeg.")
    client = root / "web/dist/client"
    if not (client / "index.html").exists():
        parser.error("Build web first.")
    site = root / "data/voice-mail-live" / f"run-{int(time.time())}"
    (site / "web/dist").mkdir(parents=True)
    # Freeze this run's assets so a concurrent rebuild cannot remove routes or
    # replace JavaScript midway through an evidence/voice integration check.
    shutil.copytree(client, site / "web/dist/client")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    token = "live-test-" + secrets.token_hex(24)
    env = {k: v for k, v in os.environ.items() if not k.startswith("REWIND_")}
    env.update(
        {
            "REWIND_ADMIN_TOKEN": token,
            "REWIND_DEVICE_TOKEN": "live-device-" + secrets.token_hex(24),
            "REWIND_DEEPGRAM_API_KEY": key,
            "REWIND_DATA_DIR": str(site / "workspace"),
            "REWIND_PROVIDER": "ollama",
            "REWIND_PROCESSING_URL": "",
            "REWIND_VISION_MODEL": args.model,
            "REWIND_REASONING_MODEL": args.model,
            "REWIND_OLLAMA_CONTEXT": "8192",
            "REWIND_OLLAMA_RECALL_CONTEXT": "8192",
            "REWIND_CODEX_VERIFY": "true",
            "REWIND_WORKERS": "0",
            "REWIND_EMBEDDINGS": "false",
            "REWIND_SCAN_DEMO_TEMPLATE": "true",
            "REWIND_BROWSER_OPEN_ACCESS": "true",
            "REWIND_COOKIE_SECURE": "false",
            "REWIND_NOTCH_URL": "",
            "REWIND_NOTCH_CONTROL_URL": "",
            "REWIND_UI_TEST_URL": f"http://127.0.0.1:{port}",
            "REWIND_UI_TEST_TOKEN": token,
            "REWIND_TEST_AUDIO": str(site / "question.wav"),
            "REWIND_TEST_ARTIFACTS": str(site / "browser"),
        }
    )
    if args.asus:
        endpoint = configured.get("REWIND_PROCESSING_URL")
        secret = configured.get("REWIND_PROCESSING_TOKEN")
        if not endpoint or not secret:
            parser.error("--asus requires a processing URL and token in --env-file")
        response = httpx.get(
            endpoint.rstrip("/") + "/health", headers={"Authorization": "Bearer " + secret}, timeout=15
        )
        response.raise_for_status()
        health = response.json()
        if not health.get("ready"):
            parser.error("ASUS model is not ready")
        env.update(
            {
                "REWIND_PROCESSING_URL": endpoint,
                "REWIND_PROCESSING_TOKEN": secret,
                "REWIND_VISION_MODEL": health["model"],
                "REWIND_REASONING_MODEL": health["model"],
                "REWIND_TEST_BACKEND": "asus",
            }
        )
    with (site / "api.log").open("wb") as log:
        server = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "rewind.app:create_app",
                "--factory",
                "--app-dir",
                str(root / "server"),
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            cwd=site,
            env=env,
            stdout=log,
            stderr=log,
            stdin=subprocess.DEVNULL,
        )
        try:
            with httpx.Client(
                base_url=env["REWIND_UI_TEST_URL"], headers={"Authorization": "Bearer " + token}, timeout=60
            ) as api:
                for _ in range(100):
                    try:
                        if api.get("/api/voice/status").status_code == 200:
                            break
                    except httpx.ConnectError:
                        time.sleep(0.1)
                else:
                    raise RuntimeError("Isolated server did not start.")
                response = api.post("/api/voice/speak", json={"text": "Rewind, when is my doctor bill due?"})
                response.raise_for_status()
                (site / "question.mp3").write_bytes(response.content)
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(site / "question.mp3"),
                    "-af",
                    "adelay=2000,apad=pad_dur=3",
                    "-ar",
                    "48000",
                    "-ac",
                    "1",
                    str(site / "question.wav"),
                ],
                check=True,
            )
            print("Testing real voice against an isolated workspace; artifacts:", site, flush=True)
            return subprocess.run(
                [args.node, str(args.script.resolve())], cwd=root, env=env
            ).returncode
        finally:
            server.terminate()
            try:
                server.wait(timeout=15)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


if __name__ == "__main__":
    raise SystemExit(main())
