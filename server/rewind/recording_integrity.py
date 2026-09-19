"""Bounded-memory integrity checks for retained continuous recording fragments."""

import hashlib
import os
import stat
from functools import lru_cache
from pathlib import Path


def fingerprint(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


@lru_cache(maxsize=8192)
def _verified_digest(path, expected_size, expected_digest, signature):
    # Cache only successful checks of a particular inode/size/change timestamp.
    # A same-length edit, replacement, or changed expected digest gets rehashed.
    with Path(path).open("rb") as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or fingerprint(before) != signature:
            raise ValueError("Original fragment changed")
        digest = hashlib.sha256()
        remaining = expected_size
        while remaining:
            piece = source.read(min(1024 * 1024, remaining))
            if not piece:
                raise ValueError("Original fragment was truncated")
            digest.update(piece)
            remaining -= len(piece)
        if source.read(1) or fingerprint(os.fstat(source.fileno())) != signature:
            raise ValueError("Original fragment changed")
        if digest.hexdigest() != expected_digest:
            raise ValueError("Original fragment differs from its retained digest")
    return signature


def verified_fragment(part):
    path = Path(part["path"])
    current = path.stat()
    if not stat.S_ISREG(current.st_mode) or current.st_size != part["bytes"]:
        raise ValueError("Original fragment differs from its retained length")
    return _verified_digest(str(path), part["bytes"], part["sha256"], fingerprint(current))


def fragments_status(parts):
    try:
        for part in parts:
            verified_fragment(part)
    except (FileNotFoundError, NotADirectoryError):
        return "missing_fragment"
    except (OSError, ValueError):
        return "corrupt_fragment"
    return "available"
