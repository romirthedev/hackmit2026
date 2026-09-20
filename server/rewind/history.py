"""Keep an explicit history reset from being undone by delayed phone uploads."""

from fastapi import HTTPException


def require_current_capture(db, captured_at):
    cutoff = db.setting("history_cleared_before", 0)
    if cutoff and captured_at <= cutoff:
        raise HTTPException(410, "This recording was cleared from history.")


# Children precede their parents; optional tables depend on enabled services.
MEMORY_TABLES = (
    "conversation_contexts", "conversation_turns", "computer_commands",
    "demo_answers", "answer_reviews", "answers", "scan_jobs", "scan_documents",
    "person_evidence", "person_audit", "face_index", "people",
    "recording_chunks", "continuous_recordings", "context_reminders",
    "context_edges", "context_documents", "alerts", "rules", "outbox",
    "gate_decisions", "visual_index", "events", "media", "usage",
)


def clear_memory(db, directory, cutoff, protected=None):
    """Clear local memory and reject delayed pre-reset uploads. Caller holds the write gate."""
    import json
    import shutil

    with db.connect() as connection:
        existing = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        preserved = {}
        if protected:
            connection.execute("CREATE TEMP TABLE keep_media(id TEXT PRIMARY KEY)")
            connection.executemany("INSERT INTO keep_media VALUES(?)", ((i,) for i in protected["media"]))
            connection.execute("CREATE TEMP TABLE keep_recordings(id TEXT PRIMARY KEY)")
            connection.executemany("INSERT INTO keep_recordings VALUES(?)", ((i,) for i in protected["recordings"]))
            connection.execute("CREATE TEMP TABLE keep_people(id TEXT PRIMARY KEY)")
            if "person_evidence" in existing:
                connection.execute("INSERT OR IGNORE INTO keep_people SELECT person_id FROM person_evidence "
                                   "WHERE media_id IN (SELECT id FROM keep_media)")
            connection.execute("CREATE TEMP TABLE keep_rules(id TEXT PRIMARY KEY)")
            if "alerts" in existing:
                connection.execute("INSERT OR IGNORE INTO keep_rules SELECT rule_id FROM alerts "
                                   "WHERE event_id IN (SELECT id FROM keep_media) AND rule_id IS NOT NULL")
            preserved = {
                "media": "id IN (SELECT id FROM keep_media)",
                "events": "id IN (SELECT id FROM keep_media)",
                "visual_index": "id IN (SELECT id FROM keep_media)",
                "outbox": "id IN (SELECT id FROM keep_media)",
                "gate_decisions": "media_id IN (SELECT id FROM keep_media)",
                "person_evidence": "media_id IN (SELECT id FROM keep_media)",
                "face_index": "media_id IN (SELECT id FROM keep_media)",
                "people": "id IN (SELECT id FROM keep_people)",
                "person_audit": "person_id IN (SELECT id FROM keep_people)",
                "recording_chunks": "recording_id IN (SELECT id FROM keep_recordings)",
                "continuous_recordings": "id IN (SELECT id FROM keep_recordings)",
                "alerts": "event_id IN (SELECT id FROM keep_media)",
                "rules": "id IN (SELECT id FROM keep_rules)",
            }
        for table in MEMORY_TABLES:
            if table in existing:
                predicate = " WHERE NOT COALESCE((" + preserved[table] + "),0)" if table in preserved else ""
                connection.execute(f'DELETE FROM "{table}"' + predicate)
        for key, value in {
            "history_cleared_before": cutoff,
            "notch_enabled": False, "notch_last_sync": None,
            "notch_sources": {}, "notch_error": "",
        }.items():
            connection.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (key, json.dumps(value)))
    # Only dedicated memory stores, never credentials, configuration or model caches.
    for name in ("media", "recordings", "conversation-audio", "conversation-context", "voice"):
        folder = directory / name
        if folder.exists() and protected:
            # Keep exact original paths and prepared demo speech; remove every
            # transient file, including scans and newly captured demo footage.
            for path in sorted(folder.rglob("*"), key=lambda p: len(p.parts), reverse=True):
                if path.is_dir() and not path.is_symlink():
                    if not any(path.iterdir()):
                        path.rmdir()
                elif path.resolve() not in protected["paths"]:
                    path.unlink(missing_ok=True)
        elif folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True, exist_ok=True)
    (directory / "scene.json").unlink(missing_ok=True)
