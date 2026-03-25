"""
tests/test_validators.py – unit tests for rule-based validators.
"""
from __future__ import annotations

from app.models import CampaignRequest
from app.services.validators import (
    check_all_caps,
    check_banned_phrases,
    check_discount_ceiling,
    check_exclamation_marks,
    check_legal_footer,
    check_required_phrases,
    check_spam_trigger_words,
    check_subject_line_length,
    run_email_rules,
    validate_campaign_request,
)


# ── Individual rule checks ─────────────────────────────────────────────────────


class TestCheckBannedPhrases:
    def test_no_banned_phrases_passes(self):
        result = check_banned_phrases("Hello, shop our great sale!", [], "test")
        assert result.passed

    def test_banned_phrase_detected(self):
        result = check_banned_phrases(
            "This is world-class quality.", ["world-class"], "email body"
        )
        assert not result.passed
        assert len(result.issues) == 1
        assert len(result.risk_flags) == 1

    def test_case_insensitive(self):
        result = check_banned_phrases(
            "WORLD-CLASS products await.", ["world-class"], "email body"
        )
        assert not result.passed

    def test_multiple_banned_phrases(self):
        result = check_banned_phrases(
            "Revolutionary world-class synergy!",
            ["world-class", "revolutionary", "synergy"],
            "email body",
        )
        assert not result.passed
        assert len(result.fixes) == 3


class TestCheckRequiredPhrases:
    def test_all_present_passes(self):
        result = check_required_phrases(
            "Shop now for amazing deals! Limited time offer available.",
            ["Shop now", "Limited time offer"],
            "email body",
        )
        assert result.passed

    def test_missing_phrase_fails(self):
        result = check_required_phrases(
            "Amazing deals are here.",
            ["Shop now"],
            "email body",
        )
        assert not result.passed
        assert "Shop now" in result.issues[0]

    def test_empty_required_list_passes(self):
        result = check_required_phrases("Any content.", [], "test")
        assert result.passed


class TestCheckLegalFooter:
    def test_footer_present_passes(self):
        result = check_legal_footer(
            "Body content...\n© 2025 Brand Inc. Unsubscribe | Privacy",
            "© 2025 Brand Inc.",
            "email body",
        )
        assert result.passed

    def test_footer_missing_fails(self):
        result = check_legal_footer(
            "Body content with no footer.",
            "© 2025 Brand Inc.",
            "email body",
        )
        assert not result.passed
        assert len(result.risk_flags) == 1

    def test_no_configured_footer_passes(self):
        result = check_legal_footer("Any body.", "", "email body")
        assert result.passed


class TestCheckExclamationMarks:
    def test_within_threshold_passes(self):
        result = check_exclamation_marks("Hello! World! Great!", "test")
        assert result.passed  # 3 = threshold, passes

    def test_exceeds_threshold_fails(self):
        result = check_exclamation_marks("Hello!! World!! Buy!! Now!!", "test")
        assert not result.passed
        assert len(result.risk_flags) == 1


class TestCheckAllCaps:
    def test_no_caps_passes(self):
        result = check_all_caps("Hello world, shop now.", "test")
        assert result.passed

    def test_legitimate_acronyms_pass(self):
        result = check_all_caps("Our HTML email uses a CTA button.", "test")
        assert result.passed

    def test_offending_caps_fails(self):
        result = check_all_caps("AMAZING DEALS await you TODAY!", "test")
        assert not result.passed
        assert len(result.risk_flags) >= 1


class TestCheckSpamTriggerWords:
    def test_clean_text_passes(self):
        result = check_spam_trigger_words(
            "Get 25% off your next purchase this Christmas.", "test"
        )
        assert result.passed

    def test_spam_word_detected(self):
        result = check_spam_trigger_words(
            "Click here for a guaranteed free gift!", "test"
        )
        assert not result.passed

    def test_risk_flags_generated(self):
        result = check_spam_trigger_words(
            "Act now to claim your guaranteed prize!", "test"
        )
        assert len(result.risk_flags) >= 1


class TestCheckSubjectLineLength:
    def test_short_subject_passes(self):
        result = check_subject_line_length("Christmas Sale – 25% Off!", "test")
        assert result.passed

    def test_long_subject_fails(self):
        long_subj = "A" * 65
        result = check_subject_line_length(long_subj, "test")
        assert not result.passed


class TestCheckDiscountCeiling:
    def test_no_ceiling_passes(self):
        result = check_discount_ceiling("Get 30% off today!", None, "test")
        assert result.passed

    def test_at_ceiling_passes(self):
        result = check_discount_ceiling("Get 25% off today!", 25.0, "test")
        assert result.passed

    def test_exceeds_ceiling_fails(self):
        result = check_discount_ceiling("Get 30% off today!", 25.0, "test")
        assert not result.passed
        assert len(result.risk_flags) == 1


# ── Aggregate validators ───────────────────────────────────────────────────────


def _make_req() -> CampaignRequest:
    return CampaignRequest.model_validate(
        {
            "campaign_name": "Test",
            "brand": {
                "brand_name": "Brand",
                "voice_guidelines": "Professional and warm tone always.",
                "banned_phrases": ["world-class"],
                "required_phrases": ["Shop now"],
                "legal_footer": "© 2025 Brand",
            },
            "objective": {
                "primary_kpi": "revenue",
                "target_audience": "Existing customers over 25",
                "offer": "25% discount storewide",
                "geo_scope": "US",
                "language": "English",
            },
            "channels": ["email"],
            "deliverables": {"number_of_emails": 2, "include_html": False},
        }
    )


class TestRunEmailRules:
    def test_clean_email_passes(self):
        req = _make_req()
        email = {
            "email_number": 1,
            "body_text": "Shop now for 25% off! © 2025 Brand",
            "subject_lines": ["Christmas Sale – 25% Off"],
            "preview_text_options": ["Get your holiday deals now."],
            "ctas": ["Shop Now"],
        }
        result = run_email_rules(req, email)
        # May have no issues or only minor warnings
        assert isinstance(result.passed, bool)

    def test_email_with_banned_phrase_fails(self):
        req = _make_req()
        email = {
            "email_number": 1,
            "body_text": "Get our world-class products! Shop now! © 2025 Brand",
            "subject_lines": ["Sale"],
            "preview_text_options": ["Preview"],
            "ctas": ["Buy"],
        }
        result = run_email_rules(req, email)
        assert not result.passed
        assert any("world-class" in i.lower() for i in result.issues)

    def test_email_missing_footer_flagged(self):
        req = _make_req()
        email = {
            "email_number": 1,
            "body_text": "Shop now for 25% off! No footer here.",
            "subject_lines": ["Sale"],
            "preview_text_options": ["Preview"],
            "ctas": ["Buy"],
        }
        result = run_email_rules(req, email)
        assert any("footer" in i.lower() for i in result.issues)


class TestValidateCampaignRequest:
    def test_valid_request_has_no_errors(self):
        req = _make_req()
        issues = validate_campaign_request(req)
        errors = [i for i in issues if i.severity == "error"]
        assert not errors

    def test_short_offer_produces_error(self):
        data = {
            "campaign_name": "Test",
            "brand": {
                "brand_name": "Brand",
                "voice_guidelines": "Professional.",
            },
            "objective": {
                "primary_kpi": "revenue",
                "target_audience": "Everyone",
                "offer": "Deals",  # Too short
                "geo_scope": "US",
                "language": "English",
            },
            "channels": ["email"],
            "deliverables": {"number_of_emails": 1},
        }
        req = CampaignRequest.model_validate(data)
        issues = validate_campaign_request(req)
        errors = [i for i in issues if i.severity == "error" and "offer" in i.field]
        assert errors

    def test_discount_mismatch_produces_error(self):
        data = {
            "campaign_name": "Test",
            "brand": {
                "brand_name": "Brand",
                "voice_guidelines": "Professional and friendly.",
            },
            "objective": {
                "primary_kpi": "revenue",
                "target_audience": "All customers",
                "offer": "50% off everything",  # Exceeds ceiling
                "geo_scope": "US",
                "language": "English",
            },
            "constraints": {"discount_ceiling": 25.0},
            "channels": ["email"],
            "deliverables": {"number_of_emails": 1},
        }
        req = CampaignRequest.model_validate(data)
        issues = validate_campaign_request(req)
        errors = [i for i in issues if i.severity == "error"]
        assert errors
