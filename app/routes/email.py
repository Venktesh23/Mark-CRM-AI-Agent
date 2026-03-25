"""
app/routes/email.py – email sending endpoints.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, model_validator

from app.config import settings
from app.security.supabase_jwt import require_authenticated_user
from app.services.email_client import EmailSendError, send_email

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/v1/email",
    tags=["Email"],
    dependencies=[Depends(require_authenticated_user)],
)


# ── Request / Response models ─────────────────────────────────────────────────


class SendEmailRequest(BaseModel):
    to: EmailStr
    subject: str
    text: Optional[str] = None
    html: Optional[str] = None

    @model_validator(mode="after")
    def require_body(self) -> "SendEmailRequest":
        if not self.text and not self.html:
            raise ValueError("At least one of 'text' or 'html' must be provided.")
        return self


class SendEmailResponse(BaseModel):
    status: str = "sent"
    provider: str = "sendgrid"


class EmailConfigResponse(BaseModel):
    configured: bool
    missing: list[str]
    from_email: str = ""


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post(
    "/send",
    response_model=SendEmailResponse,
    status_code=status.HTTP_200_OK,
    summary="Send a transactional email",
    responses={
        200: {"description": "Email accepted by the provider."},
        422: {"description": "Validation error – missing required fields."},
        502: {"description": "Provider error – SendGrid returned an error."},
    },
)
async def send_email_endpoint(payload: SendEmailRequest) -> SendEmailResponse:
    """Send an email via SendGrid.

    Requires **to**, **subject**, and at least one of **text** or **html**.
    """
    try:
        send_email(
            to_email=payload.to,
            subject=payload.subject,
            html=payload.html,
            text=payload.text,
        )
    except EmailSendError as exc:
        logger.error("Email send failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Email provider error: {exc}",
        ) from exc

    return SendEmailResponse()


@router.get(
    "/config",
    response_model=EmailConfigResponse,
    status_code=status.HTTP_200_OK,
    summary="Check email configuration",
    description=(
        "Returns whether all required email environment variables are set. "
        "Useful as an operational health check. Does NOT send a test email."
    ),
)
async def email_config() -> EmailConfigResponse:
    missing: list[str] = []
    if not settings.sendgrid_api_key:
        missing.append("SENDGRID_API_KEY")
    if not settings.email_from:
        missing.append("EMAIL_FROM")

    return EmailConfigResponse(configured=len(missing) == 0, missing=missing, from_email=settings.email_from or "")
