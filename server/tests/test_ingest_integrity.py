import hashlib
import json
from pathlib import Path

import pytest
from rewind.memory import Memory
from rewind.verification import EvidenceIntegrityError, Verifier
from test_day_memory import add_frame
from test_day_memory import workspace as workspace
from test_live_bridges import setup_review
from test_partial_reviews import CandidateProvider, Runner


def original_path(db, identifier):
    return Path(db.one("SELECT path FROM media WHERE id=?", (identifier,))["path"])


async def test_original_modified_before_question_never_reaches_qwen_or_astra(workspace):
    db, settings, provider = workspace
    identifier = add_frame(workspace, 1000, summary="Green cup on counter")
    original_path(db, identifier).write_bytes(b"different pixels before asking")
    runner = Runner()
    verifier = Verifier(db, settings, runner)
    result = await Memory(db, provider, settings, verifier=verifier).ask("Recap my day", after=0, before=2000)
    assert not provider.calls and not runner.calls
    assert result["mode"] == "source_changed" and not result["grounded"]
    assert not result["evidence"] and verifier.claim() is None
    assert result["recording_coverage"]["selected_images_unavailable"] == 1
    assert result["recording_coverage"]["excluded_changed_or_missing_sources"] == 1
    assert "green cup" not in result["answer"].lower()


async def test_changed_source_caption_is_removed_while_intact_original_remains_usable(workspace):
    db, settings, provider = workspace
    changed = add_frame(workspace, 1000, summary="Secret changed caption")
    intact = add_frame(workspace, 1500, summary="Intact source")
    original_path(db, changed).write_bytes(b"changed")
    result = await Memory(db, provider, settings).ask("Recap my day", after=0, before=2000)
    packet = provider.calls[0][1]
    assert len(provider.calls[0][2]) == 1
    assert changed not in json.dumps(packet)
    assert "Secret changed caption" not in json.dumps(packet)
    assert {source["id"] for source in result["evidence"]} == {intact}
    assert result["recording_coverage"]["selected_images_unavailable"] == 1


async def test_original_changed_during_qwen_cannot_become_new_review_hash_baseline(workspace):
    db, settings, _ = workspace
    identifier = add_frame(workspace, 1000, summary="Green cup on counter")
    saved_digest = db.one("SELECT sha256 FROM media WHERE id=?", (identifier,))["sha256"]

    class MutatingProvider(CandidateProvider):
        async def structured(self, *args, **kwargs):
            original_path(db, identifier).write_bytes(b"changed after model attachment")
            return await super().structured(*args, **kwargs)

    verifier = Verifier(db, settings, Runner())
    result = await Memory(db, MutatingProvider(insufficient=False), settings, verifier=verifier).ask(
        "What color is the cup?",
        after=0,
        before=2000,
    )
    assert result["mode"] == "source_changed" and not result["grounded"]
    assert not result["evidence"] and verifier.claim() is None
    assert "green cup" not in result["answer"].lower()
    assert db.one("SELECT sha256 FROM media WHERE id=?", (identifier,))["sha256"] == saved_digest


async def test_original_changed_between_final_check_and_enqueue_persists_safe_answer(workspace):
    db, settings, _ = workspace
    identifier = add_frame(workspace, 1000, summary="Green cup on counter")

    class RacingVerifier(Verifier):
        def enqueue(self, answer_id, packet, connection=None):
            path = original_path(db, identifier)
            expected = packet["expected_image_hashes"][str(path)]
            assert expected == db.one("SELECT sha256 FROM media WHERE id=?", (identifier,))["sha256"]
            path.write_bytes(b"changed just before queue insertion")
            assert hashlib.sha256(path.read_bytes()).hexdigest() != expected
            return super().enqueue(answer_id, packet, connection)

    verifier = RacingVerifier(db, settings, Runner())
    result = await Memory(db, CandidateProvider(insufficient=False), settings, verifier=verifier).ask(
        "What color is the cup?",
        after=0,
        before=2000,
    )
    assert result["mode"] == "source_changed" and not result["grounded"]
    assert result["evidence"] == [] and result["verification"] is None
    assert verifier.claim() is None
    stored = db.one("SELECT * FROM answers WHERE id=?", (result["id"],))
    assert stored["mode"] == "source_changed" and stored["evidence"] == "[]"
    assert "green cup" not in stored["answer"].lower()


async def test_queued_packet_uses_ingest_hash_and_legacy_fresh_hash_packet_fails_closed(tmp_path):
    runner = Runner()
    db, verifier, identifier, _ = setup_review(tmp_path, runner)
    row = verifier.claim()
    packet = json.loads(row["packet"])
    assert packet["image_hashes"] == packet["expected_image_hashes"]
    del packet["expected_image_hashes"]
    row["packet"] = json.dumps(packet)
    await verifier.process(row)
    assert not runner.calls
    assert db.one("SELECT mode FROM answers WHERE id=?", (identifier,))["mode"] == "unavailable"
    with pytest.raises(EvidenceIntegrityError):
        verifier.enqueue(identifier, packet)
