"""Lossless retention of ordered MediaRecorder fragments, separate from inference samples.

Fragments after the first are not assumed to be independently playable. The original
endpoint streams their exact concatenation, with byte ranges for browser playback.
"""

import asyncio
import hashlib
import math
import os
import re
import shutil
import time
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .history import require_current_capture
from .recording_integrity import fingerprint, fragments_status, verified_fragment
from .storage import retained_bytes

SCHEMA = """
CREATE TABLE IF NOT EXISTS continuous_recordings (
 id TEXT PRIMARY KEY, mime TEXT NOT NULL, started_at REAL NOT NULL,
 received_at REAL NOT NULL, updated_at REAL NOT NULL,
 ended_at REAL, expected_chunks INTEGER, end_reason TEXT
);
CREATE TABLE IF NOT EXISTS recording_chunks (
 recording_id TEXT NOT NULL REFERENCES continuous_recordings(id),
 seq INTEGER NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
 path TEXT NOT NULL, captured_at REAL NOT NULL,
 PRIMARY KEY(recording_id,seq)
);
"""


class RecordingEnd(BaseModel):
    mime: str = Field(max_length=150)
    started_at: float = Field(gt=0, allow_inf_nan=False)
    ended_at: float = Field(gt=0, allow_inf_nan=False)
    chunks: int = Field(ge=0, le=1000000)
    reason: Literal["stopped", "hidden", "interrupted", "storage_full", "page_closed"]


def recording_bytes(db):
    """Include these originals in the shared workspace storage quota."""
    return db.one("SELECT COALESCE(SUM(bytes),0) AS n FROM recording_chunks")["n"]


def recording_router(db, settings, admin, ingestion_lock=None):
    router = APIRouter(prefix="/api/continuous-recordings", dependencies=[Depends(admin)])
    directory = (settings.data_dir / "recordings").resolve()
    directory.mkdir(parents=True, exist_ok=True)
    with db.connect() as c:
        c.executescript(SCHEMA)
    lock = ingestion_lock or asyncio.Lock()

    def mime_type(value):
        if not re.fullmatch(r"video/(webm|mp4)(?:;\s*codecs=[\w., -]+)?", value, re.I):
            raise HTTPException(415, "A WebM or MP4 camera recording is required")
        return value.lower()

    def session(c, identifier, mime, started_at):
        row = c.execute("SELECT * FROM continuous_recordings WHERE id=?", (identifier,)).fetchone()
        if row:
            if row["mime"] != mime or abs(row["started_at"] - started_at) > 0.001:
                raise HTTPException(409, "Recording identity metadata changed")
        else:
            now = time.time()
            c.execute(
                "INSERT INTO continuous_recordings(id,mime,started_at,received_at,updated_at) VALUES(?,?,?,?,?)",
                (identifier, mime, started_at, now, now),
            )
        return row

    def manifest(identifier, include_chunks=True):
        row = db.one("SELECT * FROM continuous_recordings WHERE id=?", (identifier,))
        if not row:
            raise HTTPException(404, "Recording not found")
        summary = db.one(
            "SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes,MIN(seq) AS first,MAX(seq) AS last "
            "FROM recording_chunks WHERE recording_id=?",
            (identifier,),
        )
        count = row["expected_chunks"]
        contiguous = summary["count"] == 0 or (
            summary["first"] == 0 and summary["last"] + 1 == summary["count"]
        )
        complete = count is not None and count == summary["count"] and contiguous
        row.update(
            received_chunks=summary["count"],
            bytes=summary["bytes"],
            complete=complete,
            status="complete" if complete else "uploading" if count is not None else "open",
            fragment_format="ordered-container-fragments",
            original_url=f"/api/continuous-recordings/{identifier}/original"
            if complete and summary["count"]
            else None,
        )
        if include_chunks:
            row["chunks"] = db.all(
                "SELECT seq,bytes,sha256,captured_at FROM recording_chunks WHERE recording_id=? ORDER BY seq",
                (identifier,),
            )
        return row

    @router.get("")
    async def list_recordings(limit: int = 30):
        return [
            manifest(row["id"], include_chunks=False)
            for row in db.all(
                "SELECT id FROM continuous_recordings ORDER BY started_at DESC LIMIT ?",
                (max(1, min(limit, 100)),),
            )
        ]

    @router.get("/{recording_id}")
    async def get_recording(recording_id: UUID):
        return manifest(str(recording_id))

    @router.post("/{recording_id}/chunks/{sequence}")
    async def upload_chunk(recording_id: UUID, sequence: int, req: Request):
        identifier = str(recording_id)
        if not 0 <= sequence < 1000000:
            raise HTTPException(422, "Invalid recording sequence")
        mime = mime_type(req.headers.get("content-type", ""))
        try:
            started = float(req.headers["x-recording-started-at"])
            captured = float(req.headers["x-captured-at"])
            if not all(math.isfinite(v) and v > 0 for v in (started, captured)):
                raise ValueError
        except (KeyError, ValueError):
            raise HTTPException(422, "Recording timestamps are required") from None
        require_current_capture(db, started)
        data = bytearray()
        async for piece in req.stream():
            data.extend(piece)
            if len(data) > settings.max_upload_bytes:
                raise HTTPException(413, "Recording fragment exceeds upload size limit")
        if not data:
            raise HTTPException(422, "Empty recording fragment")
        # Only the first fragment must carry a container header. Later fragments
        # are retained exactly, never parsed or transcoded as independent clips.
        if sequence == 0 and not (
            (mime.startswith("video/webm") and data.startswith(b"\x1aE\xdf\xa3"))
            or (mime.startswith("video/mp4") and len(data) >= 12 and data[4:8] == b"ftyp")
        ):
            raise HTTPException(415, "The first fragment lacks its original container header")
        digest = hashlib.sha256(data).hexdigest()
        async with lock:
            with db.connect() as c:
                c.execute("BEGIN IMMEDIATE")
                row = session(c, identifier, mime, started)
                previous = c.execute(
                    "SELECT sha256,bytes FROM recording_chunks WHERE recording_id=? AND seq=?",
                    (identifier, sequence),
                ).fetchone()
                if previous:
                    if previous["sha256"] != digest or previous["bytes"] != len(data):
                        raise HTTPException(409, "Recording fragment already exists with different bytes")
                    return {"saved": True, "duplicate": True, "sha256": digest}
                if row and row["expected_chunks"] is not None and sequence >= row["expected_chunks"]:
                    raise HTTPException(409, "Fragment exceeds the finalized recording length")
                total = retained_bytes(db, c)
                if (
                    total + len(data) > settings.max_storage_gb * 1e9
                    or shutil.disk_usage(directory).free - len(data) < settings.min_free_gb * 1e9
                ):
                    raise HTTPException(507, "Server storage is full; keep this original on the phone")
                folder = directory / identifier
                created_folder = not folder.exists()
                folder.mkdir(exist_ok=True)
                path = folder / f"{sequence:08d}.part"
                temporary = folder / f"{sequence:08d}.pending"
                with temporary.open("wb") as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, path)
                # File fsync alone does not make a new directory entry durable.
                for synced_directory in [directory, folder] if created_folder else [folder]:
                    descriptor = os.open(synced_directory, os.O_RDONLY)
                    try:
                        os.fsync(descriptor)
                    finally:
                        os.close(descriptor)
                c.execute(
                    "INSERT INTO recording_chunks VALUES(?,?,?,?,?,?)",
                    (identifier, sequence, len(data), digest, str(path), captured),
                )
                c.execute(
                    "UPDATE continuous_recordings SET updated_at=? WHERE id=?", (time.time(), identifier)
                )
        return {"saved": True, "duplicate": False, "sha256": digest}

    @router.post("/{recording_id}/finish")
    async def finish(recording_id: UUID, body: RecordingEnd):
        require_current_capture(db, body.started_at)
        identifier, mime = str(recording_id), mime_type(body.mime)
        if body.ended_at < body.started_at:
            raise HTTPException(422, "Recording ends before it starts")
        async with lock:
            with db.connect() as c:
                c.execute("BEGIN IMMEDIATE")
                row = session(c, identifier, mime, body.started_at)
                if row and row["expected_chunks"] is not None:
                    if (
                        row["expected_chunks"] != body.chunks
                        or row["ended_at"] != body.ended_at
                        or row["end_reason"] != body.reason
                    ):
                        raise HTTPException(409, "Recording completion metadata already exists")
                maximum = c.execute(
                    "SELECT MAX(seq) FROM recording_chunks WHERE recording_id=?", (identifier,)
                ).fetchone()[0]
                if maximum is not None and maximum >= body.chunks:
                    raise HTTPException(409, "Completion count omits saved original fragments")
                c.execute(
                    "UPDATE continuous_recordings SET ended_at=?,expected_chunks=?,end_reason=?,updated_at=? WHERE id=?",
                    (body.ended_at, body.chunks, body.reason, time.time(), identifier),
                )
        return manifest(identifier, include_chunks=False)

    @router.get("/{recording_id}/original")
    async def original(recording_id: UUID, req: Request):
        identifier = str(recording_id)
        info = manifest(identifier, include_chunks=False)
        if not info["complete"] or not info["bytes"]:
            raise HTTPException(
                409, "The complete original is still uploading or was interrupted before finalization"
            )
        parts = db.all(
            "SELECT path,bytes,sha256 FROM recording_chunks WHERE recording_id=? ORDER BY seq", (identifier,)
        )
        integrity = await asyncio.to_thread(fragments_status, parts)
        if integrity != "available":
            raise HTTPException(410, "An original fragment is missing or differs from its retained hash")
        length = info["bytes"]
        start, end, status = 0, length - 1, 200
        if value := req.headers.get("range"):
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
            if not match or not any(match.groups()):
                raise HTTPException(
                    416, "Unsupported byte range", headers={"Content-Range": f"bytes */{length}"}
                )
            left, right = match.groups()
            if left:
                start, end = int(left), min(int(right) if right else length - 1, length - 1)
            else:
                start = max(0, length - int(right))
            if start > end or start >= length:
                raise HTTPException(
                    416, "Byte range unavailable", headers={"Content-Range": f"bytes */{length}"}
                )
            status = 206

        def stream():
            offset = 0
            for part in parts:
                part_end = offset + part["bytes"] - 1
                if part_end >= start and offset <= end:
                    signature = verified_fragment(part)
                    with Path(part["path"]).open("rb") as source:
                        if fingerprint(os.fstat(source.fileno())) != signature:
                            raise OSError("Original fragment changed before playback")
                        source.seek(max(0, start - offset))
                        remaining = min(end, part_end) - max(start, offset) + 1
                        while remaining > 0:
                            piece = source.read(min(1024 * 1024, remaining))
                            if not piece:
                                raise OSError("Original fragment was truncated")
                            if fingerprint(os.fstat(source.fileno())) != signature:
                                raise OSError("Original fragment changed during playback")
                            remaining -= len(piece)
                            yield piece
                offset = part_end + 1
                if offset > end:
                    break

        extension = "webm" if info["mime"].startswith("video/webm") else "mp4"
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(end - start + 1),
            "Content-Disposition": f'inline; filename="recording-{identifier}.{extension}"',
        }
        if status == 206:
            headers["Content-Range"] = f"bytes {start}-{end}/{length}"
        return StreamingResponse(stream(), status_code=status, media_type=info["mime"], headers=headers)

    return router
