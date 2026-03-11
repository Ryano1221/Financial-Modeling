from fastapi.testclient import TestClient

import main


def test_get_user_workspace_state_returns_cloud_payload(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "_require_supabase_user",
        lambda request: {"id": "user_123", "email": "user@example.com"},
    )
    monkeypatch.setattr(
        main,
        "_storage_download_workspace_state",
        lambda user_id: (
            {
                "clients": [{"id": "c1", "name": "Signal Wealth"}],
                "documents": [{"id": "d1", "name": "RFP.docx"}],
                "activeClientId": "c1",
            },
            "2026-03-11T12:00:00Z",
        ),
    )

    client = TestClient(main.app)
    response = client.get("/user-settings/workspace")

    assert response.status_code == 200
    payload = response.json()
    assert payload["user_id"] == "user_123"
    assert payload["workspace_state"]["activeClientId"] == "c1"
    assert len(payload["workspace_state"]["clients"]) == 1
    assert payload["updated_at"] == "2026-03-11T12:00:00Z"


def test_put_user_workspace_state_uploads_envelope(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "_require_supabase_user",
        lambda request: {"id": "user_999", "email": "user@example.com"},
    )

    captured: dict[str, object] = {}

    def _capture_upload(user_id: str, workspace_state: dict) -> dict[str, object]:
        captured["user_id"] = user_id
        captured["workspace_state"] = workspace_state
        return {"object_path": "workspace/user_999/state.json", "bytes": 123}

    monkeypatch.setattr(main, "_storage_upload_workspace_state", _capture_upload)

    client = TestClient(main.app)
    body = {
        "workspace_state": {
            "clients": [{"id": "c1", "name": "Client A"}],
            "documents": [],
            "activeClientId": "c1",
        }
    }
    response = client.put("/user-settings/workspace", json=body)

    assert response.status_code == 200
    payload = response.json()
    assert payload["user_id"] == "user_999"
    assert payload["workspace_state"]["activeClientId"] == "c1"
    assert isinstance(payload.get("updated_at"), str) and payload["updated_at"].endswith("Z")

    assert captured["user_id"] == "user_999"
    uploaded = captured["workspace_state"]
    assert isinstance(uploaded, dict)
    assert uploaded.get("version") == 1
    assert uploaded.get("workspace_state") == body["workspace_state"]


def test_get_workspace_section_returns_value(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "_require_supabase_user",
        lambda request: {"id": "user_abc", "email": "user@example.com"},
    )
    monkeypatch.setattr(
        main,
        "_storage_download_workspace_state",
        lambda user_id: (
            {
                "obligations_module_v1::client_1": {"documents": [{"id": "doc_1"}]},
            },
            "2026-03-11T13:00:00Z",
        ),
    )

    client = TestClient(main.app)
    response = client.get("/user-settings/workspace/section/obligations_module_v1::client_1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["user_id"] == "user_abc"
    assert payload["section_key"] == "obligations_module_v1::client_1"
    assert payload["value"] == {"documents": [{"id": "doc_1"}]}
    assert payload["updated_at"] == "2026-03-11T13:00:00Z"


def test_put_workspace_section_merges_and_saves(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "_require_supabase_user",
        lambda request: {"id": "user_xyz", "email": "user@example.com"},
    )
    monkeypatch.setattr(
        main,
        "_storage_download_workspace_state",
        lambda user_id: (
            {
                "clients": [{"id": "c1"}],
                "documents": [{"id": "d1"}],
            },
            "2026-03-11T13:00:00Z",
        ),
    )

    captured: dict[str, object] = {}

    def _capture_upload(user_id: str, workspace_state: dict) -> dict[str, object]:
        captured["user_id"] = user_id
        captured["workspace_state"] = workspace_state
        return {"object_path": "workspace/user_xyz/state.json", "bytes": 250}

    monkeypatch.setattr(main, "_storage_upload_workspace_state", _capture_upload)

    client = TestClient(main.app)
    response = client.put(
        "/user-settings/workspace/section/sublease_recovery_analysis_scenarios_v2::client_1",
        json={"value": {"seed": "abc123", "scenarios": [{"id": "s1"}]}},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["user_id"] == "user_xyz"
    assert payload["section_key"] == "sublease_recovery_analysis_scenarios_v2::client_1"
    assert payload["value"] == {"seed": "abc123", "scenarios": [{"id": "s1"}]}
    assert isinstance(payload.get("updated_at"), str) and payload["updated_at"].endswith("Z")

    uploaded = captured["workspace_state"]
    assert isinstance(uploaded, dict)
    assert uploaded.get("version") == 1
    assert isinstance(uploaded.get("workspace_state"), dict)
    assert uploaded["workspace_state"]["clients"] == [{"id": "c1"}]
    assert uploaded["workspace_state"]["documents"] == [{"id": "d1"}]
    assert uploaded["workspace_state"]["sublease_recovery_analysis_scenarios_v2::client_1"] == {
        "seed": "abc123",
        "scenarios": [{"id": "s1"}],
    }
