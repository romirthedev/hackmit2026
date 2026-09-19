# Larger vision models on the GX10

Prepared 2026-09-19. **No GX10 inference result yet.** Tailscale connectivity and
the remote SSH service were reached, but Linux authentication rejected the Mac's
key. GPU identity, available unified memory, disk space, and model runtime remain
unverified until shell access works. The Mac has a separate userspace Tailscale
client; it does not change the Mac's default route or DNS.

## Candidates, not a declared winner

| Model package | Published download | Reason to test |
| --- | --- | --- |
| `qwen3.5:122b-a10b-q4_K_M` | 81 GB | Large multimodal model with more plausible runtime headroom on 128 GB. |
| `qwen3.8:27b-q8_0` | 30 GB | Newer dense vision model; size alone does not determine accuracy. |
| `qwen3.8-flash-next:125b-a6b-q4_K_M` | 120 GB | Newer large experimental model; too close to total memory to assume a safe fit. |

Sources: [Qwen3.5 package](https://ollama.com/library/qwen3.5:122b-a10b-q4_K_M),
[Qwen3.8 packages](https://ollama.com/library/qwen3.8/tags),
[Flash-Next packages](https://ollama.com/library/qwen3.8-flash-next/tags),
[Qwen's Flash-Next model card](https://huggingface.co/Qwen/Qwen3.8-Flash-Next).
Download sizes exclude context buffers and runtime allocations. Flash-Next's
125B language model also has 51B n-gram embeddings; the parameter label alone
understates its memory needs. The smaller 105 GB Ollama NVFP4 package is marked
MLX, so it is not an NVIDIA Linux deployment candidate.

## Access and preflight

On the GX10, `whoami` gives the Linux login. If using Tailscale SSH, enable it on
that host with `sudo tailscale set --ssh`, then connect from the authenticated Mac
with `tailscale ssh USER@HOST`. Tailnet policy must permit the connection; a
Tailscale IP by itself does not grant a Linux shell. See the
[Tailscale SSH documentation](https://tailscale.com/docs/features/tailscale-ssh).

Inspect before selecting/downloading weights:

```sh
uname -m
nvidia-smi
free -h
df -h / "$HOME"
ollama --version
ollama list
ollama ps
```

For a GB10's unified memory, `nvidia-smi` can show unsupported dedicated-memory
fields; use system available memory as well. Do not stop unrelated GPU workloads
or upgrade drivers as an inference setup shortcut. Keep model service ports on
loopback and use SSH forwarding when accessing them from the Mac.

## Two different tests

The first diagnostic bypasses retrieval and gives each model the same original
31 JPEG samples, in source time order, from the existing 30-second breakfast
excerpt. Only questions and timestamped pixels reach the model. The video's
title, creator, and expected answers stay out of inference. Audio is excluded.

```sh
python scripts/evaluate_vision.py /path/to/breakfast-pov.mp4 \
  docs/evaluations/daylife-pov-plan.json \
  --model qwen3.5:122b-a10b-q4_K_M \
  --output data/gx10-122b-pixels
```

Use a new output directory for each model/settings combination. `--prepare-only`
writes the exact frame manifest without contacting a model. `--think` enables a
separate reasoning experiment; record it as a changed condition. The runner
checks the source hash, refuses an existing output directory or excess frames,
saves raw responses/timings/runtime metadata, and flags invalid citations or
truncated output. It does **not** treat valid citations as factual correctness.

The second test uses `scripts/evaluate_video.py` to ingest into a fresh workspace
with the selected larger model for both captions and recall. Keep the existing
ASR and retrieval settings fixed. This measures the full pipeline separately
from the ordered-frame diagnostic. Reusing old 3B captions would measure only
answer-model replacement. Review the same seven acceptance criteria against
source frames, retaining failed and partial answers.

The existing 3B pipeline scored 1/7 on this excerpt. A future 31-frame diagnostic
score is not directly comparable to that three-retrieved-frame pipeline score.
Neither a download nor a passing mock test establishes real GX10 accuracy.

## Validation completed here

- Prepared and hashed all 31 chronological frames from the existing clip.
- Verified rejection of excess frames, nonfinite sampling rates, and overwrites.
- Mocked HTTP tests verify criteria remain withheld and truncated output is
  flagged. Full backend suite: 47 passed, two existing dependency warnings.
- Model downloads, GPU inference, and manual grading on the GX10 are pending
  authenticated shell access.
