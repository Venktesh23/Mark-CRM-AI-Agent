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
from app.services.gemini_client import get_gemini_client, get_optional_gemini_client


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


class TestP0Endpoints:
    def test_compliance_assistant_checks_subject_and_body(self, client):
        payload = {
            "emails": [
                {
                    "id": "email-1",
                    "subject": "BUY NOW!!! free money for everyone",
                    "html_content": "<html><body>Hello friend</body></html>",
                }
            ],
            "banned_phrases": ["free money"],
            "required_phrases": ["limited time"],
            "legal_footer": "© 2026 Example Inc. | Unsubscribe | Privacy",
        }
        resp = client.post("/v1/campaigns/compliance-assistant", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["passed"] is False
        assert len(data["emails"]) == 1
        email = data["emails"][0]
        assert any("Banned phrase" in flag for flag in email["risk_flags"])
        assert any("SUBJECT SPAM RISK" in flag for flag in email["risk_flags"])
        assert any("Required phrase" in issue for issue in email["issues"])

    def test_performance_copilot_fallback_uses_sent_count(self, client):
        mock_client = MagicMock()
        mock_client.generate_text.side_effect = RuntimeError("upstream error")
        app.dependency_overrides[get_gemini_client] = lambda: mock_client
        payload = {
            "campaign_name": "Spring Promo",
            "prompt": "Send spring offer",
            "sent_count": 10,
            "failed_count": 4,
        }
        resp = client.post("/v1/campaigns/performance-copilot", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert "Delivered 10 emails with 4 failures" in data["summary"]


class TestP1Endpoints:
    def test_smart_brief_returns_structured_brief(self, client):
        mock_client = MagicMock()
        mock_client.generate_text.return_value = {
            "parsed": {
                "brief": {
                    "campaign_name": "Spring Promo",
                    "objective": "Boost seasonal conversions",
                    "target_audience": "Members in Sweden",
                    "offer": "20% discount",
                    "primary_kpi": "conversion_rate",
                    "geo_scope": "Sweden",
                    "language": "English",
                    "tone": "Friendly and practical",
                    "compliance_notes": "Include unsubscribe footer",
                    "send_window": "Next week",
                    "number_of_emails": 3,
                    "key_points": ["Clear value", "Urgency"],
                    "assumptions": ["ASSUMPTION: Users prefer morning sends"],
                },
                "questions": ["Should VIP members get a separate variant?"],
            }
        }
        app.dependency_overrides[get_optional_gemini_client] = lambda: mock_client
        resp = client.post("/v1/campaigns/smart-brief", json={"prompt": "Create spring campaign"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["brief"]["campaign_name"] == "Spring Promo"
        assert data["brief"]["number_of_emails"] == 3
        assert data["questions"]

    def test_discover_segments_returns_seeded_segments(self, client):
        mock_client = MagicMock()
        mock_client.generate_text.return_value = {
            "parsed": {
                "segments": [
                    {"name": "Loyal Nordics", "description": "Long-term members in Nordics", "recommended_for": "Retention"},
                    {"name": "Stockholm Active", "description": "Active contacts in Stockholm", "recommended_for": "Local events"},
                ],
                "reasoning": "Grouped by membership and location signals.",
            }
        }
        app.dependency_overrides[get_optional_gemini_client] = lambda: mock_client
        csv_data = (
            "firstname,lastname,email,age,membership_level,membership_startdate,city,country\n"
            "A,One,a@example.com,31,Gold,2021-01-01,Stockholm,Sweden\n"
            "B,Two,b@example.com,28,Gold,2022-02-01,Stockholm,Sweden\n"
            "C,Three,c@example.com,44,Silver,2020-03-03,Gothenburg,Sweden\n"
        )
        resp = client.post(
            "/v1/campaigns/discover-segments",
            json={"contacts_csv": csv_data, "max_segments": 6, "campaign_prompt": "Retention push"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["segments"]
        assert data["segments"][0]["id"] == "cluster_all"
        assert any(seg["emails"] for seg in data["segments"])

    def test_optimize_send_times_returns_suggestions(self, client):
        mock_client = MagicMock()
        mock_client.generate_text.return_value = {
            "parsed": {
                "adjustments": [
                    {"email_id": "email-1", "recommended_hour_local": 11, "rationale": "Best for professionals."}
                ],
                "global_reasoning": "Balanced by timezone and segment behavior.",
            }
        }
        app.dependency_overrides[get_optional_gemini_client] = lambda: mock_client
        csv_data = (
            "firstname,lastname,email,age,membership_level,membership_startdate,city,country\n"
            "A,One,a@example.com,31,Gold,2021-01-01,Stockholm,Sweden\n"
        )
        payload = {
            "contacts_csv": csv_data,
            "campaign_prompt": "B2B upsell",
            "emails": [{"email_id": "email-1", "subject": "Offer", "target_group": "Working professionals", "recipient_count": 25}],
        }
        resp = client.post("/v1/campaigns/optimize-send-times", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["suggestions"]
        assert data["suggestions"][0]["email_id"] == "email-1"
        assert 0 <= data["suggestions"][0]["recommended_hour_local"] <= 23

    def test_p1_endpoints_work_when_gemini_unavailable(self, client):
        app.dependency_overrides[get_optional_gemini_client] = lambda: None
        csv_data = (
            "firstname,lastname,email,age,membership_level,membership_startdate,city,country\n"
            "A,One,a@example.com,31,Gold,2021-01-01,Stockholm,Sweden\n"
            "B,Two,b@example.com,28,Gold,2022-02-01,Stockholm,Sweden\n"
        )

        brief_resp = client.post("/v1/campaigns/smart-brief", json={"prompt": "Create campaign"})
        assert brief_resp.status_code == 200
        assert brief_resp.json()["brief"]["campaign_name"]

        seg_resp = client.post(
            "/v1/campaigns/discover-segments",
            json={"contacts_csv": csv_data, "max_segments": 5, "campaign_prompt": "Retention"},
        )
        assert seg_resp.status_code == 200
        assert seg_resp.json()["segments"]

        send_time_resp = client.post(
            "/v1/campaigns/optimize-send-times",
            json={
                "contacts_csv": csv_data,
                "emails": [{"email_id": "email-1", "target_group": "professionals", "subject": "Offer", "recipient_count": 2}],
            },
        )
        assert send_time_resp.status_code == 200
        assert send_time_resp.json()["suggestions"]


class TestP2Endpoints:
    def test_voice_train_returns_profile(self, client):
        mock_client = MagicMock()
        mock_client.generate_text.return_value = {
            "parsed": {
                "profile": {
                    "style_summary": "Clear, practical, customer-first tone.",
                    "do_list": ["Lead with value", "Use concrete examples"],
                    "dont_list": ["Avoid hype"],
                    "vocabulary": ["clarity", "value", "members"],
                    "sample_lines": ["Members save more with clear next steps."],
                    "confidence": 84,
                },
                "reasoning": "Trained from approved campaign snippets.",
            }
        }
        app.dependency_overrides[get_optional_gemini_client] = lambda: mock_client
        resp = client.post(
            "/v1/campaigns/voice-train",
            json={
                "brand_name": "Acme",
                "current_voice": "Professional and friendly",
                "campaign_examples": ["Spring promo for loyal members"],
                "approved_html_samples": ["<html><body>Save now</body></html>"],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["profile"]["style_summary"]
        assert 0 <= data["profile"]["confidence"] <= 100

    def test_localize_campaign_returns_email_variants(self, client):
        mock_client = MagicMock()
        mock_client.generate_text.return_value = {
            "parsed": {
                "emails": [
                    {
                        "id": "email-1",
                        "subject": "Oferta de primavera",
                        "html_content": "<html><body>Oferta localizada</body></html>",
                        "notes": "Localized to ES",
                    }
                ],
                "reasoning": "Localized with regional context.",
            }
        }
        app.dependency_overrides[get_optional_gemini_client] = lambda: mock_client
        resp = client.post(
            "/v1/campaigns/localize-campaign",
            json={
                "language": "Spanish",
                "region": "Spain",
                "brand_voice": "Friendly",
                "emails": [
                    {
                        "id": "email-1",
                        "subject": "Spring Offer",
                        "html_content": "<html><body>Spring offer</body></html>",
                        "target_group": "Members",
                    }
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["emails"]
        assert data["emails"][0]["id"] == "email-1"
        assert data["emails"][0]["subject"]

    def test_repurpose_content_returns_assets(self, client):
        mock_client = MagicMock()
        mock_client.generate_text.return_value = {
            "parsed": {
                "assets": [
                    {
                        "channel": "social_post",
                        "title": "Launch Post",
                        "body": "Short social teaser for the campaign.",
                        "cta": "Learn more",
                    },
                    {
                        "channel": "sms",
                        "title": "SMS Variant",
                        "body": "Limited-time offer for members.",
                        "cta": "Shop now",
                    },
                ],
                "reasoning": "Repurposed for short-form channels.",
            }
        }
        app.dependency_overrides[get_optional_gemini_client] = lambda: mock_client
        resp = client.post(
            "/v1/campaigns/repurpose-content",
            json={
                "campaign_name": "Spring Campaign",
                "objective": "Drive conversions",
                "channels": ["social_post", "sms"],
                "emails": [
                    {
                        "id": "email-1",
                        "subject": "Spring Offer",
                        "html_content": "<html><body>Offer details</body></html>",
                        "target_group": "Members",
                    }
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["assets"]) >= 2
        assert all(asset["channel"] for asset in data["assets"])

    def test_p2_endpoints_work_when_gemini_unavailable(self, client):
        app.dependency_overrides[get_optional_gemini_client] = lambda: None

        voice_resp = client.post(
            "/v1/campaigns/voice-train",
            json={"brand_name": "Acme", "current_voice": "Professional", "campaign_examples": [], "approved_html_samples": []},
        )
        assert voice_resp.status_code == 200
        assert voice_resp.json()["profile"]["style_summary"]

        localize_resp = client.post(
            "/v1/campaigns/localize-campaign",
            json={
                "language": "French",
                "emails": [{"id": "email-1", "subject": "Offer", "html_content": "<html><body>Offer</body></html>"}],
            },
        )
        assert localize_resp.status_code == 200
        assert localize_resp.json()["emails"][0]["subject"]

        repurpose_resp = client.post(
            "/v1/campaigns/repurpose-content",
            json={
                "campaign_name": "Any Campaign",
                "objective": "Engagement",
                "channels": ["social_post"],
                "emails": [{"id": "email-1", "subject": "Offer", "html_content": "<html><body>Offer</body></html>"}],
            },
        )
        assert repurpose_resp.status_code == 200
        assert repurpose_resp.json()["assets"]


class TestGrowthUpgrades:
    def test_record_and_retrieve_memory(self, client):
        record_resp = client.post(
            "/v1/campaigns/record-outcome",
            json={
                "campaign_name": "Spring",
                "prompt": "Spring retention",
                "audience": "Loyal members",
                "subject": "Spring savings for members",
                "cta": "Claim offer",
                "open_rate": 0.42,
                "click_rate": 0.15,
                "conversion_rate": 0.06,
                "segment": "Gold",
            },
        )
        assert record_resp.status_code == 200
        assert record_resp.json()["stored"] is True

        memory_resp = client.post(
            "/v1/campaigns/retrieve-memory",
            json={"prompt": "member retention offer", "audience": "members", "objective": "retention", "limit": 3},
        )
        assert memory_resp.status_code == 200
        data = memory_resp.json()
        assert data["snippets"]
        assert "score=" in data["snippets"][0]["snippet"]

    def test_experiment_lifecycle_and_winner(self, client):
        start_resp = client.post(
            "/v1/campaigns/experiments/start",
            json={
                "experiment_name": "Subject Test",
                "metric": "click_rate",
                "variants": ["A subject", "B subject"],
            },
        )
        assert start_resp.status_code == 200
        experiment_id = start_resp.json()["experiment_id"]

        rec_a = client.post(
            "/v1/campaigns/experiments/record",
            json={
                "experiment_id": experiment_id,
                "variant": "A subject",
                "impressions": 100,
                "clicks": 18,
                "conversions": 7,
            },
        )
        assert rec_a.status_code == 200

        rec_b = client.post(
            "/v1/campaigns/experiments/record",
            json={
                "experiment_id": experiment_id,
                "variant": "B subject",
                "impressions": 100,
                "clicks": 9,
                "conversions": 3,
            },
        )
        assert rec_b.status_code == 200
        assert rec_b.json()["winner"] == "A subject"
        assert rec_b.json()["completed"] is True

    def test_orchestrate_growth_loop_returns_compound_insights(self, client):
        app.dependency_overrides[get_optional_gemini_client] = lambda: None
        client.post(
            "/v1/campaigns/record-outcome",
            json={
                "campaign_name": "Baseline",
                "prompt": "Loyal members campaign",
                "audience": "Loyal members",
                "subject": "Welcome back members",
                "cta": "Explore now",
                "click_rate": 0.12,
            },
        )
        resp = client.post(
            "/v1/campaigns/orchestrate-growth-loop",
            json={
                "campaign_name": "Growth Loop",
                "prompt": "Retention + upsell",
                "audience": "Loyal members",
                "objective": "Increase conversion",
                "offer": "20% off",
                "contacts_csv": "firstname,lastname,email,city,country\nA,One,a@example.com,Stockholm,Sweden\n",
                "emails": [
                    {
                        "id": "email-1",
                        "subject": "20% off for loyal members",
                        "target_group": "Loyal members",
                        "html_content": "<html><body><a href='https://example.com'>Claim now</a></body></html>",
                        "recipient_count": 30,
                    }
                ],
                "banned_phrases": [],
                "required_phrases": [],
                "legal_footer": "Unsubscribe",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "next_actions" in data
        assert data["next_actions"]
        assert "memory_snippets" in data

    def test_agent_metrics_snapshot(self, client):
        client.post(
            "/v1/campaigns/record-outcome",
            json={"campaign_name": "x", "prompt": "y", "audience": "z", "subject": "subj", "cta": "cta"},
        )
        metrics_resp = client.get("/v1/campaigns/agent-metrics")
        assert metrics_resp.status_code == 200
        payload = metrics_resp.json()
        assert "metrics" in payload
        assert "total_calls" in payload
