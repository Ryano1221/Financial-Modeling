"""Regression tests for year-based rent schedule extraction/normalization."""

from scenario_extract import _apply_safe_defaults, _extract_term_months_from_text, _regex_prefill


def _base_raw_with_steps(rent_steps: list[dict]) -> dict:
    return {
        "scenario": {
            "name": "Test scenario",
            "rsf": 1000,
            "commencement": "2026-01-01",
            "expiration": "2031-01-31",
            "rent_steps": rent_steps,
            "opex_mode": "nnn",
        },
        "confidence": {},
        "warnings": [],
    }


def test_apply_safe_defaults_converts_zero_based_year_indices_to_month_ranges() -> None:
    raw = _base_raw_with_steps(
        [
            {"start": 0, "end": 0, "rate_psf_yr": 45},
            {"start": 1, "end": 1, "rate_psf_yr": 46},
            {"start": 2, "end": 4, "rate_psf_yr": 47},
        ]
    )
    scenario, _, warnings = _apply_safe_defaults(raw)
    assert scenario["rent_steps"] == [
        {"start": 0, "end": 11, "rate_psf_yr": 45.0},
        {"start": 12, "end": 23, "rate_psf_yr": 46.0},
        {"start": 24, "end": 59, "rate_psf_yr": 47.0},
    ]
    assert any("Year 1 = months 1-12" in w for w in warnings)


def test_apply_safe_defaults_converts_one_based_year_indices_to_month_ranges() -> None:
    raw = {
        "scenario": {
            "name": "Test scenario",
            "rsf": 1000,
            "commencement": "2026-01-01",
            "expiration": "2028-01-31",
            "rent_steps": [
                {"start": 1, "end": 1, "rate_psf_yr": 38},
                {"start": 2, "end": 2, "rate_psf_yr": 39.14},
            ],
            "opex_mode": "nnn",
        },
        "confidence": {},
        "warnings": [],
    }
    scenario, _, _ = _apply_safe_defaults(raw)
    assert scenario["rent_steps"] == [
        {"start": 0, "end": 11, "rate_psf_yr": 38.0},
        {"start": 12, "end": 23, "rate_psf_yr": 39.14},
    ]


def test_apply_safe_defaults_keeps_month_index_schedule_unchanged() -> None:
    raw = {
        "scenario": {
            "name": "Test scenario",
            "rsf": 1000,
            "commencement": "2026-01-01",
            "expiration": "2028-01-31",
            "rent_steps": [
                {"start": 0, "end": 11, "rate_psf_yr": 38},
                {"start": 12, "end": 23, "rate_psf_yr": 39.14},
            ],
            "opex_mode": "nnn",
        },
        "confidence": {},
        "warnings": [],
    }
    scenario, _, warnings = _apply_safe_defaults(raw)
    assert scenario["rent_steps"] == [
        {"start": 0, "end": 11, "rate_psf_yr": 38.0},
        {"start": 12, "end": 23, "rate_psf_yr": 39.14},
    ]
    assert not any("Year 1 = months 1-12" in w for w in warnings)


def test_apply_safe_defaults_rebases_absolute_lease_year_labels() -> None:
    raw = {
        "scenario": {
            "name": "Test scenario",
            "rsf": 1000,
            "commencement": "2026-01-01",
            "expiration": "2028-01-31",
            "rent_steps": [
                {"start": 12, "end": 12, "rate_psf_yr": 38},
                {"start": 13, "end": 13, "rate_psf_yr": 39.14},
            ],
            "opex_mode": "nnn",
        },
        "confidence": {},
        "warnings": [],
    }
    scenario, _, warnings = _apply_safe_defaults(raw)
    assert scenario["rent_steps"] == [
        {"start": 0, "end": 11, "rate_psf_yr": 38.0},
        {"start": 12, "end": 23, "rate_psf_yr": 39.14},
    ]
    assert any("Year 1 = months 1-12" in w for w in warnings)


def test_regex_prefill_extracts_year_table_rows_as_month_steps() -> None:
    text = """
    Base Rent Schedule ($/SF/YR)
    Year   Rate
    1      38.00
    2      39.14
    3      40.31
    4      41.52
    5      42.77
    """
    prefill = _regex_prefill(text)
    steps = prefill.get("rent_steps")
    assert isinstance(steps, list)
    assert steps[0]["start"] == 0
    assert steps[0]["end"] == 11
    assert steps[-1]["start"] == 48
    assert steps[-1]["end"] == 59


def test_regex_prefill_extracts_multiline_year_and_rate_table() -> None:
    text = """
    3. BASE RENT
    Lease Year
    Annual Rate (PSF)
    Monthly Base Rent
    Year 1
    $38.00
    $39,583.33
    Year 2
    $39.14
    $40,729.17
    Year 3
    $40.31
    $41,979.17
    Year 4
    $41.52
    $43,333.33
    Year 5
    $42.77
    $44,791.67
    """
    prefill = _regex_prefill(text)
    steps = prefill.get("rent_steps")
    assert isinstance(steps, list)
    assert steps == [
        {"start": 0, "end": 11, "rate_psf_yr": 38.0},
        {"start": 12, "end": 23, "rate_psf_yr": 39.14},
        {"start": 24, "end": 35, "rate_psf_yr": 40.31},
        {"start": 36, "end": 47, "rate_psf_yr": 41.52},
        {"start": 48, "end": 59, "rate_psf_yr": 42.77},
    ]


def test_apply_safe_defaults_replaces_fragmented_llm_schedule_with_prefill_table() -> None:
    raw = {
        "scenario": {
            "name": "Test scenario",
            "rsf": 1000,
            "commencement": "2026-01-01",
            "expiration": "2031-01-31",
            "rent_steps": [
                {"start": 0, "end": 2, "rate_psf_yr": 38},
                {"start": 3, "end": 3, "rate_psf_yr": 39.14},
                {"start": 4, "end": 4, "rate_psf_yr": 40.31},
                {"start": 5, "end": 5, "rate_psf_yr": 41.52},
                {"start": 6, "end": 59, "rate_psf_yr": 42.77},
            ],
            "opex_mode": "nnn",
        },
        "confidence": {},
        "warnings": [],
    }
    prefill = {
        "rent_steps": [
            {"start": 0, "end": 11, "rate_psf_yr": 38.0},
            {"start": 12, "end": 23, "rate_psf_yr": 39.14},
            {"start": 24, "end": 35, "rate_psf_yr": 40.31},
            {"start": 36, "end": 47, "rate_psf_yr": 41.52},
            {"start": 48, "end": 59, "rate_psf_yr": 42.77},
        ],
        "_rent_steps_basis": "month_index",
    }
    scenario, _, warnings = _apply_safe_defaults(raw, prefill=prefill)
    assert scenario["rent_steps"] == prefill["rent_steps"]
    assert any("replaced with rent schedule table extraction" in w for w in warnings)


def test_regex_prefill_inferrs_rate_psf_from_prepaid_monthly_rent() -> None:
    text = """
    Premises consists of approximately 22,022 rentable square feet.
    One month of Prepaid Rent ($51,384.67) shall be due at execution.
    """
    prefill = _regex_prefill(text)
    assert prefill.get("rsf") == 22022.0
    assert round(float(prefill.get("rate_psf_yr", 0.0)), 2) == 28.00


def test_regex_prefill_parses_proposal_year_rows_with_monthly_and_parenthetical_psf() -> None:
    text = """
    Area: 4,308 Rentable SF
    Proposed Term: One Hundred Twenty (120) Months
    Basic Rental:    Year 1  $8,975.00 per mo.  ($25.00 per s.f.)
                     Year 2  $9,334.00 per mo.  ($26.00 per s.f.)
                     Year 3-4 $9,693.00 per mo. ($27.00 per s.f.)
                     Year 5-6 $10,052.00 per mo. ($28.00 per s.f.)
                     Year 7-8 $10,411.00 per mo.  ($29.00 per s.f.)
                     Year 9-10 $10,770.00 per mo. ($30.00 per s.f.)
    Estimated OPE:   $6,174.80 per mo.  ($17.20 per s.f.)
    Parking: Up to Sixteen (16) unreserved parking spaces at a rate of $75.00 per space per month.
    """
    prefill = _regex_prefill(text)
    assert prefill.get("rsf") == 4308.0
    assert prefill.get("base_opex_psf_yr") == 17.2
    assert prefill.get("parking_spaces") == 16
    assert prefill.get("parking_cost_monthly_per_space") == 75.0
    assert prefill.get("rent_steps") == [
        {"start": 0, "end": 11, "rate_psf_yr": 25.0},
        {"start": 12, "end": 23, "rate_psf_yr": 26.0},
        {"start": 24, "end": 47, "rate_psf_yr": 27.0},
        {"start": 48, "end": 71, "rate_psf_yr": 28.0},
        {"start": 72, "end": 95, "rate_psf_yr": 29.0},
        {"start": 96, "end": 119, "rate_psf_yr": 30.0},
    ]


def test_regex_prefill_prefers_non_truncated_base_rent_and_ignores_abatement_distribution_window() -> None:
    text = """
    Lease Term | Five (5) years | Landlord Response: Landlord proposes sixty-() months from the Lease Commencement Date.
    Base Rent | Please specify the proposed Base Rent per rentable square foot and any annual escalations that are to be incorporated through the life of the Lease.
    Tenant shall pay Rent based on the following: Month 1-24: 4,000 RSF Months 25-LEX: 6,052 RSF | Landlord Response: $4.50 per RSF; full service.
    The full-service Base Rent shall escalate at 3.00% annually on the anniversary of the Lease Commencement Date and each year thereafter.
    Landlord shall abate the initial () months from Base Rent.
    Additionally, Tenant shall have the right to spread the rent abatement out in equal monthly installments throughout the first twenty-four (24) months of the Term.

    Base Rent
    Please specify the proposed Base Rent per rentable square foot and any annual escalations that are to be incorporated through the life of the Lease.
    Landlord proposes sixty-five (65) months from the Lease Commencement Date.
    Month 1-24: 4,000 RSF
    Months 25-LEX: 6,052 RSF
    Landlord Response:
    $47.50 per RSF; full service.
    The full-service Base Rent shall escalate at 3.00% annually on the anniversary of the Lease Commencement Date and each year thereafter.
    Landlord shall abate the initial five (5) months from Base Rent.
    Additionally, Tenant shall have the right to spread the rent abatement out in equal monthly installments throughout the first twenty-four (24) months of the Term.
    """
    prefill = _regex_prefill(text)
    assert prefill.get("rate_psf_yr") == 47.5
    assert prefill.get("free_rent_months") == 5
    assert prefill.get("term_months") == 65
    assert prefill.get("_rate_psf_yr_conflict") == "low_high_ambiguity"


def test_extract_term_months_prefers_months_from_commencement_over_five_year_fallback() -> None:
    text = """
    Lease Term | Five (5) years.
    Landlord proposes sixty-five (65) months from the Lease Commencement Date.
    """
    assert _extract_term_months_from_text(text) == 65
