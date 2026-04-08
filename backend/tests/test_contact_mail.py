from fastapi import HTTPException
from fastapi.testclient import TestClient

import main


def test_contact_form_sends_to_support_inbox(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def _capture_send(*, to_email: str, subject: str, body: str, reply_to: str = "") -> None:
        captured["to_email"] = to_email
        captured["subject"] = subject
        captured["body"] = body
        captured["reply_to"] = reply_to

    monkeypatch.setattr(main, "_send_smtp_email", _capture_send)
    monkeypatch.setattr(main, "_contact_inbox_email", lambda: "info@thecremodel.com")

    client = TestClient(main.app)
    response = client.post(
        "/contact",
        json={
            "name": "Ryan Arnold",
            "email": "ryan@example.com",
            "message": "I need help with a contact form that should email support.",
        },
        headers={"user-agent": "pytest-agent"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert captured["to_email"] == "info@thecremodel.com"
    assert captured["reply_to"] == "ryan@example.com"
    assert captured["subject"] == "theCREmodel contact form | Ryan Arnold"
    assert "Ryan Arnold" in captured["body"]
    assert "ryan@example.com" in captured["body"]
    assert "pytest-agent" in captured["body"]


def test_contact_form_returns_direct_email_fallback_when_delivery_fails(monkeypatch) -> None:
    def _fail_send(*, to_email: str, subject: str, body: str, reply_to: str = "") -> None:
        raise HTTPException(status_code=503, detail="Transactional email is not configured on backend.")

    monkeypatch.setattr(main, "_send_smtp_email", _fail_send)
    monkeypatch.setattr(main, "_contact_inbox_email", lambda: "info@thecremodel.com")

    client = TestClient(main.app)
    response = client.post(
        "/contact",
        json={
            "name": "Ryan Arnold",
            "email": "ryan@example.com",
            "message": "Please forward this message to support even if SMTP is down.",
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "We couldn't deliver your message right now. Please email info@thecremodel.com directly."
