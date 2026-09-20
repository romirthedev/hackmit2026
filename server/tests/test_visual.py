import asyncio
import json

import numpy as np
from rewind.memory import Memory
from rewind.visual import VisualIndex, normalized
from test_system import admin, process, send
from test_system import context as context


class Encoder:
    model_key = "test-pixels-v1"

    def encode(self, *, path=None, text=None):
        return np.array([1, 0], dtype=np.float32)


def test_visual_index_retrieves_uncaptioned_original_and_survives_restart(context):
    c, app, provider = context
    event_id = send(c).json()["id"]
    visual = VisualIndex(app.state.db, app.state.settings, Encoder())
    item = visual.claim()
    assert item["id"] == event_id and visual.claim() is None
    asyncio.run(visual.process(item))
    assert visual.status()["indexed"] == 1
    # No caption or text embedding exists; pixel retrieval must still work.
    memory = Memory(app.state.db, provider, app.state.settings, visual)
    hits = asyncio.run(memory.search("red fabric"))
    assert hits[0]["id"] == event_id and hits[0]["summary"] is None
    assert hits[0]["media_url"].endswith(event_id)
    assert asyncio.run(memory.search("red fabric", before=1)) == []
    assert VisualIndex(app.state.db, app.state.settings, Encoder()).claim() is None
    assert c.delete("/api/media/" + event_id, headers=admin()).status_code == 200
    assert visual.status()["total"] == 0
    assert asyncio.run(memory.search("red fabric")) == []


def test_visual_model_isolation_and_expired_lease(context):
    _, app, provider = context
    db = app.state.db
    c = context[0]
    event_id = send(c).json()["id"]
    first = VisualIndex(db, app.state.settings, Encoder())
    first.claim()
    db.execute("UPDATE visual_index SET lease_until=0")
    assert first.claim()["id"] == event_id
    asyncio.run(first.process({"id": event_id, "path": db.one("SELECT path FROM media")["path"]}))
    second_encoder = Encoder()
    second_encoder.model_key = "test-pixels-v2"
    second = VisualIndex(db, app.state.settings, second_encoder)
    assert asyncio.run(second.search("red", 0, 1e12, 10)) == []
    assert second.claim()["id"] == event_id


def test_visual_failures_are_visible_retryable_and_do_not_fail_caption(context):
    c, app, _ = context
    event_id = send(c).json()["id"]

    class Broken(Encoder):
        def encode(self, **kwargs):
            raise RuntimeError("No weights")

    visual = VisualIndex(app.state.db, app.state.settings, Broken())
    for _ in range(3):
        asyncio.run(visual.process(visual.claim()))
        app.state.db.execute("UPDATE visual_index SET retry_at=0")
    assert visual.status()["failed"] == 1
    assert visual.claim() is None
    assert app.state.db.one("SELECT error FROM visual_index")["error"] == "RuntimeError"
    process(app)
    assert app.state.db.one("SELECT status FROM media WHERE id=?", (event_id,))["status"] == "done"
    assert c.post("/api/retry", headers=admin()).json()["visual_retried"] == 1
    assert visual.claim()["id"] == event_id


def test_reject_invalid_visual_vectors():
    import pytest

    for vector in ([0, 0], [float("nan"), 1], [float("inf"), 0], [[1, 2]]):
        with pytest.raises(ValueError):
            normalized(vector)


def test_video_provenance_roundtrip_and_retry_conflict(context):
    c, app, _ = context
    metadata = {
        "source_sha256": "a" * 64,
        "source_offset": 2.4,
        "source_pts": 2400,
        "time_base": "1/1000",
        "frame_index": 17,
        "clip_index": 0,
        "sample_fps": 1,
        "clock": "synthetic",
    }
    extra = {"X-Video-Provenance": json.dumps(metadata), "X-Captured-At": "1000000000"}
    event_id = send(c, **extra).json()["id"]
    assert send(c, **extra).json()["duplicate"]
    row = c.get("/api/events/" + event_id, headers=admin()).json()
    assert row["provenance"] == metadata and row["clock_quality"] == "synthetic"
    metadata["frame_index"] = 18
    assert send(c, **{**extra, "X-Video-Provenance": json.dumps(metadata)}).status_code == 409
    assert send(c, 1, **{"X-Video-Provenance": "{}"}).status_code == 400
    process(app)
    hits = c.get("/api/events?q=wallet", headers=admin()).json()
    assert hits[0]["provenance"]["frame_index"] == 17


def test_short_citations_and_originals_take_priority(context):
    from rewind.models import RecallAnswer

    c, app, provider = context
    send(c, **{"X-Captured-At": "1000000000"})
    process(app)
    original = provider.structured

    async def inspect(system, content, schema, **kwargs):
        if schema is RecallAnswer:
            data = json.loads(content)
            assert data["evidence"][0]["id"] == "E1"
            assert "summary" not in data["evidence"][0]
            assert data["attached_images_in_order"] == ["E1"]
            assert len(kwargs["images"]) == 1
        return await original(system, content, schema, **kwargs)

    provider.structured = inspect
    result = c.post("/api/ask", headers=admin(), json={"question": "Where was my wallet?"}).json()
    assert result["grounded"] and "[E1]" not in result["answer"]
    assert "[" + result["evidence"][0]["id"] + "]" in result["answer"]


def test_schema_one_upgrade_preserves_recordings(context):
    from rewind.db import Database

    c, app, _ = context
    event_id = send(c).json()["id"]
    old = app.state.db.one("SELECT * FROM media WHERE id=?", (event_id,))
    with app.state.db.connect() as connection:
        connection.execute("ALTER TABLE media DROP COLUMN provenance")
        connection.execute("PRAGMA user_version=1")
    upgraded = Database(app.state.settings.data_dir)
    assert upgraded.one("SELECT * FROM media WHERE id=?", (event_id,)) == old
    assert upgraded.one("PRAGMA user_version")["user_version"] == 3


def test_visual_similarity_cannot_establish_temporal_anchor(context):
    from rewind.models import SearchPlan

    c, app, provider = context
    send(c, **{"X-Captured-At": "1000000000"})
    process(app)
    visual = VisualIndex(app.state.db, app.state.settings, Encoder())
    asyncio.run(visual.process(visual.claim()))
    app.state.memory.visual = visual
    original = provider.structured

    async def plan(system, content, schema, **kwargs):
        if schema is SearchPlan:
            return SearchPlan(terms="wallet", anchor_terms="flying a helicopter", relation="after")
        return await original(system, content, schema, **kwargs)

    provider.structured = plan
    result = c.post(
        "/api/ask", headers=admin(), json={"question": "Where was my wallet after flying a helicopter?"}
    ).json()
    assert result["evidence"] and not result["grounded"]
