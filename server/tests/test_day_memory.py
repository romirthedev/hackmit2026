import hashlib
import json
import uuid
from datetime import datetime

import pytest
from PIL import Image
from rewind.config import Settings
from rewind.db import Database
from rewind.memory import Memory
from rewind.models import RecallAnswer
from rewind.verification import Verifier


def stamp(value):
    return datetime.fromisoformat(value).timestamp()


class Provider:
    def __init__(self):
        self.calls = []

    async def embed(self, query):
        return None

    async def structured(self, system, body, schema, **kwargs):
        payload = json.loads(body)
        self.calls.append((system, payload, kwargs["images"]))
        labels = payload["attached_images_in_order"]
        assert schema is RecallAnswer
        return RecallAnswer(
            answer="Several activities are visible in the available samples.",
            evidence_ids=labels,
            insufficient_evidence=not labels,
        )


@pytest.fixture
def workspace(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path, workers=0, embeddings=False, recall_max_images=3)
    database = Database(tmp_path)
    provider = Provider()
    return database, settings, provider


def add_frame(workspace, at, *, clock="device", status="done", summary=None):
    db, settings, _ = workspace
    identifier = str(uuid.uuid4())
    path = settings.data_dir / (identifier + ".jpg")
    Image.new("RGB", (24, 24), "green").save(path)
    payload = path.read_bytes()
    db.execute(
        """INSERT INTO media(id,device,boot,seq,kind,captured_at,received_at,clock_quality,
        sha256,path,bytes,mime,status,provenance) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            identifier,
            "phone",
            "day-fixture",
            len(db.all("SELECT id FROM media")),
            "frame",
            at,
            at,
            clock,
            hashlib.sha256(payload).hexdigest(),
            str(path),
            len(payload),
            "image/jpeg",
            status,
            json.dumps({"fixture_source": identifier}),
        ),
    )
    if summary:
        db.execute(
            "INSERT INTO events(id,captured_at,kind,summary,model,created_at) VALUES(?,?,'frame',?,'fixture',?)",
            (identifier, at, summary, at),
        )
    return identifier


async def test_overview_attaches_distant_originals_beyond_the_three_image_focused_budget(workspace):
    db, settings, provider = workspace
    start = stamp("2026-09-19T00:00:00-04:00")
    ids = [add_frame(workspace, start + hour * 3600, status="queued") for hour in range(1, 24)]
    original_hashes = {row["id"]: row["sha256"] for row in db.all("SELECT id,sha256 FROM media")}
    result = await Memory(db, provider, settings).ask(
        "Summarize my entire day from the available recordings. What visible actions and objects are established?",
        after=start,
        before=start + 86400,
    )
    system, body, paths = provider.calls[0]
    assert len(paths) == 12  # Extra real pixels, not captions pretending to cover the day.
    attached = {row["id"]: row for row in body["evidence"] if row["id"] in body["attached_images_in_order"]}
    observed_times = {row["recorded_at"] for row in attached.values()}
    assert min(observed_times) == start + 3600
    assert max(observed_times) == start + 23 * 3600
    assert "Mention missing periods" in system
    assert body["recording_coverage"]["archive_samples_considered"] == 23
    assert result["recording_coverage"]["attached_original_images"] == 12
    assert "not a complete account" in result["answer"]
    assert "23 recorded samples have not finished" in result["answer"]
    assert {row["id"] for row in result["evidence"]} <= set(ids)
    assert all(row["provenance"]["fixture_source"] == row["id"] for row in result["evidence"])
    assert all(hashlib.sha256(path.read_bytes()).hexdigest() == original_hashes[path.stem] for path in paths)


async def test_today_uses_local_day_and_excludes_synthetic_history(workspace, monkeypatch):
    db, settings, provider = workspace
    now = stamp("2026-09-20T02:00:00+00:00")  # Still September 19 in New York.
    monkeypatch.setattr("rewind.memory.time.time", lambda: now)
    prior = add_frame(workspace, stamp("2026-09-19T00:30:00+00:00"))
    today = add_frame(workspace, stamp("2026-09-19T05:00:00+00:00"))
    synthetic = add_frame(workspace, now - 100, clock="synthetic")
    future = add_frame(workspace, stamp("2026-09-20T05:00:00+00:00"))
    result = await Memory(db, provider, settings).ask("What did I do today?")
    assert {row["id"] for row in result["evidence"]} == {today}
    assert not {prior, synthetic, future} & {row["id"] for row in result["evidence"]}
    assert result["recording_coverage"]["requested_after"] == stamp("2026-09-19T00:00:00-04:00")
    assert result["recording_coverage"]["requested_before"] == now
    assert result["recording_coverage"]["excluded_nonhistorical_samples"] == 1


async def test_yesterday_does_not_include_today_midnight(workspace, monkeypatch):
    db, settings, provider = workspace
    midnight = stamp("2026-09-20T00:00:00-04:00")
    monkeypatch.setattr("rewind.memory.time.time", lambda: midnight + 3600)
    yesterday = add_frame(workspace, midnight - 1)
    add_frame(workspace, midnight)
    result = await Memory(db, provider, settings).ask("What happened yesterday?")
    assert {row["id"] for row in result["evidence"]} == {yesterday}


async def test_focused_question_retains_relevance_and_normal_image_budget(workspace):
    db, settings, provider = workspace
    for i in range(12):
        add_frame(workspace, 1000 + i * 3600, summary="Glasses on a shelf")
    result = await Memory(db, provider, settings).ask("What color were my glasses today?")
    assert len(provider.calls[0][2]) == settings.recall_max_images
    assert provider.calls[0][1]["recording_coverage"] is None
    assert "recording_coverage" not in result


async def test_synthetic_only_day_cannot_become_historical_evidence(workspace):
    db, settings, provider = workspace
    add_frame(workspace, 100, clock="synthetic")
    result = await Memory(db, provider, settings).ask("Recap my day", after=0, before=200)
    assert not provider.calls and result["mode"] == "no_evidence"
    assert not result["grounded"] and not result["evidence"]
    assert "not a complete account" in result["answer"]
    assert result["recording_coverage"]["archive_samples_considered"] == 0


async def test_synthetic_neighbor_cannot_reenter_day_via_audio_context(workspace):
    db, settings, provider = workspace
    real = add_frame(workspace, 100)
    synthetic = add_frame(workspace, 101, clock="synthetic")
    db.execute("UPDATE media SET kind='audio',duration=10 WHERE id=?", (synthetic,))
    result = await Memory(db, provider, settings).ask("Recap my day", after=0, before=200)
    assert {row["id"] for row in result["evidence"]} == {real}
    assert all(row["kind"] != "audio" for row in provider.calls[0][1]["evidence"])


async def test_both_reviewers_receive_coverage_and_corrected_answer_keeps_qualification(workspace):
    db, settings, provider = workspace
    add_frame(workspace, 3600, status="queued")
    add_frame(workspace, 20 * 3600, status="queued")

    class Runner:
        def __init__(self):
            self.payloads = []

        async def run(self, model, prompt, images, schema):
            payload = json.loads(prompt.rsplit("\n", 1)[-1])
            self.payloads.append(payload)
            assert len(images) == 2
            coverage = payload["recording_coverage"]
            assert coverage["pending_samples"] == 2
            assert coverage["continuous_coverage_established"] is False
            assert "Missing samples cannot establish" in prompt
            if model == "gpt-6-astra":
                result = schema.model_validate(
                    {
                        "verdict": "unsupported",
                        "insufficient_evidence": False,
                        "answer": "A green image is visible [E1].",
                        "evidence_ids": ["E1"],
                        "reason": "Only sampled pixels establish this.",
                    }
                )
            else:
                result = schema.model_validate(
                    {"winner": "astra", "reason": "The narrower answer is supported."}
                )
            return result, {"model": model, "result": result.model_dump()}

    runner = Runner()
    verifier = Verifier(db, settings, runner)
    result = await Memory(db, provider, settings, verifier=verifier).ask(
        "Recap my day", after=0, before=86400
    )
    assert result["mode"] == "checking"
    await verifier.process(verifier.claim())
    assert len(runner.payloads) == 2
    stored = db.one("SELECT * FROM answers WHERE id=?", (result["id"],))
    assert stored["mode"] == "verified"
    assert "A green image is visible" in stored["answer"]
    assert "not a complete account" in stored["answer"]
    assert "1140 minutes" in stored["answer"]
    assert "2 recorded samples have not finished" in stored["answer"]
    assert verifier.public(result["id"])["receipt"]["recording_coverage"] == result["recording_coverage"]
