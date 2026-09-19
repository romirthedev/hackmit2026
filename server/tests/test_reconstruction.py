import importlib.util
import json
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location(
    "reconstruct", Path(__file__).resolve().parents[2] / "scripts/reconstruct.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_scene_export_filters_nonfinite_points_and_preserves_evidence_ids():
    points = np.ones((1, 2, 4, 4, 3), dtype=float)
    points[0, 0, 0, 0, 0] = np.nan
    confidence = np.ones((1, 2, 4, 4))
    images = np.ones((2, 3, 4, 4)) * 0.5
    rows = [
        {
            "id": "a",
            "captured_at": 10,
            "objects": json.dumps([{"label": "wallet", "bbox": [0.1, 0.1, 0.8, 0.8]}]),
        },
        {"id": "b", "captured_at": 20, "objects": "[]"},
    ]
    scene = module.scene_from_predictions(points, confidence, images, rows, max_points=10)
    assert scene["available"] and len(scene["points"]) == 10
    assert scene["markers"][0]["id"] == "a"
    assert scene["frames"][1]["captured_at"] == 20
    json.dumps(scene, allow_nan=False)
