import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS media (
 id TEXT PRIMARY KEY, device TEXT NOT NULL, boot TEXT NOT NULL, seq INTEGER NOT NULL,
 kind TEXT NOT NULL, captured_at REAL NOT NULL, received_at REAL NOT NULL,
 clock_quality TEXT NOT NULL, sha256 TEXT NOT NULL, path TEXT NOT NULL,
 bytes INTEGER NOT NULL, mime TEXT NOT NULL, duration REAL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
 lease_until REAL DEFAULT 0, retry_at REAL DEFAULT 0, error TEXT,
 analysis_ms REAL, intent TEXT NOT NULL DEFAULT 'memory',
 UNIQUE(device,boot,kind,seq)
);
CREATE INDEX IF NOT EXISTS idx_media_time ON media(captured_at);
CREATE INDEX IF NOT EXISTS idx_media_queue ON media(status,retry_at,captured_at);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE, captured_at REAL NOT NULL,
 kind TEXT NOT NULL, summary TEXT NOT NULL, transcript TEXT NOT NULL DEFAULT '',
 objects TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]',
 segments TEXT NOT NULL DEFAULT '[]', confidence REAL NOT NULL DEFAULT 0,
 embedding BLOB, embedding_model TEXT, embedding_error TEXT,
 model TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(captured_at);
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(id UNINDEXED,summary,transcript,tags);
CREATE TRIGGER IF NOT EXISTS events_insert AFTER INSERT ON events BEGIN
 INSERT INTO events_fts(id,summary,transcript,tags) VALUES(new.id,new.summary,new.transcript,new.tags);
END;
CREATE TRIGGER IF NOT EXISTS events_delete AFTER DELETE ON events BEGIN
 DELETE FROM events_fts WHERE id=old.id;
END;
CREATE TABLE IF NOT EXISTS devices (
 id TEXT PRIMARY KEY, last_seen REAL NOT NULL, state TEXT NOT NULL DEFAULT '{}', paused INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rules (
 id TEXT PRIMARY KEY, instruction TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
 created_at REAL NOT NULL, cooldown_seconds INTEGER NOT NULL DEFAULT 60
);
CREATE TABLE IF NOT EXISTS alerts (
 id TEXT PRIMARY KEY, rule_id TEXT REFERENCES rules(id) ON DELETE CASCADE,
 event_id TEXT REFERENCES media(id) ON DELETE CASCADE,
 message TEXT NOT NULL, created_at REAL NOT NULL, seen INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alert_rule_time ON alerts(rule_id,created_at);
CREATE TABLE IF NOT EXISTS answers (
 id TEXT PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL,
 evidence TEXT NOT NULL, created_at REAL NOT NULL, source_media TEXT UNIQUE,
 grounded INTEGER NOT NULL, mode TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS browser_pairings (
 ticket_hash TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS pairing_attempts (
 bucket TEXT PRIMARY KEY, started_at REAL NOT NULL, attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, attempts INTEGER DEFAULT 0, retry_at REAL DEFAULT 0, error TEXT);
"""


class Database:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "rewind.sqlite3"
        with self.connect() as c:
            c.executescript(SCHEMA)
            c.execute("PRAGMA user_version=1")

    @contextmanager
    def connect(self):
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA synchronous=FULL")
        try:
            yield c
            c.commit()
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()

    def all(self, sql, args=()):
        with self.connect() as c:
            return [dict(r) for r in c.execute(sql, args).fetchall()]

    def one(self, sql, args=()):
        rows = self.all(sql, args)
        return rows[0] if rows else None

    def execute(self, sql, args=()):
        with self.connect() as c:
            return c.execute(sql, args).rowcount

    def setting(self, key, default=None):
        row = self.one("SELECT value FROM settings WHERE key=?", (key,))
        return json.loads(row["value"]) if row else default

    def set_setting(self, key, value):
        self.execute(
            "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value)),
        )


def event_public(row):
    if not row:
        return None
    out = {k: v for k, v in row.items() if k not in ("embedding", "path", "sha256")}
    for key in ("objects", "tags", "segments"):
        if isinstance(out.get(key), str):
            out[key] = json.loads(out[key])
    out["media_url"] = f"/api/media/{out['id']}"
    return out
