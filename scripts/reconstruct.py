#!/usr/bin/env python3
"""Reconstruct one bounded static scan with LingBot-Map, then export an authenticated dashboard scene.
Requires the separately installed research environment. Does not change the all-frame analysis queue.
"""

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def scene_from_predictions(points, confidence, images, rows, max_points=35000):
    """Convert real world coordinates to compact JSON; retain capture IDs for observation markers."""
    points = np.asarray(points)
    if points.ndim == 5:
        points = points[0]
    confidence = np.asarray(confidence)
    if confidence.ndim == 4:
        confidence = confidence[0]
    images = np.asarray(images)
    if images.ndim == 5:
        images = images[0]
    if images.shape[1] == 3:
        images = images.transpose(0, 2, 3, 1)
    if images.max() <= 1.01:
        images = images * 255
    if points.shape[:3] != images.shape[:3]:
        raise ValueError("Prediction/image dimensions do not match; verify the pinned research version.")
    mask = np.isfinite(points).all(axis=-1) & np.isfinite(confidence)
    threshold = np.percentile(confidence[mask], 55) if mask.any() else 0
    mask &= confidence >= threshold
    xyz, rgb = points[mask], images[mask]
    indices = np.linspace(0, max(0, len(xyz) - 1), min(max_points, len(xyz)), dtype=int)
    cloud = [
        [*map(lambda v: round(float(v), 4), xyz[i]), *map(int, np.clip(rgb[i], 0, 255))] for i in indices
    ]
    markers = []
    height, width = points.shape[1:3]
    for frame_index, row in enumerate(rows):
        for obj in json.loads(row.get("objects") or "[]"):
            box = obj.get("bbox", [])
            if len(box) != 4 or not all(0 <= v <= 1 for v in box):
                continue
            # Only an approximate visible-surface anchor, never an inferred object centroid.
            x, y = int((box[0] + box[2]) / 2 * (width - 1)), int((box[1] + box[3]) / 2 * (height - 1))
            if mask[frame_index, y, x]:
                markers.append(
                    {
                        "id": row["id"],
                        "label": obj["label"],
                        "position": points[frame_index, y, x].astype(float).tolist(),
                        "captured_at": row["captured_at"],
                    }
                )
    return {
        "available": bool(cloud),
        "points": cloud,
        "cameras": [],
        "markers": markers,
        "frames": [{"id": r["id"], "captured_at": r["captured_at"]} for r in rows],
        "source": "LingBot-Map",
        "coordinate_note": "Arbitrary monocular scale; visible surface estimates, not metric object tracking.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=ROOT / "third_party/lingbot-map")
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--data", type=Path, default=ROOT / "data")
    parser.add_argument("--after", type=float, default=0, help="Unix capture time start")
    parser.add_argument("--before", type=float, default=1e12, help="Unix capture time end")
    parser.add_argument("--max-frames", type=int, default=64)
    args = parser.parse_args()
    if not 8 <= args.max_frames <= 256:
        parser.error("Use 8–256 frames for a bounded tabletop scan.")
    sys.path.insert(0, str(args.repo.resolve()))
    import torch
    from lingbot_map.models.gct_stream import GCTStream
    from lingbot_map.utils.geometry import unproject_depth_map_to_point_map
    from lingbot_map.utils.load_fn import load_and_preprocess_images
    from lingbot_map.utils.pose_enc import pose_encoding_to_extri_intri

    if not torch.cuda.is_available():
        raise SystemExit("Run reconstruction on the ASUS NVIDIA GPU environment, not the laptop CPU.")
    db = sqlite3.connect(args.data / "rewind.sqlite3")
    db.row_factory = sqlite3.Row
    # Select most recent frames in the requested interval, then restore temporal order.
    rows = [
        dict(r)
        for r in db.execute(
            """SELECT m.id,m.path,m.captured_at,e.objects FROM media m LEFT JOIN events e ON e.id=m.id
        WHERE m.kind='frame' AND m.captured_at BETWEEN ? AND ? ORDER BY m.captured_at DESC LIMIT ?""",
            (args.after, args.before, args.max_frames),
        )
    ][::-1]
    db.close()
    if len(rows) < 8:
        raise SystemExit("Capture at least 8 overlapping frames of a static scene first.")
    images = load_and_preprocess_images([r["path"] for r in rows], image_size=518, patch_size=14).cuda()
    model = GCTStream(
        img_size=518,
        patch_size=14,
        enable_3d_rope=True,
        max_frame_num=1024,
        kv_cache_sliding_window=32,
        kv_cache_scale_frames=8,
        kv_cache_cross_frame_special=True,
        kv_cache_include_scale_frames=True,
        use_sdpa=True,
        camera_num_iterations=4,
    )
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    missing, unexpected = model.load_state_dict(checkpoint.get("model", checkpoint), strict=False)
    if missing:
        raise RuntimeError(f"Checkpoint is missing model weights: {missing[:5]}")
    if unexpected:
        print(f"Checkpoint has {len(unexpected)} unused parameters (e.g. disabled heads).")
    model = model.cuda().eval()
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16):
        predictions = model.inference_streaming(
            images, num_scale_frames=8, keyframe_interval=1, output_device=torch.device("cpu")
        )
    if "world_points" in predictions:
        points = predictions["world_points"].float().cpu().numpy()
        confidence = predictions["world_points_conf"].float().cpu().numpy()
    else:
        extrinsic, intrinsic = pose_encoding_to_extri_intri(predictions["pose_enc"], images.shape[-2:])
        points = unproject_depth_map_to_point_map(
            predictions["depth"][0].float().cpu().numpy(),
            extrinsic[0].float().cpu().numpy(),
            intrinsic[0].float().cpu().numpy(),
        )
        confidence = predictions["depth_conf"].float().cpu().numpy()
    scene = scene_from_predictions(points, confidence, images.float().cpu().numpy(), rows)
    target = args.data / "scene.json"
    temp = target.with_suffix(".tmp")
    temp.write_text(json.dumps(scene, separators=(",", ":"), allow_nan=False))
    os.replace(temp, target)
    print(
        f"Exported {len(scene['points'])} points from {len(rows)} real frames to {target}. Refresh the 3D scene tab."
    )


if __name__ == "__main__":
    main()
