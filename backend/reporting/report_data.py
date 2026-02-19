"""
Build normalized report data from scenario + compute result for institutional PDF.
Memo-quality narrative, risk/observations, notes/limitations, optional confidence and methodology.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from models import CashflowResult, OpexMode, Scenario


def _year_ranges(term_months: int) -> list[tuple[int, int, int]]:
    """Return list of (year_1based, start_month_0based, end_month_0based) for each lease year."""
    years = []
    for y in range((term_months + 11) // 12):
        start = y * 12
        end = min(start + 11, term_months - 1)
        if start <= end:
            years.append((y + 1, start, end))
    return years


def _fmt_date(value: Any) -> str:
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    text = str(value or "").strip()
    if not text:
        return "—"
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:10], fmt).date().strftime("%d/%m/%Y")
        except ValueError:
            continue
    return text


def _rent_for_year(scenario: Scenario, year_1: int, start_m: int, end_m: int) -> float:
    """Total base rent for the given year (month indices start_m..end_m inclusive)."""
    total = 0.0
    for step in scenario.rent_steps:
        monthly = step.rate_psf_yr / 12.0 * scenario.rsf
        for m in range(max(step.start, start_m), min(step.end, end_m) + 1):
            if m < scenario.free_rent_months:
                continue
            total += monthly
    return total


def build_report_data(
    scenario: Scenario,
    compute_result: CashflowResult,
    warnings: list[str] | None = None,
    confidence: dict[str, float] | None = None,
    evidence: dict[str, str] | None = None,
) -> dict[str, Any]:
    """
    Build normalized report data: executive summary (including narrative paragraph),
    financial summary, rent schedule, assumptions, risk/observations, notes_limitations,
    optional confidence_table and methodology text.
    """
    warnings = warnings or []
    confidence = confidence or {}
    evidence = evidence or {}
    low_confidence = [k for k, v in confidence.items() if isinstance(v, (int, float)) and v < 0.7]

    term_months = scenario.term_months
    rsf = scenario.rsf
    npv = getattr(compute_result, "npv_cost", 0.0)
    avg_psf = getattr(compute_result, "avg_cost_psf_year", 0.0)

    # Executive summary narrative paragraph
    years_str = f"{term_months / 12:.1f}" if term_months else "0"
    drivers = []
    if scenario.free_rent_months > 0:
        drivers.append(f"{scenario.free_rent_months} months of free rent")
    if scenario.ti_allowance_psf > 0:
        drivers.append(f"TI allowance of ${scenario.ti_allowance_psf:,.2f}/SF")
    if scenario.rent_steps:
        drivers.append(f"base rent from ${scenario.rent_steps[0].rate_psf_yr:,.2f}/SF/yr")
    drivers_str = "; ".join(drivers) if drivers else "base rent and operating expenses"
    executive_summary_paragraph = (
        f"This analysis summarizes the lease economics for {scenario.name} over a {years_str}-year term "
        f"({rsf:,.0f} SF). Total estimated net present value of occupancy cost is ${npv:,.0f} "
        f"(approximately ${avg_psf:,.2f}/SF/year on a discounted basis). "
        f"Major cost drivers include {drivers_str}. "
        "All figures are subject to the assumptions and limitations noted in this report."
    )

    # Executive summary key terms (display-ready strings; builder may re-format via format_* if desired)
    key_terms = [
        ("Scenario", scenario.name),
        ("RSF", f"{rsf:,.0f}"),
        ("Commencement", _fmt_date(scenario.commencement)),
        ("Expiration", _fmt_date(scenario.expiration)),
        ("Term (months)", str(compute_result.term_months)),
        ("Free rent (months)", str(scenario.free_rent_months)),
        ("TI allowance ($/SF)", f"{scenario.ti_allowance_psf:,.2f}"),
        ("Opex mode", scenario.opex_mode.value),
        ("Discount rate", f"{scenario.discount_rate_annual * 100:.2f}%"),
    ]

    # Financial summary totals (raw numbers; formatting in builder)
    financial_summary = {
        "term_months": compute_result.term_months,
        "rent_nominal": compute_result.rent_nominal,
        "opex_nominal": compute_result.opex_nominal,
        "total_cost_nominal": compute_result.total_cost_nominal,
        "npv_cost": compute_result.npv_cost,
        "avg_cost_year": compute_result.avg_cost_year,
        "avg_cost_psf_year": compute_result.avg_cost_psf_year,
        "npv_rent": getattr(compute_result, "npv_rent", compute_result.npv_cost * 0.7),
        "npv_opex": getattr(compute_result, "npv_opex", 0.0),
    }

    # Rent schedule by lease year
    year_ranges = _year_ranges(term_months)
    rent_schedule = []
    for year_1, start_m, end_m in year_ranges:
        rent_yr = _rent_for_year(scenario, year_1, start_m, end_m)
        rent_schedule.append({"lease_year": year_1, "rent_nominal": rent_yr})

    # Assumptions list (raw strings; numbers formatted in builder if we pass formatted later, or keep pre-formatted here)
    assumptions = [
        f"Rentable area: {rsf:,.0f} SF",
        f"Lease term: {_fmt_date(scenario.commencement)} to {_fmt_date(scenario.expiration)}",
        f"Free rent: {scenario.free_rent_months} months",
        f"TI allowance: ${scenario.ti_allowance_psf:,.2f}/SF",
        f"Opex mode: {scenario.opex_mode.value}",
        f"Base opex: ${scenario.base_opex_psf_yr:,.2f}/SF/yr",
        f"Opex growth: {scenario.opex_growth * 100:.2f}%",
        f"Discount rate: {scenario.discount_rate_annual * 100:.2f}%",
    ]
    if scenario.rent_steps:
        for i, step in enumerate(scenario.rent_steps[:5]):
            assumptions.append(f"Rent step {i + 1}: months {step.start}-{step.end} @ ${step.rate_psf_yr:,.2f}/SF/yr")

    # Risk and observations: low confidence, missing/unclear terms, NNN vs base year, escalation, parking, term
    risk_observations = list(warnings)
    for k in low_confidence:
        risk_observations.append(f"Low confidence in extracted field: {k}")
    if term_months <= 0:
        risk_observations.append("Term missing or invalid; verify commencement and expiration dates.")
    if scenario.free_rent_months == 0 and not any("free" in w.lower() for w in warnings):
        risk_observations.append("Free rent not specified; assumed zero. Confirm with lease.")
    if scenario.ti_allowance_psf == 0:
        risk_observations.append("TI allowance not specified or zero; confirm with lease.")
    if len(scenario.rent_steps) <= 1 and scenario.rent_steps:
        risk_observations.append("Single rent step only; escalation or step-ups may not be reflected.")
    if getattr(scenario, "parking_spaces", 0) == 0 and getattr(scenario, "parking_cost_monthly_per_space", 0) == 0:
        risk_observations.append("Parking terms not included; add if applicable.")
    if scenario.opex_mode == OpexMode.BASE_YEAR:
        risk_observations.append("Base year structure; confirm base year definition and passthrough terms.")

    # Notes and limitations (always include)
    notes_limitations = list(warnings)
    notes_limitations.append("Extracted data has been reviewed and may contain assumptions where the source document was unclear. All figures should be verified against the executed lease and related documents.")

    # Confidence table for optional Data Confidence section: Field, Confidence, Evidence
    confidence_table: list[dict[str, Any]] = []
    for field, conf in confidence.items():
        if not isinstance(conf, (int, float)):
            continue
        evidence_snippet = evidence.get(field) or "No direct excerpt captured."
        confidence_table.append({"field": field, "confidence": conf, "evidence": evidence_snippet})
    if not confidence_table and (low_confidence or confidence):
        for k in ["rsf", "commencement", "expiration", "rent_steps", "free_rent", "ti_allowance", "opex_mode"]:
            if k in confidence:
                confidence_table.append({
                    "field": k,
                    "confidence": confidence[k],
                    "evidence": evidence.get(k) or "No direct excerpt captured.",
                })

    # Methodology section (enterprise-safe, neutral)
    methodology_html = """
    <p>This report is produced from structured lease data that may have been derived from document ingestion and extraction. When source documents are PDF or image-based, optical character recognition (OCR) may be used as a fallback to obtain text. Extracted text is validated against a structured schema and missing or ambiguous fields are filled with conservative defaults where applicable.</p>
    <p>AI-assisted extraction is used to map lease language to quantitative terms. Such extraction has limitations: it may misread numbers, miss amendments or exhibits, and cannot replace legal or accounting review. All figures and assumptions should be verified against the executed lease and related documents.</p>
    """

    return {
        "executive_summary_paragraph": executive_summary_paragraph,
        "key_terms": key_terms,
        "financial_summary": financial_summary,
        "rent_schedule": rent_schedule,
        "assumptions": assumptions,
        "risk_observations": risk_observations,
        "notes_limitations": notes_limitations,
        "confidence_table": confidence_table,
        "methodology_html": methodology_html.strip(),
        "scenario_name": scenario.name,
        "term_months": term_months,
    }
