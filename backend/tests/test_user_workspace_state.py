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
    uploaded_sections: dict[str, object] = {}

    def _capture_upload(user_id: str, workspace_state: dict) -> dict[str, object]:
        captured["user_id"] = user_id
        captured["workspace_state"] = workspace_state
        return {"object_path": "workspace/user_999/state.json", "bytes": 123}

    def _capture_section_upload(user_id: str, section_key: str, value: object) -> dict[str, object]:
        uploaded_sections[section_key] = value
        return {"object_path": f"workspace/{user_id}/sections/{section_key}.json", "bytes": 64}

    monkeypatch.setattr(main, "_storage_upload_workspace_state", _capture_upload)
    monkeypatch.setattr(main, "_storage_upload_workspace_section", _capture_section_upload)

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
    assert uploaded.get("version") == 2
    assert uploaded.get("workspace_state") == {"activeClientId": "c1"}
    assert uploaded.get("external_sections") == {
        "clients": "workspace/user_999/sections/clients.json",
        "documents": "workspace/user_999/sections/documents.json",
    }
    assert uploaded_sections["clients"] == body["workspace_state"]["clients"]
    assert uploaded_sections["documents"] == []


def test_get_workspace_section_returns_value(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "_require_supabase_user",
        lambda request: {"id": "user_abc", "email": "user@example.com"},
    )
    monkeypatch.setattr(
        main,
        "_storage_download_workspace_envelope",
        lambda user_id: (
            {
                "version": 2,
                "workspace_state": {},
                "external_sections": {
                    "obligations_module_v1::client_1": "workspace/user_abc/sections/obligations.json",
                },
            },
            "2026-03-11T13:00:00Z",
        ),
    )
    monkeypatch.setattr(
        main,
        "_storage_download_workspace_section_by_path",
        lambda object_path: (True, {"documents": [{"id": "doc_1"}]}),
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
        "_storage_download_workspace_envelope",
        lambda user_id: (
            {
                "version": 2,
                "workspace_state": {
                    "activeClientId": "c1",
                },
                "external_sections": {
                    "clients": "workspace/user_xyz/sections/clients.json",
                    "documents": "workspace/user_xyz/sections/documents.json",
                },
            },
            "2026-03-11T13:00:00Z",
        ),
    )

    captured: dict[str, object] = {}
    uploaded_sections: dict[str, object] = {}

    def _capture_upload(user_id: str, workspace_state: dict) -> dict[str, object]:
        captured["user_id"] = user_id
        captured["workspace_state"] = workspace_state
        return {"object_path": "workspace/user_xyz/state.json", "bytes": 250}

    def _capture_section_upload(user_id: str, section_key: str, value: object) -> dict[str, object]:
        uploaded_sections[section_key] = value
        return {"object_path": f"workspace/{user_id}/sections/{section_key}.json", "bytes": 90}

    monkeypatch.setattr(main, "_storage_upload_workspace_state", _capture_upload)
    monkeypatch.setattr(main, "_storage_upload_workspace_section", _capture_section_upload)

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
    assert uploaded.get("version") == 2
    assert isinstance(uploaded.get("workspace_state"), dict)
    assert uploaded["workspace_state"]["activeClientId"] == "c1"
    assert uploaded.get("external_sections") == {
        "clients": "workspace/user_xyz/sections/clients.json",
        "documents": "workspace/user_xyz/sections/documents.json",
        "sublease_recovery_analysis_scenarios_v2::client_1": "workspace/user_xyz/sections/sublease_recovery_analysis_scenarios_v2::client_1.json",
    }
    assert uploaded_sections["sublease_recovery_analysis_scenarios_v2::client_1"] == {
        "seed": "abc123",
        "scenarios": [{"id": "s1"}],
    }


def test_storage_download_workspace_state_hydrates_external_sections(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "_storage_download_workspace_envelope",
        lambda user_id: (
            {
                "version": 2,
                "updated_at": "2026-03-11T14:00:00Z",
                "workspace_state": {
                    "activeClientId": "c1",
                },
                "external_sections": {
                    "clients": "workspace/user_123/sections/clients.json",
                    "documents": "workspace/user_123/sections/documents.json",
                },
            },
            "2026-03-11T14:00:00Z",
        ),
    )
    monkeypatch.setattr(
        main,
        "_storage_download_workspace_section_by_path",
        lambda object_path: (
            True,
            [{"id": "c1", "name": "Client A"}]
            if object_path.endswith("clients.json")
            else [{"id": "d1", "name": "Lease.pdf"}],
        ),
    )

    state, updated_at = main._storage_download_workspace_state("user_123")

    assert updated_at == "2026-03-11T14:00:00Z"
    assert state == {
        "activeClientId": "c1",
        "clients": [{"id": "c1", "name": "Client A"}],
        "documents": [{"id": "d1", "name": "Lease.pdf"}],
    }


def test_storage_download_workspace_envelope_uses_authenticated_storage_endpoint(monkeypatch) -> None:
    monkeypatch.setattr(main, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(main, "SUPABASE_WORKSPACE_BUCKET", "workspace-bucket")
    monkeypatch.setattr(main, "_admin_headers", lambda: {"authorization": "Bearer service"})

    captured: dict[str, str] = {}

    def _capture_request(url: str, **kwargs):
        captured["url"] = url
        return 404, b""

    monkeypatch.setattr(main, "_http_bytes_request", _capture_request)

    payload, updated_at = main._storage_download_workspace_envelope("user_123")

    assert payload is None
    assert updated_at is None
    assert captured["url"] == (
        "https://example.supabase.co/storage/v1/object/authenticated/"
        "workspace-bucket/workspace/user_123/state.json"
    )
