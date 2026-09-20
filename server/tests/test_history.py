import io
import time
from uuid import uuid4

import httpx
from PIL import Image
from rewind.app import create_app
from rewind.config import Settings


async def test_cleared_history_cannot_return_from_a_phones_offline_queue(tmp_path):
    app = create_app(Settings(
        admin_token="a" * 32, device_token="d" * 32, data_dir=tmp_path,
        provider="disabled", workers=0, embeddings=False, _env_file=None,
    ))
    cutoff = time.time() - 10
    app.state.db.set_setting("history_cleared_before", cutoff)
    photo = io.BytesIO()
    Image.new("RGB", (32, 32), "white").save(photo, "JPEG")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        headers = {"Authorization": "Bearer " + "a" * 32}
        capture = {
            **headers, "X-Boot-ID": "cleared-phone", "X-Sequence": "0",
            "X-Captured-At": str(cutoff - 1), "Content-Type": "image/jpeg",
        }
        assert (await client.post("/api/ingest/frame", headers=capture, content=photo.getvalue())).status_code == 410
        assert (await client.post("/api/conversation/audio", headers={
            **capture, "Content-Type": "audio/webm",
        }, content=b"\x1aE\xdf\xa3old")).status_code == 410
        recording = str(uuid4())
        assert (await client.post(f"/api/continuous-recordings/{recording}/chunks/0", headers={
            **capture, "Content-Type": "video/webm", "X-Recording-Started-At": str(cutoff - 1),
        }, content=b"\x1aE\xdf\xa3old")).status_code == 410
        assert (await client.post(f"/api/continuous-recordings/{recording}/finish", headers=headers, json={
            "mime": "video/webm", "started_at": cutoff - 1, "ended_at": cutoff + 1,
            "chunks": 1, "reason": "stopped",
        })).status_code == 410
        assert (await client.get("/api/recordings", headers=headers)).json() == []
        assert (await client.get("/api/continuous-recordings", headers=headers)).json() == []
        assert (await client.get("/api/conversation/state", headers=headers)).json()["turns"] == []
        assert (await client.post("/api/ingest/frame", headers={
            **capture, "X-Captured-At": str(time.time()),
        }, content=photo.getvalue())).status_code == 201
        assert len((await client.get("/api/recordings", headers=headers)).json()) == 1
