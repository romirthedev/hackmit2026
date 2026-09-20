"""Measured runtime usage, with explicit unknowns and separately labeled estimates.

No prompt, response, credential or raw recording is stored in this ledger.
Durations are service/request times, not GPU utilization or an actual cloud bill.
"""

import json
import math
import time
import uuid


def number(value):
    return (
        value
        if isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
        else None
    )


def runtime_usage(backend, raw):
    if backend == "ollama":
        result = {
            "prompt_tokens": number(raw.get("prompt_eval_count")),
            "completion_tokens": number(raw.get("eval_count")),
        }
        for target, source in (
            ("prompt_ms", "prompt_eval_duration"),
            ("eval_ms", "eval_duration"),
            ("total_ms", "total_duration"),
            ("load_ms", "load_duration"),
        ):
            value = number(raw.get(source))
            result[target] = value / 1e6 if value is not None else None
        result["cache_hit_tokens"] = None  # Ollama's count does not establish a cache hit.
        return result
    usage = raw.get("usage") or {}
    timings = raw.get("timings") or {}
    result = {
        "prompt_tokens": number(usage.get("prompt_tokens", usage.get("input_tokens"))),
        "completion_tokens": number(usage.get("completion_tokens", usage.get("output_tokens"))),
        "cache_hit_tokens": number(
            (usage.get("prompt_tokens_details") or usage.get("input_tokens_details") or {}).get(
                "cached_tokens", timings.get("cache_n")
            )
        ),
        "prompt_ms": number(timings.get("prompt_ms")),
        "eval_ms": number(timings.get("predicted_ms")),
        "evaluated_prompt_tokens": number(timings.get("prompt_n")),
    }
    if result["prompt_ms"] is not None and result["eval_ms"] is not None:
        result["total_ms"] = result["prompt_ms"] + result["eval_ms"]
    return result


class UsageLedger:
    def __init__(self, db, settings):
        self.db, self.s = db, settings
        with db.connect() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS usage (
                    id TEXT PRIMARY KEY, created_at REAL NOT NULL,
                    stage TEXT NOT NULL, backend TEXT NOT NULL, model TEXT NOT NULL,
                    status TEXT NOT NULL, variant TEXT NOT NULL, media_id TEXT,
                    prompt_tokens INTEGER, completion_tokens INTEGER, cache_hit_tokens INTEGER,
                    prompt_ms REAL, eval_ms REAL, total_ms REAL, wall_ms REAL,
                    estimated_prompt_tokens REAL, estimated_completion_tokens REAL,
                    compressor TEXT, metadata TEXT NOT NULL DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS usage_time ON usage(created_at);
                CREATE INDEX IF NOT EXISTS usage_media ON usage(media_id,stage);
            """)

    def record(self, event):
        if not self.s.usage_ledger:
            return
        values = {
            "id": event.get("id") or str(uuid.uuid4()),
            "created_at": event.get("created_at", time.time()),
            "stage": str(event.get("stage", "unknown"))[:64],
            "backend": str(event.get("backend", "unknown"))[:64],
            "model": str(event.get("model", "unknown"))[:200],
            "status": str(event.get("status", "success"))[:32],
            "variant": self.s.usage_variant,
            "media_id": event.get("media_id"),
            **{
                key: number(event.get(key))
                for key in (
                    "prompt_tokens",
                    "completion_tokens",
                    "cache_hit_tokens",
                    "prompt_ms",
                    "eval_ms",
                    "total_ms",
                    "wall_ms",
                    "estimated_prompt_tokens",
                    "estimated_completion_tokens",
                )
            },
            "compressor": event.get("compressor"),
            "metadata": json.dumps(event.get("metadata") or {}, separators=(",", ":")),
        }
        self.db.execute(
            "INSERT INTO usage(" + ",".join(values) + ") VALUES(" + ",".join("?" for _ in values) + ")",
            tuple(values.values()),
        )

    def avoided(self, stage, media_id, reason, metadata=None):
        if not self.s.usage_ledger:
            return
        metadata = dict(metadata or {})
        reference = metadata.get("inherited_from")
        baseline = self.db.one(
            "SELECT id,prompt_tokens,completion_tokens FROM usage WHERE stage=? AND status='success' "
            "AND prompt_tokens IS NOT NULL AND completion_tokens IS NOT NULL "
            + ("AND media_id=? " if reference else "")
            + "ORDER BY created_at DESC LIMIT 1",
            (stage, reference) if reference else (stage,),
        )
        self.record(
            {
                "stage": stage,
                "media_id": media_id,
                "status": "avoided",
                "backend": "gate",
                "model": self.s.vision_model if stage == "observe" else self.s.reasoning_model,
                "estimated_prompt_tokens": baseline["prompt_tokens"] if baseline else None,
                "estimated_completion_tokens": baseline["completion_tokens"] if baseline else None,
                "metadata": {
                    **metadata,
                    "reason": reason,
                    "estimate_basis": "measured prior call, not a counterfactual execution"
                    if baseline
                    else "unavailable",
                    "baseline_usage_id": baseline["id"] if baseline else None,
                },
            }
        )

    @staticmethod
    def aggregate(rows):
        # Vendor compressor input/output measures compression, not generative tokens.
        model = [
            r
            for r in rows
            if r["stage"] in ("observe", "recall", "plan", "rule", "verify", "route", "audio_summary")
            and r["status"] != "avoided"
        ]
        measured = [r for r in model if r["prompt_tokens"] is not None and r["completion_tokens"] is not None]
        avoided = [r for r in rows if r["status"] == "avoided"]
        estimates = [
            r
            for r in avoided
            if r["estimated_prompt_tokens"] is not None and r["estimated_completion_tokens"] is not None
        ]
        prompt = sum(r["prompt_tokens"] for r in measured)
        completion = sum(r["completion_tokens"] for r in measured)
        est_prompt = sum(r["estimated_prompt_tokens"] for r in estimates)
        est_completion = sum(r["estimated_completion_tokens"] for r in estimates)
        unmetered = len(model) - len(measured)
        unestimated = len(avoided) - len(estimates)
        timed = [r for r in model if r["total_ms"] is not None]
        cached = [r for r in measured if r["cache_hit_tokens"] is not None]
        return {
            "calls": len(rows),
            "model_calls": len(model),
            "avoided_calls": len(avoided),
            "prompt_tokens": prompt if measured or not model else None,
            "completion_tokens": completion if measured or not model else None,
            "total_tokens": prompt + completion if measured or not model else None,
            "unmetered_calls": unmetered,
            "cache_hit_tokens": sum(r["cache_hit_tokens"] for r in cached) if cached or not model else None,
            "cache_unmetered_calls": sum(r["cache_hit_tokens"] is None for r in measured),
            "inference_seconds": sum(r["total_ms"] for r in timed) / 1000 if timed or not model else None,
            "timing_unmetered_calls": sum(r["total_ms"] is None for r in model),
            "estimated_tokens_avoided": est_prompt + est_completion if estimates or not avoided else None,
            "estimated_prompt_tokens_avoided": est_prompt if estimates or not avoided else None,
            "estimated_completion_tokens_avoided": est_completion if estimates or not avoided else None,
            "unestimated_avoided_calls": unestimated,
            "estimated_naive_tokens": None
            if unmetered or unestimated
            else prompt + completion + est_prompt + est_completion,
        }

    def summary(self, since=0):
        rows = self.db.all("SELECT * FROM usage WHERE created_at>=? ORDER BY created_at", (since,))
        totals = self.aggregate(rows)
        prices = {
            "input_per_million_usd": self.s.usage_input_per_million_usd,
            "cached_input_per_million_usd": self.s.usage_cached_input_per_million_usd,
            "output_per_million_usd": self.s.usage_output_per_million_usd,
            "reference_model": "gpt-4.1-mini",
            "source": "https://developers.openai.com/api/docs/models/gpt-4.1-mini",
            "basis": "Illustrative cloud-equivalent using runtime token counts, not actual billing. Different tokenizers and image accounting can differ. Unknown cache use priced at uncached rate.",
        }
        prompt = totals["prompt_tokens"] or 0
        completion = totals["completion_tokens"] or 0
        cached = min(prompt, totals["cache_hit_tokens"] or 0)
        metered = (
            (prompt - cached) * prices["input_per_million_usd"]
            + cached * prices["cached_input_per_million_usd"]
            + completion * prices["output_per_million_usd"]
        ) / 1e6
        avoided = (
            (totals["estimated_prompt_tokens_avoided"] or 0) * prices["input_per_million_usd"]
            + (totals["estimated_completion_tokens_avoided"] or 0) * prices["output_per_million_usd"]
        ) / 1e6
        actual = None if totals["unmetered_calls"] else metered
        avoided = None if totals["unestimated_avoided_calls"] else avoided
        columns = {row["name"] for row in self.db.all("PRAGMA table_info(events)")}
        frames = (
            self.db.all(
                "SELECT m.id AS media_id,m.captured_at,e.label_mode,e.inherited_from,e.visual_similarity,e.block_delta FROM media m JOIN events e ON m.id=e.id WHERE m.kind='frame' ORDER BY m.captured_at DESC LIMIT 10"
            )
            if "label_mode" in columns
            else []
        )
        return {
            "enabled": self.s.usage_ledger,
            "since": since,
            "totals": totals,
            "by_stage": [
                {"stage": key, **self.aggregate([r for r in rows if r["stage"] == key])}
                for key in sorted({r["stage"] for r in rows})
            ],
            "by_variant": [
                {"variant": key, **self.aggregate([r for r in rows if r["variant"] == key])}
                for key in sorted({r["variant"] for r in rows})
            ],
            "pricing": prices,
            "cloud_equivalent": {
                "actual_usd": actual,
                "metered_usd": metered if totals["total_tokens"] is not None else None,
                "estimated_avoided_usd": avoided,
                "estimated_naive_usd": actual + avoided
                if actual is not None and avoided is not None
                else None,
                "incomplete": bool(totals["unmetered_calls"] or totals["unestimated_avoided_calls"]),
            },
            "compressor": [
                dict(r, metadata=json.loads(r["metadata"]))
                for r in rows
                if r["stage"] in ("compress", "compressor")
            ][-100:],
            "recent_frames": frames,
            "measurement_notes": [
                "Token totals cover metered calls only; missing counts are explicitly reported.",
                "inference_seconds sums service time across possibly parallel calls; it is not GPU busy time or elapsed benchmark time.",
                "Avoided tokens are estimates from a prior measured call; paired benchmark totals establish actual savings.",
            ],
        }
