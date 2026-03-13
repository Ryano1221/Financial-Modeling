from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import re
from typing import Any


def _parse_date(value: Any) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m.%d.%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except Exception:
            continue
    return None


def _month_diff(start: date, end: date) -> int:
    months = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day < start.day:
        months -= 1
    return max(0, months)


def _make_task(
    field_path: str,
    severity: str,
    issue_code: str,
    message: str,
    *,
    candidates: list[dict[str, Any]] | None = None,
    recommended_value: Any = None,
    evidence: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    task = {
        "field_path": field_path,
        "severity": severity,
        "issue_code": issue_code,
        "message": message,
        "candidates": candidates or [],
        "recommended_value": recommended_value,
        "evidence": evidence or [],
    }
    return task


def _validate_term(term: dict[str, Any], review_tasks: list[dict[str, Any]]) -> bool:
    start = _parse_date(term.get("commencement_date"))
    end = _parse_date(term.get("expiration_date"))
    term_months = term.get("term_months")
    if not start or not end or term_months in (None, ""):
        return True
    try:
        tm = int(term_months)
    except Exception:
        return False
    implied = _month_diff(start, end)
    if abs(implied - tm) > 1:
        review_tasks.append(
            _make_task(
                "term.term_months",
                "blocker",
                "TERM_MISMATCH",
                f"Term mismatch: implied={implied} months from dates but term_months={tm}.",
                recommended_value=implied,
            )
        )
        return False
    return True


def _validate_rent_coverage(term: dict[str, Any], rent_steps: list[dict[str, Any]], review_tasks: list[dict[str, Any]]) -> bool:
    if not rent_steps:
        review_tasks.append(
            _make_task(
                "rent_steps",
                "blocker",
                "RENT_STEPS_MISSING",
                "Rent schedule is empty; unable to compute full coverage.",
            )
        )
        return False

    term_months = int(term.get("term_months") or 0)
    if term_months <= 0:
        return True

    expected = 0
    valid = True
    for step in sorted(rent_steps, key=lambda s: (int(s.get("start_month") or 0), int(s.get("end_month") or 0))):
        s = int(step.get("start_month") or 0)
        e = int(step.get("end_month") or s)
        if s != expected:
            valid = False
            review_tasks.append(
                _make_task(
                    "rent_steps",
                    "blocker",
                    "RENT_SCHEDULE_GAP_OR_OVERLAP",
                    f"Expected start month {expected} but found {s}.",
                    candidates=rent_steps,
                )
            )
            break
        if e < s:
            valid = False
            review_tasks.append(
                _make_task(
                    "rent_steps",
                    "blocker",
                    "RENT_SCHEDULE_INVALID_RANGE",
                    f"Invalid step range {s}-{e}.",
                    candidates=rent_steps,
                )
            )
            break
        expected = e + 1

    if valid and expected - 1 != term_months - 1:
        valid = False
        review_tasks.append(
            _make_task(
                "rent_steps",
                "blocker",
                "RENT_SCHEDULE_COVERAGE",
                f"Rent schedule ends at month {expected - 1}; expected {term_months - 1}.",
                candidates=rent_steps,
            )
        )
    return valid


def _validate_abatement_scope(abatements: list[dict[str, Any]], review_tasks: list[dict[str, Any]]) -> bool:
    if not abatements:
        return True
    valid = True
    for a in abatements:
        scope = str(a.get("scope") or "").strip().lower()
        if scope in {"base_rent_only", "gross_rent"}:
            continue
        if scope in {"", "unspecified", "unknown"}:
            review_tasks.append(
                _make_task(
                    "abatements",
                    "warn",
                    "ABATEMENT_SCOPE_UNSPECIFIED",
                    "Abatement scope is unspecified; confirm whether base-rent-only or gross-rent abatement.",
                    candidates=abatements,
                )
            )
        else:
            review_tasks.append(
                _make_task(
                    "abatements",
                    "warn",
                    "ABATEMENT_SCOPE_UNRECOGNIZED",
                    f"Unrecognized abatement scope '{scope}'.",
                    candidates=abatements,
                )
            )
        valid = False
    return valid


def _validate_abatement_classification(
    abatements: list[dict[str, Any]],
    abatement_analysis: dict[str, Any],
    review_tasks: list[dict[str, Any]],
) -> bool:
    classification = str(abatement_analysis.get("classification") or "").strip().lower()
    phase_in_detected = bool(abatement_analysis.get("phase_in_detected"))
    has_abatement = bool(abatements)
    valid = True

    if phase_in_detected and classification in {"", "unknown", "none"}:
        review_tasks.append(
            _make_task(
                "abatement_analysis.classification",
                "warn",
                "PHASE_IN_CLASSIFICATION_UNRESOLVED",
                "Phase-in occupancy cues detected but abatement classification is unresolved.",
                recommended_value="phase_in",
            )
        )
        valid = False

    if has_abatement and classification in {"", "none", "phase_in"}:
        review_tasks.append(
            _make_task(
                "abatement_analysis.classification",
                "warn",
                "ABATEMENT_CLASSIFICATION_UNRESOLVED",
                "Abatement scope exists but classification is unresolved; confirm base-rent-only vs gross-rent abatement.",
                candidates=abatements,
                recommended_value="rent_abatement",
            )
        )
        valid = False

    if phase_in_detected and has_abatement and classification not in {"mixed", "rent_abatement"}:
        review_tasks.append(
            _make_task(
                "abatement_analysis.classification",
                "warn",
                "ABATEMENT_PHASE_IN_CONFLICT",
                "Both phase-in occupancy and rent abatement cues were detected; confirm concession treatment.",
                candidates=abatements,
                recommended_value="mixed",
            )
        )
        valid = False

    if classification == "mixed" and not (phase_in_detected and has_abatement):
        review_tasks.append(
            _make_task(
                "abatement_analysis.classification",
                "warn",
                "ABATEMENT_MIXED_UNSUPPORTED",
                "Classification marked mixed but evidence does not show both phase-in and abatement.",
            )
        )
        valid = False
    return valid


def _validate_opex(opex: dict[str, Any], evidence: list[dict[str, Any]], review_tasks: list[dict[str, Any]]) -> bool:
    mode = str(opex.get("mode") or "").strip().lower().replace("-", "_").replace(" ", "_")
    cues_text = " ".join(str(e.get("snippet") or "") for e in evidence).lower()
    cues_text = f"{cues_text} {' '.join(str(c) for c in (opex.get('cues') or []))}".strip()
    nnn_cues = any(k in cues_text for k in ["nnn", "triple net"])
    base_year_cues = any(k in cues_text for k in ["base year", "base-year", "expense stop", "gross with stop", "modified gross"])
    gross_cues = any(k in cues_text for k in ["full service", "full-service", "full service gross", "gross lease", "fsg"])

    base_missing = opex.get("base_psf_year_1") in (None, "")
    if nnn_cues and mode in {"", "unknown", "none"}:
        review_tasks.append(
            _make_task(
                "opex",
                "blocker",
                "OPEX_NNN_INCOMPLETE",
                "NNN cues detected but OpEx mode/base information is missing.",
                evidence=evidence[:6],
            )
        )
        return False
    if nnn_cues and mode == "nnn" and base_missing:
        review_tasks.append(
            _make_task(
                "opex",
                "blocker",
                "OPEX_NNN_INCOMPLETE",
                "NNN cues detected but OpEx mode/base information is missing.",
                evidence=evidence[:6],
            )
        )
        return False
    if base_year_cues and mode in {"", "unknown", "none"}:
        review_tasks.append(
            _make_task(
                "opex.mode",
                "warn",
                "OPEX_BASE_YEAR_UNRESOLVED",
                "Base-year/expense-stop cues detected but OpEx mode is unresolved.",
                evidence=evidence[:6],
                recommended_value="gross_with_stop",
            )
        )
    if gross_cues and mode in {"", "unknown", "none"}:
        review_tasks.append(
            _make_task(
                "opex.mode",
                "warn",
                "OPEX_FULL_SERVICE_UNRESOLVED",
                "Full-service gross cues detected but OpEx mode is unresolved.",
                evidence=evidence[:6],
                recommended_value="full_service",
            )
        )
    if gross_cues and mode == "nnn":
        review_tasks.append(
            _make_task(
                "opex.mode",
                "warn",
                "OPEX_MODE_CONFLICT",
                "Full-service gross cues conflict with NNN mode; review lease structure.",
                evidence=evidence[:6],
                recommended_value="full_service",
            )
        )
    return True


def _validate_ti_and_concessions(
    extraction: dict[str, Any],
    evidence: list[dict[str, Any]],
    review_tasks: list[dict[str, Any]],
) -> bool:
    text = " ".join(str(e.get("snippet") or "") for e in evidence).lower()
    tenant_improvements = extraction.get("tenant_improvements") or {}
    abatements = extraction.get("abatements") or []
    parking_abatements = extraction.get("parking_abatements") or []
    concessions = extraction.get("concessions") or {}
    premises = extraction.get("premises") or {}

    ti_psf = tenant_improvements.get("ti_allowance_psf")
    ti_total = tenant_improvements.get("ti_allowance_total")
    rsf = premises.get("rsf")
    free_rent_months = concessions.get("free_rent_months")

    ti_cues = bool(
        re.search(
            r"(?i)\b(?:tenant\s+improvement(?:s)?\s+allowance|ti\s+allowance|tenant\s+allowance|improvement\s+allowance|tia)\b",
            text,
        )
    )
    free_rent_cues = bool(re.search(r"(?i)\b(?:free\s+rent|rent\s+abatement|abatement|abated)\b", text))
    gross_abatement_cues = bool(re.search(r"(?i)\b(?:gross\s+rent\s+abatement|gross\s+abatement|base\s+rent\s+and\s+operating\s+expenses\s+abated)\b", text))
    base_abatement_cues = bool(re.search(r"(?i)\b(?:base\s+rent\s+only\s+abatement|base\s+rent\s+abatement|base\s+free\s+rent)\b", text))
    parking_abatement_cues = bool(re.search(r"(?i)\bparking(?:\s+charges?|\s+costs?|\s+rent|\s+fees?)?[^\n]{0,60}\b(?:abated|abatement|waived|free)\b", text))
    parking_references_abatement_period = bool(re.search(r"(?is)\bparking(?:\s+costs?|\s+charges?|\s+rent|\s+fees?)?\b[\s\S]{0,220}\babatement\s+period\b", text))
    landlord_work_cues = bool(
        re.search(r"(?i)\b(?:turn[\s-]?key|work\s+letter|landlord'?s?\s+work|landlord\s+work)\b", text)
    )
    other_concession_patterns = {
        "MOVING_ALLOWANCE_DETECTED": r"(?i)\b(?:moving|relocation)\s+allowance\b",
        "FURNITURE_ALLOWANCE_DETECTED": r"(?i)\b(?:furniture|ff&e|ffe)\s+allowance\b",
        "SIGNAGE_ALLOWANCE_DETECTED": r"(?i)\b(?:signage|door\s+signage|building\s+signage)\s+allowance\b",
    }

    valid = True
    if ti_cues and ti_psf in (None, "") and ti_total in (None, ""):
        review_tasks.append(
            _make_task(
                "tenant_improvements",
                "warn",
                "TI_ALLOWANCE_INCOMPLETE",
                "Document references TI allowance economics, but no model-ready TI allowance was confidently extracted.",
                evidence=evidence[:8],
            )
        )
        valid = False

    if ti_total not in (None, "") and ti_psf in (None, "") and (rsf in (None, "") or float(rsf or 0) <= 0):
        review_tasks.append(
            _make_task(
                "tenant_improvements.ti_allowance_psf",
                "warn",
                "TI_ALLOWANCE_NORMALIZATION_INCOMPLETE",
                "A total TI allowance was found, but TI per-RSF could not be normalized because RSF is missing.",
                evidence=evidence[:8],
            )
        )
        valid = False

    if ti_psf not in (None, "") and ti_total not in (None, "") and rsf not in (None, "") and float(rsf or 0) > 0:
        implied_total = float(ti_psf or 0.0) * float(rsf or 0.0)
        actual_total = float(ti_total or 0.0)
        if implied_total > 0 and abs(implied_total - actual_total) / implied_total > 0.25:
            review_tasks.append(
                _make_task(
                    "tenant_improvements",
                    "warn",
                    "TI_ALLOWANCE_INCONSISTENT",
                    "TI allowance per-RSF and total-dollar allowance do not reconcile within tolerance.",
                    evidence=evidence[:8],
                )
            )
            valid = False

    if free_rent_cues and free_rent_months in (None, "") and not abatements:
        review_tasks.append(
            _make_task(
                "concessions.free_rent_months",
                "warn",
                "FREE_RENT_INCOMPLETE",
                "Document references free rent or rent abatement, but concession timing was not confidently extracted.",
                evidence=evidence[:8],
            )
        )
        valid = False

    if abatements and gross_abatement_cues and any(str(a.get("scope") or "").strip().lower() != "gross_rent" for a in abatements):
        review_tasks.append(
            _make_task(
                "abatements",
                "warn",
                "ABATEMENT_SCOPE_GROSS_CONFLICT",
                "Gross-rent abatement cues were detected, but the resolved abatement scope is not consistently gross-rent.",
                candidates=abatements,
                evidence=evidence[:8],
            )
        )
        valid = False

    if abatements and base_abatement_cues and any(str(a.get("scope") or "").strip().lower() != "base_rent_only" for a in abatements):
        review_tasks.append(
            _make_task(
                "abatements",
                "warn",
                "ABATEMENT_SCOPE_BASE_CONFLICT",
                "Base-rent-only abatement cues were detected, but the resolved abatement scope is not consistently base-rent-only.",
                candidates=abatements,
                evidence=evidence[:8],
            )
        )
        valid = False

    if parking_abatement_cues and not parking_abatements:
        review_tasks.append(
            _make_task(
                "parking_abatements",
                "warn",
                "PARKING_ABATEMENT_INCOMPLETE",
                "Parking abatement was referenced, but no structured parking-abatement periods were resolved.",
                evidence=evidence[:8],
            )
        )
        valid = False

    if parking_references_abatement_period and not parking_abatements:
        review_tasks.append(
            _make_task(
                "parking_abatements",
                "warn",
                "PARKING_ABATEMENT_PERIOD_UNRESOLVED",
                "Parking abatement references the abatement period, but the shared concession timing could not be resolved confidently.",
                evidence=evidence[:8],
            )
        )
        valid = False

    if landlord_work_cues and not ti_cues and ti_psf in (None, "") and ti_total in (None, ""):
        review_tasks.append(
            _make_task(
                "tenant_improvements",
                "warn",
                "LANDLORD_WORK_CONCESSION_DETECTED",
                "Document references turnkey or landlord work concessions. Review separately from TI allowance economics.",
                evidence=evidence[:8],
            )
        )

    for issue_code, pattern in other_concession_patterns.items():
        if not re.search(pattern, text):
            continue
        review_tasks.append(
            _make_task(
                "concessions",
                "warn",
                issue_code,
                "Document references a one-time concession that is not mapped into model-ready TI or free-rent fields.",
                evidence=evidence[:8],
            )
        )

    return valid


def _collect_missing_information(extraction: dict[str, Any], review_tasks: list[dict[str, Any]]) -> list[str]:
    missing: list[str] = []

    checks = [
        ("term.commencement_date", extraction.get("term", {}).get("commencement_date"), "Commencement date is missing."),
        ("term.expiration_date", extraction.get("term", {}).get("expiration_date"), "Expiration date is missing."),
        ("term.term_months", extraction.get("term", {}).get("term_months"), "Lease term is missing."),
        ("premises.rsf", extraction.get("premises", {}).get("rsf"), "Premises RSF is missing."),
        ("opex.mode", extraction.get("opex", {}).get("mode"), "Lease type / OpEx mode is missing or unresolved."),
        ("tenant_improvements.ti_allowance_psf", extraction.get("tenant_improvements", {}).get("ti_allowance_psf"), "TI allowance per RSF is missing."),
        ("parking.ratio_per_1000_rsf", extraction.get("parking", {}).get("ratio_per_1000_rsf"), "Parking ratio is missing."),
        ("parking.rate_monthly_per_space", extraction.get("parking", {}).get("rate_monthly_per_space"), "Parking rate is missing."),
        ("rights_options.renewal_option", extraction.get("rights_options", {}).get("renewal_option"), "Renewal option terms are missing."),
    ]

    seen_codes = {str(t.get("issue_code") or "") for t in review_tasks}
    for field_path, value, message in checks:
        empty = value in (None, "", []) or (field_path == "premises.rsf" and float(value or 0) <= 0)
        if not empty:
            continue
        missing.append(field_path)
        code = f"MISSING_{field_path.upper().replace('.', '_')}"
        if code in seen_codes:
            continue
        review_tasks.append(
            _make_task(
                field_path,
                "warn",
                code,
                message,
            )
        )
    return missing


def _compute_overall_confidence(
    source_quality: float,
    validation_pass_rate: float,
    reconcile_margin: float,
    has_blockers: bool,
    has_warns: bool,
) -> tuple[float, str, bool]:
    blended = (source_quality * 0.45) + (validation_pass_rate * 0.35) + (reconcile_margin * 0.20)
    blended = max(0.0, min(1.0, blended))

    if has_blockers or blended < 0.70:
        return blended, "red", False
    if blended < 0.85 or has_warns:
        return blended, "yellow", True
    return blended, "green", True


def validate_extraction(
    extraction: dict[str, Any],
    *,
    source_quality: float,
    reconcile_margin: float,
) -> dict[str, Any]:
    review_tasks: list[dict[str, Any]] = list(extraction.get("review_tasks") or [])

    term = extraction.get("term") or {}
    rent_steps = extraction.get("rent_steps") or []
    abatements = extraction.get("abatements") or []
    abatement_analysis = extraction.get("abatement_analysis") or {}
    opex = extraction.get("opex") or {}
    evidence = extraction.get("evidence") or []

    checks = []
    checks.append(_validate_term(term, review_tasks))
    checks.append(_validate_rent_coverage(term, rent_steps, review_tasks))
    checks.append(_validate_abatement_scope(abatements, review_tasks))
    checks.append(_validate_abatement_classification(abatements, abatement_analysis, review_tasks))
    checks.append(_validate_opex(opex, evidence, review_tasks))
    checks.append(_validate_ti_and_concessions(extraction, evidence, review_tasks))

    missing_information = _collect_missing_information(extraction, review_tasks)
    extraction["missing_information"] = missing_information

    pass_rate = sum(1 for c in checks if c) / max(1, len(checks))
    has_blockers = any(str(t.get("severity") or "") == "blocker" for t in review_tasks)
    has_warns = any(str(t.get("severity") or "") == "warn" for t in review_tasks)
    overall, status, export_allowed = _compute_overall_confidence(
        source_quality=source_quality,
        validation_pass_rate=pass_rate,
        reconcile_margin=reconcile_margin,
        has_blockers=has_blockers,
        has_warns=has_warns,
    )

    extraction["review_tasks"] = review_tasks
    extraction["confidence"] = {
        "overall": round(overall, 4),
        "status": status,
        "export_allowed": export_allowed,
        "validation_pass_rate": round(pass_rate, 4),
        "reconcile_margin": round(max(0.0, min(1.0, reconcile_margin)), 4),
    }
    extraction["export_allowed"] = export_allowed
    return extraction
