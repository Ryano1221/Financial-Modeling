"""Quality-check regressions for normalize-time safety checks."""

from __future__ import annotations

import main


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
