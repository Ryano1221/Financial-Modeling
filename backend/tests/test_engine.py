from datetime import date

from fastapi.testclient import TestClient

from backend.engine.compute import compute_cashflows
from backend.main import app
from backend.models import (
    OpexMode,
    OneTimeCost,
    RentStep,
    Scenario,
    TerminationOption,
)


def _basic_scenario(opex_mode: OpexMode) -> Scenario:
    # 5-year term from Jan 1, 2026 to Jan 1, 2031 (approx 60 months).
    commencement = date(2026, 1, 1)
    expiration = date(2031, 1, 1)

    return Scenario(
        name="Test Scenario",
        rsf=10000,
        commencement=commencement,
        expiration=expiration,
        rent_steps=[
            RentStep(start=0, end=59, rate_psf_yr=30.0),
        ],
        free_rent_months=3,
        ti_allowance_psf=50.0,
        opex_mode=opex_mode,
        base_opex_psf_yr=10.0,
        base_year_opex_psf_yr=10.0,
        opex_growth=0.03,
        discount_rate_annual=0.06,
    )


def test_compute_cashflows_nnn_basic():
    scenario = _basic_scenario(OpexMode.NNN)
    cashflows, result = compute_cashflows(scenario)

    assert result.term_months > 0
    # cashflows length = term_months + holdover_months (holdover is 0 here)
    assert len(cashflows) == result.term_months

    # Free rent months should remove rent but not opex.
    monthly_rent = scenario.rsf * scenario.rent_steps[0].rate_psf_yr / 12.0
    monthly_opex_year0 = scenario.rsf * scenario.base_opex_psf_yr / 12.0

    # Month 0: no rent, but opex still charged, and TI reduction.
    expected_month0 = monthly_opex_year0 - scenario.ti_allowance_psf * scenario.rsf
    assert abs(cashflows[0] - expected_month0) < 1e-6

    # After free rent period, both rent and opex should apply.
    m = scenario.free_rent_months
    assert cashflows[m] > cashflows[0]
    assert abs(cashflows[m] - (monthly_rent + monthly_opex_year0)) < 1e-6

    # Nominal aggregates should be consistent with schedules.
    assert result.rent_nominal > 0
    assert result.opex_nominal > 0
    assert result.total_cost_nominal == result.rent_nominal + result.opex_nominal - (
        scenario.ti_allowance_psf * scenario.rsf
    )


def test_compute_cashflows_base_year_has_lower_opex_initially():
    scenario = _basic_scenario(OpexMode.BASE_YEAR)
    cashflows, result = compute_cashflows(scenario)

    # In base year mode with base_year_opex == base_opex, year 0 opex charge is 0.
    # Thus, initial months should be strongly negative due only to TI.
    assert cashflows[0] < 0

    # At least some later months should be positive as opex grows over base year.
    assert any(cf > 0 for cf in cashflows[12:24])

    assert result.total_cost_nominal < result.rent_nominal + result.opex_nominal


def test_fastapi_compute_endpoint():
    client = TestClient(app)
    scenario = _basic_scenario(OpexMode.NNN)

    payload = scenario.model_dump(mode="json")
    response = client.post("/compute", json=payload)
    assert response.status_code == 200

    data = response.json()
    # Basic shape checks
    assert "term_months" in data
    assert "rent_nominal" in data
    assert "npv_cost" in data
    assert "parking_nominal" in data
    assert "npv_total" in data
    assert data["term_months"] == scenario.term_months
    assert data["rent_nominal"] > 0


def test_compute_existing_payload_defaults():
    """Existing /compute payload without new fields still works (defaults)."""
    client = TestClient(app)
    payload = {
        "name": "Minimal",
        "rsf": 5000,
        "commencement": "2026-01-01",
        "expiration": "2031-01-01",
        "rent_steps": [{"start": 0, "end": 59, "rate_psf_yr": 25}],
        "free_rent_months": 0,
        "ti_allowance_psf": 0,
        "opex_mode": "nnn",
        "base_opex_psf_yr": 8,
        "base_year_opex_psf_yr": 8,
        "opex_growth": 0,
        "discount_rate_annual": 0.05,
    }
    response = client.post("/compute", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["term_months"] == 60
    assert data["parking_nominal"] == 0
    assert data["broker_fee_nominal"] == 0
    assert data["deposit_nominal"] == 0
    assert data["sublease_income_nominal"] == 0
    assert data["npv_rent"] > 0
    assert data["npv_total"] == data["npv_cost"]


def test_compute_scenario_with_parking_broker_deposit_one_time():
    """Scenario with parking, broker fee, security deposit, one-time cost."""
    scenario = Scenario(
        name="Parking and fees",
        rsf=10000,
        commencement=date(2026, 1, 1),
        expiration=date(2028, 1, 1),  # 24 months
        rent_steps=[RentStep(start=0, end=23, rate_psf_yr=30.0)],
        free_rent_months=0,
        ti_allowance_psf=0,
        opex_mode=OpexMode.NNN,
        base_opex_psf_yr=10.0,
        base_year_opex_psf_yr=10.0,
        opex_growth=0,
        discount_rate_annual=0.06,
        parking_spaces=50,
        parking_cost_monthly_per_space=200.0,
        one_time_costs=[
            OneTimeCost(name="Legal", amount=15000.0, month=0),
            OneTimeCost(name="Move", amount=5000.0, month=1),
        ],
        broker_fee=25000.0,
        security_deposit_months=2.0,
    )
    cashflows, result = compute_cashflows(scenario)

    assert result.term_months == 24
    assert len(cashflows) == 24

    monthly_parking = 50 * 200.0
    assert result.parking_nominal == monthly_parking * 24
    assert result.broker_fee_nominal == 25000.0
    base_monthly_rent = 10000 * 30.0 / 12.0
    assert result.deposit_nominal == base_monthly_rent * 2.0
    assert result.one_time_nominal == 15000.0 + 5000.0

    # Month 0: rent + opex + parking + 15k + broker + deposit
    assert cashflows[0] > 0
    # Month 1: rent + opex + parking + 5k
    assert cashflows[1] > 0


def test_compute_scenario_with_sublease_holdover_termination():
    """Scenario with sublease income, holdover months, and termination option."""
    scenario = Scenario(
        name="Sublease and holdover",
        rsf=5000,
        commencement=date(2026, 1, 1),
        expiration=date(2027, 1, 1),  # 12 months
        rent_steps=[RentStep(start=0, end=11, rate_psf_yr=40.0)],
        free_rent_months=0,
        ti_allowance_psf=20.0,
        opex_mode=OpexMode.NNN,
        base_opex_psf_yr=12.0,
        base_year_opex_psf_yr=12.0,
        opex_growth=0,
        discount_rate_annual=0.05,
        holdover_months=3,
        holdover_rent_multiplier=1.5,
        sublease_income_monthly=10000.0,
        sublease_start_month=6,
        sublease_duration_months=4,
        termination_option=TerminationOption(month=12, fee=50000.0, probability=0.2),
    )
    cashflows, result = compute_cashflows(scenario)

    total_months = 12 + 3
    assert result.term_months == 12
    assert len(cashflows) == total_months

    # Sublease income: 10k * 4 months
    assert result.sublease_income_nominal == 10000.0 * 4

    # Holdover: months 12, 13, 14 have 1.5x last rent + opex; month 12 also has termination expected cost
    last_step_rate = 40.0
    holdover_rent_monthly = 5000 * (last_step_rate * 1.5) / 12.0
    opex_month_12 = 5000 * 12.0 / 12.0
    termination_expected = 50000.0 * 0.2  # 10k
    assert cashflows[12] > 0
    assert abs(cashflows[12] - (holdover_rent_monthly + opex_month_12 + termination_expected)) < 1.0

    # Termination expected cost at month 12: 50k * 0.2 = 10k (included in cashflow, not in one_time_nominal)
    assert result.one_time_nominal == 0

    # TI at month 0
    assert result.total_cost_nominal < (
        result.rent_nominal + result.opex_nominal + result.parking_nominal
    )


def test_debug_cashflows_endpoint():
    """POST /debug_cashflows returns monthly cashflows array."""
    client = TestClient(app)
    scenario = _basic_scenario(OpexMode.NNN)
    payload = scenario.model_dump(mode="json")
    response = client.post("/debug_cashflows", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "cashflows" in data
    assert isinstance(data["cashflows"], list)
    assert len(data["cashflows"]) == scenario.term_months


def test_generate_scenarios_endpoint():
    """POST /generate_scenarios returns renewal and relocation scenarios."""
    client = TestClient(app)
    payload = {
        "rsf": 10000,
        "target_term_months": 60,
        "discount_rate_annual": 0.06,
        "renewal": {
            "rent_steps": [{"start": 0, "end": 59, "rate_psf_yr": 30}],
            "free_rent_months": 3,
            "ti_allowance_psf": 50,
            "opex_mode": "nnn",
            "base_opex_psf_yr": 10,
            "base_year_opex_psf_yr": 10,
            "opex_growth": 0.03,
        },
        "relocation": {
            "rent_steps": [{"start": 0, "end": 59, "rate_psf_yr": 32}],
            "free_rent_months": 0,
            "ti_allowance_psf": 40,
            "downtime_months": 2,
            "overlap_months": 1,
            "broker_fee": 25000,
            "moving_costs_total": 100000,
        },
    }
    response = client.post("/generate_scenarios", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "renewal" in data
    assert "relocation" in data
    assert data["renewal"]["name"] == "Renewal"
    assert data["relocation"]["name"] == "Relocation"
    assert len(data["renewal"]["rent_steps"]) == 1
    assert data["renewal"]["rent_steps"][0]["end"] == 59
    assert data["relocation"]["free_rent_months"] == 2  # 0 + downtime 2
    assert any(ot["name"] == "Overlap rent" for ot in data["relocation"]["one_time_costs"])

