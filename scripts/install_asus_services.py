#!/usr/bin/env python3
"""Install user systemd units without stopping any running REWIND process.

Default: validate, write units and reload the user manager. --enable persists
the units for future user-manager starts; --enable-linger requests that this user
manager start at boot. --start refuses ports held by an unmanaged process.
"""

import argparse
import getpass
import json
import os
import shutil
import socket
import stat
import subprocess
import tempfile
from pathlib import Path

UNITS = ("rewind-vision.service", "rewind-processing.service")


def quote(value):
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%") + '"'


def rendered_units(workspace):
    paths = {
        "WORKSPACE": workspace,
        # Keep the venv executable path; resolving its symlink loses the venv.
        "PYTHON": workspace / ".venv/bin/python",
        "VISION_SCRIPT": workspace / "scripts/serve_vision.py",
        "RUNTIME": workspace / "runtime/lib/ollama",
        "CHAT_TEMPLATE": workspace / "qwen35-chat-template.jinja",
        "REPORT_DIR": workspace / "data/service-launches",
        "PROCESSING_ENV": workspace / "asus-processing.env",
    }
    rendered = {}
    if any(char in str(workspace) for char in "\r\n"):
        raise ValueError("Workspace path cannot contain line breaks")
    for unit in UNITS:
        source = (workspace / "deploy/systemd" / f"{unit}.in").read_text()
        for name, path in paths.items():
            value = str(path).replace("%", "%%") if name == "WORKSPACE" else quote(path)
            source = source.replace(f"@{name}@", value)
        if "@" in source:
            raise ValueError(f"Unresolved template field in {unit}")
        rendered[unit] = source
    return rendered


def run(*args, check=True):
    return subprocess.run(args, check=check, text=True, capture_output=True, timeout=30)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("--unit-dir", type=Path, help="Preview output directory (with --render-only)")
    parser.add_argument(
        "--render-only", action="store_true", help="Write and verify units; do not change systemd"
    )
    parser.add_argument(
        "--enable", action="store_true", help="Enable these units for future user-manager starts"
    )
    parser.add_argument(
        "--enable-linger", action="store_true", help="Request noninteractive boot persistence for this user"
    )
    parser.add_argument(
        "--start", action="store_true", help="Start after preflight; never stop existing processes"
    )
    args = parser.parse_args()
    # Noninteractive SSH may omit these even while this user's manager is live.
    runtime = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
    if not runtime.is_dir() or runtime.stat().st_uid != os.getuid():
        parser.error("This user's systemd runtime directory is unavailable; log in as the service user first")
    os.environ.setdefault("XDG_RUNTIME_DIR", str(runtime))
    if (runtime / "bus").exists():
        os.environ.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path={runtime}/bus")
    root = args.workspace.absolute()
    if args.unit_dir and not args.render_only:
        parser.error("--unit-dir is only for --render-only previews")
    args.unit_dir = args.unit_dir or (
        root / "data/systemd-preview" if args.render_only else Path.home() / ".config/systemd/user"
    )
    if args.render_only and (args.enable or args.enable_linger or args.start):
        parser.error("--render-only cannot change service state")
    required = (
        ".venv/bin/python",
        "scripts/serve_vision.py",
        "runtime/lib/ollama/llama-server",
        "runtime/lib/ollama/cuda_v13/libggml-cuda.so",
        "qwen35-chat-template.jinja",
        "asus-processing.env",
        "server/rewind/processing.py",
    )
    for name in required:
        if not (root / name).is_file():
            parser.error(f"Required existing runtime file is missing: {name}")
    environment = root / "asus-processing.env"
    mode = stat.S_IMODE(environment.stat().st_mode)
    if mode & 0o077:
        parser.error("asus-processing.env must be private (chmod 600); its contents were not read")
    if environment.stat().st_uid != os.getuid():
        parser.error("asus-processing.env must belong to the service user")
    if not shutil.which("systemd-analyze") or not shutil.which("systemctl"):
        parser.error("Run this installer on the Linux ASUS with systemd")
    if args.start:
        for unit, port in zip(UNITS, (11436, 11440), strict=True):
            if run("systemctl", "--user", "is-active", "--quiet", unit, check=False).returncode == 0:
                continue
            with socket.socket() as probe:
                probe.settimeout(1)
                if probe.connect_ex(("127.0.0.1", port)) == 0:
                    parser.error(
                        f"Port {port} is already occupied outside active {unit}; no process was stopped"
                    )
    units = rendered_units(root)
    with tempfile.TemporaryDirectory(prefix="rewind-systemd-") as folder:
        candidates = []
        for name, contents in units.items():
            candidate = Path(folder) / name
            candidate.write_text(contents)
            candidates.append(str(candidate))
        verification = run("systemd-analyze", "--user", "verify", *candidates, check=False)
        if verification.returncode:
            raise SystemExit("Unit verification failed; services were not changed:\n" + verification.stderr)
    args.unit_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, contents in units.items():
        destination = args.unit_dir / name
        temporary = destination.with_suffix(".pending")
        temporary.write_text(contents)
        temporary.chmod(0o600)
        os.replace(temporary, destination)
        paths.append(str(destination))
    if args.render_only:
        print(json.dumps({"validated_units": paths, "service_state_changed": False}, indent=2))
        return
    run("systemctl", "--user", "daemon-reload")
    linger_error = None
    if args.enable_linger:
        result = run("loginctl", "--no-ask-password", "enable-linger", getpass.getuser(), check=False)
        if result.returncode:
            linger_error = result.stderr.strip() or "Linger authorization unavailable"
    if args.enable:
        run("systemctl", "--user", "enable", *UNITS)
    if args.start:
        run("systemctl", "--user", "start", *UNITS)
    linger = run("loginctl", "show-user", getpass.getuser(), "--property=Linger", "--value", check=False)
    result = {
        "installed_units": paths,
        "enabled_requested": args.enable,
        "started_requested": args.start,
        "linger": linger.stdout.strip() == "yes",
        "linger_error": linger_error,
        "states": {
            unit: run("systemctl", "--user", "is-active", unit, check=False).stdout.strip() for unit in UNITS
        },
    }
    print(json.dumps(result, indent=2))
    if linger_error:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
