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


def test_supplemental_quality_checks_blocks_ambiguous_rent_rate_candidates() -> None:
    canonical = main._dict_to_canonical(
        {
            "building_name": "Sample Tower",
            "suite": "300",
            "rsf": 6052,
            "commencement_date": "2026-04-01",
            "expiration_date": "2031-08-31",
            "term_months": 65,
            "rent_schedule": [
                {"start_month": 0, "end_month": 64, "rent_psf_annual": 47.5},
            ],
        }
    )
    quality = main._supplemental_quality_checks(
        canonical=canonical,
        text="Base Rent and abatement language.",
        extracted_hints={
            "_rate_psf_yr_conflict": "low_high_ambiguity",
            "_rate_psf_yr_candidates": [4.5, 47.5],
        },
    )
    tasks = [t for t in quality["review_tasks"] if isinstance(t, dict)]
    assert any(t.get("issue_code") == "RENT_RATE_AMBIGUOUS" for t in tasks)
    assert any(str(t.get("severity") or "").lower() == "blocker" for t in tasks)


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


def test_normalize_impl_keeps_source_year_opex_when_commencement_year_missing_from_table(monkeypatch) -> None:
    monkeypatch.setattr(main, "extract_text_from_word", lambda _buf, _name: ("proposal text", "docx"))
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "counter_proposal")
    monkeypatch.setattr(
        main,
        "_extract_lease_hints",
        lambda _text, _filename, _rid: {
            "building_name": "Lamar Central",
            "suite": "230",
            "rsf": 3947.0,
            "commencement_date": date(2027, 5, 1),
            "expiration_date": date(2032, 4, 30),
            "term_months": 60,
            "opex_psf_year_1": 26.02,
            "opex_source_year": 2026,
            "opex_growth_rate": 0.03,
            "opex_by_calendar_year": {2026: 26.02},
        },
    )
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="Lamar Central Suite 230",
                rsf=3947.0,
                commencement=date(2027, 5, 1),
                expiration=date(2032, 4, 30),
                rent_steps=[RentStep(start=0, end=59, rate_psf_yr=42.0)],
                free_rent_months=0,
                ti_allowance_psf=0.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=26.02,
                base_year_opex_psf_yr=26.02,
                opex_growth=0.03,
                discount_rate_annual=0.08,
            ),
            confidence={"base_opex_psf_yr": 0.9},
            warnings=[],
            source="docx",
            text_length=120,
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

    upload = UploadFile(filename="lamar-counter.docx", file=BytesIO(b"docx-bytes"))
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)
    canonical = result.canonical_lease

    assert canonical.opex_psf_year_1 == 26.02
    assert canonical.expense_stop_psf == 26.02
    assert "OpEx quoted at $26.02/SF in 2026; escalated 3.00% for 1 year" in (canonical.notes or "")
    assert "$26.80/SF used for 2027." in (canonical.notes or "")


def test_normalize_impl_prefers_ratio_derived_parking_count_over_small_inline_count(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "extract_text_from_word",
        lambda _buf, _name: (
            "Premises: Suite 400 consisting of 4,949 RSF. Parking ratio per 1,000 RSF: 4.0. "
            "Parking: on a must-take basis, four (4) parking spaces at $100 per month.",
            "docx",
        ),
    )
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "sublease")
    monkeypatch.setattr(
        main,
        "_extract_lease_hints",
        lambda _text, _filename, _rid: {
            "building_name": "1300 Guadalupe",
            "suite": "400",
            "rsf": 4949.0,
            "commencement_date": date(2026, 12, 1),
            "expiration_date": date(2037, 6, 30),
            "term_months": 127,
            "parking_ratio": 4.0,
            "parking_count": 4,
            "parking_rate_monthly": 100.0,
        },
    )
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="1300 Guadalupe Suite 400",
                rsf=4949.0,
                commencement=date(2026, 12, 1),
                expiration=date(2037, 6, 30),
                rent_steps=[RentStep(start=0, end=126, rate_psf_yr=33.0)],
                free_rent_months=7,
                ti_allowance_psf=10.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=13.81,
                base_year_opex_psf_yr=13.81,
                opex_growth=0.03,
                discount_rate_annual=0.08,
                parking_spaces=4,
                parking_cost_monthly_per_space=100.0,
            ),
            confidence={"parking_count": 0.6, "parking_ratio": 0.8},
            warnings=[],
            source="docx",
            text_length=240,
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

    upload = UploadFile(filename="tffa-proposal.docx", file=BytesIO(b"docx-bytes"))
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)
    canonical = result.canonical_lease

    assert canonical.parking_ratio == 4.0
    assert canonical.parking_count == 20
    assert canonical.parking_rate_monthly == 100.0


def test_normalize_impl_derives_parking_count_when_only_ratio_present(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "extract_text_from_word",
        lambda _buf, _name: (
            "Premises: Suite 250 consisting of 5,000 RSF. "
            "Parking ratio per 1,000 RSF: 3.2. "
            "Parking is charged at $95 per space per month.",
            "docx",
        ),
    )
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "sublease")
    monkeypatch.setattr(
        main,
        "_extract_lease_hints",
        lambda _text, _filename, _rid: {
            "building_name": "Northpoint",
            "suite": "250",
            "rsf": 5000.0,
            "commencement_date": date(2027, 1, 1),
            "expiration_date": date(2031, 12, 31),
            "term_months": 60,
            "parking_ratio": 3.2,
            "parking_count": None,
            "parking_rate_monthly": 95.0,
        },
    )
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="Northpoint Suite 250",
                rsf=5000.0,
                commencement=date(2027, 1, 1),
                expiration=date(2031, 12, 31),
                rent_steps=[RentStep(start=0, end=59, rate_psf_yr=40.0)],
                free_rent_months=0,
                ti_allowance_psf=0.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=14.0,
                base_year_opex_psf_yr=14.0,
                opex_growth=0.03,
                discount_rate_annual=0.08,
                parking_spaces=0,
                parking_cost_monthly_per_space=95.0,
            ),
            confidence={"parking_ratio": 0.85},
            warnings=[],
            source="docx",
            text_length=180,
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

    upload = UploadFile(filename="proposal.docx", file=BytesIO(b"docx-bytes"))
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)
    canonical = result.canonical_lease

    assert canonical.parking_ratio == 3.2
    assert canonical.parking_count == 16
    assert canonical.parking_rate_monthly == 95.0


def test_normalize_impl_keeps_inline_parking_count_when_ratio_missing(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "extract_text_from_word",
        lambda _buf, _name: (
            "Premises: Suite 400 consisting of 4,949 RSF. "
            "Parking: on a must-take, must-pay basis, four (4) parking spaces at the current rate of $100 per month. "
            "Brokerage: Landlord will pay a market 4.0% commission per separate agreement.",
            "docx",
        ),
    )
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "sublease")
    monkeypatch.setattr(
        main,
        "_extract_lease_hints",
        lambda _text, _filename, _rid: {
            "building_name": "1300 Guadalupe",
            "suite": "400",
            "rsf": 4949.0,
            "commencement_date": date(2026, 12, 1),
            "expiration_date": date(2037, 6, 30),
            "term_months": 127,
            "parking_ratio": None,
            "parking_count": 4,
            "parking_rate_monthly": 100.0,
        },
    )
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="1300 Guadalupe Suite 400",
                rsf=4949.0,
                commencement=date(2026, 12, 1),
                expiration=date(2037, 6, 30),
                rent_steps=[RentStep(start=0, end=126, rate_psf_yr=33.0)],
                free_rent_months=7,
                ti_allowance_psf=10.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=13.81,
                base_year_opex_psf_yr=13.81,
                opex_growth=0.03,
                discount_rate_annual=0.08,
                parking_spaces=4,
                parking_cost_monthly_per_space=100.0,
            ),
            confidence={"parking_count": 0.85},
            warnings=[],
            source="docx",
            text_length=280,
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

    upload = UploadFile(filename="tffa-proposal.docx", file=BytesIO(b"docx-bytes"))
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)
    canonical = result.canonical_lease

    assert round(float(canonical.parking_ratio), 4) == round((4 * 1000.0) / 4949.0, 4)
    assert canonical.parking_count == 4
    assert canonical.parking_rate_monthly == 100.0


def test_normalize_impl_overrides_bad_ai_values_with_document_hints_for_ksd_counter(monkeypatch) -> None:
    ksd_text = (
        "PREMISES: Renewal Suite 100: Approximately 64,800 SF Expansion Suite 200: Approximately 43,200 SF "
        "Second Expansion Suite 300: Approximately 21,600 SF Total Premises: 129,600 SF\n"
        "Expo 11 - Suite 100,200, and 300\n"
        "RENEWAL TERM:\n"
        "Ninety(90) months\n"
        "COMMENCEMENT:\n"
        "September 1, 2026\n"
        "RENEWAL BASE RENT:\n"
        "$13.50NNN with 3.50% annual increases\n"
        "OPERATING EXPENSES:\n"
        "Estimated to be $5.79/sf for 2025.\n"
        "TENANT IMPROVEMENT ALLOWANCE:\n"
        "Landlord shall provide the Tenant a Tenant Improvement allowance equal to $1300 PSF for improvements.\n"
        "Tenant may have the ability to amortize an additional $7.00 PSF at 9% interest over the term of the lease.\n"
        "LL January 21, 2026\n"
    )
    monkeypatch.setattr(main, "extract_text_from_word", lambda _buf, _name: (ksd_text, "docx"))
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "counter_proposal")
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="6231 E Stassney Ln Suite 100",
                rsf=43200.0,
                commencement=date(2026, 9, 1),
                expiration=date(2026, 1, 21),
                rent_steps=[RentStep(start=0, end=89, rate_psf_yr=5.79)],
                free_rent_months=6,
                ti_allowance_psf=0.02,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=5.79,
                base_year_opex_psf_yr=5.79,
                opex_growth=0.03,
                discount_rate_annual=0.08,
            ),
            confidence={"rsf": 0.35, "expiration": 0.35, "rate_psf_yr": 0.35},
            warnings=[],
            source="docx",
            text_length=len(ksd_text),
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

    upload = UploadFile(filename="KSD - LL Counter 1-21-26.docx", file=BytesIO(b"docx-bytes"))
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)
    canonical = result.canonical_lease

    assert canonical.suite == "100,200,300"
    assert canonical.rsf == 129600.0
    assert canonical.commencement_date == date(2026, 9, 1)
    assert canonical.expiration_date == date(2034, 2, 28)
    assert canonical.term_months == 90
    assert canonical.ti_allowance_psf == 13.0
    assert canonical.rent_schedule and canonical.rent_schedule[0].rent_psf_annual == 13.5


def test_normalize_impl_applies_mixed_and_distributed_option_abatements(monkeypatch) -> None:
    option_text = (
        "PREMISES: Medina 2nd Floor - Approximately 14,410 RSF\n"
        "COMMENCEMENT: May 1, 2027\n"
        "TERM: Option One: Sixty-five (65) Months with two (2) months base free rent at the beginning of term. "
        "An additional three (3) months of base rent abatement to be applied during the term, allocated as follows: "
        "Three (3) months in the beginning of lease year 3. "
        "Option Two: Eighty-seven (87) Months two (2) months of gross free rent and two (2) months of base free rent at the beginning of term. "
        "An additional three (3) months of base rent abatement to be applied during the term, allocated as follows: "
        "Two (2) months in the beginning of lease year 3. One (1) month in the beginning of lease year 4.\n"
        "BASE RENT: Option One: Months 01-12: $21.00 NNN with 3% annual increases. "
        "Option Two: Months 01-12: $21.00 NNN with 3% annual increases.\n"
        "OPERATING EXPENSES: Estimated to be $14.30 per RSF.\n"
    )
    monkeypatch.setattr(main, "extract_text_from_word", lambda _buf, _name: (option_text, "docx"))
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "counter_proposal")
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="Medina Bldg Floor 2",
                rsf=14410.0,
                commencement=date(2027, 5, 1),
                expiration=date(2034, 7, 31),
                rent_steps=[RentStep(start=0, end=86, rate_psf_yr=21.0)],
                free_rent_months=3,
                ti_allowance_psf=0.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=14.3,
                base_year_opex_psf_yr=14.3,
                opex_growth=0.03,
                discount_rate_annual=0.08,
            ),
            confidence={"free_rent_months": 0.6},
            warnings=[],
            source="docx",
            text_length=len(option_text),
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

    upload = UploadFile(
        filename="Austin Oaks - Tenant Counter Proposal - Oculus Pathology - 3.3.26.docx",
        file=BytesIO(b"docx-bytes"),
    )
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)

    canonical = result.canonical_lease
    assert canonical.term_months == 87
    assert canonical.free_rent_months == 7
    assert [(p.start_month, p.end_month, p.scope) for p in canonical.free_rent_periods] == [
        (0, 1, "gross"),
        (2, 3, "base"),
        (24, 25, "base"),
        (36, 36, "base"),
    ]

    assert len(result.option_variants) == 2
    option_b = next(v for v in result.option_variants if v.scenario_name.endswith("Option B"))
    assert option_b.free_rent_months == 7
    assert [(p.start_month, p.end_month, p.scope) for p in option_b.free_rent_periods] == [
        (0, 1, "gross"),
        (2, 3, "base"),
        (24, 25, "base"),
        (36, 36, "base"),
    ]
