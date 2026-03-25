"""
tests/test_generate_from_prompt.py – regression tests for POST /v1/campaigns/generate-from-prompt.

All tests mock GeminiClient so no real API calls are made.
Covers: successful generation, schedule-optional path, missing required fields (422).
"""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.gemini_client import get_gemini_client
from app.services.cache import campaign_cache


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clear_overrides_and_cache():
    """Reset dependency overrides and cache after every test."""
    campaign_cache.clear()
    yield
    app.dependency_overrides.clear()
    campaign_cache.clear()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


# ── Mock helpers ──────────────────────────────────────────────────────────────

_PARSED_CAMPAIGN: dict[str, Any] = {
    "needs_clarification": False,
    "campaign": {
        "campaign_name": "Test Campaign",
        "brand_name": "TestBrand",
        "voice_guidelines": "Professional and friendly.",
        "banned_phrases": [],
        "required_phrases": [],
        "legal_footer": "",
        "primary_kpi": "revenue",
        "target_audience": "Online shoppers aged 25-45",
        "offer": "20% off everything",
        "geo_scope": "United Kingdom",
        "language": "English",
        "number_of_emails": 1,
        "include_html": True,
        "send_window": "Next week",
    },
}

_RAPID_BATCH_EMAIL: dict[str, Any] = {
    "emails": [
        {
            "email_number": 1,
            "email_name": "Main Offer",
            "subject_lines": ["Big savings inside", "Your 20% off is waiting"],
            "preview_text_options": ["Shop all week long and save big.", "Don't miss your exclusive deal."],
            "ctas": ["Shop Now"],
            "send_timing": "Tuesday 10am — highest open rates mid-week",
            "sections": {
                "headline": "Unlock 20% Off Everything",
                "preheader": "Your exclusive discount is live — shop before it ends.",
                "intro_paragraph": "Summer's here and so are your savings. We're giving you 20% off the entire store.",
                "offer_line": "Use code SAVE20 at checkout — 20% off all products.",
                "body_bullets": [
                    "Save on hundreds of top-rated products",
                    "Free shipping on orders over £30",
                    "Easy returns, no questions asked",
                ],
                "cta_button": "Shop Now",
                "urgency_line": "Offer ends Sunday midnight — don't miss out.",
                "footer_line": "© 2025 TestBrand. Unsubscribe | Privacy Policy",
            },
        }
    ]
}


def _make_mock_client(parse_parsed: dict, rapid_parsed: dict) -> MagicMock:
    """Return a mock GeminiClient whose generate_text alternates between two canned responses."""
    mock = MagicMock()
    call_count = {"n": 0}

    def _side_effect(**kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            # Phase 0 – parse
            return {"text": "", "parsed": parse_parsed, "model": "gemini-mock", "tokens_used": 0, "latency_ms": 0}
        else:
            # Phase R – rapid batch
            return {"text": "", "parsed": rapid_parsed, "model": "gemini-mock", "tokens_used": 0, "latency_ms": 0}

    mock.generate_text.side_effect = _side_effect
    mock._model = "gemini-mock"
    return mock


# ── Tests ─────────────────────────────────────────────────────────────────────


class TestGenerateFromPrompt:
    """Regression tests covering the full generate-from-prompt path."""

    def test_returns_200_with_emails(self, client: TestClient):
        """Happy path: valid prompt → campaign with at least one email."""
        mock = _make_mock_client(_PARSED_CAMPAIGN, _RAPID_BATCH_EMAIL)
        app.dependency_overrides[get_gemini_client] = lambda: mock

        resp = client.post(
            "/v1/campaigns/generate-from-prompt",
            json={"prompt": "Run a 20% off sale for UK shoppers next week", "force_proceed": True},
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "completed"
        assert len(body["emails"]) >= 1
        assert body["emails"][0]["subject"]

    def test_without_send_window_still_works(self, client: TestClient):
        """schedule / send_window is optional – omitting it must not crash."""
        parsed_no_window = {**_PARSED_CAMPAIGN,
                            "campaign": {**_PARSED_CAMPAIGN["campaign"], "send_window": ""}}
        mock = _make_mock_client(parsed_no_window, _RAPID_BATCH_EMAIL)
        app.dependency_overrides[get_gemini_client] = lambda: mock

        resp = client.post(
            "/v1/campaigns/generate-from-prompt",
            json={"prompt": "20% off sale for UK shoppers", "force_proceed": True},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "completed"

    def test_cache_hit_skips_rapid_batch(self, client: TestClient):
        """
        The cache is keyed on the parsed CampaignRequest.
        A repeated prompt should return the same emails without a second rapid-batch Gemini call.
        We verify this by counting how many times generate_text is called across two requests:
        - First request:  2 calls (parse + rapid_batch)
        - Second request: 1 call  (parse only; rapid_batch result comes from cache)
        """
        mock = _make_mock_client(_PARSED_CAMPAIGN, _RAPID_BATCH_EMAIL)
        app.dependency_overrides[get_gemini_client] = lambda: mock

        payload = {"prompt": "20% off sale for UK shoppers cache test", "force_proceed": True}

        resp1 = client.post("/v1/campaigns/generate-from-prompt", json=payload)
        assert resp1.status_code == 200
        first_call_count = mock.generate_text.call_count  # expect 2

        # Clear side_effect first, then reset call history (reset_mock keeps side_effect=None
        # because we already set it; it only avoids resetting it when side_effect kwarg=False).
        # Set return_value to a valid parse response so the second parse succeeds.
        # The cache then intercepts after parse, so rapid_batch is NOT called.
        mock.generate_text.side_effect = None
        mock.generate_text.reset_mock()
        mock.generate_text.return_value = {
            "text": "", "parsed": _PARSED_CAMPAIGN, "model": "gemini-mock",
            "tokens_used": 0, "latency_ms": 0,
        }

        resp2 = client.post("/v1/campaigns/generate-from-prompt", json=payload)
        assert resp2.status_code == 200
        second_call_count = mock.generate_text.call_count  # expect 1 (parse only)

        assert first_call_count == 2, f"Expected 2 calls on first request, got {first_call_count}"
        assert second_call_count == 1, f"Expected 1 call on cache-hit request, got {second_call_count}"
        assert resp2.json()["emails"][0]["subject"] == resp1.json()["emails"][0]["subject"]

    def test_missing_prompt_returns_422(self, client: TestClient):
        """Omitting the required `prompt` field must return 422, not 500/503."""
        resp = client.post("/v1/campaigns/generate-from-prompt", json={})
        assert resp.status_code == 422

    def test_html_content_is_populated(self, client: TestClient):
        """The generated email must have non-empty HTML when include_html is True."""
        mock = _make_mock_client(_PARSED_CAMPAIGN, _RAPID_BATCH_EMAIL)
        app.dependency_overrides[get_gemini_client] = lambda: mock

        resp = client.post(
            "/v1/campaigns/generate-from-prompt",
            json={"prompt": "20% off sale for UK shoppers html test", "force_proceed": True},
        )

        assert resp.status_code == 200, resp.text
        html = resp.json()["emails"][0]["html_content"]
        assert html.strip().lower().startswith("<!doctype html")

    def test_needs_clarification_returned_on_parse_request(self, client: TestClient):
        """When Gemini says needs_clarification, the API returns status=needs_clarification."""
        clarify_parsed = {
            "needs_clarification": True,
            "questions": [{"field": "offer", "question": "What is the discount?"}],
        }
        mock = _make_mock_client(clarify_parsed, _RAPID_BATCH_EMAIL)
        app.dependency_overrides[get_gemini_client] = lambda: mock

        resp = client.post(
            "/v1/campaigns/generate-from-prompt",
            json={"prompt": "Do a campaign", "force_proceed": False},
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "needs_clarification"
        assert len(body["questions"]) >= 1
