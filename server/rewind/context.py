"""Notch's linked notes + read-only digital context, alongside physical evidence."""

import asyncio
import hashlib
import json
import re
import time
import uuid
from typing import Literal
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field


class ContextDocument(BaseModel):
    key: str = Field(min_length=1, max_length=1000)
    kind: Literal["note", "contact", "calendar", "email"]
    title: str = Field(max_length=500)
    text: str = Field(default="", max_length=60000)
    links: list[str] = Field(default_factory=list, max_length=200)
    emails: list[str] = Field(default_factory=list, max_length=200)
    starts_at: float | None = Field(default=None, allow_inf_nan=False)
    ends_at: float | None = Field(default=None, allow_inf_nan=False)
    all_day: bool = False
    location: str = Field(default="", max_length=2000)


class ContextSnapshot(BaseModel):
    version: Literal[1]
    exported_at: float = Field(allow_inf_nan=False)
    documents: list[ContextDocument] = Field(max_length=2500)
    sources: dict[str, str] = Field(default_factory=dict)


class ContextScopes(BaseModel):
    notes: bool = True
    calendar: bool = True
    contacts: bool = True
    mail: bool = True


def identifier(key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "notch:" + key))


def email_addresses(text):
    return set(re.findall(r"[\w.+-]+@[\w.-]+\.[a-z]{2,}", text.lower()))


class NotchContext:
    def __init__(self, db, settings):
        self.db, self.s = db, settings
        self.lock = asyncio.Lock()
        with db.connect() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS context_documents (
                    id TEXT PRIMARY KEY, source_key TEXT UNIQUE NOT NULL, kind TEXT NOT NULL,
                    title TEXT NOT NULL, text TEXT NOT NULL, payload TEXT NOT NULL, synced_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS context_edges (
                    source TEXT NOT NULL REFERENCES context_documents(id) ON DELETE CASCADE,
                    target TEXT NOT NULL REFERENCES context_documents(id) ON DELETE CASCADE,
                    relation TEXT NOT NULL, PRIMARY KEY(source,target,relation)
                );
                CREATE TABLE IF NOT EXISTS context_reminders (
                    id TEXT PRIMARY KEY, document_id TEXT REFERENCES context_documents(id) ON DELETE CASCADE,
                    message TEXT NOT NULL, starts_at REAL NOT NULL, created_at REAL NOT NULL, seen INTEGER DEFAULT 0
                );
            """)

    def status(self):
        last_sync = self.db.setting("notch_last_sync")
        return {
            "configured": bool(self.s.notch_url and self.s.notch_token),
            "enabled": self.db.setting("notch_enabled", False),
            "last_sync": last_sync,
            "stale": not last_sync or not 0 <= time.time() - last_sync <= 300,
            "sources": self.db.setting("notch_sources", {}),
            "error": self.db.setting("notch_error", ""),
            "counts": {
                r["kind"]: r["n"]
                for r in self.db.all("SELECT kind,COUNT(*) n FROM context_documents GROUP BY kind")
            },
        }

    async def sync(self, scopes=None):
        if not self.s.notch_url or not self.s.notch_token:
            raise ValueError("Configure the Notch bridge on the memory server first.")
        async with self.lock:
            url = self.s.notch_url.rstrip("/") + "/t/" + quote(self.s.notch_token, safe="") + "/context"
            try:
                async with httpx.AsyncClient(timeout=90, follow_redirects=False) as client:
                    response = (
                        await client.post(url, json=scopes.model_dump()) if scopes else await client.get(url)
                    )
                    response.raise_for_status()
                    if len(response.content) > 20_000_000:
                        raise ValueError("Notch context exceeds the snapshot limit")
                    snapshot = ContextSnapshot.model_validate(response.json())
                self.ingest(snapshot)
                self.db.set_setting("notch_enabled", True)
                self.db.set_setting("notch_error", "")
                return self.status()
            except Exception as error:
                # Never save a URL containing the Notch capability token in logs or API responses.
                self.db.set_setting(
                    "notch_error",
                    type(error).__name__ + ": Notch sync unavailable; cached context may be stale.",
                )
                raise ValueError(
                    "Could not sync Notch. Check that its updated Mac app is running and the bridge is configured."
                ) from None

    def ingest(self, snapshot):
        if not -30 <= time.time() - snapshot.exported_at <= 600:
            raise ValueError("Stale Notch snapshot")
        if len({d.key for d in snapshot.documents}) != len(snapshot.documents):
            raise ValueError("Duplicate Notch document keys")
        # An exporter may have collected a partial source before a permission or
        # account failure. Do not keep that partial cache as if its source worked.
        scope = {"note": "notes", "calendar": "calendar", "contact": "contacts", "email": "mail"}
        documents = {
            d.key: d
            for d in snapshot.documents
            if snapshot.sources.get(scope[d.kind], "connected") == "connected"
        }
        by_title = {}
        for d in documents.values():
            if d.kind == "note":
                by_title.setdefault(d.title.casefold(), set()).add(d.key)
        contact_emails = {}
        for d in documents.values():
            if d.kind == "contact":
                for email in email_addresses(" ".join(d.emails)):
                    contact_emails.setdefault(email, set()).add(d.key)
        # Permission failures remove the source's cached data and answers containing it.
        now = time.time()
        with self.db.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            active = {identifier(key) for key in documents}
            changed = set()
            current = {identifier(key): d for key, d in documents.items()}
            for row in c.execute("SELECT id,payload FROM context_documents").fetchall():
                if row["id"] not in current or json.loads(row["payload"]) != current[row["id"]].model_dump():
                    changed.add(row["id"])
                if row["id"] not in active:
                    c.execute("DELETE FROM context_documents WHERE id=?", (row["id"],))
            if changed:
                for answer in c.execute("SELECT id,evidence FROM answers").fetchall():
                    if any(source.get("id") in changed for source in json.loads(answer["evidence"])):
                        c.execute("DELETE FROM answers WHERE id=?", (answer["id"],))
            for key, d in documents.items():
                c.execute(
                    "DELETE FROM context_reminders WHERE document_id=? AND (? OR starts_at IS NOT ?)",
                    (identifier(key), d.all_day or d.kind != "calendar", d.starts_at),
                )
                c.execute(
                    """INSERT INTO context_documents VALUES(?,?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,text=excluded.text,
                    payload=excluded.payload,synced_at=excluded.synced_at""",
                    (identifier(key), key, d.kind, d.title, d.text, d.model_dump_json(), now),
                )
            c.execute("DELETE FROM context_edges")
            for key, d in documents.items():
                linked = set(d.links)
                for title in re.findall(r"\[\[([^\]\n]+)\]\]", d.text):
                    matches = by_title.get(title.split("|", 1)[0].split("#", 1)[0].strip().casefold(), set())
                    # Matching display names are not a unique document identity.
                    # An explicit exported key may still resolve an ambiguous title.
                    if len(matches) == 1:
                        linked.update(matches)
                for email in email_addresses(" ".join(d.emails)):
                    # An email address shared by two contacts does not establish identity.
                    matches = contact_emails.get(email, set())
                    if len(matches) == 1:
                        linked.update(matches)
                for target in linked & documents.keys():
                    if target != key:
                        c.execute(
                            "INSERT OR IGNORE INTO context_edges VALUES(?,?,?)",
                            (identifier(key), identifier(target), "linked_source"),
                        )
        # Receipt time must not make an old exported calendar fresh again.
        self.db.set_setting("notch_last_sync", min(now, snapshot.exported_at))
        self.db.set_setting("notch_sources", snapshot.sources)
        self.refresh_reminders()

    def public(self, row):
        payload = json.loads(row["payload"])
        exported_at = self.db.setting("notch_last_sync") or row["synced_at"]
        return {
            "id": row["id"],
            "kind": "context",
            "context_kind": row["kind"],
            "source": "notch",
            "source_key": row["source_key"],
            "title": row["title"],
            "summary": row["title"],
            "text": row["text"],
            "captured_at": exported_at,
            "synced_at": exported_at,
            "received_at": row["synced_at"],
            "source_exported_at": exported_at,
            "source_stale": self.status()["stale"],
            "clock_quality": "digital_source",
            "starts_at": payload.get("starts_at"),
            "ends_at": payload.get("ends_at"),
            "all_day": payload.get("all_day", False),
            "media_url": "",
            "objects": [],
            "tags": [],
        }

    def search(self, query, limit=6):
        if limit <= 0:
            return []
        words = set(re.findall(r"\w{2,}", query.casefold()))
        kinds = {
            "note": {"note", "notes", "knowledge"},
            "contact": {"contact", "contacts", "addressbook"},
            "calendar": {"appointment", "appointments", "calendar", "meeting", "meetings", "schedule"},
            "email": {"email", "emails", "mail", "inbox"},
        }
        requested = {kind for kind, aliases in kinds.items() if words & aliases}
        next_calendar = bool(words & {"next", "upcoming"} and "calendar" in requested)
        terms = words - set().union(*kinds.values()) - set(
            "a an the my me i you it this that what which who where when how is are was were "
            "do does did can could would will have has had with about for from to of in on and "
            "or please tell show give find look pull up know say says any all some latest recent "
            "next upcoming scheduled coming soon today tomorrow computer digital saved connected".split()
        )
        rows = {row["id"]: row for row in self.db.all("SELECT * FROM context_documents")}
        scores, matched = {}, set()
        now = time.time()
        for key, row in rows.items():
            title_words = set(re.findall(r"\w{2,}", row["title"].casefold()))
            text_words = set(re.findall(r"\w{2,}", row["text"].casefold()))
            text_score = 3 * len(terms & title_words) + len(terms & text_words)
            if text_score:
                matched.add(key)
            score = text_score + (2 if row["kind"] in requested else 0)
            if score:
                scores[key] = score

        # Follow only relationships exported by Notch or grounded in actual
        # wikilinks/email addresses. One hop supplies the linked note's facts;
        # a matching name alone never establishes a physical person's identity.
        seeds = {key: scores[key] for key in sorted(matched, key=lambda key: (-scores[key], rows[key]["title"]))[:3]}
        for edge in self.db.all("SELECT source,target FROM context_edges"):
            for seed, neighbor in ((edge["source"], edge["target"]), (edge["target"], edge["source"])):
                if seed in seeds and neighbor in rows:
                    scores[neighbor] = max(scores.get(neighbor, 0), seeds[seed] * .65)

        def rank(key):
            row = rows[key]
            start = json.loads(row["payload"]).get("starts_at")
            # Alphabetical titles can push the actual next appointment out of
            # the evidence packet. Prefer real upcoming appointments over notes
            # mentioning them, then subject relevance and chronological order.
            if next_calendar and row["kind"] == "calendar":
                upcoming = start is not None and start >= now
                return (0 if upcoming else 2, -scores[key] if terms else 0, start or float("inf"), row["title"])
            return (1 if next_calendar else 0, -scores[key], float("inf"), row["title"])

        return [self.public(rows[key]) for key in sorted(scores, key=rank)[:limit]]

    def graph(self):
        docs = self.db.all("SELECT * FROM context_documents ORDER BY kind,title LIMIT 300")
        nodes = [{"id": d["id"], "label": d["title"], "kind": d["kind"], "source": "notch"} for d in docs]
        edges = self.db.all("SELECT source,target,relation FROM context_edges")
        # Notch's native graph also includes named wikilink topics without standalone files.
        # Opening such a topic shows the real note that mentions it, not an invented biography.
        known_titles = {d["title"].casefold() for d in docs if d["kind"] == "note"}
        topics = {}
        for d in docs:
            if d["kind"] != "note":
                continue
            for link in re.findall(r"\[\[([^\]\n]+)\]\]", d["text"]):
                title = link.split("|", 1)[0].split("#", 1)[0].strip()
                if not title or title.casefold() in known_titles or len(title) > 128:
                    continue
                key = identifier("topic:" + title.casefold())
                if key not in topics and len(topics) >= 100:
                    continue
                topics[key] = {
                    "id": key,
                    "label": title,
                    "kind": "topic",
                    "source": "notch",
                    "document_id": d["id"],
                }
                edges.append({"source": d["id"], "target": key, "relation": "wikilink_topic"})
        nodes.extend(topics.values())
        events = self.db.all(
            "SELECT id,summary,captured_at,transcript FROM events ORDER BY captured_at DESC LIMIT 30"
        )
        for event in events:
            nodes.append(
                {"id": event["id"], "label": event["summary"][:80], "kind": "moment", "source": "recording"}
            )
            text = (event["summary"] + " " + event["transcript"]).casefold()
            for d in docs:
                title = d["title"].casefold()
                if len(title) >= 5 and re.search(r"(?<!\w)" + re.escape(title) + r"(?!\w)", text):
                    edges.append(
                        {"source": event["id"], "target": d["id"], "relation": "text_mentions_unverified"}
                    )
        ids = {n["id"] for n in nodes}
        return {
            "nodes": nodes,
            "edges": [e for e in edges if e["source"] in ids and e["target"] in ids],
            "status": self.status(),
        }

    def refresh_reminders(self):
        now = time.time()
        age = now - (self.db.setting("notch_last_sync", 0) or 0)
        if not 0 <= age <= 300 or self.db.setting("notch_error", ""):
            return  # Stale calendars must not trigger new reminders.
        for row in self.db.all("SELECT * FROM context_documents WHERE kind='calendar'"):
            d = json.loads(row["payload"])
            start = d.get("starts_at")
            if d.get("all_day") or not start or not now < start <= now + 1800:
                continue
            key = hashlib.sha256(f"{row['id']}:{start}".encode()).hexdigest()
            minutes = max(1, round((start - now) / 60))
            message = f"{row['title']} starts in {minutes} minutes."
            if d.get("location"):
                message += " Location: " + d["location"]
            self.db.execute(
                """INSERT INTO context_reminders VALUES(?,?,?,?,?,0)
                ON CONFLICT(id) DO UPDATE SET message=excluded.message""",
                (key, row["id"], message, start, now),
            )

    def reminders(self):
        """Only expose current, connected appointments; seen IDs stay deduplicated."""
        if (
            not self.db.setting("notch_enabled", False)
            or self.status()["stale"]
            or self.db.setting("notch_error", "")
        ):
            return []
        self.refresh_reminders()
        return self.db.all(
            "SELECT * FROM context_reminders WHERE starts_at>? ORDER BY starts_at LIMIT 30", (time.time(),)
        )

    def disconnect(self):
        self.db.set_setting("notch_enabled", False)
        with self.db.connect() as c:
            c.execute('DELETE FROM answers WHERE evidence LIKE \'%"source": "notch"%\'')
            c.execute("DELETE FROM context_documents")
        for key, value in [("notch_last_sync", None), ("notch_sources", {}), ("notch_error", "")]:
            self.db.set_setting(key, value)

    async def run(self):
        while True:
            if self.db.setting("notch_enabled", False):
                try:
                    await self.sync()
                except ValueError:
                    pass
            await asyncio.sleep(60)
