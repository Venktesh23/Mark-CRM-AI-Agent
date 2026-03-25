"""
tests/test_email_integration.py – opt-in integration test for the email service.

Sends a REAL email through SendGrid. Skipped unless ALL of the following
environment variables are set:

    SENDGRID_API_KEY   – your SendGrid API key
    EMAIL_FROM         – verified sender address in your SendGrid account
    EMAIL_TEST_TO      – address that should receive the test email
    RUN_EMAIL_INTEGRATION_TESTS=1  – explicit opt-in flag

Run:
    RUN_EMAIL_INTEGRATION_TESTS=1 \\
    SENDGRID_API_KEY=SG.xxx \\
    EMAIL_FROM=no-reply@yourdomain.com \\
    EMAIL_TEST_TO=you@yourdomain.com \\
    pytest tests/test_email_integration.py -v

On Windows (PowerShell):
    $env:RUN_EMAIL_INTEGRATION_TESTS="1"
    $env:EMAIL_TEST_TO="you@yourdomain.com"
    pytest tests/test_email_integration.py -v
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app

# ── Opt-in guard ──────────────────────────────────────────────────────────────

_REQUIRED_VARS = ("SENDGRID_API_KEY", "EMAIL_FROM", "EMAIL_TEST_TO")
_OPT_IN_FLAG = "RUN_EMAIL_INTEGRATION_TESTS"


def _skip_reason() -> str | None:
    """Return a skip reason string, or None if the test should run."""
    if os.getenv(_OPT_IN_FLAG, "").strip() != "1":
        return f"Set {_OPT_IN_FLAG}=1 to run integration tests."
    missing = [v for v in _REQUIRED_VARS if not os.getenv(v, "").strip()]
    if missing:
        return f"Missing required env vars: {', '.join(missing)}"
    return None


# ── Fixture ───────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def integration_client():
    reason = _skip_reason()
    if reason:
        pytest.skip(reason)
    with TestClient(app) as c:
        yield c


# ── Test ──────────────────────────────────────────────────────────────────────


def test_send_real_email(integration_client: TestClient):
    """Send an actual email via SendGrid and verify the API response."""
    to_addr = os.environ["EMAIL_TEST_TO"]
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    subject = f"[Mark API] integration test {timestamp}"

    resp = integration_client.post(
        "/v1/email/send",
        json={
            "to": to_addr,
            "subject": subject,
            "text": (
                f"This is an automated integration test sent at {timestamp}.\n"
                "If you received this, the Mark API email service is working correctly.\n"
                "You can safely ignore or delete this message."
            ),
        },
    )

    assert resp.status_code == 200, f"Unexpected status {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body.get("status") == "sent", f"Unexpected response body: {body}"
    assert body.get("provider") == "sendgrid"
