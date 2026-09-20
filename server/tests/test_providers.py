import base64
import json

import httpx
import pytest
from rewind.config import Settings
from rewind.models import Observation
from rewind.providers import Provider


@pytest.mark.parametrize("backend", ["ollama", "openai"])
async def test_actual_provider_request_shape_and_image_evidence(backend, tmp_path):
    s = Settings(_env_file=None, provider=backend, openai_api_key="test-not-a-real-key")
    p = Provider(s)
    await p.http.aclose()
    image = tmp_path / "frame.jpg"
    image.write_bytes(b"jpeg-fixture")
    observed = {"summary": "Wallet next to notebook.", "objects": [], "tags": ["wallet"], "confidence": 0.8}

    def handler(request):
        body = json.loads(request.content)
        if backend == "ollama":
            assert request.url.path == "/api/chat"
            assert [m["images"] for m in body["messages"] if "images" in m] == [
                [base64.b64encode(b"jpeg-fixture").decode()]
            ] * 2
            assert body["messages"][-1]["content"] == "Evidence."
            assert body["format"]["type"] == "object" and body["stream"] is False
            assert body["think"] is False
            return httpx.Response(200, json={"done": True, "message": {"content": json.dumps(observed)}})
        assert request.url.path == "/v1/responses"
        assert body["store"] is False
        assert len([x for x in body["input"][0]["content"] if x["type"] == "input_image"]) == 2
        return httpx.Response(
            200, json={"output": [{"content": [{"type": "output_text", "text": json.dumps(observed)}]}]}
        )

    p.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await p.structured("Observe.", "Evidence.", Observation, images=[image, image])
    assert result.summary == "Wallet next to notebook."
    await p.close()


async def test_malformed_model_output_is_rejected():
    p = Provider(Settings(_env_file=None))
    await p.http.aclose()
    p.http = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda r: httpx.Response(
                200, json={"done": True, "message": {"content": '{"summary":"x","confidence":8}'}}
            )
        )
    )
    with pytest.raises(ValueError):
        await p.structured("Observe.", "frame", Observation)
    await p.close()


async def test_recall_uses_separate_queue_and_model_without_routing_labels_there(tmp_path):
    from rewind.models import RecallAnswer

    settings = Settings(
        _env_file=None,
        vision_model="fast-vision",
        reasoning_model="fast-text",
        ollama_url="http://labels:11434",
        ollama_context=8192,
        ollama_recall_url="http://recall:11435",
        ollama_recall_model="large-vision",
        ollama_recall_context=32768,
        ollama_recall_think=True,
        ollama_embedding_url="http://embeddings:11436",
    )
    provider = Provider(settings)
    await provider.http.aclose()
    image = tmp_path / "frame.jpg"
    image.write_bytes(b"original-fixture")
    routes = []

    def handler(request):
        body = json.loads(request.content)
        routes.append(str(request.url))
        if request.url.host == "embeddings":
            assert request.url.path == "/api/embed"
            return httpx.Response(200, json={"embeddings": [[0.1, 0.2]]})
        if request.url.host == "labels":
            assert body["model"] == "fast-vision"
            assert body["think"] is False
            assert body["options"]["num_ctx"] == 8192
            answer = {"summary": "A scene.", "confidence": 0.8}
        else:
            assert request.url.host == "recall"
            assert body["model"] == "large-vision"
            assert body["think"] is True
            assert body["options"]["num_ctx"] == 32768
            assert body["messages"][1]["images"] == [base64.b64encode(b"original-fixture").decode()]
            answer = {"answer": "Not established.", "evidence_ids": [], "insufficient_evidence": True}
        return httpx.Response(200, json={"done": True, "message": {"content": json.dumps(answer)}})

    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    await provider.observe(image)
    await provider.structured("Recall.", "Question.", RecallAnswer, images=[image], recall=True)
    assert await provider.embed("A query") == [0.1, 0.2]
    assert routes == [
        "http://labels:11434/api/chat",
        "http://recall:11435/api/chat",
        "http://embeddings:11436/api/embed",
    ]
    await provider.close()


async def test_llamacpp_preserves_images_and_rejects_truncated_answers(tmp_path):
    settings = Settings(_env_file=None, local_inference_api="llamacpp")
    provider = Provider(settings)
    await provider.http.aclose()
    images = [tmp_path / name for name in ("first.jpg", "second.jpg")]
    for i, path in enumerate(images):
        path.write_bytes(f"original-{i}".encode())
    finish_reason = "stop"

    def handler(request):
        body = json.loads(request.content)
        assert request.url.path == "/v1/chat/completions"
        assert [m["content"][1]["image_url"]["url"] for m in body["messages"][1:-1]] == [
            "data:image/jpeg;base64," + base64.b64encode(p.read_bytes()).decode() for p in images
        ]
        assert body["messages"][-1]["content"] == "Question with evidence labels."
        assert body["response_format"]["json_schema"]["schema"]["type"] == "object"
        assert body["chat_template_kwargs"] == {"enable_thinking": False}
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"finish_reason": finish_reason, "message": {"content": '{"summary":"Two images."}'}}
                ]
            },
        )

    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    assert (
        await provider.structured("Observe.", "Question with evidence labels.", Observation, images=images)
    ).summary == "Two images."
    finish_reason = "length"
    with pytest.raises(ValueError, match="truncated"):
        await provider.structured("Observe.", "Question with evidence labels.", Observation, images=images)
    await provider.close()


@pytest.mark.parametrize("backend", ["ollama", "llamacpp", "openai"])
@pytest.mark.parametrize("labels", [["E6"], ["E4", "E9"]])
async def test_images_carry_actual_source_labels_instead_of_attachment_ordinals(tmp_path, backend, labels):
    provider = Provider(
        Settings(
            _env_file=None,
            provider="openai" if backend == "openai" else "ollama",
            local_inference_api="llamacpp" if backend == "llamacpp" else "ollama",
            openai_api_key="test-not-a-real-key",
        )
    )
    await provider.http.aclose()
    images = []
    for label in labels:
        path = tmp_path / (label + ".jpg")
        path.write_bytes(("pixels-for-" + label).encode())
        images.append(path)

    def handler(request):
        body = json.loads(request.content)
        if backend == "openai":
            parts = body["input"][0]["content"]
            for i, label in enumerate(labels):
                assert parts[1 + 2 * i]["text"] == f"Original image source {label}."
                assert parts[2 + 2 * i]["image_url"].endswith(
                    base64.b64encode(images[i].read_bytes()).decode()
                )
            return httpx.Response(
                200,
                json={
                    "output": [
                        {"content": [{"type": "output_text", "text": '{"summary":"Bound originals."}'}]}
                    ]
                },
            )
        image_turns = body["messages"][1 : 1 + len(labels)]
        for turn, label, path in zip(image_turns, labels, images, strict=True):
            caption = turn["content"][0]["text"] if backend == "llamacpp" else turn["content"]
            assert caption.startswith(f"Original image source {label}.")
            encoded = base64.b64encode(path.read_bytes()).decode()
            if backend == "llamacpp":
                assert turn["content"][1]["image_url"]["url"].endswith(encoded)
            else:
                assert turn["images"] == [encoded]
        answer = '{"summary":"Bound originals."}'
        if backend == "llamacpp":
            return httpx.Response(
                200, json={"choices": [{"finish_reason": "stop", "message": {"content": answer}}]}
            )
        return httpx.Response(200, json={"done": True, "message": {"content": answer}})

    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await provider.structured(
        "Inspect originals.", json.dumps({"attached_images_in_order": labels}), Observation, images=images
    )
    assert result.summary == "Bound originals."
    await provider.close()


async def test_image_source_label_mismatch_fails_before_inference(tmp_path):
    provider = Provider(Settings(_env_file=None))
    image = tmp_path / "original.jpg"
    image.write_bytes(b"original")
    with pytest.raises(ValueError, match="labels"):
        await provider.structured(
            "Inspect.", json.dumps({"attached_images_in_order": ["E1", "E2"]}), Observation, images=[image]
        )
    await provider.close()


def test_local_schema_drops_string_length_limits_only():
    from rewind.inference import chat_request, grammar_safe
    from rewind.models import Observation, RecallAnswer

    schema = RecallAnswer.model_json_schema()
    assert schema["properties"]["answer"]["maxLength"] == 8000
    safe = grammar_safe(schema)
    assert "maxLength" not in safe["properties"]["answer"]
    assert safe["properties"]["evidence_ids"]["maxItems"] == 20
    assert safe["required"] == schema["required"]
    nested = grammar_safe(Observation.model_json_schema())
    assert "maxLength" not in nested["$defs"]["ObjectObservation"]["properties"]["label"]
    assert nested["$defs"]["ObjectObservation"]["properties"]["confidence"]["maximum"] == 1
    _, payload = chat_request("ollama", "m", [], schema)
    assert "maxLength" not in payload["format"]["properties"]["answer"]
    # The validated model still enforces the limit.
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        RecallAnswer(answer="x" * 8001, evidence_ids=[], insufficient_evidence=True)


async def test_compact_text_scene_enriches_from_original_without_losing_poster_details(tmp_path):
    import hashlib
    import io

    from PIL import Image

    original = tmp_path / 'poster.jpg'
    Image.new('RGB', (1280, 960), 'white').save(original)
    digest = hashlib.sha256(original.read_bytes()).hexdigest()
    provider = Provider(Settings(
        _env_file=None, compact_observations=True, labeler_long_side=448,
        observation_max_tokens=128, processing_url='http://asus', processing_token='test',
    ))
    await provider.http.aclose()
    calls = []

    def handler(request):
        payload = json.loads(request.content)
        calls.append(payload['schema_name'])
        with Image.open(io.BytesIO(base64.b64decode(payload['images'][0]))) as image:
            size = image.size
        if payload['schema_name'] == 'CompactObservation':
            assert size == (448, 336)
            return httpx.Response(200, json={
                'summary': 'A game night poster hangs beside a study door.', 'tags': ['poster', 'door'],
            })
        assert payload['schema_name'] == 'Observation'
        assert size == (1280, 960)
        assert payload['max_tokens'] >= 1536
        return httpx.Response(200, json={
            'summary': 'Game night: October 12 at 7 PM, room 204.',
            'objects': [{'label': 'poster', 'description': 'October 12 at 7 PM, room 204',
                         'location': 'beside the study door'}],
            'tags': ['game night', 'study room'],
        })

    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await provider.observe(original)
    assert calls == ['CompactObservation', 'Observation']
    assert 'October 12 at 7 PM' in result.summary
    assert result.objects[0].location == 'beside the study door'
    assert hashlib.sha256(original.read_bytes()).hexdigest() == digest
    await provider.close()


async def test_compact_ordinary_scene_stays_one_call(tmp_path):
    provider = Provider(Settings(_env_file=None, compact_observations=True,
                                 processing_url='http://asus', processing_token='test'))
    await provider.http.aclose()
    original = tmp_path / 'chair.jpg'
    original.write_bytes(b'original-fixture')
    calls = []

    def handler(request):
        calls.append(json.loads(request.content)['schema_name'])
        return httpx.Response(200, json={'summary': 'A blue chair beside a table.', 'tags': ['chair']})

    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await provider.observe(original)
    assert result.summary == 'A blue chair beside a table.'
    assert calls == ['CompactObservation']
    await provider.close()
