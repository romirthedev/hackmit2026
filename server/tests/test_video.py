import io
import wave
from fractions import Fraction

import numpy as np
import pytest
from rewind.video import audio_samples, video_samples

av = pytest.importorskip("av")


def movie(path):
    with av.open(str(path), "w") as output:
        stream = output.add_stream("ffv1", rate=10)
        stream.width, stream.height, stream.pix_fmt = 64, 48, "yuv420p"
        stream.time_base = Fraction(1, 1000)
        stream.codec_context.time_base = Fraction(1, 1000)
        for pts in [0, 100, 1100, 2400]:
            frame = av.VideoFrame.from_ndarray(np.full((48, 64, 3), 128, dtype=np.uint8), format="rgb24")
            frame.pts, frame.time_base = pts, Fraction(1, 1000)
            for packet in stream.encode(frame):
                output.mux(packet)
        for packet in stream.encode():
            output.mux(packet)


def test_vfr_source_pts_and_numbering(tmp_path):
    path = tmp_path / "vfr.mkv"
    movie(path)
    samples = list(video_samples(path, fps=1, clip_seconds=2))
    assert [s.frame_index for s in samples] == [0, 2, 3]
    assert [s.sequence for s in samples] == [0, 1, 2]
    assert [s.offset for s in samples] == pytest.approx([0, 1.1, 2.4])
    assert [s.clip_index for s in samples] == [0, 0, 1]
    assert len(list(video_samples(path, fps=0))) == 4
    assert list(audio_samples(path)) == []


def test_audio_chunking_preserves_samples_and_offset(tmp_path):
    path = tmp_path / "av.mkv"
    pcm = (np.sin(np.arange(40000) * 0.1) * 1000).astype("<i2")
    with av.open(str(path), "w") as output:
        video = output.add_stream("ffv1", rate=1)
        video.width, video.height, video.pix_fmt = 64, 48, "yuv420p"
        audio = output.add_stream("pcm_s16le", rate=16000)
        audio.layout = "mono"
        frame = av.VideoFrame.from_ndarray(np.zeros((48, 64, 3), dtype=np.uint8), format="rgb24")
        frame.pts, frame.time_base = 0, Fraction(1, 1)
        for packet in video.encode(frame):
            output.mux(packet)
        for packet in video.encode():
            output.mux(packet)
        frame = av.AudioFrame.from_ndarray(pcm.reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate, frame.pts, frame.time_base = 16000, 8000, Fraction(1, 16000)
        for packet in audio.encode(frame):
            output.mux(packet)
        for packet in audio.encode():
            output.mux(packet)
    samples = list(audio_samples(path, clip_seconds=1))
    assert [s.offset for s in samples] == pytest.approx([0.5, 1.5, 2.5])
    decoded = []
    for sample in samples:
        with wave.open(io.BytesIO(sample.data)) as wav:
            decoded.append(wav.readframes(wav.getnframes()))
    assert b"".join(decoded) == pcm.tobytes()


def test_integer_time_base_is_serialized_as_rational(tmp_path):
    from rewind.models import VideoProvenance

    path = tmp_path / "one-fps.avi"
    with av.open(str(path), "w") as output:
        stream = output.add_stream("rawvideo", rate=1)
        stream.width, stream.height, stream.pix_fmt = 64, 48, "yuv420p"
        frame = av.VideoFrame.from_ndarray(np.zeros((48, 64, 3), dtype=np.uint8), format="rgb24")
        frame.pts, frame.time_base = 0, Fraction(1, 1)
        for packet in stream.encode(frame):
            output.mux(packet)
        for packet in stream.encode():
            output.mux(packet)
    sample = next(video_samples(path))
    assert sample.time_base == "1/1"
    metadata = VideoProvenance(
        source_sha256="a" * 64,
        source_offset=sample.offset,
        source_pts=sample.pts,
        time_base=sample.time_base,
        frame_index=sample.frame_index,
        clip_index=sample.clip_index,
        sample_fps=1,
        clock="synthetic",
    )
    assert metadata.source_offset == 0
