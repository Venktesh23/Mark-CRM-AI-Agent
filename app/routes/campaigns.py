"""
app/routes/campaigns.py – campaign generation and validation endpoints.
"""
from __future__ import annotations

import logging
import re
import uuid
import time
import csv
from io import StringIO
from collections import Counter

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
    ComplianceAssistantRequest,
    ComplianceAssistantResponse,
    ComplianceEmailResult,
    VariantPredictRequest,
    VariantPredictResponse,
    ScoredVariant,
    PerformanceCopilotRequest,
    PerformanceCopilotResponse,
    SegmentDiscoveryRequest,
    SegmentDiscoveryResponse,
    DiscoveredSegment,
    SmartBriefRequest,
    SmartBriefResponse,
    SmartBrief,
    SendTimeOptimizeRequest,
    SendTimeOptimizeResponse,
    SendTimeSuggestion,
    VoiceTrainRequest,
    VoiceTrainResponse,
    VoiceProfile,
    LocalizeCampaignRequest,
    LocalizeCampaignResponse,
    LocalizedEmail,
    RepurposeRequest,
    RepurposeResponse,
    RepurposedAsset,
    OutcomeRecordRequest,
    OutcomeRecord,
    OutcomeRecordResponse,
    MemoryRetrieveRequest,
    MemoryRetrieveResponse,
    MemorySnippet,
    ExperimentStartRequest,
    ExperimentStartResponse,
    ExperimentRecordRequest,
    ExperimentStatusResponse,
    ExperimentVariantStat,
    AgentMetricsResponse,
    AgentMetricItem,
    OrchestrateGrowthRequest,
    OrchestrateGrowthResponse,
    SimpleCampaignResponse,
    SimpleClarificationQuestion,
    SimpleEmail,
    SimpleSummary,
    ValidationIssue,
    ValidationResponse,
)
from app.security.supabase_jwt import require_authenticated_user
from app.services.gemini_client import GeminiClient, get_gemini_client, get_optional_gemini_client
from app.services.orchestrator import orchestrate_campaign, orchestrate_campaign_fast
from app.services.cache import campaign_cache
from app.services import prompting
from app.services.validators import SPAM_TRIGGER_WORDS, validate_campaign_request

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/v1/campaigns",
    tags=["Campaigns"],
    dependencies=[Depends(require_authenticated_user)],
)

_OUTCOME_HISTORY_BY_USER: dict[str, list[OutcomeRecord]] = {}
_MAX_OUTCOME_HISTORY = 250
_EXPERIMENTS_BY_USER: dict[str, dict[str, dict]] = {}
_AGENT_METRICS_BY_USER: dict[str, dict[str, dict[str, float]]] = {}


def _get_request_id(request: Request) -> str:
    return request.state.request_id if hasattr(request.state, "request_id") else str(uuid.uuid4())


def _get_user_id(request: Request) -> str:
    return str(getattr(request.state, "user_id", "dev-user"))


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


def _strip_html(raw: str) -> str:
    return re.sub(r"\s{2,}", " ", re.sub(r"<[^>]+>", " ", raw or "")).strip()


def _score_subject_local(subject: str) -> int:
    s = (subject or "").strip()
    if not s:
        return 0
    score = 50
    if 35 <= len(s) <= 60:
        score += 25
    elif len(s) <= 70:
        score += 10
    lowered = s.lower()
    if any(t in lowered for t in ("free money", "buy now", "$$$", "!!!")):
        score -= 22
    if s.count("!") > 1:
        score -= 8
    if "?" in s:
        score += 4
    return max(0, min(100, score))


def _score_cta_local(cta: str) -> int:
    text = (cta or "").strip()
    if not text:
        return 0
    score = 50
    wc = len(text.split())
    if 1 <= wc <= 4:
        score += 18
    if re.search(r"\b(start|get|shop|claim|explore|join|book|try)\b", text.lower()):
        score += 18
    if len(text) > 28:
        score -= 15
    return max(0, min(100, score))


def _run_compliance_assistant(payload: ComplianceAssistantRequest) -> ComplianceAssistantResponse:
    email_results: list[ComplianceEmailResult] = []
    for email in payload.emails:
        issues: list[str] = []
        flags: list[str] = []
        fixes: list[str] = []
        subject = (email.subject or "").strip()
        subject_lower = subject.lower()
        text = _strip_html(email.html_content)
        lowered = text.lower()

        if "unsubscribe" not in lowered:
            flags.append("COMPLIANCE: Missing unsubscribe link/text.")
            fixes.append("Add an unsubscribe link in the footer.")
        if "privacy" not in lowered:
            issues.append("Privacy notice is not visible.")
            fixes.append("Add a privacy policy reference in the footer.")

        for phrase in payload.banned_phrases:
            phrase_l = phrase.lower() if phrase else ""
            if phrase_l and (phrase_l in lowered or phrase_l in subject_lower):
                flags.append(f"BRAND SAFETY: Banned phrase '{phrase}' detected in subject/body.")
                fixes.append(f"Replace banned phrase '{phrase}'.")

        for phrase in payload.required_phrases:
            phrase_l = phrase.lower() if phrase else ""
            if phrase_l and (phrase_l not in lowered and phrase_l not in subject_lower):
                issues.append(f"Required phrase '{phrase}' missing from subject/body.")
                fixes.append(f"Include required phrase '{phrase}' naturally in the copy.")

        if payload.legal_footer:
            footer_snippet = payload.legal_footer[:30].lower()
            if footer_snippet not in lowered:
                flags.append("COMPLIANCE: Required legal footer appears missing.")
                fixes.append("Insert configured legal footer verbatim.")

        if text.count("!") > 3:
            issues.append("High exclamation mark count may increase spam risk.")
            fixes.append("Reduce exclamation marks to three or fewer.")

        matched_spam = [word for word in SPAM_TRIGGER_WORDS if word in lowered]
        if matched_spam:
            issues.append(f"Potential spam triggers found: {matched_spam[:4]}")
            fixes.append("Rephrase spam-like wording to reduce deliverability risk.")

        subject_spam = [word for word in SPAM_TRIGGER_WORDS if word in subject_lower]
        if subject_spam:
            flags.append(f"SUBJECT SPAM RISK: Subject contains spam triggers {subject_spam[:3]}.")
            fixes.append("Rewrite subject to remove spam-trigger phrases.")

        if len(subject) > 60:
            issues.append("Subject line exceeds 60 characters.")
            fixes.append("Shorten the subject line to <=60 characters.")
        if subject.count("!") > 1 or subject.isupper():
            issues.append("Subject formatting may hurt deliverability (ALL CAPS / excessive punctuation).")
            fixes.append("Use normal title case and at most one exclamation mark.")

        score = max(0, 100 - (len(issues) * 4 + len(flags) * 8))
        email_results.append(
            ComplianceEmailResult(
                id=email.id,
                issues=issues,
                risk_flags=flags,
                fixes=list(dict.fromkeys(fixes)),
                score=score,
            )
        )

    overall = min((item.score for item in email_results), default=100)
    passed = all(len(item.risk_flags) == 0 for item in email_results)
    summary = (
        "All pre-send compliance checks passed."
        if passed
        else "One or more high-risk compliance/spam issues require fixes before send."
    )
    return ComplianceAssistantResponse(
        passed=passed,
        overall_score=overall,
        summary=summary,
        emails=email_results,
    )


_COUNTRY_TO_TIMEZONE: dict[str, str] = {
    "sweden": "Europe/Stockholm",
    "norway": "Europe/Oslo",
    "denmark": "Europe/Copenhagen",
    "finland": "Europe/Helsinki",
    "germany": "Europe/Berlin",
    "france": "Europe/Paris",
    "spain": "Europe/Madrid",
    "italy": "Europe/Rome",
    "netherlands": "Europe/Amsterdam",
    "uk": "Europe/London",
    "united kingdom": "Europe/London",
    "ireland": "Europe/Dublin",
    "india": "Asia/Kolkata",
    "uae": "Asia/Dubai",
    "singapore": "Asia/Singapore",
    "australia": "Australia/Sydney",
    "new zealand": "Pacific/Auckland",
    "japan": "Asia/Tokyo",
    "south korea": "Asia/Seoul",
    "canada": "America/Toronto",
    "usa": "America/New_York",
    "united states": "America/New_York",
    "mexico": "America/Mexico_City",
    "brazil": "America/Sao_Paulo",
}


def _safe_segment_id(prefix: str, name: str) -> str:
    return f"{prefix}_{re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')}"[:80]


def _infer_timezone(contacts: list[dict[str, str]]) -> str:
    countries = Counter((c.get("country") or "").strip().lower() for c in contacts if c.get("country"))
    if not countries:
        return "UTC"
    country = countries.most_common(1)[0][0]
    return _COUNTRY_TO_TIMEZONE.get(country, "UTC")


def _build_field_summary(contacts: list[dict[str, str]], field: str, max_items: int = 6) -> str:
    values = [
        (c.get(field) or "").strip()
        for c in contacts
        if (c.get(field) or "").strip()
    ]
    if not values:
        return f"{field}: no data"
    counts = Counter(values)
    tops = ", ".join(f"{k} ({v})" for k, v in counts.most_common(max_items))
    return f"{field}: {tops}"


def _build_seed_segments(contacts: list[dict[str, str]], max_segments: int) -> list[DiscoveredSegment]:
    with_email = [c for c in contacts if "@" in (c.get("email") or "")]
    if not with_email:
        return []

    segments: list[DiscoveredSegment] = []
    all_emails = list(dict.fromkeys((c.get("email") or "").strip().lower() for c in with_email))
    segments.append(
        DiscoveredSegment(
            id="cluster_all",
            name="All CRM Contacts",
            filter_label=f"all contacts · {len(all_emails)} recipients",
            description="Complete reachable audience from CRM contacts.",
            emails=all_emails,
            confidence=100,
            recommended_for="Broad announcements and baseline campaigns.",
        )
    )

    def add_group(field: str, label_fn) -> None:
        groups: dict[str, list[str]] = {}
        for contact in with_email:
            key = (contact.get(field) or "").strip()
            email = (contact.get("email") or "").strip().lower()
            if not key or "@" not in email:
                continue
            groups.setdefault(key, []).append(email)
        for key, emails in sorted(groups.items(), key=lambda item: len(item[1]), reverse=True):
            uniq = list(dict.fromkeys(emails))
            if len(uniq) < 3:
                continue
            name = label_fn(key)
            segments.append(
                DiscoveredSegment(
                    id=_safe_segment_id("cluster", f"{field}_{key}"),
                    name=name,
                    filter_label=f"{field}: {key} · {len(uniq)} contacts",
                    description=f"Contacts grouped by {field}={key}.",
                    emails=uniq,
                    confidence=74,
                    recommended_for=f"Campaigns targeting {name.lower()}",
                )
            )
            if len(segments) >= max_segments:
                return

    add_group("membership_level", lambda key: f"{key} Members")
    if len(segments) < max_segments:
        add_group("country", lambda key: f"{key} Audience")
    if len(segments) < max_segments:
        add_group("city", lambda key: f"{key} City Audience")

    return segments[:max_segments]


def _heuristic_send_hour(target_group: str) -> int:
    text = (target_group or "").lower()
    if any(word in text for word in ("student", "young", "gen z", "night")):
        return 19
    if any(word in text for word in ("professional", "b2b", "working", "executive")):
        return 10
    if any(word in text for word in ("senior", "retired", "retire")):
        return 11
    return 9


def _summarize_voice_tokens(samples: list[str]) -> tuple[list[str], list[str]]:
    words: Counter[str] = Counter()
    for sample in samples:
        cleaned = _strip_html(sample).lower()
        tokens = re.findall(r"[a-z]{4,}", cleaned)
        for token in tokens:
            if token in {"this", "that", "with", "from", "your", "have", "will", "campaign", "email"}:
                continue
            words[token] += 1
    top = [word for word, _ in words.most_common(12)]
    return top[:8], top[8:12]


def _localize_subject_local(subject: str, language: str) -> str:
    if language.lower().startswith("swed"):
        return f"[SV] {subject}"
    if language.lower().startswith("span"):
        return f"[ES] {subject}"
    if language.lower().startswith("fren"):
        return f"[FR] {subject}"
    if language.lower().startswith("germ"):
        return f"[DE] {subject}"
    return f"[{language[:2].upper()}] {subject}" if language else subject


def _repurpose_local(channels: list[str], emails: list[dict[str, str]]) -> list[RepurposedAsset]:
    assets: list[RepurposedAsset] = []
    first = emails[0] if emails else {"subject": "Campaign", "target_group": "audience"}
    for channel in channels:
        ch = channel.strip().lower()
        if ch in {"social", "social_post", "linkedin", "x", "twitter"}:
            assets.append(
                RepurposedAsset(
                    channel=channel,
                    title=f"{first.get('subject', 'Campaign')} — Social",
                    body=(
                        f"New campaign update for {first.get('target_group', 'our audience')}. "
                        "Short, value-led message with one clear CTA."
                    ),
                    cta="Learn more",
                )
            )
        elif ch in {"sms", "text"}:
            assets.append(
                RepurposedAsset(
                    channel=channel,
                    title="SMS Variant",
                    body=f"{first.get('subject', 'Offer')}. Limited-time update. Reply STOP to opt out.",
                    cta="Shop now",
                )
            )
        else:
            assets.append(
                RepurposedAsset(
                    channel=channel,
                    title=f"{channel.title()} Asset",
                    body=f"Repurposed message for {channel} based on campaign '{first.get('subject', 'Campaign')}'.",
                    cta="Get started",
                )
            )
    return assets


def _extract_cta_candidates(html: str) -> list[str]:
    candidates = []
    for match in re.findall(r"<a\b[^>]*>(.*?)</a>", html or "", flags=re.IGNORECASE | re.DOTALL):
        cleaned = re.sub(r"<[^>]+>", " ", match)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if cleaned:
            candidates.append(cleaned)
    return list(dict.fromkeys(candidates))[:8]


def _score_outcome(record: OutcomeRecordRequest) -> int:
    score = 40
    for val, weight in (
        (record.open_rate, 20),
        (record.click_rate, 25),
        (record.conversion_rate, 35),
    ):
        if val is not None:
            score += max(0, min(100, int(val * 100))) * weight // 100
    if record.subject.strip():
        score += 5
    if record.cta.strip():
        score += 5
    return max(0, min(100, score))


def _memory_tags(item: OutcomeRecord) -> list[str]:
    tags: list[str] = []
    for raw in (item.audience, item.segment, item.language):
        value = (raw or "").strip().lower()
        if not value:
            continue
        tags.extend(re.findall(r"[a-z0-9_]+", value)[:3])
    return list(dict.fromkeys(tags))


def _memory_match_score(item: OutcomeRecord, query: MemoryRetrieveRequest) -> int:
    score = item.score
    query_blob = " ".join([query.prompt, query.audience, query.objective]).lower()
    item_blob = " ".join(
        [item.prompt, item.audience, item.subject, item.segment, item.notes, item.language]
    ).lower()
    for token in re.findall(r"[a-z0-9_]{3,}", query_blob):
        if token in item_blob:
            score += 4
    return min(100, score)


def _track_agent(user_id: str, agent: str, status: str, latency_ms: float = 0.0) -> None:
    metrics = _AGENT_METRICS_BY_USER.setdefault(user_id, {})
    bucket = metrics.setdefault(
        agent,
        {"calls": 0.0, "success": 0.0, "fallback": 0.0, "latency_total_ms": 0.0},
    )
    bucket["calls"] += 1
    if status == "success":
        bucket["success"] += 1
    if status == "fallback":
        bucket["fallback"] += 1
    bucket["latency_total_ms"] += max(0.0, latency_ms)


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


@router.post(
    "/compliance-assistant",
    response_model=ComplianceAssistantResponse,
    status_code=status.HTTP_200_OK,
    summary="Pre-send compliance/spam/risk checks",
)
async def compliance_assistant(
    payload: ComplianceAssistantRequest,
    request: Request,
) -> ComplianceAssistantResponse:
    request_id = _get_request_id(request)
    logger.info(
        "POST /compliance-assistant",
        extra={"request_id": request_id, "n_emails": len(payload.emails)},
    )
    return _run_compliance_assistant(payload)


@router.post(
    "/predict-variants",
    response_model=VariantPredictResponse,
    status_code=status.HTTP_200_OK,
    summary="A/B subject and CTA predictor",
)
async def predict_variants(
    payload: VariantPredictRequest,
    request: Request,
    client: GeminiClient = Depends(get_gemini_client),
) -> VariantPredictResponse:
    request_id = _get_request_id(request)
    logger.info("POST /predict-variants", extra={"request_id": request_id})

    subject_options = [s.strip() for s in payload.subject_options if s and s.strip()]
    cta_options = [s.strip() for s in payload.cta_options if s and s.strip()]
    if not subject_options:
        raise HTTPException(status_code=422, detail="subject_options must include at least one option.")

    fallback_subjects = [
        ScoredVariant(text=s, score=_score_subject_local(s), rationale="Heuristic relevance/clarity score.")
        for s in subject_options
    ]
    fallback_subjects.sort(key=lambda item: item.score, reverse=True)
    fallback_ctas = [
        ScoredVariant(text=c, score=_score_cta_local(c), rationale="Heuristic actionability score.")
        for c in cta_options
    ]
    fallback_ctas.sort(key=lambda item: item.score, reverse=True)

    try:
        result = client.generate_text(
            prompt=prompting.build_variant_predict_prompt(
                subject_options=subject_options,
                cta_options=cta_options,
                audience=payload.audience,
                offer=payload.offer,
                objective=payload.objective,
            ),
            system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
            json_schema=prompting.VARIANT_PREDICT_SCHEMA,
            temperature=0.2,
        )
        parsed = result.get("parsed") or {}
        ai_subjects = [
            ScoredVariant(
                text=str(item.get("text", "")).strip(),
                score=max(0, min(100, int(item.get("score", 0)))),
                rationale=str(item.get("rationale", "")).strip(),
            )
            for item in parsed.get("subjects", [])
            if isinstance(item, dict) and str(item.get("text", "")).strip()
        ]
        ai_ctas = [
            ScoredVariant(
                text=str(item.get("text", "")).strip(),
                score=max(0, min(100, int(item.get("score", 0)))),
                rationale=str(item.get("rationale", "")).strip(),
            )
            for item in parsed.get("ctas", [])
            if isinstance(item, dict) and str(item.get("text", "")).strip()
        ]

        if ai_subjects:
            ai_subjects.sort(key=lambda item: item.score, reverse=True)
            fallback_subjects = ai_subjects
        if ai_ctas:
            ai_ctas.sort(key=lambda item: item.score, reverse=True)
            fallback_ctas = ai_ctas

        best_subject = str(parsed.get("best_subject", "")).strip() or fallback_subjects[0].text
        best_cta = (
            str(parsed.get("best_cta", "")).strip()
            or (fallback_ctas[0].text if fallback_ctas else "")
        )
        return VariantPredictResponse(
            best_subject=best_subject,
            best_cta=best_cta,
            subjects=fallback_subjects,
            ctas=fallback_ctas,
        )
    except Exception:
        logger.exception("predict-variants AI call failed, using fallback")
        return VariantPredictResponse(
            best_subject=fallback_subjects[0].text,
            best_cta=fallback_ctas[0].text if fallback_ctas else "",
            subjects=fallback_subjects,
            ctas=fallback_ctas,
        )


@router.post(
    "/performance-copilot",
    response_model=PerformanceCopilotResponse,
    status_code=status.HTTP_200_OK,
    summary="Post-send performance copilot insights",
)
async def performance_copilot(
    payload: PerformanceCopilotRequest,
    request: Request,
    client: GeminiClient = Depends(get_gemini_client),
) -> PerformanceCopilotResponse:
    request_id = _get_request_id(request)
    logger.info("POST /performance-copilot", extra={"request_id": request_id})

    delivered = max(payload.sent_count, 0)
    fallback = PerformanceCopilotResponse(
        summary=(
            f"Delivered {delivered} emails with {payload.failed_count} failures. "
            "Use this as a baseline and iterate on subject/CTA for the next send."
        ),
        wins=[
            "Campaign executed and produced real delivery data.",
            "Audience targeting can now be tuned with observed send outcomes.",
        ],
        risks=[
            "Failure count may indicate invalid addresses or provider throttling.",
            "Open/click metrics are missing; optimization decisions are partly speculative.",
        ],
        next_actions=[
            "Retry failed addresses after cleaning invalid domains.",
            "Run an A/B follow-up with the top predicted subject line.",
            "Track open and click rates in the next batch to calibrate copy quality.",
        ],
    )

    try:
        result = client.generate_text(
            prompt=prompting.build_performance_copilot_prompt(
                campaign_name=payload.campaign_name,
                prompt=payload.prompt,
                sent_count=payload.sent_count,
                failed_count=payload.failed_count,
                open_rate=payload.open_rate,
                click_rate=payload.click_rate,
                notes=payload.notes,
            ),
            system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
            json_schema=prompting.PERFORMANCE_COPILOT_SCHEMA,
            temperature=0.2,
        )
        parsed = result.get("parsed") or {}
        summary = str(parsed.get("summary", "")).strip()
        wins = [str(w).strip() for w in parsed.get("wins", []) if str(w).strip()]
        risks = [str(r).strip() for r in parsed.get("risks", []) if str(r).strip()]
        next_actions = [str(a).strip() for a in parsed.get("next_actions", []) if str(a).strip()]
        if not summary or not next_actions:
            return fallback
        return PerformanceCopilotResponse(
            summary=summary,
            wins=wins[:4],
            risks=risks[:4],
            next_actions=next_actions[:5],
        )
    except Exception:
        logger.exception("performance-copilot AI call failed, using fallback")
        return fallback


@router.post(
    "/discover-segments",
    response_model=SegmentDiscoveryResponse,
    status_code=status.HTTP_200_OK,
    summary="Discover CRM audience segments (AI + rules)",
)
async def discover_segments(
    payload: SegmentDiscoveryRequest,
    request: Request,
    client: GeminiClient | None = Depends(get_optional_gemini_client),
) -> SegmentDiscoveryResponse:
    request_id = _get_request_id(request)
    logger.info("POST /discover-segments", extra={"request_id": request_id})
    contacts = _parse_contacts_csv(payload.contacts_csv)
    if not contacts:
        return SegmentDiscoveryResponse(segments=[], reasoning="No contacts available in CSV.")

    seeds = _build_seed_segments(contacts, payload.max_segments)
    if not seeds:
        return SegmentDiscoveryResponse(segments=[], reasoning="No valid contact emails found in CSV.")

    field_summaries = [
        _build_field_summary(contacts, "membership_level"),
        _build_field_summary(contacts, "country"),
        _build_field_summary(contacts, "city"),
        _build_field_summary(contacts, "age"),
    ]
    sample_contacts = []
    for contact in contacts[:12]:
        sample_contacts.append(
            ", ".join(
                filter(
                    None,
                    [
                        contact.get("membership_level", ""),
                        contact.get("country", ""),
                        contact.get("city", ""),
                        contact.get("age", ""),
                    ],
                )
            )
        )
    reasoning = "Generated deterministic CRM segments."

    if client is not None:
        try:
            ai = client.generate_text(
                prompt=prompting.build_segment_discovery_prompt(
                    campaign_prompt=payload.campaign_prompt,
                    field_summaries=field_summaries,
                    sample_contacts=sample_contacts,
                    max_segments=payload.max_segments,
                ),
                system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
                json_schema=prompting.SEGMENT_DISCOVERY_SCHEMA,
                temperature=0.2,
            )
            parsed = ai.get("parsed") or {}
            ideas = parsed.get("segments", [])
            reasoning = str(parsed.get("reasoning", "")).strip() or reasoning
            if isinstance(ideas, list):
                ai_items = [item for item in ideas if isinstance(item, dict)]
                for i in range(min(len(ai_items), max(0, len(seeds) - 1))):
                    seed = seeds[i + 1]  # keep "All Contacts" stable
                    item = ai_items[i]
                    seed.name = str(item.get("name", "")).strip() or seed.name
                    seed.description = str(item.get("description", "")).strip() or seed.description
                    seed.recommended_for = (
                        str(item.get("recommended_for", "")).strip() or seed.recommended_for
                    )
                    seed.confidence = min(95, max(60, seed.confidence + 8))
        except Exception:
            logger.exception("discover-segments AI step failed, returning deterministic segments")

    return SegmentDiscoveryResponse(segments=seeds[: payload.max_segments], reasoning=reasoning)


@router.post(
    "/smart-brief",
    response_model=SmartBriefResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate a structured campaign brief from prompt",
)
async def smart_brief(
    payload: SmartBriefRequest,
    request: Request,
    client: GeminiClient | None = Depends(get_optional_gemini_client),
) -> SmartBriefResponse:
    request_id = _get_request_id(request)
    logger.info("POST /smart-brief", extra={"request_id": request_id})

    fallback = SmartBrief(
        campaign_name="AI Generated Campaign Brief",
        objective="Drive campaign performance with a clear value proposition.",
        target_audience="General customer audience",
        offer="Special offer",
        primary_kpi="revenue",
        geo_scope="Global",
        language="English",
        tone="Professional and friendly",
        compliance_notes="Include unsubscribe and privacy references.",
        send_window="Next 7 days",
        number_of_emails=3,
        key_points=[],
        assumptions=["ASSUMPTION: Missing details should be refined before final send."],
    )
    questions = [
        "What exact offer should the campaign highlight?",
        "Which audience segment is most important for this campaign?",
    ]

    if client is None:
        return SmartBriefResponse(brief=fallback, questions=questions)
    try:
        result = client.generate_text(
            prompt=prompting.build_smart_brief_prompt(payload.prompt),
            system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
            json_schema=prompting.SMART_BRIEF_SCHEMA,
            temperature=0.2,
        )
        parsed = result.get("parsed") or {}
        brief_obj = parsed.get("brief", {})
        brief = SmartBrief(
            campaign_name=str(brief_obj.get("campaign_name", "")).strip() or fallback.campaign_name,
            objective=str(brief_obj.get("objective", "")).strip() or fallback.objective,
            target_audience=str(brief_obj.get("target_audience", "")).strip() or fallback.target_audience,
            offer=str(brief_obj.get("offer", "")).strip() or fallback.offer,
            primary_kpi=str(brief_obj.get("primary_kpi", "")).strip() or fallback.primary_kpi,
            geo_scope=str(brief_obj.get("geo_scope", "")).strip() or fallback.geo_scope,
            language=str(brief_obj.get("language", "")).strip() or fallback.language,
            tone=str(brief_obj.get("tone", "")).strip() or fallback.tone,
            compliance_notes=str(brief_obj.get("compliance_notes", "")).strip() or fallback.compliance_notes,
            send_window=str(brief_obj.get("send_window", "")).strip() or fallback.send_window,
            number_of_emails=max(1, min(10, int(brief_obj.get("number_of_emails", fallback.number_of_emails)))),
            key_points=[str(k).strip() for k in brief_obj.get("key_points", []) if str(k).strip()][:8],
            assumptions=[str(a).strip() for a in brief_obj.get("assumptions", []) if str(a).strip()][:8],
        )
        q = [str(item).strip() for item in parsed.get("questions", []) if str(item).strip()]
        return SmartBriefResponse(brief=brief, questions=q[:5])
    except Exception:
        logger.exception("smart-brief AI step failed, returning fallback")
        return SmartBriefResponse(brief=fallback, questions=questions)


@router.post(
    "/optimize-send-times",
    response_model=SendTimeOptimizeResponse,
    status_code=status.HTTP_200_OK,
    summary="Optimize send times using rules + AI",
)
async def optimize_send_times(
    payload: SendTimeOptimizeRequest,
    request: Request,
    client: GeminiClient | None = Depends(get_optional_gemini_client),
) -> SendTimeOptimizeResponse:
    request_id = _get_request_id(request)
    logger.info("POST /optimize-send-times", extra={"request_id": request_id})
    contacts = _parse_contacts_csv(payload.contacts_csv)
    timezone = _infer_timezone(contacts)

    base: list[SendTimeSuggestion] = []
    for variant in payload.emails:
        hour = _heuristic_send_hour(variant.target_group)
        window = f"{max(0, hour-1):02d}:00-{min(23, hour+1):02d}:59"
        base.append(
            SendTimeSuggestion(
                email_id=variant.email_id,
                timezone=timezone,
                local_window=window,
                recommended_hour_local=hour,
                rationale=(
                    f"Rule-based estimate for audience '{variant.target_group}' "
                    f"with {variant.recipient_count} recipients."
                ),
            )
        )

    if not base:
        return SendTimeOptimizeResponse(suggestions=[], global_reasoning="No email variants provided.")

    if client is not None:
        try:
            base_recommendations = [
                f"{item.email_id}: {item.recommended_hour_local}:00 local ({item.rationale})" for item in base
            ]
            ai = client.generate_text(
                prompt=prompting.build_send_time_prompt(
                    campaign_prompt=payload.campaign_prompt,
                    dominant_timezone=timezone,
                    base_recommendations=base_recommendations,
                ),
                system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
                json_schema=prompting.SEND_TIME_SCHEMA,
                temperature=0.2,
            )
            parsed = ai.get("parsed") or {}
            adjustments = parsed.get("adjustments", [])
            by_id = {item.email_id: item for item in base}
            if isinstance(adjustments, list):
                for adj in adjustments:
                    if not isinstance(adj, dict):
                        continue
                    email_id = str(adj.get("email_id", "")).strip()
                    if email_id not in by_id:
                        continue
                    try:
                        hour = int(adj.get("recommended_hour_local"))
                    except Exception:
                        continue
                    hour = min(23, max(0, hour))
                    current = by_id[email_id]
                    current.recommended_hour_local = hour
                    current.local_window = f"{max(0, hour-1):02d}:00-{min(23, hour+1):02d}:59"
                    rationale = str(adj.get("rationale", "")).strip()
                    if rationale:
                        current.rationale = rationale
            global_reasoning = str(parsed.get("global_reasoning", "")).strip() or (
                f"Recommendations balanced by target segment and dominant timezone ({timezone})."
            )
            return SendTimeOptimizeResponse(suggestions=base, global_reasoning=global_reasoning)
        except Exception:
            logger.exception("optimize-send-times AI step failed, returning deterministic suggestions")
    return SendTimeOptimizeResponse(
        suggestions=base,
        global_reasoning=f"Rule-based recommendations generated with dominant timezone {timezone}.",
    )


@router.post(
    "/voice-train",
    response_model=VoiceTrainResponse,
    status_code=status.HTTP_200_OK,
    summary="Train brand voice profile from approved campaigns",
)
async def train_voice_profile(
    payload: VoiceTrainRequest,
    request: Request,
    client: GeminiClient | None = Depends(get_optional_gemini_client),
) -> VoiceTrainResponse:
    request_id = _get_request_id(request)
    logger.info("POST /voice-train", extra={"request_id": request_id})

    samples = [s for s in (payload.campaign_examples + payload.approved_html_samples) if s and s.strip()]
    top_words, backup_words = _summarize_voice_tokens(samples)
    fallback_profile = VoiceProfile(
        style_summary=(
            payload.current_voice.strip()
            or f"{payload.brand_name or 'Brand'} voice is practical, clear, and benefits-first."
        ),
        do_list=[
            "Lead with user value in the first sentence.",
            "Keep CTA language specific and action-oriented.",
            "Use concise sentences and concrete claims.",
        ],
        dont_list=[
            "Avoid exaggerated superlatives or hype wording.",
            "Avoid vague claims without context.",
            "Avoid inconsistent tone across variants.",
        ],
        vocabulary=top_words or ["benefit", "members", "offer", "save"],
        sample_lines=[
            f"{payload.brand_name or 'Our brand'} members get priority access.",
            "Start today with a clear, low-friction next step.",
            "See what is included and choose what fits your goals.",
        ],
        confidence=72 if samples else 55,
    )
    fallback_reasoning = "Voice profile inferred from available approved campaigns and brand guidance."

    if client is None:
        return VoiceTrainResponse(profile=fallback_profile, reasoning=fallback_reasoning)

    try:
        result = client.generate_text(
            prompt=prompting.build_voice_train_prompt(
                brand_name=payload.brand_name,
                current_voice=payload.current_voice,
                campaign_examples=payload.campaign_examples,
                approved_html_samples=payload.approved_html_samples,
            ),
            system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
            json_schema=prompting.VOICE_TRAIN_SCHEMA,
            temperature=0.2,
        )
        parsed = result.get("parsed") or {}
        p = parsed.get("profile", {})
        profile = VoiceProfile(
            style_summary=str(p.get("style_summary", "")).strip() or fallback_profile.style_summary,
            do_list=[str(v).strip() for v in p.get("do_list", []) if str(v).strip()][:8] or fallback_profile.do_list,
            dont_list=[str(v).strip() for v in p.get("dont_list", []) if str(v).strip()][:8] or fallback_profile.dont_list,
            vocabulary=[str(v).strip() for v in p.get("vocabulary", []) if str(v).strip()][:12]
            or (top_words + backup_words)
            or fallback_profile.vocabulary,
            sample_lines=[str(v).strip() for v in p.get("sample_lines", []) if str(v).strip()][:6]
            or fallback_profile.sample_lines,
            confidence=max(0, min(100, int(p.get("confidence", fallback_profile.confidence)))),
        )
        reasoning = str(parsed.get("reasoning", "")).strip() or fallback_reasoning
        return VoiceTrainResponse(profile=profile, reasoning=reasoning)
    except Exception:
        logger.exception("voice-train AI step failed, returning fallback")
        return VoiceTrainResponse(profile=fallback_profile, reasoning=fallback_reasoning)


@router.post(
    "/localize-campaign",
    response_model=LocalizeCampaignResponse,
    status_code=status.HTTP_200_OK,
    summary="Localize generated emails for language/region",
)
async def localize_campaign(
    payload: LocalizeCampaignRequest,
    request: Request,
    client: GeminiClient | None = Depends(get_optional_gemini_client),
) -> LocalizeCampaignResponse:
    request_id = _get_request_id(request)
    logger.info("POST /localize-campaign", extra={"request_id": request_id, "n_emails": len(payload.emails)})

    if not payload.emails:
        return LocalizeCampaignResponse(
            language=payload.language,
            region=payload.region,
            emails=[],
            reasoning="No emails provided for localization.",
        )

    fallback_emails = [
        LocalizedEmail(
            id=email.id,
            subject=_localize_subject_local(email.subject, payload.language),
            html_content=email.html_content,
            notes=(
                f"Fallback localization for {payload.language}"
                + (f" ({payload.region})" if payload.region else "")
            ),
        )
        for email in payload.emails
    ]
    fallback_reasoning = "Applied deterministic fallback localization while preserving original HTML."

    if client is None:
        return LocalizeCampaignResponse(
            language=payload.language,
            region=payload.region,
            emails=fallback_emails,
            reasoning=fallback_reasoning,
        )

    try:
        payload_rows = [
            {
                "id": email.id,
                "subject": email.subject,
                "target_group": email.target_group,
                "html": email.html_content,
            }
            for email in payload.emails
        ]
        result = client.generate_text(
            prompt=prompting.build_localize_prompt(
                language=payload.language,
                region=payload.region,
                brand_voice=payload.brand_voice,
                legal_footer=payload.legal_footer,
                emails=payload_rows,
            ),
            system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
            json_schema=prompting.LOCALIZE_SCHEMA,
            temperature=0.2,
        )
        parsed = result.get("parsed") or {}
        returned = parsed.get("emails", [])
        by_id: dict[str, LocalizedEmail] = {}
        if isinstance(returned, list):
            for item in returned:
                if not isinstance(item, dict):
                    continue
                email_id = str(item.get("id", "")).strip()
                if not email_id:
                    continue
                by_id[email_id] = LocalizedEmail(
                    id=email_id,
                    subject=str(item.get("subject", "")).strip(),
                    html_content=str(item.get("html_content", "")).strip(),
                    notes=str(item.get("notes", "")).strip(),
                )
        localized: list[LocalizedEmail] = []
        for fallback in fallback_emails:
            candidate = by_id.get(fallback.id)
            if candidate and candidate.subject and candidate.html_content:
                localized.append(candidate)
            else:
                localized.append(fallback)
        reasoning = str(parsed.get("reasoning", "")).strip() or fallback_reasoning
        return LocalizeCampaignResponse(
            language=payload.language,
            region=payload.region,
            emails=localized,
            reasoning=reasoning,
        )
    except Exception:
        logger.exception("localize-campaign AI step failed, returning fallback")
        return LocalizeCampaignResponse(
            language=payload.language,
            region=payload.region,
            emails=fallback_emails,
            reasoning=fallback_reasoning,
        )


@router.post(
    "/repurpose-content",
    response_model=RepurposeResponse,
    status_code=status.HTTP_200_OK,
    summary="Repurpose campaign emails into multi-channel assets",
)
async def repurpose_content(
    payload: RepurposeRequest,
    request: Request,
    client: GeminiClient | None = Depends(get_optional_gemini_client),
) -> RepurposeResponse:
    request_id = _get_request_id(request)
    logger.info("POST /repurpose-content", extra={"request_id": request_id, "n_channels": len(payload.channels)})
    channels = [c.strip() for c in payload.channels if c and c.strip()]
    if not channels:
        channels = ["social_post"]
    email_rows = [
        {"id": e.id, "subject": e.subject, "target_group": e.target_group, "html": e.html_content}
        for e in payload.emails
    ]
    fallback_assets = _repurpose_local(channels, email_rows)
    fallback_reasoning = "Generated deterministic repurposed assets per requested channel."

    if client is None:
        return RepurposeResponse(assets=fallback_assets, reasoning=fallback_reasoning)

    try:
        result = client.generate_text(
            prompt=prompting.build_repurpose_prompt(
                campaign_name=payload.campaign_name,
                objective=payload.objective,
                channels=channels,
                emails=email_rows,
            ),
            system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
            json_schema=prompting.REPURPOSE_SCHEMA,
            temperature=0.2,
        )
        parsed = result.get("parsed") or {}
        assets = []
        raw_assets = parsed.get("assets", [])
        if isinstance(raw_assets, list):
            for item in raw_assets:
                if not isinstance(item, dict):
                    continue
                channel = str(item.get("channel", "")).strip()
                title = str(item.get("title", "")).strip()
                body = str(item.get("body", "")).strip()
                cta = str(item.get("cta", "")).strip()
                if not channel or not title or not body:
                    continue
                assets.append(RepurposedAsset(channel=channel, title=title, body=body, cta=cta))
        if not assets:
            assets = fallback_assets
        reasoning = str(parsed.get("reasoning", "")).strip() or fallback_reasoning
        return RepurposeResponse(assets=assets[:24], reasoning=reasoning)
    except Exception:
        logger.exception("repurpose-content AI step failed, returning fallback")
        return RepurposeResponse(assets=fallback_assets, reasoning=fallback_reasoning)


@router.post(
    "/record-outcome",
    response_model=OutcomeRecordResponse,
    status_code=status.HTTP_200_OK,
    summary="Record post-send outcome for learning loop",
)
async def record_outcome(
    payload: OutcomeRecordRequest,
    request: Request,
) -> OutcomeRecordResponse:
    request_id = _get_request_id(request)
    user_id = _get_user_id(request)
    logger.info("POST /record-outcome", extra={"request_id": request_id})
    score = _score_outcome(payload)
    row = OutcomeRecord(
        id=str(uuid.uuid4()),
        campaign_name=payload.campaign_name,
        prompt=payload.prompt,
        audience=payload.audience,
        subject=payload.subject,
        cta=payload.cta,
        open_rate=payload.open_rate,
        click_rate=payload.click_rate,
        conversion_rate=payload.conversion_rate,
        language=payload.language,
        segment=payload.segment,
        notes=payload.notes,
        score=score,
    )
    history = _OUTCOME_HISTORY_BY_USER.setdefault(user_id, [])
    history.append(row)
    if len(history) > _MAX_OUTCOME_HISTORY:
        del history[:-_MAX_OUTCOME_HISTORY]
    _track_agent(user_id, "closed_loop_learning", "success")
    return OutcomeRecordResponse(stored=True, score=score, total_records=len(history))


@router.post(
    "/retrieve-memory",
    response_model=MemoryRetrieveResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve structured campaign memory snippets",
)
async def retrieve_memory(
    payload: MemoryRetrieveRequest,
    request: Request,
) -> MemoryRetrieveResponse:
    request_id = _get_request_id(request)
    user_id = _get_user_id(request)
    logger.info("POST /retrieve-memory", extra={"request_id": request_id})
    history = _OUTCOME_HISTORY_BY_USER.get(user_id, [])
    if not history:
        _track_agent(user_id, "structured_memory", "fallback")
        return MemoryRetrieveResponse(snippets=[], reasoning="No historical outcomes recorded yet.")

    ranked = sorted(
        history,
        key=lambda item: _memory_match_score(item, payload),
        reverse=True,
    )[: payload.limit]

    snippets = [
        MemorySnippet(
            snippet=(
                f"{item.campaign_name or 'Campaign'} | audience={item.audience or 'general'} | "
                f"subject='{item.subject}' | cta='{item.cta}' | score={item.score}"
            ),
            score=_memory_match_score(item, payload),
            tags=_memory_tags(item),
        )
        for item in ranked
    ]
    _track_agent(user_id, "structured_memory", "success")
    return MemoryRetrieveResponse(
        snippets=snippets,
        reasoning=f"Returned top {len(snippets)} snippets ranked by outcome score and query relevance.",
    )


@router.post(
    "/experiments/start",
    response_model=ExperimentStartResponse,
    status_code=status.HTTP_200_OK,
    summary="Start A/B experiment for copy variants",
)
async def start_experiment(
    payload: ExperimentStartRequest,
    request: Request,
) -> ExperimentStartResponse:
    request_id = _get_request_id(request)
    user_id = _get_user_id(request)
    logger.info("POST /experiments/start", extra={"request_id": request_id})
    experiment_id = str(uuid.uuid4())
    variants = {
        variant.strip(): {"impressions": 0, "clicks": 0, "conversions": 0}
        for variant in payload.variants
        if variant.strip()
    }
    user_experiments = _EXPERIMENTS_BY_USER.setdefault(user_id, {})
    user_experiments[experiment_id] = {
        "id": experiment_id,
        "name": payload.experiment_name,
        "metric": payload.metric,
        "variants": variants,
    }
    _track_agent(user_id, "ab_experimentation", "success")
    return ExperimentStartResponse(
        experiment_id=experiment_id,
        metric=payload.metric,
        variants=[
            ExperimentVariantStat(variant=key, impressions=0, clicks=0, conversions=0, rate=0.0)
            for key in variants.keys()
        ],
    )


@router.post(
    "/experiments/record",
    response_model=ExperimentStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Record A/B experiment performance sample",
)
async def record_experiment(
    payload: ExperimentRecordRequest,
    request: Request,
) -> ExperimentStatusResponse:
    request_id = _get_request_id(request)
    user_id = _get_user_id(request)
    logger.info("POST /experiments/record", extra={"request_id": request_id, "experiment_id": payload.experiment_id})
    user_experiments = _EXPERIMENTS_BY_USER.get(user_id, {})
    state = user_experiments.get(payload.experiment_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Experiment not found.")
    if payload.variant not in state["variants"]:
        raise HTTPException(status_code=422, detail="Variant not found in experiment.")

    sample = state["variants"][payload.variant]
    sample["impressions"] += payload.impressions
    sample["clicks"] += payload.clicks
    sample["conversions"] += payload.conversions

    metric = state["metric"]
    stats: list[ExperimentVariantStat] = []
    for variant, values in state["variants"].items():
        denom = max(values["impressions"], 1)
        if metric == "conversion_rate":
            rate = values["conversions"] / denom
        else:
            rate = values["clicks"] / denom
        stats.append(
            ExperimentVariantStat(
                variant=variant,
                impressions=values["impressions"],
                clicks=values["clicks"],
                conversions=values["conversions"],
                rate=round(rate, 4),
            )
        )
    stats.sort(key=lambda item: item.rate, reverse=True)
    winner = stats[0].variant if stats else ""
    total_impressions = sum(item.impressions for item in stats)
    confidence = min(95, int(total_impressions / 5))
    completed = total_impressions >= 200
    _track_agent(user_id, "ab_experimentation", "success")
    return ExperimentStatusResponse(
        experiment_id=payload.experiment_id,
        metric=metric,
        variants=stats,
        winner=winner,
        confidence=confidence,
        completed=completed,
    )


@router.get(
    "/agent-metrics",
    response_model=AgentMetricsResponse,
    status_code=status.HTTP_200_OK,
    summary="Agent observability metrics snapshot",
)
async def get_agent_metrics(request: Request) -> AgentMetricsResponse:
    request_id = _get_request_id(request)
    user_id = _get_user_id(request)
    logger.info("GET /agent-metrics", extra={"request_id": request_id})
    items: list[AgentMetricItem] = []
    total_calls = 0
    user_metrics = _AGENT_METRICS_BY_USER.get(user_id, {})
    for agent, values in user_metrics.items():
        calls = int(values.get("calls", 0))
        total_calls += calls
        avg_latency = (values.get("latency_total_ms", 0.0) / calls) if calls else 0.0
        items.append(
            AgentMetricItem(
                agent=agent,
                calls=calls,
                success=int(values.get("success", 0)),
                fallback=int(values.get("fallback", 0)),
                avg_latency_ms=round(avg_latency, 1),
            )
        )
    items.sort(key=lambda x: x.calls, reverse=True)
    return AgentMetricsResponse(metrics=items, total_calls=total_calls)


@router.post(
    "/orchestrate-growth-loop",
    response_model=OrchestrateGrowthResponse,
    status_code=status.HTTP_200_OK,
    summary="Cross-agent orchestration for campaign optimization",
)
async def orchestrate_growth_loop(
    payload: OrchestrateGrowthRequest,
    request: Request,
    client: GeminiClient | None = Depends(get_optional_gemini_client),
) -> OrchestrateGrowthResponse:
    request_id = _get_request_id(request)
    user_id = _get_user_id(request)
    logger.info("POST /orchestrate-growth-loop", extra={"request_id": request_id})
    started = time.perf_counter()
    try:
        subject_options = [item.subject for item in payload.emails if item.subject.strip()]
        cta_options = []
        for email in payload.emails:
            cta_options.extend(_extract_cta_candidates(email.html_content))
        if not cta_options:
            cta_options = ["Learn more", "Get started", "Shop now"]

        ranked_subjects = sorted(
            [s for s in subject_options if s],
            key=lambda text: _score_subject_local(text, payload.audience, payload.offer, payload.objective),
            reverse=True,
        )
        ranked_ctas = sorted(
            list(dict.fromkeys(cta_options)),
            key=lambda text: _score_cta_local(text, payload.audience, payload.offer, payload.objective),
            reverse=True,
        )
        best_subject = ranked_subjects[0] if ranked_subjects else ""
        best_cta = ranked_ctas[0] if ranked_ctas else ""

        compliance = _run_compliance_assistant(
            ComplianceAssistantRequest(
                emails=[
                    {
                        "id": item.id,
                        "subject": item.subject,
                        "html_content": item.html_content,
                    }
                    for item in payload.emails
                ],
                banned_phrases=payload.banned_phrases,
                required_phrases=payload.required_phrases,
                legal_footer=payload.legal_footer,
            )
        )

        contacts = _parse_contacts_csv(payload.contacts_csv) if payload.contacts_csv.strip() else []
        timezone = _infer_timezone(contacts) if contacts else "UTC"
        send_reasoning = f"Dominant timezone {timezone}; recommend segment-aware morning/evening windows."

        memory_req = MemoryRetrieveRequest(
            prompt=payload.prompt,
            audience=payload.audience,
            objective=payload.objective,
            limit=5,
        )
        memory = await retrieve_memory(memory_req, request)
        snippets = [item.snippet for item in memory.snippets]

        next_actions = [
            "Launch A/B test for top subject variants and monitor click-rate confidence.",
            "Apply compliance fixes before final send if blocking issues exist.",
            "Record post-send outcomes to continuously improve memory retrieval quality.",
        ]
        if client is not None:
            next_actions.append("Use AI copilot summary after send and feed recommendations into next brief.")
            _track_agent(user_id, "cross_agent_orchestration", "success", (time.perf_counter() - started) * 1000)
        else:
            _track_agent(user_id, "cross_agent_orchestration", "fallback", (time.perf_counter() - started) * 1000)

        return OrchestrateGrowthResponse(
            best_subject=best_subject,
            best_cta=best_cta,
            compliance_passed=compliance.passed,
            compliance_summary=compliance.summary,
            send_time_reasoning=send_reasoning,
            memory_snippets=snippets,
            next_actions=next_actions,
        )
    except Exception:
        logger.exception("orchestrate-growth-loop failed")
        _track_agent(user_id, "cross_agent_orchestration", "fallback", (time.perf_counter() - started) * 1000)
        return OrchestrateGrowthResponse(
            best_subject="",
            best_cta="",
            compliance_passed=True,
            compliance_summary="Orchestration fallback response.",
            send_time_reasoning="Fallback reasoning unavailable.",
            memory_snippets=[],
            next_actions=[
                "Retry orchestration with richer campaign inputs.",
                "Validate compliance and run variant prediction independently.",
            ],
        )
