from datetime import date

import main
from backend.engine.canonical_compute import compute_canonical


def _lease(**overrides):
    base = dict(
        scenario_name="Calendar Opex Test",
        rsf=10000,
        commencement_date=date(2026, 7, 1),
        expiration_date=date(2027, 12, 31),
        term_months=18,
        rent_schedule=[{"start_month": 0, "end_month": 17, "rent_psf_annual": 48}],
        opex_psf_year_1=10.0,
        opex_growth_rate=0.03,
        expense_structure_type="nnn",
        free_rent_months=0,
        free_rent_scope="base",
    )
    base.update(overrides)
    return base


def test_calendar_year_opex_uses_explicit_year_table_when_present() -> None:
    lease = _lease(opex_by_calendar_year={2026: 10.0, 2027: 12.0}, opex_growth_rate=0.0)
    out = compute_canonical(lease)
    assert round(out.monthly_rows[0].opex, 2) == round((10.0 / 12.0) * 10000.0, 2)  # Jul 2026
    assert round(out.monthly_rows[5].opex, 2) == round((10.0 / 12.0) * 10000.0, 2)  # Dec 2026
    assert round(out.monthly_rows[6].opex, 2) == round((12.0 / 12.0) * 10000.0, 2)  # Jan 2027


def test_calendar_year_opex_escalates_on_january_boundary() -> None:
    lease = _lease(opex_psf_year_1=10.0, opex_growth_rate=0.03, opex_by_calendar_year={})
    out = compute_canonical(lease)
    assert round(out.monthly_rows[5].opex, 2) == round((10.0 / 12.0) * 10000.0, 2)  # Dec 2026
    assert round(out.monthly_rows[6].opex, 2) == round((10.3 / 12.0) * 10000.0, 2)  # Jan 2027


def test_split_rent_schedule_adds_calendar_year_boundary_rows() -> None:
    rows = main._split_rent_schedule_by_boundaries(
        rent_schedule=[{"start_month": 0, "end_month": 17, "rent_psf_annual": 48.0}],
        term_months=18,
        phase_in_schedule=[],
        free_rent_periods=[],
        commencement_date=date(2026, 7, 1),
    )
    assert rows == [
        {"start_month": 0, "end_month": 5, "rent_psf_annual": 48.0},
        {"start_month": 6, "end_month": 17, "rent_psf_annual": 48.0},
    ]


def test_split_rent_schedule_adds_free_rent_boundary_rows() -> None:
    rows = main._split_rent_schedule_by_boundaries(
        rent_schedule=[{"start_month": 0, "end_month": 17, "rent_psf_annual": 48.0}],
        term_months=18,
        phase_in_schedule=[],
        free_rent_periods=[{"start_month": 2, "end_month": 3}],
        commencement_date=date(2026, 7, 1),
    )
    assert rows == [
        {"start_month": 0, "end_month": 1, "rent_psf_annual": 48.0},
        {"start_month": 2, "end_month": 3, "rent_psf_annual": 48.0},
        {"start_month": 4, "end_month": 5, "rent_psf_annual": 48.0},
        {"start_month": 6, "end_month": 17, "rent_psf_annual": 48.0},
    ]


def test_base_only_abatement_zeros_base_rent_not_opex() -> None:
    lease = _lease(
        free_rent_months=2,
        free_rent_scope="base",
        free_rent_periods=[{"start_month": 0, "end_month": 1}],
        opex_psf_year_1=12.0,
        opex_growth_rate=0.0,
    )
    out = compute_canonical(lease)
    assert out.monthly_rows[0].base_rent == 0
    assert out.monthly_rows[1].base_rent == 0
    assert out.monthly_rows[0].opex > 0
    assert out.monthly_rows[1].opex > 0


def test_gross_abatement_zeros_base_rent_and_opex() -> None:
    lease = _lease(
        free_rent_months=2,
        free_rent_scope="gross",
        free_rent_periods=[{"start_month": 2, "end_month": 3}],
        opex_psf_year_1=12.0,
        opex_growth_rate=0.0,
    )
    out = compute_canonical(lease)
    assert out.monthly_rows[2].base_rent == 0
    assert out.monthly_rows[3].base_rent == 0
    assert out.monthly_rows[2].opex == 0
    assert out.monthly_rows[3].opex == 0
