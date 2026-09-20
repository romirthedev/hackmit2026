"""Spoken questions and spoken answers.

The phone listens while it records. When a sentence starts with the wake word
("Rewind, where are my glasses?") the audio comes here, Deepgram turns it into
text, the memory answers it, and Deepgram reads the short answer back. Filler
lines ("Let me look through your day") are pre-synthesized so the phone can say
something right away while the model works.

Without a Deepgram key the server still transcribes with faster-whisper and the
browser falls back to its own speech synthesis.
"""

import asyncio
import hashlib
import logging
import os
import random
import re
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

log = logging.getLogger("rewind.voice")

DEEPGRAM = "https://api.deepgram.com/v1"
# Accept the ways speech-to-text tends to hear "Rewind" at the start of a sentence.
WAKE = re.compile(
    r"^\W*(?:(?:hey|hi|ok|okay|hello|um|uh)\W+)?"
    r"(?:re[\s-]?wind(?:s|ed)?|rewound|reewind|re[\s-]?wine|rewind)\b[\s,.!?:;-]*",
    re.I,
)
FILLERS = [
    "Let me look through your day for that.",
    "One moment, I'm checking your recordings.",
    "Sure, let me have a look.",
    "Okay, give me a second to look back.",
    "Let me find that for you.",
]
LISTENING_REPLIES = [
    "Yes? I'm listening.",
    "I'm here. What would you like to know?",
]
AUDIO_TYPES = {
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/aac": ".aac",
    "audio/flac": ".flac",
}


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1500)


class VoiceAsk(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    after: float | None = None
    before: float | None = None


def spoken_text(answer: str) -> str:
    """The part of an answer worth reading aloud: first paragraph, no citations."""
    text = re.sub(r"\[?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\]?", "", answer, flags=re.I)
    text = re.sub(r"\[E[0-9]+\]", "", text)
    first = text.strip().split("\n\n")[0]
    first = re.sub(r"\s+", " ", first).strip()
    if len(first) > 420:
        cut = first[:420]
        first = cut[: cut.rfind(". ") + 1] if ". " in cut else cut
    return first or "I couldn't find that in your day."


class Voice:
    def __init__(self, settings, provider, memory):
        self.s, self.p, self.memory = settings, provider, memory
        self.key = settings.deepgram_api_key
        self.directory = (settings.data_dir / "voice").resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(45, connect=10))
        self._filler_lock = asyncio.Lock()

    @property
    def enabled(self):
        return bool(self.key)

    def status(self):
        return {
            "deepgram": self.enabled,
            "tts_model": self.s.deepgram_tts_model if self.enabled else None,
            "stt_model": self.s.deepgram_stt_model if self.enabled else self.s.whisper_model,
            "wake_word": "rewind",
        }

    async def close(self):
        await self.http.aclose()

    # ---- hearing -------------------------------------------------------
    async def transcribe(self, data: bytes, mime: str) -> dict:
        if self.enabled:
            response = await self.http.post(
                DEEPGRAM + "/listen",
                params={
                    "model": self.s.deepgram_stt_model,
                    "smart_format": "true",
                    "punctuate": "true",
                    "keyterm": "Rewind",
                    "language": "en",
                },
                headers={"Authorization": "Token " + self.key, "Content-Type": mime},
                content=data,
            )
            if response.status_code != 200:
                log.warning("Deepgram transcription failed (%s)", response.status_code)
                raise HTTPException(503, "Speech recognition is unavailable right now.")
            try:
                alternative = response.json()["results"]["channels"][0]["alternatives"][0]
            except (KeyError, IndexError, ValueError):
                raise HTTPException(503, "Speech recognition returned no result.")
            return {
                "text": str(alternative.get("transcript", "")).strip(),
                "confidence": float(alternative.get("confidence") or 0),
            }
        suffix = AUDIO_TYPES.get(mime, ".wav")
        with tempfile.NamedTemporaryFile(prefix="rewind-voice-", suffix=suffix, delete=False) as target:
            target.write(data)
            path = Path(target.name)
        try:
            result = await self.p.transcribe(path)
        finally:
            path.unlink(missing_ok=True)
        words = [w for segment in result.get("segments", []) for w in segment.get("words", [])]
        probabilities = [float(w["probability"]) for w in words if "probability" in w]
        return {
            "text": str(result.get("text", "")).strip(),
            "confidence": sum(probabilities) / len(probabilities) if probabilities else 0.0,
        }

    @staticmethod
    def parse(text: str, require_wake: bool) -> dict:
        match = WAKE.match(text or "")
        directed = bool(match) or not require_wake
        question = text[match.end() :].strip() if match else text.strip()
        return {"transcript": text, "directed": directed, "question": question if directed else ""}

    # ---- speaking ------------------------------------------------------
    def _cache_path(self, text: str) -> Path:
        digest = hashlib.sha256(f"{self.s.deepgram_tts_model}\n{text}".encode()).hexdigest()[:32]
        return self.directory / f"{digest}.mp3"

    async def synthesize(self, text: str) -> Path:
        if not self.enabled:
            raise HTTPException(503, "Spoken replies need REWIND_DEEPGRAM_API_KEY.")
        text = text.strip()[:1500]
        path = self._cache_path(text)
        if path.is_file() and path.stat().st_size > 0:
            return path
        response = await self.http.post(
            DEEPGRAM + "/speak",
            params={"model": self.s.deepgram_tts_model, "encoding": "mp3"},
            headers={"Authorization": "Token " + self.key, "Content-Type": "application/json"},
            json={"text": text},
        )
        if response.status_code != 200 or not response.content:
            log.warning("Deepgram speech failed (%s)", response.status_code)
            raise HTTPException(503, "The voice is unavailable right now.")
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(response.content)
        os.replace(tmp, path)
        return path

    async def filler(self) -> Path:
        async with self._filler_lock:
            return await self.synthesize(random.choice(FILLERS))

    async def warm(self):
        """Pre-generate filler lines so the first spoken question has no extra delay."""
        if not self.enabled:
            return
        for line in FILLERS + LISTENING_REPLIES:
            try:
                await self.synthesize(line)
            except Exception:
                log.info("Filler line not pre-generated: %s", line)
                return


def voice_router(voice: Voice, admin, max_bytes: int):
    router = APIRouter(prefix="/api/voice", dependencies=[Depends(admin)])

    @router.get("/status")
    async def status():
        return voice.status()

    @router.post("/hear")
    async def hear(req: Request, wake: bool = True):
        mime = req.headers.get("content-type", "").split(";")[0].strip().lower()
        if mime not in AUDIO_TYPES:
            raise HTTPException(415, "Send WAV, WebM, Ogg, MP4 or MP3 audio")
        data = bytearray()
        async for chunk in req.stream():
            data.extend(chunk)
            if len(data) > max_bytes:
                raise HTTPException(413, "Speech clip is too large")
        if len(data) < 200:
            raise HTTPException(400, "Empty speech clip")
        started = time.monotonic()
        heard = await voice.transcribe(bytes(data), mime)
        parsed = voice.parse(heard["text"], wake)
        return {
            **parsed,
            "confidence": heard["confidence"],
            "seconds": round(time.monotonic() - started, 2),
        }

    @router.post("/ask")
    async def ask(body: VoiceAsk):
        question = body.question.strip()
        if not question:
            reply = random.choice(LISTENING_REPLIES)
            speech = None
            if voice.enabled:
                try:
                    await voice.synthesize(reply)
                    speech = "/api/voice/say?text=" + quote(reply)
                except HTTPException:
                    speech = None
            return {"answer": None, "spoken": reply, "speech_url": speech}
        record = await voice.memory.ask(question, body.after, body.before)
        spoken = spoken_text(record["answer"])
        speech_url = None
        if voice.enabled:
            try:
                await voice.synthesize(spoken)
                speech_url = f"/api/voice/speech/{record['id']}"
            except HTTPException:
                speech_url = None
        return {"answer": record, "spoken": spoken, "speech_url": speech_url}

    @router.get("/speech/{answer_id}")
    async def speech(answer_id: str):
        row = voice.memory.db.one("SELECT answer FROM answers WHERE id=?", (answer_id,))
        if not row:
            raise HTTPException(404, "Answer not found")
        path = await voice.synthesize(spoken_text(row["answer"]))
        return FileResponse(path, media_type="audio/mpeg")

    @router.get("/filler")
    async def filler():
        path = await voice.filler()
        return FileResponse(path, media_type="audio/mpeg")

    @router.get("/say")
    async def say(text: str):
        if not text.strip() or len(text) > 400:
            raise HTTPException(422, "text must be 1-400 characters")
        path = await voice.synthesize(text)
        return FileResponse(path, media_type="audio/mpeg")

    @router.post("/speak")
    async def speak(body: SpeakRequest):
        path = await voice.synthesize(spoken_text(body.text))
        return Response(path.read_bytes(), media_type="audio/mpeg")

    return router
