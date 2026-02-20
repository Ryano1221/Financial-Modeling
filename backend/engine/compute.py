from __future__ import annotations

from dataclasses import dataclass
from math import pow
from typing import List, Tuple

from models import CashflowResult, OpexMode, Scenario


@dataclass
class CashflowDetails:
    """Per-month breakdown for canonical export."""
    rent: List[float]
    opex: List[float]
    parking: List[float]
    one_time: List[float]
    sublease: List[float]
    ti_at_0: float
    cashflows: List[float]
    total_months: int


def _monthly_discount_rate(annual_rate: float) -> float:
    """
    Convert an annual effective discount rate to an effective monthly rate.
    """
    if annual_rate <= 0:
        return 0.0
    return pow(1.0 + annual_rate, 1.0 / 12.0) - 1.0


def _build_rent_schedule_monthly(scenario: Scenario, total_months: int) -> List[float]:
    """
    Build monthly base rent (tenant POV, positive = cost) over total_months.
    Free rent zeroes base rent only for the first free_rent_months.
    Holdover months use last rent step rate * holdover_rent_multiplier.
    """
    term_months = scenario.term_months
    rent = [0.0 for _ in range(total_months)]

    for step in scenario.rent_steps:
        monthly_rate = step.rate_psf_yr / 12.0 * scenario.rsf
        for m in range(step.start, min(step.end + 1, term_months)):
            rent[m] = monthly_rate

    for m in range(min(scenario.free_rent_months, term_months)):
        rent[m] = 0.0

    if scenario.holdover_months > 0 and scenario.rent_steps:
        last_step = max(scenario.rent_steps, key=lambda s: s.end)
        holdover_monthly = (
            last_step.rate_psf_yr / 12.0 * scenario.rsf * scenario.holdover_rent_multiplier
        )
        for m in range(term_months, total_months):
            rent[m] = holdover_monthly

    return rent


def _annual_opex_psf_for_year(scenario: Scenario, year_index: int) -> float:
    if scenario.opex_mode == OpexMode.NNN:
        base_level = scenario.base_opex_psf_yr
    else:
        base_level = scenario.base_year_opex_psf_yr
    if scenario.opex_growth <= 0:
        return base_level
    return base_level * pow(1.0 + scenario.opex_growth, year_index)


def _monthly_opex_schedule(scenario: Scenario, total_months: int) -> List[float]:
    """Monthly opex over total_months (including holdover)."""
    opex = [0.0 for _ in range(total_months)]
    for m in range(total_months):
        year_index = m // 12
        annual_opex_psf = _annual_opex_psf_for_year(scenario, year_index)
        if scenario.opex_mode == OpexMode.NNN:
            charge_psf_yr = annual_opex_psf
        elif scenario.opex_mode == OpexMode.BASE_YEAR:
            charge_psf_yr = max(0.0, annual_opex_psf - scenario.base_year_opex_psf_yr)
        else:
            raise ValueError(f"Unsupported opex mode: {scenario.opex_mode}")
        opex[m] = charge_psf_yr / 12.0 * scenario.rsf
    return opex


def _monthly_parking(scenario: Scenario, total_months: int) -> List[float]:
    """Monthly parking cost (positive = cost)."""
    tax_multiplier = 1.0 + max(0.0, float(getattr(scenario, "parking_sales_tax_rate", 0.0) or 0.0))
    monthly = scenario.parking_spaces * scenario.parking_cost_monthly_per_space * tax_multiplier
    return [monthly for _ in range(total_months)]


def _monthly_one_time(scenario: Scenario, total_months: int) -> List[float]:
    """One-time costs at their respective months."""
    arr = [0.0 for _ in range(total_months)]
    for ot in scenario.one_time_costs:
        if 0 <= ot.month < total_months:
            arr[ot.month] += ot.amount
    return arr


def _monthly_sublease_income(scenario: Scenario, total_months: int) -> List[float]:
    """Sublease income as negative cost (positive value = income reduces net cost)."""
    arr = [0.0 for _ in range(total_months)]
    if scenario.sublease_income_monthly <= 0 or scenario.sublease_duration_months <= 0:
        return arr
    start = scenario.sublease_start_month
    end = min(start + scenario.sublease_duration_months, total_months)
    for m in range(start, end):
        arr[m] = scenario.sublease_income_monthly  # we subtract this from cost
    return arr


def compute_cashflows_detailed(
    scenario: Scenario,
) -> Tuple[List[float], CashflowResult, CashflowDetails]:
    """
    Compute monthly cashflows and return per-month breakdown for canonical export.
    """
    term_months = scenario.term_months
    holdover = scenario.holdover_months or 0
    total_months = term_months + holdover

    if total_months == 0:
        return [], CashflowResult(
            term_months=0,
            rent_nominal=0.0,
            opex_nominal=0.0,
            total_cost_nominal=0.0,
            npv_cost=0.0,
            avg_cost_year=0.0,
            avg_cost_psf_year=0.0,
        ), CashflowDetails(
            rent=[], opex=[], parking=[], one_time=[], sublease=[],
            ti_at_0=0.0, cashflows=[], total_months=0,
        )

    rent_schedule = _build_rent_schedule_monthly(scenario, total_months)
    opex_schedule = _monthly_opex_schedule(scenario, total_months)
    parking_schedule = _monthly_parking(scenario, total_months)
    one_time_schedule = _monthly_one_time(scenario, total_months)
    sublease_schedule = _monthly_sublease_income(scenario, total_months)

    ti_cap = scenario.ti_allowance_psf * scenario.rsf
    ti_at_0 = ti_cap if term_months > 0 else 0.0

    # Base monthly rent for deposit (first rent step monthly rate)
    base_monthly_rent = 0.0
    if scenario.rent_steps:
        base_monthly_rent = scenario.rent_steps[0].rate_psf_yr / 12.0 * scenario.rsf
    deposit_amount = base_monthly_rent * scenario.security_deposit_months
    deposit_at_0 = deposit_amount if scenario.security_deposit_months > 0 and total_months > 0 else 0.0
    deposit_at_end = deposit_amount if scenario.security_deposit_months > 0 and total_months > 0 else 0.0

    termination_at_m: List[float] = [0.0] * total_months
    if scenario.termination_option and 0 <= scenario.termination_option.month < total_months:
        termination_at_m[scenario.termination_option.month] = (
            scenario.termination_option.fee * scenario.termination_option.probability
        )

    cashflows: List[float] = []
    rent_nominal = 0.0
    opex_nominal = 0.0
    parking_nominal = 0.0
    one_time_nominal = 0.0
    sublease_income_nominal = 0.0

    for m in range(total_months):
        rent = rent_schedule[m]
        opex = opex_schedule[m]
        parking = parking_schedule[m]
        one_time = one_time_schedule[m]
        sublease = sublease_schedule[m]
        term_fee = termination_at_m[m]

        rent_nominal += rent
        opex_nominal += opex
        parking_nominal += parking
        one_time_nominal += one_time
        sublease_income_nominal += sublease

        total = rent + opex + parking + one_time + term_fee
        total -= sublease
        if m == 0:
            total -= ti_at_0
            total += scenario.broker_fee
            total += deposit_at_0
        if m == total_months - 1 and deposit_at_end > 0:
            total -= deposit_at_end  # deposit returned
        cashflows.append(total)

    broker_fee_nominal = scenario.broker_fee
    deposit_nominal = deposit_at_0  # outflow only for reporting

    total_cost_nominal = (
        rent_nominal + opex_nominal + parking_nominal + one_time_nominal
        + broker_fee_nominal + deposit_nominal - sublease_income_nominal - ti_at_0
    )
    if deposit_at_end > 0:
        total_cost_nominal -= deposit_at_end  # deposit return

    monthly_rate = _monthly_discount_rate(scenario.discount_rate_annual)

    def npv(amounts: List[float]) -> float:
        if monthly_rate <= 0:
            return sum(amounts)
        return sum(cf / pow(1.0 + monthly_rate, t) for t, cf in enumerate(amounts))

    # Per-component NPV: need monthly series for each (rent, opex, parking, one_time)
    rent_npv_list = [rent_schedule[m] for m in range(total_months)]
    opex_npv_list = [opex_schedule[m] for m in range(total_months)]
    parking_npv_list = [parking_schedule[m] for m in range(total_months)]
    one_time_npv_list = [one_time_schedule[m] for m in range(total_months)]

    npv_rent = npv(rent_npv_list)
    npv_opex = npv(opex_npv_list)
    npv_parking = npv(parking_npv_list)
    npv_one_time = npv(one_time_npv_list)

    # NPV of full cashflow (includes TI, broker, deposit out/in, sublease, termination)
    npv_total = npv(cashflows)
    npv_cost = npv_total  # backward compat

    years = term_months / 12.0 if term_months > 0 else 0.0
    avg_cost_year = npv_total / years if years > 0 else 0.0
    avg_cost_psf_year = avg_cost_year / scenario.rsf if scenario.rsf > 0 else 0.0

    result = CashflowResult(
        term_months=term_months,
        rent_nominal=rent_nominal,
        opex_nominal=opex_nominal,
        total_cost_nominal=total_cost_nominal,
        npv_cost=npv_cost,
        avg_cost_year=avg_cost_year,
        avg_cost_psf_year=avg_cost_psf_year,
        parking_nominal=parking_nominal,
        one_time_nominal=one_time_nominal,
        broker_fee_nominal=broker_fee_nominal,
        deposit_nominal=deposit_nominal,
        sublease_income_nominal=sublease_income_nominal,
        npv_rent=npv_rent,
        npv_opex=npv_opex,
        npv_parking=npv_parking,
        npv_one_time=npv_one_time,
        npv_total=npv_total,
    )

    details = CashflowDetails(
        rent=rent_schedule,
        opex=opex_schedule,
        parking=parking_schedule,
        one_time=one_time_schedule,
        sublease=sublease_schedule,
        ti_at_0=ti_at_0,
        cashflows=cashflows,
        total_months=total_months,
    )
    return cashflows, result, details


def compute_cashflows(scenario: Scenario) -> Tuple[List[float], CashflowResult]:
    """
    Compute monthly total cashflows and aggregated metrics.
    Returns (cashflows, result). For full breakdown use compute_cashflows_detailed.
    """
    cashflows, result, _ = compute_cashflows_detailed(scenario)
    return cashflows, result
