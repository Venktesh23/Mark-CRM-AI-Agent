"""
app/services/gemini_client.py – wrapper around the Google Gen AI SDK.

Key design decisions
────────────────────
• Uses the new `google-genai` SDK (not the deprecated `google-generativeai`).
• Supports structured JSON outputs via `response_json_schema`.
• Retries on transient errors (5xx, connection errors) with exponential backoff.
• Never logs the API key or raw user content at DEBUG level.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional

from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
    before_sleep_log,
)

from app.config import settings

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _is_transient(exc: BaseException) -> bool:
    """Return True for errors that are safe to retry."""
    if isinstance(exc, genai_errors.APIError):
        # 429 = quota/rate-limit, 5xx = server errors
        return exc.code in {429, 500, 502, 503, 504}
    # Connection-level / timeout errors
    return isinstance(exc, (TimeoutError, ConnectionError, OSError))


# ── Client ────────────────────────────────────────────────────────────────────


class GeminiClient:
    """Thin, production-hardened wrapper around the Google Gen AI SDK."""

    def __init__(self) -> None:
        api_key = settings.gemini_api_key
        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY is not set. "
                "Please export it or add it to your .env file."
            )
        self._client = genai.Client(api_key=api_key)
        self._model = settings.gemini_model
        logger.info(
            "GeminiClient initialised",
            extra={"model": self._model},
        )

    # ── Core method (with retry decorator) ────────────────────────────────────

    def generate_text(
        self,
        prompt: str,
        *,
        system_instruction: Optional[str] = None,
        json_schema: Optional[dict] = None,
        temperature: Optional[float] = None,
        max_output_tokens: Optional[int] = None,
    ) -> dict[str, Any]:
        """
        Call Gemini and return a structured result dict.

        Parameters
        ----------
        prompt : str
            User-facing prompt content.
        system_instruction : str | None
            Optional system instruction injected at model level.
        json_schema : dict | None
            If provided, forces JSON output matching this JSON Schema.
        temperature : float | None
            Override default temperature for this call.
        max_output_tokens : int | None
            Override default max tokens.

        Returns
        -------
        dict with keys:
            text        – raw text of the response
            parsed      – parsed JSON object (if json_schema was given, else None)
            model       – model string used
            tokens_used – estimated token count (input + output)
            latency_ms  – wall-clock latency in milliseconds
        """
        return self._call_with_retry(
            prompt=prompt,
            system_instruction=system_instruction,
            json_schema=json_schema,
            temperature=temperature or settings.gemini_temperature,
            max_output_tokens=max_output_tokens or settings.gemini_max_output_tokens,
        )

    # ── Internal retry wrapper ─────────────────────────────────────────────────

    def _call_with_retry(
        self,
        prompt: str,
        system_instruction: Optional[str],
        json_schema: Optional[dict],
        temperature: float,
        max_output_tokens: int,
    ) -> dict[str, Any]:
        """Executes the API call with exponential-backoff retries."""

        @retry(
            retry=retry_if_exception(_is_transient),
            stop=stop_after_attempt(settings.gemini_retry_attempts),
            wait=wait_exponential(
                min=settings.gemini_retry_min_wait,
                max=settings.gemini_retry_max_wait,
            ),
            before_sleep=before_sleep_log(logger, logging.WARNING),
            reraise=True,
        )
        def _execute() -> dict[str, Any]:
            config_kwargs: dict[str, Any] = {
                "temperature": temperature,
                "max_output_tokens": max_output_tokens,
            }
            if system_instruction:
                config_kwargs["system_instruction"] = system_instruction
            if json_schema:
                config_kwargs["response_mime_type"] = "application/json"
                config_kwargs["response_json_schema"] = json_schema

            config = genai_types.GenerateContentConfig(**config_kwargs)

            t0 = time.perf_counter()
            response = self._client.models.generate_content(
                model=self._model,
                contents=prompt,
                config=config,
            )
            latency_ms = (time.perf_counter() - t0) * 1000

            raw_text = response.text or ""

            # Attempt to parse JSON if schema was requested
            parsed_obj: Optional[Any] = None
            if json_schema:
                try:
                    parsed_obj = json.loads(raw_text)
                except json.JSONDecodeError as exc:
                    logger.warning(
                        "Gemini returned non-JSON despite schema; attempting recovery",
                        extra={"error": str(exc)},
                    )
                    # Best-effort: attempt to extract JSON substring
                    parsed_obj = _extract_json_fallback(raw_text)

            # Token counting (best-effort; SDK may not always populate this)
            tokens_used = 0
            try:
                usage = response.usage_metadata
                if usage:
                    tokens_used = (usage.prompt_token_count or 0) + (
                        usage.candidates_token_count or 0
                    )
            except AttributeError:
                pass

            logger.debug(
                "Gemini call completed",
                extra={
                    "model": self._model,
                    "tokens_used": tokens_used,
                    "latency_ms": round(latency_ms, 1),
                    "json_mode": json_schema is not None,
                },
            )

            return {
                "text": raw_text,
                "parsed": parsed_obj,
                "model": self._model,
                "tokens_used": tokens_used,
                "latency_ms": latency_ms,
            }

        return _execute()


# ── JSON extraction fallback ───────────────────────────────────────────────────


def _extract_json_fallback(text: str) -> Optional[Any]:
    """Try to salvage a JSON object from markdown-wrapped or prefixed text."""
    import re

    # Strip ```json ... ``` fences
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", text, re.DOTALL)
    if fence_match:
        try:
            return json.loads(fence_match.group(1))
        except json.JSONDecodeError:
            pass

    # Find the first { … } block and try to parse it
    brace_match = re.search(r"(\{.*\})", text, re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group(1))
        except json.JSONDecodeError:
            pass

    # Last resort for HTML envelopes: Gemini sometimes produces almost-valid JSON
    # where the HTML value contains characters that break strict json.loads.
    # Extract the email_html value directly using a JSON-string-aware regex.
    html_match = re.search(r'"email_html"\s*:\s*"((?:[^"\\]|\\.)*)"', text, re.DOTALL)
    if html_match:
        raw_val = html_match.group(1)
        try:
            # Decode JSON string escapes by wrapping in quotes and parsing
            decoded = json.loads('"' + raw_val + '"')
            return {"email_html": decoded}
        except json.JSONDecodeError:
            # Manual fallback for common escapes
            decoded = (
                raw_val
                .replace('\\"', '"')
                .replace('\\n', '\n')
                .replace('\\r', '\r')
                .replace('\\t', '\t')
                .replace('\\\\', '\\')
            )
            return {"email_html": decoded}

    return None


# ── Module-level singleton (lazy init) ────────────────────────────────────────

_client_instance: Optional[GeminiClient] = None


def get_gemini_client() -> GeminiClient:
    """Return the shared GeminiClient singleton (created on first call)."""
    global _client_instance
    if _client_instance is None:
        _client_instance = GeminiClient()
    return _client_instance
