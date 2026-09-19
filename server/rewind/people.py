"""Explicit name confirmations linked to original frames, with revocation and audit history."""

import asyncio
import base64
import hashlib
import json
import time
import uuid
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .faces import MODEL, normalized, possible_match


class NameConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID
    media_id: uuid.UUID
    face_key: str = Field(min_length=64, max_length=64, pattern="^[a-f0-9]+$")
    name: str = Field(min_length=1, max_length=120)
    person_id: uuid.UUID | None = None
    confirmed: Literal[True]


class NameCorrection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    version: int = Field(ge=1)


class PeopleMemory:
    def __init__(self, db, settings):
        self.db, self.s = db, settings
        self.lock = asyncio.Lock()
        self.cache = {}
        with db.connect() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS people (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL, revoked_at REAL
                );
                CREATE TABLE IF NOT EXISTS person_evidence (
                    id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
                    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
                    sha256 TEXT NOT NULL, face_key TEXT NOT NULL, box TEXT NOT NULL,
                    model TEXT NOT NULL, embedding TEXT, confirmed_at REAL NOT NULL, revoked_at REAL,
                    confirmation TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS person_active_face ON person_evidence(media_id,face_key)
                    WHERE revoked_at IS NULL;
                CREATE TABLE IF NOT EXISTS person_audit (
                    id TEXT PRIMARY KEY, person_id TEXT NOT NULL, action TEXT NOT NULL,
                    payload TEXT NOT NULL, created_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS face_index (
                    media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
                    sha256 TEXT NOT NULL, model TEXT NOT NULL, features TEXT,
                    processed_at REAL NOT NULL, retry_at REAL NOT NULL DEFAULT 0
                );
            """)

    def capabilities(self):
        return {
            "confirmation_required": True,
            "inference_host": "ASUS via Tailscale",
            "face_service_configured": bool(self.s.processing_url and self.s.processing_token),
            "matching": "tentative_similarity",
            "model": MODEL,
            "identity_accuracy_validated": False,
            "automatic_name_assignment": False,
        }

    def original(self, media_id):
        row = self.db.one("SELECT * FROM media WHERE id=? AND kind='frame'", (str(media_id),))
        if not row:
            raise HTTPException(404, "Original frame was not found.")
        path = Path(row["path"])
        if not path.is_file():
            raise HTTPException(409, "The original frame is unavailable.")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != row["sha256"]:
            raise HTTPException(409, "The original frame has changed; this name link cannot be used.")
        return row, data

    async def encoded(self, media_id):
        row, data = self.original(media_id)
        cached = self.cache.get(row["id"])
        if cached and cached[0] == row["sha256"] and time.monotonic() - cached[1] < 300:
            return row, cached[2]
        indexed = self.db.one(
            "SELECT features FROM face_index WHERE media_id=? AND sha256=? AND model=? AND features IS NOT NULL",
            (row["id"], row["sha256"], MODEL),
        )
        if indexed:
            return row, json.loads(indexed["features"])
        if not self.s.processing_url or not self.s.processing_token:
            raise HTTPException(503, "Connect the ASUS face service before confirming names.")
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
                response = await client.post(
                    self.s.processing_url.rstrip("/") + "/faces",
                    headers={"Authorization": "Bearer " + self.s.processing_token},
                    json={"image": base64.b64encode(data).decode()},
                )
                response.raise_for_status()
                result = response.json()
            if result["model"] != MODEL or result["sha256"] != row["sha256"] or len(result["faces"]) > 20:
                raise ValueError("Mismatched face evidence")
            for face in result["faces"]:
                normalized(face["embedding"])
                box = face["box"]
                if len(box) != 4 or not all(isinstance(v, (int, float)) and 0 <= v <= 1 for v in box):
                    raise ValueError("Invalid face region")
                if box[2] <= box[0] or box[3] <= box[1]:
                    raise ValueError("Empty face region")
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            raise HTTPException(
                503, "ASUS face analysis is unavailable. Your original frame is still saved."
            ) from None
        # Bound raw feature retention on this orchestration process.
        if len(self.cache) >= 30:
            self.cache.pop(next(iter(self.cache)))
        self.cache[row["id"]] = (row["sha256"], time.monotonic(), result)
        # Re-read originals before committing a result obtained asynchronously.
        self.original(media_id)
        self.db.execute(
            """INSERT INTO face_index VALUES(?,?,?,?,?,0) ON CONFLICT(media_id) DO UPDATE SET
            sha256=excluded.sha256,model=excluded.model,features=excluded.features,
            processed_at=excluded.processed_at,retry_at=0""",
            (row["id"], row["sha256"], MODEL, json.dumps(result), time.time()),
        )
        return row, result

    def gallery(self):
        rows = self.db.all(
            """SELECT e.*,p.name FROM person_evidence e JOIN people p ON p.id=e.person_id
            JOIN media m ON m.id=e.media_id WHERE e.revoked_at IS NULL AND p.revoked_at IS NULL
            AND e.embedding IS NOT NULL AND e.model=? AND e.sha256=m.sha256""",
            (MODEL,),
        )
        valid = []
        for row in rows:
            try:
                self.original(row["media_id"])
            except HTTPException:
                continue
            valid.append({**row, "embedding": json.loads(row["embedding"])})
        return valid

    async def inspect(self, media_id):
        row, result = await self.encoded(media_id)
        gallery = self.gallery()
        return {
            "media_id": row["id"],
            "media_url": "/api/media/" + row["id"],
            "model": result["model"],
            "faces": [
                {
                    **{k: v for k, v in face.items() if k != "embedding"},
                    "match": possible_match(face["embedding"], gallery),
                }
                for face in result["faces"]
            ],
            "capabilities": self.capabilities(),
        }

    def recent_frames(self):
        return [
            {**row, "media_url": "/api/media/" + row["id"]}
            for row in self.db.all(
                "SELECT id,captured_at FROM media WHERE kind='frame' ORDER BY captured_at DESC LIMIT 60"
            )
        ]

    def coverage(self):
        return self.db.one(
            """SELECT COUNT(*) AS retained_frames,
            COALESCE(SUM(CASE WHEN f.features IS NOT NULL AND f.model=? AND f.sha256=m.sha256 THEN 1 ELSE 0 END),0) AS indexed_frames
            FROM media m LEFT JOIN face_index f ON f.media_id=m.id WHERE m.kind='frame'""",
            (MODEL,),
        )

    def indexed_frames(self):
        # A full day may contain many thousands of originals. Stream feature rows
        # instead of materializing the whole biometric index in memory.
        with self.db.connect() as c:
            yield from c.execute(
                """SELECT f.*,m.captured_at FROM face_index f JOIN media m ON m.id=f.media_id
                WHERE f.model=? AND f.features IS NOT NULL AND f.sha256=m.sha256 ORDER BY m.captured_at DESC""",
                (MODEL,),
            )

    def sightings(self, person_id, limit=40):
        person = self.db.one("SELECT * FROM people WHERE id=? AND revoked_at IS NULL", (str(person_id),))
        if not person:
            raise HTTPException(404, "Person was not found.")
        gallery = self.gallery()
        matches = []
        for row in self.indexed_frames():
            # Original-source checks are performed before exposing a candidate.
            found = []
            for face in json.loads(row["features"])["faces"]:
                match = possible_match(face["embedding"], gallery)
                if match.get("person_id") == str(person_id):
                    found.append({"box": face["box"], "match": match})
            if found:
                try:
                    self.original(row["media_id"])
                except HTTPException:
                    continue
                matches.append(
                    {
                        "media_id": row["media_id"],
                        "captured_at": row["captured_at"],
                        "media_url": "/api/media/" + row["media_id"],
                        "faces": found,
                    }
                )
                if len(matches) >= limit:
                    break
        current = self.db.one("SELECT version,revoked_at FROM people WHERE id=?", (str(person_id),))
        if not current or current["revoked_at"] is not None or current["version"] != person["version"]:
            raise HTTPException(
                409, "This person's name links changed while searching. Refresh and try again."
            )
        return {
            "person_id": str(person_id),
            "name": person["name"],
            "possible_sightings": matches,
            "coverage": self.coverage(),
            "identity_confirmed": False,
        }

    async def run(self):
        """Backfill retained frames on ASUS only after somebody is explicitly enrolled."""
        while True:
            active = self.db.one(
                """SELECT p.id FROM people p JOIN person_evidence e ON e.person_id=p.id
                WHERE p.revoked_at IS NULL AND e.revoked_at IS NULL AND e.embedding IS NOT NULL LIMIT 1"""
            )
            if not active or not self.s.processing_url:
                await asyncio.sleep(5)
                continue
            pending = self.db.one(
                """SELECT m.id,m.sha256 FROM media m LEFT JOIN face_index f ON f.media_id=m.id
                WHERE m.kind='frame' AND (f.media_id IS NULL OR f.model!=? OR f.sha256!=m.sha256
                OR (f.features IS NULL AND f.retry_at<?)) ORDER BY m.captured_at DESC LIMIT 1""",
                (MODEL, time.time()),
            )
            if not pending:
                await asyncio.sleep(5)
                continue
            try:
                await self.encoded(pending["id"])
            except HTTPException:
                self.db.execute(
                    """INSERT INTO face_index VALUES(?,?,?,NULL,?,?) ON CONFLICT(media_id) DO UPDATE SET
                    sha256=excluded.sha256,model=excluded.model,features=NULL,
                    processed_at=excluded.processed_at,retry_at=excluded.retry_at""",
                    (pending["id"], pending["sha256"], MODEL, time.time(), time.time() + 60),
                )
                await asyncio.sleep(2)
            # Yield to capture, question orchestration and user confirmations.
            await asyncio.sleep(0.1)

    def people(self):
        people = self.db.all("SELECT * FROM people WHERE revoked_at IS NULL ORDER BY name,id")
        for person in people:
            person["evidence"] = [
                {
                    **row,
                    "box": json.loads(row["box"]),
                    "media_url": "/api/media/" + row["media_id"],
                    "provenance": "user_confirmed_name",
                }
                for row in self.db.all(
                    """SELECT e.id,e.media_id,e.sha256,e.box,e.confirmed_at,m.captured_at
                    FROM person_evidence e JOIN media m ON m.id=e.media_id
                    WHERE e.person_id=? AND e.revoked_at IS NULL ORDER BY e.confirmed_at DESC""",
                    (person["id"],),
                )
            ]
        return people

    @staticmethod
    def audit(c, person_id, action, payload):
        c.execute(
            "INSERT INTO person_audit VALUES(?,?,?,?,?)",
            (str(uuid.uuid4()), person_id, action, json.dumps(payload), time.time()),
        )

    @staticmethod
    def invalidate(c, person_id):
        # Future retrieval consumers may cite name provenance. Never leave an old
        # identity assertion cached after a correction or revocation.
        for row in c.execute("SELECT id,evidence FROM answers").fetchall():
            if person_id in row["evidence"]:
                c.execute("DELETE FROM answers WHERE id=?", (row["id"],))

    async def confirm(self, body):
        name = body.name.strip()
        if not name:
            raise HTTPException(422, "Enter the person's name.")
        request = body.model_dump(mode="json")
        async with self.lock:
            previous = self.db.one("SELECT * FROM person_evidence WHERE id=?", (str(body.request_id),))
            if previous:
                if json.loads(previous["confirmation"]) != request:
                    raise HTTPException(409, "This confirmation ID has already been used.")
                return {
                    "person_id": previous["person_id"],
                    "evidence_id": previous["id"],
                    "status": "revoked" if previous["revoked_at"] else "confirmed",
                }
            row, encoded = await self.encoded(body.media_id)
            selected = [f for f in encoded["faces"] if f["key"] == body.face_key]
            if len(selected) != 1:
                raise HTTPException(409, "Choose the face again before confirming its name.")
            face = selected[0]
            person_id = str(body.person_id or uuid.uuid4())
            now = time.time()
            with self.db.connect() as c:
                c.execute("BEGIN IMMEDIATE")
                # Recheck the source at commit time, after the remote response.
                self.original(body.media_id)
                old = c.execute(
                    "SELECT * FROM person_evidence WHERE media_id=? AND face_key=? AND revoked_at IS NULL",
                    (str(body.media_id), body.face_key),
                ).fetchone()
                if old:
                    raise HTTPException(
                        409, "This face already has a name record. Correct or revoke it first."
                    )
                if body.person_id:
                    person = c.execute(
                        "SELECT * FROM people WHERE id=? AND revoked_at IS NULL", (person_id,)
                    ).fetchone()
                    if not person or person["name"] != name:
                        raise HTTPException(409, "The selected person changed. Refresh the people list.")
                else:
                    c.execute("INSERT INTO people VALUES(?,?,1,?,?,NULL)", (person_id, name, now, now))
                c.execute(
                    "INSERT INTO person_evidence VALUES(?,?,?,?,?,?,?,?,?,NULL,?)",
                    (
                        str(body.request_id),
                        person_id,
                        row["id"],
                        row["sha256"],
                        face["key"],
                        json.dumps(face["box"]),
                        encoded["model"],
                        json.dumps(face["embedding"]),
                        now,
                        json.dumps(request),
                    ),
                )
                self.audit(
                    c, person_id, "confirmed_name", {"evidence_id": str(body.request_id), "name": name}
                )
            return {"person_id": person_id, "evidence_id": str(body.request_id), "status": "confirmed"}

    def correct(self, person_id, body):
        name = body.name.strip()
        if not name:
            raise HTTPException(422, "Enter the person's name.")
        with self.db.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            old = c.execute(
                "SELECT * FROM people WHERE id=? AND revoked_at IS NULL", (str(person_id),)
            ).fetchone()
            if not old:
                raise HTTPException(404, "Person was not found.")
            if old["version"] != body.version:
                raise HTTPException(409, "This name changed. Refresh before correcting it.")
            c.execute(
                "UPDATE people SET name=?,version=version+1,updated_at=? WHERE id=?",
                (name, time.time(), str(person_id)),
            )
            self.audit(c, str(person_id), "corrected_name", {"previous_name": old["name"], "name": name})
            self.invalidate(c, str(person_id))
        return {"ok": True}

    def revoke(self, person_id):
        with self.db.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            old = c.execute("SELECT * FROM people WHERE id=?", (str(person_id),)).fetchone()
            if not old:
                raise HTTPException(404, "Person was not found.")
            if old["revoked_at"] is None:
                now = time.time()
                c.execute(
                    "UPDATE people SET revoked_at=?,updated_at=?,version=version+1 WHERE id=?",
                    (now, now, str(person_id)),
                )
                c.execute(
                    "UPDATE person_evidence SET revoked_at=?,embedding=NULL WHERE person_id=?",
                    (now, str(person_id)),
                )
                self.audit(c, str(person_id), "revoked", {"name": old["name"]})
                self.invalidate(c, str(person_id))
        self.cache.clear()
        return {"ok": True}

    def revoke_evidence(self, evidence_id):
        with self.db.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute("SELECT * FROM person_evidence WHERE id=?", (str(evidence_id),)).fetchone()
            if not row:
                raise HTTPException(404, "Name confirmation was not found.")
            if row["revoked_at"] is None:
                c.execute(
                    "UPDATE person_evidence SET revoked_at=?,embedding=NULL WHERE id=?",
                    (time.time(), str(evidence_id)),
                )
                self.audit(c, row["person_id"], "revoked_evidence", {"evidence_id": str(evidence_id)})
                c.execute(
                    "UPDATE people SET version=version+1,updated_at=? WHERE id=?",
                    (time.time(), row["person_id"]),
                )
                self.invalidate(c, row["person_id"])
        self.cache.clear()
        return {"ok": True}


def people_router(people, admin):
    router = APIRouter(prefix="/api/people", dependencies=[Depends(admin)])

    @router.get("")
    async def list_people():
        return {
            "people": people.people(),
            "capabilities": people.capabilities(),
            "coverage": people.coverage(),
        }

    @router.get("/frames")
    async def frames():
        return people.recent_frames()

    @router.get("/frames/{media_id}/faces")
    async def inspect(media_id: uuid.UUID):
        return await people.inspect(media_id)

    @router.post("/confirm")
    async def confirm(body: NameConfirmation):
        return await people.confirm(body)

    @router.patch("/{person_id}")
    async def correct(person_id: uuid.UUID, body: NameCorrection):
        return people.correct(person_id, body)

    @router.get("/{person_id}/sightings")
    async def sightings(person_id: uuid.UUID):
        return await asyncio.to_thread(people.sightings, person_id)

    @router.delete("/evidence/{evidence_id}")
    async def revoke_evidence(evidence_id: uuid.UUID):
        return people.revoke_evidence(evidence_id)

    @router.delete("/{person_id}")
    async def revoke(person_id: uuid.UUID):
        return people.revoke(person_id)

    return router
