"""Food at the mouth in one frame, gone from the next frames, becomes a meal."""

import asyncio
import io
import json
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from rewind.app import create_app
from rewind.chat import direct_memory_question
from rewind.config import Settings
from rewind.meals import FOOD_WORDS, FoodCheck, clean_label, same_food
from rewind.models import Observation, RecallAnswer, SearchPlan

ADMIN = "admin-test-" + "a" * 30
DEVICE = "device-test-" + "d" * 30

# Each scene is a solid colour so the fake vision model can recognise it from the pixels.
SCENES = {
    "white": ("A kitchen counter with a kettle and a folded towel.", None),
    "blue": ("A person reads a book by the window.", None),
    "green": (
        "A banana lies on the table next to a plate.",
        FoodCheck(food_visible=True, food="banana", at_mouth=False),
    ),
    "yellow": (
        "A hand holds a peeled banana up to the mouth.",
        FoodCheck(food_visible=True, food="a peeled banana", at_mouth=True),
    ),
    "red": (
        "A red apple is being bitten, held close to the camera.",
        FoodCheck(food_visible=True, food="apple", at_mouth=True),
    ),
}
COLORS = {"white": (255, 255, 255), "blue": (0, 0, 255), "green": (0, 200, 0), "yellow": (255, 230, 0), "red": (220, 0, 0)}


def scene_of(path):
    with Image.open(path) as image:
        pixel = image.convert("RGB").getpixel((2, 2))
    return min(COLORS, key=lambda name: sum(abs(a - b) for a, b in zip(COLORS[name], pixel)))


class ScenePlayer:
    def __init__(self):
        self.food_checks = []

    async def observe(self, path):
        summary, _ = SCENES[scene_of(path)]
        return Observation(summary=summary, tags=[], confidence=0.9)

    async def structured(self, system, content, schema, image=None, **kwargs):
        if schema is FoodCheck:
            self.food_checks.append(scene_of(image))
            check = SCENES[scene_of(image)][1]
            return check or FoodCheck(food_visible=False, food="", at_mouth=False)
        if schema is SearchPlan:
            return SearchPlan()
        if schema is RecallAnswer:
            data = json.loads(content)
            cited = [row["id"] for row in data["evidence"] if row.get("source_kind") == "meal"]
            if not cited:
                return RecallAnswer(answer="I didn't see you eat today.", evidence_ids=[], insufficient_evidence=True)
            cited = [data["evidence"][0]["id"], *cited]
            return RecallAnswer(
                answer="You had a banana around 3:15 this afternoon.",
                evidence_ids=cited,
                insufficient_evidence=False,
            )
        raise AssertionError(f"Unexpected schema {schema}")

    async def embed(self, text):
        return None

    async def transcribe(self, path):
        return {"text": "", "segments": []}

    async def close(self):
        pass


@pytest.fixture
def context(tmp_path):
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        admin_token=ADMIN,
        device_token=DEVICE,
        workers=0,
        embeddings=False,
        min_free_gb=0,
    )
    provider = ScenePlayer()
    app = create_app(settings, provider)
    with TestClient(app) as client:
        yield client, app, provider


def jpeg(color):
    buffer = io.BytesIO()
    Image.new("RGB", (64, 48), COLORS[color]).save(buffer, "JPEG", quality=95)
    return buffer.getvalue()


def admin():
    return {"Authorization": "Bearer " + ADMIN}


def send(client, seq, color, at):
    response = client.post(
        "/api/ingest/frame",
        content=jpeg(color),
        headers={
            "Authorization": "Bearer " + DEVICE,
            "X-Device-ID": "necklace-01",
            "X-Boot-ID": "mealboot",
            "X-Sequence": str(seq),
            "X-Captured-At": str(at),
            "Content-Type": "image/jpeg",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def process(app, item):
    asyncio.run(app.state.worker.process(item))


def drain(app):
    while item := app.state.worker.claim():
        process(app, item)


def test_bite_then_gone_records_a_meal_and_answers_from_it(context):
    client, app, provider = context
    start = time.time() - 30
    ids = [send(client, i, color, start + i) for i, color in enumerate(["white", "green", "yellow", "yellow", "white", "blue"])]
    drain(app)

    meals = client.get("/api/meals", headers=admin()).json()
    assert len(meals) == 1
    meal = meals[0]
    assert meal["status"] == "eaten"
    assert meal["food"] == "peeled banana"
    assert meal["bites"] == 2
    assert meal["sightings"] == ids[2:4]
    assert meal["started_at"] == pytest.approx(start + 2)
    assert meal["last_seen_at"] == pytest.approx(start + 3)
    assert meal["gone_at"] == pytest.approx(start + 4)
    assert meal["reason"] == "food_gone"
    assert meal["image_url"] == f"/api/media/{ids[3]}"
    assert meal["summary"].startswith("Ate peeled banana around ")
    # Frames whose captions never mention food cost no extra model call.
    assert provider.food_checks == ["green", "yellow", "yellow"]
    sightings = client.get("/api/meals/sightings", headers=admin()).json()
    assert {row["source"] for row in sightings} == {"caption", "model"}

    answer = client.post("/api/ask", json={"question": "What did I eat today?"}, headers=admin()).json()
    assert answer["answer"].startswith("You had a banana")
    assert answer["grounded"] is True
    sources = {row["id"]: row for row in answer["evidence"]}
    assert sources[meal["id"]]["source"] == "meal"
    assert sources[meal["id"]]["context_kind"] == "meal"
    assert ids[3] in sources and sources[ids[3]]["kind"] == "frame"


def test_food_merely_in_view_never_starts_a_meal(context):
    client, app, provider = context
    start = time.time() - 30
    for i, color in enumerate(["green", "green", "white", "white"]):
        send(client, i, color, start + i)
    drain(app)
    assert client.get("/api/meals", headers=admin()).json() == []
    assert provider.food_checks == ["green", "green"]
    answer = client.post("/api/ask", json={"question": "Did I eat anything today?"}, headers=admin()).json()
    assert answer["evidence"] == []


def test_meal_waits_for_unlabelled_frames_between_bite_and_absence(context):
    client, app, _ = context
    start = time.time() - 30
    ids = [send(client, i, color, start + i) for i, color in enumerate(["yellow", "green", "white", "white"])]
    claimed = {}
    while item := app.state.worker.claim():
        claimed[item["id"]] = item
    # Parallel workers finish the two empty frames and the bite before the frame in between.
    for media_id in (ids[2], ids[3], ids[0]):
        process(app, claimed[media_id])
    meal = app.state.meals.list()[0]
    assert meal["status"] == "open"
    process(app, claimed[ids[1]])
    meal = app.state.meals.list()[0]
    assert meal["status"] == "eaten"
    assert meal["last_seen_at"] == pytest.approx(start + 1)
    assert meal["gone_at"] == pytest.approx(start + 2)


def test_two_empty_frames_mid_sandwich_do_not_split_the_meal(context):
    client, app, _ = context
    start = time.time() - 60
    ids = [send(client, i, color, start + i) for i, color in enumerate(["yellow", "white", "white"])]
    drain(app)
    first = app.state.meals.list()[0]
    assert first["status"] == "eaten"
    ids.append(send(client, 3, "yellow", start + 3))
    drain(app)
    reopened = app.state.meals.list()
    assert [meal["id"] for meal in reopened] == [first["id"]]
    assert reopened[0]["status"] == "open" and reopened[0]["bites"] == 2
    for seq, color in ((4, "white"), (5, "blue")):
        send(client, seq, color, start + seq)
    drain(app)
    final = app.state.meals.list()[0]
    assert final["status"] == "eaten" and final["bites"] == 2
    assert final["sightings"] == [ids[0], ids[3]]
    assert final["gone_at"] == pytest.approx(start + 4)


def test_a_different_food_much_later_is_a_new_meal(context):
    client, app, _ = context
    start = time.time() - 1000
    send(client, 0, "yellow", start)
    send(client, 1, "white", start + 1)
    send(client, 2, "white", start + 2)
    send(client, 3, "red", start + 600)
    send(client, 4, "white", start + 601)
    send(client, 5, "white", start + 602)
    drain(app)
    meals = app.state.meals.list()
    assert [(meal["food"], meal["status"]) for meal in meals] == [("apple", "eaten"), ("peeled banana", "eaten")]


def test_recording_that_stops_after_the_last_bite_still_settles(context):
    client, app, _ = context
    send(client, 0, "yellow", time.time() - 5)
    drain(app)
    meal = app.state.meals.list()[0]
    assert meal["status"] == "open"
    assert meal["summary"].startswith("Eating peeled banana right now.")
    app.state.db.execute("UPDATE meals SET updated_at=updated_at-1000")
    meal = app.state.meals.list()[0]
    assert meal["status"] == "eaten" and meal["reason"] == "no_later_frames"
    assert meal["gone_at"] is None
    assert "No later photos showed it again." in meal["summary"]


def test_inherited_captions_reuse_the_parent_sighting(context):
    client, app, provider = context
    start = time.time() - 30
    ids = [send(client, i, "yellow", start + i) for i in range(2)]
    drain(app)
    assert provider.food_checks == ["yellow", "yellow"]
    # A change-gated frame carries its parent's caption; the food is where it was.
    app.state.db.execute("UPDATE events SET label_mode='inherited',inherited_from=? WHERE id=?", (ids[0], ids[1]))
    app.state.db.execute("DELETE FROM food_sightings WHERE id=?", (ids[1],))
    event = app.state.db.one("SELECT summary,tags,objects,label_mode,inherited_from FROM events WHERE id=?", (ids[1],))
    item = app.state.db.one("SELECT * FROM media WHERE id=?", (ids[1],))
    row = asyncio.run(app.state.meals.check(item, event))
    assert row["source"] == "inherited" and row["at_mouth"] == 1 and row["food"] == "peeled banana"
    assert provider.food_checks == ["yellow", "yellow"]


def test_clearing_memory_removes_meals(context):
    client, app, _ = context
    send(client, 0, "yellow", time.time() - 5)
    drain(app)
    assert app.state.meals.list()
    from rewind.history import clear_memory

    clear_memory(app.state.db, app.state.settings.data_dir, time.time())
    assert app.state.meals.list() == []
    assert app.state.db.all("SELECT * FROM food_sightings") == []


@pytest.mark.parametrize(
    "caption,expected",
    [
        ("A hand holds a peeled banana up to the mouth.", True),
        ("Someone is eating at the table.", True),
        ("A slice of pizza on a paper plate.", True),
        ("A brown wallet is left of the blue notebook on the table.", False),
        ("An orange traffic cone on the street.", True),
        ("Two cups of coffee on the counter.", False),
    ],
)
def test_food_prefilter(caption, expected):
    assert bool(FOOD_WORDS.search(caption)) is expected


def test_food_labels_are_compared_loosely():
    assert clean_label("a slice of Pizza") == "pizza"
    assert clean_label("some food") == ""
    assert same_food("peeled banana", "banana")
    assert same_food("banana", "food")
    assert not same_food("banana", "apple")


@pytest.mark.parametrize(
    "question,memory",
    [
        ("What did I eat today?", True),
        ("Did I eat lunch?", True),
        ("Have I eaten?", True),
        ("What did I have for breakfast?", True),
        ("What should I eat for dinner?", False),
        ("Is a banana a healthy snack?", False),
    ],
)
def test_past_eating_questions_go_to_memory(question, memory):
    assert (direct_memory_question(question) == question) is memory
