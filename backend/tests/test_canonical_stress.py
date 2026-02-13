"""
Phase 7 — Stress tests: various lease structures must produce valid cash flow + summary.
All scenarios are built as CanonicalLease then converted to Scenario for engine (or run via canonical path).
"""
from __future__ import annotations

from datetime import date

import pytest

from models import (
    CanonicalLease,
    RentScheduleStep,
    CashflowResult,
    LeaseType,
    EscalationType,
    ExpenseStructureType,
)
from engine.compute import compute_cashflows
from engine.canonical_compute import canonical_to_scenario


def run_and_assert(c: CanonicalLease) -> tuple[list[float], CashflowResult]:
    """Convert to Scenario, run engine, assert valid output."""
    scenario = canonical_to_scenario(c)
    cashflows, result = compute_cashflows(scenario)
    assert result.term_months >= 0
    assert len(cashflows) == result.term_months or len(cashflows) == result.term_months + (scenario.holdover_months or 0)
    assert result.total_cost_nominal >= 0 or result.term_months == 0
    return cashflows, result


def test_nnn_lease_with_step_ups():
    """NNN lease with multiple rent step-ups."""
    c = CanonicalLease(
        scenario_id="1",
        scenario_name="NNN Step-ups",
        premises_name="Suite 100",
        rsf=10000,
        commencement_date=date(2026, 1, 1),
        expiration_date=date(2031, 1, 1),
        term_months=60,
        free_rent_months=0,
        discount_rate_annual=0.08,
        rent_schedule=[
            RentScheduleStep(start_month=0, end_month=23, rent_psf_annual=28),
            RentScheduleStep(start_month=24, end_month=35, rent_psf_annual=29),
            RentScheduleStep(start_month=36, end_month=59, rent_psf_annual=30),
        ],
        lease_type=LeaseType.NNN,
        expense_structure_type=ExpenseStructureType.NNN,
        opex_psf_year_1=10,
        opex_growth_rate=0.03,
        expense_stop_psf=0,
    )
    run_and_assert(c)


def test_gross_lease_with_expense_stop():
    """Gross lease with expense stop (base year)."""
    c = CanonicalLease(
        scenario_id="2",
        scenario_name="Gross with stop",
        premises_name="Floor 2",
        rsf=5000,
        commencement_date=date(2026, 6, 1),
        expiration_date=date(2031, 5, 31),
        term_months=60,
        free_rent_months=3,
        discount_rate_annual=0.08,
        rent_schedule=[RentScheduleStep(start_month=0, end_month=59, rent_psf_annual=35)],
        lease_type=LeaseType.GROSS,
        expense_structure_type=ExpenseStructureType.BASE_YEAR,
        opex_psf_year_1=12,
        opex_growth_rate=0.03,
        expense_stop_psf=11,
    )
    run_and_assert(c)


def test_lease_with_partial_year_free_rent():
    """Free rent for first 6 months only."""
    c = CanonicalLease(
        scenario_id="3",
        scenario_name="Partial free rent",
        premises_name="Tower A",
        rsf=15000,
        commencement_date=date(2027, 1, 1),
        expiration_date=date(2032, 12, 31),
        term_months=72,
        free_rent_months=6,
        discount_rate_annual=0.08,
        rent_schedule=[RentScheduleStep(start_month=0, end_month=71, rent_psf_annual=32)],
        lease_type=LeaseType.NNN,
        expense_structure_type=ExpenseStructureType.NNN,
        opex_psf_year_1=9,
        opex_growth_rate=0.025,
        expense_stop_psf=0,
    )
    cashflows, result = run_and_assert(c)
    assert result.term_months == 72
    # First 6 months rent should be 0 in engine (free rent)
    scenario = canonical_to_scenario(c)
    monthly_rent_after = 15000 * 32 / 12
    assert cashflows[6] > cashflows[0]


def test_lease_with_percent_escalations():
    """Rent schedule with step-ups (percent escalation represented as steps)."""
    c = CanonicalLease(
        scenario_id="4",
        scenario_name="3% steps",
        premises_name="Building B",
        rsf=8000,
        commencement_date=date(2026, 1, 1),
        expiration_date=date(2030, 12, 31),
        term_months=60,
        free_rent_months=0,
        discount_rate_annual=0.08,
        rent_schedule=[
            RentScheduleStep(start_month=0, end_month=11, rent_psf_annual=30, escalation_type=EscalationType.PERCENT, escalation_value=0.03),
            RentScheduleStep(start_month=12, end_month=23, rent_psf_annual=30.9, escalation_type=EscalationType.PERCENT, escalation_value=0.03),
            RentScheduleStep(start_month=24, end_month=35, rent_psf_annual=31.83, escalation_type=EscalationType.PERCENT, escalation_value=0.03),
            RentScheduleStep(start_month=36, end_month=47, rent_psf_annual=32.78, escalation_type=EscalationType.PERCENT, escalation_value=0.03),
            RentScheduleStep(start_month=48, end_month=59, rent_psf_annual=33.77, escalation_type=EscalationType.FIXED, escalation_value=0),
        ],
        lease_type=LeaseType.NNN,
        expense_structure_type=ExpenseStructureType.NNN,
        opex_psf_year_1=10,
        opex_growth_rate=0.03,
        expense_stop_psf=0,
    )
    run_and_assert(c)


def test_lease_with_parking_escalations():
    """Lease with parking (engine uses fixed monthly; escalation can be in canonical)."""
    c = CanonicalLease(
        scenario_id="5",
        scenario_name="Parking",
        premises_name="Garage level",
        rsf=20000,
        commencement_date=date(2026, 1, 1),
        expiration_date=date(2031, 1, 1),
        term_months=60,
        free_rent_months=0,
        discount_rate_annual=0.08,
        rent_schedule=[RentScheduleStep(start_month=0, end_month=59, rent_psf_annual=28)],
        lease_type=LeaseType.NNN,
        expense_structure_type=ExpenseStructureType.NNN,
        opex_psf_year_1=8,
        opex_growth_rate=0.02,
        expense_stop_psf=0,
        parking_count=80,
        parking_rate_monthly=175,
        parking_escalation_rate=0.03,
    )
    run_and_assert(c)


def test_lease_with_ti_allowance():
    """Lease with front-loaded TI allowance."""
    c = CanonicalLease(
        scenario_id="6",
        scenario_name="TI front-loaded",
        premises_name="Suite 500",
        rsf=12000,
        commencement_date=date(2026, 1, 1),
        expiration_date=date(2031, 1, 1),
        term_months=60,
        free_rent_months=3,
        discount_rate_annual=0.08,
        rent_schedule=[RentScheduleStep(start_month=0, end_month=59, rent_psf_annual=30)],
        lease_type=LeaseType.NNN,
        expense_structure_type=ExpenseStructureType.NNN,
        opex_psf_year_1=10,
        opex_growth_rate=0.03,
        expense_stop_psf=0,
        ti_allowance_psf=55,
        ti_total=55 * 12000,
        landlord_work_value=55 * 12000,
        tenant_capex_total=0,
    )
    cashflows, result = run_and_assert(c)
    # TI allowance reduces month 0
    assert result.total_cost_nominal < (result.rent_nominal + result.opex_nominal + result.parking_nominal)


def test_lease_minimal_term():
    """Minimal 12-month term."""
    c = CanonicalLease(
        scenario_id="7",
        scenario_name="Short",
        premises_name="Pop-up",
        rsf=2000,
        commencement_date=date(2026, 1, 1),
        expiration_date=date(2026, 12, 31),
        term_months=12,
        free_rent_months=0,
        discount_rate_annual=0.08,
        rent_schedule=[RentScheduleStep(start_month=0, end_month=11, rent_psf_annual=40)],
        lease_type=LeaseType.FULL_SERVICE,
        expense_structure_type=ExpenseStructureType.NNN,
        opex_psf_year_1=0,
        opex_growth_rate=0,
        expense_stop_psf=0,
    )
    run_and_assert(c)


def test_canonical_lease_validation_contiguous_rent():
    """CanonicalLease rejects non-contiguous rent_schedule."""
    with pytest.raises(ValueError, match="contiguous"):
        CanonicalLease(
            scenario_id="x",
            scenario_name="Bad",
            premises_name="X",
            rsf=1000,
            commencement_date=date(2026, 1, 1),
            expiration_date=date(2028, 12, 31),
            term_months=36,
            rent_schedule=[
                RentScheduleStep(start_month=0, end_month=11, rent_psf_annual=25),
                RentScheduleStep(start_month=13, end_month=35, rent_psf_annual=26),  # gap
            ],
        )
