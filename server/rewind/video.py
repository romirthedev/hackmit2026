"""Streaming PyAV demux/decode; source PTS are kept instead of using frame/fps.

PyAV/FFmpeg perform decoding and resampling. REWIND only selects samples,
packages bounded uploads, and records their provenance. See research/VIDEO-MEMORY.md.
"""

import io
import math
import wave
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path


@dataclass
class Sample:
    kind: str
    sequence: int
    data: bytes
    offset: float
    pts: int
    time_base: str
    frame_index: int | None
    clip_index: int


def video_origin(path: Path):
    import av

    with av.open(str(path)) as container:
        if not container.streams.video:
            raise ValueError("No video stream found")
        first = next(container.decode(video=0), None)
        if first is None or first.pts is None:
            raise ValueError("Video has no timestamped frames")
        origin = Fraction(first.pts) * first.time_base
        if container.streams.audio:
            stream = container.streams.audio[0]
            if stream.start_time is not None:
                origin = min(origin, stream.start_time * stream.time_base)
        return origin


def video_samples(path: Path, fps=1.0, clip_seconds=30):
    import av

    origin = video_origin(path)
    next_at, sequence, previous = 0.0, 0, -math.inf
    with av.open(str(path)) as container:
        for index, frame in enumerate(container.decode(video=0)):
            if frame.pts is None:
                raise ValueError(f"Frame {index} has no presentation timestamp")
            offset = float(frame.pts * frame.time_base - origin)
            if offset < previous:
                raise ValueError("Non-monotonic video presentation timestamps")
            previous = offset
            if fps and offset + 1e-7 < next_at:
                continue
            if fps:
                next_at = (math.floor((offset + 1e-7) * fps) + 1) / fps
            buffer = io.BytesIO()
            frame.to_image().save(buffer, format="JPEG", quality=95)
            yield Sample(
                "frame",
                sequence,
                buffer.getvalue(),
                offset,
                frame.pts,
                f"{frame.time_base.numerator}/{frame.time_base.denominator}",
                index,
                max(0, int(offset // clip_seconds)),
            )
            sequence += 1


def audio_samples(path: Path, clip_seconds=30):
    import av

    origin = video_origin(path)
    rate, sequence = 16000, 0
    max_bytes = clip_seconds * rate * 2
    buffer = bytearray()
    buffer_pts = None

    def sample(data, pts, seq):
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(data)
        offset = float(Fraction(pts, rate) - origin)
        return Sample(
            "audio",
            seq,
            output.getvalue(),
            offset,
            pts,
            f"1/{rate}",
            None,
            max(0, int(offset // clip_seconds)),
        )

    with av.open(str(path)) as container:
        if not container.streams.audio:
            return
        resampler = av.AudioResampler(format="s16", layout="mono", rate=rate)

        def decoded():
            for frame in container.decode(audio=0):
                yield from resampler.resample(frame)
            yield from resampler.resample(None)

        for frame in decoded():
            if frame.pts is None:
                raise ValueError("Audio has no presentation timestamp")
            pts = round(frame.pts * frame.time_base * rate)
            if buffer_pts is not None and abs(pts - (buffer_pts + len(buffer) // 2)) > 1:
                # Preserve gaps/overlaps as separate uploads rather than inventing continuous time.
                if buffer:
                    yield sample(bytes(buffer), buffer_pts, sequence)
                    sequence += 1
                buffer.clear()
                buffer_pts = None
            if buffer_pts is None:
                buffer_pts = pts
            buffer.extend(frame.to_ndarray().astype("<i2", copy=False).tobytes())
            while len(buffer) >= max_bytes:
                yield sample(bytes(buffer[:max_bytes]), buffer_pts, sequence)
                sequence += 1
                del buffer[:max_bytes]
                buffer_pts += max_bytes // 2
        if buffer:
            yield sample(bytes(buffer), buffer_pts, sequence)
