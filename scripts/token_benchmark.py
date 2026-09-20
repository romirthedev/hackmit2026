#!/usr/bin/env python3
"""Run an immutable, sequential token benchmark or report already completed runs.

R0 must complete first. Original media, raw answers, and grading sheets stay under
ignored data/. Missing token counts and ungraded answers remain unknown, not zero.
"""

import argparse
import hashlib
import json
import os
import random
import re
import statistics
import subprocess
import sys
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
VARIANTS = {
    "R0": [],
    "R1": ["--change-gate"],
    "R2": ["--recall-packet-compact"],
    "R3": ["--recall-packet-compact", "--compressor", "bear2", "--compressor-aggressiveness", "0.1"],
    "R4": ["--recall-packet-compact", "--compressor", "bear2", "--compressor-aggressiveness", "0.2"],
    "R5": ["--dense-captions", "--skip-recall"],
    "R6-448": ["--labeler-long-side", "448", "--skip-recall"],
    "R6-640": ["--labeler-long-side", "640", "--skip-recall"],
    "R7": ["--rule-gate"],
    "R8": ["--cache-prompt", "--skip-recall"],
    # R9 is explicit, fixed before runs; do not optimize on scored answers silently.
    "R9": ["--change-gate", "--recall-packet-compact", "--cache-prompt"],
    "R10-llmlingua": ["--recall-packet-compact", "--compressor", "llmlingua", "--llmlingua-rate", "0.8"],
}


def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def compressor_execution(events, expected):
    if expected not in ("bear2", "llmlingua"):
        return {"state": "not_requested", "successes": 0, "fallbacks": 0}
    calls = [
        event for event in events if event.get("stage") == "compress" and event.get("compressor") == expected
    ]
    successes = sum(event.get("status") == "success" for event in calls)
    fallbacks = sum(event.get("status") != "success" for event in calls)
    return {
        "compressor": expected,
        "state": "applied"
        if successes and not fallbacks
        else "mixed_fallback"
        if successes
        else "not_executed_or_all_fallback",
        "successes": successes,
        "fallbacks": fallbacks,
        "tokens_removed_compressor_tokenizer": sum(
            (event.get("metadata") or {}).get("tokens_saved") or 0
            for event in calls
            if event.get("status") == "success"
        ),
        "note": "Compressor tokenizer counts are separate from measured downstream model-token savings; LLMLingua is not a bear-2 trial.",
    }


def percentile(values, p):
    if not values:
        return None
    values = sorted(values)
    index = (len(values) - 1) * p
    low = int(index)
    return values[low] + (values[min(low + 1, len(values) - 1)] - values[low]) * (index - low)


def paired_bootstrap(control, treatment, samples=10000):
    """Paired question resampling, explicitly not independent-clip uncertainty."""
    keys = sorted(control.keys() & treatment.keys())
    differences = [float(treatment[key]) - float(control[key]) for key in keys]
    if not differences:
        return {"n": 0, "difference": None, "ci95": None}
    rng = random.Random(20260919)
    means = [statistics.mean(rng.choices(differences, k=len(differences))) for _ in range(samples)]
    return {
        "n": len(keys),
        "difference": statistics.mean(differences),
        "ci95": [percentile(means, 0.025), percentile(means, 0.975)],
        "unit": "questions; correlated questions from very few clips, not population generalization",
    }


def object_recall(clip, observations, start):
    frames = [event for event in observations if event["kind"] == "frame"]
    checks = []
    for keyframe in clip["keyframes"]:
        candidate = min(
            frames,
            key=lambda event: abs(event["captured_at"] - start - keyframe["offset_seconds"]),
            default=None,
        )
        if candidate is None or abs(candidate["captured_at"] - start - keyframe["offset_seconds"]) > 0.15:
            candidate = None
        text = " ".join(
            str((candidate or {}).get(key, "")) for key in ("summary", "objects", "tags")
        ).casefold()
        for label, synonyms in keyframe["objects"].items():
            present = any(
                re.search(r"\b" + re.escape(term.casefold()) + r"(?:s)?\b", text) for term in synonyms
            )
            checks.append(
                {
                    "offset_seconds": keyframe["offset_seconds"],
                    "object": label,
                    "found": present,
                    "event_id": candidate["id"] if candidate else None,
                    "label_mode": (candidate or {}).get("label_mode"),
                }
            )
    return {
        "matched": sum(check["found"] for check in checks),
        "total": len(checks),
        "checks": checks,
        "method": "Frozen synonym string proxy on summary/tags/objects; does not measure hallucination precision.",
    }


def valid_grades(run, manifest_hash, answer_hash):
    grading = read(run / "grading.json", {})
    if grading.get("manifest_sha256") != manifest_hash or grading.get("answers_sha256") != answer_hash:
        return {}
    if grading.get("reviewer_kind") not in ("human", "agent"):
        return {}
    return {item["id"]: item for item in grading.get("questions", []) if isinstance(item.get("pass"), bool)}


def append_run_error(output, error):
    """Keep failures from earlier invocations when independently resuming a matrix."""
    path = output / "run-errors.json"
    errors = read(path, [])
    errors.append(error)
    path.write_text(json.dumps(errors, indent=2) + "\n")


def token_comparison(row, baseline):
    """Compare identical stages; incomplete or unmetered runs cannot claim savings."""
    baseline = baseline or {}
    if row["scope"].startswith("recall"):
        tokens, comparison = row["recall_tokens"], baseline.get("recall_tokens")
    elif row["scope"] == "frames_only":
        tokens, comparison = row["observe_tokens"], baseline.get("observe_tokens")
    else:
        usage, baseline_usage = row["usage"], baseline.get("usage", {})
        tokens = None if usage.get("unmetered_calls", 0) else usage.get("total_tokens")
        comparison = None if baseline_usage.get("unmetered_calls", 0) else baseline_usage.get("total_tokens")
    savings = (
        comparison - tokens
        if tokens is not None
        and comparison is not None
        and not row.get("failures")
        and not baseline.get("failures")
        else None
    )
    return tokens, savings


def report(manifest, manifest_hash, output):
    rows = []
    all_grades = {}
    for variant_path in sorted(output.iterdir()):
        if not variant_path.is_dir() or variant_path.name not in VARIANTS:
            continue
        for clip in manifest["clips"]:
            run = variant_path / clip["id"]
            environment = read(run / "environment.json")
            usage = read(run / "usage-summary.json")
            if environment is None or usage is None:
                continue
            answers = read(run / "answers.json", {"results": []})
            answer_hash = sha(run / "answers.json") if (run / "answers.json").exists() else None
            grades = valid_grades(run, manifest_hash, answer_hash)
            all_grades[(variant_path.name, clip["id"])] = grades
            if answer_hash and not (run / "grading-template.json").exists():
                template = {
                    "manifest_sha256": manifest_hash,
                    "answers_sha256": answer_hash,
                    "reviewer_kind": None,
                    "reviewer": None,
                    "instructions": "Review originals against frozen criteria; never infer factual accuracy from self-confidence or citations resolving. Save as grading.json with human/agent label.",
                    "questions": [
                        {
                            **question,
                            "pass": None,
                            "citation_relevant": None,
                            "abstention_correct": None,
                            "all_material_claims_supported": None,
                            "source_review_notes": "",
                        }
                        for question in clip["questions"]
                    ],
                }
                (run / "grading-template.json").write_text(json.dumps(template, indent=2) + "\n")
            objects = object_recall(clip, read(run / "observations.json", []), environment["timeline_start"])
            ingest = read(run / "ingest-metrics.json", {})
            latency = [item["seconds"] for item in answers["results"]]
            totals = usage["totals"]
            # Recall-only runs must compare recall stages, never call free reused ingestion a saving.
            recall_stages = [
                stage for stage in usage["by_stage"] if stage["stage"] in ("recall", "plan", "verify")
            ]
            recall_known = all(
                stage.get("total_tokens") is not None and not stage.get("unmetered_calls", 0)
                for stage in recall_stages
            )
            recall_tokens = (
                sum(stage["total_tokens"] for stage in recall_stages)
                if recall_stages and recall_known
                else None
            )
            observe = next((stage for stage in usage["by_stage"] if stage["stage"] == "observe"), {})
            observe_tokens = observe.get("total_tokens") if not observe.get("unmetered_calls", 0) else None
            observe_rows = [
                event
                for event in read(run / "usage.json", [])
                if event.get("stage") == "observe" and event.get("status") == "success"
            ]
            prompt_times = [
                event["prompt_ms"] for event in observe_rows if event.get("prompt_ms") is not None
            ]
            questions = answers["results"]
            rows.append(
                {
                    "variant": variant_path.name,
                    "clip": clip["id"],
                    "cohort": clip["cohort"],
                    "scope": "recall_only_reused_captions"
                    if environment.get("reuse_ingest")
                    else "frames_only"
                    if environment.get("skip_recall")
                    else "full_pipeline",
                    "accuracy": {
                        "passed": sum(item["pass"] for item in grades.values()),
                        "graded": len(grades),
                        "questions": len(clip["questions"]),
                        "grade_label": read(run / "grading.json", {}).get("reviewer_kind"),
                    },
                    "objects": objects,
                    "usage": totals,
                    "compression": compressor_execution(
                        usage.get("compressor", []), environment["flags"].get("compressor")
                    ),
                    "recall_tokens": recall_tokens,
                    "observe_tokens": observe_tokens,
                    "observe_model_calls": observe.get("model_calls"),
                    "observe_avoided_calls": observe.get("avoided_calls"),
                    "observe_prefill_ms_mean": statistics.mean(prompt_times) if prompt_times else None,
                    "observe_prefill_ms_sum": sum(prompt_times) if prompt_times else None,
                    "observe_cached_tokens": observe.get("cache_hit_tokens"),
                    "observe_cache_unmetered_calls": observe.get("cache_unmetered_calls"),
                    "cloud_equivalent": usage.get("cloud_equivalent"),
                    "pricing": usage.get("pricing"),
                    "latency_seconds": {"p50": percentile(latency, 0.5), "p95": percentile(latency, 0.95)},
                    "workers": environment.get("workers"),
                    "paced_frame_replay": environment.get("paced_frame_replay", False),
                    "ingest_seconds": None if environment.get("reuse_ingest") else ingest.get("seconds"),
                    "capture_to_result_seconds": ingest.get("capture_to_result_seconds"),
                    "upload_seconds": ingest.get("upload_seconds"),
                    "post_upload_drain_seconds": ingest.get("post_upload_drain_seconds"),
                    "pending_at_first_post_upload_poll": ingest.get("pending_at_first_post_upload_poll"),
                    "frames_per_minute": None
                    if environment.get("reuse_ingest")
                    else ingest.get("frames_per_minute"),
                    "upload_to_event_p95": None
                    if environment.get("reuse_ingest")
                    else percentile(ingest.get("upload_to_event_seconds", []), 0.95),
                    "upload_to_event_p50": None
                    if environment.get("reuse_ingest")
                    else percentile(ingest.get("upload_to_event_seconds", []), 0.5),
                    "structural_citations": {
                        "resolve": sum(
                            bool(q.get("checks", {}).get("inline_citations_resolve")) for q in questions
                        ),
                        "answers": len(questions),
                        "note": "Resolution is not source relevance or factual accuracy.",
                    },
                    "failures": ingest.get("status", {}).get("failed"),
                    "citation_relevance": {
                        "valid": sum(item.get("citation_relevant") is True for item in grades.values()),
                        "reviewed": sum(
                            isinstance(item.get("citation_relevant"), bool) for item in grades.values()
                        ),
                    },
                    "abstention": {
                        "correct": sum(
                            item.get("abstention_correct") is True
                            for item in grades.values()
                            if item.get("unanswerable")
                        ),
                        "reviewed": sum(
                            isinstance(item.get("abstention_correct"), bool)
                            for item in grades.values()
                            if item.get("unanswerable")
                        ),
                    },
                    "whole_answer_faithfulness": {
                        "supported": sum(
                            item.get("all_material_claims_supported") is True for item in grades.values()
                        )
                        if any(
                            isinstance(item.get("all_material_claims_supported"), bool)
                            for item in grades.values()
                        )
                        else None,
                        "reviewed": sum(
                            isinstance(item.get("all_material_claims_supported"), bool)
                            for item in grades.values()
                        ),
                        "rubric": "Exploratory after baseline; all factual claims, including unsolicited details, must be supported. Separate from frozen-criterion pass.",
                    },
                }
            )
    intervals = []
    for variant in VARIANTS:
        if variant == "R0":
            continue
        for cohort in sorted({clip["cohort"] for clip in manifest["clips"]}):
            baseline, tested = {}, {}
            for clip in manifest["clips"]:
                if clip["cohort"] != cohort:
                    continue
                baseline.update(
                    {key: value["pass"] for key, value in all_grades.get(("R0", clip["id"]), {}).items()}
                )
                tested.update(
                    {key: value["pass"] for key, value in all_grades.get((variant, clip["id"]), {}).items()}
                )
            if tested:
                intervals.append(
                    {
                        "variant": variant,
                        "cohort": cohort,
                        "metric": "frozen_criterion_pass",
                        **paired_bootstrap(baseline, tested),
                    }
                )
            baseline_faithful, tested_faithful = {}, {}
            for clip in manifest["clips"]:
                if clip["cohort"] != cohort:
                    continue
                baseline_faithful.update(
                    {
                        key: value["all_material_claims_supported"]
                        for key, value in all_grades.get(("R0", clip["id"]), {}).items()
                        if isinstance(value.get("all_material_claims_supported"), bool)
                    }
                )
                tested_faithful.update(
                    {
                        key: value["all_material_claims_supported"]
                        for key, value in all_grades.get((variant, clip["id"]), {}).items()
                        if isinstance(value.get("all_material_claims_supported"), bool)
                    }
                )
            if tested_faithful:
                intervals.append(
                    {
                        "variant": variant,
                        "cohort": cohort,
                        "metric": "whole_answer_faithfulness_exploratory",
                        **paired_bootstrap(baseline_faithful, tested_faithful),
                    }
                )
    not_executed = read(output / "not-executed.json", [])
    conditions_path = output / "conditions.jsonl"
    conditions = (
        [json.loads(line) for line in conditions_path.read_text().splitlines() if line.strip()]
        if conditions_path.exists()
        else []
    )
    result = {
        "manifest_sha256": manifest_hash,
        "rows": rows,
        "paired_question_bootstrap": intervals,
        "limitations": manifest["limitations"],
        "not_executed": not_executed,
        "run_conditions": conditions,
        "run_errors": read(output / "run-errors.json", []),
    }
    (output / "report.json").write_text(json.dumps(result, indent=2) + "\n")
    lines = [
        "# Measured token benchmark",
        "",
        "Short real clips and synthetic stress are separate cohorts. Accuracy stays ungraded until source review; unknown token counts are not zero. Cloud equivalents are illustrative, not an invoice.",
        "",
        "Runtime conditions: "
        + (
            "Runtime changes and possible external workload are logged. All calls are retained; see report.json run_conditions for actual overlap audits and qualifications."
            if conditions
            else "No external-workload condition has been recorded; absence of a log is not a hardware-isolation guarantee."
        ),
        "",
        "| Configuration / clip | Cohort / scope | Frozen-criterion pass | Whole-answer faithful (exploratory) | Object-string matches | Tokens used | Tokens saved vs R0 | Question p50 / p95 |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]

    def number(value):
        return "unknown" if value is None else f"{value:,.0f}"

    def decimal(value):
        return "unknown" if value is None else f"{value:,.2f}"

    for row in rows:
        baseline = next(
            (item for item in rows if item["variant"] == "R0" and item["clip"] == row["clip"]), None
        )
        tokens, saving = token_comparison(row, baseline)
        accuracy = row["accuracy"]
        label = (
            f"{accuracy['passed']}/{accuracy['graded']} ({accuracy['grade_label']})"
            if accuracy["graded"]
            else "ungraded"
        )
        lat = row["latency_seconds"]
        faithful = row["whole_answer_faithfulness"]
        faith_label = (
            f"{faithful['supported']}/{faithful['reviewed']} reviewed" if faithful["reviewed"] else "ungraded"
        )
        lines.append(
            f"| {row['variant']} / {row['clip']} | {row['cohort']} / {row['scope']} | {label} | {faith_label} | {row['objects']['matched']}/{row['objects']['total']} | {number(tokens)} | {number(saving)} | {decimal(lat['p50'])} / {decimal(lat['p95'])} s |"
        )
    lines += [
        "",
        "Frame-only rows compare the observe stage with R0 observe, not the whole pipeline. Recall-only rows compare recall+plan+verify with R0's same stages; previously paid ingestion is not counted as a saving.",
        "Full-pipeline means ingestion plus raw Qwen recall in the default matrix; it does not include production Codex verification. Capture-to-result is unknown for imported synthetic timestamps; upload-to-event is a distinct measured delay.",
        "Whole-answer faithfulness is an additional exploratory rubric introduced after baseline inspection. It does not replace the frozen score, and unknown reviews are not failures or passes.",
        "",
        "| Configuration / clip | Observe calls / avoided | Frames/min | Upload-to-event p95 | Cached tokens | Mean prefill ms | Citation relevance | Correct abstention |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
        *[
            f"| {row['variant']} / {row['clip']} | {number(row['observe_model_calls'])} / {number(row['observe_avoided_calls'])} | {decimal(row['frames_per_minute'])} | {decimal(row['upload_to_event_p95'])} s | {number(row['observe_cached_tokens'])} | {decimal(row['observe_prefill_ms_mean'])} | {row['citation_relevance']['valid']}/{row['citation_relevance']['reviewed']} reviewed | {row['abstention']['correct']}/{row['abstention']['reviewed']} reviewed |"
            for row in rows
        ],
        "",
        "Each row's configured input/output/cache token rates and cloud-equivalent dollars are preserved in report.json. These are illustrative cloud equivalents, not local billing. Codex subscription usage has no inferred dollar invoice. `inference_seconds` sums request durations and is not measured GPU occupancy.",
        "",
        "Paired 95% bootstrap intervals (10,000 resamples, seeded; questions within clips are correlated):",
        "",
        "```json",
        json.dumps(intervals, indent=2),
        "```",
        "",
        "Unexecuted variants and compression status:",
        "",
        "```json",
        json.dumps(
            {
                "not_executed": not_executed,
                "compression": [
                    {"variant": row["variant"], "clip": row["clip"], **row["compression"]}
                    for row in rows
                    if row["compression"]["state"] != "not_requested"
                ],
            },
            indent=2,
        ),
        "```",
        "",
        *["- " + limitation for limitation in manifest["limitations"]],
    ]
    (output / "report.md").write_text("\n".join(lines) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "docs/evaluations/token-savings-frozen.json")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--run", nargs="+", choices=VARIANTS)
    parser.add_argument("--clips", nargs="+")
    parser.add_argument("--processing-env", type=Path)
    parser.add_argument("--model", default="qwen3.5:35b-a3b-q4_K_M")
    parser.add_argument("--api", choices=["ollama", "llamacpp"], default="llamacpp")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11436")
    parser.add_argument("--embedding-url", default="http://127.0.0.1:11434")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--workers", type=int, choices=range(1, 9), default=1)
    parser.add_argument(
        "--pace", action="store_true", help="Separate paced frame replay; do not mix with bulk runs"
    )
    args = parser.parse_args()
    manifest = read(args.manifest)
    manifest_hash = sha(args.manifest)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    frozen = output / "manifest.json"
    if frozen.exists() and sha(frozen) != manifest_hash:
        parser.error("This output belongs to a different frozen manifest")
    if not frozen.exists():
        frozen.write_bytes(args.manifest.read_bytes())
    clips = [clip for clip in manifest["clips"] if not args.clips or clip["id"] in args.clips]
    if not clips:
        parser.error("No matching clips")
    run_errors = []
    for variant in args.run or []:
        if variant in ("R3", "R4") and not (
            os.environ.get("REWIND_TTC_API_KEY") or dotenv_values(ROOT / ".env").get("REWIND_TTC_API_KEY")
        ):
            skipped = read(output / "not-executed.json", [])
            if not any(item["variant"] == variant for item in skipped):
                skipped.append(
                    {"variant": variant, "reason": "missing_ttc_api_key", "inference_started": False}
                )
                (output / "not-executed.json").write_text(json.dumps(skipped, indent=2) + "\n")
            print(
                json.dumps({"variant": variant, "status": "not_executed", "reason": "missing_ttc_api_key"}),
                flush=True,
            )
            continue
        if variant == "R7":
            parser.error(
                "R7 requires the separate frozen rule/observation-pair harness; this corpus has no rules"
            )
        for clip in clips:
            source = ROOT / clip["path"]
            if sha(source) != clip["sha256"]:
                parser.error(f"Source hash changed: {clip['id']}")
            baseline = output / "R0" / clip["id"]
            if variant != "R0" and not read(baseline / "completion.json", {}).get("pipeline_completed"):
                parser.error(f"R0 must finish first for {clip['id']}")
            run = output / variant / clip["id"]
            if run.exists():
                parser.error(f"Run already exists and will not be overwritten: {run}")
            plan = output / (clip["id"] + "-plan.json")
            if not plan.exists():
                plan.write_text(json.dumps({"questions": clip["questions"]}, indent=2) + "\n")
            command = [
                sys.executable,
                str(ROOT / "scripts/evaluate_video.py"),
                str(source),
                str(plan),
                "--output",
                str(run),
                "--model",
                args.model,
                "--api",
                args.api,
                "--ollama-url",
                args.ollama_url,
                "--embedding-url",
                args.embedding_url,
                "--workers",
                str(args.workers),
                "--context",
                "32768",
                "--recall-images",
                "8",
                "--variant",
                variant,
                "--manifest-sha256",
                manifest_hash,
                "--timeline-start",
                str(manifest["frozen_at_unix"] - 1000),
                "--verify" if args.verify else "--no-verify",
                *VARIANTS[variant],
                *(["--pace"] if args.pace else []),
            ]
            if args.processing_env:
                command += ["--processing-env", str(args.processing_env)]
            if variant in ("R2", "R3", "R4", "R10-llmlingua"):
                command += ["--reuse-ingest", str(baseline)]
            try:
                subprocess.run(command, cwd=ROOT, check=True)
            except subprocess.CalledProcessError as error:
                run_errors.append(
                    {
                        "variant": variant,
                        "clip": clip["id"],
                        "exit_code": error.returncode,
                        "artifacts": str(run),
                    }
                )
                append_run_error(output, run_errors[-1])
                report(manifest, manifest_hash, output)
                if variant == "R0":
                    raise
                if variant == "R5":
                    # Preserve this predeclared cap; do not silently tune after a failed dense run.
                    break
                continue
            report(manifest, manifest_hash, output)
    report(manifest, manifest_hash, output)
    if run_errors:
        raise SystemExit("Some variants failed; remaining independent runs completed. See run-errors.json.")


if __name__ == "__main__":
    main()
