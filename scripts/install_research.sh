#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Separate environment: install a CUDA/PyTorch build compatible with your actual ASUS GPU first.
REWIND_LINGBOT_REV=849e690bb086103637e44b1e91878d9d43a8bf0c
if [ ! -d third_party/lingbot-map/.git ]; then
  git clone https://github.com/Robbyant/lingbot-map.git third_party/lingbot-map
fi
git -C third_party/lingbot-map checkout "$REWIND_LINGBOT_REV"
python3 -m venv --system-site-packages .venv-research
.venv-research/bin/python -m pip install -e third_party/lingbot-map huggingface_hub
.venv-research/bin/hf download robbyant/lingbot-map lingbot-map.pt --local-dir models/lingbot-map
printf '%s\n' 'Research adapter installed. Run .venv-research/bin/python scripts/reconstruct.py --checkpoint models/lingbot-map/lingbot-map.pt'
