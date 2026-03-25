"""
tests/test_campaigns.py – integration tests for campaign API endpoints.

These tests use FastAPI's TestClient and mock the GeminiClient to avoid
real API calls. They test routing, validation, and response shapes.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import CampaignStatus
from app.services.gemini_client import get_gemini_client


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _clear_dependency_overrides():
    """Ensure dependency overrides are reset after every test."""
    yield
    app.dependency_overrides.clear()


# ── Example payload (Christmas campaign) ──────────────────────────────────────

CHRISTMAS_PAYLOAD: dict[str, Any] = {
    "campaign_name": "Christmas Discount 2025",
    "brand": {
        "brand_name": "AcmeCorp",
        "voice_guidelines": (
            "Warm, festive, and friendly. Avoid buzzwords. "
            "Use inclusive, celebratory language."
        ),
        "banned_phrases": ["world-class", "revolutionary", "synergy"],
        "required_phrases": ["Shop now", "Limited time offer"],
        "legal_footer": "© 2025 AcmeCorp Inc. | Unsubscribe | Privacy Policy",
        "design_tokens": {
            "primary_color": "#B22222",
            "secondary_color": "#FFFFFF",
            "accent_color": "#FFD700",
            "font_family_heading": "Georgia, serif",
            "font_family_body": "Arial, sans-serif",
        },
    },
    "objective": {
        "primary_kpi": "revenue",
        "secondary_kpis": ["open_rate", "click_through_rate"],
        "target_audience": "Existing customers who purchased in the last 12 months",
        "offer": "25% off storewide for Christmas",
        "geo_scope": "United States",
        "language": "English",
    },
    "constraints": {
        "discount_ceiling": 25.0,
        "compliance_notes": "CAN-SPAM compliant. No misleading subject lines.",
        "send_window": "December 18-24, 2025",
        "exclude_segments": ["unsubscribed", "bounced"],
        "required_segments": ["active customers"],
    },
    "channels": ["email"],
    "deliverables": {
        "number_of_emails": 3,
        "include_html": True,
        "include_variants": True,
    },
}


def _make_mock_gemini_client():
    """Return a MagicMock GeminiClient that returns canned responses."""
    mock = MagicMock()
    mock._model = "gemini-2.5-flash-test"

    # Clarification: no clarification needed
    clarify_response = {
        "text": '{"needs_clarification": false, "questions": []}',
        "parsed": {"needs_clarification": False, "questions": []},
        "model": "gemini-2.5-flash-test",
        "tokens_used": 100,
        "latency_ms": 500.0,
    }

    # Research response
    research_response = {
        "text": "{}",
        "parsed": {
            "audience_insights": ["Insight 1", "Insight 2"],
            "channel_insights": ["Email open rates peak at 10am"],
            "seasonal_context": "Christmas is a high-spend period.",
            "competitive_considerations": ["Competitors also run Christmas sales."],
            "assumptions": ["ASSUMPTION: Audience checks email daily."],
        },
        "model": "gemini-2.5-flash-test",
        "tokens_used": 300,
        "latency_ms": 800.0,
    }

    # Strategy response
    strategy_response = {
        "text": "{}",
        "parsed": {
            "campaign_angle": "Celebrate the season with savings.",
            "core_narrative": "A 3-email journey from tease to close.",
            "offer_logic": "25% off drives urgency without devaluing brand.",
            "narrative_arc": ["Tease", "Announce", "Final Push"],
            "kpi_mapping": {"revenue": "Direct discount drives purchases."},
            "channel_strategy": {"email": "3 targeted emails over 7 days."},
            "risks": ["Risk: Discount fatigue | Mitigation: Keep emails concise."],
            "assumptions": ["ASSUMPTION: Audience is email-responsive."],
        },
        "model": "gemini-2.5-flash-test",
        "tokens_used": 500,
        "latency_ms": 1200.0,
    }

    # Email execution response
    email_response = {
        "text": "{}",
        "parsed": {
            "email_number": 1,
            "email_name": "Christmas Teaser",
            "subject_lines": [
                "🎄 Your Christmas gift is here",
                "25% off – just for you",
                "The holiday deals start now",
            ],
            "preview_text_options": [
                "Unwrap 25% off everything this Christmas.",
                "Your exclusive holiday discount awaits.",
            ],
            "body_text": (
                "Dear valued customer,\n\nShop now and save 25%! Limited time offer. "
                "\n\n© 2025 AcmeCorp Inc. | Unsubscribe | Privacy Policy"
            ),
            "ctas": ["Shop Now", "Claim My Deal"],
            "send_timing": "December 18 at 10:00 AM – highest open rates.",
        },
        "model": "gemini-2.5-flash-test",
        "tokens_used": 600,
        "latency_ms": 1500.0,
    }

    # Production (HTML) response – orchestrator reads result["text"] directly now
    html_response = {
        "text": "<!DOCTYPE html><html><body>Test HTML</body></html>",
        "parsed": None,
        "model": "gemini-2.5-flash-test",
        "tokens_used": 1000,
        "latency_ms": 2000.0,
    }

    # Critique response
    critique_response = {
        "text": "{}",
        "parsed": {
            "issues": [],
            "fixes": [],
            "risk_flags": [],
            "llm_commentary": "Campaign looks solid overall.",
            "score": 88,
        },
        "model": "gemini-2.5-flash-test",
        "tokens_used": 400,
        "latency_ms": 800.0,
    }

    # Wire up the side effects in order (Clarify, Research, Strategy, 3x Email, 3x HTML, Critique)
    mock.generate_text.side_effect = [
        clarify_response,     # Phase 1: Clarify
        research_response,    # Phase 2: Research
        strategy_response,    # Phase 3: Strategy
        email_response,       # Phase 4: Email 1
        email_response,       # Phase 4: Email 2
        email_response,       # Phase 4: Email 3
        html_response,        # Phase 5: HTML 1
        html_response,        # Phase 5: HTML 2
        html_response,        # Phase 5: HTML 3
        critique_response,    # Phase 6: Critique
    ]
    return mock


# ── Validation endpoint tests ─────────────────────────────────────────────────


class TestValidateEndpoint:
    def test_valid_request(self, client):
        resp = client.post("/v1/campaigns/validate", json=CHRISTMAS_PAYLOAD)
        assert resp.status_code == 200
        data = resp.json()
        assert "valid" in data
        assert "issues" in data
        assert "recommendations" in data

    def test_valid_payload_has_no_errors(self, client):
        resp = client.post("/v1/campaigns/validate", json=CHRISTMAS_PAYLOAD)
        assert resp.status_code == 200
        data = resp.json()
        errors = [i for i in data["issues"] if i["severity"] == "error"]
        assert not errors

    def test_incomplete_request_returns_issues(self, client):
        bad_payload = dict(CHRISTMAS_PAYLOAD)
        bad_payload = {**CHRISTMAS_PAYLOAD}
        bad_payload["objective"] = {
            **CHRISTMAS_PAYLOAD["objective"],
            "offer": "X",  # Too short
        }
        resp = client.post("/v1/campaigns/validate", json=bad_payload)
        assert resp.status_code == 200
        data = resp.json()
        assert not data["valid"]
        assert data["issues"]


# ── Generate endpoint tests ───────────────────────────────────────────────────


class TestGenerateEndpoint:
    def test_generate_returns_200(self, client):
        mock_client = _make_mock_gemini_client()
        app.dependency_overrides[get_gemini_client] = lambda: mock_client
        resp = client.post("/v1/campaigns/generate", json=CHRISTMAS_PAYLOAD)
        assert resp.status_code == 200

    def test_generate_response_shape(self, client):
        mock_client = _make_mock_gemini_client()
        app.dependency_overrides[get_gemini_client] = lambda: mock_client
        resp = client.post("/v1/campaigns/generate", json=CHRISTMAS_PAYLOAD)
        data = resp.json()
        assert "status" in data
        assert data["status"] == CampaignStatus.COMPLETED.value
        assert "blueprint" in data
        assert "assets" in data
        assert "critique" in data
        assert "metadata" in data

    def test_generate_returns_correct_number_of_emails(self, client):
        mock_client = _make_mock_gemini_client()
        app.dependency_overrides[get_gemini_client] = lambda: mock_client
        resp = client.post("/v1/campaigns/generate", json=CHRISTMAS_PAYLOAD)
        data = resp.json()
        assert len(data["assets"]) == 3

    def test_generate_assets_have_required_fields(self, client):
        mock_client = _make_mock_gemini_client()
        app.dependency_overrides[get_gemini_client] = lambda: mock_client
        resp = client.post("/v1/campaigns/generate", json=CHRISTMAS_PAYLOAD)
        data = resp.json()
        for asset in data["assets"]:
            assert "subject_lines" in asset
            assert "preview_text_options" in asset
            assert "body_text" in asset
            assert "ctas" in asset
            assert "send_timing" in asset

    def test_generate_blueprint_fields(self, client):
        mock_client = _make_mock_gemini_client()
        app.dependency_overrides[get_gemini_client] = lambda: mock_client
        resp = client.post("/v1/campaigns/generate", json=CHRISTMAS_PAYLOAD)
        blueprint = resp.json()["blueprint"]
        assert "campaign_angle" in blueprint
        assert "narrative_arc" in blueprint
        assert "kpi_mapping" in blueprint

    def test_generate_metadata_present(self, client):
        mock_client = _make_mock_gemini_client()
        app.dependency_overrides[get_gemini_client] = lambda: mock_client
        resp = client.post("/v1/campaigns/generate", json=CHRISTMAS_PAYLOAD)
        metadata = resp.json()["metadata"]
        assert "request_id" in metadata
        assert "model_used" in metadata
        assert "timings" in metadata

    def test_generate_returns_request_id_header(self, client):
        mock_client = _make_mock_gemini_client()
        app.dependency_overrides[get_gemini_client] = lambda: mock_client
        resp = client.post("/v1/campaigns/generate", json=CHRISTMAS_PAYLOAD)
        assert "x-request-id" in resp.headers

    def test_generate_with_invalid_discount_returns_422(self, client):
        bad_payload = {
            **CHRISTMAS_PAYLOAD,
            "objective": {
                **CHRISTMAS_PAYLOAD["objective"],
                "offer": "50% off everything",  # Exceeds 25% ceiling
            },
            "constraints": {
                **CHRISTMAS_PAYLOAD["constraints"],
                "discount_ceiling": 25.0,
            },
        }
        app.dependency_overrides[get_gemini_client] = lambda: MagicMock()
        resp = client.post("/v1/campaigns/generate", json=bad_payload)
        assert resp.status_code == 422

    def test_generate_clarification_response(self, client):
        """If LLM says needs_clarification=true, return that status."""
        mock_client = MagicMock()
        mock_client._model = "gemini-2.5-flash-test"
        mock_client.generate_text.return_value = {
            "text": "{}",
            "parsed": {
                "needs_clarification": True,
                "questions": [
                    {
                        "field": "objective.offer",
                        "question": "What exact discount are you offering?",
                        "why_needed": "Required for copy generation.",
                    }
                ],
            },
            "model": "gemini-2.5-flash-test",
            "tokens_used": 50,
            "latency_ms": 200.0,
        }
        app.dependency_overrides[get_gemini_client] = lambda: mock_client
        # Use a minimal request that could trigger clarification
        resp = client.post("/v1/campaigns/generate", json=CHRISTMAS_PAYLOAD)
        data = resp.json()
        assert data["status"] == CampaignStatus.NEEDS_CLARIFICATION.value
        assert len(data["clarification_questions"]) >= 1

    def test_missing_required_fields_returns_422(self, client):
        app.dependency_overrides[get_gemini_client] = lambda: MagicMock()
        resp = client.post("/v1/campaigns/generate", json={})
        assert resp.status_code == 422
