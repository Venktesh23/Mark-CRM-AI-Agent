"""
app/routes/campaigns.py – campaign generation and validation endpoints.
"""
from __future__ import annotations

import logging
import re
import uuid
import csv
from io import StringIO

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.models import (
    BrandContext,
    CampaignConstraints,
    CampaignObjective,
    CampaignRequest,
    CampaignResponse,
    Deliverables,
    DesignTokens,
    EmailEditRequest,
    EmailEditResponse,
    EmailSpec,
    PrimaryKPI,
    PromptRequest,
    RecipientRecommendRequest,
    RecipientRecommendResponse,
    SimpleCampaignResponse,
    SimpleClarificationQuestion,
    SimpleEmail,
    SimpleSummary,
    ValidationIssue,
    ValidationResponse,
)
from app.security.supabase_jwt import require_authenticated_user
from app.services.gemini_client import GeminiClient, get_gemini_client
from app.services.orchestrator import orchestrate_campaign, orchestrate_campaign_fast
from app.services.cache import campaign_cache
from app.services import prompting
from app.services.validators import validate_campaign_request

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/v1/campaigns",
    tags=["Campaigns"],
    dependencies=[Depends(require_authenticated_user)],
)


def _get_request_id(request: Request) -> str:
    return request.state.request_id if hasattr(request.state, "request_id") else str(uuid.uuid4())


def _extract_html_from_text(raw: str) -> str:
    """Strip fences / leading prose and return the first complete HTML document."""
    import json as _json

    text = raw.strip()
    for fence in ("```html", "```json", "```"):
        if text.startswith(fence):
            text = text[len(fence):].lstrip("\n")
            break
    if text.endswith("```"):
        text = text[:-3].rstrip()
    text = text.strip()
    # If the model wrapped the HTML in a JSON object, unwrap it.
    if text.startswith("{"):
        try:
            obj = _json.loads(text)
            if isinstance(obj, dict):
                for val in obj.values():
                    if isinstance(val, str) and ("<html" in val.lower() or "<!doctype" in val.lower()):
                        text = val  # json.loads already unescapes \\n → \n etc.
                        break
        except (_json.JSONDecodeError, ValueError):
            # Strict parse failed — try JSON-string-aware regex on the email_html value.
            html_val_match = re.search(
                r'"email_html"\s*:\s*"((?:[^"\\]|\\.)*)',
                text,
                re.DOTALL,
            )
            if html_val_match:
                raw_val = html_val_match.group(1)
                if raw_val.endswith('"'):
                    raw_val = raw_val[:-1]
                try:
                    text = _json.loads('"' + raw_val + '"')
                except _json.JSONDecodeError:
                    text = (
                        raw_val
                        .replace('\\"', '"')
                        .replace('\\n', '\n')
                        .replace('\\r', '\r')
                        .replace('\\t', '\t')
                        .replace('\\\\', '\\')
                    )
    m = re.search(r"(<!DOCTYPE\s+html[\s\S]*?</html>)", text, re.IGNORECASE)
    if m:
        return m.group(1)
    m2 = re.search(r"(<html[\s\S]*?</html>)", text, re.IGNORECASE)
    if m2:
        return m2.group(1)
    return text


# ── helpers ───────────────────────────────────────────────────────────────────


def _build_campaign_request(parsed: dict, brand_context: dict | None = None) -> CampaignRequest:
    """Reconstruct a CampaignRequest from the parse-phase output dict.

    If ``brand_context`` is supplied (from the frontend brand store) its values
    take precedence over whatever Gemini parsed from the free-form prompt.
    """
    raw_kpi = parsed.get("primary_kpi", "revenue")
    try:
        kpi = PrimaryKPI(raw_kpi)
    except ValueError:
        kpi = PrimaryKPI.REVENUE

    # ── Brand: frontend store wins over prompt-parsed values ─────────────────
    bc = brand_context or {}
    dt = bc.get("designTokens") or {}

    brand_name = bc.get("brandName") or parsed.get("brand_name") or "My Brand"
    voice = bc.get("voiceGuidelines") or parsed.get("voice_guidelines") or "Professional and friendly."
    banned = bc.get("bannedPhrases") or parsed.get("banned_phrases") or []
    required = bc.get("requiredPhrases") or parsed.get("required_phrases") or []
    legal = bc.get("legalFooter") or parsed.get("legal_footer") or ""

    design_tokens = DesignTokens(
        auto_design=bool(dt.get("autoDesign", True)),
        primary_color=dt.get("primaryColor") or "#6366f1",
        secondary_color=dt.get("secondaryColor") or "#ffffff",
        accent_color=dt.get("accentColor") or "#f59e0b",
        font_family_heading=dt.get("fontFamilyHeading") or "Georgia, serif",
        font_family_body=dt.get("fontFamilyBody") or "Arial, sans-serif",
        border_radius=dt.get("borderRadius") or "6px",
        logo_url=dt.get("logoUrl") or None,
    )

    return CampaignRequest(
        campaign_name=parsed.get("campaign_name") or "My Campaign",
        brand=BrandContext(
            brand_name=brand_name,
            voice_guidelines=voice,
            banned_phrases=banned,
            required_phrases=required,
            legal_footer=legal,
            design_tokens=design_tokens,
        ),
        objective=CampaignObjective(
            primary_kpi=kpi,
            target_audience=parsed.get("target_audience") or "General audience",
            offer=parsed.get("offer") or "Special offer",
            geo_scope=parsed.get("geo_scope") or "Global",
            language=parsed.get("language") or "English",
        ),
        constraints=CampaignConstraints(
            compliance_notes=parsed.get("compliance_notes") or "",
            send_window=parsed.get("send_window") or "",
            discount_ceiling=parsed.get("discount_ceiling"),
        ),
        deliverables=Deliverables(
            number_of_emails=int(parsed.get("number_of_emails") or 3),
            include_html=bool(parsed.get("include_html", True)),
            include_variants=False,
        ),
    )


def _map_to_simple_response(
    campaign_req: CampaignRequest,
    campaign_resp: CampaignResponse,
    request_id: str,
) -> SimpleCampaignResponse:
    """Map the full CampaignResponse to the lean shape the frontend expects."""
    emails: list[SimpleEmail] = []
    for asset in campaign_resp.assets:
        compliance = " | ".join(filter(None, [
            campaign_req.constraints.compliance_notes,
            campaign_req.brand.legal_footer,
        ])) or "Standard compliance applied."

        raw_html = asset.html or ""
        logger.info(
            "[HTML step 3/3] Mapping email %d to response — length=%d, "
            "has_real_newlines=%s, has_literal_backslash_n=%s, first 300 chars: %s",
            asset.email_number,
            len(raw_html),
            repr("\n" in raw_html),
            repr("\\n" in raw_html),
            repr(raw_html[:300]),
        )
        emails.append(
            SimpleEmail(
                id=f"email-{asset.email_number}",
                subject=asset.subject_lines[0] if asset.subject_lines else asset.email_name,
                html_content=raw_html,
                summary=SimpleSummary(
                    target_group=campaign_req.objective.target_audience,
                    regional_adaptation=(
                        f"{campaign_req.objective.geo_scope}"
                        + (f" — {campaign_req.constraints.send_window}"
                           if campaign_req.constraints.send_window else "")
                    ),
                    tone_decision=campaign_req.brand.voice_guidelines[:150],
                    legal_considerations=compliance,
                ),
            )
        )
    ai_report: dict = {
        "quality_score": campaign_resp.critique.score if campaign_resp.critique else None,
        "issues": campaign_resp.critique.issues[:8] if campaign_resp.critique else [],
        "risk_flags": campaign_resp.critique.risk_flags[:8] if campaign_resp.critique else [],
        "guardrails_passed": not bool(campaign_resp.critique and campaign_resp.critique.risk_flags),
        "tokens_estimate": campaign_resp.metadata.tokens_estimate if campaign_resp.metadata else 0,
        "timings_ms": campaign_resp.metadata.timings.model_dump() if campaign_resp.metadata else {},
        "model_used": campaign_resp.metadata.model_used if campaign_resp.metadata else "",
        "subject_recommendations": [
            {
                "email_id": f"email-{asset.email_number}",
                "recommended": asset.subject_lines[0] if asset.subject_lines else "",
                "alternatives": asset.subject_lines[1:5] if asset.subject_lines else [],
            }
            for asset in campaign_resp.assets
        ],
    }

    return SimpleCampaignResponse(
        id=request_id,
        status="completed",
        emails=emails,
        ai_report=ai_report,
    )


def _parse_contacts_csv(contacts_csv: str) -> list[dict[str, str]]:
    reader = csv.DictReader(StringIO(contacts_csv.strip()))
    contacts: list[dict[str, str]] = []
    for row in reader:
        contacts.append({(k or "").strip().lower(): (v or "").strip() for k, v in row.items()})
    return contacts


def _deterministic_match_score(target_group: str, contact: dict[str, str]) -> int:
    text = target_group.lower()
    score = 0
    membership = (contact.get("membership_level") or "").lower()
    city = (contact.get("city") or "").lower()
    country = (contact.get("country") or "").lower()
    age_raw = (contact.get("age") or "").strip()

    if membership and membership in text:
        score += 4
    if city and city in text:
        score += 3
    if country and country in text:
        score += 3

    try:
        age = int(age_raw)
    except ValueError:
        age = None
    if age is not None:
        if ("young" in text or "gen z" in text) and age <= 29:
            score += 2
        if ("professional" in text or "working" in text) and 25 <= age <= 50:
            score += 2
        if ("senior" in text or "retire" in text) and age >= 55:
            score += 2
    return score


# ── Routes ────────────────────────────────────────────────────────────────────


@router.post(
    "/generate-from-prompt",
    response_model=SimpleCampaignResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate a campaign from a free-form prompt",
    description=(
        "Accepts a single natural-language prompt. "
        "Phase 0 parses it into structured fields via Gemini. "
        "If more info is needed, returns needs_clarification with questions. "
        "Otherwise runs the full pipeline and returns frontend-shaped emails."
    ),
)
async def generate_from_prompt(
    payload: PromptRequest,
    request: Request,
    client: GeminiClient = Depends(get_gemini_client),
) -> SimpleCampaignResponse:
    request_id = _get_request_id(request)
    logger.info("POST /generate-from-prompt", extra={"request_id": request_id})

    # ── Phase 0: parse free-form prompt ───────────────────────────────────────
    try:
        parse_result = client.generate_text(
            prompt=prompting.build_parse_prompt(
                payload.prompt,
                force_proceed=payload.force_proceed,
                campaign_memory=payload.campaign_memory,
            ),
            system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
            json_schema=prompting.PARSE_SCHEMA,
            temperature=0.1,
        )
    except Exception as exc:
        logger.exception("Parse phase failed", extra={"request_id": request_id})
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    parsed = parse_result.get("parsed") or {}

    # Needs clarification → return questions to frontend
    if parsed.get("needs_clarification"):
        questions = [
            SimpleClarificationQuestion(
                field=q.get("field", ""),
                question=q.get("question", ""),
            )
            for q in (parsed.get("questions") or [])
        ]
        return SimpleCampaignResponse(
            id=request_id,
            status="needs_clarification",
            questions=questions,
        )

    # ── Build structured request and run pipeline ─────────────────────────────
    campaign_data = parsed.get("campaign") or {}
    try:
        campaign_req = _build_campaign_request(campaign_data, brand_context=payload.brand_context)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse campaign fields: {exc}") from exc

    # ── Check cache first ─────────────────────────────────────────────────
    cache_key = campaign_req.model_dump()
    cached = campaign_cache.get(cache_key)
    if cached is not None:
        logger.info("Cache hit", extra={"request_id": request_id})
        return cached

    try:
        campaign_resp = orchestrate_campaign_fast(
            req=campaign_req,
            request_id=request_id,
            client=client,
            campaign_memory=payload.campaign_memory,
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Campaign generation failed", extra={"request_id": request_id})
        raise HTTPException(status_code=503, detail="Campaign generation failed. Please retry.") from exc

    # Handle LLM-requested clarification from phase 1
    if campaign_resp.status.value == "needs_clarification":
        questions = [
            SimpleClarificationQuestion(field=q.field, question=q.question)
            for q in campaign_resp.clarification_questions
        ]
        return SimpleCampaignResponse(
            id=request_id,
            status="needs_clarification",
            questions=questions,
        )

    result = _map_to_simple_response(campaign_req, campaign_resp, request_id)
    campaign_cache.set(cache_key, result)
    return result


@router.post(
    "/edit-email",
    response_model=EmailEditResponse,
    status_code=status.HTTP_200_OK,
    summary="Edit a single email with natural-language instructions",
    description="Regenerates a single email HTML given the current HTML and user instructions.",
)
async def edit_email(
    payload: EmailEditRequest,
    request: Request,
    client: GeminiClient = Depends(get_gemini_client),
) -> EmailEditResponse:
    request_id = _get_request_id(request)
    logger.info("POST /edit-email", extra={"request_id": request_id, "email_id": payload.email_id})

    try:
        result = client.generate_text(
            prompt=prompting.build_edit_email_prompt(
                current_html=payload.current_html,
                subject=payload.subject,
                instructions=payload.instructions,
            ),
            system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
            json_schema=prompting.HTML_OUTPUT_SCHEMA,
            temperature=0.3,
            max_output_tokens=32768,
        )
    except Exception as exc:
        logger.exception("Edit email failed", extra={"request_id": request_id})
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    edit_raw_text = result.get("text", "")
    html = (result.get("parsed") or {}).get("email_html") or _extract_html_from_text(edit_raw_text)
    logger.info(
        "[edit-email] Resolved html — length=%d, source=%s, first 120 chars: %s",
        len(html),
        "parsed" if (result.get("parsed") or {}).get("email_html") else "fallback_extract",
        repr(html[:120]),
    )

    updated_email = SimpleEmail(
        id=payload.email_id,
        subject=payload.subject,
        html_content=html,
        summary=SimpleSummary(),  # summary unchanged for edits
    )
    return EmailEditResponse(email=updated_email)


@router.post(
    "/generate",
    response_model=CampaignResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate a full marketing campaign (structured input)",
    description=(
        "Accepts a CampaignRequest and runs the multi-phase Mark workflow: "
        "Clarify → Research → Strategy → Execution → Production → Critique. "
        "Returns a structured CampaignResponse."
    ),
    responses={
        200: {
            "description": "Campaign generated or clarification requested.",
        },
        422: {"description": "Validation error in the request payload."},
        503: {"description": "Gemini API unavailable."},
    },
)
async def generate_campaign(
    payload: CampaignRequest,
    request: Request,
    client: GeminiClient = Depends(get_gemini_client),
) -> CampaignResponse:
    request_id = _get_request_id(request)
    logger.info(
        "POST /generate",
        extra={
            "request_id": request_id,
            "campaign_name": payload.campaign_name,
        },
    )

    # Pre-generation field validation
    pre_issues = validate_campaign_request(payload)
    errors = [i for i in pre_issues if i.severity == "error"]
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=[
                {"field": i.field, "message": i.message, "suggestion": i.suggestion}
                for i in errors
            ],
        )

    try:
        response = orchestrate_campaign(
            req=payload,
            request_id=request_id,
            client=client,
        )
    except ValueError as exc:
        logger.error("Configuration error: %s", exc, extra={"request_id": request_id})
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        )
    except Exception as exc:
        logger.exception(
            "Unexpected error during campaign generation",
            extra={"request_id": request_id},
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Campaign generation failed. Please retry.",
        ) from exc

    return response


@router.post(
    "/validate",
    response_model=ValidationResponse,
    status_code=status.HTTP_200_OK,
    summary="Validate a campaign request",
    description=(
        "Validates a CampaignRequest (or partial payload) and returns a list of "
        "issues and recommendations WITHOUT generating a full campaign. Fast and free."
    ),
)
async def validate_campaign(
    payload: CampaignRequest,
    request: Request,
) -> ValidationResponse:
    request_id = _get_request_id(request)
    logger.info(
        "POST /validate",
        extra={"request_id": request_id, "campaign_name": payload.campaign_name},
    )

    issues: list[ValidationIssue] = validate_campaign_request(payload)

    recommendations: list[str] = []
    if not issues:
        recommendations.append("Request appears complete. Ready to generate.")
    else:
        error_count = sum(1 for i in issues if i.severity == "error")
        warn_count = sum(1 for i in issues if i.severity == "warning")
        if error_count:
            recommendations.append(
                f"Fix {error_count} error(s) before generating to avoid failures."
            )
        if warn_count:
            recommendations.append(
                f"Address {warn_count} warning(s) to improve output quality."
            )

    return ValidationResponse(
        valid=not any(i.severity == "error" for i in issues),
        issues=issues,
        recommendations=recommendations,
    )


@router.post(
    "/recommend-recipients",
    response_model=RecipientRecommendResponse,
    status_code=status.HTTP_200_OK,
    summary="AI-powered recipient matching",
    description=(
        "Given a list of email variants with their target groups and a HubSpot contacts CSV, "
        "uses Gemini to assign each contact to the most appropriate email variant. "
        "Returns a mapping of email_id → [contact email addresses], plus a brief reasoning string."
    ),
)
async def recommend_recipients(
    payload: RecipientRecommendRequest,
    request: Request,
    client: GeminiClient = Depends(get_gemini_client),
) -> RecipientRecommendResponse:
    request_id = _get_request_id(request)
    logger.info(
        "POST /recommend-recipients",
        extra={"request_id": request_id, "n_emails": len(payload.emails)},
    )

    variants_json = "\n".join(
        f"{i + 1}. id={e.id!r} | subject={e.subject!r} | target_group={e.target_group!r}"
        for i, e in enumerate(payload.emails)
    )

    campaign_context = (
        f"CAMPAIGN PROMPT (original user intent)\n"
        f"==========================================\n"
        f"{payload.campaign_prompt.strip()}\n\n"
    ) if payload.campaign_prompt else ""

    prompt = f"""\
You are a CRM specialist. Your task is to assign HubSpot contacts to the most relevant email variant in a marketing campaign.

{campaign_context}EMAIL VARIANTS
==============
{variants_json}

CONTACTS CSV (firstname,lastname,email,age,membership_level,membership_startdate,city,country)
===========================================================================================
{payload.contacts_csv}

RULES
=====
- Assign each contact to AT MOST ONE variant — the best fit based on their attributes vs the target_group.
- If a contact has no clear match, leave them unassigned.
- Use membership_level, country, city, and age to decide relevance.
- Every valid email address in the CSV should be considered.

Return ONLY valid JSON — no code fences, no prose — in exactly this shape:
{{
  "assignments": {{
    "<email_variant_id>": ["contact@email.com", ...],
    ...
  }},
  "reasoning": "1-2 sentence summary of how you matched contacts."
}}
"""

    try:
        result = client.generate_text(prompt=prompt)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    raw_text = result.get("text", "")
    parsed = result.get("parsed") or {}

    # Try parsed first, then fall back to text extraction
    if not isinstance(parsed.get("assignments"), dict):
        import json as _json
        try:
            # Strip possible markdown fences
            clean = raw_text.strip()
            for fence in ("```json", "```"):
                if clean.startswith(fence):
                    clean = clean[len(fence):].lstrip("\n")
            if clean.endswith("```"):
                clean = clean[:-3].rstrip()
            parsed = _json.loads(clean)
        except Exception:
            parsed = {}

    assignments: dict[str, list[str]] = {}
    valid_ids = {e.id for e in payload.emails}
    raw_assignments = parsed.get("assignments", {})
    if isinstance(raw_assignments, dict):
        for eid, addrs in raw_assignments.items():
            if eid in valid_ids and isinstance(addrs, list):
                assignments[eid] = [a for a in addrs if isinstance(a, str) and "@" in a]

    # Hybrid pass: enforce deterministic constraints + fill gaps via rule-based scoring.
    contacts = _parse_contacts_csv(payload.contacts_csv)
    best_by_email: dict[str, list[tuple[str, int]]] = {e.id: [] for e in payload.emails}
    seen_emails: set[str] = set()

    # Keep AI picks first but de-duplicate globally.
    for eid in list(assignments.keys()):
        cleaned: list[str] = []
        for addr in assignments[eid]:
            email = addr.strip().lower()
            if "@" not in email or email in seen_emails:
                continue
            seen_emails.add(email)
            cleaned.append(email)
        assignments[eid] = cleaned

    # Deterministic supplement for contacts AI left unassigned.
    for contact in contacts:
        addr = (contact.get("email") or "").strip().lower()
        if not addr or "@" not in addr or addr in seen_emails:
            continue
        scored = [
            (variant.id, _deterministic_match_score(variant.target_group, contact))
            for variant in payload.emails
        ]
        scored.sort(key=lambda item: item[1], reverse=True)
        if not scored or scored[0][1] <= 0:
            continue
        best_id, best_score = scored[0]
        best_by_email[best_id].append((addr, best_score))
        seen_emails.add(addr)

    for eid, items in best_by_email.items():
        if not items:
            continue
        assignments.setdefault(eid, [])
        assignments[eid].extend(addr for addr, _ in items)
        assignments[eid] = list(dict.fromkeys(assignments[eid]))

    reasoning = parsed.get("reasoning", "")
    if not isinstance(reasoning, str):
        reasoning = ""
    deterministic_count = sum(len(items) for items in best_by_email.values())
    if deterministic_count:
        reasoning = (
            (reasoning + " " if reasoning else "")
            + f"Deterministic matching added {deterministic_count} contact(s) using geography/membership/age rules."
        )

    logger.info(
        "[recommend-recipients] assigned %d total contacts across %d variants",
        sum(len(v) for v in assignments.values()),
        len(assignments),
    )

    return RecipientRecommendResponse(assignments=assignments, reasoning=reasoning)
