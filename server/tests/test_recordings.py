import hashlib
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from rewind.config import Settings
from rewind.db import Database
from rewind.recordings import recording_bytes, recording_router


@pytest.fixture
def recording_client(tmp_path):
    db = Database(tmp_path)
    settings = Settings(_env_file=None, data_dir=tmp_path, min_free_gb=0)
    app = FastAPI()

    async def admin(request: Request):
        if request.headers.get("authorization") != "Bearer test-admin":
            raise HTTPException(401)

    app.include_router(recording_router(db, settings, admin))
    client = TestClient(app)
    client.headers["authorization"] = "Bearer test-admin"
    return client, db, settings


def url(identifier):
    return f"/api/continuous-recordings/{identifier}"


def chunk(client, identifier, sequence, data, **headers):
    return client.post(
        f"{url(identifier)}/chunks/{sequence}",
        content=data,
        headers={
            "content-type": "video/webm;codecs=vp8,opus",
            "x-recording-started-at": "1700000000",
            "x-captured-at": str(1700000002 + sequence * 2),
            **headers,
        },
    )


def finish(client, identifier, count=3, reason="stopped"):
    return client.post(
        f"{url(identifier)}/finish",
        json={
            "mime": "video/webm;codecs=vp8,opus",
            "started_at": 1700000000,
            "ended_at": 1700000010,
            "chunks": count,
            "reason": reason,
        },
    )


def test_out_of_order_exact_original_and_idempotent_retry(recording_client):
    client, db, _ = recording_client
    identifier = uuid.uuid4()
    parts = [b"\x1aE\xdf\xa3container-header", b"second-nonstandalone-fragment", b"final-fragment"]
    # Completion may arrive before an earlier in-flight upload. Never call it complete early.
    assert chunk(client, identifier, 2, parts[2]).status_code == 200
    assert not finish(client, identifier).json()["complete"]
    assert client.get(f"{url(identifier)}/original").status_code == 409
    assert chunk(client, identifier, 0, parts[0]).status_code == 200
    assert chunk(client, identifier, 1, parts[1]).status_code == 200
    assert chunk(client, identifier, 1, parts[1]).json()["duplicate"]
    manifest = client.get(url(identifier)).json()
    assert manifest["complete"]
    assert [part["sha256"] for part in manifest["chunks"]] == [hashlib.sha256(p).hexdigest() for p in parts]
    assert manifest["fragment_format"] == "ordered-container-fragments"
    assert client.get(f"{url(identifier)}/original").content == b"".join(parts)
    assert recording_bytes(db) == sum(map(len, parts))
    assert finish(client, identifier).status_code == 200
    assert "chunks" not in client.get("/api/continuous-recordings").json()[0]


def test_conflicting_retry_and_metadata_never_replace_original(recording_client):
    client, _, _ = recording_client
    identifier = uuid.uuid4()
    original = b"\x1aE\xdf\xa3original"
    assert chunk(client, identifier, 0, original).status_code == 200
    assert chunk(client, identifier, 0, b"\x1aE\xdf\xa3changed").status_code == 409
    assert (
        chunk(client, identifier, 1, b"more", **{"x-recording-started-at": "1700000001"}).status_code == 409
    )
    assert finish(client, identifier, count=1).status_code == 200
    assert finish(client, identifier, count=2).status_code == 409
    assert chunk(client, identifier, 1, b"too-late").status_code == 409
    assert client.get(f"{url(identifier)}/original").content == original


@pytest.mark.parametrize(
    "range_header,start,end", [("bytes=3-20", 3, 20), ("bytes=5-", 5, 36), ("bytes=-6", 31, 36)]
)
def test_playback_byte_ranges_cross_fragment_boundaries(recording_client, range_header, start, end):
    client, _, _ = recording_client
    identifier = uuid.uuid4()
    parts = [b"\x1aE\xdf\xa3header", b"middle", b"final-fragment-123456"]
    original = b"".join(parts)
    assert len(original) == 37
    for sequence, part in enumerate(parts):
        assert chunk(client, identifier, sequence, part).status_code == 200
    assert finish(client, identifier).status_code == 200
    response = client.get(f"{url(identifier)}/original", headers={"range": range_header})
    assert response.status_code == 206
    assert response.content == original[start : end + 1]
    assert response.headers["content-range"] == f"bytes {start}-{end}/37"
    assert response.headers["content-length"] == str(end - start + 1)
    for invalid in ("bytes=999-", "bytes=10-3", "bytes=-0", "bytes=0-2,7-9", "bytes=-"):
        assert client.get(f"{url(identifier)}/original", headers={"range": invalid}).status_code == 416


def test_auth_required_for_metadata_original_and_upload(recording_client):
    client, _, _ = recording_client
    identifier = uuid.uuid4()
    client.headers.clear()
    assert client.get("/api/continuous-recordings").status_code == 401
    assert client.get(url(identifier)).status_code == 401
    assert client.get(f"{url(identifier)}/original").status_code == 401
    assert chunk(client, identifier, 0, b"\x1aE\xdf\xa3header").status_code == 401
    assert finish(client, identifier).status_code == 401


def test_missing_fragment_never_claimed_complete(recording_client):
    client, _, _ = recording_client
    identifier = uuid.uuid4()
    assert chunk(client, identifier, 0, b"\x1aE\xdf\xa3header").status_code == 200
    assert chunk(client, identifier, 2, b"later").status_code == 200
    assert finish(client, identifier, count=2).status_code == 409
    result = finish(client, identifier, reason="page_closed").json()
    assert result["end_reason"] == "page_closed" and not result["complete"]
    assert client.get(f"{url(identifier)}/original").status_code == 409


def test_empty_interrupted_session_and_first_fragment_validation(recording_client):
    client, _, _ = recording_client
    identifier = uuid.uuid4()
    assert chunk(client, identifier, 0, b"not-a-container").status_code == 415
    assert chunk(client, identifier, -1, b"\x1aE\xdf\xa3header").status_code == 422
    assert chunk(client, identifier, 0, b"\x1aE\xdf\xa3header", **{"x-captured-at": "nan"}).status_code == 422
    result = finish(client, identifier, count=0, reason="interrupted").json()
    assert result["complete"] and result["original_url"] is None
    assert client.get(f"{url(identifier)}/original").status_code == 409


def test_upload_and_storage_caps_leave_saved_originals_intact(recording_client):
    client, db, settings = recording_client
    identifier = uuid.uuid4()
    first = b"\x1aE\xdf\xa3header"
    assert chunk(client, identifier, 0, first).status_code == 200
    settings.max_upload_bytes = 3
    assert chunk(client, identifier, 1, b"oversized").status_code == 413
    settings.max_upload_bytes = 100
    settings.max_storage_gb = 0.00000001
    assert chunk(client, identifier, 1, b"more").status_code == 507
    assert recording_bytes(db) == len(first)
    assert finish(client, identifier, count=1, reason="storage_full").json()["complete"]
    assert client.get(f"{url(identifier)}/original").content == first


def test_mp4_fragments_preserve_original_order(recording_client):
    client, _, _ = recording_client
    identifier = uuid.uuid4()
    first = b"\x00\x00\x00\x20ftypisom-original-header"
    headers = {"content-type": "video/mp4"}
    assert chunk(client, identifier, 1, b"moof-mdat-fragment", **headers).status_code == 200
    assert chunk(client, identifier, 0, first, **headers).status_code == 200
    response = client.post(
        f"{url(identifier)}/finish",
        json={
            "mime": "video/mp4",
            "started_at": 1700000000,
            "ended_at": 1700000010,
            "chunks": 2,
            "reason": "hidden",
        },
    )
    assert response.json()["complete"]
    original = client.get(f"{url(identifier)}/original")
    assert original.headers["content-type"].startswith("video/mp4")
    assert original.content == first + b"moof-mdat-fragment"


def test_same_length_corruption_is_rejected_after_successfully_cached_playback(recording_client):
    client, db, _ = recording_client
    identifier = uuid.uuid4()
    original = b"\x1aE\xdf\xa3original-camera-bytes"
    assert chunk(client, identifier, 0, original).status_code == 200
    assert finish(client, identifier, count=1).status_code == 200
    assert client.get(f"{url(identifier)}/original").content == original
    row = db.one("SELECT * FROM recording_chunks WHERE recording_id=?", (str(identifier),))
    changed = original[:-1] + b"!"
    Path(row["path"]).write_bytes(changed)
    assert len(changed) == row["bytes"]
    # A same-length edit invalidates the fingerprint cache; neither full nor
    # range playback can present the changed bytes as the retained original.
    assert client.get(f"{url(identifier)}/original").status_code == 410
    assert client.get(f"{url(identifier)}/original", headers={"range": "bytes=0-3"}).status_code == 410
    assert (
        db.one("SELECT sha256 FROM recording_chunks WHERE recording_id=?", (str(identifier),))["sha256"]
        == hashlib.sha256(original).hexdigest()
    )


def test_truncated_fragment_fails_before_streaming_response(recording_client):
    client, db, _ = recording_client
    identifier = uuid.uuid4()
    assert chunk(client, identifier, 0, b"\x1aE\xdf\xa3original").status_code == 200
    assert finish(client, identifier, count=1).status_code == 200
    row = db.one("SELECT path FROM recording_chunks WHERE recording_id=?", (str(identifier),))
    Path(row["path"]).write_bytes(b"short")
    response = client.get(f"{url(identifier)}/original")
    assert response.status_code == 410
    assert "retained hash" in response.json()["detail"]
