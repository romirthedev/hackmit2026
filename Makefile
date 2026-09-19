.PHONY: setup test build firmware run
setup:
	python3 -m venv .venv
	.venv/bin/pip install -e '.[audio,dev]'
	.venv/bin/python scripts/setup.py
	cd web && pnpm install --frozen-lockfile --ignore-scripts

test:
	.venv/bin/pytest -q
	.venv/bin/ruff check server scripts
	cd web && pnpm exec tsc --noEmit

build:
	cd web && pnpm build

firmware:
	pio run -d firmware

run:
	.venv/bin/python -m uvicorn rewind.app:create_app --factory --host 0.0.0.0 --port 8000
