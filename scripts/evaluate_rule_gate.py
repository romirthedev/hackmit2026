#!/usr/bin/env python3
"""Frozen text-fixture R0/R7 probe against the configured real model.

No live warnings, production DB writes, visual-ground-truth claims, or generated
fixture labels. Run only after the main ASUS benchmark is idle.
"""

import argparse
import asyncio
import hashlib
import json
import time
from pathlib import Path

import numpy as np
from rewind.config import Settings
from rewind.db import Database
from rewind.gating import RuleGate
from rewind.models import RuleDecision
from rewind.prompt_packets import format_rule_packet
from rewind.providers import Provider
from rewind.worker import RULE_PROMPT


async def run_variant(base, directory, variant, plan):
    directory.mkdir(parents=True, mode=0o700)
    settings = base.model_copy(
        update={
            "data_dir": directory,
            "usage_ledger": True,
            "usage_variant": variant,
            "rule_gate": variant == "R7",
            "recall_packet_compact": False,
            "compressor": "none",
            "cache_prompt": False,
            "embeddings": True,
        }
    )
    db = Database(directory)
    provider = Provider(settings)
    gate = RuleGate(db, provider, settings)
    results = []
    try:
        for index, pair in enumerate(plan["pairs"]):
            identifier = f"synthetic-rule-{index}"
            now = time.time()
            captured_at = 1700000000.0 + index  # Identical synthetic clock in both packets.
            payload = json.dumps(pair, sort_keys=True).encode()
            source = directory / (identifier + ".json")
            source.write_bytes(payload)
            # This intentionally uses an explicit synthetic kind, not fake image
            # or audio metadata. The actual observation is the frozen text above.
            db.execute(
                """INSERT INTO media(id,device,boot,seq,kind,captured_at,received_at,clock_quality,
                sha256,path,bytes,mime,status,provenance) VALUES(?,?,?,?,'synthetic-rule-observation',?,?,'synthetic',?,?,?,'application/json','done',?)""",
                (
                    identifier,
                    "rule-benchmark",
                    variant,
                    index,
                    captured_at,
                    now,
                    hashlib.sha256(payload).hexdigest(),
                    str(source),
                    len(payload),
                    json.dumps({"fixture_id": pair["id"], "text_only": True}),
                ),
            )
            started = time.monotonic()
            vector = await provider.embed(pair["summary"] + " " + " ".join(pair["tags"]))
            event = {
                "id": identifier,
                "summary": pair["summary"],
                "transcript": "",
                "captured_at": captured_at,
                "objects": "[]",
                "tags": pair["tags"],
                "label_mode": "described",
                "inherited_from": None,
                "visual_similarity": None,
                "block_delta": None,
                "embedding": np.asarray(vector, dtype=np.float32).tobytes() if vector is not None else None,
                "embedding_model": settings.embedding_model if vector is not None else None,
            }
            rule = {"id": hashlib.sha256(pair["rule"].encode()).hexdigest(), "instruction": pair["rule"]}
            evaluate, reason = True, "control"
            if settings.rule_gate:
                evaluate, reason, metadata = await gate.decide({"id": identifier}, event, rule)
                if not evaluate:
                    provider.record_avoided("rule", identifier, reason, metadata)
            if evaluate:
                observation = {
                    key: event[key]
                    for key in (
                        "id",
                        "summary",
                        "transcript",
                        "captured_at",
                        "objects",
                        "label_mode",
                        "inherited_from",
                        "visual_similarity",
                        "block_delta",
                    )
                }
                body = await format_rule_packet(pair["rule"], [observation], settings, provider)
                response = await provider.structured(
                    RULE_PROMPT,
                    body,
                    RuleDecision,
                    stage="rule",
                    media_id=identifier,
                )
                triggered, explanation = response.triggered, response.explanation
            else:
                triggered, explanation = False, "No model call: relevance gate skipped this pair."
            result = {
                "id": pair["id"],
                "expected": pair["expected"],
                "triggered": triggered,
                "correct": triggered == pair["expected"],
                "model_called": evaluate,
                "gate_reason": reason,
                "explanation": explanation,
                "seconds": round(time.monotonic() - started, 3),
            }
            results.append(result)
            (directory / "results.json").write_text(json.dumps(results, indent=2))
            print(json.dumps({"variant": variant, **result}), flush=True)
    finally:
        await provider.close()
    positives = sum(pair["expected"] for pair in plan["pairs"])
    return {
        "variant": variant,
        "pairs": results,
        "model_calls": sum(row["model_called"] for row in results),
        "correct": sum(row["correct"] for row in results),
        "true_trigger_recall": sum(row["triggered"] and row["expected"] for row in results) / positives,
        "false_alerts": sum(row["triggered"] and not row["expected"] for row in results),
        "false_negatives": sum(not row["triggered"] and row["expected"] for row in results),
        "usage": provider.usage.summary() if provider.usage else None,
        "gate_decisions": db.all(
            "SELECT media_id,decision,reason,similarity,metadata FROM gate_decisions ORDER BY created_at"
        ),
    }


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", default="data/phone-demo.env")
    parser.add_argument("--plan", default="docs/evaluations/token-rule-gate-frozen.json")
    parser.add_argument(
        "--output", required=True, help="Fresh private directory; never a production workspace"
    )
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    raw = Path(args.plan).read_bytes()
    plan = json.loads(raw)
    (output / "frozen-plan.json").write_bytes(raw)
    report = {"plan_sha256": hashlib.sha256(raw).hexdigest(), "scope": plan["scope"], "results": []}
    base = Settings(_env_file=args.env)
    for variant in ("R0", "R7"):
        result = await run_variant(base, output / variant, variant, plan)
        report["results"].append(result)
        (output / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
