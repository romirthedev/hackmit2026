# Vision and concurrency on the GX10

2026-09-19. Tailscale SSH access was established. **Later in this session the
ASUS stopped responding to SSH and Tailscale pings; final GPU measurements and
full-pipeline deployment are blocked until it reconnects.** The ASUS has an NVIDIA GB10,
121 GiB of unified memory (117 GiB initially available), Linux ARM64, CUDA 13.0,
and driver 580.159.03. Initial disk headroom was 793 GB. Services used here bind
loopback; the Mac uses a separate userspace Tailscale client without changing
its default route or DNS. The existing system Ollama service is preserved.

## Actual model diagnostic

The existing `qwen3.8:latest` is a 27.3B Q4_K_M vision model (17.7 GB including
projector). Seven questions were run against all 31 original chronological
JPEGs from the 30-second public breakfast-workday excerpt. This bypasses
retrieval and captions, excludes audio, and withholds the video title and
acceptance criteria. Source hash:
`03b82f243750de109ca56856313f65ef109c4be8ee604caffb801bd92bdabfe5`.

With corrected image transport, reasoning disabled, 32K context and a 2,048-token
output cap, the seven calls took **169.89 seconds total, 24.27 seconds on average**.
Manual review against source pixels:

| Question | Observation |
| --- | --- |
| Food being prepared | Recognized sandwich/buns/cheese, but added unsupported condiment/ingredient-action details. Fails strict criterion. |
| Bottle placement | Broad shelf/holder location correct; omitted requested horizontal/right-side detail. Partial. |
| Cap and cheese colors | Red and yellow: supported. |
| Bottle before or after cheese | Before: supported. |
| Utensil at warmer | Gloved hands is supported; the original tongs expectation was a reviewer error. Excluded from frozen-criterion score. |
| Keys | Correctly abstained from establishing a location. |
| Shift start | Correctly abstained from inventing a time. |

This gives **4/6 on the remaining original criteria**. The old 3B full pipeline
has 1/6 after excluding the invalid utensil criterion. These are **different
experiments**, not a controlled model-only improvement: input count, selection,
transport and runtime differ. See the explicit [post-inference erratum](daylife-pov-erratum.json).
The frozen plan and all raw responses remain intact. No Astra API evaluation
has been run; no API key was supplied.

Raw corrected outputs are in remote `data/qwen38-pixels-fixed/results.json` and
the Mac's ignored `data/gx10-results/qwen38-fixed.json`.

## A reproduced image transport failure

On Ollama 0.32.15 with this Qwen model, two equal-sized color images in one user
message produced the same 307 prompt tokens as one image, and the model only
reported the first color. Reversing the images reversed the reported color.
Putting the **unchanged originals in separate user messages** produced 574
prompt tokens and both colors. Unequal dimensions also avoided the problem,
but the application fix does not resize or alter evidence.

This matches [Ollama issue #17814](https://github.com/ollama/ollama/issues/17814).
The adapter and evaluation runner now send one original per image turn, with
question/context supplied after those turns. The earlier defective run is
preserved and marked invalidated. Probe JSON is under ignored
`data/gx10-results/image-transport*.json`.

## Real concurrency, not just more queued requests

Ollama 0.32.15 logs that `qwen35` does not support parallel requests and launches
one slot even with `OLLAMA_NUM_PARALLEL=8`. The restriction also appears in the
[0.34.2 scheduler](https://github.com/ollama/ollama/blob/v0.34.2/server/sched.go).
In the original serial-runtime probe, raising client concurrency from 1 to 2
changed throughput from 3.05 to 3.13 frames/minute, while question latency rose
from 6.28 to 20.90 seconds. Both batches had one truncated repetitive label out
of eight. This is evidence of queuing, not effective parallel decoding.

A separate user-owned llama.cpp server now exposes eight 8,192-token slots via
its native chat-completions API. CUDA must be explicitly discoverable in this
Ollama distribution:

```sh
export LD_LIBRARY_PATH=/usr/local/lib/ollama:/usr/local/lib/ollama/cuda_v13
export GGML_BACKEND_PATH=/usr/local/lib/ollama/cuda_v13/libggml-cuda.so
/usr/local/lib/ollama/llama-server --list-devices
# Must list CUDA0: NVIDIA GB10 before a GPU benchmark.
```

The test uses `--parallel 8 --ctx-size 65536 --gpu-layers all --flash-attn on`,
original model/projector files, no thinking, and disabled prompt/checkpoint
caches. The initial direct-server CPU fallback was stopped before completing
a measured batch; it is not a GPU result. The corrected server is separately
logged as `llama-cuda-parallel.log`. Eight slots were verified through `/slots`;
GPU utilization was verified during inference. The bundled binary reports
commit `9d77fa172`. Direct llama.cpp does not automatically enable Ollama's
single-slot MTP speculation, another reason to measure rather than assume speed.

`benchmark_concurrency.py` measures eight real frames per profile, then submits
a question during labeling. It records warm-up separately, complete/schema-valid
outputs, throughput and question latency. These checks do not grade factual
accuracy. Pending measured profiles: 1, 2, 4, 7 and 8 workers. Keep at most seven
label workers with an eight-slot server when reserving question capacity.

The frame prompt now limits repeated object entries and asks for concise
summaries. Slow jobs renew their durable leases; another worker must not claim
an active job just because inference takes longer than the original lease.

## Runtime settings

```dotenv
REWIND_PROVIDER=ollama
REWIND_LOCAL_INFERENCE_API=llamacpp
REWIND_OLLAMA_URL=http://127.0.0.1:11436
REWIND_OLLAMA_EMBEDDING_URL=http://127.0.0.1:11434
REWIND_VISION_MODEL=qwen3.8:latest
REWIND_REASONING_MODEL=qwen3.8:latest
REWIND_OLLAMA_CONTEXT=8192
REWIND_OLLAMA_RECALL_CONTEXT=8192
REWIND_OLLAMA_TIMEOUT=900
REWIND_RECALL_MAX_IMAGES=8
# Set REWIND_WORKERS from measured results, not the maximum by default.
```

`ollama` remains the default API; `llamacpp` selects its native local chat API.
Both label and recall endpoints use that selected API. Optional recall URL/model
settings route questions separately. Embeddings continue to use the Ollama
embedding endpoint. llama.cpp context capacity is configured at server launch.
Run one API process; internal workers share a durable SQLite queue.

## Large candidate and remaining work

`qwen3.5:122b-a10b-q4_K_M` was downloading at last contact: an 81 GB multimodal package with more
plausible headroom than filling all 128 GB with weights. At last contact about 6.8 GB had downloaded, with several hours remaining at
the observed transfer rate. The current remote state is unknown after the
connection dropped. Download completion, successful load, accuracy and
throughput are separate checks. It has **not yet
produced an inference result here**. Source: [Ollama package](https://ollama.com/library/qwen3.5:122b-a10b-q4_K_M).

Newer does not guarantee better results. Qwen3.8-Flash-Next's Ollama Q4 package
is 120 GB; its smaller NVFP4 listing is MLX, not Linux CUDA. A community IQ4_XS
GGUF is about 94 GB plus projector and may be another candidate, but has not
been loaded or evaluated. See [Qwen's model card](https://huggingface.co/Qwen/Qwen3.8-Flash-Next),
[Ollama tags](https://ollama.com/library/qwen3.8-flash-next/tags), and
[Unsloth's package](https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF).
No model is declared the best based on size or published benchmarks alone.

Full-pipeline runs must ingest into new workspaces with fresh captions, audio
and visual retrieval. Old 3B captions must not be reused as a larger-model
pipeline score. The runner supports both local APIs, selectable worker count,
separate embeddings and source-code hashes even in a copied tree without Git.
The 31-frame diagnostic additionally verifies sufficient per-slot context on
llama.cpp. Use new output paths; raw failures remain reviewable.

Validation: **52 backend tests pass** (two existing dependency warnings), Ruff
passes, and no whitespace errors. Tests cover image ordering, withheld grading
criteria, truncated output, recall routing, both local wire formats, and lease
renewal during a slow job. These tests do not substitute for hardware results.

The reusable foreground launcher is `scripts/serve_vision.py`. It reuses an
existing Ollama model store, verifies CUDA discovery, refuses CPU fallback,
records the runtime/model manifest, and exposes only loopback. Example:

```sh
python scripts/serve_vision.py --model qwen3.8:latest \
  --models-dir /usr/share/ollama/.ollama/models \
  --runtime-dir /usr/local/lib/ollama --slots 8 --context 8192 \
  --report data/launch-qwen38.json
```

The initial Ollama controller was deliberately stopped when its serial-only
scheduler was discovered. Its stale status file is not evidence that an
automatic large-model evaluation is still queued. A revised controller is
prepared locally under ignored `data/gx10-run-queue-v2.py`, but was **not
uploaded or started before the outage**. The native CUDA benchmark, CPU-only
indexing dependency install and downloads were launched detached; their current
state must be checked after reconnecting.
