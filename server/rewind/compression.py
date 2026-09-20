"""Optional, audited text-only compression. Original source evidence is never modified."""

import asyncio
import concurrent.futures
import hashlib
import logging
import re
import threading
import time
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)
TTC_URL = "https://api.thetokencompany.com/v1/compress"
# Match the authenticated processing endpoint's request bounds.
_REMOTE_MAX_TEXTS = 32
_REMOTE_MAX_CHARACTERS = 80000
_LINGUA_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="rewind-compress")
_LINGUA_LOCK = threading.Lock()
_LINGUA_JOB = None
_LINGUA_MODELS = {}


@dataclass(frozen=True)
class CompressedText:
    text: str
    status: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    error: str | None = None


def deletion_only(original, output):
    """Allow whitespace normalization, but never accept reordered or invented characters."""
    source = iter(char for char in original if not char.isspace())
    return all(any(candidate == char for candidate in source) for char in output if not char.isspace())


def record(provider, event):
    recorder = getattr(provider, "record_usage", None)
    if recorder:
        try:
            recorder(event)
        except Exception:
            # Observability cannot strand the user's question; do not log source text or secrets.
            log.warning("Compression usage recording failed", exc_info=False)


def _lingua_batch(model_name, texts, rate):
    # Import/load only after explicit selection. Never place this model on the GPU.
    from llmlingua import PromptCompressor

    if model_name not in _LINGUA_MODELS:
        _LINGUA_MODELS[model_name] = PromptCompressor(
            model_name=model_name, use_llmlingua2=True, device_map="cpu"
        )
    model = _LINGUA_MODELS[model_name]
    return [
        model.compress_prompt(text, rate=rate, force_tokens=["\n", "?", "not", "never"]) for text in texts
    ]


class TextCompressor:
    def __init__(self, settings, provider):
        self.s, self.provider = settings, provider
        self.kind = getattr(settings, "compressor", "none")

    def audit(self, original, result, purpose, elapsed_ms, attempted=False):
        saved = (
            result.input_tokens - result.output_tokens
            if result.input_tokens is not None and result.output_tokens is not None
            else None
        )
        record(
            self.provider,
            {
                "stage": "compress",
                "model": "bear-2"
                if self.kind == "bear2"
                else getattr(self.s, "llmlingua_model", "llmlingua2"),
                "backend": "ttc" if self.kind == "bear2" else "cpu",
                "compressor": self.kind,
                "status": result.status,
                "prompt_tokens": result.input_tokens,
                "completion_tokens": result.output_tokens,
                "total_ms": elapsed_ms,
                "metadata": {
                    "purpose": purpose,
                    "error": result.error,
                    "request_attempted": attempted,
                    "source_sha256": hashlib.sha256(original.encode()).hexdigest(),
                    "input_characters": len(original),
                    "output_characters": len(result.text),
                    "tokens_saved": saved if result.status == "success" else 0,
                    "vendor_tokens_removed": saved,
                    "compression_ratio": result.input_tokens / result.output_tokens
                    if result.output_tokens and result.input_tokens is not None
                    else None,
                    "aggressiveness": getattr(self.s, "compressor_aggressiveness", 0.2),
                    "rate": getattr(self.s, "llmlingua_rate", 0.8) if self.kind == "llmlingua" else None,
                    "cost_usd": None if self.kind == "bear2" and attempted else 0,
                    "cost_basis": "TTC account quote per removed token; amount unavailable"
                    if self.kind == "bear2" and attempted
                    else "local CPU; cloud compressor not billed",
                    "counts_scope": "compressor tokenizer; not downstream LLM token savings",
                    "execution_location": "ttc_cloud"
                    if self.kind == "bear2"
                    else "asus"
                    if getattr(self.s, "processing_url", "")
                    else "local_cpu",
                },
            },
        )

    @staticmethod
    def validate(original, output, input_tokens, output_tokens):
        if (
            not isinstance(output, str)
            or not output.strip()
            or type(input_tokens) is not int
            or type(output_tokens) is not int
            or not 0 < output_tokens <= input_tokens
            or not deletion_only(original, output)
        ):
            raise ValueError("invalid_compressor_response")
        return CompressedText(output, "success", input_tokens, output_tokens)

    async def many(self, texts, purpose):
        if self.kind == "none" or not texts:
            return [CompressedText(text, "disabled") for text in texts]
        if self.kind == "llmlingua":
            if getattr(self.s, "processing_url", ""):
                return await self.lingua_remote(texts, purpose)
            return await self.lingua(texts, purpose)
        if self.kind != "bear2":
            return [self.fallback(text, purpose, "unknown_compressor") for text in texts]
        if not getattr(self.s, "ttc_api_key", ""):
            return [self.fallback(text, purpose, "missing_ttc_api_key") for text in texts]
        aggressiveness = getattr(self.s, "compressor_aggressiveness", 0.2)
        if not 0 < aggressiveness < 1:
            return [self.fallback(text, purpose, "invalid_aggressiveness") for text in texts]
        deadline = time.monotonic() + getattr(self.s, "compressor_timeout_s", 10)
        semaphore = asyncio.Semaphore(4)

        async def one(text):
            started, attempted = time.monotonic(), False
            result = None
            counts = (None, None)
            async with semaphore:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return self.fallback(
                        text, purpose, "compression_deadline", (time.monotonic() - started) * 1000
                    )
                try:
                    attempted = True
                    response = await asyncio.wait_for(
                        self.provider.http.post(
                            TTC_URL,
                            headers={"Authorization": "Bearer " + self.s.ttc_api_key},
                            json={
                                "model": "bear-2",
                                "input": text,
                                "compression_settings": {"aggressiveness": aggressiveness},
                            },
                            timeout=remaining,
                            follow_redirects=False,
                        ),
                        remaining,
                    )
                    response.raise_for_status()
                    data = response.json()
                    if not isinstance(data, dict):
                        raise ValueError("invalid_compressor_response")
                    counts = tuple(
                        data.get(key) if type(data.get(key)) is int and data[key] >= 0 else None
                        for key in ("original_input_tokens", "output_tokens")
                    )
                    result = self.validate(
                        text, data["output"], data["original_input_tokens"], data["output_tokens"]
                    )
                except httpx.HTTPStatusError as exc:
                    result = CompressedText(text, "fallback", error=f"ttc_http_{exc.response.status_code}")
                except (httpx.TimeoutException, TimeoutError):
                    result = CompressedText(text, "fallback", error="ttc_timeout")
                except httpx.HTTPError:
                    result = CompressedText(text, "fallback", error="ttc_network_error")
                except (ValueError, KeyError, TypeError):
                    result = CompressedText(text, "fallback", *counts, error="invalid_compressor_response")
            self.audit(text, result, purpose, (time.monotonic() - started) * 1000, attempted)
            return result

        return await asyncio.gather(*(one(text) for text in texts))

    def fallback(self, text, purpose, error, elapsed_ms=0):
        result = CompressedText(text, "fallback", error=error)
        self.audit(text, result, purpose, elapsed_ms)
        return result

    async def lingua_remote(self, texts, purpose):
        deadline = time.monotonic() + getattr(self.s, "compressor_timeout_s", 10)
        results = []
        position = 0
        stop_error = None
        while position < len(texts):
            text = texts[position]
            if len(text) > _REMOTE_MAX_CHARACTERS:
                results.append(self.fallback(text, purpose, "llmlingua_text_too_large"))
                position += 1
                continue
            remaining = deadline - time.monotonic()
            if stop_error or remaining <= 0:
                results.append(self.fallback(text, purpose, stop_error or "compression_deadline"))
                position += 1
                continue
            batch = []
            characters = 0
            while position < len(texts) and len(batch) < _REMOTE_MAX_TEXTS:
                text = texts[position]
                if characters + len(text) > _REMOTE_MAX_CHARACTERS:
                    break
                batch.append(text)
                characters += len(text)
                position += 1
            started = time.monotonic()
            remaining = deadline - started
            if remaining <= 0:
                results.extend(self.fallback(text, purpose, "compression_deadline") for text in batch)
                continue
            # Await each request before dispatching the next: ASUS has one
            # bounded CPU worker, and every batch shares this packet deadline.
            try:
                data = await asyncio.wait_for(
                    self.provider.remote(
                        "compress_text",
                        {
                            "texts": batch,
                            "rate": getattr(self.s, "llmlingua_rate", 0.8),
                            "timeout_s": remaining,
                        },
                    ),
                    remaining,
                )
                values = data["results"]
                if not isinstance(values, list) or len(values) != len(batch):
                    raise ValueError("Invalid remote compression result")
                batch_results = []
                for text, value in zip(batch, values, strict=True):
                    try:
                        if value["status"] == "success":
                            result = self.validate(
                                text, value["text"], value["input_tokens"], value["output_tokens"]
                            )
                        else:
                            error = value.get("error") or "llmlingua_remote_fallback"
                            if not isinstance(error, str) or not re.fullmatch(r"[a-z0-9_]{1,64}", error):
                                error = "llmlingua_remote_fallback"
                            result = CompressedText(text, "fallback", error=error)
                    except (KeyError, TypeError, ValueError):
                        result = CompressedText(text, "fallback", error="invalid_compressor_response")
                    batch_results.append(result)
            except TimeoutError:
                stop_error = "compression_deadline"
                batch_results = [
                    CompressedText(text, "fallback", error="llmlingua_remote_timeout") for text in batch
                ]
            except Exception:
                batch_results = [
                    CompressedText(text, "fallback", error="llmlingua_remote_unavailable") for text in batch
                ]
            for text, result in zip(batch, batch_results, strict=True):
                self.audit(text, result, purpose, (time.monotonic() - started) * 1000, True)
                # A server-side timeout can leave its shielded CPU job running.
                # Do not dispatch more work against that still-busy worker.
                if result.error in {"llmlingua_timeout", "llmlingua_cpu_busy"}:
                    stop_error = result.error
            results.extend(batch_results)
        return results

    async def lingua(self, texts, purpose):
        global _LINGUA_JOB
        started = time.monotonic()
        with _LINGUA_LOCK:
            if _LINGUA_JOB is not None and not _LINGUA_JOB.done():
                return [self.fallback(text, purpose, "llmlingua_cpu_busy") for text in texts]
            _LINGUA_JOB = _LINGUA_EXECUTOR.submit(
                _lingua_batch, self.s.llmlingua_model, texts, getattr(self.s, "llmlingua_rate", 0.8)
            )
            job = _LINGUA_JOB
        try:
            # A timed-out CPU load/inference is bounded to this one background job.
            # Later requests fail open until it finishes instead of queuing more jobs.
            values = await asyncio.wait_for(
                asyncio.shield(asyncio.wrap_future(job)), getattr(self.s, "compressor_timeout_s", 10)
            )
            results = [
                self.validate(
                    text, data["compressed_prompt"], data["origin_tokens"], data["compressed_tokens"]
                )
                for text, data in zip(texts, values, strict=True)
            ]
        except TimeoutError:
            results = [CompressedText(text, "fallback", error="llmlingua_timeout") for text in texts]
        except ImportError:
            results = [CompressedText(text, "fallback", error="llmlingua_not_installed") for text in texts]
        except Exception:
            results = [CompressedText(text, "fallback", error="llmlingua_unavailable") for text in texts]
        for text, result in zip(texts, results, strict=True):
            self.audit(text, result, purpose, (time.monotonic() - started) * 1000, True)
        return results
