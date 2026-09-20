"""Keep an explicit history reset from being undone by delayed phone uploads."""

from fastapi import HTTPException


def require_current_capture(db, captured_at):
    cutoff = db.setting("history_cleared_before", 0)
    if cutoff and captured_at <= cutoff:
        raise HTTPException(410, "This recording was cleared from history.")


# Children precede their parents; optional tables depend on enabled services.
MEMORY_TABLES = (
    "conversation_contexts", "conversation_turns", "computer_commands",
    "answer_reviews", "answers", "scan_jobs", "scan_documents",
    "person_evidence", "person_audit", "face_index", "people",
    "recording_chunks", "continuous_recordings", "context_reminders",
    "context_edges", "context_documents", "alerts", "rules", "outbox",
    "gate_decisions", "visual_index", "events", "media", "usage",
)


def clear_memory(db, directory, cutoff):
    """Clear local memory and reject delayed pre-reset uploads. Caller holds the write gate."""
    import json
    import shutil

    with db.connect() as connection:
        existing = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in MEMORY_TABLES:
            if table in existing:
                connection.execute(f'DELETE FROM "{table}"')
        for key, value in {
            "history_cleared_before": cutoff,
            "notch_enabled": False, "notch_last_sync": None,
            "notch_sources": {}, "notch_error": "",
        }.items():
            connection.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (key, json.dumps(value)))
    # Only dedicated memory stores, never credentials, configuration or model caches.
    for name in ("media", "recordings", "conversation-audio", "conversation-context", "voice"):
        folder = directory / name
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True, exist_ok=True)
    (directory / "scene.json").unlink(missing_ok=True)
