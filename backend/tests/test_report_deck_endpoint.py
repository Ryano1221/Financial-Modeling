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


def test_report_deck_direct_route_ignores_cache_read_failure(monkeypatch):
    def _fake_render_report_deck_pdf(data: dict) -> bytes:
        return b"%PDF-1.4\n%FakeDeck\n"

    def _fake_cache_read(*args, **kwargs):
        raise RuntimeError("cache read failed")

    monkeypatch.setattr("main.get_cached_report_deck", _fake_cache_read)
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


def test_report_deck_direct_route_ignores_cache_write_failure(monkeypatch):
    def _fake_render_report_deck_pdf(data: dict) -> bytes:
        return b"%PDF-1.4\n%FakeDeck\n"

    def _fake_cache_write(*args, **kwargs):
        raise RuntimeError("cache write failed")

    monkeypatch.setattr("main.set_cached_report_deck", _fake_cache_write)
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


def test_report_deck_direct_route_accepts_custom_charts(monkeypatch):
    def _fake_render_report_deck_pdf(data: dict) -> bytes:
        custom_charts = data.get("custom_charts")
        assert isinstance(custom_charts, list)
        assert len(custom_charts) == 1
        assert custom_charts[0].get("title") == "Two-Metric Comparison"
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
        "custom_charts": [
            {
                "title": "Two-Metric Comparison",
                "bar_metric_key": "npv_8pct",
                "bar_metric_label": "NPV @ Discount Rate",
                "line_metric_key": "avg_cost_psf_year",
                "line_metric_label": "Avg Cost/SF/YR",
                "sort_direction": "desc",
                "points": [
                    {
                        "scenario_name": "Scenario A",
                        "bar_value": 1000000,
                        "line_value": 24.0,
                        "bar_value_display": "$1,000,000",
                        "line_value_display": "$24.00 / SF",
                    }
                ],
            }
        ],
    }
    res = client.post("/report/deck", json=payload)

    assert res.status_code == 200
    assert res.headers.get("content-type", "").startswith("application/pdf")
    assert res.content.startswith(b"%PDF-1.4")
