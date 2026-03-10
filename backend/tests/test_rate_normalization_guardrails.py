from datetime import date

from engine.canonical_compute import normalize_canonical_lease
from models import OpexMode, RentStep, Scenario
from services.input_normalizer import _scenario_to_canonical


def test_scenario_to_canonical_normalizes_percent_point_rates() -> None:
    scenario = Scenario(
        name="Rate guardrail",
        rsf=5618,
        commencement=date(2026, 10, 1),
        expiration=date(2034, 4, 30),
        rent_steps=[RentStep(start=0, end=90, rate_psf_yr=52.0)],
        free_rent_months=7,
        ti_allowance_psf=0.0,
        opex_mode=OpexMode.NNN,
        base_opex_psf_yr=20.9,
        base_year_opex_psf_yr=20.9,
        opex_growth=6.0,  # 6% returned as percent-points by extractor
        discount_rate_annual=8.0,  # 8% returned as percent-points by extractor
        parking_spaces=11,
        parking_cost_monthly_per_space=225.0,
        parking_sales_tax_rate=8.25,  # 8.25% returned as percent-points
    )

    canonical = _scenario_to_canonical(scenario)

    assert canonical.opex_growth_rate == 0.06
    assert canonical.discount_rate_annual == 0.08
    assert canonical.parking_sales_tax_rate == 0.0825


def test_normalize_canonical_lease_converts_percent_point_rates() -> None:
    lease, warnings = normalize_canonical_lease(
        {
            "scenario_name": "Guardrail compute normalization",
            "premises_name": "ATX Tower Suite 1550",
            "rsf": 5618,
            "lease_type": "NNN",
            "commencement_date": "2026-10-01",
            "expiration_date": "2034-04-30",
            "term_months": 91,
            "discount_rate_annual": 8.0,
            "rent_schedule": [
                {"start_month": 0, "end_month": 90, "rent_psf_annual": 52.0},
            ],
            "opex_psf_year_1": 20.9,
            "opex_growth_rate": 6.0,
            "parking_count": 11,
            "parking_rate_monthly": 225.0,
            "parking_sales_tax_rate": 8.25,
            "parking_escalation_rate": 3.0,
        }
    )

    assert lease.discount_rate_annual == 0.08
    assert lease.opex_growth_rate == 0.06
    assert lease.parking_sales_tax_rate == 0.0825
    assert lease.parking_escalation_rate == 0.03
    assert any("opex_growth_rate interpreted as percent points" in warning for warning in warnings)
