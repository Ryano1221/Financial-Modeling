"""Quality-check regressions for normalize-time safety checks."""

from __future__ import annotations

from datetime import date
from io import BytesIO

from fastapi import UploadFile

import main
from models import ExtractionResponse, OpexMode, RentStep, Scenario


def test_supplemental_quality_checks_flags_rent_schedule_coverage_gap() -> None:
    canonical = main._dict_to_canonical(
        {
            "building_name": "Sample Tower",
            "suite": "1100",
            "rsf": 10000,
            "commencement_date": "2028-04-01",
            "expiration_date": "2033-03-31",
            "term_months": 60,
            "rent_schedule": [
                {"start_month": 0, "end_month": 11, "rent_psf_annual": 40.0},
            ],
        }
    )
    quality = main._supplemental_quality_checks(canonical=canonical, text="Lease term and base rent schedule", extracted_hints={})
    tasks = [t for t in quality["review_tasks"] if isinstance(t, dict)]
    assert any(t.get("issue_code") == "RENT_SCHEDULE_COVERAGE" for t in tasks)
    assert any(str(t.get("severity") or "").lower() == "blocker" for t in tasks)


def test_supplemental_quality_checks_flags_opex_equal_to_ti_allowance() -> None:
    canonical = main._dict_to_canonical(
        {
            "building_name": "Sample Tower",
            "suite": "400",
            "rsf": 25000,
            "commencement_date": "2028-04-01",
            "expiration_date": "2035-03-31",
            "term_months": 84,
            "rent_schedule": [
                {"start_month": 0, "end_month": 83, "rent_psf_annual": 44.0},
            ],
            "opex_psf_year_1": 45.0,
            "ti_allowance_psf": 45.0,
        }
    )
    quality = main._supplemental_quality_checks(
        canonical=canonical,
        text="Operating Expenses are estimated. Tenant Improvement Allowance shall be provided.",
        extracted_hints={},
    )
    tasks = [t for t in quality["review_tasks"] if isinstance(t, dict)]
    assert any(t.get("issue_code") == "OPEX_EQUALS_TIA" for t in tasks)
    assert any("OpEx may be contaminated" in str(w) for w in quality["warnings"])


def test_derive_field_confidence_penalizes_noisy_building_name() -> None:
    canonical = main._dict_to_canonical(
        {
            "building_name": "the entry off Rialto. Additional information can be found at https://example.com",
            "floor": "3,4",
            "rsf": 114558,
            "commencement_date": "2028-04-01",
            "expiration_date": "2035-08-31",
            "term_months": 89,
            "rent_schedule": [
                {"start_month": 0, "end_month": 88, "rent_psf_annual": 36.0},
            ],
        }
    )
    confidence = main._derive_field_confidence(existing={}, canonical=canonical, extracted_hints={})
    assert confidence["building_name"] <= 0.35
    assert confidence["rsf"] >= 0.75


def test_derive_field_confidence_replaces_zero_placeholders_and_covers_free_rent() -> None:
    canonical = main._dict_to_canonical(
        {
            "building_name": "Benbrook",
            "suite": "200",
            "address": "123 Main St, Austin, TX",
            "rsf": 4626,
            "commencement_date": "2026-12-01",
            "expiration_date": "2034-03-31",
            "term_months": 88,
            "free_rent_months": 8,
            "ti_allowance_psf": 0.0,
            "parking_count": 19,
            "parking_sales_tax_rate": 0.0825,
            "rent_schedule": [
                {"start_month": 0, "end_month": 11, "rent_psf_annual": 26.0},
                {"start_month": 12, "end_month": 23, "rent_psf_annual": 26.78},
            ],
        }
    )
    confidence = main._derive_field_confidence(
        existing={"expiration_date": 0.0, "free_rent_months": 0.0, "ti_allowance_psf": 0.0},
        canonical=canonical,
        extracted_hints={},
    )
    assert confidence["expiration_date"] >= 0.75
    assert confidence["free_rent_months"] >= 0.84
    assert confidence["parking_count"] >= 0.82
    assert confidence["ti_allowance_psf"] >= 0.7


def test_normalize_impl_amendment_retains_inferred_rsf_and_opex_when_not_explicit(monkeypatch) -> None:
    amendment_text = (
        "FIRST AMENDMENT TO LEASE\n"
        "WHEREAS, Landlord and Tenant desire to amend the Lease to extend the term thereof.\n"
        "The Original Term of the Lease is hereby extended for the period commencing on September 1, 2019 "
        "and ending on November 30, 2026.\n"
    )

    monkeypatch.setattr(main, "extract_text_from_pdf", lambda _buf: amendment_text)
    monkeypatch.setattr(main, "text_quality_requires_ocr", lambda _text: False)
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="Extracted lease",
                rsf=10000.0,
                commencement=date(2019, 9, 1),
                expiration=date(2026, 11, 30),
                rent_steps=[RentStep(start=0, end=86, rate_psf_yr=18.5)],
                free_rent_months=0,
                ti_allowance_psf=0.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=10.0,
                base_year_opex_psf_yr=10.0,
                opex_growth=0.03,
                discount_rate_annual=0.08,
            ),
            confidence={"rsf": 0.25, "base_opex_psf_yr": 0.25},
            warnings=[],
            source="pdf_text",
            text_length=len(amendment_text),
        ),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **_kwargs: {
            "provenance": {},
            "review_tasks": [],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.9, "status": "green", "export_allowed": True},
            "canonical_extraction": {},
        },
    )

    upload = UploadFile(filename="first-amendment.pdf", file=BytesIO(b"pdf-bytes"))
    result, _used_ai = main._normalize_impl("rid", "PDF", None, None, upload)

    canonical = result.canonical_lease
    assert canonical.rsf > 0
    assert canonical.opex_psf_year_1 > 0
    assert any("retained inferred RSF value" in str(w) for w in result.warnings)
    assert any("retained inferred OpEx value" in str(w) for w in result.warnings)
