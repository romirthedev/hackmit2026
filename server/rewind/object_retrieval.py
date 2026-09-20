"""Bounded visual continuity for explicit object-location questions.

Captions nominate views to inspect; this selector does not establish object
identity, ownership, placement, or which candidate answers the question.
"""

import re

from .db import event_public

LOCATION = re.compile(
    r"^\s*(?:please\s+)?where\s+(?:"
    r"(?:did|do|have)\s+i\s+(?:put|leave|left|place|placed|set|drop|dropped|keep|kept)\s+"
    r"|(?:is|are|was|were)\s+)(.+?)[?.!]*\s*$",
    re.I,
)
IGNORED = set("a an the my our me i please now today yesterday recently last seen just again right".split())
LOCATION_IMAGE_LIMIT = 8


def location_terms(question):
    match = LOCATION.fullmatch(question)
    if not match:
        return []
    # More complex relative questions keep the existing temporal planner path.
    if re.search(r"\b(before|after|since|until|earlier|later|prior|following)\b", match[1], re.I):
        return []
    return [word for word in re.findall(r"\w+", match[1].lower()) if word not in IGNORED and len(word) > 1][
        :12
    ]


def object_location_evidence(db, select_sql, words, ranked, after, before, *, limit=LOCATION_IMAGE_LIMIT):
    """Inspect one recent object episode plus alternative older candidates.

    The recent caption pool and each original-image neighborhood are bounded.
    The first view can visually identify a referent, a strong match can show a
    placement, and the last view can contain a different instance. Preserve all
    three instead of equating the newest instance with the user's object.
    """
    if not words:
        return []
    # A descriptor alone (e.g. "red" in "red bag") must not make a different
    # object the primary continuity anchor. Semantic retrieval remains fallback.
    fts = " AND ".join('"' + word.replace('"', "") + '"' for word in words)
    matches = db.all(
        """SELECT m.id,m.device,m.boot,m.captured_at,bm25(events_fts) AS lexical_rank
        FROM events_fts f JOIN events e ON e.id=f.id JOIN media m ON m.id=e.id
        WHERE events_fts MATCH ? AND m.kind='frame' AND m.captured_at BETWEEN ? AND ?
        ORDER BY m.captured_at DESC,m.id LIMIT 128""",
        (fts, after, before),
    )
    if not matches:
        return []  # Keep semantic/fresh fallback when captions have no object match.
    stream = (matches[0]["device"], matches[0]["boot"])
    recent = [row for row in matches if (row["device"], row["boot"]) == stream]
    strongest = min(recent, key=lambda row: (row["lexical_rank"], -row["captured_at"], row["id"]))
    first = min(recent, key=lambda row: (row["captured_at"], row["id"]))
    latest = max(recent, key=lambda row: (row["captured_at"], row["id"]))
    selected = {}

    def add(row):
        if len(selected) < limit and row["id"] not in selected:
            selected[row["id"]] = row

    # These are actual retained 1 Hz originals, including adjacent frames. The
    # ordinary 2-second image deduplication would erase the brief transition.
    # Spend five images on the candidate transition, one on the initial visual
    # reference, one on the latest instance, and one on a historical alternative.
    # Redundant neighborhoods around reference/last views add decoding latency
    # without extending the strongest transition's inspected time window.
    for anchor, radius, count in ((strongest, 2.1, 5), (first, 0, 1), (latest, 0, 1)):
        for row in db.all(
            select_sql
            + """ WHERE m.device=? AND m.boot=? AND m.kind='frame'
            AND m.captured_at BETWEEN ? AND ?
            ORDER BY ABS(m.captured_at-?),m.captured_at,m.id LIMIT ?""",
            (
                *stream,
                max(after, anchor["captured_at"] - radius),
                min(before, anchor["captured_at"] + radius),
                anchor["captured_at"],
                count,
            ),
        ):
            add(event_public(row))
    # Reserve remaining capacity for alternatives, preferring distinct streams.
    other_streams = set()
    for row in ranked:
        key = (row.get("device"), row.get("boot"))
        if row["kind"] == "frame" and key != stream and key not in other_streams:
            add(row)
            other_streams.add(key)
    for row in ranked:
        if row["kind"] == "frame":
            add(row)
    return sorted(
        selected.values(), key=lambda row: (row["captured_at"], row["device"], row["boot"], row["id"])
    )
