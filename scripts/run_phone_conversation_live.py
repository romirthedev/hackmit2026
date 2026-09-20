#!/usr/bin/env python3
"""Exercise real phone STT → conversation → TTS in a fresh disposable workspace.

Only explicitly allowlisted service settings are reused. The live database,
recordings, Notch account and computer-control bridge are never connected.
Build web first. Requires Deepgram, a configured model service, Node and Playwright.
"""

import argparse
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values

SERVICE_KEYS = (
    "REWIND_DEEPGRAM_API_KEY",
    "REWIND_DEEPGRAM_STT_MODEL",
    "REWIND_DEEPGRAM_TTS_MODEL",
    "REWIND_PROCESSING_URL",
    "REWIND_PROCESSING_TOKEN",
    "REWIND_PROVIDER",
    "REWIND_OLLAMA_URL",
    "REWIND_VISION_MODEL",
    "REWIND_REASONING_MODEL",
)
QUESTIONS = [
    "Hi, can you hear me? What's your name?",
    "Tell me a short joke.",
    "Tell me another one.",
]


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=root / ".env")
    parser.add_argument("--node", default=shutil.which("node"))
    args = parser.parse_args()
    configured = {**dotenv_values(args.env_file), **os.environ}
    if not args.node or not configured.get("REWIND_DEEPGRAM_API_KEY"):
        parser.error("Requires Node (--node) and a configured Deepgram key.")
    if not configured.get("REWIND_PROCESSING_URL") and not configured.get("REWIND_OLLAMA_URL"):
        parser.error("Configure an explicit processing service or Ollama URL for live model testing.")
    client = root / "web/dist/client"
    if not (client / "phone.html").is_file():
        parser.error("Build web first.")
    artifacts = root / "data/ui-integration" / f"phone-live-{int(time.time())}"
    artifacts.mkdir(parents=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix="workspace-", dir=artifacts) as temporary:
        site = Path(temporary)
        (site / "web/dist").mkdir(parents=True)
        # Long service tests keep the exact build they started with.
        shutil.copytree(client, site / "web/dist/client")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        token = "live-test-" + secrets.token_hex(24)
        env = {k: v for k, v in os.environ.items() if not k.startswith("REWIND_")}
        env.update({k: configured[k] for k in SERVICE_KEYS if configured.get(k)})
        env.update(
            {
                "REWIND_ADMIN_TOKEN": token,
                "REWIND_DEVICE_TOKEN": "live-device-" + secrets.token_hex(24),
                "REWIND_DATA_DIR": str(site / "data"),
                "REWIND_PROVIDER": "ollama",
                "REWIND_WORKERS": "0",
                "REWIND_CODEX_VERIFY": "false",
                "REWIND_EMBEDDINGS": "false",
                "REWIND_VISUAL_EMBEDDINGS": "false",
                "REWIND_BROWSER_OPEN_ACCESS": "false",
                "REWIND_COOKIE_SECURE": "false",
                "REWIND_MIN_FREE_GB": "0",
                "REWIND_NOTCH_URL": "",
                "REWIND_NOTCH_CONTROL_URL": "",
                "REWIND_UI_TEST_URL": f"http://127.0.0.1:{port}",
                "REWIND_UI_TEST_TOKEN": token,
                "REWIND_TEST_ARTIFACTS": str(artifacts),
            }
        )
        log_path = artifacts / "api.log"
        with log_path.open("wb") as log:
            os.chmod(log_path, 0o600)
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
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
            )
            try:
                with httpx.Client(
                    base_url=env["REWIND_UI_TEST_URL"],
                    headers={"Authorization": "Bearer " + token},
                    timeout=90,
                ) as api:
                    for _ in range(150):
                        if server.poll() is not None:
                            raise RuntimeError(f"Fixture API exited; see {log_path}")
                        try:
                            status = api.get("/api/status")
                            status.raise_for_status()
                            break
                        except httpx.HTTPError:
                            time.sleep(0.1)
                    else:
                        raise RuntimeError("Fixture API did not start")
                    state = status.json()
                    assert state["received"] == 0 and state["workers"] == 0
                    assert api.get("/api/voice/status").json()["deepgram"]
                    for index, question in enumerate(QUESTIONS):
                        audio = api.post("/api/voice/speak", json={"text": question})
                        audio.raise_for_status()
                        (artifacts / f"question-{index}.mp3").write_bytes(audio.content)
                    (artifacts / "questions.json").write_text(json.dumps(QUESTIONS))
                print(
                    f"Testing live phone conversation in an isolated workspace. Artifacts: {artifacts}",
                    flush=True,
                )
                return subprocess.run(
                    [args.node, str(root / "scripts/test_phone_conversation_live.mjs")], cwd=root, env=env
                ).returncode
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    raise SystemExit(main())
