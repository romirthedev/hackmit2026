"""Local OpenCLIP retrieval over original pixels, independent of caption jobs.

Uses the upstream OpenCLIP inference API (MIT). See research/VIDEO-MEMORY.md
and research/licenses. Weights are revision-pinned and loaded from safetensors.
"""

import asyncio
import logging
import threading
import time
from pathlib import Path

import numpy as np
from PIL import Image

log = logging.getLogger(__name__)
REPOSITORY = "laion/CLIP-ViT-B-32-laion2B-s34B-b79K"
REVISION = "1a25a446712ba5ee05982a381eed697ef9b435cf"
MODEL_KEY = f"open_clip:3.3.0:ViT-B-32:{REVISION}"


def normalized(vector):
    vector = np.asarray(vector, dtype=np.float32)
    if vector.ndim != 1 or not np.isfinite(vector).all() or np.linalg.norm(vector) < 1e-9:
        raise ValueError("Invalid visual embedding")
    return vector / np.linalg.norm(vector)


class OpenClipEncoder:
    model_key = MODEL_KEY

    def __init__(self, device="cpu"):
        self.device = device
        self._model = None
        # Serializes model initialization and inference across worker/query threads.
        self._lock = threading.Lock()

    def load(self, download=False):
        import open_clip
        import torch
        from huggingface_hub import hf_hub_download

        if self._model is not None:
            return
        weights = hf_hub_download(
            REPOSITORY,
            "open_clip_model.safetensors",
            revision=REVISION,
            local_files_only=not download,
        )
        if self.device == "cpu":
            torch.set_num_threads(2)
        model, _, preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32",
            pretrained=weights,
            device=self.device,
        )
        model.eval()
        self._preprocess = preprocess
        self._tokenizer = open_clip.get_tokenizer("ViT-B-32")
        self._model = model

    def encode(self, *, path=None, text=None):
        import torch

        with self._lock, torch.inference_mode():
            self.load()
            if path is not None:
                with Image.open(path) as image:
                    tensor = self._preprocess(image.convert("RGB")).unsqueeze(0).to(self.device)
                vector = self._model.encode_image(tensor)
            else:
                vector = self._model.encode_text(self._tokenizer([text]).to(self.device))
            return normalized(vector[0].float().cpu().numpy())


class VisualIndex:
    def __init__(self, db, settings, encoder=None):
        self.db, self.s = db, settings
        self.encoder = encoder or OpenClipEncoder(settings.visual_device)
        self.model_key = self.encoder.model_key

    def claim(self):
        now = time.time()
        with self.db.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute(
                """SELECT m.id,m.path FROM media m LEFT JOIN visual_index v ON m.id=v.id AND v.model=?
                WHERE m.kind='frame' AND (v.id IS NULL OR
                (v.status='queued' AND v.retry_at<=?) OR (v.status='processing' AND v.lease_until<?))
                ORDER BY m.captured_at LIMIT 1""",
                (self.model_key, now, now),
            ).fetchone()
            if row is None:
                return None
            c.execute(
                """INSERT INTO visual_index(id,model,status,attempts,lease_until) VALUES(?,?,'processing',1,?)
                ON CONFLICT(id,model) DO UPDATE SET status='processing',attempts=attempts+1,
                lease_until=excluded.lease_until""",
                (row["id"], self.model_key, now + 900),
            )
            return dict(row)

    async def process(self, item):
        started = time.monotonic()
        try:
            vector = normalized(await asyncio.to_thread(self.encoder.encode, path=Path(item["path"])))
            self.db.execute(
                """UPDATE visual_index SET embedding=?,status='done',error=NULL,lease_until=0,analysis_ms=?
                WHERE id=? AND model=?""",
                (vector.tobytes(), (time.monotonic() - started) * 1000, item["id"], self.model_key),
            )
        except asyncio.CancelledError:
            self.db.execute(
                "UPDATE visual_index SET status='queued',lease_until=0 WHERE id=? AND model=?",
                (item["id"], self.model_key),
            )
            raise
        except Exception as error:
            self.db.execute(
                """UPDATE visual_index SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
                error=?,retry_at=?,lease_until=0 WHERE id=? AND model=?""",
                (type(error).__name__, time.time() + 60, item["id"], self.model_key),
            )
            log.warning("Visual indexing failed for %s: %s", item["id"], type(error).__name__)

    async def search(self, query, after, before, limit):
        # Do not load a model for an empty index.
        if not self.db.one(
            "SELECT id FROM visual_index WHERE model=? AND status='done' LIMIT 1", (self.model_key,)
        ):
            return []
        vector = normalized(await asyncio.to_thread(self.encoder.encode, text=query))
        best = []
        with self.db.connect() as c:
            cursor = c.execute(
                """SELECT v.id,v.embedding FROM visual_index v JOIN media m ON m.id=v.id
                WHERE v.model=? AND v.status='done' AND m.captured_at BETWEEN ? AND ?""",
                (self.model_key, after, before),
            )
            while batch := cursor.fetchmany(512):
                for row in batch:
                    candidate = np.frombuffer(row["embedding"], dtype=np.float32)
                    if candidate.shape == vector.shape and np.isfinite(candidate).all():
                        best.append((float(candidate @ vector), row["id"]))
                best = sorted(best, reverse=True)[:limit]
        # Similarity ranks candidates; it is deliberately NOT a presence/confidence threshold.
        return best

    def status(self):
        counts = self.db.one(
            """SELECT COUNT(*) total,COALESCE(SUM(v.status='done'),0) AS "indexed",
            COALESCE(SUM(v.status='failed'),0) failed,AVG(v.analysis_ms) average_ms
            FROM media m LEFT JOIN visual_index v ON v.id=m.id AND v.model=? WHERE m.kind='frame'""",
            (self.model_key,),
        )
        return {
            **counts,
            "pending": counts["total"] - counts["indexed"] - counts["failed"],
            "enabled": self.s.visual_embeddings,
            "model": self.model_key,
        }

    async def run(self):
        while True:
            item = self.claim()
            if item:
                await self.process(item)
            else:
                await asyncio.sleep(1)
