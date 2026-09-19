# Vision and concurrency on the GX10

2026-09-19. **The ASUS is online over Tailscale. The user-selected live target is
Qwen3.5 35B-A3B; the 122B download and old 27B experiment controller are paused.**
The 35B download is in progress and has not yet produced a measured vision result.
Speech and original-pixel OpenCLIP indexing are running on the ASUS; the phone
retains original recordings and waits for 35B readiness. See
[LIVE-PROCESSING.md](../LIVE-PROCESSING.md) for current deployment details.
The 27B results below are retained diagnostics, not the selected live runtime.
The ASUS has an NVIDIA GB10,
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

A separate user-owned llama.cpp server was tested with eight 8,192-token slots via
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
logged as `llama-resumed.log` for the resumed run. Eight slots were verified through `/slots`;
GPU utilization was verified during inference. The bundled binary reports
build `b1-391fac164` in the resumed `/props` response. Direct llama.cpp does not automatically enable Ollama's
single-slot MTP speculation, another reason to measure rather than assume speed.

`benchmark_concurrency.py` measures eight real frames per profile, then submits
a question during labeling. It records warm-up separately, complete/schema-valid
outputs, throughput and question latency. These checks do not grade factual
accuracy. The resumed results are in `data/qwen38-cuda-resumed.json`. Initial
completed profiles (one batch each, not repeated estimates):

| Label workers | Frames/minute | Question seconds | Question format/source check |
| --- | --- | --- | --- |
| 1 | 1.89 | 176.624 | Truncated, invalid JSON |
| 2 | 2.19 | 12.229 | JSON parses but invents E2–E20 sources |
| 4 | 4.04 | 17.816 | JSON parses but invents E2–E20 sources |
| 7 | 4.32 | 216.458 | No valid E1-only citation result |
| 8 | 4.83 | 47.560 | No valid E1-only citation result |

All five batches produced 8/8 complete, schema-valid frame labels. That does
not grade their content. The two fast question responses say white and invent
citations despite being given only E1; they are **not usable answer results**.
The benchmark now records valid citation IDs separately from JSON validity.
The controller requires both, and uses a 20-second limit when the serial
question baseline fails. If no profile qualifies, it retains a one-worker
full-pipeline diagnostic labeled experimental; it does not promote that profile
to the phone deployment. None of these profiles passed the question check.
Even the highest observed labeling throughput is below one frame/second. Keep at most seven
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

## Earlier large candidate and remaining work

The `qwen3.5:122b-a10b-q4_K_M` download is paused at approximately 7 GB (9%)
following the user’s selection of 35B for live processing. This 81 GB multimodal
package remains an unevaluated candidate. Download completion, successful load, accuracy and throughput are
separate checks. It has **not yet produced an inference result here**. Source:
[Ollama package](https://ollama.com/library/qwen3.5:122b-a10b-q4_K_M).

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

Validation at the time of the 27B diagnostic: **58 backend tests passed** (two existing dependency warnings), Ruff
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
scheduler was discovered. After reconnection, the revised controller
`gx10-run-queue-v2.py` was uploaded and started on the ASUS, then tightened to
reject invented question citations. `queue-status-v2.json` is its current stage;
`queue-v2.log` and stage-specific logs preserve failures. CPU-only torch,
Whisper/OpenCLIP dependencies, and the embedding model are installed. That controller is now deliberately paused (`paused_user_selected_35b`); it must
not restart the old 27B/122B workloads alongside the live 35B target. No final
performance profile is selected without reviewing source-grounded answers.
All runs use new output paths.
