#!/usr/bin/env python3
"""Open a one-use sign-in link using the server's private configuration automatically."""

import argparse
import sys
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from rewind.config import Settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", default="http://localhost:8000", help="Running REWIND server")
    parser.add_argument(
        "--no-browser", action="store_true", help="Print the pairing code for another browser"
    )
    args = parser.parse_args()
    url = args.server.rstrip("/")
    parsed = urlsplit(url)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.netloc
        or parsed.username
        or parsed.query
        or parsed.fragment
    ):
        parser.error("Use a server URL such as http://localhost:8000, without credentials or a fragment.")
    s = Settings(_env_file=Path(__file__).resolve().parents[1] / ".env")
    s.validate_secrets()
    try:
        with httpx.Client(timeout=10) as client:
            response = client.post(url + "/api/pairing", headers={"Authorization": "Bearer " + s.admin_token})
            response.raise_for_status()
            invitation = response.json()
    except httpx.HTTPError:
        print(
            "Could not connect. Start REWIND first and run this from the server's checkout.", file=sys.stderr
        )
        return 1
    print(f"Pairing code: {invitation['code']} (single use; expires in 10 minutes)")
    print(f"Open {url} in your browser and enter this code.")
    if not args.no_browser:
        link = url + "/#connect=" + invitation["ticket"]
        if webbrowser.open(link):
            print("Opened a one-click sign-in link in your browser.")
        else:
            print("A browser could not be opened automatically. Use the pairing code above.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
