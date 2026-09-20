import importlib.util
import json
from pathlib import Path

from rewind.config import Settings
from rewind.models import RuleDecision

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("evaluate_rule_gate", ROOT / "scripts/evaluate_rule_gate.py")
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


async def test_frozen_rule_benchmark_scores_labels_without_sending_them_to_model(tmp_path, monkeypatch):
    class Provider:
        usage = None

        def __init__(self, settings):
            pass

        async def embed(self, text):
            return [0, 1] if "chair" in text else [1, 0]

        async def structured(self, system, content, schema, **kwargs):
            packet = json.loads(content)
            assert "expected" not in content and "category" not in content
            return RuleDecision(
                triggered="stove" in packet["observations"][0]["summary"], explanation="Mock inference"
            )

        def record_avoided(self, *args, **kwargs):
            pass

        async def close(self):
            pass

    monkeypatch.setattr(benchmark, "Provider", Provider)
    plan = {
        "pairs": [
            {
                "id": "positive",
                "rule": "Alert if stove is on",
                "summary": "The stove is ON.",
                "tags": ["stove"],
                "expected": True,
            },
            {
                "id": "negative",
                "rule": "Alert if stove is on",
                "summary": "A chair.",
                "tags": ["chair"],
                "expected": False,
            },
        ]
    }
    base = Settings(_env_file=None, data_dir=tmp_path)
    baseline = await benchmark.run_variant(base, tmp_path / "R0", "R0", plan)
    gated = await benchmark.run_variant(base, tmp_path / "R7", "R7", plan)
    assert baseline["model_calls"] == 2 and gated["model_calls"] == 1
    assert baseline["correct"] == gated["correct"] == 2
    assert gated["true_trigger_recall"] == 1 and gated["false_alerts"] == 0
    assert gated["false_negatives"] == 0
    assert gated["gate_decisions"][-1]["decision"] == "skip"
