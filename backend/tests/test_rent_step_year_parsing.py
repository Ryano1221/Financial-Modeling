"""Regression tests for year-based rent schedule extraction/normalization."""

from scenario_extract import _apply_safe_defaults, _regex_prefill


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
    assert any("Year 1 = months 0-11" in w for w in warnings)


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
    assert not any("Year 1 = months 0-11" in w for w in warnings)


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
    assert any("Year 1 = months 0-11" in w for w in warnings)


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
