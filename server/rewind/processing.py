"""Private ASUS inference service. Bind to loopback and forward over Tailscale SSH."""

import asyncio
import base64
import hmac
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .config import Settings
from .models import CompactObservation, Observation, RecallAnswer, RuleDecision, SearchPlan
from .providers import Provider

SCHEMAS = {c.__name__: c for c in (CompactObservation, Observation, RecallAnswer, RuleDecision, SearchPlan)}


class StructuredInput(BaseModel):
    system: str = Field(max_length=16000)
    content: str = Field(max_length=80000)
    schema_name: str
    images: list[str] = Field(default_factory=list, max_length=16)
    vision: bool = False
    recall: bool = False
    max_tokens: int = Field(default=768, ge=64, le=2048)


class AudioInput(BaseModel):
    audio: str = Field(max_length=28_000_000)
    suffix: Literal[".wav", ".webm", ".mp4", ".m4a", ".ogg"]


class EmbedInput(BaseModel):
    text: str = Field(max_length=12000)


class PriorityGate:
    """Reserve the next available inference slot for a question, not old labels."""

    def __init__(self, slots=1):
        self.slots = slots
        self.active = 0
        self.questions = 0
        self.condition = asyncio.Condition()

    @asynccontextmanager
    async def enter(self, question=False):
        async with self.condition:
            self.questions += int(question)
            try:
                await self.condition.wait_for(
                    lambda: self.active < self.slots and (question or not self.questions)
                )
                self.active += 1
            finally:
                self.questions -= int(question)
                self.condition.notify_all()
        try:
            yield
        finally:
            async with self.condition:
                self.active -= 1
                self.condition.notify_all()


def decode(encoded, path, maximum):
    try:
        if len(encoded) > maximum * 4 // 3 + 4:
            raise ValueError("too large")
        raw = base64.b64decode(encoded, validate=True)
        if not raw or len(raw) > maximum:
            raise ValueError("invalid size")
        path.write_bytes(raw)
    except ValueError as exc:
        raise HTTPException(422, "Invalid recording payload") from exc


def create_processing_app(settings=None, provider=None):
    s = settings or Settings()
    if len(s.processing_token) < 24:
        raise ValueError("Configure a private processing token of at least 24 characters")
    if s.processing_url:
        raise ValueError("ASUS service must not proxy to itself")
    p = provider or Provider(s)
    gate = PriorityGate(max(1, s.workers))

    async def auth(req: Request):
        if not hmac.compare_digest(req.headers.get("authorization", ""), "Bearer " + s.processing_token):
            raise HTTPException(401, "Processing authentication required")

    @asynccontextmanager
    async def lifespan(app):
        try:
            yield
        finally:
            await p.close()

    app = FastAPI(
        lifespan=lifespan, dependencies=[Depends(auth)], docs_url=None, redoc_url=None, openapi_url=None
    )

    @app.get("/health")
    async def health():
        ready = False
        try:
            if s.local_inference_api == "ollama":
                result = await p.http.get(s.ollama_url + "/api/tags", timeout=5)
                result.raise_for_status()
                ready = s.vision_model in {m["name"] for m in result.json().get("models", [])}
            else:
                result = await p.http.get(s.ollama_url + "/health", timeout=5)
                ready = result.status_code == 200
        except Exception:
            pass
        return {
            "host": "asus",
            "model": s.vision_model,
            "ready": ready,
            "active": gate.active,
            "waiting_questions": gate.questions,
        }

    @app.post("/structured")
    async def structured(body: StructuredInput):
        schema = SCHEMAS.get(body.schema_name)
        if schema is None:
            raise HTTPException(422, "Unsupported result schema")
        with tempfile.TemporaryDirectory(prefix="rewind-inference-") as directory:
            paths = []
            for i, encoded in enumerate(body.images):
                path = Path(directory) / f"{i}.jpg"
                decode(encoded, path, 2 * 1024 * 1024)
                paths.append(path)
            async with gate.enter(body.recall):
                result = await p.structured(
                    body.system,
                    body.content,
                    schema,
                    images=paths,
                    vision=body.vision,
                    recall=body.recall,
                    max_tokens=body.max_tokens,
                )
            return result.model_dump()

    @app.post("/transcribe")
    async def transcribe(body: AudioInput):
        with tempfile.TemporaryDirectory(prefix="rewind-audio-") as directory:
            path = Path(directory) / ("clip" + body.suffix)
            decode(body.audio, path, 20 * 1024 * 1024)
            return await p.transcribe(path)

    @app.post("/embed")
    async def embed(body: EmbedInput):
        return {"embedding": await p.embed(body.text)}

    return app
