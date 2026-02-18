"""Regression tests for suite fallback to floor."""

from services.input_normalizer import _dict_to_canonical


def test_dict_to_canonical_uses_floor_when_suite_missing() -> None:
    canonical = _dict_to_canonical(
        {
            "building_name": "500 Congress Avenue",
            "suite": "",
            "floor": "7",
            "rsf": 12000,
            "commencement_date": "2026-01-01",
            "expiration_date": "2031-01-01",
            "term_months": 60,
            "rent_schedule": [{"start_month": 0, "end_month": 59, "rent_psf_annual": 40}],
        }
    )
    assert canonical.suite == "7"
    assert canonical.floor == "7"
    assert canonical.premises_name == "500 Congress Avenue Suite 7"
