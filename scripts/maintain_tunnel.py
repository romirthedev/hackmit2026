#!/usr/bin/env python3
"""Reconnect the private ASUS SSH forwards without exposing inference to the LAN."""

import argparse
import signal
import subprocess
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ssh-config", type=Path, required=True)
    parser.add_argument("--host", default="rewind-gx10")
    args = parser.parse_args()
    stopping, child = False, None

    def stop(*_):
        nonlocal stopping
        stopping = True
        if child and child.poll() is None:
            child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    delay = 1
    command = [
        "ssh",
        "-F",
        str(args.ssh_config.resolve()),
        "-NT",
        "-o",
        "BatchMode=yes",
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        "-L",
        "127.0.0.1:11440:127.0.0.1:11440",
        "-L",
        "127.0.0.1:11441:127.0.0.1:11434",
        args.host,
    ]
    while not stopping:
        began = time.monotonic()
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL)
        code = child.wait()
        if stopping:
            break
        print(f"ASUS tunnel disconnected ({code}); reconnecting in {delay}s.", flush=True)
        deadline = time.monotonic() + delay
        while not stopping and time.monotonic() < deadline:
            time.sleep(0.25)
        delay = 1 if time.monotonic() - began > 60 else min(delay * 2, 30)


if __name__ == "__main__":
    main()
