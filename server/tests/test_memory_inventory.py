import hashlib
import json
from types import SimpleNamespace

import pytest
from rewind.chat import conversation_reply, direct_memory_question
from rewind.db import Database
from rewind.memory import Memory, building_floor_question, building_floor_rank
from rewind.models import Observation
from rewind.temporal import is_memory_overview
from rewind.worker import Worker
from test_day_memory import add_frame
from test_day_memory import workspace as workspace


@pytest.mark.parametrize("question", [
    "What information do you have?",
    "What information do you have about me?",
    "What information do u have from your all ur data",
    "What information you have?",
    "What do you know about me?",
    "What have you learned from my recordings?",
    "Can you summarize my recordings?",
    "Tell me what you have seen",
])
async def test_inventory_questions_cannot_be_answered_by_generic_chat(question):
    assert is_memory_overview(question)
    assert direct_memory_question(question) == question
    # No provider method exists: a chat hallucination about source access must
    # not bypass the actual archive just because the user omitted an object.
    assert await conversation_reply(object(), question, classified=True) is None


@pytest.mark.parametrize("question", [
    "What do you know about poker?",
    "What information do you have about Mars?",
    "What have you learned about chemistry?",
    "Summarize my recordings after breakfast",
    'He said "what information do you have?"',
    "Open my recordings",
])
def test_focused_general_or_action_questions_do_not_become_inventory(question):
    assert not is_memory_overview(question)


async def test_inventory_inspects_old_unlabelled_originals_without_caption_keyword(workspace):
    db, settings, provider = workspace
    ids = [add_frame(workspace, 1000 + i * 10, status="queued") for i in range(30)]
    question = add_frame(workspace, 1301, summary="What information do you have?")
    db.execute("UPDATE media SET kind='audio',intent='conversation' WHERE id=?", (question,))
    result = await Memory(db, provider, settings).ask("What information do u have from your all ur data")
    _, payload, paths = provider.calls[0]
    attached = {path.stem for path in paths}
    assert len(attached) == 12
    assert {ids[0], ids[-1]} <= attached
    assert question not in {row["id"] for row in result["evidence"]}
    assert payload["recording_coverage"] is None  # No invented calendar-day scope.
    assert all(hashlib.sha256(path.read_bytes()).hexdigest()
               == db.one("SELECT sha256 FROM media WHERE id=?", (path.stem,))["sha256"]
               for path in paths)


async def test_inventory_respects_explicit_time_window(workspace):
    _, settings, provider = workspace
    before = add_frame(workspace, 100)
    within = add_frame(workspace, 200)
    after = add_frame(workspace, 300)
    await Memory(workspace[0], provider, settings).ask("What do you know about me?", after=150, before=250)
    assert {path.stem for path in provider.calls[0][2]} == {within}
    assert not {before, after} & {path.stem for path in provider.calls[0][2]}


async def test_object_details_and_reprocessed_captions_are_searchable(workspace):
    db, settings, provider = workspace
    poster = add_frame(workspace, 100, summary="A poster beside a doorway.")
    db.execute("UPDATE events SET objects=? WHERE id=?", (
        json.dumps([{"label": "poster", "description": "Chess Week on October 10", "location": "Floor 5"}]),
        poster,
    ))
    memory = Memory(db, provider, settings)
    assert [row["id"] for row in await memory.search("Chess")] == [poster]
    db.execute("UPDATE events SET summary=? WHERE id=?", ("A Scrabble tournament poster.", poster))
    assert [row["id"] for row in await memory.search("Scrabble")] == [poster]
    assert not await memory.search("doorway")


async def test_index_upgrade_keeps_originals_and_existing_labels(workspace):
    db, settings, provider = workspace
    poster = add_frame(workspace, 100, summary="A poster.")
    db.execute("UPDATE events SET objects=? WHERE id=?", (
        json.dumps([{"label": "poster", "description": "Chess Week on October 10"}]), poster,
    ))
    # Recreate only the old derived index state in this disposable fixture.
    db.execute("DELETE FROM settings WHERE key='events_fts_objects_v1'")
    db.execute("UPDATE events_fts SET tags='[]'")
    media_before = db.all("SELECT * FROM media")
    events_before = db.all("SELECT * FROM events")
    upgraded = Database(settings.data_dir)
    assert upgraded.all("SELECT * FROM media") == media_before
    assert upgraded.all("SELECT * FROM events") == events_before
    assert [row["id"] for row in await Memory(upgraded, provider, settings).search("Chess")] == [poster]
    # Reopening does not duplicate index entries.
    Database(settings.data_dir)
    assert db.one("SELECT COUNT(*) AS n FROM events_fts")["n"] == 1


async def test_previous_questions_do_not_become_evidence_for_their_own_assumptions(workspace):
    db, settings, provider = workspace
    question = add_frame(workspace, 100, summary="When is my dentist appointment tomorrow?")
    db.execute("UPDATE media SET kind='audio',intent='conversation' WHERE id=?", (question,))
    assert not await Memory(db, provider, settings).search("dentist appointment")


async def test_observation_embeddings_include_readable_object_details(workspace):
    db, settings, _ = workspace
    identifier = add_frame(workspace, 100, status="queued")
    embedded = []

    async def observe(path):
        return Observation(summary="A poster.", objects=[{
            "label": "event notice", "description": "Chess Week on October 10", "location": "Floor 5",
        }])

    async def embed(text):
        embedded.append(text)
        return None

    provider = SimpleNamespace(observe=observe, embed=embed)
    worker = Worker(db, provider, Memory(db, provider, settings), settings)
    await worker.process(worker.claim())
    assert db.one("SELECT status FROM media WHERE id=?", (identifier,))["status"] == "done"
    assert len(embedded) == 1
    assert "Chess Week on October 10" in embedded[0] and "Floor 5" in embedded[0]


@pytest.mark.parametrize("question,expected", [
    ("What floor do I live on", True),
    ("Which building level is my room on?", True),
    ("What floor was I on?", True),
    ("What is on the floor?", False),
    ("What color is the floor?", False),
    ("Where did I leave my bag on the floor?", False),
])
def test_building_level_disambiguation(question, expected):
    assert building_floor_question(question) is expected


async def test_building_floor_query_attaches_level_sign_over_many_surface_matches(workspace):
    db, settings, provider = workspace
    surfaces = [add_frame(workspace, 200 + i * 5, summary="A laptop on a floor. Floor tiles.")
                for i in range(70)]
    sign = add_frame(workspace, 100, summary="Elevator beside an emergency evacuation diagram.")
    db.execute("UPDATE events SET objects=? WHERE id=?", (
        json.dumps([{"label": "elevator sign", "description": "LEVEL 7", "location": "Beside the door"}]),
        sign,
    ))
    memory = Memory(db, provider, settings)
    assert (await memory.search("What floor do I live on", limit=18))[0]["id"] == sign
    await memory.ask("What floor do I live on")
    assert sign in {path.stem for path in provider.calls[0][2]}
    assert len(provider.calls[0][2]) <= settings.recall_max_images
    assert "does not prove the user lives there" in provider.calls[0][0]
    # Query expansion cannot escape an explicit time filter.
    assert sign not in {row["id"] for row in await memory.search("What floor do I live on", after=150)}
    assert surfaces[0] in {row["id"] for row in await memory.search("floor", after=195, before=210)}


@pytest.mark.parametrize("misleading", [
    {"summary": "A hallway with an elevator.", "objects": [{
        "label": "carpeted floor", "description": "Gray carpet.", "location": "On the ground level."
    }]},
    {"summary": "A hallway on floor 9.", "objects": [{
        "label": "elevator", "description": "The car display shows 9, suggesting floor 9."
    }]},
    {"summary": "A room door numbered 914.", "objects": [{
        "label": "room door", "description": "Room 914, probably on floor 9."
    }]},
    {"summary": "Elevator and a sign.", "objects": [{
        "label": "call button", "description": "Metal button.", "location": "Below the LEVEL 9 sign."
    }]},
])
def test_fixed_level_sign_ranks_above_car_display_guesses_and_object_locations(misleading):
    sign = {"summary": "An elevator panel.", "objects": [{
        "label": "white placard", "description": "Printed ELEVATOR 4, LEVEL 9."
    }]}
    assert building_floor_rank(sign) == 5
    assert building_floor_rank(sign) > building_floor_rank(misleading)


async def test_floor_recall_keeps_adjacent_legible_sign_views_before_wide_hallways(workspace):
    db, settings, provider = workspace
    signs = []
    for i in range(3):
        identifier = add_frame(workspace, 100 + i, summary="A white elevator placard.")
        db.execute("UPDATE events SET objects=? WHERE id=?", (json.dumps([{
            "label": "level sign", "description": "LEVEL 9, printed in black."
        }]), identifier))
        signs.append(identifier)
    for i in range(20):
        identifier = add_frame(workspace, 200 + i, summary="An elevator hallway on floor 9.")
        db.execute("UPDATE events SET objects=? WHERE id=?", (json.dumps([{
            "label": "floor", "description": "A gray carpet.", "location": "On the ground level."
        }]), identifier))
    await Memory(db, provider, settings).ask("What floor do I live on")
    # Nearby views can make small text readable; keep the ordinary three-photo
    # budget, but do not replace a clear sign with an unrelated wide hallway.
    assert {path.stem for path in provider.calls[0][2]} == set(signs)
