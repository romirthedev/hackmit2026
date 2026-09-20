import asyncio
import hashlib
import time
import uuid
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image
from rewind.config import Settings
from rewind.db import Database
from rewind.gating import RuleGate, block_difference
from rewind.models import Observation, RuleDecision
from rewind.worker import Worker


class Visual:
    model_key = "test-openclip"

    def __init__(self, db):
        self.db, self.calls = db, []
        self.vector = np.array([1, 0], dtype=np.float32)

    async def process(self, item):
        self.calls.append(item["id"])
        self.db.execute(
            "UPDATE visual_index SET status='done',embedding=?,lease_until=0 WHERE id=? AND model=?",
            (self.vector.tobytes() if self.vector is not None else None, item["id"], self.model_key),
        )


class Provider:
    def __init__(self):
        self.observed, self.avoided, self.rules, self.embedded = [], [], [], []
        self.wait = None

    async def observe(self, path):
        self.observed.append(path.stem)
        if self.wait:
            await self.wait.wait()
        return Observation(summary="A cup is on the table.", tags=["cup", "table"], confidence=0.8)

    async def embed(self, text):
        self.embedded.append(text)
        return [1.0, 0.0]

    def record_avoided(self, stage, media_id, reason, metadata):
        self.avoided.append((stage, media_id, reason, metadata))

    async def structured(self, system, content, schema, **kwargs):
        self.rules.append((system, content, kwargs))
        return RuleDecision(
            triggered="not on" not in content and "cup" in content, explanation="Fixture decision"
        )


@pytest.fixture
def gate_workspace(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path, change_gate=True, embeddings=True, min_free_gb=0)
    db, provider = Database(tmp_path), Provider()
    visual = Visual(db)
    worker = Worker(db, provider, SimpleNamespace(visual=visual), settings)
    return db, settings, provider, visual, worker


def frame(workspace, seq, at, *, image=None, boot="recording", device="phone", intent="memory"):
    db, settings, *_ = workspace
    identifier = str(uuid.uuid4())
    path = settings.data_dir / (identifier + ".png")
    (image or Image.new("RGB", (64, 48), "black")).save(path)
    data = path.read_bytes()
    db.execute(
        """INSERT INTO media(id,device,boot,seq,kind,captured_at,received_at,clock_quality,
        sha256,path,bytes,mime,status,intent) VALUES(?,?,?,?,'frame',?,?,'device',?,?,?,'image/png','queued',?)""",
        (
            identifier,
            device,
            boot,
            seq,
            at,
            at,
            hashlib.sha256(data).hexdigest(),
            str(path),
            len(data),
            intent,
        ),
    )
    return identifier


async def process(workspace, identifier):
    db, _, _, _, worker = workspace
    db.execute("UPDATE media SET status='processing' WHERE id=?", (identifier,))
    await worker.process(db.one("SELECT * FROM media WHERE id=?", (identifier,)))
    assert db.one("SELECT status FROM media WHERE id=?", (identifier,))["status"] == "done"


async def test_static_frames_keep_originals_and_visual_index_with_root_heartbeat(gate_workspace):
    db, _, provider, visual, _ = gate_workspace
    identifiers = [frame(gate_workspace, i, 1000 + offset) for i, offset in enumerate((0, 1, 29, 30, 31))]
    hashes = {row["id"]: row["sha256"] for row in db.all("SELECT * FROM media")}
    for identifier in identifiers:
        await process(gate_workspace, identifier)
    events = db.all("SELECT * FROM events ORDER BY captured_at")
    assert [event["label_mode"] for event in events] == [
        "described",
        "inherited",
        "inherited",
        "described",
        "inherited",
    ]
    assert [event["inherited_from"] for event in events] == [
        None,
        identifiers[0],
        identifiers[0],
        None,
        identifiers[3],
    ]
    assert provider.observed == [identifiers[0], identifiers[3]]
    assert len(visual.calls) == 5
    assert db.one("SELECT COUNT(*) n FROM visual_index WHERE status='done'")["n"] == 5
    assert all(event["confidence"] == 0 for event in events if event["label_mode"] == "inherited")
    assert {row["id"]: row["sha256"] for row in db.all("SELECT * FROM media")} == hashes
    assert len(provider.avoided) == 3
    assert provider.avoided[1][3]["inherited_from"] == identifiers[0]


def test_small_object_move_within_one_block_does_not_cancel():
    before, after = np.zeros((48, 64)), np.zeros((48, 64))
    before[0:4, 0:4] = 1
    after[4:8, 4:8] = 1
    assert before[:8, :8].mean() == after[:8, :8].mean()  # Mean-difference bug would report zero.
    assert block_difference(before, after) == 0.5


async def test_small_object_appearance_forces_description_despite_identical_embedding(gate_workspace):
    db, _, provider, _, _ = gate_workspace
    first = frame(gate_workspace, 0, 1000)
    picture = Image.new("RGB", (64, 48), "black")
    for x in range(4):
        for y in range(4):
            picture.putpixel((x, y), (255, 255, 255))
    second = frame(gate_workspace, 1, 1001, image=picture)
    await process(gate_workspace, first)
    await process(gate_workspace, second)
    assert provider.observed == [first, second]
    decision = db.one("SELECT * FROM gate_decisions WHERE media_id=?", (second,))
    assert decision["reason"] == "local_pixels_changed"
    assert decision["similarity"] == pytest.approx(1)
    assert decision["block_delta"] == pytest.approx(0.25)


async def test_missing_vectors_fail_open_and_question_boot_device_never_inherit(gate_workspace):
    db, _, provider, visual, _ = gate_workspace
    visual.vector = None
    for i in range(2):
        await process(gate_workspace, frame(gate_workspace, i, 1000 + i))
    assert len(provider.observed) == 2
    visual.vector = np.array([1, 0], dtype=np.float32)
    for kwargs in ({"boot": "new-boot"}, {"device": "other-phone"}, {"intent": "question"}):
        await process(gate_workspace, frame(gate_workspace, 2, 1002, **kwargs))
    assert len(provider.observed) == 5
    assert db.one("SELECT COUNT(*) n FROM events WHERE label_mode='inherited'")["n"] == 0


async def test_future_completed_frame_cannot_anchor_late_older_upload(gate_workspace):
    db, _, provider, _, _ = gate_workspace
    newer = frame(gate_workspace, 9, 1009)
    older = frame(gate_workspace, 3, 1003)
    await process(gate_workspace, newer)
    await process(gate_workspace, older)
    assert provider.observed == [newer, older]
    assert db.one("SELECT inherited_from FROM events WHERE id=?", (older,))["inherited_from"] is None


async def test_seven_workers_inherit_completed_anchor_while_another_description_is_pending(gate_workspace):
    db, _, provider, _, worker = gate_workspace
    anchor = frame(gate_workspace, 0, 1000)
    await process(gate_workspace, anchor)
    # Force a distinct frame's expensive model call to remain in flight.
    changed = frame(gate_workspace, 1, 1001, image=Image.new("RGB", (64, 48), "white"))
    provider.wait = asyncio.Event()
    slow = asyncio.create_task(process(gate_workspace, changed))
    for _ in range(100):
        if changed in provider.observed:
            break
        await asyncio.sleep(0.001)
    assert changed in provider.observed
    identifiers = [frame(gate_workspace, i, 1000 + i) for i in range(2, 9)]
    await asyncio.wait_for(
        asyncio.gather(*(process(gate_workspace, identifier) for identifier in identifiers)), timeout=3
    )
    assert provider.observed == [anchor, changed]
    assert all(
        db.one("SELECT inherited_from FROM events WHERE id=?", (identifier,))["inherited_from"] == anchor
        for identifier in identifiers
    )
    provider.wait.set()
    await slow
    # A late older frame still cannot inherit the now-completed future sources.
    assert worker.caption_gate is not None


async def test_gate_never_inherits_or_describes_modified_current_bytes(gate_workspace):
    db, _, provider, _, worker = gate_workspace
    identifier = frame(gate_workspace, 0, 1000)
    row = db.one("SELECT * FROM media WHERE id=?", (identifier,))
    from pathlib import Path

    Path(row["path"]).write_bytes(b"modified")
    await worker.process(row)
    assert not provider.observed
    assert not db.one("SELECT id FROM events WHERE id=?", (identifier,))


async def test_gate_disabled_keeps_every_frame_description(gate_workspace):
    _, settings, provider, visual, _ = gate_workspace
    settings.change_gate = False
    for i in range(3):
        await process(gate_workspace, frame(gate_workspace, i, 1000 + i))
    assert len(provider.observed) == 3
    assert not visual.calls and not provider.avoided


async def test_ledger_failure_cannot_break_durable_inheritance_or_change_its_model(gate_workspace):
    db, _, provider, _, worker = gate_workspace
    first, second = frame(gate_workspace, 0, 1000), frame(gate_workspace, 1, 1001)
    await process(gate_workspace, first)
    db.execute("UPDATE events SET model='actual-source-model' WHERE id=?", (first,))
    ledger_attempts = []

    def broken_ledger(*args):
        ledger_attempts.append(args)
        raise RuntimeError("Ledger unavailable")

    provider.record_avoided = broken_ledger
    await process(gate_workspace, second)
    event = db.one("SELECT * FROM events WHERE id=?", (second,))
    assert event["label_mode"] == "inherited" and event["model"] == "actual-source-model"
    assert len(ledger_attempts) == 1 and provider.observed == [first]
    await worker.process(db.one("SELECT * FROM media WHERE id=?", (second,)))
    assert len(ledger_attempts) == 1  # Existing event is idempotent, including savings.


async def test_cancelled_inheritance_does_not_double_count_avoided_model_calls(gate_workspace):
    db, _, provider, _, worker = gate_workspace
    first, second = frame(gate_workspace, 0, 1000), frame(gate_workspace, 1, 1001)
    await process(gate_workspace, first)
    db.execute("UPDATE events SET embedding=NULL,embedding_model=NULL WHERE id=?", (first,))
    embedded = asyncio.Event()
    original = provider.embed

    async def interrupted_embed(text):
        embedded.set()
        await asyncio.Event().wait()

    provider.embed = interrupted_embed
    row = db.one("SELECT * FROM media WHERE id=?", (second,))
    task = asyncio.create_task(worker.process(row))
    await asyncio.wait_for(embedded.wait(), 3)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not provider.avoided
    assert not db.one("SELECT id FROM events WHERE id=?", (second,))
    provider.embed = original
    await process(gate_workspace, second)
    assert len(provider.avoided) == 1


@pytest.mark.parametrize("summary", ["Cup is on the table.", "Cup is not on the table."])
async def test_rule_gate_never_decides_negation_itself(gate_workspace, summary):
    db, settings, provider, _, _ = gate_workspace
    identifier = frame(gate_workspace, 0, time.time())
    event = {
        "summary": summary,
        "transcript": "",
        "objects": "[]",
        "tags": "[]",
        "embedding": None,
        "embedding_model": None,
    }
    rule = {"id": "rule-1", "instruction": "Tell me if a cup is on the table."}
    evaluate, reason, _ = await RuleGate(db, provider, settings).decide({"id": identifier}, event, rule)
    assert evaluate and reason == "lexical_cue"
    assert not provider.embedded


async def test_rule_gate_uses_semantic_cues_fails_open_and_refreshes_edited_rule(gate_workspace):
    db, settings, provider, _, _ = gate_workspace
    identifier = frame(gate_workspace, 0, time.time())
    event = {
        "summary": "A visitor comes through the doorway.",
        "transcript": "",
        "objects": "[]",
        "tags": "[]",
        "embedding": np.array([1, 0], dtype=np.float32).tobytes(),
        "embedding_model": settings.embedding_model,
    }
    rule = {"id": "rule-1", "instruction": "Notify me when someone enters the room."}
    gate = RuleGate(db, provider, settings)
    assert (await gate.decide({"id": identifier}, event, rule))[:2] == (True, "semantic_cue")
    await gate.decide({"id": identifier}, event, rule)
    assert len(provider.embedded) == 1
    rule["instruction"] = "Notify me if the stove is on."
    event["embedding"] = np.array([0, 1], dtype=np.float32).tobytes()
    assert (await gate.decide({"id": identifier}, event, rule))[:2] == (False, "no_relevant_cue")
    assert len(provider.embedded) == 2
    event["embedding"] = None
    assert (await gate.decide({"id": identifier}, event, rule))[:2] == (True, "embedding_unavailable")


async def test_inherited_caption_never_triggers_rule_even_when_rule_gate_is_off(gate_workspace):
    db, settings, provider, _, worker = gate_workspace
    now = time.time()
    first, second = frame(gate_workspace, 0, now - 2), frame(gate_workspace, 1, now - 1)
    await process(gate_workspace, first)
    db.execute("INSERT INTO rules VALUES('rule-1','Tell me if a cup is on the table.',1,?,0)", (now - 3,))
    await process(gate_workspace, second)
    assert settings.rule_gate is False
    assert not provider.rules and not db.all("SELECT * FROM alerts")
    assert (
        db.one("SELECT reason FROM gate_decisions WHERE media_id=? AND stage='rule'", (second,))["reason"]
        == "inherited_caption_not_new_evidence"
    )
    # A real new description can still trigger, and inherited context is absent.
    third = frame(gate_workspace, 2, now, image=Image.new("RGB", (64, 48), "white"))
    await process(gate_workspace, third)
    assert len(provider.rules) == 1
    assert db.one("SELECT event_id FROM alerts")["event_id"] == third
    assert second not in provider.rules[0][1]


def test_existing_event_migration_is_idempotent_and_marks_legacy(gate_workspace):
    db, settings, *_ = gate_workspace
    identifier = frame(gate_workspace, 0, 1000)
    db.execute(
        "INSERT INTO events(id,captured_at,kind,summary,model,created_at) VALUES(?,1000,'frame','Original caption','original-model',1001)",
        (identifier,),
    )
    original = db.one("SELECT * FROM events WHERE id=?", (identifier,))
    for name in ("label_mode", "inherited_from", "visual_similarity", "block_delta"):
        db.execute(f"ALTER TABLE events DROP COLUMN {name}")
    db.execute("PRAGMA user_version=2")
    Database(settings.data_dir)
    Database(settings.data_dir)
    columns = {row["name"] for row in db.all("PRAGMA table_info(events)")}
    assert {"label_mode", "inherited_from", "visual_similarity", "block_delta"} <= columns
    assert db.one("SELECT * FROM events WHERE id=?", (identifier,)) == original
    assert original["label_mode"] == "legacy"
