"""
tests/test_email.py – unit tests for email endpoints and email client.

Run with:
    pytest tests/test_email.py -v
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app

# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


# ── /v1/email/config ──────────────────────────────────────────────────────────


def test_config_missing_both(client: TestClient, monkeypatch):
    """Returns configured=False and lists missing vars when nothing is set."""
    monkeypatch.setattr("app.routes.email.settings.sendgrid_api_key", "")
    monkeypatch.setattr("app.routes.email.settings.email_from", "")

    resp = client.get("/v1/email/config")

    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is False
    assert "SENDGRID_API_KEY" in body["missing"]
    assert "EMAIL_FROM" in body["missing"]


def test_config_missing_only_key(client: TestClient, monkeypatch):
    """Reports only SENDGRID_API_KEY when EMAIL_FROM is present."""
    monkeypatch.setattr("app.routes.email.settings.sendgrid_api_key", "")
    monkeypatch.setattr("app.routes.email.settings.email_from", "no-reply@example.com")

    resp = client.get("/v1/email/config")

    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is False
    assert body["missing"] == ["SENDGRID_API_KEY"]


def test_config_fully_configured(client: TestClient, monkeypatch):
    """Returns configured=True when all required vars are present."""
    monkeypatch.setattr("app.routes.email.settings.sendgrid_api_key", "SG.fake_key")
    monkeypatch.setattr("app.routes.email.settings.email_from", "no-reply@example.com")

    resp = client.get("/v1/email/config")

    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is True
    assert body["missing"] == []


# ── POST /v1/email/send – validation ─────────────────────────────────────────


def test_send_rejects_missing_body(client: TestClient):
    """422 when neither text nor html is provided."""
    resp = client.post(
        "/v1/email/send",
        json={"to": "user@example.com", "subject": "Hello"},
    )
    assert resp.status_code == 422


def test_send_rejects_invalid_email(client: TestClient):
    """422 when 'to' is not a valid email address."""
    resp = client.post(
        "/v1/email/send",
        json={"to": "not-an-email", "subject": "Hello", "text": "hi"},
    )
    assert resp.status_code == 422


def test_send_rejects_missing_to(client: TestClient):
    """422 when 'to' field is absent."""
    resp = client.post(
        "/v1/email/send",
        json={"subject": "Hello", "text": "hi"},
    )
    assert resp.status_code == 422


# ── POST /v1/email/send – happy path (mocked SendGrid) ───────────────────────


@patch("app.services.email_client.SendGridAPIClient", create=True)
def test_send_success_text_only(mock_sg_class: MagicMock, client: TestClient, monkeypatch):
    """200 with correct payload when SendGrid succeeds (text only)."""
    monkeypatch.setattr("app.services.email_client.settings.sendgrid_api_key", "SG.fake_key")
    monkeypatch.setattr("app.services.email_client.settings.email_from", "no-reply@example.com")
    monkeypatch.setattr("app.services.email_client.settings.email_reply_to", "")

    mock_instance = MagicMock()
    mock_instance.send.return_value = MagicMock(status_code=202)
    mock_sg_class.return_value = mock_instance

    # Ensure sendgrid helpers can be imported inside the function
    with patch.dict(
        "sys.modules",
        {
            "sendgrid": MagicMock(SendGridAPIClient=mock_sg_class),
            "sendgrid.helpers.mail": MagicMock(
                Mail=MagicMock(return_value=MagicMock()),
                Content=MagicMock(return_value=MagicMock()),
                To=MagicMock(return_value=MagicMock()),
                ReplyTo=MagicMock(return_value=MagicMock()),
            ),
        },
    ):
        resp = client.post(
            "/v1/email/send",
            json={"to": "user@example.com", "subject": "Test", "text": "Hello"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "sent"
    assert body["provider"] == "sendgrid"


@patch("app.services.email_client.SendGridAPIClient", create=True)
def test_send_success_html_only(mock_sg_class: MagicMock, client: TestClient, monkeypatch):
    """200 when only html body is provided."""
    monkeypatch.setattr("app.services.email_client.settings.sendgrid_api_key", "SG.fake_key")
    monkeypatch.setattr("app.services.email_client.settings.email_from", "no-reply@example.com")
    monkeypatch.setattr("app.services.email_client.settings.email_reply_to", "")

    mock_instance = MagicMock()
    mock_instance.send.return_value = MagicMock(status_code=202)
    mock_sg_class.return_value = mock_instance

    with patch.dict(
        "sys.modules",
        {
            "sendgrid": MagicMock(SendGridAPIClient=mock_sg_class),
            "sendgrid.helpers.mail": MagicMock(
                Mail=MagicMock(return_value=MagicMock()),
                Content=MagicMock(return_value=MagicMock()),
                To=MagicMock(return_value=MagicMock()),
                ReplyTo=MagicMock(return_value=MagicMock()),
            ),
        },
    ):
        resp = client.post(
            "/v1/email/send",
            json={"to": "user@example.com", "subject": "Test", "html": "<p>Hi</p>"},
        )

    assert resp.status_code == 200


# ── POST /v1/email/send – provider error ─────────────────────────────────────


def test_send_returns_502_on_provider_error(client: TestClient, monkeypatch):
    """502 when the email client raises EmailSendError."""
    from app.services.email_client import EmailSendError

    monkeypatch.setattr(
        "app.routes.email.send_email",
        MagicMock(side_effect=EmailSendError("SendGrid down")),
    )

    resp = client.post(
        "/v1/email/send",
        json={"to": "user@example.com", "subject": "Test", "text": "hi"},
    )

    assert resp.status_code == 502
    assert "provider error" in resp.json()["detail"].lower()
