#!/usr/bin/env python3
"""Test QR-only phone sign-in against a fresh local API and built web client.

Requires project Python dependencies, Node, Playwright (optionally NODE_PATH),
and Chrome (optionally REWIND_TEST_CHROME). Does not read the production .env,
reuse production credentials, record media, or enable any inference provider.
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
import urllib.error
import urllib.request
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-dir", type=Path, default=root / "web/dist/client")
    parser.add_argument("--node", default=shutil.which("node"))
    args = parser.parse_args()
    client = args.client_dir.resolve()
    if not (client / "phone.html").is_file() or not args.node:
        parser.error("Build web first and supply a Node executable with --node or PATH.")

    artifacts = root / "data/qr-pairing" / f"run-{time.time_ns()}"
    artifacts.mkdir(parents=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix="api-", dir=artifacts) as temporary:
        site = Path(temporary)
        (site / "web/dist").mkdir(parents=True)
        (site / "web/dist/client").symlink_to(client, target_is_directory=True)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        token = "qr-test-" + secrets.token_hex(24)
        env = {
            key: value for key, value in os.environ.items()
            if not key.startswith(("REWIND_", "QR_TEST_"))
        }
        env.update({
            "REWIND_ADMIN_TOKEN": token,
            "REWIND_DEVICE_TOKEN": "qr-device-" + secrets.token_hex(24),
            "REWIND_DATA_DIR": str(site / "workspace"),
            "REWIND_PROVIDER": "disabled", "REWIND_WORKERS": "0",
            "REWIND_EMBEDDINGS": "false", "REWIND_VISUAL_EMBEDDINGS": "false",
            "REWIND_CODEX_VERIFY": "false", "REWIND_COOKIE_SECURE": "false",
            "REWIND_DEEPGRAM_API_KEY": "", "REWIND_TEST_LOGIN_CODE": "",
            "REWIND_NOTCH_URL": "", "REWIND_NOTCH_CONTROL_URL": "",
            "REWIND_PROCESSING_URL": "", "REWIND_ELASTIC_URL": "",
        })
        origin = f"http://127.0.0.1:{port}"
        log_path = artifacts / "api.log"
        with log_path.open("wb") as log:
            os.chmod(log_path, 0o600)
            server = subprocess.Popen([
                sys.executable, "-m", "uvicorn", "rewind.app:create_app", "--factory",
                "--app-dir", str(root / "server"), "--host", "127.0.0.1", "--port", str(port),
            ], cwd=site, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
            try:
                request = urllib.request.Request(origin + "/api/status", headers={"Authorization": "Bearer " + token})
                for _ in range(150):
                    if server.poll() is not None:
                        raise RuntimeError(f"Fixture API exited; see {log_path}")
                    try:
                        with urllib.request.urlopen(request, timeout=1) as response:
                            status = json.load(response)
                        assert status["provider"] == "disabled" and status["workers"] == 0
                        break
                    except (urllib.error.URLError, TimeoutError):
                        time.sleep(0.1)
                else:
                    raise RuntimeError(f"Fixture API did not start; see {log_path}")
                env.update({
                    "QR_TEST_URL": origin, "QR_TEST_TOKEN": token,
                    "QR_TEST_ARTIFACTS": str(artifacts), "QR_TEST_PYTHON": sys.executable,
                    "QR_TEST_DB": str(site / "workspace/rewind.sqlite3"),
                })
                if os.environ.get("REWIND_TEST_CHROME"):
                    env["REWIND_TEST_CHROME"] = os.environ["REWIND_TEST_CHROME"]
                print("Testing QR sign-in against a fresh disabled local API.", flush=True)
                return subprocess.run([args.node, str(root / "scripts/test_qr_pairing.mjs")], cwd=root, env=env).returncode
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    raise SystemExit(main())
