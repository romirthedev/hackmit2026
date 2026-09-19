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
