import asyncio
import io
import json
import time
import uuid
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from rewind.computer import Computer
from rewind.config import Settings
from rewind.conversation import Conversation, conversation_router
from rewind.db import Database
from rewind.models import ConversationIntent
from rewind.storage import retained_bytes
from rewind.worker import Worker


def speech():
    data = io.BytesIO()
    with wave.open(data, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(16000)
        stream.writeframes(b"\x00\x00" * 1600)
    return data.getvalue()


@pytest.fixture
def conversation(tmp_path):
    db = Database(tmp_path)
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        min_free_gb=0,
        processing_url="http://asus.test",
        processing_token="test",
    )

    class Provider:
        text = "Where is my laptop?"
        kind = "memory"
        asr_calls = 0

        async def transcribe(self, path):
            self.asr_calls += 1
            return {"text": self.text, "segments": []}

        async def structured(self, system, payload, schema, **kwargs):
            self.last_payload = json.loads(payload)
            return ConversationIntent(
                kind=self.kind,
                directed_request=self.kind != "ignore",
                resolved_request=self.text,
                clarification="",
            )

    class Memory:
        verifier = SimpleNamespace(public=lambda identifier: {"receipt": {"claims_reviewed": True}})

        async def ask(self, text, **kwargs):
            identifier = str(uuid.uuid4())
            db.execute(
                "INSERT INTO answers(id,question,answer,evidence,created_at,grounded,mode) VALUES(?,?,?,?,?,?,?)",
                (identifier, text, "Checked partial answer.", "[]", time.time(), 0, "checking"),
            )
            return {"id": identifier}

    computer = Computer(db, settings)
    provider, memory = Provider(), Memory()
    service = Conversation(db, provider, memory, computer, settings)
    app = FastAPI()

    async def admin(req: Request):
        if req.headers.get("authorization") != "Bearer owner":
            raise HTTPException(401)

    app.include_router(conversation_router(service, admin, asyncio.Lock()))
    client = TestClient(app)
    client.headers["authorization"] = "Bearer owner"
    return service, client


def upload(client, seq=0, data=None):
    return client.post(
        "/api/conversation/audio",
        content=data or speech(),
        headers={
            "content-type": "audio/wav",
            "x-boot-id": "phone",
            "x-sequence": str(seq),
            "x-captured-at": "1700000000",
        },
    )


def text(client, message):
    response = client.post("/api/conversation/text", json={"id": str(uuid.uuid4()), "text": message})
    assert response.status_code == 200
    return response.json()["id"]


async def test_original_audio_is_durable_idempotent_and_transcribed_only_once(conversation):
    service, client = conversation
    first = upload(client)
    assert first.status_code == 200
    assert upload(client).json()["id"] == first.json()["id"]
    assert retained_bytes(service.db) == len(speech())
    row = service.claim()
    assert Worker(service.db, service.p, service.memory, service.s).claim() is None
    await service.process(row)
    assert service.p.asr_calls == 1
    assert service.db.one("SELECT transcript FROM events")["transcript"] == service.p.text
    assert service.db.one("SELECT status FROM media")["status"] == "done"
    assert service.state()["turns"][0]["response"] == ""
    service.db.execute("UPDATE answers SET mode='insufficient'")
    await service.monitor()
    assert service.state()["turns"][0]["status"] == "completed"
    assert service.state()["turns"][0]["response"] == "Checked partial answer."
    assert service.p.asr_calls == 1


async def test_ambient_speech_is_saved_but_never_becomes_computer_command(conversation):
    service, client = conversation
    service.p.text = "He said open TextEdit and then went outside."
    service.p.kind = "ignore"
    upload(client)
    await service.process(service.claim())
    assert service.state()["turns"][0]["status"] == "ignored"
    assert not service.db.all("SELECT * FROM computer_commands")
    assert service.db.one("SELECT transcript FROM events")["transcript"] == service.p.text


async def test_legacy_and_removed_answers_are_excluded_from_followup_context(conversation):
    service, client = conversation
    text(client, "Where is it?")
    await service.process(service.claim())
    service.db.execute("UPDATE answers SET mode='verified',grounded=1")
    await service.monitor()
    assert service.history()
    service.db.execute("UPDATE answers SET mode='legacy_unverified',grounded=0")
    assert service.history() == []
    assert service.state()["turns"][0]["status"] == "error"
    assert "Checked partial answer" not in json.dumps(service.state())


async def test_computer_followup_preserves_checked_answer_across_intervening_action(conversation):
    service, client = conversation
    text(client, "Where is it?")
    await service.process(service.claim())
    full_answer = (
        "The original checked answer is retained. " * 45 + "I cannot tell whether it was moved later."
    )
    service.db.execute("UPDATE answers SET mode='insufficient',grounded=0,answer=?", (full_answer,))
    await service.monitor()
    action = text(client, "Open TextEdit")
    service.respond(action, "completed", "TextEdit is open.", "computer")
    text(client, "Save that answer in the document.")
    service.p.kind = "computer"
    commands = []

    async def command(body):
        commands.append(body.text)

    service.computer.command = command
    await service.process(service.claim())
    assert len(commands) == 1
    assert "Current user request: Save that answer in the document." in commands[0]
    stored = service.db.one("SELECT * FROM conversation_contexts")
    packet = json.loads(Path(stored["path"]).read_text())
    assert str(Path(stored["path"]).resolve()) in commands[0]
    assert stored["sha256"] in commands[0]
    assert packet["references"][0]["response"] == full_answer
    assert packet["references"][0]["mode"] == "insufficient"
    assert packet["references"][1]["response"] == "TextEdit is open."
    assert (
        retained_bytes(service.db)
        == sum(row["bytes"] for row in service.db.all("SELECT bytes FROM conversation_turns"))
        + stored["bytes"]
    )
    assert len(commands[0]) <= 2000
    followup = service.db.one("SELECT * FROM conversation_turns WHERE id=?", (stored["id"],))
    history = json.loads(followup["context"])
    original = Path(stored["path"]).read_bytes()
    before = retained_bytes(service.db)
    assert service.context_file(followup, history)[0] == Path(stored["path"])
    assert retained_bytes(service.db) == before
    Path(stored["path"]).write_bytes(original + b" ")
    with pytest.raises(ValueError, match="saved reference context changed"):
        service.context_file(followup, history)
    Path(stored["path"]).write_bytes(original)
    service.db.execute("UPDATE answers SET mode='context_changed'")
    with pytest.raises(ValueError, match="no longer checked"):
        service.context_file(followup, history)


async def test_long_computer_request_is_not_silently_truncated(conversation):
    service, client = conversation
    service.p.kind = "computer"
    text(client, "Open TextEdit. " + "Keep the text. " * 128 + "Do not overwrite any file.")
    await service.process(service.claim())
    assert service.state()["turns"][0]["status"] == "clarification"
    assert service.db.all("SELECT * FROM computer_commands") == []


async def test_voice_yes_only_approves_the_exact_current_notch_dialog(conversation):
    service, client = conversation
    approved = []
    parent = text(client, "Open TextEdit")
    permission = str(uuid.uuid4())
    service.db.execute(
        "UPDATE conversation_turns SET status='awaiting_permission',kind='computer',command_id=?,permission_id=?,permission_at=? WHERE id=?",
        (parent, permission, time.time(), parent),
    )

    async def state():
        return {
            "request_id": parent,
            "permission": {"id": permission, "tool": "shell", "detail": "Open TextEdit"},
        }

    async def call(route, payload):
        approved.append((route, payload))
        return {"ok": True}

    service.computer.state = state
    service.computer.call = call
    response = text(client, "yes")
    await service.process(service.claim())
    assert approved == [("permission-decision", {"id": permission, "allow": True})]
    assert (
        service.db.one("SELECT status FROM conversation_turns WHERE id=?", (response,))["status"]
        == "completed"
    )
    # A later standalone yes cannot grant an old or a different request.
    text(client, "yes")
    await service.process(service.claim())
    assert len(approved) == 1


async def test_restarted_action_with_uncertain_delivery_is_never_resent(conversation):
    service, client = conversation
    identifier = text(client, "Open TextEdit")
    service.db.execute(
        "UPDATE conversation_turns SET status='acting',kind='computer',command_id=? WHERE id=?",
        (identifier, identifier),
    )
    service.db.execute(
        "INSERT INTO computer_commands VALUES(?,?,?,'{}',?)",
        (identifier, "Open TextEdit", "delivery_unknown", time.time() - 40),
    )

    async def state():
        return {"request_id": None, "permission": None}

    service.computer.state = state
    assert service.claim() is None
    await service.monitor()
    turn = service.state()["turns"][0]
    assert turn["status"] == "error" and "before repeating" in turn["response"]


async def test_old_queued_utterance_gets_a_fresh_bounded_dispatch_window(conversation):
    service, client = conversation
    service.p.kind = "computer"
    service.p.text = "Open TextEdit"
    identifier = text(client, service.p.text)
    service.db.execute(
        "UPDATE conversation_turns SET created_at=? WHERE id=?", (time.time() - 120, identifier)
    )
    waiting, release = asyncio.Event(), asyncio.Event()

    async def command(body):
        waiting.set()
        await release.wait()
        return {"id": str(body.id), "status": "accepted"}

    async def state():
        return {"request_id": None, "permission": None}

    service.computer.command = command
    service.computer.state = state
    task = asyncio.create_task(service.process(service.claim()))
    await waiting.wait()
    try:
        await service.monitor()
        assert (
            service.db.one("SELECT status FROM conversation_turns WHERE id=?", (identifier,))["status"]
            == "acting"
        )
    finally:
        release.set()
        await task


@pytest.mark.parametrize("has_ledger", [False, True])
async def test_dispatch_timeout_distinguishes_unsent_from_uncertain_delivery(conversation, has_ledger):
    service, client = conversation
    service.p.kind = "computer"
    service.p.text = "Open TextEdit"
    text(client, service.p.text)

    async def command(body):
        if has_ledger:
            service.db.execute(
                "INSERT INTO computer_commands VALUES(?,?,?,'{}',?)",
                (str(body.id), body.text, "sending", time.time()),
            )
        raise TimeoutError()

    service.computer.command = command
    await service.process(service.claim())
    turn = service.state()["turns"][0]
    assert turn["status"] == "error"
    assert ("before repeating" in turn["response"]) is has_ledger
    assert ("Notch is busy" in turn["response"]) is not has_ledger


@pytest.mark.parametrize("old_field", ["created_at", "captured_at"])
async def test_yes_spoken_or_received_before_prompt_cannot_approve_new_dialog(conversation, old_field):
    service, client = conversation
    parent = text(client, "Open TextEdit")
    permission = str(uuid.uuid4())
    prompted = time.time()
    service.db.execute(
        "UPDATE conversation_turns SET status='awaiting_permission',kind='computer',command_id=?,permission_id=?,permission_at=? WHERE id=?",
        (parent, permission, prompted, parent),
    )
    response = text(client, "yes")
    service.db.execute(f"UPDATE conversation_turns SET {old_field}=? WHERE id=?", (prompted - 1, response))
    calls = []

    async def state():
        return {"request_id": parent, "permission": {"id": permission}}

    async def call(route, payload):
        calls.append((route, payload))

    service.computer.state, service.computer.call = state, call
    await service.process(service.claim())
    assert calls == []
    assert (
        service.db.one("SELECT status FROM conversation_turns WHERE id=?", (response,))["status"]
        == "clarification"
    )
    assert (
        service.db.one("SELECT status FROM conversation_turns WHERE id=?", (parent,))["status"]
        == "awaiting_permission"
    )


@pytest.mark.parametrize("status", ["completed", "failed", "delivery_unknown"])
async def test_disconnected_notch_still_surfaces_local_outcome_or_delivery_timeout(conversation, status):
    service, client = conversation
    identifier = text(client, "Open TextEdit")
    service.db.execute(
        "UPDATE conversation_turns SET status='acting',kind='computer',command_id=? WHERE id=?",
        (identifier, identifier),
    )
    service.db.execute(
        "INSERT INTO computer_commands VALUES(?,?,?,?,?)",
        (identifier, "Open TextEdit", status, '{"response":"Native recorded result."}', time.time() - 40),
    )

    async def disconnected():
        raise HTTPException(503, "Notch is unreachable.")

    service.computer.state = disconnected
    await service.monitor()
    turn = service.state()["turns"][0]
    assert turn["status"] == ("completed" if status == "completed" else "error")
    assert turn["response"] == (
        "I couldn't confirm delivery to Notch. Check the Mac before repeating the action."
        if status == "delivery_unknown"
        else "Native recorded result."
    )


def test_owner_auth_bounds_quota_and_conflicting_retry(conversation):
    service, client = conversation
    client.headers.clear()
    assert upload(client).status_code == 401
    assert client.get("/api/conversation/state").status_code == 401
    client.headers["authorization"] = "Bearer owner"
    assert upload(client).status_code == 200
    changed = speech()[:-2] + b"\x01\x00"
    assert upload(client, data=changed).status_code == 409
    service.s.max_storage_gb = 0.000000001
    assert upload(client, seq=1).status_code == 507


def test_backpressure_rejects_new_turn_but_accepts_idempotent_retry(conversation):
    service, client = conversation
    body = {"id": str(uuid.uuid4()), "text": "Where is it?"}
    first = client.post("/api/conversation/text", json=body)
    for _ in range(11):
        text(client, "Where is it?")
    assert (
        client.post(
            "/api/conversation/text", json={"id": str(uuid.uuid4()), "text": "Another request"}
        ).status_code
        == 429
    )
    assert client.post("/api/conversation/text", json=body).json()["id"] == first.json()["id"]


@pytest.mark.parametrize("question", ["Rewind. When is my doctor bill due?", "When does my doctor bill due?"])
async def test_direct_personal_question_searches_memory_before_clarifying(conversation, question):
    service, client = conversation
    service.p.kind = "clarify"  # Regression: small router model asked "which bill?" without searching.
    text(client, question)
    await service.process(service.claim())
    turn = service.state()["turns"][0]
    assert turn["kind"] == "memory"
    assert turn["status"] == "checking" and turn["answer_id"]
    assert not service.db.all("SELECT * FROM computer_commands")


@pytest.mark.parametrize(
    "utterance",
    [
        "He said where is my laptop?",
        "Rewind, open my email",
        "When is it due?",
        "Where is my Downloads folder?",
        "What files are on my desktop?",
        "Where is my doctor bill PDF file?",
        "Where is my medicine and open my calendar?",
        "Pull it up on my Mac",
        'What did he mean by "open my email"?',
    ],
)
def test_question_fast_path_never_authorizes_ambient_commands_or_resolves_missing_context(utterance):
    from rewind.conversation import direct_memory_question

    assert direct_memory_question(utterance) is None


@pytest.mark.parametrize(
    "utterance", ["What is your name?", "Hello!", "How are you?", "Thanks!", "hi can u hear me whats ur name"]
)
async def test_mobile_small_talk_completes_without_recall_or_computer(conversation, utterance):
    service, client = conversation
    text(client, utterance)
    await service.process(service.claim())
    turn = service.state()["turns"][-1]
    assert turn["kind"] == "chat" and turn["status"] == "completed"
    assert turn["response"] and turn["answer_id"] is None
    assert not service.db.all("SELECT * FROM answers")
    assert not service.db.all("SELECT * FROM computer_commands")
    # General conversation is not checked evidence for an ensuing computer task.
    assert service.history() == []


async def test_chat_router_generates_conversation_and_preserves_followup_context(conversation):
    from rewind.models import ConversationReply

    service, client = conversation
    text(client, "Hello!")
    await service.process(service.claim())

    async def structured(system, payload, schema, **kwargs):
        data = json.loads(payload)
        if schema is ConversationIntent:
            assert data["casual_conversation"][0]["transcript"] == "Hello!"
            return ConversationIntent(
                kind="chat", directed_request=True, resolved_request="Tell me a joke", clarification=""
            )
        assert data["conversation"][0]["transcript"] == "Hello!"
        return ConversationReply(
            needs_memory=False, answer="Why did the bicycle fall over? It was two-tired."
        )

    service.p.structured = structured
    text(client, "Tell me a joke")
    await service.process(service.claim())
    turn = service.state()["turns"][-1]
    assert turn["status"] == "completed" and turn["kind"] == "chat"
    assert "two-tired" in turn["response"]
    assert not service.db.all("SELECT * FROM answers")


async def test_chat_defers_personal_facts_to_checked_recall(conversation):
    from rewind.models import ConversationReply

    service, client = conversation

    async def structured(system, payload, schema, **kwargs):
        if schema is ConversationIntent:
            return ConversationIntent(
                kind="chat",
                directed_request=True,
                resolved_request="Tell me about my appointment",
                clarification="",
            )
        return ConversationReply(needs_memory=True, answer="")

    service.p.structured = structured
    text(client, "Tell me about my appointment")
    await service.process(service.claim())
    turn = service.state()["turns"][-1]
    assert turn["kind"] == "memory" and turn["status"] == "checking"
    assert turn["answer_id"] and not turn["response"]


@pytest.mark.parametrize("question", [
    "What information do you have?", "What information do u have from your all ur data", "What floor do I live on?",
])
async def test_workspace_inventory_and_personal_floor_skip_chat_router(conversation, question):
    service, client = conversation

    async def unavailable(*args, **kwargs):
        raise AssertionError("Explicit memory questions must search retained sources")

    service.p.structured = unavailable
    text(client, question)
    await service.process(service.claim())
    turn = service.state()["turns"][-1]
    assert turn["kind"] == "memory" and turn["status"] == "checking"
    assert service.db.one("SELECT question FROM answers")["question"] == question


async def test_uncited_abstention_is_guidance_not_a_failed_review(conversation):
    service, client = conversation
    text(client, "Where are my keys?")
    await service.process(service.claim())
    service.db.execute(
        "UPDATE answers SET mode='no_evidence',answer='The saved photos do not answer that question.'"
    )
    service.memory.verifier = None
    await service.monitor()
    turn = service.state()["turns"][-1]
    assert turn["status"] == "clarification"
    assert turn["response"] == "The saved photos do not answer that question."
    assert "unavailable" not in turn["response"]


@pytest.mark.parametrize("kind", ["chat", "ignore", "memory", "computer"])
async def test_explicit_orb_turn_is_answered_when_router_marks_it_as_ambient(conversation, kind):
    from rewind.models import ConversationReply

    service, client = conversation

    async def structured(system, payload, schema, **kwargs):
        data = json.loads(payload)
        if schema is ConversationIntent:
            assert data["direct_user_request"] is True
            return ConversationIntent(
                kind=kind, directed_request=False, resolved_request="", clarification=""
            )
        return ConversationReply(needs_memory=False, answer="Of course! Here's a joke.")

    service.p.structured = structured
    for message in ("Could you tell me a joke?", "Another one please", "And another one"):
        identifier = text(client, message)
        await service.process(service.claim())
        turn = next(row for row in service.state()["turns"] if row["id"] == identifier)
        assert turn["status"] == "completed" and turn["kind"] == "chat"
        assert turn["response"] == "Of course! Here's a joke."
    assert len(service.state()["turns"]) == 3
    assert not service.db.all("SELECT * FROM computer_commands")


async def test_explicit_input_does_not_turn_personal_facts_into_unchecked_chat(conversation):
    from rewind.models import ConversationReply

    service, client = conversation

    async def structured(system, payload, schema, **kwargs):
        if schema is ConversationIntent:
            return ConversationIntent(
                kind="ignore", directed_request=False, resolved_request="", clarification=""
            )
        return ConversationReply(needs_memory=True, answer="")

    service.p.structured = structured
    text(client, "Could you tell me what my grandson is called?")
    await service.process(service.claim())
    turn = service.state()["turns"][-1]
    assert turn["status"] == "checking" and turn["kind"] == "memory"
    assert turn["response"] == ""


async def test_router_failure_returns_visible_error_and_next_turn_recovers(conversation):
    service, client = conversation

    async def unavailable(*args, **kwargs):
        raise RuntimeError("routing temporarily unavailable")

    service.p.structured = unavailable
    text(client, "Could you explain something?")
    await service.process(service.claim())
    first = service.state()["turns"][-1]
    assert first["status"] == "error" and first["response"]
    text(client, "hi can u hear me whats ur name")
    await service.process(service.claim())
    second = service.state()["turns"][-1]
    assert second["status"] == "completed" and "I'm Rewind" in second["response"]


@pytest.mark.parametrize("utterance", ["What can you do for me?", "What should I do about my cold?"])
def test_general_help_questions_are_not_forced_into_personal_memory(utterance):
    from rewind.conversation import direct_memory_question

    assert direct_memory_question(utterance) is None


async def test_recovered_explicit_turn_cannot_reuse_a_silent_ambient_decision(conversation):
    from rewind.models import ConversationReply

    service, client = conversation
    identifier = text(client, "Could you explain gravity?")
    intent = ConversationIntent(kind="ignore", directed_request=False, resolved_request="", clarification="")
    service.db.execute(
        "UPDATE conversation_turns SET intent=?,status='routing' WHERE id=?",
        (intent.model_dump_json(), identifier),
    )

    async def structured(system, payload, schema, **kwargs):
        assert schema is ConversationReply
        return ConversationReply(needs_memory=False, answer="Gravity pulls masses toward each other.")

    service.p.structured = structured
    await service.process(service.claim())
    turn = service.state()["turns"][-1]
    assert turn["status"] == "completed" and turn["response"]
    assert turn["kind"] == "chat"


@pytest.mark.parametrize("reply", ["yes", "no", "go ahead"])
async def test_explicit_short_reply_without_permission_is_visible_and_never_authorizes(conversation, reply):
    service, client = conversation
    text(client, reply)
    await service.process(service.claim())
    turn = service.state()["turns"][-1]
    assert turn["status"] == "clarification" and turn["response"]
    assert not service.db.all("SELECT * FROM computer_commands")
