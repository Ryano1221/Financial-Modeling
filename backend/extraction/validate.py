from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
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
