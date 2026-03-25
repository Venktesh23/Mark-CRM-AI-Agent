"""
app/services/email_client.py – thin SendGrid email client.

All SendGrid imports are local so the rest of the app stays importable even
when the sendgrid package is not installed (e.g. during unit tests that mock
this module entirely).
"""
from __future__ import annotations

import logging
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)


# ── Custom exception ──────────────────────────────────────────────────────────


class EmailSendError(RuntimeError):
    """Raised when a provider call fails."""

    def __init__(self, message: str, cause: Optional[BaseException] = None) -> None:
        super().__init__(message)
        self.__cause__ = cause


# ── Public interface ──────────────────────────────────────────────────────────


def send_email(
    to_email: str,
    subject: str,
    html: Optional[str] = None,
    text: Optional[str] = None,
) -> None:
    """Send a transactional email via SendGrid.

    Args:
        to_email: Recipient address.
        subject:  Email subject line.
        html:     HTML body (at least one of html / text must be provided).
        text:     Plain-text body (at least one of html / text must be provided).

    Raises:
        ValueError:       If both html and text are None/empty.
        EmailSendError:   If the SendGrid API call fails.
    """
    if not html and not text:
        raise ValueError("At least one of 'html' or 'text' must be provided.")

    if not settings.sendgrid_api_key:
        raise EmailSendError("SENDGRID_API_KEY is not configured.")
    if not settings.email_from:
        raise EmailSendError("EMAIL_FROM is not configured.")

    # Local import keeps the module importable without sendgrid installed.
    try:
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail, Content, To, ReplyTo
    except ImportError as exc:  # pragma: no cover
        raise EmailSendError("sendgrid package is not installed.", cause=exc) from exc

    message = Mail(
        from_email=settings.email_from,
        to_emails=to_email,
        subject=subject,
    )

    if html:
        message.add_content(Content("text/html", html))
    if text:
        message.add_content(Content("text/plain", text))

    if settings.email_reply_to:
        message.reply_to = ReplyTo(settings.email_reply_to)

    try:
        sg = SendGridAPIClient(settings.sendgrid_api_key)
        response = sg.send(message)
        logger.info(
            "Email sent via SendGrid",
            extra={"to": to_email, "status_code": response.status_code},
        )
    except Exception as exc:
        raise EmailSendError(
            f"SendGrid returned an error while sending to {to_email}: {exc}",
            cause=exc,
        ) from exc
