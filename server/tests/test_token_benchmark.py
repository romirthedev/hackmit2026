"""Reporting integrity: paired samples, unknown measurements, and frozen labels."""

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("token_benchmark", ROOT / "scripts/token_benchmark.py")
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


def test_bootstrap_uses_only_matching_questions_and_keeps_unknown_unknown():
    result = benchmark.paired_bootstrap({"a": True, "b": False}, {"a": False, "c": True})
    assert result["n"] == 1
    assert result["difference"] == -1
    assert result["ci95"] == [-1, -1]
    assert benchmark.paired_bootstrap({}, {})["ci95"] is None


def test_inherited_caption_is_scored_against_current_frame_not_anchor():
    clip = {"keyframes": [{"offset_seconds": 10, "objects": {"square": ["red square"]}}]}
    events = [
        {
            "id": "current",
            "kind": "frame",
            "captured_at": 110,
            "summary": "A blue circle.",
            "label_mode": "inherited",
        }
    ]
    result = benchmark.object_recall(clip, events, 100)
    assert result["total"] == 1
    assert result["matched"] == 0
    assert result["checks"][0]["label_mode"] == "inherited"


def test_grades_cannot_be_reused_for_different_answer_or_manifest(tmp_path):
    grading = {
        "manifest_sha256": "manifest",
        "answers_sha256": "answers",
        "reviewer_kind": "agent",
        "questions": [{"id": "q", "pass": True}],
    }
    (tmp_path / "grading.json").write_text(json.dumps(grading))
    assert benchmark.valid_grades(tmp_path, "manifest", "answers")["q"]["pass"]
    assert benchmark.valid_grades(tmp_path, "manifest", "changed") == {}
    assert benchmark.valid_grades(tmp_path, "changed", "answers") == {}


def test_failed_compressor_cannot_be_reported_as_applied_savings():
    fallback = {
        "stage": "compress",
        "compressor": "bear2",
        "status": "fallback",
        "metadata": {"tokens_saved": 0},
    }
    assert benchmark.compressor_execution([fallback], "bear2")["state"] == "not_executed_or_all_fallback"
    success = {
        "stage": "compress",
        "compressor": "bear2",
        "status": "success",
        "metadata": {"tokens_saved": 10},
    }
    mixed = benchmark.compressor_execution([fallback, success], "bear2")
    assert mixed["state"] == "mixed_fallback"
    assert mixed["tokens_removed_compressor_tokenizer"] == 10
    lingua = {**success, "compressor": "llmlingua"}
    assert benchmark.compressor_execution([lingua], "llmlingua")["state"] == "applied"
    assert benchmark.compressor_execution([lingua], "bear2")["state"] == "not_executed_or_all_fallback"


def test_frozen_manifest_excludes_invalidated_tongs_and_separates_synthetic():
    manifest = json.loads((ROOT / "docs/evaluations/token-savings-frozen.json").read_text())
    real = [clip for clip in manifest["clips"] if clip["cohort"] == "short_real_video"]
    assert sum(len(clip["questions"]) for clip in real) == 11
    daylife = next(clip for clip in real if clip["id"] == "daylife")
    assert daylife["excluded_original_question_indices_zero_based"] == [4]
    assert not any("utensil" in item["question"] for item in daylife["questions"])
    synthetic = next(clip for clip in manifest["clips"] if clip["cohort"] == "synthetic_localized_change")
    assert synthetic["duration_seconds"] >= 30
