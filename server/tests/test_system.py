import asyncio
import io
import json
import time
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from rewind.app import create_app
from rewind.config import Settings
from rewind.models import Observation, RecallAnswer, RuleDecision, SearchPlan

ADMIN = "admin-test-" + "a" * 30
DEVICE = "device-test-" + "d" * 30


class FakeProvider:
    def __init__(self):
        self.calls = 0
        self.fail = False
        self.bad_citations = False
        self.transcript = "We discussed building a camera memory necklace."

    async def observe(self, path):
        self.calls += 1
        if self.fail:
            raise RuntimeError("Model unavailable")
        return Observation(
            summary="A brown wallet is left of the blue notebook on the table.",
            objects=[
                {
                    "label": "wallet",
                    "location": "left of the blue notebook",
                    "bbox": [0.1, 0.2, 0.3, 0.5],
                    "confidence": 0.9,
                }
            ],
            tags=["wallet", "notebook"],
            confidence=0.9,
        )

    async def structured(self, system, content, schema, *args, **kwargs):
        if schema is SearchPlan:
            return SearchPlan(terms="wallet")
        if schema is RecallAnswer:
            data = json.loads(content)
            event_id = (
                "00000000-0000-0000-0000-000000000000" if self.bad_citations else data["evidence"][0]["id"]
            )
            return RecallAnswer(
                answer=f"The wallet was last observed left of the notebook [{event_id}].",
                evidence_ids=[event_id],
                insufficient_evidence=False,
            )
        if schema is RuleDecision:
            return RuleDecision(triggered=True, explanation="Wallet observed on the table.")
        return Observation(
            summary="A conversation about building a memory camera.",
            tags=["camera", "memory"],
            confidence=0.8,
        )

    async def embed(self, text):
        return None

    async def transcribe(self, path):
        return {"text": self.transcript, "segments": [{"start": 0, "end": 1, "text": self.transcript}]}

    async def close(self):
        pass


@pytest.fixture
def context(tmp_path):
    s = Settings(
        _env_file=None,
        data_dir=tmp_path,
        admin_token=ADMIN,
        device_token=DEVICE,
        workers=0,
        embeddings=False,
        min_free_gb=0,
    )
    provider = FakeProvider()
    app = create_app(s, provider)
    with TestClient(app) as c:
        yield c, app, provider


def jpeg(color="red"):
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(buf, "JPEG")
    return buf.getvalue()


def wav():
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\0\0" * 16000)
    return b.getvalue()


def headers(seq=0, **extra):
    return {
        "Authorization": "Bearer " + DEVICE,
        "X-Device-ID": "necklace-01",
        "X-Boot-ID": "testboot",
        "X-Sequence": str(seq),
        "X-Captured-At": str(time.time() - 5),
        "Content-Type": "image/jpeg",
        **extra,
    }


def admin():
    return {"Authorization": "Bearer " + ADMIN}


def send(c, seq=0, color="red", **extra):
    return c.post("/api/ingest/frame", content=jpeg(color), headers=headers(seq, **extra))


def process(app):
    item = app.state.worker.claim()
    assert item
    asyncio.run(app.state.worker.process(item))
    return item


def test_auth_separation_and_media_is_private(context):
    c, a, p = context
    assert c.get("/api/status").status_code == 401
    assert c.get("/api/status", headers=headers()).status_code == 401
    r = send(c)
    assert r.status_code == 201
    assert c.get("/api/media/" + r.json()["id"]).status_code == 401
    assert c.get("/api/media/" + r.json()["id"], headers=headers()).status_code == 401
    assert c.get("/api/media/" + r.json()["id"], headers=admin()).content == jpeg()
    assert c.post("/api/device/heartbeat", headers=admin(), json={"boot": "x"}).status_code == 401


def test_login_csrf_and_logout(context):
    c, _, _ = context
    assert c.post("/api/login", json={"token": ADMIN}).status_code == 200
    assert "HttpOnly" in c.cookies.__repr__() or "rewind_session" in c.cookies
    assert c.get("/api/status").status_code == 200
    assert (
        c.post(
            "/api/capture/pause", json={"paused": True}, headers={"Origin": "https://evil.test"}
        ).status_code
        == 403
    )
    assert (
        c.post(
            "/api/capture/pause", json={"paused": True}, headers={"Origin": "http://testserver"}
        ).status_code
        == 200
    )
    assert c.post("/api/logout").status_code == 200
    assert c.get("/api/status").status_code == 401


def test_idempotence_and_conflict(context):
    c, a, p = context
    first = send(c).json()
    assert send(c).json()["id"] == first["id"]
    assert send(c, color="blue").status_code == 409
    assert c.get("/api/status", headers=admin()).json()["received"] == 1
    process(a)
    assert p.calls == 1
    assert a.state.worker.claim() is None


def test_original_is_durable_before_analysis_and_failed_jobs_recover(context):
    c, a, p = context
    r = send(c).json()
    p.fail = True
    item = process(a)
    assert c.get("/api/media/" + r["id"], headers=admin()).content == jpeg()
    a.state.db.execute("UPDATE media SET status='failed' WHERE id=?", (item["id"],))
    assert c.post("/api/retry", headers=admin()).json()["retried"] == 1
    p.fail = False
    process(a)
    assert c.get("/api/status", headers=admin()).json()["analyzed"] == 1


def test_stale_lease_is_reclaimed_after_crash(context):
    c, a, _ = context
    send(c)
    first = a.state.worker.claim()
    assert first
    assert a.state.worker.claim() is None
    a.state.db.execute("UPDATE media SET lease_until=0 WHERE id=?", (first["id"],))
    assert a.state.worker.claim()["id"] == first["id"]


def test_every_frame_is_analyzed_even_identical_images(context):
    c, a, p = context
    for i in range(4):
        send(c, i)
    for _ in range(4):
        process(a)
    assert p.calls == 4
    assert c.get("/api/status", headers=admin()).json()["analyzed"] == 4


def test_recall_has_real_evidence_and_rejects_hallucinated_citations(context):
    c, a, p = context
    send(c)
    process(a)
    r = c.post("/api/ask", headers=admin(), json={"question": "Where was my wallet?"}).json()
    assert r["grounded"] and len(r["evidence"]) == 1
    assert r["evidence"][0]["id"] in r["answer"]
    p.bad_citations = True
    r = c.post("/api/ask", headers=admin(), json={"question": "Where was my wallet?"}).json()
    assert not r["grounded"] and r["mode"] == "evidence_only"


def test_no_evidence_and_temporal_filter(context):
    c, a, _ = context
    r = c.post("/api/ask", headers=admin(), json={"question": "Where is my wallet?"}).json()
    assert not r["grounded"] and r["mode"] == "no_evidence"
    send(c)
    process(a)
    assert c.get("/api/events?q=wallet&before=10", headers=admin()).json() == []
    assert len(c.get("/api/events?q=wallet", headers=admin()).json()) == 1


def test_audio_transcript_and_voice_question(context):
    c, a, p = context
    send(c)
    process(a)
    r = c.post(
        "/api/ingest/audio",
        headers=headers(1, **{"Content-Type": "audio/wav", "X-Intent": "question"}),
        content=wav(),
    )
    assert r.status_code == 201
    process(a)
    event = a.state.db.one("SELECT transcript FROM events WHERE id=?", (r.json()["id"],))
    assert event["transcript"] == p.transcript
    assert len(c.get("/api/answers", headers=admin()).json()) == 1


def test_invalid_uploads_and_device_provisioning(context):
    c, a, _ = context
    assert c.post("/api/ingest/frame", headers=headers(), content=b"bad").status_code == 400
    assert send(c, **{"X-Boot-ID": "../../bad"}).status_code == 400
    assert send(c, **{"X-Device-ID": "someone-else"}).status_code == 403
    assert send(c, **{"X-Captured-At": "NaN"}).status_code == 400
    assert send(c, **{"X-Captured-At": str(time.time() + 1000)}).status_code == 400
    assert (
        c.post(
            "/api/ingest/audio", headers=headers(**{"Content-Type": "audio/wav"}), content=b"bad"
        ).status_code
        == 400
    )


def test_disk_limit_never_silently_evicts(context):
    c, a, _ = context
    send(c)
    a.state.settings.max_storage_gb = 0.00000001
    assert send(c, 1).status_code == 507
    assert c.get("/api/status", headers=admin()).json()["received"] == 1


def test_delete_removes_original_index_and_derived_answers(context):
    c, a, _ = context
    r = send(c).json()
    process(a)
    c.post("/api/ask", headers=admin(), json={"question": "wallet"})
    path = Path(a.state.db.one("SELECT path FROM media WHERE id=?", (r["id"],))["path"])
    assert c.delete("/api/media/" + r["id"], headers=admin()).status_code == 200
    assert not path.exists()
    assert c.get("/api/events?q=wallet", headers=admin()).json() == []
    assert c.get("/api/answers", headers=admin()).json() == []


def test_rules_only_trigger_on_recent_evidence_and_respect_cooldown(context):
    c, a, _ = context
    c.post("/api/rules", headers=admin(), json={"instruction": "Tell me if wallet is on table."})
    send(c, **{"X-Captured-At": str(time.time())})
    process(a)
    send(c, 1, **{"X-Captured-At": str(time.time())})
    process(a)
    assert len(c.get("/api/alerts", headers=admin()).json()) == 1
    send(c, 2, **{"X-Captured-At": str(time.time() - 600)})
    process(a)
    assert len(c.get("/api/alerts", headers=admin()).json()) == 1


def test_unknown_capture_clock_is_labeled(context):
    c, a, _ = context
    send(c, **{"X-Captured-At": "0"})
    assert c.get("/api/recordings", headers=admin()).json()[0]["clock_quality"] == "received_only"


def test_restart_keeps_recordings_and_queued_work(context):
    c, a, p = context
    r = send(c).json()
    restarted = create_app(a.state.settings, FakeProvider())
    assert restarted.state.worker.claim()["id"] == r["id"]


def test_gap_accounting_handles_out_of_order_retransmit(context):
    c, a, _ = context
    send(c, 0)
    send(c, 2)
    assert c.get("/api/status", headers=admin()).json()["observed_sequence_gaps"] == 1
    send(c, 1)
    assert c.get("/api/status", headers=admin()).json()["observed_sequence_gaps"] == 0


def test_wake_phrase_on_wearable_creates_answer(context):
    c, a, p = context
    send(c)
    process(a)
    p.transcript = "Hey Rewind, where was my wallet?"
    c.post("/api/ingest/audio", headers=headers(1, **{"Content-Type": "audio/wav"}), content=wav())
    process(a)
    answers = c.get("/api/answers", headers=admin()).json()
    assert len(answers) == 1 and answers[0]["question"] == "where was my wallet?"


def test_new_event_endpoint_returns_full_evidence(context):
    c, a, _ = context
    r = send(c).json()
    process(a)
    event = c.get("/api/events/" + r["id"], headers=admin()).json()
    assert event["objects"][0]["label"] == "wallet" and "embedding" not in event
