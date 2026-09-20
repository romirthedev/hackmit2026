#!/usr/bin/env python3
"""Read-only audit of Rewind's bundled Notch source against its original hashes.

Modified files are reported, not silently blessed or replaced: Rewind extends
the copied app. A missing original file, invalid manifest, nested Git checkout,
or submodule fails the audit. Build output and other Git-ignored files are not
reported as added source. This never fetches upstream or reads user account data.
"""

import hashlib
import json
from pathlib import Path
import subprocess
import sys


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    relative_root = Path("integrations/notch")
    source = repo / relative_root
    manifest = json.loads((source / "UPSTREAM.json").read_text())
    expected = manifest["sha256"]
    if manifest["copied_files"] != len(expected):
        raise ValueError("UPSTREAM copied_files differs from its hash inventory")

    unchanged, modified, missing = [], [], []
    for name, original_hash in sorted(expected.items()):
        path = source / name
        if not path.resolve().is_relative_to(source.resolve()):
            raise ValueError(f"Manifest path escapes the bundled source: {name}")
        if not path.is_file():
            missing.append(name)
            continue
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_hash == original_hash:
            unchanged.append(name)
        else:
            modified.append({
                "path": name,
                "upstream_sha256": original_hash,
                "current_sha256": actual_hash,
            })

    listed = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", str(relative_root)],
        cwd=repo,
    ).decode().split("\0")
    included = {str(Path(p).relative_to(relative_root)) for p in listed if p}
    staged = subprocess.check_output(
        ["git", "ls-files", "--stage", "-z", "--", str(relative_root)], cwd=repo,
    ).decode().split("\0")
    submodules = [entry.split("\t", 1)[1] for entry in staged if entry.startswith("160000 ")]
    nested_git = (source / ".git").exists()
    report = {
        "repository": manifest["repository"],
        "revision": manifest["revision"],
        "expected_original_files": len(expected),
        "unchanged_original_files": len(unchanged),
        "modified_original_files": modified,
        "missing_original_files": missing,
        "added_files": sorted(included - set(expected)),
        "nested_git_checkout": nested_git,
        "submodules": submodules,
        "note": "Modified originals are Rewind extensions; their original hashes remain in UPSTREAM.json.",
    }
    print(json.dumps(report, indent=2))
    return int(bool(missing or nested_git or submodules))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (KeyError, ValueError, OSError, subprocess.CalledProcessError) as exc:
        print(f"Source audit failed: {exc}", file=sys.stderr)
        sys.exit(1)
