"""Synthetic fixtures only: no demo account contents or real evidence in git."""

import asyncio
import hashlib
import json
import time
import uuid
from unittest.mock import AsyncMock

import httpx
import pytest
from rewind.app import create_app
from rewind.config import Settings
from rewind.demo import DemoIntegrityError
from rewind.history import clear_memory
from rewind.voice import reviewed_answer

HEADERS = {"Authorization": "Bearer " + "a" * 32}


def setup(tmp_path, enabled=True):
    app = create_app(Settings(
        admin_token="a" * 32, device_token="d" * 32, data_dir=tmp_path,
        provider="disabled", workers=0, embeddings=False, min_free_gb=0,
        demo_mode=enabled, demo_response_delay_s=0, _env_file=None,
    ))
    db = app.state.db
    recording_id = str(uuid.uuid4())
    now = time.time()
    original = tmp_path / "recordings" / "test-original.webm"
    original.write_bytes(b"synthetic original fragment")
    digest = hashlib.sha256(original.read_bytes()).hexdigest()
    db.execute("INSERT INTO continuous_recordings VALUES(?,?,?,?,?,?,?,?)",
               (recording_id, "video/webm", now - 100, now, now, now - 80, 1, "stopped"))
    db.execute("INSERT INTO recording_chunks VALUES(?,?,?,?,?,?)",
               (recording_id, 0, original.stat().st_size, digest, str(original), now - 90))

    def media(identifier, boot, seq, inherited=None):
        path = tmp_path / "media" / (identifier + ".jpg")
        path.write_bytes(("synthetic sample " + identifier).encode())
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        db.execute("""INSERT INTO media(id,device,boot,seq,kind,captured_at,received_at,clock_quality,
                   sha256,path,bytes,mime,status) VALUES(?,?,?,?,'frame',?,?,'device',?,?,?,'image/jpeg','done')""",
                   (identifier, "test", boot, seq, now - 90, now, sha, str(path), path.stat().st_size))
        db.execute("""INSERT INTO events(id,captured_at,kind,summary,model,created_at,inherited_from)
                      VALUES(?,?,'frame','Synthetic test object on a test shelf','test',?,?)""",
                   (identifier, now - 90, now, inherited))
        return {"id": identifier, "sha256": sha}

    ancestor = media("ancestor", "older-test", 0)
    pinned = media("pinned", recording_id, 0, ancestor["id"])
    media("same-walk", recording_id, 1)
    media("transient", "new-test", 0)
    manifest = {
        "version": 1,
        "recordings": [{"id": recording_id, "chunks": [{"seq": 0, "sha256": digest}]}],
        "media": [pinned],
        "entries": [{
            "id": "keys", "aliases": ["keys"], "questions": ["Where did I leave the test keys?"],
            "detail_questions": ["Which shelf holds my keys?"],
            "answer": "Your keys were on the test shelf.",
            "details": "Your keys were on the second test shelf, beside the empty box.",
            "evidence_ids": ["pinned"],
            "review": {"reviewed_at": now, "reviewer": "Synthetic test reviewer",
                       "method": "original-evidence-review", "notes": "Test fixture source review."},
        }],
    }
    app.state.memory.demo.path.parent.mkdir(parents=True)
    app.state.memory.demo.path.write_text(json.dumps(manifest))
    return app, manifest


async def test_cache_bypasses_models_and_resolves_short_followups(tmp_path):
    app, manifest = setup(tmp_path)
    memory = app.state.memory
    memory.provider.structured = AsyncMock(side_effect=AssertionError("Cache must not invoke models"))
    short = await memory.ask("Hey Rewind, where are my keys?", allow_chat=True)
    assert short["answer"] == manifest["entries"][0]["answer"]
    assert short["mode"] == "demo_cached" and reviewed_answer(short)
    assert short["verification"]["receipt"]["fresh_model_review"] is False
    assert short["verification"]["receipt"]["reviewer"] == "Synthetic test reviewer"
    assert short["evidence"][0]["media_url"] == "/api/media/pinned"
    assert short["evidence"][0]["original_recording"]["original_url"]
    assert short["evidence_scope"]["continuous_video_inspected"] is False
    long = await memory.ask("Where exactly?", allow_chat=True)
    assert long["answer"] == manifest["entries"][0]["details"]
    assert long["demo"]["detailed"]
    assert await memory.demo.ask("Do you know where my keys are?")
    assert await memory.demo.ask("Hey, can you tell me where my keys are?")
    assert await memory.demo.ask("Which shelf holds my keys?")
    memory.provider.structured.assert_not_called()


@pytest.mark.parametrize("question", [
    "Where are my keys and my bag?", "Where were my keys yesterday?", "Where are all my keys?",
    "Should I take the keys?", "Why are my keys there?", "Where are my glasses?",
])
async def test_cache_does_not_guess_unsupported_or_compound_questions(tmp_path, question):
    app, _ = setup(tmp_path)
    assert await app.state.memory.demo.ask(question) is None
    assert await app.state.memory.demo.ask("Where are my keys?", after=1) is None
    assert await app.state.memory.demo.ask("Where are my keys?", before=time.time()) is None


async def test_followup_requires_immediately_previous_current_demo_answer(tmp_path):
    app, _ = setup(tmp_path)
    memory = app.state.memory
    assert await memory.demo.ask("Where exactly?") is None
    await memory.demo.ask("Where are my keys?")
    memory.save_conversation("Hello", "Hello")
    assert await memory.demo.ask("Where exactly?") is None


async def test_source_change_revokes_cache_and_speech(tmp_path):
    app, _ = setup(tmp_path)
    memory = app.state.memory
    cached = await memory.demo.ask("Where are my keys?")
    assert memory.review(cached["id"])["receipt"]["claims_reviewed"]
    source = tmp_path / "media" / "pinned.jpg"
    source.write_bytes(b"altered image")
    # Even updating the mutable database checksum cannot rewrite the review.
    memory.db.execute("UPDATE media SET sha256=?,bytes=? WHERE id='pinned'",
                      (hashlib.sha256(source.read_bytes()).hexdigest(), source.stat().st_size))
    assert await memory.demo.ask("Where are my keys?") is None
    assert memory.review(cached["id"]) is None
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get(f"/api/voice/speech/{cached['id']}", headers=HEADERS)).status_code == 409
        result = await client.request("DELETE", "/api/memory", headers=HEADERS, json={"confirm": True})
        assert result.status_code == 409
        assert memory.db.one("SELECT id FROM media WHERE id='transient'")


async def test_manifest_change_during_response_beat_cannot_publish_old_answer(tmp_path, monkeypatch):
    app, manifest = setup(tmp_path)
    demo = app.state.memory.demo

    async def mutate(_):
        manifest["entries"][0]["answer"] = "A different reviewed answer."
        demo.path.write_text(json.dumps(manifest))

    monkeypatch.setattr("rewind.demo.asyncio.sleep", mutate)
    assert await demo.ask("Where are my keys?") is None
    assert app.state.db.all("SELECT * FROM answers") == []


async def test_clear_preserves_walkthrough_originals_labels_graph_and_prepared_voice(tmp_path):
    app, _ = setup(tmp_path)
    db, demo = app.state.db, app.state.memory.demo
    cached = await demo.ask("Where are my keys?")
    db.execute("INSERT INTO people VALUES('person','Test person',1,1,1,NULL)")
    db.execute("INSERT INTO person_evidence VALUES('link','person','pinned',?,'face','[]','test',NULL,1,NULL,'explicit')",
               (hashlib.sha256((tmp_path / "media" / "pinned.jpg").read_bytes()).hexdigest(),))
    db.execute("INSERT INTO person_audit VALUES('audit','person','confirm','{}',1)")
    db.execute("INSERT INTO scan_documents(id,media_id,kind,source,data,created_at) "
               "VALUES('scan','transient','bill','Test scan','{}',1)")
    for line in demo.speech_lines():
        app.state.voice._cache_path(line).write_bytes(b"ID3synthetic prepared voice")
    (tmp_path / "voice" / "transient.mp3").write_bytes(b"transient voice")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        denied = await client.delete("/api/media/pinned", headers=HEADERS)
        assert denied.status_code == 409
        denied_same_walk = await client.delete("/api/media/same-walk", headers=HEADERS)
        assert denied_same_walk.status_code == 409
        assert (await client.get('/api/events/pinned', headers=HEADERS)).json()['demo_protected']
        result = await client.request("DELETE", "/api/memory", headers=HEADERS, json={"confirm": True})
        assert result.status_code == 200, result.text
        assert result.json()["protected_media_count"] == 3
        assert result.json()["protected_recording_count"] == 1
        assert db.all("SELECT * FROM scan_documents") == []
        assert db.all("SELECT * FROM answers") == []
        assert db.all("SELECT * FROM demo_answers") == []
        assert not demo.public(cached["id"])
        assert {r["id"] for r in db.all("SELECT id FROM media")} == {"ancestor", "pinned", "same-walk"}
        assert len(db.all("SELECT * FROM events_fts")) == 3
        assert db.one("SELECT id FROM people WHERE id='person'")
        assert db.one("SELECT id FROM person_evidence WHERE id='link'")
        assert db.one("SELECT id FROM person_audit WHERE id='audit'")
        assert not (tmp_path / "media" / "transient.jpg").exists()
        assert (tmp_path / "recordings" / "test-original.webm").is_file()
        assert not (tmp_path / "voice" / "transient.mp3").exists()
        assert all(app.state.voice._cache_path(line).is_file() for line in demo.speech_lines())
        assert (await demo.ask("Where are my keys?"))["mode"] == "demo_cached"
        assert await demo.ask("Where exactly?")
        assert db.one("PRAGMA foreign_key_check") is None


@pytest.mark.parametrize("broken", ["missing", "malformed", "missing-original", "changed-original"])
async def test_bad_protection_fails_closed_without_deleting_anything(tmp_path, broken):
    app, _ = setup(tmp_path)
    demo = app.state.memory.demo
    if broken == "missing":
        demo.path.unlink()
    elif broken == "malformed":
        demo.path.write_text('{"version": 1}')
    elif broken == "missing-original":
        (tmp_path / "recordings" / "test-original.webm").unlink()
    else:
        (tmp_path / "recordings" / "test-original.webm").write_bytes(b"replacement")
    with pytest.raises(DemoIntegrityError):
        demo.protection()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for route in ("/api/memory", "/api/media/transient"):
            response = await client.request("DELETE", route, headers=HEADERS, json={"confirm": True})
            assert response.status_code == 409
    assert len(app.state.db.all("SELECT * FROM media")) == 4
    assert (tmp_path / "media" / "transient.jpg").exists()


async def test_demo_opt_out_keeps_normal_wipe_semantics(tmp_path):
    app, _ = setup(tmp_path, enabled=False)
    demo = app.state.memory.demo
    assert not demo.status()["enabled"]
    assert await demo.ask("Where are my keys?") is None
    clear_memory(app.state.db, tmp_path, time.time())
    assert not app.state.db.all("SELECT * FROM media")
    assert not app.state.db.all("SELECT * FROM continuous_recordings")
    assert not list((tmp_path / "recordings").iterdir())


async def test_configured_response_beat_is_observed(tmp_path, monkeypatch):
    app, _ = setup(tmp_path)
    app.state.settings.demo_response_delay_s = .7
    sleep = AsyncMock()
    monkeypatch.setattr("rewind.demo.asyncio.sleep", sleep)
    assert await app.state.memory.demo.ask("Where are my keys?")
    assert .60 <= sleep.call_args.args[0] <= .88


async def test_voice_same_line_parallel_cache_writers_do_not_race(tmp_path):
    app, _ = setup(tmp_path)
    voice = app.state.voice
    voice.key = "fake-test-only"

    async def audio(*args, **kwargs):
        await asyncio.sleep(.01)
        return httpx.Response(200, content=b"ID3synthetic voice")

    voice.http.post = audio
    paths = await asyncio.gather(*(voice.synthesize("Synthetic test reply.") for _ in range(5)))
    assert len(set(paths)) == 1
    assert paths[0].read_bytes() == b"ID3synthetic voice"
    assert not list(voice.directory.glob("*.tmp"))


async def test_subject_specific_followups_never_attach_to_other_entry(tmp_path):
    app, manifest = setup(tmp_path)
    demo = app.state.memory.demo
    second = {**manifest["entries"][0], "id": "test_person", "aliases": ["test visitor"],
              "questions": [], "detail_questions": ["How is the test visitor resting?"],
              "followups": ["How is he sleeping?", "What is he wearing?"],
              "answer": "The test visitor was resting.", "details": "The test visitor wore a test hat."}
    manifest["entries"].append(second)
    demo.path.write_text(json.dumps(manifest))
    assert await demo.ask("How is he sleeping?") is None
    await demo.ask("Where are my keys?")
    assert await demo.ask("How is he sleeping?") is None
    assert await demo.ask("What is he wearing?") is None
    await demo.ask("Where is the test visitor?")
    followup = await demo.ask("What is he wearing?")
    assert followup["answer"] == second["details"]
    assert await demo.ask("How is she sleeping?") is None


@pytest.mark.parametrize("kind,status", [("chat", "completed"), ("computer", "completed"), ("computer", "acting"),
                                         ("memory", "clarification"), ("memory", "error")])
async def test_newer_conversation_turn_breaks_ambiguous_cached_followup(tmp_path, kind, status):
    app, _ = setup(tmp_path)
    demo = app.state.memory.demo
    await demo.ask("Where are my keys?")
    app.state.db.execute("""INSERT INTO conversation_turns(id,boot,seq,created_at,captured_at,mime,sha256,status,kind)
        VALUES('new-turn','test-turn',0,?,?,'text/plain','test',?,?)""", (time.time(), time.time(), status, kind))
    assert await demo.ask("Tell me more") is None
    assert await demo.ask("Where are my keys?")


async def test_phone_conversation_cache_and_followups_skip_router_and_are_speakable(tmp_path):
    app, manifest = setup(tmp_path)
    conversation = app.state.conversation
    conversation.p.structured = AsyncMock(side_effect=AssertionError("Cached questions must skip model router"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for question, expected in [("Where are my keys?", "answer"), ("Where exactly?", "details")]:
            posted = await client.post("/api/conversation/text", headers=HEADERS,
                                       json={"id": str(uuid.uuid4()), "text": question})
            assert posted.status_code == 200
            await conversation.process(conversation.claim())
            turn = app.state.db.one("SELECT * FROM conversation_turns WHERE id=?", (posted.json()["id"],))
            assert turn["status"] == "completed", turn
            assert turn["response"] == manifest["entries"][0][expected]
            assert conversation.checked_answer(turn["answer_id"])
        conversation.p.structured.assert_not_called()
