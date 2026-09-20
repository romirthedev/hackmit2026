import json
import time

import pytest
from fastapi.testclient import TestClient
from rewind.app import create_app
from rewind.config import Settings
from rewind.context import ContextSnapshot, NotchContext, identifier
from rewind.db import Database
from rewind.memory import Memory
from rewind.models import RecallAnswer


def snapshot(documents, exported_at=None):
    return ContextSnapshot(
        version=1,
        exported_at=exported_at or time.time(),
        documents=documents,
        sources={"notes": "connected", "calendar": "connected", "contacts": "connected"},
    )


@pytest.fixture
def context(tmp_path):
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        workers=0,
        embeddings=False,
        admin_token="admin" * 8,
        device_token="device" * 8,
    )
    return NotchContext(Database(tmp_path), settings)


def test_notch_links_and_calendar_nudges_are_based_on_sources_and_deduplicate(context):
    start = time.time() + 25 * 60
    docs = [
        {"key": "note:family", "kind": "note", "title": "Family", "text": "Call [[Alice]] this week."},
        {"key": "note:alice", "kind": "note", "title": "Alice", "text": "Alice is my sister."},
        {"key": "contact:alice", "kind": "contact", "title": "Alice Smith", "emails": ["alice@example.test"]},
        {
            "key": "calendar:visit",
            "kind": "calendar",
            "title": "Visit Alice",
            "starts_at": start,
            "location": "Community garden",
            "emails": ["alice@example.test"],
        },
    ]
    context.ingest(snapshot(docs))
    graph = context.graph()
    assert {tuple((e["source"], e["target"])) for e in graph["edges"]} == {
        (identifier("note:family"), identifier("note:alice")),
        (identifier("calendar:visit"), identifier("contact:alice")),
    }
    context.ingest(snapshot(docs))
    context.refresh_reminders()
    reminders = context.db.all("SELECT * FROM context_reminders")
    assert len(reminders) == 1 and "Community garden" in reminders[0]["message"]
    assert "leave" not in reminders[0]["message"].lower()  # No invented travel duration.
    context.ingest(snapshot(docs[:-1]))
    assert not context.db.all("SELECT * FROM context_reminders")  # Canceled event cannot keep nudging.


def test_stale_context_cannot_create_reminders_and_failed_snapshot_does_not_replace(context):
    context.ingest(snapshot([{"key": "note:a", "kind": "note", "title": "Original", "text": "A source"}]))
    with pytest.raises(ValueError, match="Stale"):
        context.ingest(snapshot([], time.time() - 1000))
    assert len(context.graph()["nodes"]) == 1
    context.ingest(
        snapshot([{"key": "event", "kind": "calendar", "title": "Future", "starts_at": time.time() + 1900}])
    )
    context.db.set_setting("notch_last_sync", time.time() - 700)
    row = context.db.one("SELECT * FROM context_documents")
    value = json.loads(row["payload"])
    value["starts_at"] = time.time() + 600
    context.db.execute("UPDATE context_documents SET payload=?", (json.dumps(value),))
    context.refresh_reminders()
    assert not context.db.all("SELECT * FROM context_reminders")


async def test_recall_uses_notch_source_with_valid_citation_without_recordings(context):
    context.ingest(
        snapshot(
            [
                {
                    "key": "appointment",
                    "kind": "calendar",
                    "title": "Garden visit",
                    "starts_at": time.time() + 1800,
                }
            ]
        )
    )

    class Provider:
        async def embed(self, text):
            return None

        async def structured(self, prompt, body, schema, **kwargs):
            assert "does not prove attendance" in prompt
            payload = json.loads(body)
            assert payload["evidence"][0]["source_kind"] == "calendar"
            assert payload["evidence"][0]["source"] == "Notch connected digital source"
            return RecallAnswer(
                answer="Your calendar has a garden visit scheduled.",
                evidence_ids=["E1"],
                insufficient_evidence=False,
            )

    memory = Memory(context.db, Provider(), context.s, context=context)
    answer = await memory.ask("What is my next appointment?")
    assert answer["grounded"] and answer["evidence"][0]["source"] == "notch"
    assert identifier("appointment") in answer["answer"]
    context.disconnect()
    assert not context.db.all("SELECT * FROM context_documents")
    assert not context.db.all("SELECT * FROM answers")


async def test_calendar_recall_keeps_all_day_and_local_date_without_inventing_appointment(context):
    # September 21 midnight in the configured New York timezone, not a timed visit.
    context.ingest(snapshot([{
        "key": "calendar:holiday", "kind": "calendar", "title": "Holiday",
        "starts_at": 1789963200, "ends_at": 1790049600, "all_day": True,
    }]))

    class Provider:
        async def embed(self, text):
            return None

        async def structured(self, prompt, body, schema, **kwargs):
            source = json.loads(body)["evidence"][0]
            assert source["starts_at_local"] == "2026-09-21T00:00-04:00"
            assert source["all_day"] is True
            return RecallAnswer(answer="", evidence_ids=[], insufficient_evidence=True)

    answer = await Memory(context.db, Provider(), context.s, context=context).ask("What is my next appointment?")
    assert answer["mode"] == "no_evidence"
    assert "connected sources" in answer["answer"]


def test_changed_sources_purge_cached_answers_and_rescheduled_reminders(context):
    original = {"key": "visit", "kind": "calendar", "title": "Garden visit", "starts_at": time.time() + 600}
    context.ingest(snapshot([original]))
    source = context.public(context.db.one("SELECT * FROM context_documents"))
    # Match the answer table's actual storage interface, including cached source text.
    context.db.execute(
        "INSERT INTO answers(id,question,answer,evidence,grounded,created_at,mode) VALUES(?,?,?,?,?,?,?)",
        ("answer", "Next visit?", "Garden visit soon", json.dumps([source]), 1, time.time(), "test"),
    )
    context.ingest(snapshot([{**original, "starts_at": time.time() + 7200}]))
    assert not context.db.all("SELECT * FROM context_reminders")
    assert not context.db.all("SELECT * FROM answers")


def test_context_endpoints_require_workspace_auth_and_missing_bridge_is_explicit(context):
    app = create_app(context.s)
    with TestClient(app) as client:
        assert client.get("/api/context/graph").status_code == 401
        headers = {"Authorization": "Bearer " + context.s.admin_token}
        assert client.get("/api/context/status", headers=headers).json()["configured"] is False
        response = client.post("/api/context/connect", headers=headers, json={"notes": True})
        assert response.status_code == 503
        assert "Configure" in response.json()["detail"]


async def test_disconnect_during_model_request_cannot_restore_removed_source(context):
    context.ingest(
        snapshot([{"key": "private", "kind": "note", "title": "Garden", "text": "Private garden note"}])
    )

    class Provider:
        async def embed(self, text):
            return None

        async def structured(self, *args, **kwargs):
            context.disconnect()
            return RecallAnswer(
                answer="Private garden note", evidence_ids=["E1"], insufficient_evidence=False
            )

    answer = await Memory(context.db, Provider(), context.s, context=context).ask("Garden note?")
    assert answer["mode"] == "context_changed"
    assert not answer["grounded"] and not answer["evidence"]
    assert "Private garden note" not in json.dumps(context.db.all("SELECT * FROM answers"))


def test_reminders_keep_seen_identity_and_handle_current_source_changes(context):
    context.db.set_setting("notch_enabled", True)
    original = {"key": "visit", "kind": "calendar", "title": "Garden visit", "starts_at": time.time() + 600}
    context.ingest(snapshot([original]))
    reminder = context.reminders()[0]
    context.db.execute("UPDATE context_reminders SET seen=1 WHERE id=?", (reminder["id"],))
    context.ingest(snapshot([{**original, "title": "Updated visit", "location": "Library"}]))
    refreshed = context.reminders()[0]
    assert refreshed["id"] == reminder["id"] and refreshed["seen"] == 1
    assert "Updated visit" in refreshed["message"] and "Library" in refreshed["message"]
    context.ingest(snapshot([{**original, "starts_at": time.time() + 1200}]))
    assert context.reminders()[0]["id"] != reminder["id"]
    assert context.reminders()[0]["seen"] == 0
    context.ingest(snapshot([{**original, "all_day": True}]))
    assert context.reminders() == []


def test_reminders_hide_on_sync_error_staleness_and_disconnect(context):
    context.db.set_setting("notch_enabled", True)
    original = {"key": "visit", "kind": "calendar", "title": "Garden visit", "starts_at": time.time() + 600}
    context.ingest(snapshot([original]))
    assert len(context.reminders()) == 1
    context.db.set_setting("notch_error", "Sync unavailable")
    assert context.reminders() == []
    context.db.set_setting("notch_error", "")
    context.db.set_setting("notch_last_sync", time.time() - 301)
    assert context.reminders() == []
    context.ingest(snapshot([original]))
    assert len(context.reminders()) == 1
    context.disconnect()
    assert context.reminders() == []
    assert not context.db.all("SELECT * FROM context_reminders")


def test_old_export_cannot_gain_freshness_when_received_and_partial_failed_source_is_removed(context):
    context.db.set_setting("notch_enabled", True)
    doc = {"key": "visit", "kind": "calendar", "title": "Garden visit", "starts_at": time.time() + 600}
    old = snapshot([doc], time.time() - 400)
    context.ingest(old)
    assert context.status()["stale"] and context.reminders() == []
    context.ingest(snapshot([doc]))
    assert len(context.reminders()) == 1
    failed = snapshot([doc])
    failed.sources["calendar"] = "permission_required"
    context.ingest(failed)
    assert context.reminders() == []
    assert not context.db.all("SELECT * FROM context_documents")
    with pytest.raises(ValueError, match="Stale"):
        context.ingest(snapshot([doc], time.time() + 60))


def test_search_recognizes_digital_source_kind_and_preserves_original_key(context):
    context.ingest(snapshot([
        {"key": "mail:synthetic-123", "kind": "email", "title": "Trip details", "text": "Train leaves at noon."},
        {"key": "note:groceries.md", "kind": "note", "title": "Groceries", "text": "Tea and apples."},
    ]))
    emails = context.search("Can you show me my emails?")
    assert [row["source_key"] for row in emails] == ["mail:synthetic-123"]
    assert emails[0]["text"] == "Train leaves at noon."
    assert [row["title"] for row in context.search("What notes do I have on my computer?")] == ["Groceries"]
    assert context.search("Anything about volcanoes?") == []


def test_search_supplies_directly_linked_knowledge_without_inventing_relationships(context):
    context.ingest(snapshot([
        {"key": "note:orchard", "kind": "note", "title": "Orchard", "text": "Coordinator: [[Alice]]."},
        {"key": "note:alice", "kind": "note", "title": "Alice", "text": "Coordinator's phone: 555-0100. See [[Travel]]."},
        {"key": "note:travel", "kind": "note", "title": "Travel", "text": "Book a bus ticket."},
        {"key": "contact:alice", "kind": "contact", "title": "Alice", "text": "Unlinked contact."},
    ]))
    result = context.search("Who coordinates the orchard?")
    assert [row["source_key"] for row in result] == ["note:orchard", "note:alice"]
    assert "555-0100" in result[1]["text"]
    assert context.search("orchard", limit=0) == []


def test_ambiguous_note_titles_require_an_exported_source_key_for_graph_relationships(context):
    docs = [
        {"key": "note:orchard", "kind": "note", "title": "Orchard", "text": "Coordinator: [[Alice]]."},
        {"key": "note:alice-one", "kind": "note", "title": "Alice", "text": "First person's private facts."},
        {"key": "note:alice-two", "kind": "note", "title": "Alice", "text": "A different person's private facts."},
    ]
    context.ingest(snapshot(docs))
    assert context.graph()["edges"] == []
    assert [row["source_key"] for row in context.search("orchard")] == ["note:orchard"]
    context.ingest(snapshot([{**docs[0], "links": ["note:alice-one"]}, *docs[1:]]))
    assert [row["source_key"] for row in context.search("orchard")] == ["note:orchard", "note:alice-one"]


def test_next_appointment_retrieves_nearest_upcoming_source_before_alphabetical_history(context):
    now = time.time()
    docs = [{"key": f"past:{i}", "kind": "calendar", "title": f"A past visit {i}", "starts_at": now - 600 * (i + 1)}
            for i in range(8)]
    docs += [
        {"key": "calendar:later", "kind": "calendar", "title": "Another visit", "starts_at": now + 7200},
        {"key": "calendar:next", "kind": "calendar", "title": "Zinnia planting", "starts_at": now + 1200},
    ]
    context.ingest(snapshot(docs))
    assert [row["source_key"] for row in context.search("What's my next appointment?", limit=2)] == [
        "calendar:next", "calendar:later",
    ]


def test_next_appointment_prefers_calendar_dates_and_preserves_named_doctor_relevance(context):
    now = time.time()
    context.ingest(snapshot([
        {"key": "note:rose", "kind": "note", "title": "Dr Rose's appointments", "text": "See Dr Rose.", "links": ["calendar:rose"]},
        {"key": "calendar:near", "kind": "calendar", "title": "Dr Jones", "starts_at": now + 600},
        {"key": "calendar:rose", "kind": "calendar", "title": "Dr Rose", "text": "Scheduled visit.", "starts_at": now + 1800},
        {"key": "calendar:later-rose", "kind": "calendar", "title": "Dr Rose", "starts_at": now + 3600},
    ]))
    # Generic phrasing must not promote the later event just because its body
    # happens to contain 'scheduled'. A named doctor remains a real constraint.
    assert context.search("What's my next scheduled appointment?", limit=1)[0]["source_key"] == "calendar:near"
    assert context.search("When is my next appointment with Dr Rose?", limit=1)[0]["source_key"] == "calendar:rose"
