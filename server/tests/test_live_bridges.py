import asyncio
import json
import time
import uuid

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from rewind.app import create_app
from rewind.computer import Computer, ComputerCommand
from rewind.config import Settings
from rewind.context import NotchContext
from rewind.db import Database
from rewind.models import CompactObservation
from rewind.processing import PriorityGate, create_processing_app
from rewind.providers import Provider
from rewind.verification import Verifier


def setup_review(tmp_path, runner):
    s = Settings(_env_file=None, data_dir=tmp_path, embeddings=False)
    db = Database(tmp_path)
    NotchContext(db, s)
    v = Verifier(db, s, runner)
    identifier = str(uuid.uuid4())
    image = tmp_path / "original.jpg"
    image.write_bytes(b"original pixels")
    source = {"id": str(uuid.uuid4()), "kind": "frame"}
    db.execute(
        "INSERT INTO answers VALUES(?,?,?,?,?,?,?,?)",
        (identifier, "What color?", "white", json.dumps([source]), time.time(), None, 0, "checking"),
    )
    packet = {
        "question": "What color?",
        "candidate": {"answer": "White [E1].", "evidence_ids": ["E1"], "insufficient_evidence": False},
        "evidence": [{"id": "E1", "kind": "frame"}],
        "aliases": {"E1": source["id"]},
        "attached_images_in_order": ["E1"],
        "images": [str(image)],
        "digital_sources": [],
        "public_evidence": [source],
    }
    v.enqueue(identifier, packet)
    return db, v, identifier, image


class Runner:
    def __init__(self, responses):
        self.responses, self.calls = responses, []

    async def run(self, model, prompt, images, schema):
        self.calls.append((model, prompt, images))
        result = schema.model_validate(self.responses.pop(0))
        return result, {"model": model, "seconds": 1.0, "result": result.model_dump()}


@pytest.mark.parametrize(
    "winner,expected,mode",
    [
        ("astra", "Red", "verified"),
        ("qwen", "White", "verified"),
        ("neither", "did not establish", "disputed"),
    ],
)
async def test_disagreement_gets_originals_and_sol_decides(tmp_path, winner, expected, mode):
    runner = Runner(
        [
            {
                "verdict": "unsupported",
                "answer": "Red [E1].",
                "reason": "Visible red.",
                "evidence_ids": ["E1"],
            },
            {"winner": winner, "reason": "Source inspected."},
        ]
    )
    db, v, identifier, image = setup_review(tmp_path, runner)
    await v.process(v.claim())
    result = db.one("SELECT * FROM answers WHERE id=?", (identifier,))
    assert result["mode"] == mode and expected in result["answer"]
    assert result["grounded"] == int(mode == "verified")
    assert [c[0] for c in runner.calls] == ["gpt-6-astra", "gpt-5.6-sol"]
    assert all(c[2] == [str(image)] for c in runner.calls)
    assert len(v.public(identifier)["receipt"]["reviews"]) == 2


async def test_astra_agreement_skips_sol(tmp_path):
    runner = Runner(
        [
            {
                "verdict": "supported",
                "answer": "White [E1].",
                "reason": "Visible white.",
                "evidence_ids": ["E1"],
            }
        ]
    )
    db, v, identifier, _ = setup_review(tmp_path, runner)
    await v.process(v.claim())
    assert len(runner.calls) == 1
    assert db.one("SELECT mode FROM answers WHERE id=?", (identifier,))["mode"] == "verified"


async def test_reviewer_fabricated_citation_fails_closed(tmp_path):
    runner = Runner(
        [
            {"verdict": "unsupported", "answer": "Red [E99].", "reason": "Red.", "evidence_ids": ["E99"]},
            {"winner": "astra", "reason": "Red."},
        ]
    )
    db, v, identifier, _ = setup_review(tmp_path, runner)
    await v.process(v.claim())
    result = db.one("SELECT * FROM answers WHERE id=?", (identifier,))
    assert not result["grounded"] and result["mode"] == "unavailable"
    assert "E99" not in result["answer"]


async def test_changed_original_never_reaches_model(tmp_path):
    runner = Runner([])
    db, v, identifier, image = setup_review(tmp_path, runner)
    image.write_bytes(b"changed")
    await v.process(v.claim())
    assert not runner.calls
    assert not db.one("SELECT grounded FROM answers WHERE id=?", (identifier,))["grounded"]


async def test_deleted_answer_cannot_be_resurrected_by_review(tmp_path):
    runner = Runner(
        [{"verdict": "supported", "answer": "White.", "reason": "White.", "evidence_ids": ["E1"]}]
    )
    db, v, identifier, _ = setup_review(tmp_path, runner)
    row = v.claim()
    db.execute("DELETE FROM answers WHERE id=?", (identifier,))
    await v.process(row)
    assert not db.one("SELECT * FROM answers WHERE id=?", (identifier,))
    assert not v.public(identifier)


async def test_priority_gate_puts_question_before_queued_labels():
    gate = PriorityGate()
    order = []

    async def job(name, question=False):
        async with gate.enter(question):
            order.append(name)

    async with gate.enter():
        label = asyncio.create_task(job("label"))
        await asyncio.sleep(0)
        question = asyncio.create_task(job("question", True))
        await asyncio.sleep(0)
    await asyncio.gather(label, question)
    assert order == ["question", "label"]


async def test_remote_inference_forwards_original_and_no_local_fallback(tmp_path):
    s = Settings(_env_file=None, processing_url="http://asus", processing_token="t" * 32, embeddings=False)
    p = Provider(s)
    original = tmp_path / "frame.jpg"
    original.write_bytes(b"original pixels")

    def request(req):
        import base64

        body = json.loads(req.content)
        assert req.headers["authorization"] == "Bearer " + "t" * 32
        assert base64.b64decode(body["images"][0]) == original.read_bytes()
        assert body["schema_name"] == "CompactObservation"
        return httpx.Response(503)

    await p.http.aclose()
    p.http = httpx.AsyncClient(transport=httpx.MockTransport(request))
    with pytest.raises(RuntimeError, match="recording retained"):
        await p.structured("system", "question", CompactObservation, image=original)
    await p.close()


async def test_command_retry_cannot_repeat_action_after_lost_response(tmp_path):
    s = Settings(_env_file=None, notch_control_url="http://localhost:8737", notch_token="private")
    c = Computer(Database(tmp_path), s)
    calls = []

    async def send(route, payload=None):
        calls.append((route, payload))
        raise HTTPException(503, "response lost")

    c.call = send
    body = ComputerCommand(id=uuid.uuid4(), text="Create a document")
    with pytest.raises(HTTPException):
        await c.command(body)
    assert (await c.command(body))["status"] == "delivery_unknown"
    assert len(calls) == 1
    with pytest.raises(HTTPException):
        await c.command(ComputerCommand(id=body.id, text="Different action"))
    await c.http.aclose()


def test_computer_and_processing_authentication(tmp_path):
    s = Settings(
        _env_file=None,
        data_dir=tmp_path,
        admin_token="a" * 32,
        device_token="d" * 32,
        workers=0,
        processing_token="p" * 32,
    )
    with TestClient(create_app(s)) as client:
        for route in ("command", "permission", "cancel"):
            assert client.post("/api/computer/" + route, json={}).status_code == 401
            assert (
                client.post(
                    "/api/computer/" + route, json={}, headers={"Authorization": "Bearer " + s.device_token}
                ).status_code
                == 401
            )
        assert client.get("/api/computer/state").status_code == 401
    with TestClient(create_processing_app(s)) as client:
        assert client.get("/health").status_code == 401
        assert (
            client.get("/health", headers={"Authorization": "Bearer " + s.processing_token}).status_code
            == 200
        )
        result = client.post(
            "/structured",
            json={"system": "", "content": "", "schema_name": "ArbitraryShell"},
            headers={"Authorization": "Bearer " + s.processing_token},
        )
        assert result.status_code == 422


async def test_changed_digital_source_cannot_commit_stale_review(tmp_path):
    runner = Runner(
        [{"verdict": "supported", "answer": "White [E1].", "reason": "White.", "evidence_ids": ["E1"]}]
    )
    db, v, identifier, _ = setup_review(tmp_path, runner)
    source = {
        "id": "digital",
        "source_key": "note:one",
        "kind": "note",
        "title": "Old",
        "text": "Private old text",
        "payload": "{}",
        "synced_at": time.time(),
    }
    db.execute("INSERT INTO context_documents VALUES(?,?,?,?,?,?,?)", tuple(source.values()))
    row = v.claim()
    packet = json.loads(row["packet"])
    packet["digital_sources"] = [source]
    row["packet"] = json.dumps(packet)
    db.execute("UPDATE context_documents SET text='New contents' WHERE id='digital'")
    await v.process(row)
    answer = db.one("SELECT * FROM answers WHERE id=?", (identifier,))
    assert answer["mode"] == "context_changed" and not answer["grounded"]
    assert v.public(identifier)["receipt"]["reviews"] == []


async def test_command_history_preserves_completed_result_after_panel_closes(tmp_path):
    s = Settings(_env_file=None)
    c = Computer(Database(tmp_path), s)
    identifier = str(uuid.uuid4())
    c.db.execute(
        "INSERT INTO computer_commands(id,text,status,created_at) VALUES(?,?,?,?)",
        (identifier, "Test", "accepted", time.time()),
    )
    snapshots = [
        dict(request_id=identifier, state="responding", response="File verified.", success=True),
        dict(request_id=identifier, state="idle", response="", success=False),
    ]

    async def call(route, payload=None):
        return snapshots.pop(0)

    c.call = call
    await c.state()
    await c.state()
    history = c.recent()[0]
    assert history["status"] == "completed"
    assert history["snapshot"]["response"] == "File verified."
    await c.http.aclose()


async def test_visual_index_uses_asus_and_rejects_mixed_model_vectors(tmp_path):
    from rewind.visual import MODEL_KEY, VisualIndex

    class NoLocalInference:
        model_key = MODEL_KEY

        def encode(self, **kwargs):
            raise AssertionError("Must not load a vision encoder on the Mac")

    class Remote:
        key = MODEL_KEY

        async def remote(self, action, payload):
            assert action == "visual"
            return {"model": self.key, "embedding": [3, 4]}

    remote = Remote()
    s = Settings(_env_file=None, processing_url="http://asus")
    index = VisualIndex(Database(tmp_path), s, NoLocalInference(), remote=remote)
    vector = await index.encode(text="glasses")
    assert vector.tolist() == pytest.approx([0.6, 0.8])
    remote.key = "different-model"
    with pytest.raises(ValueError, match="differs"):
        await index.encode(text="glasses")


async def test_disabled_provider_never_contacts_remote(tmp_path):
    p = Provider(Settings(_env_file=None, provider="disabled", processing_url="http://asus"))
    assert not await p.ready()
    with pytest.raises(RuntimeError, match="disabled"):
        await p.structured("system", "question", CompactObservation)
    with pytest.raises(RuntimeError, match="disabled"):
        await p.transcribe(tmp_path / "nonexistent.wav")
    await p.close()
