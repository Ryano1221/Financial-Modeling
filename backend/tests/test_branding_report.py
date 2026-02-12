"""Tests for BrandConfig, report data builder, and report endpoints."""
from datetime import date

from fastapi.testclient import TestClient

# Conftest adds backend dir to path: use direct imports (no backend. prefix)
from main import app
from models import CashflowResult, OpexMode, RentStep, Scenario
from models_branding import BrandConfig
from engine.compute import compute_cashflows
from reporting.report_data import build_report_data


def _minimal_scenario() -> Scenario:
    return Scenario(
        name="Test",
        rsf=10000.0,
        commencement=date(2026, 1, 1),
        expiration=date(2031, 1, 1),
        rent_steps=[RentStep(start=0, end=59, rate_psf_yr=30.0)],
        free_rent_months=3,
        ti_allowance_psf=50.0,
        opex_mode=OpexMode.NNN,
        base_opex_psf_yr=10.0,
        base_year_opex_psf_yr=10.0,
        opex_growth=0.03,
        discount_rate_annual=0.06,
    )


# --- BrandConfig validation ---
def test_brand_config_valid():
    b = BrandConfig(
        brand_id="test",
        company_name="Test Co",
        primary_color="#000",
        secondary_color="#333",
        font_family="Arial",
        disclaimer_text="Disclaimer.",
        cover_page_enabled=True,
    )
    assert b.brand_id == "test"
    assert b.company_name == "Test Co"
    assert b.cover_page_enabled is True
    assert b.default_assumptions == {}


def test_brand_config_optional_fields():
    b = BrandConfig(
        brand_id="x",
        company_name="X",
        logo_url="https://example.com/logo.png",
        header_text="Header",
        footer_text="Footer",
        watermark_text="Draft",
    )
    assert b.logo_url == "https://example.com/logo.png"
    assert b.watermark_text == "Draft"


def test_brand_config_new_fields_backwards_compatible():
    """New optional fields have defaults and are backwards compatible."""
    b = BrandConfig(
        brand_id="y",
        company_name="Y",
        disclaimer_text="D",
    )
    assert b.support_email is None
    assert b.contact_phone is None
    assert b.address is None
    assert b.report_title_override is None
    assert b.include_confidence_section is False
    assert b.include_methodology_section is True
    assert b.page_margin_mm == 18
    assert b.table_density == "standard"


def test_brand_config_new_fields_populated():
    b = BrandConfig(
        brand_id="z",
        company_name="Z",
        support_email="a@b.com",
        contact_phone="+1 555",
        address="123 Main St",
        report_title_override="Custom Title",
        include_confidence_section=True,
        table_density="compact",
    )
    assert b.support_email == "a@b.com"
    assert b.table_density == "compact"
    assert b.include_confidence_section is True


# --- Report data builder ---
def test_report_data_builder_correctness():
    scenario = _minimal_scenario()
    _, compute_result = compute_cashflows(scenario)
    data = build_report_data(scenario, compute_result)

    assert "key_terms" in data
    assert any(k == "Scenario" for k, _ in data["key_terms"])
    assert "financial_summary" in data
    assert data["financial_summary"]["term_months"] == scenario.term_months
    assert data["financial_summary"]["rent_nominal"] > 0
    assert "rent_schedule" in data
    assert len(data["rent_schedule"]) >= 1
    assert "assumptions" in data
    assert len(data["assumptions"]) >= 1
    assert "risk_observations" in data
    assert "scenario_name" in data
    assert data["scenario_name"] == scenario.name
    assert "executive_summary_paragraph" in data
    assert "notes_limitations" in data
    assert "methodology_html" in data
    assert "confidence_table" in data


def test_report_data_includes_warnings_and_low_confidence():
    scenario = _minimal_scenario()
    _, compute_result = compute_cashflows(scenario)
    data = build_report_data(
        scenario,
        compute_result,
        warnings=["Custom warning"],
        confidence={"rsf": 0.5},
    )
    assert "Custom warning" in data["risk_observations"]
    assert any("rsf" in r.lower() or "confidence" in r.lower() for r in data["risk_observations"])


# --- Endpoints ---
def test_get_brands_returns_list():
    client = TestClient(app)
    response = client.get("/brands")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 2
    ids = [b["brand_id"] for b in data]
    assert "default" in ids
    assert "sample" in ids


def test_post_report_returns_pdf_content_type():
    client = TestClient(app)
    scenario = _minimal_scenario()
    payload = {
        "brand_id": "default",
        "scenario": scenario.model_dump(mode="json"),
        "meta": {},
    }
    response = client.post("/report", json=payload)
    # May be 200 (PDF) or 503 if Playwright not installed
    if response.status_code == 200:
        assert response.headers.get("content-type", "").startswith("application/pdf")
        assert len(response.content) > 100
    else:
        assert response.status_code == 503


def test_post_report_preview_returns_html():
    client = TestClient(app)
    scenario = _minimal_scenario()
    payload = {
        "brand_id": "default",
        "scenario": scenario.model_dump(mode="json"),
        "meta": {},
    }
    response = client.post("/report/preview", json=payload)
    assert response.status_code == 200
    html = response.text
    assert "Lease Financial Analysis" in html or "Executive Summary" in html or "Financial Summary" in html


def test_post_report_preview_contains_key_sections():
    client = TestClient(app)
    scenario = _minimal_scenario()
    payload = {
        "brand_id": "default",
        "scenario": scenario.model_dump(mode="json"),
        "meta": {},
    }
    response = client.post("/report/preview", json=payload)
    assert response.status_code == 200
    html = response.text
    assert "Executive Summary" in html
    assert "Financial Summary" in html
    assert "Rent Schedule" in html
    assert "Assumptions" in html
    assert "Risk" in html and "Observations" in html
    assert "Notes" in html and "Limitations" in html
    assert "Disclaimers" in html


def test_post_report_preview_returns_x_report_id():
    client = TestClient(app)
    scenario = _minimal_scenario()
    payload = {
        "brand_id": "default",
        "scenario": scenario.model_dump(mode="json"),
        "meta": {},
    }
    response = client.post("/report/preview", json=payload)
    assert response.status_code == 200
    assert "X-Report-ID" in response.headers
    assert len(response.headers["X-Report-ID"]) >= 1


def test_post_report_returns_x_report_id_when_pdf():
    client = TestClient(app)
    scenario = _minimal_scenario()
    payload = {
        "brand_id": "default",
        "scenario": scenario.model_dump(mode="json"),
        "meta": {},
    }
    response = client.post("/report", json=payload)
    assert "X-Report-ID" in response.headers
    assert len(response.headers["X-Report-ID"]) >= 1
    if response.status_code == 200:
        assert response.headers.get("content-type", "").startswith("application/pdf")
    else:
        assert response.status_code == 503


def test_post_report_unknown_brand_400():
    client = TestClient(app)
    scenario = _minimal_scenario()
    response = client.post(
        "/report",
        json={"brand_id": "nonexistent", "scenario": scenario.model_dump(mode="json")},
    )
    assert response.status_code == 400
