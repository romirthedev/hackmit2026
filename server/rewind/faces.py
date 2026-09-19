"""ASUS CPU face features. Similarity suggests a possible match, never an identity fact."""

import hashlib
import threading
from pathlib import Path

import numpy as np

MODEL = "opencv-yunet-2023mar-sface-2021dec-v1"
DIGESTS = {
    "yunet.onnx": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    "sface.onnx": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
}


def normalized(vector):
    vector = np.asarray(vector, dtype=np.float32).reshape(-1)
    if vector.size != 128 or not np.isfinite(vector).all():
        raise ValueError("Invalid face feature vector")
    length = float(np.linalg.norm(vector))
    if length < 1e-8:
        raise ValueError("Empty face feature vector")
    return vector / length


def possible_match(vector, gallery, threshold=0.60, margin=0.10):
    """Heuristic abstention, not a calibrated identity decision or confidence score."""
    query = normalized(vector)
    candidates = {}
    for item in gallery:
        score = float(np.clip(np.dot(query, normalized(item["embedding"])), -1, 1))
        previous = candidates.get(item["person_id"])
        if previous is None or score > previous["similarity"]:
            candidates[item["person_id"]] = {
                "person_id": item["person_id"],
                "name": item["name"],
                "similarity": score,
                "enrollment_id": item["id"],
            }
    ranked = sorted(candidates.values(), key=lambda item: -item["similarity"])
    if not ranked or ranked[0]["similarity"] < threshold:
        return {"status": "unknown"}
    if len(ranked) > 1 and ranked[0]["similarity"] - ranked[1]["similarity"] < margin:
        return {"status": "ambiguous"}
    return {"status": "possible_match", **ranked[0], "requires_confirmation": True}


class FaceEncoder:
    """Lazy small CPU models, pinned to source hashes; never downloads at inference time."""

    def __init__(self, directory):
        self.directory = Path(directory)
        self.lock = threading.Lock()
        self.detector = self.recognizer = None

    def load(self):
        if self.detector is not None:
            return
        for name, digest in DIGESTS.items():
            path = self.directory / name
            if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise ValueError("Face models are missing or differ from their pinned source hashes")
        import cv2

        # Explicit CPU target prevents this small utility competing with the 35B GPU runtime.
        cv2.setNumThreads(2)
        self.detector = cv2.FaceDetectorYN.create(
            str(self.directory / "yunet.onnx"),
            "",
            (320, 320),
            0.90,
            0.3,
            200,
            cv2.dnn.DNN_BACKEND_OPENCV,
            cv2.dnn.DNN_TARGET_CPU,
        )
        self.recognizer = cv2.FaceRecognizerSF.create(
            str(self.directory / "sface.onnx"),
            "",
            cv2.dnn.DNN_BACKEND_OPENCV,
            cv2.dnn.DNN_TARGET_CPU,
        )

    def encode(self, data):
        import cv2

        image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Could not decode the original frame")
        height, width = image.shape[:2]
        if width * height > 16_000_000:
            raise ValueError("Frame is too large for face processing")
        scale = min(1.0, 960 / max(width, height))
        resized = cv2.resize(image, (round(width * scale), round(height * scale))) if scale < 1 else image
        small_height, small_width = resized.shape[:2]
        with self.lock:
            self.load()
            self.detector.setInputSize((small_width, small_height))
            _, detections = self.detector.detect(resized)
            faces = []
            for index, face in enumerate(detections if detections is not None else []):
                if index >= 20:
                    break
                # Tiny detections are not reliable enrollment material.
                if min(face[2], face[3]) < 40:
                    continue
                aligned = self.recognizer.alignCrop(resized, face)
                feature = normalized(self.recognizer.feature(aligned))
                x, y, w, h = (float(value) for value in face[:4])
                box = [
                    max(0, x / small_width),
                    max(0, y / small_height),
                    min(1, (x + w) / small_width),
                    min(1, (y + h) / small_height),
                ]
                if box[2] <= box[0] or box[3] <= box[1]:
                    continue
                key = hashlib.sha256(
                    (hashlib.sha256(data).hexdigest() + MODEL + str(index)).encode()
                ).hexdigest()
                faces.append(
                    {
                        "key": key,
                        "box": box,
                        "detection_score": float(face[-1]),
                        "embedding": feature.tolist(),
                    }
                )
        return {"model": MODEL, "sha256": hashlib.sha256(data).hexdigest(), "faces": faces}
