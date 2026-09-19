"""Bounded evidence selection over retained originals, not visual-token compression.

This is an application-level coverage heuristic. It does not implement a paper's
model internals, infer events between samples, or establish complete recording.
"""

import math
import re
from collections import Counter
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

_DAY_OVERVIEW = re.compile(
    r"(?:please\s+)?(?:"
    r"(?:summari[sz]e|recap|describe)\s+(?:my|our|the)\s+(?:(?:whole|entire)\s+)?day"
    r"|(?:give|show)\s+me\s+(?:a|an)\s+(?:summary|overview|recap)\s+of\s+"
    r"(?:my|our|the)\s+(?:(?:whole|entire)\s+)?day"
    r"|what\s+(?:did\s+(?:i|we)\s+do|happened)\s+(?:today|yesterday|throughout\s+my\s+day)"
    r"|walk\s+me\s+through\s+my\s+day"
    r")(?:\s+(?:today|yesterday))?"
    r"(?:\s+(?:from|using|based on)\s+(?:the\s+)?(?:available\s+|saved\s+|recorded\s+|provided\s+)?"
    r"(?:recordings|footage|evidence))?[?.!]*",
    re.I,
)


def _overview_clause(question):
    question = re.sub(r"\s+", " ", question.strip())
    question = re.sub(r"^(?:can|could|would) you\s+", "", question, flags=re.I)
    # Additional instructions must not disable an explicit opening overview.
    # Qualifiers inside that clause (e.g. "after meeting Tom") still require the
    # focused/temporal path rather than silently becoming an entire-day request.
    return re.split(r"[.!?;,]\s+", question, maxsplit=1)[0]


def is_day_overview(question):
    """Conservatively opt into broad coverage; focused and relative queries stay out."""
    return _DAY_OVERVIEW.fullmatch(_overview_clause(question)) is not None


def day_overview_bounds(question, *, timezone, now, after=None, before=None):
    """Use the user's local calendar day only when no explicit time filters exist.

    Yesterday ends just before today's midnight because SQL time bounds are
    inclusive. Calendar arithmetic preserves 23/25-hour daylight-saving days.
    """
    if after is not None or before is not None:
        return after if after is not None else 0, before if before is not None else now
    zone = ZoneInfo(timezone)
    day = datetime.fromtimestamp(now, zone).date()
    today_start = datetime.combine(day, time.min, zone).timestamp()
    if re.search(r"\byesterday\b", _overview_clause(question), re.I):
        return (
            datetime.combine(day - timedelta(days=1), time.min, zone).timestamp(),
            math.nextafter(today_start, -math.inf),
        )
    return today_start, now


def coverage_qualification(coverage):
    """Deterministic wording that survives model/reviewer rewrites."""
    if not coverage:
        return ""
    parts = ["Only available recorded samples support this answer; it is not a complete account of your day."]
    gap = coverage.get("largest_sample_gap_seconds")
    if gap is not None and gap >= 900:
        parts.append(
            f"Available sample timestamps have a gap of about {round(gap / 60)} minutes; "
            "these samples do not establish what happened between their timestamps."
        )
    pending = coverage.get("pending_samples", 0)
    if pending:
        parts.append(f"{pending} recorded samples have not finished background analysis.")
    missing = coverage.get("selected_images_unavailable", 0)
    if missing:
        parts.append(f"{missing} selected original images could not be loaded for this answer.")
    return " ".join(parts)


def _valid_time(row):
    value = row.get("captured_at")
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _stream(row):
    # Synthetic import timelines and clocks from different streams are never
    # treated as a shared historical wall clock for diversity distances.
    return row.get("device"), row.get("boot"), row.get("clock_quality")


def _physical(rows):
    seen = set()
    for row in rows:
        if (
            row.get("kind") in {"frame", "audio"}
            and row.get("source") != "notch"
            and row.get("id")
            and row["id"] not in seen
            and _valid_time(row)
        ):
            seen.add(row["id"])
            yield row


def select_temporal_evidence(ranked, pool=(), *, limit=6, relevance_slots=2, min_gap_seconds=2.0):
    """Keep top relevant sources, then spread a bounded selection across time.

    ``pool`` must contain candidates from the *whole requested interval*, already
    filtered to the authorized workspace. Selection alone cannot retrieve missing
    periods. Inputs are returned unchanged; IDs, timestamps and provenance survive.
    The first ``relevance_slots`` records come from ``ranked``. Additional slots
    prefer an unrepresented recording stream, then the largest normalized temporal
    distance from its selected samples. Input order breaks ties deterministically.
    Nearby same-kind sources are deferred until distinct moments are exhausted.
    """
    if limit < 0 or relevance_slots < 0 or min_gap_seconds < 0:
        raise ValueError("Selection budgets and separation must be nonnegative")
    ranked = list(ranked)
    candidates = list(_physical([*ranked, *pool]))
    if not candidates or limit == 0:
        return []
    ranked_ids = {row["id"] for row in ranked}
    selected = [row for row in candidates if row["id"] in ranked_ids][: min(limit, relevance_slots)]
    bounds = {}
    for row in candidates:
        key, stamp = _stream(row), row["captured_at"]
        low, high = bounds.get(key, (stamp, stamp))
        bounds[key] = min(low, stamp), max(high, stamp)

    def value(row):
        same_stream = [old for old in selected if _stream(old) == _stream(row)]
        if not same_stream:
            return 1, 1.0
        distance = min(abs(row["captured_at"] - old["captured_at"]) for old in same_stream)
        low, high = bounds[_stream(row)]
        return 0, distance / max(high - low, 1.0)

    while len(selected) < limit:
        selected_ids = {row["id"] for row in selected}
        remaining = [row for row in candidates if row["id"] not in selected_ids]
        if not remaining:
            break
        separated = [
            row
            for row in remaining
            if not any(
                _stream(row) == _stream(old)
                and row["kind"] == old["kind"]
                and abs(row["captured_at"] - old["captured_at"]) < min_gap_seconds
                for old in selected
            )
        ]
        selected.append(max(separated or remaining, key=value))
    return selected


def evidence_coverage(rows, *, after, before):
    """Describe available samples without claiming continuous or complete coverage.

    The caller supplies the complete candidate pool, not merely the chosen images.
    This receipt is an observation of archive metadata, not proof that capture ran
    continuously. Synthetic/import clocks cannot establish historical day coverage.
    """
    if not all(math.isfinite(value) for value in (after, before)) or before < after:
        raise ValueError("Coverage needs a finite, ordered requested interval")
    physical = list(_physical(rows))
    historical = [
        row
        for row in physical
        if row.get("clock_quality") not in {None, "synthetic"} and after <= row["captured_at"] <= before
    ]
    stamps = sorted({row["captured_at"] for row in historical})
    return {
        "requested_after": after,
        "requested_before": before,
        "archive_samples_considered": len(historical),
        "sample_kinds": dict(Counter(row["kind"] for row in historical)),
        "first_sample_at": stamps[0] if stamps else None,
        "last_sample_at": stamps[-1] if stamps else None,
        "largest_sample_gap_seconds": max((b - a for a, b in zip(stamps, stamps[1:])), default=None),
        "seconds_before_first_sample": stamps[0] - after if stamps else None,
        "seconds_after_last_sample": before - stamps[-1] if stamps else None,
        "pending_samples": sum(row.get("status") != "done" for row in historical),
        "excluded_nonhistorical_samples": sum(
            row.get("clock_quality") in {None, "synthetic"} for row in physical
        ),
        "clock_qualities": sorted({row["clock_quality"] for row in historical}),
        "continuous_coverage_established": False,
        "qualification": (
            "These are recorded samples, not proof of a complete day. Gaps between sample times "
            "do not establish that nothing happened. Unattached generated captions remain unverified."
        ),
    }
