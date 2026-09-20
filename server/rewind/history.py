"""Keep an explicit history reset from being undone by delayed phone uploads."""

from fastapi import HTTPException


def require_current_capture(db, captured_at):
    cutoff = db.setting("history_cleared_before", 0)
    if cutoff and captured_at <= cutoff:
        raise HTTPException(410, "This recording was cleared from history.")
