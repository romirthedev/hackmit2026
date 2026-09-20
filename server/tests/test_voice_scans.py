import asyncio
import io
import json
import time
import wave

import httpx
import pytest
from fastapi import HTTPException
from PIL import Image
from rewind.app import create_app
from rewind.config import Settings
from rewind.scans import DEMO_DOCUMENTS, DocumentScan, ScannedDocument, merge_with_template
from rewind.voice import Voice, reviewed_spoken_text, spoken_text

ADMIN = "a" * 32
DEVICE = "d" * 32


@pytest.mark.parametrize(
    "heard,directed,question",
    [
        ("Rewind, where are my glasses?", True, "where are my glasses?"),
        ("rewind where did I leave the keys", True, "where did I leave the keys"),
        ("Hey Rewind. Did I take my pills this morning?", True, "Did I take my pills this morning?"),
        ("Re-wind, what did Emma say?", True, "what did Emma say?"),
        ("Re wind what time is it", True, "what time is it"),
        ("Rewind", True, ""),
        ("I told him to rewind the tape.", False, ""),
        ("Where are my glasses?", False, ""),
        ("", False, ""),
    ],
)
def test_wake_word_parsing(heard, directed, question):
    parsed = Voice.parse(heard, require_wake=True)
    assert parsed["directed"] is directed
    assert parsed["question"] == question


def test_wake_word_not_required_for_button_presses():
    parsed = Voice.parse("Where are my glasses?", require_wake=False)
    assert parsed == {
        "transcript": "Where are my glasses?",
        "directed": True,
        "question": "Where are my glasses?",
    }


def test_spoken_text_preview_is_short_but_reviewed_speech_keeps_qualifications():
    answer = (
        "Your glasses were last on the kitchen counter around 2:40. [3f2b1a10-1111-4222-8333-444455556666]\n\n"
        "This answer used sampled images; the full recording was not decoded."
    )
    assert spoken_text(answer) == "Your glasses were last on the kitchen counter around 2:40."
    assert "full recording was not decoded" in reviewed_spoken_text(answer)
    assert "3f2b1a10" not in reviewed_spoken_text(answer)
    assert spoken_text("[E1] [E2]") == "I couldn't find that in your day."


def test_template_is_ground_truth_and_keeps_order():
    found = [
        ScannedDocument(kind="bill", amount="$45", due_date="Sept 30", recipient="").model_dump(),
        ScannedDocument(kind="letter", sender="Emma", message="Save me pie!").model_dump(),
        ScannedDocument(kind="other", title="Grocery receipt", message="$12.40 at Shaw's").model_dump(),
    ]
    merged = merge_with_template(found)
    assert [d["kind"] for d in merged] == ["postcard", "bill", "other"]
    postcard, bill, extra = merged
    # The printed text wins over the model's paraphrase.
    assert postcard["message"] == DEMO_DOCUMENTS[0]["message"]
    assert postcard["date"] == DEMO_DOCUMENTS[0]["date"]
    assert bill["amount"] == "$45.00" and bill["due_date"] == "2026-09-30"
    assert {postcard["source"], bill["source"]} == {"model+template"}
    assert extra["source"] == "model" and extra["title"] == "Grocery receipt"


def test_model_fills_blank_template_fields_only_with_iso_dates():
    template_blank = {**DEMO_DOCUMENTS[0], "date": ""}
    found = [ScannedDocument(kind="postcard", date="September 14th").model_dump()]
    from unittest.mock import patch

    with patch("rewind.scans.DEMO_DOCUMENTS", [template_blank, DEMO_DOCUMENTS[1]]):
        merged = merge_with_template(found)
    assert merged[0]["date"] == ""
    with patch("rewind.scans.DEMO_DOCUMENTS", [template_blank, DEMO_DOCUMENTS[1]]):
        merged = merge_with_template([ScannedDocument(kind="postcard", date="2026-09-14").model_dump()])
    assert merged[0]["date"] == "2026-09-14"


def test_template_alone_when_model_found_nothing():
    merged = merge_with_template([])
    assert [d["source"] for d in merged] == ["template", "template"]
    assert DocumentScan(documents=[]).documents == []


def settings(tmp_path, **extra):
    return Settings(
        admin_token=ADMIN,
        device_token=DEVICE,
        data_dir=tmp_path / "data",
        provider="disabled",
        workers=0,
        embeddings=False,
        _env_file=None,
        **extra,
    )


def jpeg():
    buffer = io.BytesIO()
    Image.new("RGB", (64, 48), (240, 230, 210)).save(buffer, "JPEG")
    return buffer.getvalue()


def wav(seconds=0.5):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * int(16000 * seconds))
    return buffer.getvalue()


async def test_scan_upload_files_documents_and_calendar_entries(tmp_path):
    app = create_app(settings(tmp_path))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            headers = {"Authorization": "Bearer " + ADMIN}
            response = await client.post(
                "/api/ingest/frame",
                content=jpeg(),
                headers={
                    **headers,
                    "Content-Type": "image/jpeg",
                    "X-Boot-ID": "phone",
                    "X-Sequence": "0",
                    "X-Captured-At": str(time.time()),
                    "X-Intent": "scan",
                },
            )
            assert response.status_code == 201, response.text
            media_id = response.json()["id"]
            await asyncio.gather(*app.state.scans.tasks)
            documents = (await client.get("/api/scans", headers=headers)).json()
            assert [d["kind"] for d in documents] == ["bill", "postcard"]
            bill = documents[0]
            assert bill["media_id"] == media_id
            assert bill["image_url"] == f"/api/media/{media_id}"
            assert bill["due_date"] == "2026-09-30" and bill["due_at"] is not None
            assert bill["source"] == "template"
            # The scanned photo is also an ordinary saved moment.
            recordings = (await client.get("/api/recordings", headers=headers)).json()
            assert recordings[0]["intent"] == "scan"
            assert (await client.post(f"/api/scans/{bill['id']}/seen", headers=headers)).json() == {
                "ok": True
            }
            assert (await client.delete(f"/api/scans/{bill['id']}", headers=headers)).status_code == 200
            assert len((await client.get("/api/scans", headers=headers)).json()) == 1


async def test_rescanning_the_same_mail_replaces_the_earlier_copy(tmp_path):
    app = create_app(settings(tmp_path))
    scans = app.state.scans
    first = scans.insert_template()
    second = scans.insert_template()
    assert len(scans.list()) == 2
    assert {d["id"] for d in first}.isdisjoint({d["id"] for d in second})


async def test_scan_intent_is_only_for_frames(tmp_path):
    app = create_app(settings(tmp_path))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/ingest/audio",
            content=wav(),
            headers={
                "Authorization": "Bearer " + ADMIN,
                "Content-Type": "audio/wav",
                "X-Boot-ID": "phone",
                "X-Sequence": "0",
                "X-Intent": "scan",
            },
        )
        assert response.status_code == 400


async def test_voice_routes_without_deepgram(tmp_path):
    app = create_app(settings(tmp_path))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        headers = {"Authorization": "Bearer " + ADMIN}
        status = (await client.get("/api/voice/status", headers=headers)).json()
        assert status["deepgram"] is False and status["wake_word"] == "rewind"
        # No key: spoken replies are unavailable, the browser voice takes over.
        assert (
            await client.post("/api/voice/speak", json={"text": "hello"}, headers=headers)
        ).status_code == 503
        assert (await client.get("/api/voice/filler", headers=headers)).status_code == 503
        # An empty question still gets a short spoken-style reply without calling the model.
        reply = (await client.post("/api/voice/ask", json={"question": " "}, headers=headers)).json()
        assert reply["answer"] is None and reply["speech_url"] is None and reply["spoken"]
        assert (
            await client.post(
                "/api/voice/hear", content=b"x", headers={**headers, "Content-Type": "text/plain"}
            )
        ).status_code == 415
        assert (
            await client.post(
                "/api/voice/hear", content=b"x", headers={**headers, "Content-Type": "audio/wav"}
            )
        ).status_code == 400
        assert (await client.get("/api/voice/status")).status_code == 401


async def test_voice_with_fake_deepgram(tmp_path):
    app = create_app(settings(tmp_path, deepgram_api_key="dg-test"))
    voice: Voice = app.state.voice
    calls = []

    def handler(request: httpx.Request):
        calls.append((request.url.path, dict(request.url.params), request.headers.get("authorization")))
        if request.url.path == "/v1/listen":
            return httpx.Response(
                200,
                json={
                    "results": {
                        "channels": [
                            {
                                "alternatives": [
                                    {"transcript": "Rewind, where are my glasses?", "confidence": 0.98}
                                ]
                            }
                        ]
                    }
                },
            )
        assert json.loads(request.content)["text"]
        return httpx.Response(200, content=b"ID3fake-mp3")

    voice.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        headers = {"Authorization": "Bearer " + ADMIN}
        heard = (
            await client.post(
                "/api/voice/hear", content=wav(), headers={**headers, "Content-Type": "audio/wav"}
            )
        ).json()
        assert heard["directed"] is True and heard["question"] == "where are my glasses?"
        assert calls[0][0] == "/v1/listen" and calls[0][1]["keyterm"] == "Rewind"
        assert calls[0][2] == "Token dg-test"
        spoken = await client.post("/api/voice/speak", json={"text": "Hello Rose [E1]"}, headers=headers)
        assert spoken.status_code == 200 and spoken.headers["content-type"] == "audio/mpeg"
        assert spoken.content == b"ID3fake-mp3"
        # Cached: the same line is not synthesized twice.
        before = len(calls)
        await client.post("/api/voice/speak", json={"text": "Hello Rose [E1]"}, headers=headers)
        assert len(calls) == before
        filler = await client.get("/api/voice/filler", headers=headers)
        assert filler.status_code == 200 and filler.headers["content-type"] == "audio/mpeg"
        # /ask against a disabled provider: the memory's own no-evidence reply is spoken.
        asked = (
            await client.post("/api/voice/ask", json={"question": "where are my glasses?"}, headers=headers)
        ).json()
        assert asked["answer"]["mode"] == "no_evidence"
        assert asked["spoken"].startswith("I couldn't find that")
        assert asked["speech_url"].startswith("/api/voice/say?text=")
        assert (
            await client.get(f"/api/voice/speech/{asked['answer']['id']}", headers=headers)
        ).status_code == 409
        speech = await client.get(asked["speech_url"], headers=headers)
        assert speech.status_code == 200 and speech.content == b"ID3fake-mp3"
    with pytest.raises(HTTPException):
        voice.http = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
        await voice.synthesize("never cached")


async def test_scanned_mail_is_recall_evidence(tmp_path):
    from rewind.models import RecallAnswer

    app = create_app(settings(tmp_path))
    app.state.scans.insert_template()
    packets = []

    class Provider:
        async def embed(self, text):
            return None

        async def structured(self, prompt, body, schema, **kwargs):
            packet = json.loads(body)
            packets.append(packet)
            bill = next(item for item in packet["evidence"] if item.get("source_kind") == "scanned bill")
            assert bill["due_date"] == "2026-09-30"
            assert "photographed with Scan" in bill["source"]
            return RecallAnswer(
                answer="Your copay of $45 for Dr. Shah is due September 30.",
                evidence_ids=[bill["id"]],
                insufficient_evidence=False,
            )

    memory = app.state.memory
    memory.provider = Provider()
    answer = await memory.ask("When is my doctor's bill due?")
    assert answer["grounded"] is True
    assert answer["evidence"][0]["source"] == "scan"
    assert answer["evidence"][0]["kind"] == "context"
    assert answer["evidence"][0]["media_url"] == ""
    assert "$45" in answer["answer"]
    # Recall packets count scanned mail as digital text, not camera samples.
    scans = app.state.scans
    assert scans.search("what did Emma write")[0]["context_kind"] == "scanned postcard"
    assert scans.search("purple elephants") == []


@pytest.mark.parametrize(
    "mode,claims_reviewed,allowed",
    [
        ("checking", False, False),
        ("checking", True, False),
        ("model", False, False),
        ("legacy_unverified", False, False),
        ("verified", False, False),
        ("insufficient", False, False),
        ("verified", True, True),
        ("insufficient", True, True),
    ],
)
async def test_voice_never_synthesizes_unreviewed_answers(tmp_path, mode, claims_reviewed, allowed):
    app = create_app(settings(tmp_path, deepgram_api_key="fake-test-only"))
    voice = app.state.voice
    identifier = "77777777-7777-4777-8777-777777777777"
    text = "MODEL_CLAIM.\n\nOnly a sampled image was checked; the later event is unknown."
    receipt = {"claims_reviewed": claims_reviewed}
    record = {
        "id": identifier,
        "question": "What happened?",
        "answer": text,
        "mode": mode,
        "evidence": [],
        "grounded": allowed,
        "verification": {"status": "complete" if claims_reviewed else "pending", "receipt": receipt},
    }
    voice.memory.db.execute(
        "INSERT INTO answers(id,question,answer,evidence,created_at,grounded,mode) VALUES(?,?,?,?,?,?,?)",
        (identifier, record["question"], text, "[]", time.time(), int(allowed), mode),
    )

    class Reviewer:
        def public(self, answer_id):
            assert answer_id == identifier
            return record["verification"]

    voice.memory.verifier = Reviewer()

    async def ask(*args):
        return record

    synthesized = []
    audio = tmp_path / "fixture.mp3"
    audio.write_bytes(b"ID3fixture")

    async def synthesize(value):
        synthesized.append(value)
        return audio

    voice.memory.ask = ask
    voice.synthesize = synthesize
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            headers = {"Authorization": "Bearer " + ADMIN}
            response = await client.post(
                "/api/voice/ask", headers=headers, json={"question": "What happened?"}
            )
            assert response.status_code == 200
            reply = response.json()
            assert reply["answer"]["id"] == identifier and reply["answer"]["mode"] == mode
            direct = await client.get(f"/api/voice/speech/{identifier}", headers=headers)
            if allowed:
                assert reply["spoken"] == text
                assert direct.status_code == 200
                assert synthesized == [text, text]
                # Cached audio must not bypass a later invalidated answer state.
                voice.memory.db.execute("UPDATE answers SET mode='checking' WHERE id=?", (identifier,))
                assert (
                    await client.get(f"/api/voice/speech/{identifier}", headers=headers)
                ).status_code == 409
                assert synthesized == [text, text]
            else:
                assert "MODEL_CLAIM" not in reply["spoken"]
                assert reply["speech_url"] is None
                assert direct.status_code == 409
                assert synthesized == []
            assert (await client.get(f"/api/voice/speech/{identifier}")).status_code == 401
    finally:
        await voice.close()


async def test_long_reviewed_speech_is_not_silently_truncated(tmp_path):
    app = create_app(settings(tmp_path, deepgram_api_key="fake-test-only"))
    voice = app.state.voice
    full = "A recorded observation. " * 70 + "The final outcome is not established."
    assert len(full) > 1500
    assert reviewed_spoken_text(full).endswith("The final outcome is not established.")
    calls = []
    await voice.http.aclose()
    voice.http = httpx.AsyncClient(transport=httpx.MockTransport(lambda req: calls.append(req)))
    try:
        with pytest.raises(HTTPException) as error:
            await voice.synthesize(full)
        assert error.value.status_code == 413
        assert calls == []
    finally:
        await voice.close()
