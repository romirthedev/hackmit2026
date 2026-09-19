import json
import uuid
from pathlib import Path

import pytest
from rewind.memory import Memory
from rewind.models import RecallAnswer
from rewind.sampled_evidence import attach_original_recordings, sample_scope_qualification
from rewind.verification import Verifier
from test_day_memory import add_frame
from test_day_memory import workspace as workspace
from test_recordings import chunk, finish
from test_recordings import recording_client as recording_client


def evidence(identifier):
    return [{"id": "sample", "boot": str(identifier), "kind": "frame", "clock_quality": "device"}]


def test_full_original_links_are_private_and_return_exact_bytes(recording_client):
    client, db, _ = recording_client
    identifier = uuid.uuid4()
    original = b"\x1aE\xdf\xa3original-camera-bytes"
    assert chunk(client, identifier, 0, original).status_code == 200
    assert finish(client, identifier, count=1, reason="hidden").status_code == 200
    sources = evidence(identifier)
    scope = attach_original_recordings(db, sources)
    full = sources[0]["original_recording"]
    assert full["complete"] and full["status"] == "complete"
    assert full["end_reason"] == "hidden"  # Byte completeness is not an uninterrupted day.
    assert not full["continuous_video_inspected"]
    assert scope["between_sample_actions_may_be_missing"]
    assert client.get(full["original_url"]).content == original
    client.headers.clear()
    assert client.get(full["original_url"]).status_code == 401
    assert "path" not in json.dumps(scope)


def test_missing_chunks_open_sessions_and_missing_files_never_get_playable_links(recording_client):
    client, db, _ = recording_client
    identifier = uuid.uuid4()
    assert chunk(client, identifier, 0, b"\x1aE\xdf\xa3header").status_code == 200
    sources = evidence(identifier)
    attach_original_recordings(db, sources)
    assert sources[0]["original_recording"]["status"] == "open"
    assert sources[0]["original_recording"]["original_url"] is None
    assert finish(client, identifier, count=2).status_code == 200
    attach_original_recordings(db, sources)
    assert sources[0]["original_recording"]["status"] == "uploading"
    assert sources[0]["original_recording"]["original_url"] is None
    assert chunk(client, identifier, 1, b"last-fragment").status_code == 200
    path = db.one("SELECT path FROM recording_chunks WHERE recording_id=? AND seq=1", (str(identifier),))[
        "path"
    ]
    Path(path).unlink()
    attach_original_recordings(db, sources)
    full = sources[0]["original_recording"]
    assert full["status"] == "missing_fragment" and not full["complete"]
    assert full["manifest_complete"] and full["original_url"] is None


def test_only_exact_session_identity_is_linked_and_synthetic_timeline_does_not_match(recording_client):
    client, db, _ = recording_client
    identifier = uuid.uuid4()
    assert chunk(client, identifier, 0, b"\x1aE\xdf\xa3header").status_code == 200
    assert finish(client, identifier, count=1).status_code == 200
    sources = evidence(uuid.uuid4()) + [{**evidence(identifier)[0], "clock_quality": "synthetic"}]
    scope = attach_original_recordings(db, sources)
    assert scope["continuous_originals"] == []
    assert all("original_recording" not in source for source in sources)


def test_corrupted_same_length_fragment_never_gets_original_evidence_link(recording_client):
    client, db, _ = recording_client
    identifier = uuid.uuid4()
    original = b"\x1aE\xdf\xa3original-fragment"
    assert chunk(client, identifier, 0, original).status_code == 200
    assert finish(client, identifier, count=1).status_code == 200
    sources = evidence(identifier)
    attach_original_recordings(db, sources)
    assert sources[0]["original_recording"]["original_url"]
    path = Path(db.one("SELECT path FROM recording_chunks WHERE recording_id=?", (str(identifier),))["path"])
    path.write_bytes(original[:-1] + b"!")
    attach_original_recordings(db, sources)
    current = sources[0]["original_recording"]
    assert current["manifest_complete"]
    assert not current["complete"] and current["status"] == "corrupt_fragment"
    assert current["original_url"] is None


@pytest.mark.parametrize(
    "question,answer,qualify",
    [
        ("What color is the cup?", "The visible cup is green.", False),
        ("Is there a mat in the frame?", "No mat is visible in this frame.", False),
        ("Did I ever put down the keys?", "I saw keys in your hand.", True),
        ("Did I put down the keys?", "No, you did not put them down.", True),
        ("Where were my keys?", "The available evidence cannot establish where they were.", False),
    ],
)
def test_scope_qualification_is_reserved_for_exhaustive_or_unqualified_absence(question, answer, qualify):
    scope = {"selected_frame_samples": 2}
    assert bool(sample_scope_qualification(question, answer, scope)) is qualify


async def test_focused_scope_reaches_review_without_repetitive_prose_for_simple_question(workspace):
    db, settings, _ = workspace
    add_frame(workspace, 1000, summary="Green cup on a counter")

    class Provider:
        async def embed(self, text):
            return None

        async def structured(self, system, body, schema, **kwargs):
            data = json.loads(body)
            assert not data["evidence_scope"]["continuous_video_inspected"]
            assert "do not claim to have watched it" in system
            return RecallAnswer(
                answer="The cup is green [E1].", evidence_ids=["E1"], insufficient_evidence=False
            )

    class Runner:
        async def run(self, model, prompt, images, schema):
            data = json.loads(prompt.rsplit("\n", 1)[-1])
            assert not data["evidence_scope"]["continuous_video_inspected"]
            result = schema.model_validate(
                {
                    "verdict": "supported",
                    "insufficient_evidence": False,
                    "answer": "The cup is green [E1].",
                    "evidence_ids": ["E1"],
                    "reason": "Pixels support the color.",
                }
            )
            return result, {"model": model, "result": result.model_dump()}

    verifier = Verifier(db, settings, Runner())
    result = await Memory(db, Provider(), settings, verifier=verifier).ask("What color is the cup?")
    assert "cannot rule out" not in result["answer"]
    await verifier.process(verifier.claim())
    assert "cannot rule out" not in db.one("SELECT answer FROM answers WHERE id=?", (result["id"],))["answer"]
    assert not verifier.public(result["id"])["receipt"]["evidence_scope"]["continuous_video_inspected"]
