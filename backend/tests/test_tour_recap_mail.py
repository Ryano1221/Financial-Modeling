from fastapi.testclient import TestClient

import main


def test_send_tour_recap_email_uses_authenticated_sender(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "_require_supabase_user",
        lambda request: {"id": "user_123", "email": "broker@example.com"},
    )

    captured: dict[str, str] = {}

    def _capture_send(*, to_email: str, subject: str, body: str, reply_to: str = "") -> None:
        captured["to_email"] = to_email
        captured["subject"] = subject
        captured["body"] = body
        captured["reply_to"] = reply_to

    monkeypatch.setattr(main, "_send_smtp_email", _capture_send)

    client = TestClient(main.app)
    response = client.post(
        "/crm/send-tour-recap",
        json={
            "to_email": "client@example.com",
            "client_name": "Signal Wealth",
            "deal_name": "301 Congress Renewal",
            "building_name": "301 Congress",
            "suite": "1370",
            "subject": "Post-tour recap",
            "body": "Here is the recap from today’s tour.",
            "sent_by_email": "broker@example.com",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert captured["to_email"] == "client@example.com"
    assert captured["subject"] == "Post-tour recap"
    assert captured["reply_to"] == "broker@example.com"


def test_send_tour_recap_email_rejects_invalid_recipient(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "_require_supabase_user",
        lambda request: {"id": "user_123", "email": "broker@example.com"},
    )

    client = TestClient(main.app)
    response = client.post(
        "/crm/send-tour-recap",
        json={
            "to_email": "bad-email",
            "subject": "Post-tour recap",
            "body": "This should not send because the recipient is invalid.",
        },
    )

    assert response.status_code == 400
    assert "Recipient email" in response.json()["detail"]
