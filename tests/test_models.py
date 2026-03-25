"""
tests/test_models.py – unit tests for Pydantic v2 schemas.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models import (
    CampaignRequest,
    Channel,
    DesignTokens,
    PrimaryKPI,
)


def _minimal_request(**overrides) -> dict:
    base = {
        "campaign_name": "Test Campaign",
        "brand": {
            "brand_name": "TestBrand",
            "voice_guidelines": "Friendly and professional tone.",
            "banned_phrases": ["world-class"],
            "required_phrases": ["Shop now"],
            "legal_footer": "© 2025 TestBrand",
        },
        "objective": {
            "primary_kpi": "revenue",
            "target_audience": "Existing customers aged 25-45",
            "offer": "20% discount on all products",
            "geo_scope": "United States",
            "language": "English",
        },
        "channels": ["email"],
        "deliverables": {
            "number_of_emails": 3,
            "include_html": True,
            "include_variants": False,
        },
    }
    base.update(overrides)
    return base


class TestCampaignRequest:
    def test_valid_minimal_request(self):
        data = _minimal_request()
        req = CampaignRequest.model_validate(data)
        assert req.campaign_name == "Test Campaign"
        assert req.brand.brand_name == "TestBrand"
        assert req.objective.primary_kpi == PrimaryKPI.REVENUE
        assert Channel.EMAIL in req.channels
        assert req.deliverables.number_of_emails == 3

    def test_missing_campaign_name_raises(self):
        data = _minimal_request()
        del data["campaign_name"]
        with pytest.raises(ValidationError):
            CampaignRequest.model_validate(data)

    def test_missing_brand_raises(self):
        data = _minimal_request()
        del data["brand"]
        with pytest.raises(ValidationError):
            CampaignRequest.model_validate(data)

    def test_invalid_primary_kpi_raises(self):
        data = _minimal_request()
        data["objective"]["primary_kpi"] = "invalid_kpi"
        with pytest.raises(ValidationError):
            CampaignRequest.model_validate(data)

    def test_number_of_emails_too_high_raises(self):
        data = _minimal_request()
        data["deliverables"]["number_of_emails"] = 11
        with pytest.raises(ValidationError):
            CampaignRequest.model_validate(data)

    def test_number_of_emails_zero_raises(self):
        data = _minimal_request()
        data["deliverables"]["number_of_emails"] = 0
        with pytest.raises(ValidationError):
            CampaignRequest.model_validate(data)

    def test_default_design_tokens(self):
        data = _minimal_request()
        req = CampaignRequest.model_validate(data)
        assert req.brand.design_tokens.primary_color == "#6366f1"

    def test_custom_design_tokens(self):
        data = _minimal_request()
        data["brand"]["design_tokens"] = {
            "primary_color": "#FF0000",
            "secondary_color": "#00FF00",
        }
        req = CampaignRequest.model_validate(data)
        assert req.brand.design_tokens.primary_color == "#FF0000"

    def test_default_channels_includes_email(self):
        """Default channels should be email when not specified."""
        data = _minimal_request()
        req = CampaignRequest.model_validate(data)
        assert Channel.EMAIL in req.channels

    def test_multiple_channels(self):
        data = _minimal_request()
        data["channels"] = ["email", "sms"]
        req = CampaignRequest.model_validate(data)
        assert Channel.EMAIL in req.channels
        assert Channel.SMS in req.channels

    def test_constraints_defaults(self):
        data = _minimal_request()
        req = CampaignRequest.model_validate(data)
        assert req.constraints.discount_ceiling is None
        assert req.constraints.compliance_notes == ""

    def test_discount_ceiling_validation(self):
        """discount_ceiling must be between 0 and 100."""
        data = _minimal_request()
        data["constraints"] = {"discount_ceiling": 120.0}
        with pytest.raises(ValidationError):
            CampaignRequest.model_validate(data)


class TestDesignTokens:
    def test_defaults(self):
        tokens = DesignTokens()
        assert tokens.primary_color == "#6366f1"
        assert tokens.font_family_body == "Arial, sans-serif"
        assert tokens.logo_url is None

    def test_custom_values(self):
        tokens = DesignTokens(
            primary_color="#B22222",
            secondary_color="#FFFFFF",
            accent_color="#FFD700",
            logo_url="https://example.com/logo.png",
        )
        assert tokens.primary_color == "#B22222"
        assert tokens.logo_url == "https://example.com/logo.png"


class TestPrimaryKPIEnum:
    def test_all_values_valid(self):
        for kpi in PrimaryKPI:
            assert kpi.value  # should be non-empty string

    def test_invalid_kpi(self):
        with pytest.raises(ValueError):
            PrimaryKPI("not_a_real_kpi")
