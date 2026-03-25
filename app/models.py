"""
app/models.py – Pydantic v2 request / response schemas for Mark API.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ── Enumerations ──────────────────────────────────────────────────────────────


class PrimaryKPI(str, Enum):
    REVENUE = "revenue"
    CONVERSION_RATE = "conversion_rate"
    OPEN_RATE = "open_rate"
    CLICK_THROUGH_RATE = "click_through_rate"
    LEADS_GENERATED = "leads_generated"
    BRAND_AWARENESS = "brand_awareness"
    CUSTOMER_RETENTION = "customer_retention"
    AOV = "average_order_value"
    ROAS = "roas"


class Channel(str, Enum):
    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"
    SOCIAL = "social"
    PAID_SEARCH = "paid_search"
    DISPLAY = "display"


class CampaignStatus(str, Enum):
    NEEDS_CLARIFICATION = "needs_clarification"
    COMPLETED = "completed"


# ── Sub-models: Request ───────────────────────────────────────────────────────


class DesignTokens(BaseModel):
    auto_design: bool = Field(
        default=True,
        description="If True, the model chooses a beautiful design. Set False to enforce the tokens below.",
    )
    primary_color: str = Field(default="#6366f1", examples=["#0055FF"])
    secondary_color: str = Field(default="#ffffff", examples=["#FF3300"])
    accent_color: Optional[str] = Field(default="#f59e0b", examples=["#FFD700"])
    font_family_heading: str = Field(default="Georgia, serif")
    font_family_body: str = Field(default="Arial, sans-serif")
    font_size_base: str = Field(default="16px")
    line_height: str = Field(default="1.6")
    spacing_unit: str = Field(default="8px")
    border_radius: str = Field(default="6px")
    logo_url: Optional[str] = Field(default=None)


class BrandContext(BaseModel):
    brand_name: str = Field(..., min_length=1, examples=["AcmeCorp"])
    voice_guidelines: str = Field(
        ...,
        min_length=10,
        examples=["Friendly, professional, action-oriented. Never use jargon."],
    )
    banned_phrases: list[str] = Field(
        default_factory=list,
        examples=[["the best", "world-class", "revolutionary"]],
    )
    required_phrases: list[str] = Field(
        default_factory=list,
        examples=[["Shop now", "Limited time"]],
    )
    legal_footer: str = Field(
        default="",
        examples=["© 2025 AcmeCorp. Unsubscribe | Privacy Policy"],
    )
    design_tokens: DesignTokens = Field(default_factory=DesignTokens)
    example_email_html: Optional[str] = Field(
        default=None,
        description="Optional reference HTML email for style matching.",
    )


class CampaignObjective(BaseModel):
    primary_kpi: PrimaryKPI = Field(..., examples=[PrimaryKPI.REVENUE])
    secondary_kpis: list[PrimaryKPI] = Field(default_factory=list)
    target_audience: str = Field(
        ...,
        min_length=5,
        examples=["Existing customers aged 25-45 who purchased in the last 6 months"],
    )
    offer: str = Field(
        ...,
        examples=["25% discount on all products for Christmas"],
    )
    geo_scope: str = Field(..., examples=["United States"])
    language: str = Field(..., examples=["English"])


class CampaignConstraints(BaseModel):
    discount_ceiling: Optional[float] = Field(
        default=None,
        ge=0,
        le=100,
        description="Maximum discount percentage allowed.",
    )
    compliance_notes: str = Field(
        default="",
        examples=["CAN-SPAM compliant. No false urgency claims."],
    )
    send_window: str = Field(
        default="",
        examples=["December 20-26, 2025"],
    )
    exclude_segments: list[str] = Field(
        default_factory=list,
        examples=[["VIP customers", "unsubscribed"]],
    )
    required_segments: list[str] = Field(
        default_factory=list,
        examples=[["loyal customers"]],
    )


class Deliverables(BaseModel):
    number_of_emails: int = Field(..., ge=1, le=10, examples=[3])
    include_html: bool = Field(default=True)
    include_variants: bool = Field(
        default=False,
        description="Generate A/B variant subject lines and preview text.",
    )


# ── Main Request ──────────────────────────────────────────────────────────────


class CampaignRequest(BaseModel):
    campaign_name: str = Field(..., min_length=1, examples=["Christmas Sale 2025"])
    brand: BrandContext
    objective: CampaignObjective
    constraints: CampaignConstraints = Field(default_factory=CampaignConstraints)
    channels: list[Channel] = Field(
        default=[Channel.EMAIL],
        min_length=1,
        examples=[[Channel.EMAIL]],
    )
    deliverables: Deliverables

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "campaign_name": "Christmas Discount 2025",
                    "brand": {
                        "brand_name": "AcmeCorp",
                        "voice_guidelines": "Warm, festive, friendly. Use inclusive language. Avoid buzzwords.",
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
            ]
        }
    }


# ── Sub-models: Response ──────────────────────────────────────────────────────


class ClarificationQuestion(BaseModel):
    field: str = Field(..., examples=["objective.offer"])
    question: str = Field(..., examples=["What specific discount or value are you offering?"])
    why_needed: str = Field(..., examples=["Required to generate accurate copy."])


class Blueprint(BaseModel):
    campaign_angle: str
    core_narrative: str
    offer_logic: str
    narrative_arc: list[str] = Field(
        description="Ordered list of narrative beats (e.g., tease → offer → urgency → close)."
    )
    kpi_mapping: dict[str, str] = Field(
        description="Maps each KPI to the tactic that drives it."
    )
    channel_strategy: dict[str, str] = Field(
        description="Per-channel execution notes."
    )
    risks: list[str] = Field(description="Identified risks and mitigations.")
    assumptions: list[str] = Field(description="Labelled assumptions made.")


class EmailAsset(BaseModel):
    email_number: int
    email_name: str = Field(description="Descriptive name, e.g. 'Teaser – Day 1'")
    subject_lines: list[str] = Field(
        min_length=2, description="At least 2 subject line options."
    )
    preview_text_options: list[str] = Field(
        min_length=2, description="At least 2 preview text options."
    )
    body_text: str = Field(description="Full email body copy (plain text).")
    ctas: list[str] = Field(min_length=1, description="Call-to-action button labels.")
    send_timing: str = Field(description="Recommended send day/time with rationale.")
    html: Optional[str] = Field(default=None, description="Production-ready HTML email.")
    accessibility_notes: list[str] = Field(
        default_factory=list,
        description="Accessibility checks and recommendations.",
    )


class CritiqueResult(BaseModel):
    issues: list[str] = Field(description="Identified issues in copy or strategy.")
    fixes: list[str] = Field(description="Suggested corrections for each issue.")
    risk_flags: list[str] = Field(
        description="High-severity flags (compliance, spam, brand safety)."
    )
    llm_commentary: str = Field(description="Overall critique commentary from LLM.")
    score: int = Field(ge=0, le=100, description="Overall quality score 0–100.")


class PhaseTimings(BaseModel):
    clarify_ms: Optional[float] = None
    research_ms: Optional[float] = None
    strategy_ms: Optional[float] = None
    execution_ms: Optional[float] = None
    production_ms: Optional[float] = None
    critique_ms: Optional[float] = None
    total_ms: Optional[float] = None


class ResponseMetadata(BaseModel):
    request_id: str
    model_used: str
    tokens_estimate: int = Field(default=0)
    timings: PhaseTimings = Field(default_factory=PhaseTimings)


class CampaignResponse(BaseModel):
    status: CampaignStatus
    clarification_questions: list[ClarificationQuestion] = Field(default_factory=list)
    blueprint: Optional[Blueprint] = None
    assets: list[EmailAsset] = Field(default_factory=list)
    critique: Optional[CritiqueResult] = None
    metadata: Optional[ResponseMetadata] = None


# ── Validation endpoint ───────────────────────────────────────────────────────


class ValidationIssue(BaseModel):
    field: str
    severity: str = Field(examples=["error", "warning", "info"])
    message: str
    suggestion: Optional[str] = None


class ValidationResponse(BaseModel):
    valid: bool
    issues: list[ValidationIssue] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)


# ── Health ────────────────────────────────────────────────────────────────────


class HealthResponse(BaseModel):
    status: str
    version: str
    model: str
    gemini_key_configured: bool


class ReadinessResponse(BaseModel):
    ready: bool
    checks: dict[str, Any]


# ── Prompt-based (frontend) API ───────────────────────────────────────────────


class PromptRequest(BaseModel):
    """Single free-form prompt from the frontend textarea."""

    prompt: str = Field(
        ...,
        min_length=10,
        description="Free-form campaign description from the user.",
        examples=["Create a 3-email spring sale for EU customers, 30% off, GDPR compliant."],
    )
    force_proceed: bool = Field(
        default=False,
        description="If True, skip clarification and proceed with defaults for any missing fields.",
    )
    brand_context: Optional[dict] = Field(
        default=None,
        description="Optional brand context from the frontend brand store. Overrides prompt-parsed brand fields.",
    )


class SimpleSummary(BaseModel):
    target_group: str = Field(default="")
    regional_adaptation: str = Field(default="")
    tone_decision: str = Field(default="")
    legal_considerations: str = Field(default="")


class SimpleEmail(BaseModel):
    """Frontend-shaped email — maps 1:1 to GeneratedEmail in mock-api.ts."""

    id: str
    subject: str
    html_content: str
    summary: SimpleSummary


class SimpleClarificationQuestion(BaseModel):
    field: str
    question: str


class SimpleCampaignResponse(BaseModel):
    """Response returned to the frontend for generate-from-prompt."""

    id: str
    status: str  # "completed" | "needs_clarification"
    questions: list[SimpleClarificationQuestion] = Field(default_factory=list)
    emails: list[SimpleEmail] = Field(default_factory=list)


class EmailEditRequest(BaseModel):
    """Request to regenerate a single email with new instructions."""

    email_id: str = Field(..., description="ID of the email being edited.")
    current_html: str = Field(..., description="Current HTML of the email.")
    subject: str = Field(default="", description="Current subject line for context.")
    instructions: str = Field(
        ...,
        min_length=5,
        description="User instructions, e.g. 'Make it more formal and add a discount code'.",
    )


class EmailEditResponse(BaseModel):
    email: SimpleEmail


class EmailSpec(BaseModel):
    """Minimal email variant descriptor for recipient recommendation."""

    id: str
    subject: str
    target_group: str


class RecipientRecommendRequest(BaseModel):
    emails: list[EmailSpec]
    contacts_csv: str = Field(
        ...,
        description="Raw CSV exported from HubSpot: firstname,lastname,email,age,membership_level,...",
    )
    campaign_prompt: Optional[str] = Field(
        default=None,
        description="The original free-form prompt the user wrote when creating the campaign. Gives the AI full context about campaign intent.",
    )


class RecipientRecommendResponse(BaseModel):
    assignments: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Maps email variant id -> list of contact email addresses.",
    )
    reasoning: str = Field(
        default="",
        description="Brief explanation of how contacts were matched.",
    )
