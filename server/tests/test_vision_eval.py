"""Guard evaluation integrity: withheld criteria and bounded, auditable pixels."""

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import httpx
import pytest
from rewind.video import Sample

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("api", ["ollama", "llamacpp"])
@pytest.mark.parametrize("complete", [True, False])
def test_vision_evaluation_withholds_answers_and_records_incomplete_output(
    tmp_path, monkeypatch, complete, api
):
    spec = importlib.util.spec_from_file_location("evaluate_vision", ROOT / "scripts/evaluate_vision.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"explicit fixture, not real video")
    plan = tmp_path / "plan.json"
    plan.write_text(
        json.dumps(
            {
                "source_title": "WITHHELD TITLE",
                "clip_sha256": hashlib.sha256(video.read_bytes()).hexdigest(),
                "questions": [{"question": "What is visible?", "criterion": "WITHHELD ANSWER"}],
            }
        )
    )
    samples = [
        Sample("frame", i, f"jpeg{i}".encode(), t, i, "1/1", i, 0) for i, t in enumerate([0.0, 1.1, 2.4])
    ]
    monkeypatch.setattr(module, "video_samples", lambda *args: iter(samples))
    output = tmp_path / "result"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "evaluate_vision",
            str(video),
            str(plan),
            "--model",
            "fixture-vlm",
            "--output",
            str(output),
            "--api",
            api,
        ],
    )
    requests = []

    def handler(request):
        if request.url.path == "/api/show":
            return httpx.Response(200, json={"capabilities": ["vision"]})
        if request.url.path == "/slots":
            return httpx.Response(200, json=[{"id": 0, "n_ctx": 32768}])
        if request.url.path in ("/api/chat", "/v1/chat/completions"):
            body = json.loads(request.content)
            requests.append(body)
            assert "WITHHELD" not in request.content.decode()
            context = json.loads(body["messages"][-1]["content"])
            assert [r["offset_seconds"] for r in context["frames"]] == [0, 1.1, 2.4]
            if api == "ollama":
                image_turns = [m for m in body["messages"] if "images" in m]
                assert len(image_turns) == 3
                assert all(len(m["images"]) == 1 for m in image_turns)
            else:
                assert len([m for m in body["messages"] if isinstance(m["content"], list)]) == 3
                return httpx.Response(
                    200,
                    json={
                        "choices": [
                            {
                                "finish_reason": "stop" if complete else "length",
                                "message": {
                                    "content": json.dumps(
                                        {
                                            "answer": "Fixture claim.",
                                            "evidence_ids": ["E3"],
                                            "insufficient_evidence": False,
                                        }
                                    )
                                },
                            }
                        ]
                    },
                )
            return httpx.Response(
                200,
                json={
                    "model": "fixture-vlm",
                    "done": True,
                    "done_reason": "stop" if complete else "length",
                    "message": {
                        "content": json.dumps(
                            {
                                "answer": "Fixture claim.",
                                "evidence_ids": ["E3"],
                                "insufficient_evidence": False,
                            }
                        )
                    },
                },
            )
        return httpx.Response(200, json={})

    client_type = httpx.Client
    monkeypatch.setattr(
        module.httpx, "Client", lambda **kwargs: client_type(**kwargs, transport=httpx.MockTransport(handler))
    )
    module.main()
    result = json.loads((output / "results.json").read_text())
    assert len(requests) == 1
    assert result["results"][0]["complete"] is complete
    assert result["results"][0]["citations_valid"] is True
    assert result["plan"]["questions"][0]["criterion"] == "WITHHELD ANSWER"
    assert "grade" not in result["results"][0]
    assert (output / "E3.jpg").read_bytes() == b"jpeg2"
