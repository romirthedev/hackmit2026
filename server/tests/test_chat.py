import json
from types import SimpleNamespace

import pytest
from rewind.chat import conversation_reply, small_talk
from rewind.config import Settings
from rewind.db import Database
from rewind.memory import Memory
from rewind.models import ConversationReply
from rewind.processing import SCHEMAS


@pytest.mark.parametrize(
    "question",
    [
        "What is your name?",
        "What's your name?",
        "Hi, what's your name?",
        "Hey Rewind, who are you?",
        "Tell me your name",
        "What should I call you?",
        "hi can u hear me whats ur name",
        "Hello, can you hear me? What's your name?",
        "Are you there and who are you?",
    ],
)
async def test_introductions_need_no_model_or_photos(tmp_path, question):
    db = Database(tmp_path)
    memory = Memory(db, object(), Settings(_env_file=None, data_dir=tmp_path))
    answer = await memory.ask(question, allow_chat=True)
    assert answer["mode"] == "conversation"
    assert "I'm Rewind" in answer["answer"]
    assert answer["evidence"] == [] and answer["grounded"] is False
    assert db.one("SELECT mode FROM answers")["mode"] == "conversation"


@pytest.mark.parametrize(
    "question",
    [
        "What is my name?",
        "Who is my doctor?",
        "Hi, where are my keys?",
        "Thanks, but when is my appointment?",
        "He said 'what is your name?'",
        "What's your name and where are my glasses?",
        "Hi can you hear me and where are my keys?",
        "What is your name and open my email",
    ],
)
def test_casual_reply_cannot_swallow_personal_or_quoted_questions(question):
    assert small_talk(question) is None


async def test_model_conversation_and_personal_question_deferral():
    async def structured(system, payload, schema, **kwargs):
        assert schema is ConversationReply
        request = json.loads(payload)["request"]
        return ConversationReply(needs_memory="my" in request, answer="Plants turn sunlight into food.")

    provider = SimpleNamespace(structured=structured)
    assert await conversation_reply(provider, "Explain photosynthesis") == "Plants turn sunlight into food."
    assert await conversation_reply(provider, "Can you tell me where my keys are?") is None
    assert SCHEMAS["ConversationReply"] is ConversationReply


async def test_selected_recording_dates_do_not_turn_an_introduction_into_retrieval(tmp_path):
    memory = Memory(Database(tmp_path), object(), Settings(_env_file=None, data_dir=tmp_path))
    result = await memory.ask("What's your name?", after=100, before=200, allow_chat=True)
    assert result["mode"] == "conversation" and "I'm Rewind" in result["answer"]


async def test_known_chat_model_failure_does_not_claim_missing_pictures():
    async def unavailable(*args, **kwargs):
        raise RuntimeError("offline")

    answer = await conversation_reply(
        SimpleNamespace(structured=unavailable), "Tell me a joke", classified=True
    )
    assert "trouble replying" in answer
    assert "photo" not in answer


@pytest.mark.parametrize(
    "question",
    [
        "Could you explain why the sky is blue?",
        "Would you tell me a joke?",
        "Another one please",
        "2 plus 2",
        "Do you like music?",
    ],
)
async def test_direct_conversation_is_not_limited_to_question_prefixes(question):
    async def structured(system, payload, schema, **kwargs):
        assert json.loads(payload)["request"] == question
        return ConversationReply(needs_memory=False, answer="A conversational answer.")

    assert (
        await conversation_reply(SimpleNamespace(structured=structured), question)
        == "A conversational answer."
    )


async def test_unclassified_model_failure_does_not_fall_through_to_false_missing_evidence(tmp_path):
    async def unavailable(*args, **kwargs):
        raise RuntimeError("model unavailable")

    memory = Memory(
        Database(tmp_path),
        SimpleNamespace(structured=unavailable),
        Settings(_env_file=None, data_dir=tmp_path),
    )
    result = await memory.ask("Could you tell me a joke?", allow_chat=True)
    assert result["mode"] == "conversation"
    assert "trouble replying" in result["answer"]


async def test_slow_chat_times_out_without_blocking_following_turns(monkeypatch):
    import asyncio

    monkeypatch.setattr("rewind.chat.CHAT_TIMEOUT_SECONDS", 0.01)
    cancelled = asyncio.Event()

    async def slow(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    reply = await conversation_reply(SimpleNamespace(structured=slow), "Could you tell me a joke?")
    assert "trouble replying" in reply and cancelled.is_set()
    assert "I'm Rewind" in await conversation_reply(object(), "What's your name?")
