from fastapi.testclient import TestClient

from main import app


def _cashflow_result_payload() -> dict:
    return {
        "term_months": 60,
        "rent_nominal": 100000.0,
        "opex_nominal": 20000.0,
        "total_cost_nominal": 120000.0,
        "npv_cost": 95000.0,
        "avg_cost_year": 24000.0,
        "avg_cost_psf_year": 24.0,
    }


def test_report_deck_direct_route_returns_pdf(monkeypatch):
    def _fake_render_report_deck_pdf(data: dict) -> bytes:
        assert isinstance(data.get("scenarios"), list)
        return b"%PDF-1.4\n%FakeDeck\n"

    monkeypatch.setattr("reporting.deck_builder.render_report_deck_pdf", _fake_render_report_deck_pdf)
    client = TestClient(app)

    payload = {
        "scenarios": [
            {
                "scenario": {"name": "Scenario A", "rsf": 1000},
                "result": _cashflow_result_payload(),
            }
        ],
        "branding": {"client_name": "Client"},
    }
    res = client.post("/report/deck", json=payload)

    assert res.status_code == 200
    assert res.headers.get("content-type", "").startswith("application/pdf")
    assert res.content.startswith(b"%PDF-1.4")
