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


async def test_clear_memory_requires_confirmation_and_clears_all_local_evidence(tmp_path):
    app = create_app(Settings(
        admin_token="a" * 32, device_token="d" * 32, data_dir=tmp_path,
        provider="disabled", workers=0, embeddings=False, _env_file=None,
    ))
    db = app.state.db
    photo = io.BytesIO()
    Image.new("RGB", (32, 32), "white").save(photo, "JPEG")
    headers = {"Authorization": "Bearer " + "a" * 32}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        capture = {**headers, "X-Boot-ID": "reset-phone", "X-Sequence": "0",
                   "X-Captured-At": str(time.time()), "Content-Type": "image/jpeg"}
        assert (await client.post('/api/ingest/frame', headers=capture, content=photo.getvalue())).status_code == 201
        db.execute("INSERT INTO answers VALUES(?,?,?,?,?,?,?,?)", ('answer', 'question', 'text', '[]', time.time(), None, 0, 'no_evidence'))
        db.execute("INSERT INTO context_documents VALUES(?,?,?,?,?,?,?)", ('doc', 'source', 'note', 'Title', 'Private note', '{}', time.time()))
        db.set_setting('notch_enabled', True)
        (tmp_path / 'scene.json').write_text('{}')
        (tmp_path / 'voice' / 'spoken.mp3').write_bytes(b'private voice')
        db.set_setting('preference_to_keep', 'value')
        assert (await client.request('DELETE', '/api/memory', json={'confirm': True})).status_code == 401
        for payload in ({}, {'confirm': False}):
            assert (await client.request('DELETE', '/api/memory', headers=headers, json=payload)).status_code == 422
        assert len((await client.get('/api/recordings', headers=headers)).json()) == 1
        result = await client.request('DELETE', '/api/memory', headers=headers, json={'confirm': True})
        assert result.status_code == 200, result.text
        cutoff = result.json()['history_cleared_before']
        for route in ('/recordings', '/answers', '/scans', '/continuous-recordings'):
            assert (await client.get('/api' + route, headers=headers)).json() == []
        assert db.all('SELECT * FROM context_documents') == []
        assert not db.setting('notch_enabled')
        assert db.setting('preference_to_keep') == 'value'
        assert not list((tmp_path / 'media').iterdir())
        assert not list((tmp_path / 'voice').iterdir())
        assert not (tmp_path / 'scene.json').exists()
        assert (await client.post('/api/ingest/frame', headers=capture, content=photo.getvalue())).status_code == 410
        assert (await client.post('/api/ingest/frame', headers={**capture, 'X-Captured-At': str(cutoff + 1)}, content=photo.getvalue())).status_code == 201
        # Phone battery is actual optional telemetry; unsupported clients send null.
        for payload in ({'battery': 38, 'charging': True}, {'battery': None, 'charging': None}):
            assert (await client.post('/api/phone/heartbeat', headers=headers, json=payload)).status_code == 200
            state = db.setting("phone_status")
            assert {key: state[key] for key in payload} == payload
            assert state["last_seen"] > 0
            assert db.all("SELECT * FROM devices") == []
        assert (await client.post('/api/phone/heartbeat', headers=headers, json={'battery': 101})).status_code == 422


async def test_clear_memory_does_not_race_a_recording_being_processed(tmp_path):
    app = create_app(Settings(
        admin_token="a" * 32, device_token="d" * 32, data_dir=tmp_path,
        provider="disabled", workers=0, embeddings=False, _env_file=None,
    ))
    photo = io.BytesIO()
    Image.new('RGB', (32, 32), 'white').save(photo, 'JPEG')
    headers = {'Authorization': 'Bearer ' + 'a' * 32}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        await client.post('/api/ingest/frame', headers={**headers, 'X-Boot-ID': 'busy', 'X-Sequence': '0', 'Content-Type': 'image/jpeg'}, content=photo.getvalue())
        app.state.db.execute("UPDATE media SET status='processing'")
        result = await client.request('DELETE', '/api/memory', headers=headers, json={'confirm': True})
        assert result.status_code == 409
        assert len(app.state.db.all('SELECT * FROM media')) == 1
        assert not app.state.db.setting('history_cleared_before')
