# Research provenance

This repository integrates upstream capture/model libraries with its own evidence ledger, durable jobs, retrieval adapters, dashboard and device firmware. It does not bundle model weights or present paper benchmark results as measurements of REWIND.

## Wearable and video-memory reuse

[Source audit, licenses, integration, setup, and limitations](VIDEO-MEMORY.md) covers OMI/OmiGlass, VideoRAG, Screenpipe, OpenCLIP, PyAV and faster-whisper. OpenCLIP pixel retrieval and PyAV timestamped streaming import are implemented and tested locally; full upstream product stacks are not claimed as integrated.

[Model versus retrieval diagnosis](MODEL-GAP.md) compares the assistant's review workflow with the 3B pipeline, records same-model evidence probes, and explains the available stronger-model API path.

## LingBot-Map

- [Official source](https://github.com/Robbyant/lingbot-map)
- [Paper](https://arxiv.org/abs/2604.14141)
- [Official weights](https://huggingface.co/robbyant/lingbot-map)
- Source revision inspected and pinned: `849e690bb086103637e44b1e91878d9d43a8bf0c`.
- Upstream code is Apache-2.0; installation preserves upstream license files. Check model card terms for downloaded weights and any upstream dependencies.

`scripts/reconstruct.py` calls `GCTStream.inference_streaming` and the official preprocessing/geometry utilities. It converts actual model output into the dashboard's point-cloud format, using predicted depth/intrinsics/poses when the point head is disabled. The GPU adapter has not been run on the user's ASUS machine. The conversion/export logic is separately tested on explicit synthetic tensors.

This implementation deliberately bounds a scan to 8–256 frames, default 64. Long sessions remain in the original recording store rather than being loaded into one GPU tensor. Scan geometry has arbitrary monocular scale. Moving objects, thin geometry, reflective surfaces, motion blur and poor overlap can fail. Markers are approximate visible-surface anchors derived from observed bounding boxes; no dynamic object tracking claim is made.

## StreamMind / StreamArena

- [Official repository](https://github.com/JIA-Lab-research/StreamArena)
- [Paper](https://arxiv.org/abs/2608.05703)

The separation between immediate interaction and background visual memory informed the design. REWIND's job queue and evidence retrieval are original implementations. StreamMind code and its benchmark results are not included or reproduced.

## Em-Garde

- [Official repository](https://github.com/air-embodied-brain/Em-Garde)
- [Paper](https://arxiv.org/abs/2603.19054)

Instruction-driven visual monitoring informed the rule interface. This version evaluates recent observations directly; it does not implement or claim Em-Garde's inexpensive cue-matching gate. The user's every-captured-frame analysis preference takes precedence over skipping expensive frame analysis.

## Runtime references

- [Ollama chat API](https://docs.ollama.com/api/chat): image messages and JSON-schema output.
- [Qwen3.5-35B-A3B model card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B): Apache-2.0 open-weight vision-language default.
- [Ollama Qwen3.5 packages](https://ollama.com/library/qwen3.5/tags): `qwen3.5:35b-a3b-q4_K_M`, about 24 GB on disk. Record the actual pulled model digest for the demo. Runtime memory exceeds package size. Published upstream benchmarks are not measurements of REWIND or its quantized, non-thinking default.
- [faster-whisper source](https://github.com/SYSTRAN/faster-whisper): local audio transcription.
- [OpenAI image input](https://developers.openai.com/api/docs/guides/images-vision): optional Responses integration.
- [Espressif camera driver](https://github.com/espressif/esp32-camera): Arduino camera integration.

WorldMirror/HY-World and ForeHOI are not dependencies. Running all research stacks at once would add installation and memory risk without improving the deadline's core visual-recall path.
