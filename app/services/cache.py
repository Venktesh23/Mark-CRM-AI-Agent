"""
app/services/cache.py – simple in-memory TTL cache for campaign responses.

Keyed by a SHA-256 hash of the serialised CampaignRequest. Entries expire
after `ttl_seconds` (default 15 minutes). No external dependencies required.
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any, Optional


class TTLCache:
    """Minimal in-memory key/value store with per-entry TTL."""

    def __init__(self, ttl_seconds: int = 900) -> None:
        self._store: dict[str, tuple[Any, float]] = {}
        self._ttl = ttl_seconds

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _hash(data: Any) -> str:
        raw = json.dumps(data, sort_keys=True, default=str)
        return hashlib.sha256(raw.encode()).hexdigest()

    # ── Public API ────────────────────────────────────────────────────────────

    def get(self, key_data: Any) -> Optional[Any]:
        """Return cached value or None (also removes expired entries)."""
        key = self._hash(key_data)
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.monotonic() > expires_at:
            del self._store[key]
            return None
        return value

    def set(self, key_data: Any, value: Any) -> None:
        """Store a value with the configured TTL."""
        key = self._hash(key_data)
        self._store[key] = (value, time.monotonic() + self._ttl)

    def clear(self) -> None:
        self._store.clear()

    def __len__(self) -> int:
        return len(self._store)


# Module-level singleton – shared across all requests in a process.
campaign_cache = TTLCache(ttl_seconds=900)
