"""Authenticated, narrow phone bridge to the actual Notch computer agent."""

import asyncio
import json
import time
from uuid import UUID

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field


class ComputerCommand(BaseModel):
    id: UUID
    text: str = Field(min_length=1, max_length=2000)


class ComputerCancel(BaseModel):
    id: UUID


class ComputerPermission(BaseModel):
    id: UUID
    allow: bool


class Computer:
    def __init__(self, db, settings):
        self.db, self.s = db, settings
        self.http = httpx.AsyncClient(timeout=10, follow_redirects=False)
        self.lock = asyncio.Lock()
        with db.connect() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS computer_commands (
                id TEXT PRIMARY KEY, text TEXT NOT NULL, status TEXT NOT NULL,
                snapshot TEXT NOT NULL DEFAULT '{}', created_at REAL NOT NULL)""")

    async def call(self, route, payload=None):
        if not self.s.notch_control_url or not self.s.notch_token:
            raise HTTPException(503, "Open Notch on the Mac to connect computer control.")
        url = self.s.notch_control_url.rstrip("/") + "/t/" + self.s.notch_token + "/" + route
        try:
            response = await self.http.request("POST" if payload is not None else "GET", url, json=payload)
        except httpx.HTTPError:
            raise HTTPException(503, "Notch is unreachable. Open it on the Mac and try again.") from None
        if response.status_code == 409:
            raise HTTPException(409, "Notch is busy, or this request is no longer current.")
        if response.status_code != 200:
            raise HTTPException(503, "Notch could not accept this request.")
        return response.json()

    async def state(self):
        snapshot = await self.call("state")
        request_id = snapshot.get("request_id")
        if request_id:
            status = snapshot.get("state", "unknown")
            if status == "responding" and snapshot.get("response"):
                status = "completed" if snapshot.get("success") else "needs_attention"
            elif status == "error":
                status = "failed"
            self.db.execute(
                "UPDATE computer_commands SET status=?,snapshot=? WHERE id=? AND status NOT IN ('completed','needs_attention','failed','cancelled')",
                (status, json.dumps(snapshot), request_id),
            )
        return {"connected": True, **snapshot, "recent": self.recent()}

    def recent(self):
        return [
            {**row, "snapshot": json.loads(row["snapshot"])}
            for row in self.db.all("SELECT * FROM computer_commands ORDER BY created_at DESC LIMIT 10")
        ]

    async def command(self, body):
        if not body.text.strip():
            raise HTTPException(422, "Enter a command for Notch.")
        async with self.lock:
            old = self.db.one("SELECT * FROM computer_commands WHERE id=?", (str(body.id),))
            if old:
                if old["text"] != body.text:
                    raise HTTPException(409, "This request ID has already been used.")
                # Never replay a potentially completed action after a lost response/restart.
                return {"id": str(body.id), "status": old["status"]}
            self.db.execute(
                "INSERT INTO computer_commands(id,text,status,created_at) VALUES(?,?,?,?)",
                (str(body.id), body.text, "sending", time.time()),
            )
            try:
                await self.call("rewind-command", {"id": str(body.id), "text": body.text})
            except HTTPException as exc:
                state = "rejected" if exc.status_code == 409 else "delivery_unknown"
                self.db.execute("UPDATE computer_commands SET status=? WHERE id=?", (state, str(body.id)))
                raise
            self.db.execute("UPDATE computer_commands SET status='accepted' WHERE id=?", (str(body.id),))
            return {"id": str(body.id), "status": "accepted"}

    async def monitor(self):
        while True:
            if self.s.notch_control_url:
                try:
                    await self.state()
                except Exception:
                    pass
            await asyncio.sleep(1)
