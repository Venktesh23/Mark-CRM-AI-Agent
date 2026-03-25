"""
app/services/validators.py – deterministic rule-based validation & critique checks.

These validators operate on plain text/dicts without any LLM calls, making them
fast, free, and predictable. They complement the LLM critique phase.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from app.models import CampaignRequest, ValidationIssue

# ── Spam trigger words (partial list – industry standard) ─────────────────────

SPAM_TRIGGER_WORDS: frozenset[str] = frozenset(
    {
        "free money",
        "make money fast",
        "earn money",
        "100% free",
        "100% satisfied",
        "act now",
        "apply now",
        "buy direct",
        "buy now",
        "call free",
        "cancel at any time",
        "cash bonus",
        "claim now",
        "click here",
        "click now",
        "dear friend",
        "double your income",
        "earn per week",
        "fast cash",
        "free gift",
        "free investment",
        "free leads",
        "free membership",
        "free money",
        "free preview",
        "free trial",
        "get paid",
        "great offer",
        "guaranteed",
        "have been selected",
        "hidden assets",
        "home employment",
        "income from home",
        "incredible deal",
        "join millions",
        "lose weight",
        "lowest price",
        "make $",
        "miracle",
        "money back guarantee",
        "no catch",
        "no credit check",
        "no fees",
        "no hidden costs",
        "no investment",
        "no purchase necessary",
        "no questions asked",
        "no risk",
        "not spam",
        "obligation free",
        "offer expires",
        "once in a lifetime",
        "only $",
        "open immediately",
        "order now",
        "order today",
        "promise you",
        "pure profit",
        "risk free",
        "sale ends",
        "special promotion",
        "special offer",
        "staggering deal",
        "take action",
        "this is not a scam",
        "trial offer",
        "unbeatable",
        "unlimited",
        "unsecured credit",
        "urgent",
        "while stocks last",
        "while supplies last",
        "winner",
        "work at home",
        "you are a winner",
        "you've been selected",
        "you have been chosen",
        "you're a winner",
        "$$$",
        "!!!",
        "100%",
    }
)

_EXCESS_EXCLAMATION_THRESHOLD = 3


# ── Dataclass for rule results ─────────────────────────────────────────────────


@dataclass
class RuleCheckResult:
    passed: bool
    issues: list[str] = field(default_factory=list)
    risk_flags: list[str] = field(default_factory=list)
    fixes: list[str] = field(default_factory=list)


# ── Individual rule checks ─────────────────────────────────────────────────────


def check_banned_phrases(text: str, banned: list[str], context: str) -> RuleCheckResult:
    """Check that no banned phrases appear in the text (case-insensitive)."""
    found: list[str] = []
    lower_text = text.lower()
    for phrase in banned:
        if phrase.lower() in lower_text:
            found.append(phrase)

    if found:
        return RuleCheckResult(
            passed=False,
            issues=[f"{context}: Contains banned phrase(s): {found}"],
            risk_flags=[f"BRAND SAFETY – {context}: banned phrase '{p}'" for p in found],
            fixes=[f"Remove or replace '{p}' in {context}." for p in found],
        )
    return RuleCheckResult(passed=True)


def check_required_phrases(text: str, required: list[str], context: str) -> RuleCheckResult:
    """Check that all required phrases appear at least once."""
    missing: list[str] = []
    lower_text = text.lower()
    for phrase in required:
        if phrase.lower() not in lower_text:
            missing.append(phrase)

    if missing:
        return RuleCheckResult(
            passed=False,
            issues=[f"{context}: Missing required phrase(s): {missing}"],
            fixes=[f"Include '{p}' in {context}." for p in missing],
        )
    return RuleCheckResult(passed=True)


def check_legal_footer(text: str, legal_footer: str, context: str) -> RuleCheckResult:
    """Verify the legal footer is present."""
    if not legal_footer:
        return RuleCheckResult(passed=True)  # No footer configured – nothing to check

    # Check for at least a portion of the footer (first 30 chars)
    snippet = legal_footer[:30].lower()
    if snippet not in text.lower():
        return RuleCheckResult(
            passed=False,
            issues=[f"{context}: Legal footer appears to be missing."],
            risk_flags=[f"COMPLIANCE – {context}: Legal footer missing. This may violate CAN-SPAM/GDPR."],
            fixes=[f"Add the required legal footer to {context}: '{legal_footer[:60]}...'"],
        )
    return RuleCheckResult(passed=True)


def check_exclamation_marks(text: str, context: str) -> RuleCheckResult:
    """Flag excessive exclamation marks (spam signal)."""
    count = text.count("!")
    if count > _EXCESS_EXCLAMATION_THRESHOLD:
        return RuleCheckResult(
            passed=False,
            issues=[f"{context}: {count} exclamation marks detected (threshold: {_EXCESS_EXCLAMATION_THRESHOLD})."],
            risk_flags=[f"SPAM RISK – {context}: Excessive exclamation marks ({count}) may trigger spam filters."],
            fixes=[f"Reduce exclamation marks in {context} to {_EXCESS_EXCLAMATION_THRESHOLD} or fewer."],
        )
    return RuleCheckResult(passed=True)


def check_all_caps(text: str, context: str) -> RuleCheckResult:
    """Flag words written in ALL CAPS (spam signal)."""
    all_caps_words = re.findall(r"\b[A-Z]{4,}\b", text)
    # Filter out known legitimate acronyms
    legitimate = {"HTML", "URL", "FAQ", "CEO", "CTA", "KPI", "ROI", "SMS", "USA", "UK"}
    offenders = [w for w in all_caps_words if w not in legitimate]
    if offenders:
        return RuleCheckResult(
            passed=False,
            issues=[f"{context}: ALL CAPS words detected: {list(set(offenders))}"],
            risk_flags=[f"SPAM RISK – {context}: ALL CAPS words may trigger spam filters."],
            fixes=[f"Replace ALL CAPS words {list(set(offenders))} with title case in {context}."],
        )
    return RuleCheckResult(passed=True)


def check_spam_trigger_words(text: str, context: str) -> RuleCheckResult:
    """Check for known spam trigger words/phrases."""
    lower_text = text.lower()
    found = [phrase for phrase in SPAM_TRIGGER_WORDS if phrase in lower_text]
    if found:
        return RuleCheckResult(
            passed=False,
            issues=[f"{context}: Potential spam trigger phrases: {found[:5]}"],
            risk_flags=[
                f"SPAM RISK – {context}: '{p}' is a known spam trigger." for p in found[:3]
            ],
            fixes=[f"Rephrase or remove spam trigger '{p}' in {context}." for p in found[:5]],
        )
    return RuleCheckResult(passed=True)


def check_subject_line_length(subject: str, context: str) -> RuleCheckResult:
    """Warn if subject line is too long."""
    length = len(subject)
    if length > 60:
        return RuleCheckResult(
            passed=False,
            issues=[f"{context}: Subject line is {length} characters (recommended ≤50, max 60)."],
            fixes=[f"Shorten subject line in {context} to under 50 characters."],
        )
    return RuleCheckResult(passed=True)


def check_preview_text_length(preview: str, context: str) -> RuleCheckResult:
    """Warn if preview text is too long."""
    length = len(preview)
    if length > 100:
        return RuleCheckResult(
            passed=False,
            issues=[f"{context}: Preview text is {length} characters (recommended ≤90)."],
            fixes=[f"Shorten preview text in {context} to under 90 characters."],
        )
    return RuleCheckResult(passed=True)


def check_discount_ceiling(text: str, ceiling: Optional[float], context: str) -> RuleCheckResult:
    """Check that no discount exceeds the configured ceiling."""
    if ceiling is None:
        return RuleCheckResult(passed=True)

    # Look for percentage patterns like "30%", "35 percent"
    pct_matches = re.findall(r"(\d+(?:\.\d+)?)\s*%", text)
    int_matches = re.findall(r"(\d+)\s*percent", text, re.IGNORECASE)
    all_values = [float(v) for v in pct_matches + int_matches]

    violations = [v for v in all_values if v > ceiling]
    if violations:
        return RuleCheckResult(
            passed=False,
            issues=[f"{context}: Discount value(s) {violations} exceed ceiling of {ceiling}%."],
            risk_flags=[
                f"COMPLIANCE – {context}: Discount {v}% exceeds the allowed ceiling of {ceiling}%."
                for v in violations
            ],
            fixes=[
                f"Replace all discount values exceeding {ceiling}% in {context}."
            ],
        )
    return RuleCheckResult(passed=True)


# ── Aggregate validator ────────────────────────────────────────────────────────


def run_email_rules(
    req: CampaignRequest,
    email: dict,
) -> RuleCheckResult:
    """Run all rule checks on a single email asset dict."""
    email_num = email.get("email_number", "?")
    ctx_body = f"Email {email_num} body"
    ctx_subj = f"Email {email_num} subject lines"
    ctx_preview = f"Email {email_num} preview text"

    all_issues: list[str] = []
    all_flags: list[str] = []
    all_fixes: list[str] = []

    body = email.get("body_text", "")
    subjects = email.get("subject_lines", [])
    previews = email.get("preview_text_options", [])

    # Run checks on body
    for check_fn in [
        lambda: check_banned_phrases(body, req.brand.banned_phrases, ctx_body),
        lambda: check_required_phrases(body, req.brand.required_phrases, ctx_body),
        lambda: check_legal_footer(body, req.brand.legal_footer, ctx_body),
        lambda: check_exclamation_marks(body, ctx_body),
        lambda: check_all_caps(body, ctx_body),
        lambda: check_spam_trigger_words(body, ctx_body),
        lambda: check_discount_ceiling(body, req.constraints.discount_ceiling, ctx_body),
    ]:
        result = check_fn()
        all_issues.extend(result.issues)
        all_flags.extend(result.risk_flags)
        all_fixes.extend(result.fixes)

    # Run checks on subject lines
    for i, subj in enumerate(subjects):
        ctx = f"{ctx_subj}[{i}]"
        for check_fn in [
            lambda s=subj, c=ctx: check_subject_line_length(s, c),
            lambda s=subj, c=ctx: check_spam_trigger_words(s, c),
            lambda s=subj, c=ctx: check_banned_phrases(s, req.brand.banned_phrases, c),
        ]:
            result = check_fn()
            all_issues.extend(result.issues)
            all_flags.extend(result.risk_flags)
            all_fixes.extend(result.fixes)

    # Run checks on preview text
    for i, preview in enumerate(previews):
        ctx = f"{ctx_preview}[{i}]"
        result = check_preview_text_length(preview, ctx)
        all_issues.extend(result.issues)
        all_flags.extend(result.risk_flags)
        all_fixes.extend(result.fixes)

    passed = not all_issues
    return RuleCheckResult(
        passed=passed,
        issues=all_issues,
        risk_flags=all_flags,
        fixes=all_fixes,
    )


def validate_campaign_request(req: CampaignRequest) -> list[ValidationIssue]:
    """
    Pre-generation validation of a CampaignRequest.
    Returns a list of ValidationIssue objects (empty = fully valid).
    """
    issues: list[ValidationIssue] = []

    # Brand name
    if not req.brand.brand_name.strip():
        issues.append(
            ValidationIssue(
                field="brand.brand_name",
                severity="error",
                message="Brand name is required.",
            )
        )

    # Voice guidelines
    if len(req.brand.voice_guidelines) < 20:
        issues.append(
            ValidationIssue(
                field="brand.voice_guidelines",
                severity="warning",
                message="Voice guidelines are very short; more detail improves output quality.",
                suggestion="Include tone, persona descriptors, and do/don't examples.",
            )
        )

    # Offer
    if len(req.objective.offer) < 10:
        issues.append(
            ValidationIssue(
                field="objective.offer",
                severity="error",
                message="Offer description is too vague.",
                suggestion="Describe the specific discount, value proposition, or promotion.",
            )
        )

    # Discount ceiling vs offer
    if req.constraints.discount_ceiling is not None:
        offer_lower = req.objective.offer.lower()
        pct_matches = re.findall(r"(\d+(?:\.\d+)?)\s*%", offer_lower)
        for pct in pct_matches:
            if float(pct) > req.constraints.discount_ceiling:
                issues.append(
                    ValidationIssue(
                        field="objective.offer",
                        severity="error",
                        message=(
                            f"Offer mentions {pct}% discount which exceeds "
                            f"discount_ceiling ({req.constraints.discount_ceiling}%)."
                        ),
                        suggestion="Align the offer discount with the discount ceiling.",
                    )
                )

    # Number of emails
    if req.deliverables.number_of_emails < 1:
        issues.append(
            ValidationIssue(
                field="deliverables.number_of_emails",
                severity="error",
                message="At least one email is required.",
            )
        )
    elif req.deliverables.number_of_emails > 7:
        issues.append(
            ValidationIssue(
                field="deliverables.number_of_emails",
                severity="warning",
                message="More than 7 emails is unusual; consider reducing to avoid audience fatigue.",
            )
        )

    # Email channel required
    from app.models import Channel
    if Channel.EMAIL not in req.channels:
        issues.append(
            ValidationIssue(
                field="channels",
                severity="warning",
                message="Email channel not included; email is the primary generation target.",
                suggestion="Add 'email' to channels.",
            )
        )

    return issues
