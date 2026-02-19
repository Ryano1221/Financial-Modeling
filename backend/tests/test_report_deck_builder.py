from __future__ import annotations

from datetime import date

import pytest
from pydantic import ValidationError

from engine.compute import compute_cashflows
from models import OpexMode, RentStep, ReportBranding, Scenario
from reporting.deck_builder import build_report_deck_html, resolve_theme


def _entry(name: str, rsf: float, base_rate: float, doc_type: str = "proposal") -> dict:
    scenario = Scenario(
        name=name,
        rsf=rsf,
        commencement=date(2026, 1, 1),
        expiration=date(2031, 1, 1),
        rent_steps=[RentStep(start=0, end=59, rate_psf_yr=base_rate)],
        free_rent_months=2,
        ti_allowance_psf=20.0,
        opex_mode=OpexMode.NNN,
        base_opex_psf_yr=10.0,
        base_year_opex_psf_yr=10.0,
        opex_growth=0.03,
        discount_rate_annual=0.06,
        notes="Renewal option for 5 years; ROFR applies; OpEx excludes capital repairs.",
    )
    scenario_json = scenario.model_dump(mode="json")
    scenario_json["document_type_detected"] = doc_type
    _, result = compute_cashflows(scenario)
    return {"scenario": scenario_json, "result": result.model_dump()}


def test_build_report_deck_html_includes_required_sections():
    payload = {
        "scenarios": [
            _entry("Eastlake Building 1 Suite 1100", 5900, 42.0, doc_type="proposal"),
            _entry("Eastbound Suite 2-380", 3226, 38.0, doc_type="counter proposal"),
        ],
        "branding": {
            "brandName": "Sample Brokerage",
            "preparedByName": "Alex Broker",
            "preparedByTitle": "Senior Vice President",
            "preparedByCompany": "Sample Brokerage",
            "preparedByEmail": "alex@samplebrokerage.com",
            "preparedByPhone": "+1 555 000 1111",
            "client_name": "Client Holdings",
            "date": "2026-02-19",
            "market": "Austin",
            "submarket": "East Austin",
            "disclaimerOverride": "Custom disclaimer for this client package.",
        },
    }
    html = build_report_deck_html(payload)
    assert "INVESTOR FINANCIAL ANALYSIS".lower() in html.lower()
    assert "Lease Economics Comparison Deck" in html
    assert "Executive summary" in html
    assert "Comparison Matrix" in html
    assert "Scenario Cost Comparison" in html
    assert "Lease Abstract Highlights" in html
    assert "Scenario detail" in html
    assert "Important Limitations" in html
    assert "Custom disclaimer for this client package." in html
    assert "Alex Broker" in html
    assert "Client Holdings" in html


def test_comparison_matrix_paginates_for_many_options():
    payload = {
        "scenarios": [
            _entry(f"Long Building Name Scenario {i} With Additional Descriptor", 8000 + i * 10, 35 + (i % 3))
            for i in range(10)
        ],
        "branding": {"client_name": "Portfolio Client", "broker_name": "theCREmodel"},
    }
    html = build_report_deck_html(payload)
    # Should produce multiple matrix pages for 10 options.
    assert html.count("Comparison Matrix") >= 4
    assert "Options 1-3 of 10" in html


def test_resolve_theme_defaults_to_thecremodel():
    theme = resolve_theme({})
    assert theme.brand_name == "theCREmodel"
    assert theme.prepared_by_name == "theCREmodel"
    assert theme.prepared_for == "Client"


def test_report_branding_validates_new_fields():
    branding = ReportBranding(
        brandName="Broker Co",
        logoAssetUrl="https://cdn.example.com/logo.svg",
        coverPhoto="https://cdn.example.com/cover.jpg",
        primaryColor="#111111",
        preparedByName="Jane Doe",
        preparedByCompany="Broker Co",
        preparedByEmail="jane@broker.co",
        disclaimerOverride="Client-specific disclaimer.",
    )
    assert branding.brand_name == "Broker Co"
    assert branding.logo_asset_url == "https://cdn.example.com/logo.svg"
    assert branding.primary_color == "#111111"
    assert branding.prepared_by_name == "Jane Doe"


def test_report_branding_rejects_invalid_media_inputs():
    with pytest.raises(ValidationError):
        ReportBranding(primaryColor="blue")
    with pytest.raises(ValidationError):
        ReportBranding(logoAssetUrl="ftp://bad.example.com/logo.png")
    with pytest.raises(ValidationError):
        ReportBranding(logoAssetBytes="not-base64")

