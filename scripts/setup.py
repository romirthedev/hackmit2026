#!/usr/bin/env python3
"""Generate private local credentials; never print their values."""

import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / ".env"
if path.exists():
    print(".env already exists; left unchanged.")
else:
    text = (root / ".env.example").read_text()
    text = text.replace("REWIND_ADMIN_TOKEN=\n", "REWIND_ADMIN_TOKEN=" + secrets.token_urlsafe(32) + "\n")
    text = text.replace("REWIND_DEVICE_TOKEN=\n", "REWIND_DEVICE_TOKEN=" + secrets.token_urlsafe(32) + "\n")
    path.write_text(text)
    path.chmod(0o600)
    print("Created .env with separate workspace and device keys. Open it locally to copy your workspace key.")
