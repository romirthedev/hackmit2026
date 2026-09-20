"""Explicit, private walkthrough cache with immutable evidence and honest provenance.

The manifest belongs in data/demo/manifest.json, never in the repository. It is
an operator-authored record of completed original-evidence review, not a claim
that a new model ran each time a cached answer is requested.
"""

import asyncio
import hashlib
import json
import re
import time
import uuid
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from .db import event_public
from .recording_integrity import fingerprint, verified_fragment
from .sampled_evidence import attach_original_recordings


class DemoIntegrityError(ValueError):
    pass


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReviewedMedia(StrictModel):
    id: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class ReviewedChunk(StrictModel):
    seq: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class ReviewedRecording(StrictModel):
    id: str = Field(min_length=1)
    chunks: list[ReviewedChunk] = Field(min_length=1)


class OriginalReview(StrictModel):
    reviewed_at: float = Field(gt=0)
    reviewer: str = Field(min_length=1, max_length=200)
    method: str = Field(pattern=r"^original-evidence-review$")
    notes: str = Field(min_length=1, max_length=2000)


class DemoEntry(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9_-]+$")
    aliases: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)
    detail_questions: list[str] = Field(default_factory=list)
    followups: list[str] = Field(default_factory=list)
    answer: str = Field(min_length=1, max_length=1500)
    details: str = Field(default="", max_length=1500)
    evidence_ids: list[str] = Field(min_length=1)
    review: OriginalReview


class DemoManifest(StrictModel):
    version: int = Field(ge=1, le=1)
    recordings: list[ReviewedRecording] = Field(default_factory=list)
    media: list[ReviewedMedia] = Field(min_length=1)
    entries: list[DemoEntry] = Field(min_length=1)


def normalize(value):
    value = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    value = re.sub(r"^(?:(?:hey|hi|okay|ok) )?(?:rewind )", "", value)
    value = re.sub(r"^(?:hey|hi|hello|okay|ok) ", "", value)
    value = re.sub(r"^(?:please |can you |could you )", "", value)
    return re.sub(r" please$", "", value).strip()


FOLLOWUPS = {
    "where exactly", "more details", "tell me more", "tell me more details",
    "be more specific", "give me more details", "which room", "what room",
    "which shelf", "what shelf", "what is it next to", "what s it next to",
    "describe it",
}
# A canned location must never answer an unsupported multi-part or temporal request.
UNSUPPORTED = re.compile(
    r"\b(?:and|or|before|after|yesterday|today|tomorrow|earlier|later|since|until|"
    r"dosage|dose|take|safe|safety|allergic|allergy|side effect|why|when)\b"
)


class DemoMemory:
    def __init__(self, db, settings):
        self.db, self.s = db, settings
        self.path = settings.data_dir / "demo" / "manifest.json"
        self._signature = None
        self._manifest = None
        self._digest = None
        self.error = ""
        with db.connect() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS demo_answers (
                answer_id TEXT PRIMARY KEY REFERENCES answers(id) ON DELETE CASCADE,
                entry_id TEXT NOT NULL, detailed INTEGER NOT NULL, manifest_sha256 TEXT NOT NULL
            )""")

    @property
    def enabled(self):
        return self.s.demo_mode

    def manifest(self):
        if not self.enabled:
            return None
        try:
            signature = fingerprint(self.path.stat())
            if signature != self._signature:
                raw = self.path.read_bytes()
                manifest = DemoManifest.model_validate_json(raw)
                if len({m.id for m in manifest.media}) != len(manifest.media):
                    raise DemoIntegrityError("Repeated walkthrough media IDs")
                if len({r.id for r in manifest.recordings}) != len(manifest.recordings):
                    raise DemoIntegrityError("Repeated walkthrough recording IDs")
                if len({e.id for e in manifest.entries}) != len(manifest.entries):
                    raise DemoIntegrityError("Repeated walkthrough answer IDs")
                media_ids = {m.id for m in manifest.media}
                for entry in manifest.entries:
                    if not set(entry.evidence_ids) <= media_ids:
                        raise DemoIntegrityError("A walkthrough answer lacks pinned evidence")
                self._manifest, self._signature = manifest, signature
                self._digest = hashlib.sha256(raw).hexdigest()
            self.error = ""
            return self._manifest
        except (OSError, ValueError) as exc:
            self.error = "The private walkthrough manifest is missing or invalid."
            raise DemoIntegrityError(self.error) from exc

    def validate_sources(self, manifest, evidence_ids=None, recordings=True):
        wanted = set(evidence_ids) if evidence_ids is not None else None
        try:
            for source in manifest.media:
                if wanted is not None and source.id not in wanted:
                    continue
                row = self.db.one("SELECT * FROM media WHERE id=?", (source.id,))
                if row is None or row["sha256"] != source.sha256:
                    raise DemoIntegrityError("Walkthrough image metadata changed")
                verified_fragment({**row, "sha256": source.sha256})
            if recordings:
                for recording in manifest.recordings:
                    row = self.db.one("SELECT * FROM continuous_recordings WHERE id=?", (recording.id,))
                    parts = self.db.all(
                        "SELECT * FROM recording_chunks WHERE recording_id=? ORDER BY seq", (recording.id,)
                    )
                    pinned = {part.seq: part.sha256 for part in recording.chunks}
                    if (not row or row["expected_chunks"] != len(parts)
                            or len(pinned) != len(recording.chunks) or len(parts) != len(pinned)
                            or [part["seq"] for part in parts] != list(range(len(parts)))):
                        raise DemoIntegrityError("Walkthrough original is incomplete")
                    for part in parts:
                        if pinned.get(part["seq"]) != part["sha256"]:
                            raise DemoIntegrityError("Walkthrough original metadata changed")
                        verified_fragment({**part, "sha256": pinned[part["seq"]]})
        except (OSError, ValueError) as exc:
            self.error = "A protected walkthrough source is missing or changed; restore it before continuing."
            raise DemoIntegrityError(self.error) from exc

    def protection(self):
        """Fail closed before any reset; keep complete streams and label ancestors."""
        manifest = self.manifest()
        if manifest is None:
            return {"media": set(), "recordings": set(), "paths": set()}
        self.validate_sources(manifest)
        media_ids = {source.id for source in manifest.media}
        recording_ids = {recording.id for recording in manifest.recordings}
        for identifier in recording_ids:
            media_ids.update(row["id"] for row in self.db.all("SELECT id FROM media WHERE boot=?", (identifier,)))
        # Retain inherited labels' source images as well as displayed labels.
        pending = list(media_ids)
        while pending:
            row = self.db.one("SELECT inherited_from FROM events WHERE id=?", (pending.pop(),))
            if row and row["inherited_from"] and row["inherited_from"] not in media_ids:
                media_ids.add(row["inherited_from"])
                pending.append(row["inherited_from"])
        paths = set()
        for identifier in media_ids:
            row = self.db.one("SELECT path FROM media WHERE id=?", (identifier,))
            if row:
                paths.add(Path(row["path"]).resolve())
        for identifier in recording_ids:
            paths.update(Path(row["path"]).resolve() for row in self.db.all(
                "SELECT path FROM recording_chunks WHERE recording_id=?", (identifier,)
            ))
        for line in self.speech_lines(manifest):
            digest = hashlib.sha256(f"{self.s.deepgram_tts_model}\n{line}".encode()).hexdigest()[:32]
            paths.add((self.s.data_dir / "voice" / f"{digest}.mp3").resolve())
        return {"media": media_ids, "recordings": recording_ids, "paths": paths}

    def status(self):
        base = {"enabled": self.enabled, "ready": False, "entry_count": 0,
                "protected_media_count": 0, "protected_recording_count": 0, "error": ""}
        if not self.enabled:
            return base
        try:
            manifest = self.manifest()
            keep = self.protection()
            return {**base, "ready": True, "entry_count": len(manifest.entries),
                    "protected_media_count": len(keep["media"]),
                    "protected_recording_count": len(keep["recordings"])}
        except DemoIntegrityError:
            return {**base, "error": self.error}

    def speech_lines(self, manifest=None):
        if not self.enabled:
            return []
        from .voice import reviewed_spoken_text
        manifest = manifest or self.manifest()
        return list(dict.fromkeys(reviewed_spoken_text(line) for e in manifest.entries
                                  for line in (e.answer, e.details) if line))

    def match(self, question, manifest):
        value = normalize(question)
        if UNSUPPORTED.search(value):
            return None
        direct = []
        for entry in manifest.entries:
            if value in {normalize(q) for q in entry.detail_questions}:
                direct.append((entry, True))
            elif value in {normalize(q) for q in entry.questions}:
                direct.append((entry, False))
            else:
                aliases = {normalize(a) for a in entry.aliases if a.strip()}
                phrases = {f"{owner}{alias}" for alias in aliases
                           for owner in ("", "my ", "the ", "our ", "grandma s ")}
                questions = {f"{prefix} {phrase}" for phrase in phrases for prefix in (
                    "where is", "where are", "where s", "where did i put", "where did i leave",
                    "where can i find", "find", "locate", "do you know where is", "do you know where are",
                )}
                questions.update(f"do you know where {phrase} {verb}" for phrase in phrases for verb in ("is", "are"))
                questions.update(f"tell me where {phrase} {verb}" for phrase in phrases for verb in ("is", "are"))
                if value in questions:
                    direct.append((entry, False))
        if len(direct) == 1:
            return direct[0]
        scoped_followups = {normalize(q) for e in manifest.entries for q in e.followups}
        if direct or value not in FOLLOWUPS | scoped_followups:
            return None
        previous = self.db.one("""SELECT a.id,a.mode,a.created_at,d.entry_id,d.manifest_sha256
            FROM answers a LEFT JOIN demo_answers d ON d.answer_id=a.id ORDER BY a.created_at DESC LIMIT 1""")
        if (previous and previous["mode"] == "demo_cached"
                and time.time() - previous["created_at"] < 600
                and previous["manifest_sha256"] == self._digest):
            if self.db.one("SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_turns'"):
                interrupted = self.db.one("""SELECT id FROM conversation_turns
                    WHERE created_at>? AND status IN ('completed','clarification','error','acting','awaiting_permission','permission_sending')
                    AND (answer_id IS NULL OR answer_id!=?) LIMIT 1""", (previous["created_at"], previous["id"]))
                if interrupted:
                    return None
            entry = next((e for e in manifest.entries if e.id == previous["entry_id"]), None)
            if entry and (value in FOLLOWUPS or value in {normalize(q) for q in entry.followups}):
                return entry, True
        return None

    def receipt(self, entry):
        return {"status": "complete", "receipt": {
            "claims_reviewed": True, "cached": True, "method": entry.review.method,
            "reviewer": entry.review.reviewer, "reviewed_at": entry.review.reviewed_at,
            "scope": entry.review.notes, "evidence_ids": entry.evidence_ids,
            "source": "private walkthrough review", "fresh_model_review": False,
        }}

    def public(self, answer_id):
        if not self.enabled:
            return None
        saved = self.db.one("""SELECT d.*,a.answer,a.mode FROM demo_answers d
            JOIN answers a ON a.id=d.answer_id WHERE d.answer_id=?""", (answer_id,))
        if not saved or saved["mode"] != "demo_cached":
            return None
        try:
            manifest = self.manifest()
            entry = next((e for e in manifest.entries if e.id == saved["entry_id"]), None)
            if not entry or self._digest != saved["manifest_sha256"]:
                return None
            expected = (entry.details or entry.answer) if saved["detailed"] else entry.answer
            if saved["answer"] != expected:
                return None
            self.validate_sources(manifest, entry.evidence_ids)
            return self.receipt(entry)
        except DemoIntegrityError:
            return None

    async def ask(self, question, after=None, before=None, source_media=None):
        if not self.enabled or after is not None or before is not None:
            return None
        started = time.monotonic()
        cutoff = self.db.setting("history_cleared_before", 0)
        try:
            manifest = self.manifest()
            manifest_digest = self._digest
            matched = self.match(question, manifest)
            if not matched:
                return None
            entry, detailed = matched
            await asyncio.to_thread(self.validate_sources, manifest, entry.evidence_ids)
        except DemoIntegrityError:
            return None
        # A deliberate, bounded reading beat makes the rehearsal feel natural.
        beat = self.s.demo_response_delay_s + (int(hashlib.sha256(question.encode()).hexdigest()[:4], 16) % 180) / 1000
        await asyncio.sleep(max(0, beat - (time.monotonic() - started)))
        # A reset or source change during the beat must not resurrect old claims.
        try:
            self.manifest()
            if self._digest != manifest_digest or self.db.setting("history_cleared_before", 0) != cutoff:
                return None
            self.validate_sources(manifest, entry.evidence_ids)
        except DemoIntegrityError:
            return None
        evidence = []
        for identifier in entry.evidence_ids:
            row = self.db.one("""SELECT m.*,e.summary,e.transcript,e.objects,e.tags,e.segments,e.confidence
                FROM media m LEFT JOIN events e ON e.id=m.id WHERE m.id=?""", (identifier,))
            evidence.append(event_public(row))
        evidence_scope = attach_original_recordings(self.db, evidence)
        record = {"id": str(uuid.uuid4()), "question": question,
                  "answer": (entry.details or entry.answer) if detailed else entry.answer,
                  "evidence": evidence, "evidence_scope": evidence_scope,
                  "created_at": time.time(), "grounded": True, "mode": "demo_cached",
                  "verification": self.receipt(entry), "demo": {"entry_id": entry.id, "cached": True,
                  "detailed": detailed, "response_ms": round((time.monotonic() - started) * 1000)}}
        if source_media:
            previous = self.db.one("SELECT * FROM answers WHERE source_media=?", (source_media,))
            if previous:
                previous["evidence"] = json.loads(previous["evidence"])
                previous["verification"] = self.public(previous["id"])
                return previous if previous["verification"] else None
        with self.db.connect() as c:
            c.execute("INSERT INTO answers(id,question,answer,evidence,created_at,source_media,grounded,mode) "
                      "VALUES(?,?,?,?,?,?,1,'demo_cached')", (record["id"], question, record["answer"],
                      json.dumps(evidence), record["created_at"], source_media))
            c.execute("INSERT INTO demo_answers VALUES(?,?,?,?)",
                      (record["id"], entry.id, int(detailed), self._digest))
        return record
