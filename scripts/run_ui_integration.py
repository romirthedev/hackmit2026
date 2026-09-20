#!/usr/bin/env python3
"""Run browser integration with a fresh local API and synthetic-only workspace.

Build web first. Requires this project's Python dependencies, Node, Playwright
(optionally via NODE_PATH), and Chrome (optionally REWIND_TEST_CHROME).
No production environment file, data, inference provider or Notch bridge is used.
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
    parser.add_argument("--script", type=Path, default=root / "scripts/test_ui_integration.mjs")
    args = parser.parse_args()
    client = args.client_dir.resolve()
    for page in ("index.html", "phone.html", "workspace.html"):
        if not (client / page).is_file():
            parser.error(f"Missing built UI: {client / page}. Build web first.")
    if not args.node:
        parser.error("Node is required; set PATH or --node.")

    artifacts = root / "data/ui-integration"
    artifacts.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="api-", dir=artifacts) as temporary:
        site = Path(temporary)
        (site / "web/dist").mkdir(parents=True)
        (site / "web/dist/client").symlink_to(client, target_is_directory=True)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        token = "ui-test-" + secrets.token_hex(24)
        # The isolated cwd has no .env, and inherited REWIND values cannot leak
        # a production workspace, model endpoint, credential or bridge into it.
        env = {key: value for key, value in os.environ.items() if not key.startswith("REWIND_")}
        env.update(
            {
                "REWIND_ADMIN_TOKEN": token,
                "REWIND_DEVICE_TOKEN": "ui-device-" + secrets.token_hex(24),
                "REWIND_DATA_DIR": str(site / "workspace"),
                "REWIND_PROVIDER": "disabled",
                "REWIND_WORKERS": "0",
                "REWIND_EMBEDDINGS": "false",
                "REWIND_VISUAL_EMBEDDINGS": "false",
                "REWIND_CODEX_VERIFY": "false",
                "REWIND_USAGE_LEDGER": "true",
                "REWIND_COOKIE_SECURE": "false",
                "REWIND_MIN_FREE_GB": "0",
                "REWIND_NOTCH_URL": "",
                "REWIND_NOTCH_CONTROL_URL": "",
                "REWIND_PROCESSING_URL": "",
            }
        )
        url = f"http://127.0.0.1:{port}"
        log_path = artifacts / f"api-{port}.log"
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
                request = urllib.request.Request(
                    url + "/api/status", headers={"Authorization": "Bearer " + token}
                )
                for _ in range(150):
                    if server.poll() is not None:
                        raise RuntimeError(f"Fixture server exited; see {log_path}")
                    try:
                        with urllib.request.urlopen(request, timeout=1) as response:
                            status = json.load(response)
                        assert status["provider"] == "disabled" and status["workers"] == 0
                        break
                    except (urllib.error.URLError, TimeoutError):
                        time.sleep(0.1)
                else:
                    raise RuntimeError(f"Fixture server not ready; see {log_path}")
                env.update({"REWIND_UI_TEST_URL": url, "REWIND_UI_TEST_TOKEN": token})
                if os.environ.get("REWIND_TEST_CHROME"):
                    env["REWIND_TEST_CHROME"] = os.environ["REWIND_TEST_CHROME"]
                print(f"Testing built UI against isolated API at {url}", flush=True)
                result = subprocess.run(
                    [args.node, str(args.script.resolve())], cwd=root, env=env
                )
                return result.returncode
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    raise SystemExit(main())
