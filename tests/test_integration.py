"""
tests/test_integration.py – full end-to-end test against the real Gemini API.

Run with:
    uv run pytest --integration tests/test_integration.py -v -s

Output is written to outputs/integration_result.json in the project root.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

OUTPUT_FILE = Path(__file__).parent.parent / "outputs" / "integration_result.json"


def _save_output(payload: dict, response_data: dict, status_code: int) -> None:
    OUTPUT_FILE.parent.mkdir(exist_ok=True)
    record = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "http_status": status_code,
        "request": payload,
        "response": response_data,
    }
    OUTPUT_FILE.write_text(json.dumps(record, indent=2, ensure_ascii=False))
    print(f"\nOutput saved to {OUTPUT_FILE}")

INTEGRATION_PAYLOAD = {
    "campaign_name": "Brew & Bloom Spring 2026",
    "brand": {
        "brand_name": "Roast & Co.",
        "voice_guidelines": (
            "Warm, approachable, and slightly playful. "
            "We celebrate slow mornings and quality coffee. "
            "Avoid corporate jargon. Use sensory language."
        ),
        "banned_phrases": ["synergy", "world-class", "disruptive"],
        "required_phrases": ["Shop now", "Spring blend"],
        "legal_footer": "© 2026 Roast & Co. | Unsubscribe | Privacy Policy",
        "design_tokens": {
            "primary_color": "#4E342E",
            "secondary_color": "#FFF8E1",
            "accent_color": "#A5D6A7",
            "font_family_heading": "Playfair Display, serif",
            "font_family_body": "Inter, sans-serif",
        },
    },
    "objective": {
        "primary_kpi": "revenue",
        "secondary_kpis": ["open_rate", "click_through_rate"],
        "target_audience": "Coffee subscribers aged 25-45 who ordered in the last 3 months",
        "offer": "20% off our new Spring blend for the first two weeks of March",
        "geo_scope": "United States",
        "language": "English",
    },
    "constraints": {
        "discount_ceiling": 20.0,
        "compliance_notes": "CAN-SPAM compliant. No misleading subject lines.",
        "send_window": "March 1-14, 2026",
        "exclude_segments": ["unsubscribed", "bounced"],
        "required_segments": ["active subscribers"],
    },
    "channels": ["email"],
    "deliverables": {
        "number_of_emails": 2,
        "include_html": True,
        "include_variants": True,
    },
}


@pytest.mark.integration
def test_full_campaign_generation_with_real_gemini():
    """
    Sends a real request through the full Mark pipeline and asserts the
    response shape is correct. Requires GEMINI_API_KEY to be set.
    """
    if not settings.gemini_api_key:
        pytest.skip("GEMINI_API_KEY not set – skipping live integration test.")

    with TestClient(app) as client:
        resp = client.post("/v1/campaigns/generate", json=INTEGRATION_PAYLOAD)

    assert resp.status_code == 200, f"Unexpected status: {resp.status_code}\n{resp.text}"
    data = resp.json()
    _save_output(INTEGRATION_PAYLOAD, data, resp.status_code)

    # Top-level shape
    assert data["status"] in ("completed", "needs_clarification")

    if data["status"] == "completed":
        # Blueprint
        blueprint = data["blueprint"]
        assert blueprint["campaign_angle"]
        assert isinstance(blueprint["narrative_arc"], list)
        assert len(blueprint["narrative_arc"]) >= 1

        # Assets
        assert len(data["assets"]) == INTEGRATION_PAYLOAD["deliverables"]["number_of_emails"]
        for asset in data["assets"]:
            assert asset["subject_lines"], "Expected at least one subject line"
            assert asset["body_text"], "Expected body text"
            assert asset["ctas"], "Expected at least one CTA"
            if INTEGRATION_PAYLOAD["deliverables"]["include_html"]:
                assert asset.get("html"), "Expected HTML output"

        # Critique
        critique = data["critique"]
        assert isinstance(critique["score"], int | float)
        assert 0 <= critique["score"] <= 100

        # Metadata
        meta = data["metadata"]
        assert meta["request_id"]
        assert meta["model_used"]
        assert isinstance(meta["timings"]["total_ms"], int | float)

    elif data["status"] == "needs_clarification":
        assert data["clarification_questions"], "Expected at least one clarification question"
