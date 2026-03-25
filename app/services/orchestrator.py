"""
app/services/orchestrator.py – multi-phase campaign generation workflow.

Phases
──────
1. Clarify   – detect missing inputs; return questions or proceed.
2. Research  – LLM-only knowledge research.
3. Strategy  – campaign blueprint.
4. Execution – per-email copy assets.
5. Production – HTML generation (if requested).
6. Critique  – LLM + rule-based self-review.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Optional

from app.models import (
    Blueprint,
    CampaignRequest,
    CampaignResponse,
    CampaignStatus,
    ClarificationQuestion,
    CritiqueResult,
    EmailAsset,
    PhaseTimings,
    ResponseMetadata,
)
from app.services.gemini_client import GeminiClient
from app.services import prompting
from app.services.validators import run_email_rules

logger = logging.getLogger(__name__)


def _ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 1)


# ── Minimal responsive HTML email template ───────────────────────────────────
# Used by the fast path: Gemini fills content fields; Python stitches the HTML.

_HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="{lang}">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>{subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f4f4f5">{preheader}&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f5">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"
           style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">
      <!-- Header -->
      <tr><td style="background:{brand_color};padding:28px 40px;text-align:center">
        <span style="font-size:22px;font-weight:700;color:{header_text_color}">{brand_name}</span>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:40px 40px 24px">
        <h1 style="margin:0 0 20px;font-size:28px;line-height:1.3;color:#111827;font-family:{heading_font}">{headline}</h1>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.7;color:#374151">{intro_paragraph}</p>
        <div style="background:#f9fafb;border-left:4px solid {brand_color};padding:14px 18px;margin:0 0 20px;border-radius:0 6px 6px 0">
          <strong style="font-size:17px;color:#111827">{offer_line}</strong>
        </div>
        <ul style="margin:0 0 24px;padding-left:22px;color:#374151;font-size:16px;line-height:2">
          {bullets_html}
        </ul>
        {urgency_html}
      </td></tr>
      <!-- CTA -->
      <tr><td style="padding:0 40px 36px;text-align:center">
        <a href="{cta_url}"
           style="display:inline-block;background:{brand_color};color:#ffffff;text-decoration:none;padding:16px 44px;border-radius:6px;font-size:16px;font-weight:700"
        >{cta_button}</a>
      </td></tr>
      <!-- Footer -->
      <tr><td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb">
        <p style="margin:0 0 6px;font-size:12px;color:#9ca3af">{footer_line}</p>
        <p style="margin:0;font-size:11px;color:#9ca3af">
          <a href="#" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a>&nbsp;|&nbsp;
          <a href="#" style="color:#9ca3af;text-decoration:underline">Privacy Policy</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>"""


def _render_email_html(req: CampaignRequest, sections: dict[str, Any]) -> str:
    """Stitch Gemini content fields into the HTML template."""

    def _e(s: Any) -> str:
        """Escape curly braces in user content so .format() doesn't choke."""
        return str(s or "").replace("{", "&#123;").replace("}", "&#125;")

    dt = req.brand.design_tokens
    brand_color = (dt.primary_color if dt else "#0066cc").strip()
    font_body = (dt.font_family_body if dt else "Arial, sans-serif")
    font_heading = (dt.font_family_heading if dt else "Arial, sans-serif")
    border_radius = (dt.border_radius if dt else "6px")

    # Pick white or dark header text based on rough luminance
    try:
        r, g, b = int(brand_color[1:3], 16), int(brand_color[3:5], 16), int(brand_color[5:7], 16)
        luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        header_text_color = "#ffffff" if luminance < 0.55 else "#111827"
    except Exception:
        header_text_color = "#ffffff"

    bullets: list[str] = sections.get("body_bullets") or []
    bullets_html = "".join(f"<li>{_e(b)}</li>" for b in bullets)

    urgency = _e(sections.get("urgency_line") or "").strip()
    urgency_html = (
        f'<p style="margin:0 0 20px;font-size:14px;color:#dc2626;font-weight:600">{urgency}</p>'
        if urgency
        else ""
    )

    cta_url = "#"

    subject = sections.get("subject", "")
    # Inject brand fonts and border-radius into the template
    html = _HTML_TEMPLATE.format(
        lang=_e(req.objective.language or "en"),
        subject=_e(subject),
        preheader=_e(sections.get("preheader", "")),
        brand_color=brand_color,
        header_text_color=header_text_color,
        brand_name=_e(req.brand.brand_name),
        headline=_e(sections.get("headline", "")),
        heading_font=font_heading,
        intro_paragraph=_e(sections.get("intro_paragraph", "")),
        offer_line=_e(sections.get("offer_line", "")),
        bullets_html=bullets_html,
        urgency_html=urgency_html,
        cta_url=cta_url,
        cta_button=_e(sections.get("cta_button", "Shop Now")),
        footer_line=_e(sections.get("footer_line", "")),
    )
    # Post-process: swap default font stack and border-radius with brand values
    html = html.replace("font-family:Arial,Helvetica,sans-serif", f"font-family:{font_body}")
    html = html.replace("border-radius:8px", f"border-radius:{border_radius}")
    html = html.replace("border-radius:6px", f"border-radius:{border_radius}")
    return html


def _phase_rapid_batch(
    req: CampaignRequest,
    client: GeminiClient,
) -> list[EmailAsset]:
    """
    Fast path: single Gemini call that replaces phases 2-6.
    Returns a list of EmailAsset objects with pre-rendered HTML.
    """
    result = client.generate_text(
        prompt=prompting.build_rapid_batch_prompt(req),
        system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
        json_schema=prompting.RAPID_BATCH_SCHEMA,
        temperature=0.35,
        max_output_tokens=4096,
    )

    parsed = result.get("parsed") or {}
    raw_emails: list[dict] = parsed.get("emails") or []

    assets: list[EmailAsset] = []
    for em in raw_emails:
        secs = em.get("sections") or {}
        subject = (em.get("subject_lines") or [""])[0]
        secs["subject"] = subject  # pass to HTML renderer
        html = _render_email_html(req, secs) if req.deliverables.include_html else None

        # Validate with existing rule checker
        body_text = "\n".join(
            filter(None, [
                secs.get("headline", ""),
                secs.get("intro_paragraph", ""),
                secs.get("offer_line", ""),
                *[f"• {b}" for b in (secs.get("body_bullets") or [])],
                secs.get("urgency_line", ""),
            ])
        )
        rule_result = run_email_rules(
            req=req,
            email={
                "email_number": em.get("email_number", len(assets) + 1),
                "body_text": body_text,
                "subject_lines": em.get("subject_lines") or [],
                "preview_text_options": em.get("preview_text_options") or [],
            },
        )
        a11y_notes = rule_result.issues + rule_result.risk_flags

        assets.append(
            EmailAsset(
                email_number=em.get("email_number", len(assets) + 1),
                email_name=em.get("email_name", f"Email {len(assets)+1}"),
                subject_lines=em.get("subject_lines") or [subject],
                preview_text_options=em.get("preview_text_options") or [],
                body_text=body_text,
                ctas=em.get("ctas") or [],
                send_timing=em.get("send_timing", ""),
                html=html,
                accessibility_notes=a11y_notes,
            )
        )

    return assets
def _extract_html(raw: str) -> str:
    """Strip fences/prose and return the first complete HTML document found."""
    import json as _json

    text = raw.strip()
    # 1. Strip markdown code fences
    for fence in ("```html", "```json", "```"):
        if text.startswith(fence):
            text = text[len(fence):].lstrip("\n")
            break
    if text.endswith("```"):
        text = text[:-3].rstrip()
    text = text.strip()

    # 2. If the model wrapped the HTML inside a JSON object (e.g. {"email_html": "..."}),
    #    parse it and extract the first string value that looks like HTML.
    if text.startswith("{"):
        try:
            obj = _json.loads(text)
            if isinstance(obj, dict):
                for val in obj.values():
                    if isinstance(val, str) and ("<html" in val.lower() or "<!doctype" in val.lower()):
                        text = val  # already unescaped by json.loads
                        break
        except (_json.JSONDecodeError, ValueError):
            # json.loads failed (e.g. unescaped char inside the HTML string).
            # Try a JSON-string-aware regex to extract the email_html value directly.
            html_val_match = re.search(
                r'"email_html"\s*:\s*"((?:[^"\\]|\\.)*)',
                text,
                re.DOTALL,
            )
            if html_val_match:
                raw_val = html_val_match.group(1)
                # Strip trailing " that closed the string (regex is non-greedy, may include it)
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

    # 3. Try DOCTYPE-anchored match
    m = re.search(r"(<!DOCTYPE\s+html[\s\S]*?</html>)", text, re.IGNORECASE)
    if m:
        return m.group(1)
    # 4. Try plain <html>...</html>
    m2 = re.search(r"(<html[\s\S]*?</html>)", text, re.IGNORECASE)
    if m2:
        return m2.group(1)
    # 5. Last resort: return whatever we have after fence stripping
    return text


# ── External Research Stub Interface ─────────────────────────────────────────-
# This interface is cleanly designed for future implementation with real web
# browsing / search tools. Currently returns an empty result.


class ExternalResearchProvider:
    """
    Abstract interface for external research providers.
    Implement this class to add real web search, news, or competitive intelligence.
    """

    def search(self, query: str) -> list[dict[str, Any]]:
        """Perform a web search and return a list of result dicts."""
        raise NotImplementedError

    def fetch_url(self, url: str) -> str:
        """Fetch and return the text content of a URL."""
        raise NotImplementedError


class NoOpExternalResearch(ExternalResearchProvider):
    """No-op stub used when external browsing is not available."""

    def search(self, query: str) -> list[dict[str, Any]]:
        logger.debug("ExternalResearch.search called (no-op stub)", extra={"query": query})
        return []

    def fetch_url(self, url: str) -> str:
        logger.debug("ExternalResearch.fetch_url called (no-op stub)", extra={"url": url})
        return ""


# ── Phase implementations ──────────────────────────────────────────────────────


def _phase_clarify(
    req: CampaignRequest,
    client: GeminiClient,
) -> tuple[bool, list[ClarificationQuestion]]:
    """
    Phase 1 – Clarification.

    Returns (needs_clarification: bool, questions: list[ClarificationQuestion]).
    """
    prompt = prompting.build_clarify_prompt(req)
    result = client.generate_text(
        prompt=prompt,
        system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
        json_schema=prompting.CLARIFY_SCHEMA,
        temperature=0.1,  # deterministic for clarification
    )
    parsed = result.get("parsed") or {}

    needs = bool(parsed.get("needs_clarification", False))
    raw_questions = parsed.get("questions", [])
    questions = [
        ClarificationQuestion(
            field=q.get("field", "unknown"),
            question=q.get("question", ""),
            why_needed=q.get("why_needed", ""),
        )
        for q in raw_questions
        if isinstance(q, dict)
    ]
    return needs, questions


def _phase_research(
    req: CampaignRequest,
    client: GeminiClient,
    external: Optional[ExternalResearchProvider] = None,
) -> dict[str, Any]:
    """
    Phase 2 – Research.

    Combines LLM knowledge research with optional external research stub.
    """
    if external is None:
        external = NoOpExternalResearch()

    # External research stub (no-op by default)
    external_results = external.search(
        f"{req.brand.brand_name} {req.objective.offer} marketing trends"
    )
    if external_results:
        logger.info("External research returned %d results", len(external_results))

    # LLM knowledge research
    prompt = prompting.build_research_prompt(req)
    result = client.generate_text(
        prompt=prompt,
        system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
        json_schema=prompting.RESEARCH_SCHEMA,
        temperature=0.3,
    )
    research_data: dict[str, Any] = result.get("parsed") or {
        "audience_insights": [],
        "channel_insights": [],
        "seasonal_context": "",
        "competitive_considerations": [],
        "assumptions": [],
    }

    # Merge external results into research (stubbed – just log for now)
    if external_results:
        research_data["external_results_count"] = len(external_results)

    return research_data


def _phase_strategy(
    req: CampaignRequest,
    research: dict[str, Any],
    client: GeminiClient,
) -> tuple[Blueprint, dict[str, Any]]:
    """
    Phase 3 – Strategy.

    Returns (Blueprint Pydantic model, raw blueprint dict).
    """
    prompt = prompting.build_strategy_prompt(req, research)
    result = client.generate_text(
        prompt=prompt,
        system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
        json_schema=prompting.STRATEGY_SCHEMA,
        temperature=0.5,
    )
    raw: dict[str, Any] = result.get("parsed") or {}

    blueprint = Blueprint(
        campaign_angle=raw.get("campaign_angle", ""),
        core_narrative=raw.get("core_narrative", ""),
        offer_logic=raw.get("offer_logic", ""),
        narrative_arc=raw.get("narrative_arc", []),
        kpi_mapping=raw.get("kpi_mapping", {}),
        channel_strategy=raw.get("channel_strategy", {}),
        risks=raw.get("risks", []),
        assumptions=raw.get("assumptions", []),
    )
    return blueprint, raw


def _phase_execution(
    req: CampaignRequest,
    blueprint_raw: dict[str, Any],
    client: GeminiClient,
) -> tuple[list[EmailAsset], list[dict[str, Any]]]:
    """
    Phase 4 – Execution.

    Generates copy for each email sequentially.
    Returns (list of EmailAsset models, list of raw dicts).
    """
    num_emails = req.deliverables.number_of_emails
    narrative_arc: list[str] = blueprint_raw.get("narrative_arc", [])

    # Pad/trim arc beats to match number of emails
    beats = (narrative_arc + [f"Email {i+1}" for i in range(num_emails)])[:num_emails]

    assets: list[EmailAsset] = []
    raw_emails: list[dict[str, Any]] = []

    for idx in range(num_emails):
        beat = beats[idx] if beats else f"Email {idx + 1}"
        prompt = prompting.build_execution_prompt(req, blueprint_raw, idx, beat)
        result = client.generate_text(
            prompt=prompt,
            system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
            json_schema=prompting.EXECUTION_SCHEMA["properties"]["emails"]["items"],
            temperature=0.7,  # More creative for copy
        )
        raw_email: dict[str, Any] = result.get("parsed") or {}

        # Ensure email_number is correct
        raw_email["email_number"] = idx + 1
        raw_emails.append(raw_email)

        asset = EmailAsset(
            email_number=idx + 1,
            email_name=raw_email.get("email_name", f"Email {idx + 1}"),
            subject_lines=raw_email.get("subject_lines", [f"Subject for email {idx + 1}"]),
            preview_text_options=raw_email.get("preview_text_options", ["Preview text"]),
            body_text=raw_email.get("body_text", ""),
            ctas=raw_email.get("ctas", ["Shop Now"]),
            send_timing=raw_email.get("send_timing", ""),
            html=None,  # Populated in production phase if requested
            accessibility_notes=[],
        )
        assets.append(asset)
        logger.debug("Generated email %d/%d", idx + 1, num_emails)

    return assets, raw_emails


def _phase_production(
    req: CampaignRequest,
    assets: list[EmailAsset],
    raw_emails: list[dict[str, Any]],
    client: GeminiClient,
) -> list[EmailAsset]:
    """
    Phase 5 – HTML Production.

    Generates responsive HTML for each email asset.
    """
    updated_assets: list[EmailAsset] = []
    for asset, raw_email in zip(assets, raw_emails):
        prompt = prompting.build_production_prompt(req, raw_email)
        result = client.generate_text(
            prompt=prompt,
            system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
            json_schema=prompting.HTML_OUTPUT_SCHEMA,
            temperature=0.2,
            max_output_tokens=32768,
        )
        raw_text = result.get("text", "")
        html_text = (result.get("parsed") or {}).get("email_html") or _extract_html(raw_text)
        logger.info(
            "[HTML step 1/3] Gemini raw response for email %d — length=%d, "
            "has_real_newlines=%s, has_literal_backslash_n=%s, first 300 chars: %s",
            asset.email_number,
            len(raw_text),
            repr("\n" in raw_text),
            repr("\\n" in raw_text),
            repr(raw_text[:300]),
        )

        html_text = (result.get("parsed") or {}).get("email_html") or _extract_html(raw_text)
        logger.info(
            "[HTML step 2/3] Resolved html for email %d — length=%d, "
            "source=%s, first 120 chars: %s",
            asset.email_number,
            len(html_text),
            "parsed" if (result.get("parsed") or {}).get("email_html") else "fallback_extract",
            repr(html_text[:120]),
        )

        if not html_text:
            logger.warning("Phase 5 returned empty HTML for email %d", asset.email_number)

        updated = asset.model_copy(
            update={
                "html": html_text,
                "accessibility_notes": [],
            }
        )
        updated_assets.append(updated)
        logger.debug("Generated HTML for email %d", asset.email_number)

    return updated_assets


def _phase_critique(
    req: CampaignRequest,
    blueprint_raw: dict[str, Any],
    assets: list[EmailAsset],
    raw_emails: list[dict[str, Any]],
    client: GeminiClient,
) -> CritiqueResult:
    """
    Phase 6 – Critique.

    Merges LLM critique + deterministic rule-based checks.
    """
    # ── LLM critique ──────────────────────────────────────────────────────────
    prompt = prompting.build_critique_prompt(req, blueprint_raw, raw_emails)
    result = client.generate_text(
        prompt=prompt,
        system_instruction=prompting.SHARED_SYSTEM_INSTRUCTION,
        json_schema=prompting.CRITIQUE_SCHEMA,
        temperature=0.2,
    )
    llm_raw: dict[str, Any] = result.get("parsed") or {}

    llm_issues: list[str] = llm_raw.get("issues", [])
    llm_fixes: list[str] = llm_raw.get("fixes", [])
    llm_flags: list[str] = llm_raw.get("risk_flags", [])
    llm_commentary: str = llm_raw.get("llm_commentary", "")
    llm_score: int = int(llm_raw.get("score", 70))

    # ── Rule-based checks ─────────────────────────────────────────────────────
    rule_issues: list[str] = []
    rule_flags: list[str] = []
    rule_fixes: list[str] = []

    for email_raw in raw_emails:
        rule_result = run_email_rules(req, email_raw)
        rule_issues.extend(rule_result.issues)
        rule_flags.extend(rule_result.risk_flags)
        rule_fixes.extend(rule_result.fixes)

    # Adjust score downward for rule violations
    penalty_per_issue = 3
    adjusted_score = max(0, llm_score - (len(rule_issues) * penalty_per_issue))

    return CritiqueResult(
        issues=llm_issues + rule_issues,
        fixes=llm_fixes + rule_fixes,
        risk_flags=llm_flags + rule_flags,
        llm_commentary=llm_commentary,
        score=adjusted_score,
    )


# ── Main orchestration entry point ────────────────────────────────────────────


def orchestrate_campaign(
    req: CampaignRequest,
    request_id: str,
    client: GeminiClient,
    external_research: Optional[ExternalResearchProvider] = None,
    skip_clarify: bool = False,
) -> CampaignResponse:
    """
    Run the full multi-phase campaign generation workflow.

    Returns a CampaignResponse with status = 'completed' or 'needs_clarification'.
    """
    timings = PhaseTimings()
    total_start = time.perf_counter()
    total_tokens = 0

    logger.info(
        "Campaign orchestration started",
        extra={"request_id": request_id, "campaign": req.campaign_name},
    )

    # ── Phase 1: Clarification ────────────────────────────────────────────────
    if skip_clarify:
        logger.info("Skipping Phase 1 clarification (force_proceed)", extra={"request_id": request_id})
        needs_clarification = False
        questions = []
        timings.clarify_ms = 0.0
    else:
        t = time.perf_counter()
        needs_clarification, questions = _phase_clarify(req, client)
        timings.clarify_ms = _ms(t)

    if needs_clarification:
        logger.info(
            "Needs clarification",
            extra={"request_id": request_id, "questions": len(questions)},
        )
        timings.total_ms = _ms(total_start)
        return CampaignResponse(
            status=CampaignStatus.NEEDS_CLARIFICATION,
            clarification_questions=questions,
            metadata=ResponseMetadata(
                request_id=request_id,
                model_used=client._model,
                tokens_estimate=0,
                timings=timings,
            ),
        )

    # ── Phase 2: Research ─────────────────────────────────────────────────────
    t = time.perf_counter()
    research = _phase_research(req, client, external_research)
    timings.research_ms = _ms(t)

    # ── Phase 3: Strategy ──────────────────────────────────────────────────────
    t = time.perf_counter()
    blueprint, blueprint_raw = _phase_strategy(req, research, client)
    timings.strategy_ms = _ms(t)

    # ── Phase 4: Execution ─────────────────────────────────────────────────────
    t = time.perf_counter()
    assets, raw_emails = _phase_execution(req, blueprint_raw, client)
    timings.execution_ms = _ms(t)

    # ── Phase 5: HTML Production ──────────────────────────────────────────────
    if req.deliverables.include_html:
        t = time.perf_counter()
        assets = _phase_production(req, assets, raw_emails, client)
        timings.production_ms = _ms(t)

    # ── Phase 6: Critique ──────────────────────────────────────────────────────
    t = time.perf_counter()
    critique = _phase_critique(req, blueprint_raw, assets, raw_emails, client)
    timings.critique_ms = _ms(t)

    timings.total_ms = _ms(total_start)

    logger.info(
        "Campaign orchestration complete",
        extra={
            "request_id": request_id,
            "total_ms": timings.total_ms,
            "critique_score": critique.score,
        },
    )

    return CampaignResponse(
        status=CampaignStatus.COMPLETED,
        blueprint=blueprint,
        assets=assets,
        critique=critique,
        metadata=ResponseMetadata(
            request_id=request_id,
            model_used=client._model,
            tokens_estimate=total_tokens,
            timings=timings,
        ),
    )


# ── Fast orchestration entry point (2 Gemini calls total) ────────────────────


def orchestrate_campaign_fast(
    req: CampaignRequest,
    request_id: str,
    client: GeminiClient,
) -> CampaignResponse:
    """
    Fast campaign generation: 1 Gemini call replaces phases 2-6.

    Pipeline:
      Phase 0 – parsing (done in route, before this function)
      Phase 1 – skipped (caller sets skip_clarify=True after parse)
      Phase R – rapid batch: research + strategy + execution + HTML in one call
    Total Gemini calls: 1 (vs 5+2N in the full pipeline for N emails).
    """
    timings = PhaseTimings()
    total_start = time.perf_counter()

    logger.info(
        "Fast campaign orchestration started",
        extra={"request_id": request_id, "n_emails": req.deliverables.number_of_emails},
    )

    t = time.perf_counter()
    try:
        assets = _phase_rapid_batch(req, client)
    except Exception as exc:
        logger.exception("Rapid batch phase failed", extra={"request_id": request_id})
        raise ValueError(f"Email generation failed: {exc}") from exc
    rapid_ms = _ms(t)
    timings.execution_ms = rapid_ms   # execution + production combined
    timings.production_ms = 0.0
    timings.total_ms = _ms(total_start)

    logger.info(
        "FAST TIMING: rapid_batch=%.0fms total=%.0fms gemini_calls=1 emails=%d",
        rapid_ms,
        timings.total_ms,
        len(assets),
        extra={"request_id": request_id},
    )

    return CampaignResponse(
        status=CampaignStatus.COMPLETED,
        blueprint=None,
        assets=assets,
        critique=None,
        metadata=ResponseMetadata(
            request_id=request_id,
            model_used=client._model,
            tokens_estimate=0,
            timings=timings,
        ),
    )
