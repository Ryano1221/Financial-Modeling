"""
Generate renewal and relocation Scenario objects from GenerateScenariosRequest.
"""
from __future__ import annotations

from datetime import date

from models import (
    GenerateScenariosRequest,
    GenerateScenariosResponse,
    OneTimeCost,
    OpexMode,
    RentStep,
    Scenario,
)


def _add_months(d: date, months: int) -> date:
    """Add months to a date (same day of month when possible)."""
    if months <= 0:
        return d
    y, m, day = d.year, d.month, d.day
    m += months
    while m > 12:
        m -= 12
        y += 1
    # Cap day to last day of month
    if m in (4, 6, 9, 11) and day > 30:
        day = 30
    elif m == 2 and day > 28:
        day = 28
    return date(y, m, day)


def _rent_steps_for_term(steps: list[RentStep], term_months: int) -> list[RentStep]:
    """Build contiguous rent steps covering [0, term_months-1] using first step rate for full term."""
    if not steps or term_months <= 0:
        return steps
    rate = steps[0].rate_psf_yr
    return [RentStep(start=0, end=term_months - 1, rate_psf_yr=rate)]


def generate_scenarios(req: GenerateScenariosRequest) -> GenerateScenariosResponse:
    """Build Renewal and Relocation scenarios from the request."""
    commencement = req.commencement or date(2026, 1, 1)
    expiration = _add_months(commencement, req.target_term_months)
    term = req.target_term_months

    # ---- Renewal ----
    renewal_steps = _rent_steps_for_term(req.renewal.rent_steps, term)
    renewal = Scenario(
        name="Renewal",
        rsf=req.rsf,
        commencement=commencement,
        expiration=expiration,
        rent_steps=renewal_steps,
        free_rent_months=req.renewal.free_rent_months,
        ti_allowance_psf=req.renewal.ti_allowance_psf,
        opex_mode=req.renewal.opex_mode,
        base_opex_psf_yr=req.renewal.base_opex_psf_yr,
        base_year_opex_psf_yr=req.renewal.base_year_opex_psf_yr,
        opex_growth=req.renewal.opex_growth,
        discount_rate_annual=req.discount_rate_annual,
        parking_spaces=req.renewal.parking_spaces,
        parking_cost_monthly_per_space=req.renewal.parking_cost_monthly_per_space,
        one_time_costs=[],  # minimal
    )

    # ---- Relocation ----
    rel = req.relocation
    rel_steps = _rent_steps_for_term(rel.rent_steps, term)
    # Downtime: months with no rent at new space → add to free rent
    free_rent_months = rel.free_rent_months + rel.downtime_months
    # Overlap: double rent for overlap_months → one-time cost at month 0 (extra rent at old space)
    monthly_rent_overlap = 0.0
    if rel_steps and rel.overlap_months > 0:
        first_step = rel_steps[0]
        monthly_rent_overlap = (first_step.rate_psf_yr / 12.0) * req.rsf * rel.overlap_months

    one_time: list[OneTimeCost] = []
    if rel.moving_costs_total > 0:
        one_time.append(OneTimeCost(name="Moving", amount=rel.moving_costs_total, month=0))
    if rel.it_cabling_cost > 0:
        one_time.append(OneTimeCost(name="IT/Cabling", amount=rel.it_cabling_cost, month=0))
    if rel.signage_cost > 0:
        one_time.append(OneTimeCost(name="Signage", amount=rel.signage_cost, month=0))
    if rel.ffe_cost > 0:
        one_time.append(OneTimeCost(name="FF&E", amount=rel.ffe_cost, month=0))
    if rel.legal_cost > 0:
        one_time.append(OneTimeCost(name="Legal", amount=rel.legal_cost, month=0))
    if monthly_rent_overlap > 0:
        one_time.append(OneTimeCost(name="Overlap rent", amount=monthly_rent_overlap, month=0))

    relocation = Scenario(
        name="Relocation",
        rsf=req.rsf,
        commencement=commencement,
        expiration=expiration,
        rent_steps=rel_steps,
        free_rent_months=free_rent_months,
        ti_allowance_psf=rel.ti_allowance_psf,
        opex_mode=rel.opex_mode,
        base_opex_psf_yr=rel.base_opex_psf_yr,
        base_year_opex_psf_yr=rel.base_year_opex_psf_yr,
        opex_growth=rel.opex_growth,
        discount_rate_annual=req.discount_rate_annual,
        parking_spaces=rel.parking_spaces,
        parking_cost_monthly_per_space=rel.parking_cost_monthly_per_space,
        one_time_costs=one_time,
        broker_fee=rel.broker_fee,
    )

    return GenerateScenariosResponse(renewal=renewal, relocation=relocation)
