import asyncio
import hashlib
import hmac
import io
import ipaddress
import json
import math
import os
import re
import secrets
import shutil
import time
import uuid
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from .computer import Computer, ComputerCancel, ComputerCommand, ComputerPermission
from .config import Settings
from .context import ContextScopes, NotchContext
from .conversation import Conversation, conversation_router
from .db import Database, event_public
from .memory import Memory
from .models import AskRequest, RuleRequest, VideoProvenance
from .pairing import BrowserPairing
from .people import PeopleMemory, people_router
from .providers import Provider
from .recordings import recording_bytes, recording_router
from .scans import Scans, scans_router
from .storage import retained_bytes
from .usage import UsageLedger
from .verification import Verifier
from .visual import VisualIndex
from .voice import Voice, voice_router
from .worker import Worker


class Login(BaseModel):
    token: str
    remember: bool = False


class PairBrowser(BaseModel):
    code: str = Field(default="", max_length=20)
    ticket: str = Field(default="", max_length=100)
    remember: bool = True


class Pause(BaseModel):
    paused: bool


class Heartbeat(BaseModel):
    boot: str = Field(max_length=64)
    queued: int = Field(default=0, ge=0)
    dropped: int = Field(default=0, ge=0)
    uptime_ms: int = Field(default=0, ge=0)
    free_sd_bytes: int = Field(default=0, ge=0)
    rssi: int = 0
    error: str = Field(default="", max_length=300)


def create_app(settings=None, provider=None):
    s = settings or Settings()
    s.validate_secrets()
    db = Database(s.data_dir)
    media_dir = (s.data_dir / "media").resolve()
    media_dir.mkdir(exist_ok=True)
    usage = UsageLedger(db, s)
    p = provider or Provider(s, usage=usage)
    visual = VisualIndex(db, s, remote=p)
    context = NotchContext(db, s)
    verifier = Verifier(db, s) if s.codex_verify else None
    scans = Scans(db, p, s)
    memory = Memory(
        db,
        p,
        s,
        visual=visual if s.visual_embeddings else None,
        context=context,
        verifier=verifier,
        scans=scans,
    )
    worker = Worker(db, p, memory, s)
    computer = Computer(db, s)
    conversation = Conversation(db, p, memory, computer, s)
    people = PeopleMemory(db, s)
    voice = Voice(s, p, memory)
    conversation.voice = voice
    ingestion_lock = asyncio.Lock()
    pairing = BrowserPairing(db, s.admin_token)

    # Signed stateless session, with expiration; admin API key is never put in a cookie.
    def session_token(seconds):
        value = f"{int(time.time() + seconds)}.{secrets.token_hex(16)}"
        return value + "." + hmac.new(s.admin_token.encode(), value.encode(), hashlib.sha256).hexdigest()

    def set_session(response, remember):
        seconds = (30 if remember else 1) * 86400
        response.set_cookie(
            "rewind_session",
            session_token(seconds),
            httponly=True,
            secure=s.cookie_secure,
            samesite="strict",
            max_age=seconds,
            path="/",
        )

    def same_origin(req):
        origin = req.headers.get("origin")
        if origin and (
            urlsplit(origin).netloc != req.headers.get("host") or urlsplit(origin).scheme != req.url.scheme
        ):
            raise HTTPException(403, "Cross-origin writes rejected")
        if req.headers.get("sec-fetch-site") == "cross-site":
            raise HTTPException(403, "Cross-origin writes rejected")

    def local_test_connection(req):
        if any(
            name in req.headers
            for name in ("forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto")
        ):
            return False
        try:
            local_peer = bool(req.client and ipaddress.ip_address(req.client.host).is_loopback)
            hostname = req.url.hostname
            local_host = hostname == "localhost" or ipaddress.ip_address(hostname or "").is_loopback
            return local_peer and local_host
        except ValueError:
            return False

    def valid_session(token):
        try:
            expires, nonce, signature = token.split(".")
            expected = hmac.new(
                s.admin_token.encode(), f"{expires}.{nonce}".encode(), hashlib.sha256
            ).hexdigest()
            return float(expires) > time.time() and hmac.compare_digest(signature, expected)
        except (ValueError, AttributeError):
            return False

    async def admin(req: Request):
        if s.browser_open_access:
            if req.method not in ("GET", "HEAD"):
                same_origin(req)
            return
        bearer = req.headers.get("authorization", "").removeprefix("Bearer ")
        if hmac.compare_digest(bearer, s.admin_token):
            return
        if not valid_session(req.cookies.get("rewind_session")):
            raise HTTPException(401, "Workspace access key required")
        if req.method not in ("GET", "HEAD"):
            same_origin(req)

    async def device(req: Request):
        bearer = req.headers.get("authorization", "").removeprefix("Bearer ")
        if not hmac.compare_digest(bearer, s.device_token):
            raise HTTPException(401, "Device access key required")
        if req.headers.get("x-device-id") != s.device_id:
            raise HTTPException(403, "Device ID does not match provisioning")

    async def ingest_auth(req: Request):
        bearer = req.headers.get("authorization", "").removeprefix("Bearer ")
        if hmac.compare_digest(bearer, s.device_token):
            await device(req)
            return s.device_id
        await admin(req)
        return "computer"

    @asynccontextmanager
    async def lifespan(app):
        scans.recover()
        tasks = [asyncio.create_task(worker.run()) for _ in range(s.workers)]
        if verifier:
            tasks.extend(asyncio.create_task(verifier.run()) for _ in range(s.codex_verify_workers))
        if s.visual_embeddings and s.workers:
            tasks.append(asyncio.create_task(visual.run()))
        tasks.append(asyncio.create_task(worker.elastic_sync()))
        tasks.append(asyncio.create_task(context.run()))
        tasks.append(asyncio.create_task(computer.monitor()))
        tasks.append(asyncio.create_task(people.run()))
        tasks.append(asyncio.create_task(conversation.run()))
        tasks.append(asyncio.create_task(voice.warm()))
        try:
            yield
        finally:
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            for t in list(scans.tasks):
                t.cancel()
            await asyncio.gather(*scans.tasks, return_exceptions=True)
            await p.close()
            await voice.close()
            await computer.http.aclose()

    app = FastAPI(
        title="REWIND Memory",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.db, app.state.worker, app.state.memory = db, worker, memory
    app.state.settings = s
    app.state.visual = visual
    app.state.context = context
    app.state.verifier = verifier
    app.state.computer = computer
    app.state.people = people
    app.state.usage = usage
    app.state.conversation = conversation
    app.state.voice, app.state.scans = voice, scans
    app.include_router(conversation_router(conversation, admin, ingestion_lock))
    app.include_router(voice_router(voice, admin, s.max_upload_bytes))
    app.include_router(scans_router(scans, admin))
    app.include_router(recording_router(db, s, admin, ingestion_lock))
    app.include_router(people_router(people, admin))

    @app.get("/api/usage/summary", dependencies=[Depends(admin)])
    async def usage_summary(since: float = 0):
        if not math.isfinite(since) or since < 0:
            raise HTTPException(422, "since must be a finite nonnegative timestamp")
        return await asyncio.to_thread(usage.summary, since)

    @app.get("/api/computer/state", dependencies=[Depends(admin)])
    async def computer_state():
        return await computer.state()

    @app.post("/api/computer/command", dependencies=[Depends(admin)])
    async def computer_command(body: ComputerCommand):
        return await computer.command(body)

    @app.post("/api/computer/cancel", dependencies=[Depends(admin)])
    async def computer_cancel(body: ComputerCancel):
        return await computer.call("rewind-cancel", {"id": str(body.id)})

    @app.post("/api/computer/permission", dependencies=[Depends(admin)])
    async def computer_permission(body: ComputerPermission):
        return await computer.call("permission-decision", {"id": str(body.id), "allow": body.allow})

    @app.middleware("http")
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "version": "0.1.0"}

    @app.post("/api/login")
    async def login(body: Login, response: Response, req: Request):
        same_origin(req)
        if not hmac.compare_digest(body.token, s.admin_token):
            await asyncio.sleep(0.5)
            raise HTTPException(401, "Invalid workspace access key")
        set_session(response, body.remember)
        return {"ok": True}

    @app.post("/api/pairing", dependencies=[Depends(admin)])
    async def create_pairing():
        if s.browser_open_access:
            return {"direct": True, "public_url": s.public_url, "expires_at": None}
        return {**pairing.create(), "public_url": s.public_url}

    @app.post("/api/pair")
    async def pair_browser(body: PairBrowser, req: Request, response: Response):
        same_origin(req)
        if s.browser_open_access:
            set_session(response, True)
            return {"ok": True}
        code = re.sub(r"[\s-]", "", body.code)
        pairing.redeem(
            code=code,
            ticket=body.ticket,
            peer=req.client.host if req.client else "unknown",
            test_code=s.test_login_code if local_test_connection(req) else "",
        )
        set_session(response, body.remember)
        return {"ok": True}

    @app.post("/api/logout", dependencies=[Depends(admin)])
    async def logout(response: Response):
        response.delete_cookie("rewind_session")
        return {"ok": True}

    @app.get("/api/status", dependencies=[Depends(admin)])
    async def status():
        totals = db.one("""SELECT COUNT(*) AS received,COALESCE(SUM(bytes),0) AS stored_bytes,
            COALESCE(SUM(status='done'),0) AS analyzed,COALESCE(SUM(status='failed'),0) AS failed,
            COALESCE(SUM(status IN ('queued','processing')),0) AS pending,AVG(analysis_ms) AS average_analysis_ms,
            MIN(CASE WHEN status IN ('queued','processing') THEN captured_at END) AS oldest_pending_at,
            MAX(captured_at) AS last_capture FROM media""")
        totals["devices"] = [{**d, "state": json.loads(d["state"])} for d in db.all("SELECT * FROM devices")]
        totals["continuous_recording_bytes"] = recording_bytes(db)
        totals["stored_bytes"] = retained_bytes(db)
        totals["provider"] = s.provider
        totals["browser_open_access"] = s.browser_open_access
        totals["processing_host"] = "ASUS via Tailscale" if s.processing_url else "server"
        totals["analysis_ready"] = s.provider != "disabled" and (await p.ready() if s.processing_url else True)
        totals["verification_enabled"] = s.codex_verify
        totals["model"] = s.openai_model if s.provider == "openai" else s.vision_model
        totals["recall_model"] = (
            s.openai_model if s.provider == "openai" else s.ollama_recall_model or s.vision_model
        )
        totals["workers"] = s.workers
        totals["timezone"] = s.timezone
        totals["visual_index"] = visual.status()
        totals["free_bytes"] = shutil.disk_usage(media_dir).free
        totals["storage_limit_bytes"] = int(s.max_storage_gb * 1e9)
        totals["embedding_failures"] = db.one(
            "SELECT COUNT(*) n FROM events WHERE embedding_error IS NOT NULL"
        )["n"]
        totals["paused"] = db.setting("paused", False)
        totals["elastic_pending"] = db.one("SELECT COUNT(*) n FROM outbox")["n"]
        totals["observed_sequence_gaps"] = db.one("""SELECT COALESCE(SUM(span-n),0) n FROM
            (SELECT MAX(seq)-MIN(seq)+1 span,COUNT(*) n FROM media GROUP BY device,boot,kind)""")["n"]
        return totals

    @app.get("/api/context/status", dependencies=[Depends(admin)])
    async def context_status():
        return context.status()

    @app.post("/api/context/connect", dependencies=[Depends(admin)])
    async def context_connect(scopes: ContextScopes):
        try:
            return await context.sync(scopes)
        except ValueError as error:
            raise HTTPException(503, str(error))

    @app.post("/api/context/disconnect", dependencies=[Depends(admin)])
    async def context_disconnect():
        async with context.lock:
            context.disconnect()
        return context.status()

    @app.get("/api/context/graph", dependencies=[Depends(admin)])
    async def context_graph():
        return context.graph()

    @app.get("/api/context/documents/{document_id}", dependencies=[Depends(admin)])
    async def context_document(document_id: str):
        row = db.one("SELECT * FROM context_documents WHERE id=?", (document_id,))
        if not row:
            scanned = db.one("SELECT * FROM scan_documents WHERE id=?", (document_id,))
            if scanned:
                return scans.evidence(scanned)
            raise HTTPException(404, "Context source not found")
        return context.public(row)

    @app.get("/api/context/reminders", dependencies=[Depends(admin)])
    async def context_reminders():
        return context.reminders()

    @app.post("/api/context/reminders/{reminder_id}/seen", dependencies=[Depends(admin)])
    async def context_reminder_seen(reminder_id: str):
        db.execute("UPDATE context_reminders SET seen=1 WHERE id=?", (reminder_id,))
        return {"ok": True}

    @app.get("/api/provider", dependencies=[Depends(admin)])
    async def provider_status():
        if s.processing_url:
            try:
                r = await p.http.get(
                    s.processing_url.rstrip("/") + "/health",
                    headers={"Authorization": "Bearer " + s.processing_token},
                    timeout=5,
                )
                r.raise_for_status()
                return {
                    "reachable": bool(r.json().get("ready")),
                    "host": "ASUS via Tailscale",
                    "models": [r.json()["model"]],
                    "required": [s.vision_model],
                    "verification": s.codex_verify,
                }
            except Exception:
                return {
                    "reachable": False,
                    "host": "ASUS via Tailscale",
                    "models": [],
                    "required": [s.vision_model],
                }
        if s.provider == "ollama":
            try:
                r = await p.http.get(s.ollama_url + "/api/tags", timeout=5)
                r.raise_for_status()
                names = [m["name"] for m in r.json().get("models", [])]
                return {
                    "reachable": True,
                    "models": names,
                    "required": [s.vision_model, s.reasoning_model, s.embedding_model],
                }
            except Exception:
                return {
                    "reachable": False,
                    "models": [],
                    "required": [s.vision_model, s.reasoning_model, s.embedding_model],
                }
        return {
            "reachable": s.provider == "openai" and bool(s.openai_api_key),
            "models": [s.openai_model] if s.provider == "openai" else [],
        }

    @app.post("/api/device/heartbeat", dependencies=[Depends(device)])
    async def heartbeat(body: Heartbeat):
        db.execute(
            "INSERT INTO devices(id,last_seen,state) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,state=excluded.state",
            (s.device_id, time.time(), body.model_dump_json()),
        )
        answer = db.one(
            """SELECT a.* FROM answers a JOIN media m ON a.source_media=m.id WHERE m.device=? ORDER BY a.created_at DESC LIMIT 1""",
            (s.device_id,),
        )
        return {
            "server_time": time.time(),
            "paused": db.setting("paused", False),
            "answer": {k: answer[k] for k in ("id", "answer", "created_at")} if answer else None,
        }

    @app.post("/api/capture/pause", dependencies=[Depends(admin)])
    async def pause(body: Pause):
        db.set_setting("paused", body.paused)
        return {"paused": body.paused}

    @app.post("/api/ingest/{kind}", status_code=201)
    async def ingest(kind: str, req: Request, owner: str = Depends(ingest_auth)):
        if kind not in ("frame", "audio"):
            raise HTTPException(400, "Kind must be frame or audio")
        boot = req.headers.get("x-boot-id", "")
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", boot):
            raise HTTPException(400, "X-Boot-ID required (1–64 alphanumeric characters)")
        try:
            seq = int(req.headers["x-sequence"])
            timestamp = float(req.headers.get("x-captured-at", "0"))
            if not 0 <= seq < 2**63 or not 0 <= timestamp <= time.time() + 300:
                raise ValueError()
        except (KeyError, ValueError, OverflowError):
            raise HTTPException(400, "Invalid sequence or capture timestamp (Unix seconds)")
        captured = timestamp or time.time()
        clock_quality = "device" if timestamp else "received_only"
        provenance = "{}"
        if "x-video-provenance" in req.headers:
            try:
                value = req.headers["x-video-provenance"]
                if len(value) > 2048 or not timestamp:
                    raise ValueError()
                metadata = VideoProvenance.model_validate_json(value)
                if (kind == "frame") != (metadata.frame_index is not None):
                    raise ValueError()
                provenance = metadata.model_dump_json()
                clock_quality = "synthetic" if metadata.clock == "synthetic" else "imported"
            except ValueError:
                raise HTTPException(400, "Invalid video provenance or missing capture timestamp")
        intent = req.headers.get("x-intent", "memory")
        if (
            intent not in ("memory", "question", "scan")
            or (intent == "question" and kind != "audio")
            or (intent == "scan" and kind != "frame")
        ):
            raise HTTPException(400, "Invalid capture intent")
        data = bytearray()
        async for chunk in req.stream():
            data.extend(chunk)
            if len(data) > s.max_upload_bytes:
                raise HTTPException(413, "Recording exceeds upload size limit")
        if not data:
            raise HTTPException(400, "Empty recording")
        mime = "image/jpeg" if kind == "frame" else req.headers.get("content-type", "").split(";")[0]
        duration = 0
        if kind == "frame":
            try:
                with Image.open(io.BytesIO(data)) as im:
                    if im.format != "JPEG" or im.width * im.height > 16_000_000:
                        raise ValueError("Expected a JPEG <=16 megapixels")
                    im.verify()
            except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
                raise HTTPException(400, "Invalid JPEG frame")
            suffix = ".jpg"
        else:
            if mime in ("audio/wav", "audio/x-wav"):
                try:
                    with wave.open(io.BytesIO(data)) as w:
                        duration = w.getnframes() / w.getframerate()
                        if duration > 120 or w.getnchannels() > 2 or w.getsampwidth() != 2:
                            raise ValueError()
                except (wave.Error, EOFError, ValueError, ZeroDivisionError):
                    raise HTTPException(400, "Expected PCM16 WAV, at most 120 seconds")
                suffix, mime = ".wav", "audio/wav"
            elif mime in ("audio/webm", "audio/ogg", "audio/mp4"):
                signatures = {
                    "audio/webm": data[:4] == b"\x1aE\xdf\xa3",
                    "audio/ogg": data[:4] == b"OggS",
                    "audio/mp4": data[4:8] == b"ftyp",
                }
                if not signatures[mime]:
                    raise HTTPException(400, "Invalid audio container")
                suffix = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".mp4"}[mime]
            else:
                raise HTTPException(415, "Use WAV, WebM, Ogg or MP4 audio")
        digest = hashlib.sha256(data).hexdigest()
        async with ingestion_lock:
            old = db.one(
                "SELECT id,sha256,status,provenance,captured_at FROM media WHERE device=? AND boot=? AND kind=? AND seq=?",
                (owner, boot, kind, seq),
            )
            if old:
                if not hmac.compare_digest(old["sha256"], digest):
                    raise HTTPException(409, "Sequence already contains different recording bytes")
                if old["provenance"] != provenance or (provenance != "{}" and old["captured_at"] != captured):
                    raise HTTPException(409, "Sequence already contains different video provenance")
                return {"id": old["id"], "duplicate": True, "status": old["status"]}
            total = retained_bytes(db)
            if (
                total + len(data) > s.max_storage_gb * 1e9
                or shutil.disk_usage(media_dir).free - len(data) < s.min_free_gb * 1e9
            ):
                raise HTTPException(
                    507, "Storage limit reached; recording remains on the device until space is available"
                )
            event_id = str(uuid.uuid4())
            path = media_dir / (event_id + suffix)
            tmp = path.with_suffix(".tmp")
            try:
                with open(tmp, "xb") as f:
                    f.write(data)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp, path)
                directory_fd = os.open(media_dir, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
                db.execute(
                    """INSERT INTO media(id,device,boot,seq,kind,captured_at,received_at,clock_quality,sha256,path,bytes,mime,duration,intent,provenance)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        event_id,
                        owner,
                        boot,
                        seq,
                        kind,
                        captured,
                        time.time(),
                        clock_quality,
                        digest,
                        str(path),
                        len(data),
                        mime,
                        duration,
                        intent,
                        provenance,
                    ),
                )
            except BaseException:
                path.unlink(missing_ok=True)
                tmp.unlink(missing_ok=True)
                raise
        if intent == "scan":
            scans.schedule(event_id, path)
        return {"id": event_id, "duplicate": False, "status": "queued"}

    @app.get("/api/events", dependencies=[Depends(admin)])
    async def events(q: str = "", after: float | None = None, before: float | None = None, limit: int = 50):
        return await memory.search(q[:2000], after, before, max(1, min(limit, 100)))

    @app.get("/api/recordings", dependencies=[Depends(admin)])
    async def recordings(before: float | None = None, limit: int = 60):
        return [
            event_public(r)
            for r in db.all(
                """SELECT m.*,e.summary,e.transcript,e.objects,e.tags,e.confidence,e.segments FROM media m LEFT JOIN events e ON e.id=m.id
            WHERE m.captured_at<=? ORDER BY m.captured_at DESC LIMIT ?""",
                (before or time.time() + 300, max(1, min(limit, 200))),
            )
        ]

    @app.get("/api/events/{event_id}", dependencies=[Depends(admin)])
    async def event(event_id: str):
        row = db.one(
            "SELECT m.*,e.summary,e.transcript,e.objects,e.tags,e.segments,e.confidence FROM media m LEFT JOIN events e ON e.id=m.id WHERE m.id=?",
            (event_id,),
        )
        if not row:
            raise HTTPException(404, "Recording not found")
        return event_public(row)

    @app.get("/api/media/{event_id}", dependencies=[Depends(admin)])
    async def media(event_id: str):
        row = db.one("SELECT path,mime FROM media WHERE id=?", (event_id,))
        if not row or not Path(row["path"]).is_file():
            raise HTTPException(404, "Recording not found")
        return FileResponse(row["path"], media_type=row["mime"])

    @app.delete("/api/media/{event_id}", dependencies=[Depends(admin)])
    async def delete_media(event_id: str):
        async with ingestion_lock:
            row = db.one("SELECT path,status FROM media WHERE id=?", (event_id,))
            if not row:
                raise HTTPException(404, "Recording not found")
            if row["status"] == "processing":
                raise HTTPException(409, "Wait for this recording to finish processing")
            # Remove answer copies containing this evidence as well as original media/index rows.
            db.execute(
                "DELETE FROM answers WHERE source_media=? OR evidence LIKE ?",
                (event_id, "%" + event_id + "%"),
            )
            if s.elastic_url:
                headers = {"Authorization": "ApiKey " + s.elastic_api_key} if s.elastic_api_key else {}
                r = await p.http.delete(
                    s.elastic_url.rstrip("/") + "/rewind-events/_doc/" + event_id, headers=headers
                )
                if r.status_code not in (200, 404):
                    raise HTTPException(503, "Elastic deletion failed; local recording retained for retry")
            db.execute("DELETE FROM media WHERE id=?", (event_id,))
            Path(row["path"]).unlink(missing_ok=True)
            # A scene can contain geometry derived from this image; regenerate after deletion.
            (s.data_dir / "scene.json").unlink(missing_ok=True)
        return {"deleted": event_id}

    @app.post("/api/retry", dependencies=[Depends(admin)])
    async def retry():
        n = db.execute(
            "UPDATE media SET status='queued',attempts=0,retry_at=0,error=NULL WHERE status='failed'"
        )
        visual_retried = db.execute(
            "UPDATE visual_index SET status='queued',attempts=0,retry_at=0,error=NULL WHERE status='failed'"
        )
        return {"retried": n, "visual_retried": visual_retried}

    @app.post("/api/ask", dependencies=[Depends(admin)])
    async def ask(body: AskRequest):
        return await memory.ask(body.question, body.after, body.before)

    @app.get("/api/answers", dependencies=[Depends(admin)])
    async def answers():
        return [
            {
                **r,
                "evidence": json.loads(r["evidence"]),
                "verification": verifier.public(r["id"]) if verifier else None,
            }
            for r in db.all("SELECT * FROM answers ORDER BY created_at DESC LIMIT 30")
        ]

    @app.get("/api/rules", dependencies=[Depends(admin)])
    async def rules():
        return db.all("SELECT * FROM rules ORDER BY created_at DESC")

    @app.post("/api/rules", dependencies=[Depends(admin)])
    async def add_rule(body: RuleRequest):
        if db.one("SELECT COUNT(*) n FROM rules")["n"] >= 8:
            raise HTTPException(400, "Maximum 8 monitoring rules; delete an old rule first")
        rule_id = str(uuid.uuid4())
        db.execute(
            "INSERT INTO rules VALUES(?,?,1,?,?)",
            (rule_id, body.instruction, time.time(), body.cooldown_seconds),
        )
        return {"id": rule_id}

    @app.delete("/api/rules/{rule_id}", dependencies=[Depends(admin)])
    async def delete_rule(rule_id: str):
        db.execute("DELETE FROM rules WHERE id=?", (rule_id,))
        return {"ok": True}

    @app.get("/api/alerts", dependencies=[Depends(admin)])
    async def alerts():
        return db.all("SELECT * FROM alerts ORDER BY created_at DESC LIMIT 50")

    @app.post("/api/alerts/{alert_id}/seen", dependencies=[Depends(admin)])
    async def seen(alert_id: str):
        db.execute("UPDATE alerts SET seen=1 WHERE id=?", (alert_id,))
        return {"ok": True}

    @app.get("/api/objects", dependencies=[Depends(admin)])
    async def objects(label: str, before: float | None = None):
        # Exact label filter after FTS retrieval; no claim of persistent identity across similar objects.
        hits = await memory.search(label, before=before, limit=100)
        return sorted(
            [r for r in hits if any(label.lower() in o["label"].lower() for o in r["objects"])],
            key=lambda r: r["captured_at"],
            reverse=True,
        )

    @app.get("/api/scene", dependencies=[Depends(admin)])
    async def scene():
        path = s.data_dir / "scene.json"
        if not path.exists():
            return {"available": False, "points": [], "cameras": [], "frames": []}
        return json.loads(path.read_text())

    @app.get("/api/export", dependencies=[Depends(admin)])
    async def export():
        # Metadata only. Media stays behind authenticated endpoints.
        return {
            "version": 1,
            "exported_at": time.time(),
            "events": [event_public(r) for r in db.all("SELECT * FROM events ORDER BY captured_at")],
            "recordings": [event_public(r) for r in db.all("SELECT * FROM media ORDER BY captured_at")],
        }

    public = Path("web/dist/client")
    if public.exists():

        @app.get("/phone", include_in_schema=False)
        @app.get("/phone/", include_in_schema=False)
        async def phone_page():
            return FileResponse(public / "phone.html", media_type="text/html")

        @app.get("/workspace", include_in_schema=False)
        @app.get("/workspace/", include_in_schema=False)
        async def workspace_page():
            return FileResponse(public / "workspace.html", media_type="text/html")

        @app.get("/print", include_in_schema=False)
        @app.get("/print/", include_in_schema=False)
        async def print_page():
            return FileResponse(public / "print.html", media_type="text/html")

        @app.get("/print/{piece}", include_in_schema=False)
        @app.get("/print/{piece}/", include_in_schema=False)
        async def print_piece(piece: str):
            if piece not in ("postcard", "bill"):
                raise HTTPException(404, "Not found")
            return FileResponse(public / "print" / f"{piece}.html", media_type="text/html")

        app.mount("/", StaticFiles(directory=public, html=True), name="dashboard")
    return app
