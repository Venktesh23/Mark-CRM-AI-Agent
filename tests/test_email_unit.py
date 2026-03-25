"""
tests/test_email_unit.py – focused unit tests for the email service.

All SendGrid calls are mocked; no real network requests are made.

Run:
    pytest tests/test_email_unit.py -v
"""
from __future__ import annotations

import sys
from unittest.mock import MagicMock, call, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_sg_modules(mock_sg_class: MagicMock) -> dict:
    """Return a sys.modules patch dict that fakes the sendgrid package."""
    mail_mock = MagicMock()
    return {
        "sendgrid": MagicMock(SendGridAPIClient=mock_sg_class),
        "sendgrid.helpers.mail": MagicMock(
            Mail=MagicMock(return_value=mail_mock),
            Content=MagicMock(return_value=MagicMock()),
            To=MagicMock(return_value=MagicMock()),
            ReplyTo=MagicMock(return_value=MagicMock()),
        ),
    }


# ── /v1/email/config ──────────────────────────────────────────────────────────


def test_config_missing_both_vars(client: TestClient, monkeypatch):
    """configured=False and both vars listed when neither env var is set."""
    monkeypatch.setattr("app.routes.email.settings.sendgrid_api_key", "")
    monkeypatch.setattr("app.routes.email.settings.email_from", "")

    resp = client.get("/v1/email/config")

    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is False
    assert set(body["missing"]) == {"SENDGRID_API_KEY", "EMAIL_FROM"}


def test_config_missing_api_key_only(client: TestClient, monkeypatch):
    """Only SENDGRID_API_KEY listed when EMAIL_FROM is present."""
    monkeypatch.setattr("app.routes.email.settings.sendgrid_api_key", "")
    monkeypatch.setattr("app.routes.email.settings.email_from", "no-reply@example.com")

    resp = client.get("/v1/email/config")

    body = resp.json()
    assert body["configured"] is False
    assert body["missing"] == ["SENDGRID_API_KEY"]


def test_config_fully_set(client: TestClient, monkeypatch):
    """configured=True and missing=[] when all vars are present."""
    monkeypatch.setattr("app.routes.email.settings.sendgrid_api_key", "SG.fake")
    monkeypatch.setattr("app.routes.email.settings.email_from", "no-reply@example.com")

    resp = client.get("/v1/email/config")

    body = resp.json()
    assert body["configured"] is True
    assert body["missing"] == []


# ── POST /v1/email/send – validation (no mocking needed) ─────────────────────


def test_send_422_when_no_body(client: TestClient):
    """422 when both text and html are absent."""
    resp = client.post(
        "/v1/email/send",
        json={"to": "user@example.com", "subject": "Hello"},
    )
    assert resp.status_code == 422


def test_send_422_when_body_fields_are_none(client: TestClient):
    """422 when text and html are explicitly null."""
    resp = client.post(
        "/v1/email/send",
        json={"to": "user@example.com", "subject": "Hello", "text": None, "html": None},
    )
    assert resp.status_code == 422


def test_send_422_invalid_email_address(client: TestClient):
    """422 when 'to' is not a valid email."""
    resp = client.post(
        "/v1/email/send",
        json={"to": "not-an-email", "subject": "Hi", "text": "body"},
    )
    assert resp.status_code == 422


def test_send_422_missing_to(client: TestClient):
    """422 when 'to' field is absent entirely."""
    resp = client.post("/v1/email/send", json={"subject": "Hi", "text": "body"})
    assert resp.status_code == 422


# ── POST /v1/email/send – SendGrid client called exactly once ────────────────


def test_send_calls_sendgrid_once(client: TestClient, monkeypatch):
    """SendGridAPIClient.send() is called exactly once on a valid request."""
    monkeypatch.setattr("app.services.email_client.settings.sendgrid_api_key", "SG.fake")
    monkeypatch.setattr("app.services.email_client.settings.email_from", "no-reply@example.com")
    monkeypatch.setattr("app.services.email_client.settings.email_reply_to", "")

    mock_sg_class = MagicMock()
    mock_instance = MagicMock()
    mock_instance.send.return_value = MagicMock(status_code=202)
    mock_sg_class.return_value = mock_instance

    with patch.dict(sys.modules, _make_sg_modules(mock_sg_class)):
        resp = client.post(
            "/v1/email/send",
            json={"to": "user@example.com", "subject": "Test", "text": "Hello"},
        )

    assert resp.status_code == 200
    assert resp.json() == {"status": "sent", "provider": "sendgrid"}
    mock_instance.send.assert_called_once()


def test_send_calls_sendgrid_once_html(client: TestClient, monkeypatch):
    """SendGridAPIClient.send() is called once when only html body is provided."""
    monkeypatch.setattr("app.services.email_client.settings.sendgrid_api_key", "SG.fake")
    monkeypatch.setattr("app.services.email_client.settings.email_from", "no-reply@example.com")
    monkeypatch.setattr("app.services.email_client.settings.email_reply_to", "")

    mock_sg_class = MagicMock()
    mock_instance = MagicMock()
    mock_instance.send.return_value = MagicMock(status_code=202)
    mock_sg_class.return_value = mock_instance

    with patch.dict(sys.modules, _make_sg_modules(mock_sg_class)):
        resp = client.post(
            "/v1/email/send",
            json={"to": "user@example.com", "subject": "Test", "html": "<p>Hello</p>"},
        )

    assert resp.status_code == 200
    mock_instance.send.assert_called_once()


# ── POST /v1/email/send – provider error path ────────────────────────────────


def test_send_502_on_provider_error(client: TestClient, monkeypatch):
    """502 with descriptive detail when the email client raises EmailSendError."""
    from app.services.email_client import EmailSendError

    monkeypatch.setattr(
        "app.routes.email.send_email",
        MagicMock(side_effect=EmailSendError("SendGrid is down")),
    )

    resp = client.post(
        "/v1/email/send",
        json={"to": "user@example.com", "subject": "Test", "text": "hi"},
    )

    assert resp.status_code == 502
    assert "provider error" in resp.json()["detail"].lower()
