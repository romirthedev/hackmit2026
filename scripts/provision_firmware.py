#!/usr/bin/env python3
"""Write a private firmware secrets header without exposing passwords in shell history."""

import getpass
import json
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values

root = Path(__file__).resolve().parents[1]
env = dotenv_values(root / ".env")
ssid = input("2.4 GHz Wi-Fi name: ").strip()
password = getpass.getpass("Wi-Fi password: ")
url = input("Server LAN URL (e.g. http://192.168.1.20:8000): ").strip().rstrip("/")
if urlsplit(url).scheme not in ("http", "https"):
    raise SystemExit("Use an http:// or https:// URL.")
key = env.get("REWIND_DEVICE_TOKEN")
if not key:
    raise SystemExit("Run scripts/setup.py first.")
ca = ""
if url.startswith("https://"):
    ca = Path(input("Path to server CA PEM file: ").strip()).read_text()
fields = {
    "WIFI_SSID": ssid,
    "WIFI_PASSWORD": password,
    "SERVER_URL": url,
    "DEVICE_TOKEN": key,
    "DEVICE_ID": env.get("REWIND_DEVICE_ID", "necklace-01"),
    "ROOT_CA": ca,
}
path = root / "firmware/include/secrets.h"
path.write_text(
    "#pragma once\n" + "\n".join(f"#define {k} {json.dumps(v)}" for k, v in fields.items()) + "\n"
)
path.chmod(0o600)
print("Wrote private firmware/include/secrets.h. Flash with: pio run -d firmware -t upload")
