#!/usr/bin/env python3
"""Configure the private read-only Notch bridge without printing capability tokens."""

import argparse
from pathlib import Path
from urllib.parse import urlparse

from dotenv import set_key


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--token-file", type=Path, default=Path.home() / ".notch/remote-token")
    parser.add_argument("--bridge-url", default="http://127.0.0.1:8738")
    parser.add_argument("--public-url", help="Reachable HTTPS origin for the phone QR")
    args = parser.parse_args()
    if not args.env_file.is_file():
        parser.error("Run scripts/setup.py first, or select an existing private environment file.")
    if not args.token_file.is_file():
        parser.error("Start the copied Notch app with --rewind-bridge first.")
    token = args.token_file.read_text().strip()
    if len(token) < 8:
        parser.error("Notch token file is invalid.")
    if args.public_url:
        public = urlparse(args.public_url)
        if (
            public.scheme != "https"
            or not public.hostname
            or public.username
            or public.query
            or public.fragment
        ):
            parser.error("--public-url must be an HTTPS origin without credentials, query, or fragment.")
    bridge = urlparse(args.bridge_url)
    if bridge.scheme not in {"http", "https"} or not bridge.hostname or bridge.username:
        parser.error("Invalid bridge URL.")
    args.env_file.chmod(0o600)
    set_key(args.env_file, "REWIND_NOTCH_URL", args.bridge_url.rstrip("/"))
    set_key(args.env_file, "REWIND_NOTCH_TOKEN", token)
    if args.public_url:
        set_key(args.env_file, "REWIND_PUBLIC_URL", args.public_url.rstrip("/"))
        set_key(args.env_file, "REWIND_COOKIE_SECURE", "true")
    print("Private bridge configuration saved. Restart REWIND, then select sources and Connect Notch.")


if __name__ == "__main__":
    main()
