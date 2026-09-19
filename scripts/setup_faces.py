#!/usr/bin/env python3
"""Download small, pinned OpenCV Zoo face models; run only on the ASUS host."""

import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

COMMIT = "47534e27c9851bb1128ccc0102f1145e27f23f98"
MODELS = {
    "yunet.onnx": (
        "face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        232589,
        "MIT",
    ),
    "sface.onnx": (
        "face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
        38696353,
        "Apache-2.0",
    ),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("data/face-models"))
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    provenance = {"repository": "https://github.com/opencv/opencv_zoo", "commit": COMMIT, "models": {}}
    for filename, (source, digest, size, license_name) in MODELS.items():
        path = args.directory / filename
        url = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{COMMIT}/models/{source}"
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            temporary = path.with_suffix(".partial")
            with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as output:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > size:
                        raise ValueError("Download exceeded pinned model size")
                    output.write(chunk)
            if (
                temporary.stat().st_size != size
                or hashlib.sha256(temporary.read_bytes()).hexdigest() != digest
            ):
                temporary.unlink(missing_ok=True)
                raise ValueError("Downloaded model differs from pinned upstream Git LFS digest")
            temporary.replace(path)
        license_url = (
            f"https://raw.githubusercontent.com/opencv/opencv_zoo/{COMMIT}/models/"
            + source.split("/")[0]
            + "/LICENSE"
        )
        with urllib.request.urlopen(license_url, timeout=30) as response:
            (args.directory / (filename + ".LICENSE")).write_bytes(response.read())
        provenance["models"][filename] = {
            "url": url,
            "sha256": digest,
            "bytes": size,
            "license": license_name,
        }
    (args.directory / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(json.dumps({"ready": True, "directory": str(args.directory), "models": list(MODELS)}))


if __name__ == "__main__":
    main()
