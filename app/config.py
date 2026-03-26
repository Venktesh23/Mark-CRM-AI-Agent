"""
app/config.py – application settings loaded from environment variables.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Gemini ────────────────────────────────────────────────────────────────
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_max_output_tokens: int = 8192
    gemini_temperature: float = 0.4

    # ── Retry ─────────────────────────────────────────────────────────────────
    gemini_retry_attempts: int = 4
    gemini_retry_min_wait: float = 1.0
    gemini_retry_max_wait: float = 30.0

    # ── App ───────────────────────────────────────────────────────────────────
    app_name: str = "Mark – AI Campaign Generator"
    app_version: str = "1.0.0"
    # ── Email / SendGrid ──────────────────────────────────────────────────────
    sendgrid_api_key: str = ""
    email_from: str = ""
    email_reply_to: str = ""
    # ── Supabase auth / JWT verification ─────────────────────────────────────
    supabase_url: str = ""
    supabase_anon_key: str = ""
    auth_required: bool = True
    auth_jwks_cache_seconds: int = 300
    # ── Agent persistence store ───────────────────────────────────────────────
    agent_store_path: str = "data/agent_store.db"

settings = Settings()
