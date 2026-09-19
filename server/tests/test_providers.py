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
            assert body["messages"][1]["images"] == [base64.b64encode(b"jpeg-fixture").decode()] * 2
            assert body["format"]["type"] == "object" and body["stream"] is False
            assert body["think"] is False
            return httpx.Response(200, json={"message": {"content": json.dumps(observed)}})
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
            lambda r: httpx.Response(200, json={"message": {"content": '{"summary":"x","confidence":8}'}})
        )
    )
    with pytest.raises(ValueError):
        await p.structured("Observe.", "frame", Observation)
    await p.close()
