#!/usr/bin/env python3
"""Run the private demo only after its protected original evidence validates."""

import argparse
import os
from pathlib import Path

import uvicorn
from rewind.app import create_app
from rewind.config import Settings


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=root / ".env")
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8004)
    parser.add_argument("--min-free-gb", type=float)
    args = parser.parse_args()
    overrides = {"demo_mode": True}
    if args.data_dir:
        overrides["data_dir"] = args.data_dir.resolve()
    if args.min_free_gb is not None:
        overrides["min_free_gb"] = args.min_free_gb
    settings = Settings(_env_file=args.env_file.resolve(), **overrides)
    os.chdir(root)
    app = create_app(settings)
    # A missing/changed walkthrough must not silently start a normal wipeable app.
    app.state.memory.demo.protection()
    print("Protected walkthrough validated. Starting the private demo.", flush=True)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
