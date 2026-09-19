#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "Run the README setup first to install REWIND."
  read -r -p "Press Enter to close. "
  exit 1
fi
.venv/bin/python scripts/open_workspace.py "$@"
