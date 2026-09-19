"""Connect still-image evidence to retained recordings without claiming to read video.

The phone uses the same UUID for its sample boot and continuous recording. Links
are workspace-authenticated routes, never public files or credentials. This
module reads manifests only; it neither decodes video nor invents frame PTS.
"""

import re
import time
from uuid import UUID

from .recording_integrity import fragments_status


def attach_original_recordings(db, evidence):
    """Annotate public evidence dictionaries and return their actual inspection scope.

    A complete manifest means all reported fragments were saved, not that the
    person's entire day was captured. Ending due to interruption stays explicit.
    """
    physical = [row for row in evidence if row.get("kind") in {"frame", "audio"}]
    if not physical:
        return None
    scope = {
        "visual_basis": "selected still images only",
        "selected_frame_samples": sum(row["kind"] == "frame" for row in physical),
        "continuous_video_inspected": False,
        "between_sample_actions_may_be_missing": True,
        "recording_clock_alignment": "device wall clocks; not exact container presentation timestamps",
        "limitation": (
            "Only attached still images and supplied audio transcripts are inspected for this answer. "
            "A retained full recording may contain additional details between sampled images; its "
            "existence does not establish those details until the video is inspected."
        ),
        "continuous_originals": [],
    }
    if not db.one("SELECT name FROM sqlite_master WHERE type='table' AND name='continuous_recordings'"):
        return scope
    cached = {}
    for source in physical:
        source.pop("original_recording", None)
        if source.get("clock_quality") == "synthetic":
            continue
        try:
            identifier = str(UUID(source.get("boot", "")))
        except (ValueError, AttributeError, TypeError):
            continue
        if identifier not in cached:
            recording = db.one("SELECT * FROM continuous_recordings WHERE id=?", (identifier,))
            if recording is None:
                cached[identifier] = None
                continue
            parts = db.all(
                "SELECT seq,bytes,path,sha256 FROM recording_chunks WHERE recording_id=? ORDER BY seq",
                (identifier,),
            )
            expected = recording["expected_chunks"]
            contiguous = all(part["seq"] == index for index, part in enumerate(parts))
            complete = expected is not None and expected == len(parts) and contiguous
            available = complete and bool(parts)
            integrity = "unchecked"
            if available:
                integrity = fragments_status(parts)
                available = integrity == "available"
            status = (
                "empty"
                if complete and not parts
                else "complete"
                if available
                else integrity
                if complete
                else "uploading"
                if expected is not None
                else "open"
            )
            cached[identifier] = {
                "recording_id": identifier,
                "status": status,
                "complete": complete and (available or not parts),
                "manifest_complete": complete,
                "received_chunks": len(parts),
                "expected_chunks": expected,
                "started_at": recording["started_at"],
                "ended_at": recording["ended_at"],
                "end_reason": recording["end_reason"],
                "original_url": f"/api/continuous-recordings/{identifier}/original" if available else None,
                "manifest_url": f"/api/continuous-recordings/{identifier}",
                "continuous_video_inspected": False,
                "availability_checked_at": time.time(),
            }
        original = cached.get(identifier)
        if original is None:
            continue
        source["original_recording"] = original.copy()
    scope["continuous_originals"] = [row for row in cached.values() if row is not None]
    return scope


def sample_scope_qualification(question, answer, scope):
    """Avoid boilerplate for simple answers; qualify exhaustive or absence claims."""
    if not scope or not scope.get("selected_frame_samples"):
        return ""
    exhaustive = re.search(
        r"\b(ever|never|every|entire|whole)\b|\bat any (?:time|point)\b|\bbetween (?:the )?(?:frames|samples)\b",
        question,
        re.I,
    )
    negative = re.search(r"^\s*no\b|\b(?:never|nothing happened|nobody|no one)\b", answer, re.I)
    bounded = re.search(
        r"\b(?:frame|image|sample|available (?:evidence|recordings)|cannot establish|can't establish|could not establish)\b",
        answer,
        re.I,
    )
    if not exhaustive and (not negative or bounded):
        return ""
    return "This answer checks sampled images; it cannot rule out events between samples."
