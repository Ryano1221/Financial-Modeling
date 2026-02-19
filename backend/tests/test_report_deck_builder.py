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


def test_build_report_deck_uses_logo_in_cover_header_and_prepared_by():
    logo_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7YqXQAAAAASUVORK5CYII="
    payload = {
        "scenarios": [_entry("Logo Validation Scenario", 5000, 40.0)],
        "branding": {
            "client_name": "Test Client",
            "preparedByName": "Brand User",
            "logoAssetBytes": logo_b64,
        },
    }
    html = build_report_deck_html(payload)
    assert "class=\"cover-logo\"" in html
    assert "class=\"brand-logo\"" in html
    assert "class=\"prepared-by-logo\"" in html


def test_comparison_matrix_supports_ten_options_on_one_page():
    payload = {
        "scenarios": [
            _entry(f"Long Building Name Scenario {i} With Additional Descriptor", 8000 + i * 10, 35 + (i % 3))
            for i in range(10)
        ],
        "branding": {"client_name": "Portfolio Client", "broker_name": "theCREmodel"},
    }
    html = build_report_deck_html(payload)
    assert html.count("Comparison Matrix") >= 1
    assert "Options 1-10 of 10" in html


def test_cost_visuals_and_abstracts_paginate_for_large_sets():
    payload = {
        "scenarios": [
            _entry(f"Portfolio Scenario {i}", 7000 + i * 100, 33 + (i % 4), doc_type="proposal")
            for i in range(10)
        ],
        "branding": {"client_name": "Large Portfolio Client"},
    }
    html = build_report_deck_html(payload)
    assert html.count("Scenario Cost Comparison") >= 2
    assert "Options 1-5 of 10" in html
    assert "Options 6-10 of 10" in html
    assert html.count("Lease Abstract Highlights") >= 3


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


def test_report_dates_are_rendered_dd_mm_yyyy():
    payload = {
        "scenarios": [_entry("Date Format Scenario", 4500, 36.0)],
        "branding": {"reportDate": "02/19/2026"},
    }
    html = build_report_deck_html(payload)
    assert "19/02/2026" in html


def test_scenario_detail_rows_paginate_without_omitting_rows():
    scenario = Scenario(
        name="Pagination Stress",
        rsf=11000,
        commencement=date(2026, 1, 1),
        expiration=date(2033, 1, 1),
        rent_steps=[RentStep(start=i, end=min(83, i + 2), rate_psf_yr=40 + (i / 3)) for i in range(0, 84, 3)],
        free_rent_months=6,
        ti_allowance_psf=20.0,
        opex_mode=OpexMode.NNN,
        base_opex_psf_yr=10.0,
        base_year_opex_psf_yr=10.0,
        opex_growth=0.03,
        discount_rate_annual=0.07,
    )
    _, result = compute_cashflows(scenario)
    html = build_report_deck_html(
        {"scenarios": [{"scenario": scenario.model_dump(mode="json"), "result": result.model_dump()}]}
    )
    assert "Segmented rent schedule page" in html
    assert "additional segmented row(s) omitted" not in html
    assert "Average Costs" in html
