"""
Canonical lease normalization, mapping to legacy Scenario, and compute response building.
"""

from __future__ import annotations

import calendar
from datetime import date
from typing import Any, Dict, List, Tuple

from models import Scenario, OpexMode, RentStep
from models.canonical_lease import CanonicalLease, RentScheduleStep
from models.canonical_response import (
    AnnualRow,
    CanonicalComputeResponse,
    CanonicalMetrics,
    MonthlyRow,
)
from engine.compute import compute_cashflows_detailed, _monthly_discount_rate


def canonical_to_scenario(c: CanonicalLease) -> Scenario:
    """Convert CanonicalLease to legacy Scenario for compute_cashflows."""
    rent_steps = [
        RentStep(start=s.start_month, end=s.end_month, rate_psf_yr=s.rent_psf_annual)
        for s in c.rent_schedule
    ]
    if not rent_steps:
        rent_steps = [RentStep(start=0, end=max(0, c.term_months - 1), rate_psf_yr=0)]
    opex_mode = OpexMode.BASE_YEAR if c.expense_structure_type == "base_year" else OpexMode.NNN
    return Scenario(
        name=c.scenario_name or c.premises_name or "Option",
        rsf=c.rsf,
        commencement=c.commencement_date,
        expiration=c.expiration_date,
        rent_steps=rent_steps,
        free_rent_months=c.free_rent_months,
        ti_allowance_psf=c.ti_allowance_psf if c.rsf > 0 else 0,
        opex_mode=opex_mode,
        base_opex_psf_yr=c.opex_psf_year_1,
        base_year_opex_psf_yr=c.expense_stop_psf or c.opex_psf_year_1,
        opex_growth=c.opex_growth_rate,
        discount_rate_annual=c.discount_rate_annual,
        parking_spaces=c.parking_count,
        parking_cost_monthly_per_space=c.parking_rate_monthly,
    )


def _date_from_commencement_month(commencement: date, month_index: int) -> date:
    """First day of the month that is month_index months after commencement."""
    year = commencement.year
    month = commencement.month + month_index
    while month > 12:
        month -= 12
        year += 1
    while month < 1:
        month += 12
        year -= 1
    day = min(commencement.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _normalize_free_rent_months(v: Any) -> Tuple[int, List[str]]:
    """Return (int value, warnings)."""
    warnings: List[str] = []
    if isinstance(v, list):
        try:
            n = sum(int(x) for x in v)
            n = max(0, n)
            warnings.append("free_rent_months was a list; used sum of elements.")
            return n, warnings
        except (TypeError, ValueError):
            warnings.append("free_rent_months list invalid; used 0.")
            return 0, warnings
    if v is None:
        return 0, []
    try:
        return max(0, int(v)), []
    except (TypeError, ValueError):
        return 0, warnings


def normalize_canonical_lease(payload: Dict[str, Any] | CanonicalLease) -> Tuple[CanonicalLease, List[str]]:
    """
    Apply safe defaults and coercion so CanonicalLease never fails on extraction quirks.
    Returns (normalized CanonicalLease, warnings).
    """
    warnings: List[str] = []
    if isinstance(payload, CanonicalLease):
        data = payload.model_dump(mode="json")
    else:
        data = dict(payload)

    # Coerce free_rent_months
    if "free_rent_months" in data:
        val, w = _normalize_free_rent_months(data["free_rent_months"])
        data["free_rent_months"] = val
        warnings.extend(w)

    # Ensure rent_schedule contiguous; if empty, build one step from term_months
    rent_schedule = data.get("rent_schedule") or []
    term_months = data.get("term_months") or 0
    if not rent_schedule and term_months > 0:
        data["rent_schedule"] = [
            {"start_month": 0, "end_month": max(0, term_months - 1), "rent_psf_annual": 0.0}
        ]
        warnings.append("rent_schedule was empty; added single step at $0.")

    try:
        lease = CanonicalLease.model_validate(data)
        return lease, warnings
    except Exception as e:
        err_str = str(e).lower()
        if "rsf" in err_str or "gt" in err_str:
            data.setdefault("rsf", 1.0)
            warnings.append("rsf defaulted to 1.0 for validation.")
        try:
            lease = CanonicalLease.model_validate(data)
            return lease, warnings
        except Exception:
            raise ValueError(f"Invalid canonical lease after defaults: {e}") from e


def compute_canonical(lease: CanonicalLease) -> CanonicalComputeResponse:
    """
    Run canonical compute: normalize, map to Scenario, run engine, build response.
    """
    normalized, norm_warnings = normalize_canonical_lease(lease)
    scenario = canonical_to_scenario(normalized)
    cashflows, result, details = compute_cashflows_detailed(scenario)

    commencement = normalized.commencement_date
    term_months = result.term_months
    rsf = normalized.rsf
    monthly_rate = _monthly_discount_rate(normalized.discount_rate_annual)

    # Build monthly_rows
    monthly_rows: List[MonthlyRow] = []
    cum = 0.0
    for m in range(details.total_months):
        total_cost = details.cashflows[m]
        cum += total_cost
        disc = total_cost / (1.0 + monthly_rate) ** m if monthly_rate > 0 else total_cost
        # Concessions: TI at month 0 (negative), free rent value could be shown as positive concession
        concessions = -details.ti_at_0 if m == 0 else 0.0
        monthly_rows.append(
            MonthlyRow(
                month_index=m,
                date=_date_from_commencement_month(commencement, m).isoformat(),
                base_rent=details.rent[m],
                opex=details.opex[m],
                parking=details.parking[m],
                ti_amort=0.0,
                concessions=concessions,
                total_cost=total_cost,
                cumulative_cost=cum,
                discounted_value=round(disc, 2),
            )
        )

    # Build annual_rows
    annual_rows: List[AnnualRow] = []
    year_cum = 0.0
    year_disc_cum = 0.0
    for y in range((term_months + 11) // 12):
        start_m = y * 12
        end_m = min(start_m + 12, term_months)
        year_total = sum(details.cashflows[m] for m in range(start_m, end_m))
        year_cum += year_total
        for m in range(start_m, end_m):
            year_disc_cum += details.cashflows[m] / (1.0 + monthly_rate) ** m if monthly_rate > 0 else details.cashflows[m]
        months_in_year = end_m - start_m
        avg_psf = (year_total / months_in_year * 12) / rsf if rsf > 0 and months_in_year > 0 else 0.0
        annual_rows.append(
            AnnualRow(
                year_index=y,
                year_start_date=_date_from_commencement_month(commencement, start_m).isoformat(),
                total_cost=round(year_total, 2),
                avg_cost_psf_year=round(avg_psf, 2),
                cumulative_cost=round(year_cum, 2),
                discounted_value=round(year_disc_cum, 2),
            )
        )

    # Metrics for Summary Matrix and Broker Metrics
    years = term_months / 12.0 if term_months > 0 else 0.0
    metrics = CanonicalMetrics(
        premises_name=normalized.premises_name or "",
        address=normalized.address or "",
        rsf=normalized.rsf,
        lease_type=getattr(normalized.lease_type, "value", str(normalized.lease_type)) if hasattr(normalized.lease_type, "value") else str(normalized.lease_type),
        term_months=term_months,
        commencement_date=normalized.commencement_date.isoformat(),
        expiration_date=normalized.expiration_date.isoformat(),
        base_rent_total=round(result.rent_nominal, 2),
        base_rent_avg_psf_year=round(result.rent_nominal / years / rsf, 2) if rsf > 0 and years > 0 else 0.0,
        opex_total=round(result.opex_nominal, 2),
        opex_avg_psf_year=round(result.opex_nominal / years / rsf, 2) if rsf > 0 and years > 0 else 0.0,
        parking_total=round(result.parking_nominal, 2),
        parking_avg_psf_year=round(result.parking_nominal / years / rsf, 2) if rsf > 0 and years > 0 else 0.0,
        ti_value_total=round(details.ti_at_0, 2),
        free_rent_value_total=0.0,  # could compute from rent schedule * free months
        total_obligation_nominal=round(result.total_cost_nominal, 2),
        npv_cost=round(result.npv_cost, 2),
        equalized_avg_cost_psf_year=round(result.avg_cost_psf_year, 2),
        avg_all_in_cost_psf_year=round(result.avg_cost_psf_year, 2),
        discount_rate_annual=normalized.discount_rate_annual,
        notes=normalized.notes or "",
    )

    assumptions = [
        f"Discount rate {normalized.discount_rate_annual:.2%} applied monthly.",
        "Base rent and opex as provided; no amortization of TI in monthly view.",
    ]

    return CanonicalComputeResponse(
        normalized_canonical_lease=normalized,
        monthly_rows=monthly_rows,
        annual_rows=annual_rows,
        metrics=metrics,
        warnings=norm_warnings,
        assumptions=assumptions,
    )
