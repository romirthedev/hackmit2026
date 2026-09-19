#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -d .venv ]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install -e '.[audio]'
.venv/bin/python scripts/setup.py
if [ ! -f web/dist/client/index.html ]; then
  (cd web && pnpm install --frozen-lockfile --ignore-scripts && pnpm build)
fi
exec .venv/bin/python -m uvicorn rewind.app:create_app --factory --host 0.0.0.0 --port 8000
