from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import Workbook
from pathlib import Path

import main


HEADERS = [
    "PropertyID",
    "Property Name",
    "Property Address",
    "City",
    "State",
    "Market Name",
    "Submarket Name",
    "Property Type",
    "Building Class",
    "Building Status",
    "RBA",
    "Parking Ratio",
]


def _workbook_bytes() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(HEADERS)
    ws.append(["100", "Tower One", "100 Main St", "Austin", "TX", "Austin", "CBD", "Office", "A", "Existing", 125000, 3.5])
    ws.append(["200", "Warehouse Two", "200 Side St", "Austin", "TX", "Austin", "SE", "Industrial", "B", "Existing", 45000, 1.2])
    ws.append(["100", "Tower One", "100 Main St", "Austin", "TX", "Austin", "CBD", "Office", "A", "Existing", 125000, 3.5])
    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def test_get_market_inventory_returns_shared_payload(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "_load_shared_market_inventory",
        lambda: ({
            "source": "costar_excel_import",
            "updated_at": "2026-03-23T10:00:00Z",
            "summary": {"count": 1},
            "records": [{"id": "costar_100", "name": "Tower One"}],
        }, True),
    )

    client = TestClient(main.app)
    response = client.get("/market-inventory")

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "costar_excel_import"
    assert payload["count"] == 1
    assert payload["records"][0]["id"] == "costar_100"


def test_post_market_inventory_import_parses_and_merges(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "_require_supabase_user",
        lambda request: {"id": "user_123", "email": "broker@example.com"},
    )
    monkeypatch.setattr(
        main,
        "_load_shared_market_inventory",
        lambda: ({
            "records": [{
                "id": "costar_legacy",
                "clientId": "market_inventory_shared",
                "name": "Legacy Plaza",
                "address": "1 Legacy Way",
                "market": "Austin",
                "submarket": "North",
                "propertyId": "legacy",
            }],
        }, True),
    )

    captured: dict[str, object] = {}

    def _capture_save(envelope: dict[str, object]) -> None:
        captured["envelope"] = envelope

    monkeypatch.setattr(main, "_save_shared_market_inventory", _capture_save)

    client = TestClient(main.app)
    response = client.post(
        "/market-inventory/import/costar",
        files={
            "file": (
                "costar-import.xlsx",
                _workbook_bytes(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    names = {record["name"] for record in payload["records"]}
    assert names == {"Legacy Plaza", "Tower One"}
    saved = captured["envelope"]
    assert isinstance(saved, dict)
    assert saved["summary"]["import_filename"] == "costar-import.xlsx"
    assert saved["summary"]["imported_by_email"] == "broker@example.com"


def test_get_market_inventory_falls_back_to_local_when_storage_errors(monkeypatch, tmp_path: Path) -> None:
    local_path = tmp_path / "shared_market_inventory.json"
    local_path.write_text(
        '{"source":"local_fallback","updated_at":"2026-03-23T11:00:00Z","records":[{"id":"costar_local","name":"Fallback Tower"}]}',
        encoding="utf-8",
    )
    monkeypatch.setattr(main, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(main, "SUPABASE_ANON_KEY", "anon")
    monkeypatch.setattr(main, "SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("SHARED_MARKET_INVENTORY_PATH", str(local_path))
    monkeypatch.setattr(main, "_http_bytes_request", lambda *args, **kwargs: (500, b"storage down"))

    client = TestClient(main.app)
    response = client.get("/market-inventory")

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "local_fallback"
    assert payload["count"] == 1
    assert payload["records"][0]["name"] == "Fallback Tower"


def test_post_market_inventory_import_falls_back_to_local_save_when_storage_errors(monkeypatch, tmp_path: Path) -> None:
    local_path = tmp_path / "shared_market_inventory.json"
    monkeypatch.setattr(main, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(main, "SUPABASE_ANON_KEY", "anon")
    monkeypatch.setattr(main, "SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("SHARED_MARKET_INVENTORY_PATH", str(local_path))
    monkeypatch.setattr(
        main,
        "_require_supabase_user",
        lambda request: {"id": "user_123", "email": "broker@example.com"},
    )

    def _fake_http_bytes_request(url: str, method: str = "GET", **kwargs):
        if method == "GET":
            return (404, b"")
        return (500, b"write failed")

    monkeypatch.setattr(main, "_http_bytes_request", _fake_http_bytes_request)

    client = TestClient(main.app)
    response = client.post(
        "/market-inventory/import/costar",
        files={
            "file": (
                "costar-import.xlsx",
                _workbook_bytes(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    saved = local_path.read_text(encoding="utf-8")
    assert "Tower One" in saved
