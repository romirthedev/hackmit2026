"""Optional, conservative call gates; a reused caption is not new evidence."""

import asyncio
import hashlib
import json
import math
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from weakref import WeakValueDictionary

import numpy as np
from PIL import Image

from .visual import VisualIndex

# Shared by all Worker instances for this DB in one event loop. Only the cheap
# gate decision is serialized; independent fresh VLM descriptions stay parallel.
_STREAM_LOCKS = WeakValueDictionary()


def stream_lock(db, item):
    key = (str(db.path.absolute()), item["device"], item["boot"])
    lock = _STREAM_LOCKS.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _STREAM_LOCKS[key] = lock
    return lock


def unit_vector(raw):
    if raw is None:
        return None
    try:
        vector = (
            np.frombuffer(raw, dtype=np.float32)
            if isinstance(raw, bytes)
            else np.asarray(raw, dtype=np.float32)
        )
        norm = float(np.linalg.norm(vector))
        if vector.ndim != 1 or not vector.size or not np.isfinite(vector).all() or norm < 1e-9:
            return None
        return vector / norm
    except (TypeError, ValueError):
        return None


def cosine(left, right):
    a, b = unit_vector(left), unit_vector(right)
    if a is None or b is None or a.shape != b.shape:
        return None
    return max(-1.0, min(1.0, float(a @ b)))


def image_signature(path, expected_hash):
    path = Path(path)
    payload = path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != expected_hash:
        raise ValueError("Original source differs from its ingest checksum")
    # Decode the checked bytes, not a second mutable file read.
    import io

    with Image.open(io.BytesIO(payload)) as image:
        return np.asarray(image.convert("L").resize((64, 48), Image.Resampling.BOX), dtype=np.float32) / 255


def block_difference(previous, current):
    """Maximum local mean ABSOLUTE pixel delta, not difference of block means.

    Moving a small equal-luminance object inside a block must not cancel out.
    Thresholds still trade savings against sensitivity; this is not lossless.
    """
    if previous.shape != (48, 64) or current.shape != (48, 64):
        raise ValueError("Unexpected visual signature shape")
    return float(np.abs(current - previous).reshape(6, 8, 8, 8).mean(axis=(1, 3)).max())


def audit_gate(
    db,
    item,
    stage,
    decision,
    reason,
    *,
    rule_id=None,
    anchor=None,
    similarity=None,
    block_delta=None,
    metadata=None,
):
    values = dict(metadata or {})
    if anchor:
        values["inherited_from"] = anchor
    if rule_id:
        values["rule_id"] = rule_id
    db.execute(
        """INSERT INTO gate_decisions(id,created_at,stage,media_id,rule_id,decision,reason,
        inherited_from,similarity,block_delta,metadata) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        (
            str(uuid.uuid4()),
            time.time(),
            stage,
            item["id"],
            rule_id,
            decision,
            reason,
            anchor,
            similarity,
            block_delta,
            json.dumps(values),
        ),
    )
    return values


@dataclass
class CaptionDecision:
    inherited: dict | None = None
    reason: str = "disabled"
    similarity: float | None = None
    block_delta: float | None = None


class CaptionGate:
    def __init__(self, db, provider, settings, visual=None):
        self.db, self.p, self.s = db, provider, settings
        self.visual = visual or VisualIndex(db, settings, remote=provider)

    async def ensure_vector(self, item):
        row = self.db.one(
            "SELECT * FROM visual_index WHERE id=? AND model=?", (item["id"], self.visual.model_key)
        )
        if row and row["status"] == "done":
            return unit_vector(row["embedding"])
        # Cooperate with the independent OpenCLIP worker. Do not start a duplicate
        # encode while it owns a live lease; the caption gate then fails open.
        with self.db.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute(
                "SELECT * FROM visual_index WHERE id=? AND model=?", (item["id"], self.visual.model_key)
            ).fetchone()
            if row and row["status"] == "done":
                return unit_vector(row["embedding"])
            if row and row["status"] == "processing" and row["lease_until"] > time.time():
                return None
            c.execute(
                """INSERT INTO visual_index(id,model,status,attempts,lease_until) VALUES(?,?,'processing',1,?)
                ON CONFLICT(id,model) DO UPDATE SET status='processing',attempts=attempts+1,lease_until=excluded.lease_until""",
                (item["id"], self.visual.model_key, time.time() + 900),
            )
        await self.visual.process(item)
        row = self.db.one(
            "SELECT embedding FROM visual_index WHERE id=? AND model=? AND status='done'",
            (item["id"], self.visual.model_key),
        )
        return unit_vector(row["embedding"]) if row else None

    async def decide(self, item):
        # Verify each current original even when the vector is cached. A changed
        # original must never be described or inherited under its old identity.
        signature = await asyncio.to_thread(image_signature, item["path"], item["sha256"])
        try:
            current_vector = await self.ensure_vector(item)
        except (OSError, RuntimeError, ValueError):
            current_vector = None
        async with stream_lock(self.db, item):
            previous = self.db.one(
                """SELECT e.*,m.path,m.sha256,m.seq,v.embedding AS visual_vector FROM events e
                JOIN media m ON m.id=e.id LEFT JOIN visual_index v ON v.id=m.id AND v.model=? AND v.status='done'
                WHERE m.device=? AND m.boot=? AND m.kind='frame' AND m.seq<? AND m.captured_at<=?
                AND e.label_mode IN ('described','legacy') ORDER BY m.seq DESC LIMIT 1""",
                (self.visual.model_key, item["device"], item["boot"], item["seq"], item["captured_at"]),
            )
            result = CaptionDecision(reason="no_previous_description")
            if item["intent"] == "question":
                result.reason = "question_original"
            elif previous:
                # Other descriptions may still be in flight. Compare only this
                # completed, strictly earlier original; a pending caption never
                # becomes an anchor, and inherited captions never extend it.
                elapsed = item["captured_at"] - previous["captured_at"]
                result.similarity = cosine(current_vector, previous["visual_vector"])
                try:
                    old_signature = await asyncio.to_thread(
                        image_signature, previous["path"], previous["sha256"]
                    )
                    result.block_delta = block_difference(old_signature, signature)
                except (OSError, ValueError):
                    result.reason = "previous_original_unavailable"
                else:
                    if elapsed >= self.s.change_gate_heartbeat_s:
                        result.reason = "description_heartbeat"
                    elif result.similarity is None:
                        result.reason = "visual_vector_unavailable"
                    elif result.similarity <= self.s.change_gate_sim:
                        result.reason = "visual_embedding_changed"
                    elif result.block_delta >= self.s.change_gate_block:
                        result.reason = "local_pixels_changed"
                    else:
                        result.reason = "unchanged_since_description"
                        result.inherited = previous
            audit_gate(
                self.db,
                item,
                "observe",
                "inherit" if result.inherited else "describe",
                result.reason,
                anchor=previous["id"] if previous else None,
                similarity=result.similarity,
                block_delta=result.block_delta,
                metadata={
                    "block_definition": "max_8x6_block_mean_absolute_pixel_delta_at_64x48",
                    "heartbeat_s": self.s.change_gate_heartbeat_s,
                },
            )
            return result


RULE_STOP = set(
    "a an the my your me i you we us it this that there here tell alert notify remind if when whenever is are was were be been being on in at to of for and or with has have had do does did please any something appears see sees visible not no never without don't doesn't isn't aren't".split()
)


def cue_words(text):
    # Deliberately broad lexical fallback, not an NLP claim about noun extraction.
    # Negation remains in the actual rule/model packet; the gate never decides
    # whether an alert is true from overlap or cosine.
    return {
        word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) > 1 and word not in RULE_STOP
    }


class RuleGate:
    def __init__(self, db, provider, settings):
        self.db, self.p, self.s = db, provider, settings
        self.cache = {}
        self.lock = asyncio.Lock()

    async def decide(self, item, event, rule):
        objects = json.loads(event["objects"]) if isinstance(event["objects"], str) else event["objects"]
        tags = json.loads(event["tags"]) if isinstance(event["tags"], str) else event["tags"]
        # Include caption/transcript cues too: compact captions may omit tags and
        # speech events often have no object list. A lexical hit fails open.
        labels = " ".join(str(obj.get("label", "")) for obj in objects)
        text = " ".join((event["summary"], event["transcript"], " ".join(tags), labels))
        overlap = sorted(cue_words(rule["instruction"]) & cue_words(text))
        similarity = None
        if overlap:
            reason, evaluate = "lexical_cue", True
        else:
            key = (rule["id"], rule["instruction"], self.s.embedding_model)
            async with self.lock:
                if key not in self.cache:
                    try:
                        vector = unit_vector(await self.p.embed(rule["instruction"]))
                    except Exception:
                        vector = None
                    # Missing vectors are not cached forever after an outage.
                    if vector is not None:
                        self.cache[key] = vector
                vector = self.cache.get(key)
            similarity = (
                cosine(vector, event["embedding"])
                if event["embedding_model"] == self.s.embedding_model
                else None
            )
            if similarity is None or not math.isfinite(similarity):
                reason, evaluate = "embedding_unavailable", True
            elif similarity > self.s.rule_gate_threshold:
                reason, evaluate = "semantic_cue", True
            else:
                reason, evaluate = "no_relevant_cue", False
        metadata = audit_gate(
            self.db,
            item,
            "rule",
            "evaluate" if evaluate else "skip",
            reason,
            rule_id=rule["id"],
            similarity=similarity,
            metadata={"lexical_overlap": overlap, "threshold": self.s.rule_gate_threshold},
        )
        return evaluate, reason, metadata
