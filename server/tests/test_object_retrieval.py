import hashlib

import pytest
from rewind.db import event_public
from rewind.memory import EVIDENCE_SELECT, Memory
from rewind.object_retrieval import location_terms
from test_day_memory import add_frame
from test_day_memory import workspace as workspace


@pytest.mark.parametrize(
    "question,expected",
    [
        ("Where did I put my laptop?", ["laptop"]),
        ("Where did I leave my glasses today?", ["glasses"]),
        ("Where is my red bag?", ["red", "bag"]),
        ("What color is my bag?", []),
        ("Where did I put my laptop before moving the bag?", []),
        ("Summarize my entire day. Where is my bag?", []),
    ],
)
def test_location_detection_is_bounded(question, expected):
    assert location_terms(question) == expected


async def test_placement_keeps_adjacent_originals_first_reference_and_other_instance(workspace, monkeypatch):
    db, settings, provider = workspace
    now = 10_100
    monkeypatch.setattr("rewind.memory.time.time", lambda: now)
    # All fixtures are generated solid-color images. Text only nominates which
    # original pixels are attached; no test prescribes the real-world answer.
    old = []
    for i in range(3):
        identifier = add_frame(workspace, 1000 + i * 10, summary="Laptop laptop on a desk")
        db.execute("UPDATE media SET boot=? WHERE id=?", (f"older-{i}", identifier))
        old.append(identifier)
    ids = {}
    for i in range(35):
        summary = "Unrelated hallway"
        if i == 0:
            summary = "Close view of a laptop keyboard, with background shelves and many other objects"
        elif i == 10:
            summary = "Laptop on seat"
        elif i in (9, 11, 12):
            summary = (
                "An open laptop above a surface with several indistinct background objects and furniture"
            )
        elif i == 26:
            summary = (
                "Another person uses a laptop with hands on keyboard, feet beside furniture and other objects"
            )
        ids[i] = add_frame(workspace, 10_060 + i, summary=summary)

    memory = Memory(db, provider, settings)
    # Simulate the failure's all-time semantic ranking and unrelated fresh tail.
    ranked = [old[0], old[1], ids[26], old[2], ids[10], ids[12]]

    async def search(*args, **kwargs):
        return [
            event_public(db.one(EVIDENCE_SELECT + " WHERE m.id=?", (identifier,))) for identifier in ranked
        ]

    memory.search = search
    result = await memory.ask("Where did I put my laptop?")
    system, body, paths = provider.calls[0]
    attached = [path.stem for path in paths]
    assert len(attached) <= 8
    assert {ids[0], ids[9], ids[10], ids[11], ids[12], ids[26]} <= set(attached)
    assert not {ids[32], ids[33], ids[34]} & set(attached)
    assert len(set(old) & set(attached)) >= 1
    assert body["attached_images_in_order"] == [f"E{i + 1}" for i in range(len(paths))]
    assert [row["id"] for row in body["evidence"][: len(paths)]] == body["attached_images_in_order"]
    times = [row["recorded_at"] for row in body["evidence"][: len(paths)]]
    assert times == sorted(times)
    assert "newest image of an object is not necessarily the same instance" in system
    assert "If you mean the [description]" in system
    assert "recording_coverage" not in result  # Object continuity is not a whole-day overview.
    assert all(
        hashlib.sha256(path.read_bytes()).hexdigest()
        == db.one("SELECT sha256 FROM media WHERE id=?", (path.stem,))["sha256"]
        for path in paths
    )


async def test_location_neighbors_obey_requested_bounds_and_stream(workspace):
    db, settings, provider = workspace
    before = add_frame(workspace, 99, summary="Keys")
    target = add_frame(workspace, 100, summary="Keys on a table")
    same_stream = add_frame(workspace, 101, summary="Table edge")
    other_stream = add_frame(workspace, 101.5, summary="Different room")
    db.execute("UPDATE media SET boot='other-camera' WHERE id=?", (other_stream,))
    after = add_frame(workspace, 102, summary="Keys")
    await Memory(db, provider, settings).ask("Where did I put my keys?", after=100, before=101.5)
    ids = {path.stem for path in provider.calls[0][2]}
    assert ids == {target, same_stream}
    assert not ids & {before, after, other_stream}


async def test_no_lexical_location_match_keeps_original_semantic_path(workspace):
    db, settings, provider = workspace
    identifiers = [add_frame(workspace, 100 + i * 5, summary="Countertop") for i in range(5)]
    memory = Memory(db, provider, settings)

    async def search(*args, **kwargs):
        return [
            event_public(db.one(EVIDENCE_SELECT + " WHERE m.id=?", (identifier,)))
            for identifier in identifiers
        ]

    memory.search = search
    await memory.ask("Where did I put my spectacles?")
    assert len(provider.calls[0][2]) == settings.recall_max_images


async def test_location_source_changed_before_question_is_not_attached(workspace):
    db, settings, provider = workspace
    intact = add_frame(workspace, 100, summary="Cup on counter")
    changed = add_frame(workspace, 101, summary="Cup")
    (settings.data_dir / (changed + ".jpg")).write_bytes(b"changed before asking")
    result = await Memory(db, provider, settings).ask("Where is my cup?")
    assert {path.stem for path in provider.calls[0][2]} == {intact}
    assert result["evidence_scope"]["excluded_changed_or_missing_sources"] == 1


async def test_spoken_question_is_not_its_own_evidence_but_later_frames_remain(workspace):
    db, settings, provider = workspace
    source = add_frame(workspace, 100, summary="Where did I put my laptop?")
    db.execute("UPDATE media SET kind='audio',duration=3 WHERE id=?", (source,))
    db.execute("UPDATE events SET kind='audio',transcript=summary WHERE id=?", (source,))
    later = add_frame(workspace, 105, summary="Laptop on a table")
    result = await Memory(db, provider, settings).ask("Where did I put my laptop?", source_media=source)
    assert {row["id"] for row in result["evidence"]} == {later}
    assert [row["kind"] for row in provider.calls[0][1]["evidence"]] == ["frame"]
    assert provider.calls[0][2][0].stem == later


async def test_descriptor_alone_cannot_choose_a_different_object_episode(workspace):
    db, settings, provider = workspace
    bag = add_frame(workspace, 100, summary="Red bag on a table")
    chair = add_frame(workspace, 200, summary="Red chair")
    db.execute("UPDATE media SET boot='unrelated-room' WHERE id=?", (chair,))
    memory = Memory(db, provider, settings)

    async def search(*args, **kwargs):
        return [event_public(db.one(EVIDENCE_SELECT + " WHERE m.id=?", (bag,)))]

    memory.search = search
    await memory.ask("Where is my red bag?")
    assert [path.stem for path in provider.calls[0][2]] == [bag]
