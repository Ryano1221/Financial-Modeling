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
from engine.compute import _monthly_discount_rate


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
    free_scope = str(data.get("free_rent_scope", data.get("free_rent_abatement_type", "base")) or "base").strip().lower()
    if free_scope not in {"base", "gross"}:
        free_scope = "base"
    data["free_rent_scope"] = free_scope
    if not data.get("free_rent_periods"):
        start_hint = data.get("free_rent_start_month")
        end_hint = data.get("free_rent_end_month")
        start = 0
        end = None
        try:
            if start_hint is not None:
                start = max(0, int(start_hint))
        except (TypeError, ValueError):
            start = 0
        try:
            if end_hint is not None:
                end = max(start, int(end_hint))
        except (TypeError, ValueError):
            end = None
        free_months = max(0, int(data.get("free_rent_months", 0) or 0))
        if free_months > 0:
            if end is None:
                end = start + free_months - 1
            data["free_rent_periods"] = [{"start_month": start, "end_month": end}]

    # Accept frontend alias
    if "phase_in_schedule" not in data and "phase_in_steps" in data:
        data["phase_in_schedule"] = data.get("phase_in_steps") or []

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


def _annual_opex_psf_for_calendar_year(
    lease: CanonicalLease,
    calendar_year: int,
    commencement_year: int,
) -> float:
    # If explicit year table exists, prefer it over growth math.
    explicit = getattr(lease, "opex_by_calendar_year", {}) or {}
    if explicit:
        normalized: dict[int, float] = {}
        for k, v in explicit.items():
            try:
                year_k = int(k)
                val = float(v)
            except (TypeError, ValueError):
                continue
            if 1900 <= year_k <= 2200 and val >= 0:
                normalized[year_k] = val
        if normalized:
            if calendar_year in normalized:
                return float(normalized[calendar_year])
            floor_years = [y for y in normalized if y <= calendar_year]
            if floor_years:
                return float(normalized[max(floor_years)])
            return float(normalized[min(normalized.keys())])

    base = float(lease.opex_psf_year_1 or 0.0)
    growth = float(lease.opex_growth_rate or 0.0)
    if growth <= 0:
        return base
    year_delta = max(0, int(calendar_year) - int(commencement_year))
    return base * ((1.0 + growth) ** year_delta)


def _charge_opex_psf_for_month(
    lease: CanonicalLease,
    month_index: int,
    commencement: date,
) -> float:
    period_date = _date_from_commencement_month(commencement, month_index)
    annual_opex_psf = _annual_opex_psf_for_calendar_year(
        lease=lease,
        calendar_year=period_date.year,
        commencement_year=commencement.year,
    )
    if str(lease.expense_structure_type) == "base_year":
        return max(0.0, annual_opex_psf - float(lease.expense_stop_psf or 0.0))
    return annual_opex_psf


def _rate_psf_for_month(lease: CanonicalLease, month_index: int) -> float:
    for step in lease.rent_schedule:
        if int(step.start_month) <= month_index <= int(step.end_month):
            return float(step.rent_psf_annual or 0.0)
    return 0.0


def _effective_rsf_schedule(lease: CanonicalLease, term_months: int) -> List[float]:
    if term_months <= 0:
        return []
    base = max(0.0, float(lease.rsf or 0.0))
    schedule = [base for _ in range(term_months)]
    if not lease.phase_in_schedule:
        return schedule
    for step in lease.phase_in_schedule:
        start = max(0, int(step.start_month))
        end = min(term_months - 1, max(start, int(step.end_month)))
        rsf = max(0.0, float(step.rsf or 0.0))
        for m in range(start, end + 1):
            schedule[m] = rsf
    return schedule


def _free_rent_ranges(lease: CanonicalLease, term_months: int) -> List[tuple[int, int]]:
    ranges: List[tuple[int, int]] = []
    if term_months <= 0:
        return ranges
    if lease.free_rent_periods:
        for period in lease.free_rent_periods:
            start = max(0, int(period.start_month))
            end = min(term_months - 1, max(start, int(period.end_month)))
            ranges.append((start, end))
    elif int(lease.free_rent_months or 0) > 0:
        end = min(term_months - 1, int(lease.free_rent_months) - 1)
        ranges.append((0, max(0, end)))
    if not ranges:
        return []
    ranges.sort(key=lambda r: (r[0], r[1]))
    merged: List[tuple[int, int]] = []
    for start, end in ranges:
        if not merged or start > merged[-1][1] + 1:
            merged.append((start, end))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
    return merged


def _compute_phase_aware_monthly(
    lease: CanonicalLease,
    term_months: int,
) -> tuple[List[float], List[float], List[float], List[float], float, List[float]]:
    effective_rsf = _effective_rsf_schedule(lease, term_months)
    rent: List[float] = [0.0 for _ in range(term_months)]
    opex: List[float] = [0.0 for _ in range(term_months)]
    parking: List[float] = [0.0 for _ in range(term_months)]

    for m in range(term_months):
        rsf_m = effective_rsf[m] if m < len(effective_rsf) else 0.0
        rent_rate = _rate_psf_for_month(lease, m)
        rent[m] = (rent_rate / 12.0) * rsf_m

        opex_charge_psf_yr = _charge_opex_psf_for_month(lease, m, lease.commencement_date)
        opex[m] = (opex_charge_psf_yr / 12.0) * rsf_m

        parking_count = float(lease.parking_count or 0)
        if parking_count <= 0 and float(lease.parking_ratio or 0) > 0:
            parking_count = (float(lease.parking_ratio) * rsf_m) / 1000.0
        parking_mult = (1.0 + float(lease.parking_escalation_rate or 0.0)) ** (m // 12)
        parking[m] = parking_count * float(lease.parking_rate_monthly or 0.0) * parking_mult

    free_ranges = _free_rent_ranges(lease, term_months)
    scope = str(getattr(lease, "free_rent_scope", "base") or "base").strip().lower()
    for start, end in free_ranges:
        for m in range(start, end + 1):
            rent[m] = 0.0
            if scope == "gross":
                opex[m] = 0.0
                parking[m] = 0.0

    max_rsf = max(effective_rsf) if effective_rsf else 0.0
    allowance_rsf = max(max_rsf, float(lease.rsf or 0.0))
    ti_at_0 = float(lease.ti_allowance_psf or 0.0) * allowance_rsf if term_months > 0 else 0.0

    cashflows: List[float] = []
    for m in range(term_months):
        total = rent[m] + opex[m] + parking[m]
        if m == 0:
            total -= ti_at_0
        cashflows.append(total)
    return rent, opex, parking, effective_rsf, ti_at_0, cashflows


def compute_canonical(lease: CanonicalLease) -> CanonicalComputeResponse:
    """
    Run canonical compute: normalize, map to Scenario, run engine, build response.
    """
    normalized, norm_warnings = normalize_canonical_lease(lease)
    scenario = canonical_to_scenario(normalized)
    term_months = int(scenario.term_months)
    phase_enabled = len(normalized.phase_in_schedule) > 0

    (
        rent_series,
        opex_series,
        parking_series,
        effective_rsf_series,
        ti_at_0,
        cashflows,
    ) = _compute_phase_aware_monthly(normalized, term_months)
    rent_nominal = float(sum(rent_series))
    opex_nominal = float(sum(opex_series))
    parking_nominal = float(sum(parking_series))
    total_cost_nominal = float(sum(cashflows))
    monthly_rate = _monthly_discount_rate(normalized.discount_rate_annual)
    if monthly_rate > 0:
        npv_cost = float(sum(cf / ((1.0 + monthly_rate) ** i) for i, cf in enumerate(cashflows)))
    else:
        npv_cost = total_cost_nominal

    commencement = normalized.commencement_date
    rsf = float(normalized.rsf or 0.0)
    years = term_months / 12.0 if term_months > 0 else 0.0
    avg_rsf_term = (sum(effective_rsf_series) / len(effective_rsf_series)) if effective_rsf_series else rsf

    # Build monthly_rows
    monthly_rows: List[MonthlyRow] = []
    cum = 0.0
    for m in range(term_months):
        total_cost = cashflows[m]
        cum += total_cost
        disc = total_cost / (1.0 + monthly_rate) ** m if monthly_rate > 0 else total_cost
        # Concessions: TI at month 0 (negative), free rent value could be shown as positive concession
        concessions = -ti_at_0 if m == 0 else 0.0
        monthly_rows.append(
            MonthlyRow(
                month_index=m,
                date=_date_from_commencement_month(commencement, m).isoformat(),
                base_rent=rent_series[m] if m < len(rent_series) else 0.0,
                opex=opex_series[m] if m < len(opex_series) else 0.0,
                parking=parking_series[m] if m < len(parking_series) else 0.0,
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
        year_total = sum(cashflows[m] for m in range(start_m, end_m))
        year_cum += year_total
        for m in range(start_m, end_m):
            year_disc_cum += cashflows[m] / (1.0 + monthly_rate) ** m if monthly_rate > 0 else cashflows[m]
        months_in_year = end_m - start_m
        year_rsf = effective_rsf_series[start_m:end_m]
        avg_year_rsf = (sum(year_rsf) / len(year_rsf)) if year_rsf else rsf
        avg_psf = (year_total / months_in_year * 12) / avg_year_rsf if avg_year_rsf > 0 and months_in_year > 0 else 0.0
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
    metrics = CanonicalMetrics(
        premises_name=normalized.premises_name or "",
        address=normalized.address or "",
        building_name=normalized.building_name or "",
        suite=normalized.suite or "",
        floor=normalized.floor or "",
        rsf=normalized.rsf,
        lease_type=getattr(normalized.lease_type, "value", str(normalized.lease_type)) if hasattr(normalized.lease_type, "value") else str(normalized.lease_type),
        term_months=term_months,
        commencement_date=normalized.commencement_date.isoformat(),
        expiration_date=normalized.expiration_date.isoformat(),
        base_rent_total=round(rent_nominal, 2),
        base_rent_avg_psf_year=round(rent_nominal / years / avg_rsf_term, 2) if avg_rsf_term > 0 and years > 0 else 0.0,
        opex_total=round(opex_nominal, 2),
        opex_avg_psf_year=round(opex_nominal / years / avg_rsf_term, 2) if avg_rsf_term > 0 and years > 0 else 0.0,
        parking_total=round(parking_nominal, 2),
        parking_avg_psf_year=round(parking_nominal / years / avg_rsf_term, 2) if avg_rsf_term > 0 and years > 0 else 0.0,
        ti_value_total=round(ti_at_0, 2),
        free_rent_value_total=0.0,  # could compute from rent schedule * free months
        total_obligation_nominal=round(total_cost_nominal, 2),
        npv_cost=round(npv_cost, 2),
        equalized_avg_cost_psf_year=round((npv_cost / years) / avg_rsf_term, 2) if avg_rsf_term > 0 and years > 0 else 0.0,
        avg_all_in_cost_psf_year=round((npv_cost / years) / avg_rsf_term, 2) if avg_rsf_term > 0 and years > 0 else 0.0,
        discount_rate_annual=normalized.discount_rate_annual,
        notes=normalized.notes or "",
    )

    assumptions = [
        f"Discount rate {normalized.discount_rate_annual:.2%} applied monthly.",
        "Base rent and opex as provided; no amortization of TI in monthly view.",
    ]
    free_scope = str(getattr(normalized, "free_rent_scope", "base") or "base").strip().lower()
    if normalized.free_rent_periods:
        period_labels = [
            f"{int(p.start_month) + 1}-{int(p.end_month) + 1}"
            for p in normalized.free_rent_periods
        ]
        assumptions.append(
            f"Free-rent abatement applied for months {', '.join(period_labels)} as {free_scope}."
        )
    elif int(normalized.free_rent_months or 0) > 0:
        assumptions.append(
            f"Free-rent abatement applied for months 1-{int(normalized.free_rent_months)} as {free_scope}."
        )
    if phase_enabled:
        assumptions.append("Phase-in RSF schedule applied to monthly base rent, OpEx, and parking calculations.")

    return CanonicalComputeResponse(
        normalized_canonical_lease=normalized,
        monthly_rows=monthly_rows,
        annual_rows=annual_rows,
        metrics=metrics,
        warnings=norm_warnings,
        assumptions=assumptions,
    )
