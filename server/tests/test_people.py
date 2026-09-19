import hashlib
import json
import time
import uuid

import numpy as np
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from rewind.app import create_app
from rewind.config import Settings
from rewind.db import Database
from rewind.faces import MODEL, normalized, possible_match
from rewind.people import NameConfirmation, NameCorrection, PeopleMemory


def vector(index=0):
    result = [0.0] * 128
    result[index] = 1.0
    return result


@pytest.fixture
def people(tmp_path):
    s = Settings(_env_file=None, data_dir=tmp_path)
    store = PeopleMemory(Database(tmp_path), s)
    media_id = str(uuid.uuid4())
    path = tmp_path / (media_id + ".jpg")
    path.write_bytes(b"original fixture bytes")
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    store.db.execute(
        """INSERT INTO media(id,device,boot,seq,kind,captured_at,received_at,clock_quality,sha256,path,bytes,mime)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            media_id,
            "test",
            "boot",
            0,
            "frame",
            time.time(),
            time.time(),
            "synced",
            sha,
            str(path),
            path.stat().st_size,
            "image/jpeg",
        ),
    )
    result = {
        "model": MODEL,
        "sha256": sha,
        "faces": [
            {"key": "a" * 64, "box": [0.1, 0.2, 0.4, 0.6], "embedding": vector(), "detection_score": 0.99}
        ],
    }
    store.cache[media_id] = (sha, time.monotonic(), result)
    return store, media_id, path


def confirmation(media_id, **kwargs):
    return NameConfirmation(
        request_id=uuid.uuid4(), media_id=media_id, face_key="a" * 64, name="Alice", confirmed=True, **kwargs
    )


async def test_confirmation_is_explicit_original_grounded_and_idempotent(people):
    store, media_id, path = people
    body = confirmation(media_id)
    assert (await store.inspect(media_id))["faces"][0]["match"] == {"status": "unknown"}
    result = await store.confirm(body)
    assert result == await store.confirm(body)
    rows = store.people()
    assert len(rows) == 1 and rows[0]["name"] == "Alice"
    evidence = rows[0]["evidence"][0]
    assert evidence["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert evidence["provenance"] == "user_confirmed_name"
    analyzed = await store.inspect(media_id)
    assert "embedding" not in analyzed["faces"][0]
    assert analyzed["faces"][0]["match"]["status"] == "possible_match"
    assert analyzed["faces"][0]["match"]["requires_confirmation"] is True
    assert store.capabilities()["identity_accuracy_validated"] is False
    with pytest.raises(HTTPException) as exc:
        await store.confirm(body.model_copy(update={"name": "Bob"}))
    assert exc.value.status_code == 409


async def test_correction_preserves_audit_and_rejects_stale_edit(people):
    store, media_id, _ = people
    result = await store.confirm(confirmation(media_id))
    pid = result["person_id"]
    store.db.execute(
        "INSERT INTO answers(id,question,answer,evidence,created_at,grounded,mode) VALUES(?,?,?,?,?,?,?)",
        ("answer", "Who?", "Alice", json.dumps([{"person_id": pid}]), time.time(), 0, "test"),
    )
    store.correct(pid, NameCorrection(name="Alicia", version=1))
    assert store.people()[0]["name"] == "Alicia"
    assert store.people()[0]["version"] == 2
    assert store.db.all("SELECT * FROM answers") == []
    assert len(store.db.all("SELECT * FROM person_audit")) == 2
    with pytest.raises(HTTPException) as exc:
        store.correct(pid, NameCorrection(name="Wrong", version=1))
    assert exc.value.status_code == 409
    assert store.people()[0]["name"] == "Alicia"


async def test_revocation_erases_template_excludes_matching_and_does_not_replay_confirmation(people):
    store, media_id, _ = people
    body = confirmation(media_id)
    result = await store.confirm(body)
    pid = result["person_id"]
    store.revoke(pid)
    store.revoke(pid)
    assert store.people() == [] and store.gallery() == []
    assert store.db.one("SELECT embedding FROM person_evidence")["embedding"] is None
    assert (await store.confirm(body))["status"] == "revoked"
    assert len(store.db.all("SELECT * FROM person_audit")) == 2


async def test_changed_original_is_not_used_as_identity_evidence(people):
    store, media_id, path = people
    await store.confirm(confirmation(media_id))
    path.write_bytes(b"different pixels")
    assert store.gallery() == []
    with pytest.raises(HTTPException) as exc:
        await store.inspect(media_id)
    assert exc.value.status_code == 409


async def test_wrong_face_selection_and_unconfirmed_name_are_rejected(people):
    store, media_id, _ = people
    body = confirmation(media_id)
    with pytest.raises(HTTPException):
        await store.confirm(body.model_copy(update={"face_key": "b" * 64}))
    assert store.people() == []
    with pytest.raises(ValueError):
        NameConfirmation.model_validate({**body.model_dump(), "confirmed": False})


async def test_revoke_single_bad_link_allows_new_explicit_confirmation(people):
    store, media_id, _ = people
    encoded = store.cache[media_id]
    first = await store.confirm(confirmation(media_id))
    store.revoke_evidence(first["evidence_id"])
    store.cache[media_id] = encoded
    second = await store.confirm(confirmation(media_id))
    assert second["person_id"] != first["person_id"]
    assert len(store.gallery()) == 1
    assert store.db.one("SELECT COUNT(*) n FROM person_evidence")["n"] == 2


async def test_indexed_sightings_remain_tentative_follow_corrections_and_stop_on_revocation(people):
    store, media_id, _ = people
    encoded = store.cache[media_id][2]
    result = await store.confirm(confirmation(media_id))
    person_id = result["person_id"]
    store.db.execute(
        "INSERT INTO face_index VALUES(?,?,?,?,?,0)",
        (media_id, encoded["sha256"], MODEL, json.dumps(encoded), time.time()),
    )
    sightings = store.sightings(person_id)
    assert sightings["identity_confirmed"] is False
    assert sightings["coverage"] == {"retained_frames": 1, "indexed_frames": 1}
    assert sightings["possible_sightings"][0]["faces"][0]["match"]["status"] == "possible_match"
    store.correct(person_id, NameCorrection(name="Alicia", version=1))
    assert store.sightings(person_id)["possible_sightings"][0]["faces"][0]["match"]["name"] == "Alicia"
    store.revoke(person_id)
    with pytest.raises(HTTPException) as exc:
        store.sightings(person_id)
    assert exc.value.status_code == 404


async def test_background_index_requires_explicit_enrollment(people, monkeypatch):
    import asyncio

    store, _, _ = people
    called = []

    async def forbidden(*args):
        called.append(True)
        raise AssertionError("Faces must not be automatically indexed before enrollment")

    monkeypatch.setattr(store, "encoded", forbidden)
    task = asyncio.create_task(store.run())
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert called == []


async def test_revocation_during_sighting_search_cannot_return_old_identity(people, monkeypatch):
    store, media_id, _ = people
    result = await store.confirm(confirmation(media_id))
    person_id = result["person_id"]

    def rows():
        store.revoke(person_id)
        return iter(())

    monkeypatch.setattr(store, "indexed_frames", rows)
    with pytest.raises(HTTPException) as exc:
        store.sightings(person_id)
    assert exc.value.status_code == 409


def test_similarity_abstains_for_unknown_ambiguous_and_malformed_vectors():
    base = {"id": "e1", "person_id": "p1", "name": "Alice", "embedding": vector()}
    assert possible_match(vector(1), [base]) == {"status": "unknown"}
    assert possible_match(vector(), [base, {**base, "id": "e2", "person_id": "p2", "name": "Bob"}]) == {
        "status": "ambiguous"
    }
    # Several photos of one person are one candidate, not an artificial tie.
    assert possible_match(vector(), [base, {**base, "id": "e3"}])["status"] == "possible_match"
    for invalid in ([0] * 128, [1], [float("nan")] * 128):
        with pytest.raises(ValueError):
            normalized(invalid)
    assert np.linalg.norm(normalized([2] * 128)) == pytest.approx(1)


def test_people_routes_require_owner_auth_not_ingestion_device_token(tmp_path):
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        workers=0,
        embeddings=False,
        admin_token="admin" * 8,
        device_token="device" * 8,
    )
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/people").status_code == 401
        assert (
            client.get(
                "/api/people", headers={"Authorization": "Bearer " + settings.device_token}
            ).status_code
            == 401
        )
        response = client.get("/api/people", headers={"Authorization": "Bearer " + settings.admin_token})
        assert response.status_code == 200
        assert response.json()["people"] == []
        assert response.json()["capabilities"]["automatic_name_assignment"] is False
