"""
app/services/prompting.py – prompt templates for every workflow phase.

Design principles
─────────────────
• Every prompt explicitly requests strict JSON output.
• All prompts embed the JSON schema directly so the model understands the shape.
• System instructions emphasize: no hallucination, label assumptions, brand safety.
• Templates use simple string formatting (no heavy templating engine dependency).
"""
from __future__ import annotations

from typing import Any

from app.models import CampaignRequest

# ── Shared system instruction ─────────────────────────────────────────────────

SHARED_SYSTEM_INSTRUCTION = """\
You are Mark, a senior marketing strategist and award-winning copywriter with deep \
expertise in email marketing, brand strategy, and conversion optimisation.

HARD RULES – you must follow these without exception:
1. Do NOT hallucinate facts, statistics, or claims. If you are unsure, label it as an assumption.
2. Follow brand voice guidelines strictly. Never use banned phrases.
3. Keep all claims conservative and verifiable.
4. Output ONLY valid JSON matching the supplied schema — no markdown, no commentary outside JSON.
5. Label every assumption you make inside the "assumptions" array.
6. If you identify a compliance risk, flag it explicitly.
7. Use the provided language for all copy.
"""

# ── Phase 1 – Clarification ───────────────────────────────────────────────────

CLARIFY_SCHEMA: dict = {
    "type": "object",
    "required": ["needs_clarification", "questions"],
    "properties": {
        "needs_clarification": {"type": "boolean"},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["field", "question", "why_needed"],
                "properties": {
                    "field": {"type": "string"},
                    "question": {"type": "string"},
                    "why_needed": {"type": "string"},
                },
            },
        },
    },
}


def build_clarify_prompt(req: CampaignRequest) -> str:
    missing: list[str] = []

    if not req.objective.offer or len(req.objective.offer) < 10:
        missing.append("objective.offer")
    if not req.objective.target_audience or len(req.objective.target_audience) < 10:
        missing.append("objective.target_audience")
    if not req.objective.geo_scope:
        missing.append("objective.geo_scope")
    if not req.objective.language:
        missing.append("objective.language")
    if req.deliverables.number_of_emails < 1:
        missing.append("deliverables.number_of_emails")

    missing_str = ", ".join(missing) if missing else "none"

    return f"""\
Analyse the following campaign request and determine if any CRITICAL information is \
missing or ambiguous. Critical fields are: primary_kpi, target_audience, offer, \
language, geo_scope, number_of_emails.

Potentially missing fields detected: {missing_str}

CAMPAIGN REQUEST (JSON):
{req.model_dump_json(indent=2)}

Your task:
- If critical information is genuinely missing or too vague to proceed safely, \
set "needs_clarification" to true and provide 3–7 targeted, specific questions.
- Each question must reference the exact field path (e.g. "objective.offer").
- If the request is complete enough to proceed, set "needs_clarification" to false \
and return an empty questions array.

Return ONLY this JSON structure:
{{
  "needs_clarification": <true|false>,
  "questions": [
    {{"field": "...", "question": "...", "why_needed": "..."}}
  ]
}}
"""


# ── Phase 2 – Research ────────────────────────────────────────────────────────

RESEARCH_SCHEMA: dict = {
    "type": "object",
    "required": ["audience_insights", "channel_insights", "seasonal_context", "assumptions"],
    "properties": {
        "audience_insights": {
            "type": "array",
            "items": {"type": "string"},
        },
        "channel_insights": {
            "type": "array",
            "items": {"type": "string"},
        },
        "seasonal_context": {"type": "string"},
        "competitive_considerations": {
            "type": "array",
            "items": {"type": "string"},
        },
        "assumptions": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
}


def build_research_prompt(req: CampaignRequest) -> str:
    return f"""\
You are conducting knowledge-based research (no external browsing) for the following \
marketing campaign. Use your training knowledge to synthesise relevant insights.

CAMPAIGN BRIEF:
- Brand: {req.brand.brand_name}
- Offer: {req.objective.offer}
- Audience: {req.objective.target_audience}
- Geo: {req.objective.geo_scope}
- Language: {req.objective.language}
- Channels: {[c.value for c in req.channels]}
- Primary KPI: {req.objective.primary_kpi.value}

Research tasks:
1. Provide 3–5 audience behaviour insights relevant to this campaign.
2. Provide 3–5 email/channel best-practice insights relevant to the geo and offer type.
3. Summarise relevant seasonal or contextual factors.
4. Note 2–3 competitive considerations (general, not specific competitor claims).
5. Label all assumptions clearly.

Return ONLY valid JSON matching this structure:
{{
  "audience_insights": ["..."],
  "channel_insights": ["..."],
  "seasonal_context": "...",
  "competitive_considerations": ["..."],
  "assumptions": ["ASSUMPTION: ..."]
}}
"""


# ── Phase 3 – Strategy ────────────────────────────────────────────────────────

STRATEGY_SCHEMA: dict = {
    "type": "object",
    "required": [
        "campaign_angle",
        "core_narrative",
        "offer_logic",
        "narrative_arc",
        "kpi_mapping",
        "channel_strategy",
        "risks",
        "assumptions",
    ],
    "properties": {
        "campaign_angle": {"type": "string"},
        "core_narrative": {"type": "string"},
        "offer_logic": {"type": "string"},
        "narrative_arc": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 2,
        },
        "kpi_mapping": {
            "type": "object",
            "additionalProperties": {"type": "string"},
        },
        "channel_strategy": {
            "type": "object",
            "additionalProperties": {"type": "string"},
        },
        "risks": {"type": "array", "items": {"type": "string"}},
        "assumptions": {"type": "array", "items": {"type": "string"}},
    },
}


def build_strategy_prompt(req: CampaignRequest, research: dict[str, Any]) -> str:
    return f"""\
Create a comprehensive campaign strategy (blueprint) for the following brief. \
Ground your strategy in the research insights provided.

CAMPAIGN BRIEF:
- Campaign Name: {req.campaign_name}
- Brand: {req.brand.brand_name}
- Brand Voice: {req.brand.voice_guidelines}
- Offer: {req.objective.offer}
- Primary KPI: {req.objective.primary_kpi.value}
- Secondary KPIs: {[k.value for k in req.objective.secondary_kpis]}
- Target Audience: {req.objective.target_audience}
- Geo: {req.objective.geo_scope} | Language: {req.objective.language}
- Channels: {[c.value for c in req.channels]}
- Number of Emails: {req.deliverables.number_of_emails}
- Discount Ceiling: {req.constraints.discount_ceiling}%
- Compliance Notes: {req.constraints.compliance_notes}
- Send Window: {req.constraints.send_window}
- Banned Phrases: {req.brand.banned_phrases}
- Required Phrases: {req.brand.required_phrases}

RESEARCH INSIGHTS:
{_format_research(research)}

Strategy tasks:
1. Define the single, compelling campaign angle (1–2 sentences).
2. Write the core narrative arc that unifies all {req.deliverables.number_of_emails} \
emails.
3. Explain the offer logic (why this offer, why now, why for this audience).
4. List the narrative arc as ordered beats (e.g., Tease → Announce → Urgency → Final Push).
5. Map each KPI to the primary tactic that drives it.
6. Provide channel-specific execution notes.
7. Identify 2–4 risks and mitigation notes.
8. Label all assumptions.

Return ONLY valid JSON:
{{
  "campaign_angle": "...",
  "core_narrative": "...",
  "offer_logic": "...",
  "narrative_arc": ["Beat 1: ...", "Beat 2: ...", ...],
  "kpi_mapping": {{"revenue": "...", "open_rate": "..."}},
  "channel_strategy": {{"email": "..."}},
  "risks": ["Risk: ... | Mitigation: ..."],
  "assumptions": ["ASSUMPTION: ..."]
}}
"""


# ── Phase 4 – Execution (copy assets) ────────────────────────────────────────

EXECUTION_SCHEMA: dict = {
    "type": "object",
    "required": ["emails"],
    "properties": {
        "emails": {
            "type": "array",
            "items": {
                "type": "object",
                "required": [
                    "email_number",
                    "email_name",
                    "subject_lines",
                    "preview_text_options",
                    "body_text",
                    "ctas",
                    "send_timing",
                ],
                "properties": {
                    "email_number": {"type": "integer"},
                    "email_name": {"type": "string"},
                    "subject_lines": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 3,
                    },
                    "preview_text_options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 2,
                    },
                    "body_text": {"type": "string"},
                    "ctas": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                    },
                    "send_timing": {"type": "string"},
                },
            },
        }
    },
}


def build_execution_prompt(
    req: CampaignRequest,
    blueprint: dict[str, Any],
    email_index: int,
    narrative_beat: str,
) -> str:
    email_num = email_index + 1
    total = req.deliverables.number_of_emails

    return f"""\
Write email #{email_num} of {total} for the following campaign.

CAMPAIGN CONTEXT:
- Campaign: {req.campaign_name}
- Brand: {req.brand.brand_name}
- Brand Voice: {req.brand.voice_guidelines}
- Banned Phrases: {req.brand.banned_phrases}
- Required Phrases: {req.brand.required_phrases}
- Legal Footer: {req.brand.legal_footer}
- Offer: {req.objective.offer}
- Audience: {req.objective.target_audience}
- Geo/Language: {req.objective.geo_scope} / {req.objective.language}
- Compliance: {req.constraints.compliance_notes}
- Send Window: {req.constraints.send_window}

CAMPAIGN STRATEGY:
- Angle: {blueprint.get('campaign_angle', '')}
- Core Narrative: {blueprint.get('core_narrative', '')}

THIS EMAIL'S NARRATIVE BEAT: {narrative_beat}

COPY REQUIREMENTS:
- Write 3+ distinct subject lines (A/B testable). Keep under 50 characters where possible.
- Write 2 preview text options (under 90 characters each).
- Write the full email body. Use brand voice. Include the legal footer at the end.
- Write 1–3 CTA options (button label text).
- Recommend the ideal send day/time within the send window: {req.constraints.send_window}. \
Give a reason.
- Do NOT use any banned phrases: {req.brand.banned_phrases}
- Naturally include required phrases where appropriate: {req.brand.required_phrases}

Return ONLY valid JSON:
{{
  "email_number": {email_num},
  "email_name": "...",
  "subject_lines": ["...", "...", "..."],
  "preview_text_options": ["...", "..."],
  "body_text": "... (full email body with legal footer at end) ...",
  "ctas": ["...", "..."],
  "send_timing": "..."
}}
"""


# ── Phase 5 – HTML Production ─────────────────────────────────────────────────

HTML_OUTPUT_SCHEMA: dict = {
    "type": "object",
    "required": ["email_html"],
    "properties": {
        "email_html": {
            "type": "string",
            "description": "The complete, production-ready HTML email document.",
        }
    },
}

_EMAIL_SKELETON_GUIDE = """\
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COLOUR SYSTEM — derive every colour from ONE brand hue
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pick a single primary hue (the brand colour). Then construct:
  • PRIMARY       — the full-saturation brand colour (header band bg, CTA button bg)
  • PRIMARY_DARK  — PRIMARY darkened ~15% (hover / shadow hints, footer link)
  • PRIMARY_TINT  — PRIMARY with ~90% white mixed in (hero section bg, CTA band bg)
  • PRIMARY_TEXT  — dark neutral for reading (#1a1a1a or very dark shade of PRIMARY)
  • SURFACE       — #ffffff (body section bg)
  • SUBTLE        — #f5f5f5 or a near-white tint (footer bg)
Do NOT introduce extra hues. All section backgrounds, text, and accents must be
tints or shades of this one palette. This creates a cohesive, on-brand look.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRUCTURAL SKELETON — follow this exact section order
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  1. <!DOCTYPE html> + <html> + <head> with viewport meta + <style> block
  2. Outer wrapper <table> width="100%", background-color: PRIMARY_TINT (the page canvas).
  3. Inner card <table> width="600", centered, background-color: #ffffff,
     border-radius:16px, overflow:hidden — this is the card the reader sees.
     Wrap it in a <td> with padding:24px on desktop so the card floats on the canvas.
  4. PREHEADER ROW (inside inner card): hidden preview-text span:
       <span style="display:none;font-size:1px;color:#ffffff;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">PREVIEW_TEXT_HERE &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</span>
  5. HEADER BAND: <td> background-color: PRIMARY, border-radius:16px 16px 0 0 (top corners only).
     Contains brand name in white bold text (28px) or logo. Padding: 36px 40px 28px.
  6. HERO SECTION: <td> background-color: PRIMARY_TINT, padding: 32px 40px.
     h1-style headline in PRIMARY_DARK (28–32px bold), then one supporting sentence in
     PRIMARY_TEXT (16px). No border-radius needed here — it sits between header and body.
  7. BODY SECTION: <td> background-color: #ffffff, padding: 32px 40px.
     Body copy in PRIMARY_TEXT (#1a1a1a or equivalent), 16px, line-height:1.7.
     Break into short paragraphs with margin-bottom:16px each.
  8. CTA BAND: <td> background-color: #ffffff (SURFACE), padding: 28px 40px, text-align:center.
     Holds the bulletproof button — use EXACT pattern below.
  9. FOOTER BAND: <td> background-color: SUBTLE (#f5f5f5), border-radius: 0 0 16px 16px
     (bottom corners only). 13px text in #888888. Padding: 24px 40px.
     Contains legal footer and unsubscribe link.
  10. Close all tables and </html>.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXACT BULLETPROOF CTA BUTTON — rounded box shape, use this verbatim:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
  <tbody>
    <tr>
      <td align="center" style="border-radius:8px;mso-padding-alt:0;" bgcolor="YOUR_PRIMARY">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
          href="https://example.com" style="height:52px;v-text-anchor:middle;width:240px;" arcsize="10%"
          strokecolor="YOUR_PRIMARY" fillcolor="YOUR_PRIMARY">
          <w:anchorlock/>
          <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">YOUR_CTA_LABEL</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-->
        <a href="https://example.com" target="_blank"
          style="background-color:YOUR_PRIMARY;border-radius:8px;color:#ffffff;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:52px;mso-hide:all;padding:0 36px;text-decoration:none;text-align:center;-webkit-text-size-adjust:none;letter-spacing:0.3px;">YOUR_CTA_LABEL</a>
        <!--<![endif]-->
      </td>
    </tr>
  </tbody>
</table>
(Replace YOUR_PRIMARY with the exact 6-digit hex of the primary brand colour.
 Replace YOUR_CTA_LABEL with the CTA text. Outlook renders square corners — acceptable.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANDATORY TECHNICAL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• ALL CSS must be inlined on every element — <style> block in <head> for @media only.
• Table-based layout throughout. Do NOT use <div> for layout blocks.
• Every table: border="0" cellpadding="0" cellspacing="0" role="presentation"
  and style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;"
• Every <td>: explicit font-family, font-size, color, vertical-align.
• Full 6-digit hex everywhere (#ffffff not #fff).
• Inner card table max-width 600px. Outer wrapper width="100%".
• Mobile @media (max-width:600px): .email-container { width:100% !important; },
  remove card padding, adjust font sizes.
• No CSS Grid, Flexbox, float, or position:absolute.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGN QUALITY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Single cohesive palette — all colours tints/shades of one hue. No random accent colours.
• Card layout: the inner 600px container appears as a rounded card floating on a tinted canvas.
• Header top corners rounded (16px), footer bottom corners rounded (16px).
• CTA button is a rounded box (border-radius:8px). It is the email's only bold colour call-to-action.
• WCAG AA contrast on all text/bg combinations.
• Body paragraphs max 3–4 sentences, separated by 16px margin.
• Footer recedes visually — smaller, lighter, no competing colours.
• Aesthetic: warm, modern, human — like a beautifully designed SaaS product email.
"""


def build_production_prompt(
    req: CampaignRequest,
    email_asset: dict[str, Any],
) -> str:
    dt = req.brand.design_tokens
    subject = email_asset.get('subject_lines', [''])[0]
    preview = email_asset.get('preview_text_options', [''])[0]
    body = email_asset.get('body_text', '')
    cta = email_asset.get('ctas', ['Shop Now'])[0]
    footer = req.brand.legal_footer or ''
    logo_line = (
        f"Logo image URL (embed at top of header band): {dt.logo_url}"
        if dt.logo_url
        else "No logo — render the brand name as styled bold text in the header band instead."
    )

    if dt.auto_design:
        return f"""\
You are an expert HTML email developer. Produce a single, complete, production-ready HTML \
email that looks like it was crafted by a world-class design team (think: Stripe, Linear, \
or a top direct-to-consumer brand). It must render correctly in Gmail, Apple Mail, and \
Outlook 2016+.

═══════════════════════════════════════════════
CONTENT TO ENCODE
═══════════════════════════════════════════════
Brand name:    {req.brand.brand_name}
Campaign:      {email_asset.get('email_name', '')}
{logo_line}

Subject line:  {subject}
Preview text:  {preview}
Body copy:
{body}

CTA button label: {cta}
Legal footer text: {footer}

═══════════════════════════════════════════════
COLOUR PALETTE — pick ONE primary hue, then derive everything from it:
═══════════════════════════════════════════════
- Choose a single PRIMARY hue that suits "{req.brand.brand_name}" and the campaign theme.
- PRIMARY: full-saturation version → header band background, CTA button.
- PRIMARY_DARK: ~15% darker → h1 headline colour in the hero section.
- PRIMARY_TINT: PRIMARY mixed ~90% white → hero section bg, CTA band bg, outer canvas bg.
- Body text: #1a1a1a on #ffffff. Footer bg: #f5f5f5, footer text: #888888.
- Do NOT introduce any colour from a different hue family. Monochromatic palette only.

═══════════════════════════════════════════════
STRUCTURE & CODE PATTERNS
═══════════════════════════════════════════════
{_EMAIL_SKELETON_GUIDE}

Return a JSON object with a single key "email_html" whose value is the complete HTML string.
Start the HTML with <!DOCTYPE html> and end with </html>.
"""

    # ── Explicit brand tokens mode ──────────────────────────────────────────
    font_stack_heading = f"'{dt.font_family_heading}',Arial,Helvetica,sans-serif"
    font_stack_body = f"'{dt.font_family_body}',Arial,Helvetica,sans-serif"
    accent = dt.accent_color or dt.primary_color

    return f"""\
You are an expert HTML email developer. Produce a single, complete, production-ready HTML \
email following the brand tokens below exactly. It must render correctly in Gmail, Apple \
Mail, and Outlook 2016+.

═══════════════════════════════════════════════
BRAND DESIGN TOKENS  (apply these exactly — do not invent other values)
═══════════════════════════════════════════════
Primary colour (header band bg, links):   {dt.primary_color}
Secondary colour (hero section bg):       {dt.secondary_color}
Accent colour (CTA button bg):            {accent}
Heading font stack:                       {font_stack_heading}
Body font stack:                          {font_stack_body}
Base body font size:                      {dt.font_size_base}
Line height:                              {dt.line_height}
Spacing unit (base padding):              {dt.spacing_unit}
Border radius (buttons, cards):           {dt.border_radius}
{logo_line}

═══════════════════════════════════════════════
CONTENT TO ENCODE
═══════════════════════════════════════════════
Brand name:    {req.brand.brand_name}
Subject line:  {subject}
Preview text:  {preview}
Body copy:
{body}

CTA button label: {cta}
Legal footer text: {footer}

═══════════════════════════════════════════════
STRUCTURE & CODE PATTERNS
═══════════════════════════════════════════════
{_EMAIL_SKELETON_GUIDE}

Apply the brand tokens and derive the full palette:
- PRIMARY = {dt.primary_color} → header band bg, CTA button bg
- PRIMARY_DARK = {dt.primary_color} darkened ~15% → h1 headline colour in hero
- PRIMARY_TINT = {dt.secondary_color} → hero section bg, CTA band bg, outer canvas bg
- CTA button bg = {accent} (rounded box shape, border-radius:8px)
- All body text: font-size = {dt.font_size_base}; line-height = {dt.line_height}; color = #1a1a1a
- Inner card border-radius: 16px (header top corners, footer bottom corners)
- Section padding based on spacing unit {dt.spacing_unit} (use multiples as needed)

Return a JSON object with a single key "email_html" whose value is the complete HTML string.
Start the HTML with <!DOCTYPE html> and end with </html>.
"""


# ── Phase 6 – Critique ────────────────────────────────────────────────────────

CRITIQUE_SCHEMA: dict = {
    "type": "object",
    "required": ["issues", "fixes", "risk_flags", "llm_commentary", "score"],
    "properties": {
        "issues": {"type": "array", "items": {"type": "string"}},
        "fixes": {"type": "array", "items": {"type": "string"}},
        "risk_flags": {"type": "array", "items": {"type": "string"}},
        "llm_commentary": {"type": "string"},
        "score": {"type": "integer", "minimum": 0, "maximum": 100},
    },
}


def build_critique_prompt(
    req: CampaignRequest,
    blueprint: dict[str, Any],
    emails: list[dict[str, Any]],
) -> str:
    email_summaries = "\n".join(
        f"Email {e.get('email_number')}: SL={e.get('subject_lines', [])[:1]}, "
        f"CTA={e.get('ctas', [])[:1]}, Body=({len(e.get('body_text',''))} chars)"
        for e in emails
    )
    return f"""\
You are a senior marketing quality-assurance reviewer and compliance expert. \
Conduct a rigorous critique of the following campaign.

BRAND CONSTRAINTS:
- Brand Voice: {req.brand.voice_guidelines}
- Banned Phrases: {req.brand.banned_phrases}
- Required Phrases: {req.brand.required_phrases}
- Legal Footer required: {"Yes" if req.brand.legal_footer else "No"}
- Compliance Notes: {req.constraints.compliance_notes}

CAMPAIGN OBJECTIVE:
- Primary KPI: {req.objective.primary_kpi.value}
- Offer: {req.objective.offer}
- Audience: {req.objective.target_audience}

STRATEGY BLUEPRINT:
- Angle: {blueprint.get('campaign_angle', '')}

GENERATED EMAILS SUMMARY:
{email_summaries}

FULL EMAIL BODIES:
{_format_email_bodies(emails)}

Critique checklist (check all of these):
1. Brand voice alignment – does copy match the voice guidelines?
2. Banned phrases – are any banned phrases present in any email?
3. Required phrases – are all required phrases included where appropriate?
4. Legal footer – is it present and complete in every email?
5. Spam risk – excessive exclamation marks, ALL CAPS, spammy trigger words?
6. Compliance – any misleading claims, unverified statistics, false urgency?
7. Clarity – are the subject lines clear and under 50 chars?
8. CTA effectiveness – are the CTAs action-oriented and clear?
9. KPI alignment – does the copy drive the stated primary KPI?
10. Overall quality – flow, tone, readability.

For each issue found:
- State the issue clearly (which email / field).
- Provide a concrete suggested fix.
- Flag as risk_flag if it is a compliance, spam, or brand-safety issue.

Score the campaign 0–100 overall (100 = flawless).

Return ONLY valid JSON:
{{
  "issues": ["Email 1: ..."],
  "fixes": ["Fix for Email 1: ..."],
  "risk_flags": ["RISK: ..."],
  "llm_commentary": "Overall assessment...",
  "score": 85
}}
"""


# ── Utilities ─────────────────────────────────────────────────────────────────


def _format_research(research: dict[str, Any]) -> str:
    lines: list[str] = []
    for key, val in research.items():
        if isinstance(val, list):
            lines.append(f"{key}:")
            for item in val:
                lines.append(f"  - {item}")
        else:
            lines.append(f"{key}: {val}")
    return "\n".join(lines)


def _format_email_bodies(emails: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for e in emails:
        num = e.get("email_number", "?")
        body = e.get("body_text", "(no body)")
        parts.append(f"--- EMAIL {num} BODY ---\n{body}")
    return "\n\n".join(parts)


# ── Phase 0 – Prompt Parsing (frontend entry point) ───────────────────────────

PARSE_SCHEMA: dict = {
    "type": "object",
    "required": ["needs_clarification", "questions", "campaign"],
    "properties": {
        "needs_clarification": {"type": "boolean"},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["field", "question"],
                "properties": {
                    "field": {"type": "string"},
                    "question": {"type": "string"},
                },
            },
        },
        "campaign": {
            "type": "object",
            "properties": {
                "campaign_name": {"type": "string"},
                "brand_name": {"type": "string"},
                "voice_guidelines": {"type": "string"},
                "banned_phrases": {"type": "array", "items": {"type": "string"}},
                "required_phrases": {"type": "array", "items": {"type": "string"}},
                "legal_footer": {"type": "string"},
                "primary_kpi": {
                    "type": "string",
                    "enum": [
                        "revenue", "conversion_rate", "open_rate", "click_through_rate",
                        "leads_generated", "brand_awareness", "customer_retention",
                        "average_order_value", "roas",
                    ],
                },
                "target_audience": {"type": "string"},
                "offer": {"type": "string"},
                "geo_scope": {"type": "string"},
                "language": {"type": "string"},
                "compliance_notes": {"type": "string"},
                "send_window": {"type": "string"},
                "discount_ceiling": {"type": "number"},
                "number_of_emails": {"type": "integer", "minimum": 1, "maximum": 10},
                "include_html": {"type": "boolean"},
            },
        },
    },
}


def build_parse_prompt(user_prompt: str, force_proceed: bool = False) -> str:
    """
    Phase 0 – parse a free-form user prompt into a structured CampaignRequest.

    If any critical information is missing or ambiguous, set needs_clarification=true
    and populate questions. Otherwise set needs_clarification=false and fill campaign.
    If force_proceed=True, never ask clarification — always extract and use defaults.
    """
    force_instruction = (
        """
IMPORTANT: The user has already answered clarification questions. \
Do NOT set needs_clarification=true under any circumstances. \
Extract every detail you can from the prompt and use sensible defaults for anything still missing. \
Always set needs_clarification=false and return a fully populated campaign object."""
        if force_proceed
        else ""
    )
    return f"""\
A user wants to generate a marketing email campaign. They described it in free text below.{force_instruction}

Your job:
1. Extract all structured campaign details you can infer from their description.
2. If critical details are MISSING OR AMBIGUOUS, set needs_clarification=true and add \
specific questions to the questions array. Ask only what is truly necessary.
3. If you have enough to proceed, set needs_clarification=false.

Critical fields that MUST be present to generate:
- What is the offer / promotion?
- Who is the target audience?
- How many emails should be in the series?
- What is the brand name?

Non-critical fields (use sensible defaults if missing):
- voice/tone → default "Professional and friendly"
- geo_scope → default "Global"
- language → default "English"
- primary_kpi → default "revenue"
- include_html → default true

USER PROMPT:
\"\"\"{user_prompt}\"\"\"

Return JSON matching the schema exactly. For campaign fields you cannot determine, \
omit them (do not guess wildly). For discount_ceiling, only include if a specific \
percentage is mentioned.
"""


# ── Rapid batch generation (fast path: replaces phases 2-6) ──────────────────

RAPID_BATCH_SCHEMA: dict = {
    "type": "object",
    "required": ["emails"],
    "properties": {
        "emails": {
            "type": "array",
            "items": {
                "type": "object",
                "required": [
                    "email_number",
                    "email_name",
                    "subject_lines",
                    "preview_text_options",
                    "ctas",
                    "send_timing",
                    "sections",
                ],
                "properties": {
                    "email_number": {"type": "integer"},
                    "email_name": {"type": "string"},
                    "subject_lines": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 2,
                    },
                    "preview_text_options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 2,
                    },
                    "ctas": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                    },
                    "send_timing": {"type": "string"},
                    "sections": {
                        "type": "object",
                        "required": [
                            "headline",
                            "preheader",
                            "intro_paragraph",
                            "offer_line",
                            "body_bullets",
                            "cta_button",
                            "urgency_line",
                            "footer_line",
                        ],
                        "properties": {
                            "headline": {"type": "string"},
                            "preheader": {"type": "string"},
                            "intro_paragraph": {"type": "string"},
                            "offer_line": {"type": "string"},
                            "body_bullets": {
                                "type": "array",
                                "items": {"type": "string"},
                                "minItems": 2,
                                "maxItems": 4,
                            },
                            "cta_button": {"type": "string"},
                            "urgency_line": {"type": "string"},
                            "footer_line": {"type": "string"},
                        },
                    },
                },
            },
        },
    },
}


def build_rapid_batch_prompt(req: CampaignRequest) -> str:
    """
    Single-call prompt that replaces phases 2-6.
    Gemini returns structured content fields; Python stitches them into HTML.
    """
    brand = req.brand
    obj = req.objective
    del_req = req.deliverables
    send_window = req.constraints.send_window or "ASAP"

    banned = ", ".join(brand.banned_phrases or []) or "none"
    required = ", ".join(brand.required_phrases or []) or "none"
    channels = ", ".join(ch.value if hasattr(ch, "value") else str(ch) for ch in req.channels) or "email"
    kpis = ", ".join(
        [obj.primary_kpi.value] + [k.value for k in (obj.secondary_kpis or [])]
    )
    n_emails = del_req.number_of_emails
    voice = brand.voice_guidelines or "professional, warm, conversational"
    brand_color = brand.design_tokens.primary_color if brand.design_tokens else "#0066cc"
    font_heading = brand.design_tokens.font_family_heading if brand.design_tokens else "Arial, sans-serif"
    font_body = brand.design_tokens.font_family_body if brand.design_tokens else "Arial, sans-serif"
    border_radius = brand.design_tokens.border_radius if brand.design_tokens else "6px"
    logo_url = brand.design_tokens.logo_url if brand.design_tokens else None
    legal_footer = brand.legal_footer or ""
    _footer_rule = ("\n- The footer_line must include the legal text: " + legal_footer) if legal_footer else ""

    return f"""\
You are a senior email marketing strategist and award-winning copywriter.

CAMPAIGN BRIEF
==============
Brand:            {brand.brand_name}
Voice/Tone:       {voice}
Banned phrases:   {banned}
Required phrases: {required}
Primary colour:   {brand_color}
Font – Heading:   {font_heading}
Font – Body:      {font_body}
Border radius:    {border_radius}{f'''
Logo URL:         {logo_url}''' if logo_url else ''}

Offer:            {obj.offer}
Target audience:  {obj.target_audience}
KPIs:             {kpis}
Language:         {obj.language or "en"}
Channels:         {channels}
Send window:      {send_window}
Number of emails: {n_emails}

TASK
====
Generate all {n_emails} email(s) for this campaign. Each email must have a distinct \
narrative angle that builds a logical arc (e.g. teaser → main offer → urgency → last-chance).

PERSONALISATION RULES
=====================
- USE the brand name "{brand.brand_name}" naturally in copy — not just in the header.
- REFLECT the brand voice "{voice}" throughout every sentence.
- WEAVE IN required phrases naturally (do not just append them): {required}
- The intro_paragraph must address the specific audience "{obj.target_audience}" directly.
- Make the offer_line specific to this brand and offer — avoid generic copy like "exclusive opportunity".{_footer_rule}

For each email return ALL of the following fields:
- email_number     integer, starting at 1
- email_name       descriptive label, e.g. "Teaser – Day 1"
- subject_lines    2 A/B variants, 40–60 chars each (emoji allowed if brand-appropriate)
- preview_text_options  2 variants, 80–100 chars each, complementing the subject
- ctas             1–2 action phrases for the CTA button(s)
- send_timing      recommended send day/time with a 1-line rationale
- sections         object with EXACTLY these 8 keys:
    headline          compelling H1, max 10 words, no trailing full stop
    preheader         80–90 chars supplementing the subject line
    intro_paragraph   2–3 sentence hook addressing the reader's specific pain or aspiration as {obj.target_audience}
    offer_line        the specific offer stated concisely for {brand.brand_name} — no generic filler
    body_bullets      2–4 benefit bullets, each max 12 words, start with a verb
    cta_button        button label, max 5 words, action-oriented
    urgency_line      1-sentence deadline/scarcity (use empty string "" if not applicable)
    footer_line       brand sign-off{f" incorporating: {legal_footer}" if legal_footer else " — friendly 1-sentence closing"}

LANGUAGE RULES
==============
- Write ALL copy in: {obj.language or "en"}
- Follow brand voice strictly: {voice}
- Never use banned phrases: {banned}
- Label any assumptions in offer_line as [Assumption: ...]
"""


# ── Email Edit Prompt (frontend "Apply Changes") ──────────────────────────────


def build_edit_email_prompt(current_html: str, subject: str, instructions: str) -> str:
    """
    Given the current HTML email and user edit instructions, produce updated HTML.
    Returns raw HTML (no JSON wrapper, no markdown fences).
    """
    return f"""\
You are editing an existing HTML email. Keep all valid structure, design, and inline CSS intact.
Only change what the user's instructions request. Do not add new sections unless asked.

CURRENT SUBJECT: {subject}

USER INSTRUCTIONS:
{instructions}

CURRENT HTML:
{current_html}

Return a JSON object with a single key "email_html" whose value is the complete updated HTML string.
Start the HTML with <!DOCTYPE html> and end with </html>.
"""
