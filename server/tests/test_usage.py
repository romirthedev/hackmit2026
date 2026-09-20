import asyncio
import json

import httpx
import pytest
from rewind.config import Settings
from rewind.db import Database
from rewind.models import Observation
from rewind.providers import Provider
from rewind.usage import UsageLedger, runtime_usage


def test_installed_native_and_ollama_units_and_unknowns():
    native = runtime_usage(
        "llamacpp",
        {
            "usage": {
                "prompt_tokens": 118,
                "completion_tokens": 2,
                "prompt_tokens_details": {"cached_tokens": 100},
            },
            "timings": {"cache_n": 100, "prompt_n": 18, "prompt_ms": 54.62, "predicted_ms": 14.658},
        },
    )
    assert native["prompt_tokens"] == 118 and native["cache_hit_tokens"] == 100
    assert native["evaluated_prompt_tokens"] == 18
    assert native["total_ms"] == pytest.approx(69.278)
    ollama = runtime_usage("ollama", {"prompt_eval_count": 12, "eval_count": 8, "total_duration": 4000000})
    assert ollama["total_ms"] == 4 and ollama["cache_hit_tokens"] is None
    assert runtime_usage("llamacpp", {})["prompt_tokens"] is None


def test_ledger_estimates_are_separate_and_compressor_not_counted_as_model_spend(tmp_path):
    s = Settings(_env_file=None, data_dir=tmp_path, usage_ledger=True)
    ledger = UsageLedger(Database(tmp_path), s)
    ledger.record(
        {
            "stage": "observe",
            "media_id": "anchor",
            "prompt_tokens": 100,
            "completion_tokens": 20,
            "cache_hit_tokens": 40,
            "total_ms": 100,
        }
    )
    ledger.avoided("observe", "next", "unchanged", {"inherited_from": "anchor"})
    ledger.record(
        {"stage": "compress", "prompt_tokens": 500, "completion_tokens": 250, "compressor": "bear2"}
    )
    ledger.record({"stage": "packet", "metadata": {"chars": 32}})
    ledger.record({"stage": "recall", "status": "error"})
    result = ledger.summary()
    assert result["totals"]["total_tokens"] == 120
    assert result["totals"]["estimated_tokens_avoided"] == 120
    assert result["totals"]["estimated_naive_tokens"] is None
    assert result["totals"]["unmetered_calls"] == 1
    assert result["totals"]["model_calls"] == 2
    assert result["cloud_equivalent"]["incomplete"]
    assert result["cloud_equivalent"]["actual_usd"] is None
    assert result["cloud_equivalent"]["metered_usd"] > 0
    assert len(result["compressor"]) == 1
    assert ledger.summary(since=9999999999)["totals"]["calls"] == 0


def test_unmetered_calls_are_unknown_not_zero(tmp_path):
    ledger = UsageLedger(Database(tmp_path), Settings(_env_file=None, data_dir=tmp_path, usage_ledger=True))
    ledger.record({"stage": "recall", "status": "error"})
    ledger.avoided("observe", "frame", "unchanged")
    result = ledger.summary()
    for field in (
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "cache_hit_tokens",
        "inference_seconds",
        "estimated_tokens_avoided",
        "estimated_naive_tokens",
    ):
        assert result["totals"][field] is None
    assert result["cloud_equivalent"]["actual_usd"] is None
    assert result["cloud_equivalent"]["metered_usd"] is None
    assert result["cloud_equivalent"]["estimated_naive_usd"] is None


def test_usage_http_requires_workspace_auth_and_valid_time_filter(tmp_path):
    from fastapi.testclient import TestClient
    from rewind.app import create_app

    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        usage_ledger=True,
        provider="disabled",
        workers=0,
        admin_token="a" * 32,
        device_token="b" * 32,
    )
    app = create_app(settings)
    app.state.usage.record(
        {"stage": "observe", "prompt_tokens": 12, "completion_tokens": 4, "created_at": 100}
    )
    with TestClient(app) as client:
        assert client.get("/api/usage/summary").status_code == 401
        headers = {"Authorization": "Bearer " + settings.admin_token}
        assert client.get("/api/usage/summary", headers=headers).json()["totals"]["total_tokens"] == 16
        assert client.get("/api/usage/summary?since=101", headers=headers).json()["totals"]["calls"] == 0
        for invalid in ("-1", "nan", "inf"):
            assert client.get("/api/usage/summary?since=" + invalid, headers=headers).status_code == 422


async def test_usage_failure_does_not_discard_successful_review(tmp_path):
    from rewind.verification import Review, Verifier

    result = Review(
        verdict="supported",
        reason="Source supports it.",
        answer="On the table [E1].",
        evidence_ids=["E1"],
        insufficient_evidence=False,
    )

    class Runner:
        async def run(self, *args):
            return result, {"model": "test", "usage": {"input_tokens": 12, "output_tokens": 4}}

    class BrokenLedger:
        def record(self, event):
            raise OSError("disk unavailable")

    verifier = Verifier(Database(tmp_path), Settings(_env_file=None, data_dir=tmp_path), Runner())
    verifier.usage = BrokenLedger()
    answer, _ = await verifier.review("test", "fixture", [], Review, "answer")
    assert answer is result


async def test_remote_usage_is_bound_to_each_concurrent_call_and_original_media(tmp_path):
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        usage_ledger=True,
        processing_url="http://asus",
        processing_token="test",
    )
    provider = Provider(settings)
    await provider.http.aclose()

    async def handler(request):
        body = json.loads(request.content)
        assert body["include_usage"] and body["cache_prompt"] is False
        count = int(body["content"])
        await asyncio.sleep(0.01 if count == 7 else 0)
        return httpx.Response(
            200,
            json={
                "result": {"summary": "Visible object"},
                "usage": {
                    "backend": "llamacpp",
                    "model": "actual-remote",
                    "stage": "observe",
                    "media_id": None,
                    "prompt_tokens": count,
                    "completion_tokens": 3,
                    "total_ms": 4,
                },
            },
        )

    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    await asyncio.gather(
        *(
            provider.structured("system", str(count), Observation, media_id=f"frame-{count}")
            for count in (7, 11)
        )
    )
    rows = provider.usage.db.all("SELECT * FROM usage ORDER BY prompt_tokens")
    assert [(r["media_id"], r["prompt_tokens"], r["model"]) for r in rows] == [
        ("frame-7", 7, "actual-remote"),
        ("frame-11", 11, "actual-remote"),
    ]
    await provider.close()


async def test_invalid_output_still_records_actual_consumed_tokens(tmp_path):
    s = Settings(
        _env_file=None,
        data_dir=tmp_path,
        usage_ledger=True,
        local_inference_api="llamacpp",
        cache_prompt=True,
    )
    provider = Provider(s)
    await provider.http.aclose()

    def handler(request):
        assert json.loads(request.content)["cache_prompt"] is True
        return httpx.Response(
            200,
            json={
                "choices": [{"finish_reason": "length", "message": {"content": "{"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 8},
            },
        )

    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(ValueError):
        await provider.structured("system", "input", Observation)
    row = provider.usage.db.one("SELECT * FROM usage")
    assert row["status"] == "error" and row["completion_tokens"] == 8
    assert json.loads(row["metadata"])["error_type"] == "ValueError"
    await provider.close()


@pytest.mark.parametrize("side", [448, 640])
async def test_labeler_copy_changes_only_inference_resolution_and_keeps_original_identity(tmp_path, side):
    import hashlib
    import io

    from PIL import Image

    source = tmp_path / "original-frame.jpg"
    Image.new("RGB", (1280, 960), (35, 120, 220)).save(source)
    original = source.read_bytes()
    digest = hashlib.sha256(original).hexdigest()
    provider = Provider(
        Settings(
            _env_file=None,
            data_dir=tmp_path,
            usage_ledger=True,
            labeler_long_side=side,
            dense_captions=True,
            processing_url="http://asus",
            processing_token="test",
        )
    )
    await provider.http.aclose()

    def handler(request):
        import base64

        payload = json.loads(request.content)
        assert payload["schema_name"] == "DenseObservation"
        with Image.open(io.BytesIO(base64.b64decode(payload["images"][0]))) as sent:
            assert sent.size == (side, side * 3 // 4)
        return httpx.Response(
            200,
            json={
                "result": {
                    "scene": "A blue rectangle",
                    "objects": ["blue rectangle"],
                    "people": 0,
                    "action": "",
                    "text_visible": "",
                },
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 20,
                    "backend": "llamacpp",
                    "model": "35b",
                },
            },
        )

    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await provider.observe(source)
    assert result.objects[0].label == "blue rectangle"
    assert source.read_bytes() == original and hashlib.sha256(source.read_bytes()).hexdigest() == digest
    assert provider.usage.db.one("SELECT media_id FROM usage")["media_id"] == "original-frame"
    await provider.close()
