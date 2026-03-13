from __future__ import annotations

import tempfile
from datetime import date, timedelta
from dataclasses import asdict
from pathlib import Path
from typing import Any

from models import CanonicalLease

from .classify import classify_document
from .llm_extract import structured_extract
from .normalize import normalize_document
from .ocr import apply_ocr_fallback
from .reconcile import reconcile
from .regex import mine_candidates
from .schema import validate_canonical_extraction
from .sections import retrieve_section_snippets
from .tables import extract_rent_step_candidates_with_review
from .validate import validate_extraction


def _parse_date(value: Any) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m.%d.%Y", "%m-%d-%Y"):
        try:
            from datetime import datetime

            return datetime.strptime(raw, fmt).date()
        except Exception:
            continue
    return None


def _month_diff(start: date, end: date) -> int:
    months = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day < start.day:
        months -= 1
    return max(0, months)


def _expiration_from_term_months(commencement: date, term_months: int) -> date:
    tm = max(1, int(term_months))
    total = (commencement.month - 1) + tm
    year = commencement.year + (total // 12)
    month = (total % 12) + 1
    anniv = date(year, month, min(commencement.day, 28))
    return anniv - timedelta(days=1)


def _commencement_from_term_months(expiration: date, term_months: int) -> date:
    tm = max(1, int(term_months))
    anchor = expiration + timedelta(days=1)
    y = anchor.year
    m = anchor.month - tm
    while m <= 0:
        y -= 1
        m += 12
    return date(y, m, 1)


def _repair_rent_schedule(steps: list[dict[str, Any]], term_months: int) -> list[dict[str, Any]]:
    if term_months <= 0:
        return [{"start_month": 0, "end_month": 0, "rate_psf_annual": 0.0}]
    if not steps:
        return [{"start_month": 0, "end_month": max(0, term_months - 1), "rate_psf_annual": 0.0}]

    ordered = sorted(
        [
            {
                "start_month": max(0, int(s.get("start_month") or 0)),
                "end_month": max(0, int(s.get("end_month") or 0)),
                "rate_psf_annual": max(0.0, float(s.get("rate_psf_annual") or 0.0)),
            }
            for s in steps
            if isinstance(s, dict)
        ],
        key=lambda x: (int(x["start_month"]), int(x["end_month"])),
    )
    if not ordered:
        return [{"start_month": 0, "end_month": max(0, term_months - 1), "rate_psf_annual": 0.0}]

    fixed: list[dict[str, Any]] = []
    expected = 0
    for raw in ordered:
        start = int(raw["start_month"])
        end = int(raw["end_month"])
        rate = float(raw["rate_psf_annual"])
        if not fixed and start != 0:
            start = 0
        if start != expected:
            start = expected
        if end < start:
            end = start
        fixed.append({"start_month": start, "end_month": end, "rate_psf_annual": rate})
        expected = end + 1

    target_end = max(0, term_months - 1)
    fixed = [s for s in fixed if int(s["start_month"]) <= target_end]
    if not fixed:
        return [{"start_month": 0, "end_month": target_end, "rate_psf_annual": 0.0}]
    fixed[-1]["end_month"] = target_end
    return fixed


def _finalize_extraction(extraction: dict[str, Any], *, solver_debug: dict[str, Any] | None = None, solver_degraded: bool = False) -> dict[str, Any]:
    term = extraction.setdefault("term", {})
    premises = extraction.setdefault("premises", {})
    opex = extraction.setdefault("opex", {})
    logs: list[dict[str, Any]] = []
    degraded = bool(solver_degraded)

    comm = _parse_date(term.get("commencement_date"))
    exp = _parse_date(term.get("expiration_date"))
    tm_raw = term.get("term_months")
    try:
        term_months = max(0, int(tm_raw)) if tm_raw not in (None, "") else 0
    except Exception:
        term_months = 0

    if comm and exp and term_months <= 0:
        term_months = max(0, _month_diff(comm, exp))
        logs.append({"action": "derive", "field": "term.term_months", "reason": "from dates"})

    if comm and term_months > 0 and not exp:
        exp = _expiration_from_term_months(comm, term_months)
        term["expiration_date"] = exp.isoformat()
        logs.append({"action": "derive", "field": "term.expiration_date", "reason": "from commencement + term"})

    if exp and term_months > 0 and not comm:
        comm = _commencement_from_term_months(exp, term_months)
        term["commencement_date"] = comm.isoformat()
        logs.append({"action": "derive", "field": "term.commencement_date", "reason": "from expiration - term"})

    if term_months <= 0 and extraction.get("rent_steps"):
        try:
            term_months = max(0, max(int(s.get("end_month") or 0) for s in (extraction.get("rent_steps") or [])) + 1)
            logs.append({"action": "derive", "field": "term.term_months", "reason": "from rent schedule"})
        except Exception:
            term_months = 0

    if term_months <= 0:
        degraded = True
        logs.append({"action": "fallback", "field": "term.term_months", "value": 0, "reason": "unable to derive term"})

    term["term_months"] = int(term_months)
    if comm and "commencement_date" not in term:
        term["commencement_date"] = comm.isoformat()
    if exp and "expiration_date" not in term:
        term["expiration_date"] = exp.isoformat()

    repaired_steps = _repair_rent_schedule(list(extraction.get("rent_steps") or []), int(term_months))
    if repaired_steps != list(extraction.get("rent_steps") or []):
        logs.append({"action": "repair", "field": "rent_steps", "reason": "contiguous coverage normalized"})
    extraction["rent_steps"] = repaired_steps

    if premises.get("rsf") in (None, ""):
        premises["rsf"] = 0.0
        degraded = True
        logs.append({"action": "fallback", "field": "premises.rsf", "value": 0.0, "reason": "missing"})

    cues_text = " ".join(str(e.get("snippet") or "") for e in (extraction.get("evidence") or [])).lower()
    mode = str(opex.get("mode") or "").strip().lower().replace("-", "_").replace(" ", "_")
    if mode not in {"nnn", "base_year", "full_service"}:
        if any(k in cues_text for k in ("base year", "expense stop", "modified gross", "gross with stop")):
            mode = "base_year"
        elif any(k in cues_text for k in ("full service", "full-service", "gross rent", "gross lease")):
            mode = "full_service"
        elif any(k in cues_text for k in ("nnn", "triple net", "cam", "additional rent")):
            mode = "nnn"
        else:
            mode = "nnn"
            degraded = True
        logs.append({"action": "derive", "field": "opex.mode", "value": mode, "reason": "from cues/default"})
    opex["mode"] = mode

    base = opex.get("base_psf_year_1")
    try:
        base_val = None if base in (None, "") else float(base)
    except Exception:
        base_val = None

    if mode == "full_service" and base_val is None:
        opex["base_psf_year_1"] = 0.0
        logs.append({"action": "derive", "field": "opex.base_psf_year_1", "value": 0.0, "reason": "full service includes expenses"})
    elif mode in {"nnn", "base_year"} and base_val is None:
        candidates: list[float] = []
        for ev in extraction.get("evidence") or []:
            snippet = str(ev.get("snippet") or "")
            if not any(tok in snippet.lower() for tok in ("opex", "operating expense", "cam", "base year", "expense stop")):
                continue
            import re

            m = re.search(r"\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:/\s*sf|psf)", snippet, flags=re.IGNORECASE)
            if m:
                try:
                    candidates.append(float(m.group(1)))
                except Exception:
                    continue
        if candidates:
            opex["base_psf_year_1"] = max(0.0, float(sorted(candidates)[0]))
            logs.append({"action": "derive", "field": "opex.base_psf_year_1", "reason": "from opex snippets"})
        else:
            opex["base_psf_year_1"] = 0.0
            degraded = True
            logs.append({"action": "fallback", "field": "opex.base_psf_year_1", "value": 0.0, "reason": "missing"})

    if opex.get("growth_rate") in (None, ""):
        opex["growth_rate"] = 0.03
        logs.append({"action": "derive", "field": "opex.growth_rate", "value": 0.03, "reason": "default"})

    extraction["abatements"] = list(extraction.get("abatements") or [])
    extraction["auto_qa"] = {
        "solver": solver_debug or {},
        "normalization_log": logs,
    }
    extraction["extraction_quality"] = "degraded" if degraded else "standard"
    return extraction


def _canonical_opex_mode(canonical: CanonicalLease) -> str:
    lease_type = str(canonical.lease_type.value if hasattr(canonical.lease_type, "value") else canonical.lease_type).strip().lower()
    expense_type = str(
        canonical.expense_structure_type.value
        if hasattr(canonical.expense_structure_type, "value")
        else canonical.expense_structure_type
    ).strip().lower()
    if expense_type in {"base_year", "gross_with_stop"} or any(k in lease_type for k in ("modified gross", "base year", "expense stop")):
        return "base_year"
    if any(k in lease_type for k in ("full service", "gross")) and "modified" not in lease_type:
        return "full_service"
    return "nnn"


def _flatten_evidence(provenance: dict[str, list[dict[str, Any]]], extra: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[Any, ...]] = set()
    out: list[dict[str, Any]] = []
    for items in provenance.values():
        for e in items:
            key = (e.get("page"), e.get("snippet"), e.get("source"))
            if key in seen:
                continue
            seen.add(key)
            out.append(e)
    for e in extra:
        key = (e.get("page"), e.get("snippet"), e.get("source"))
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out[:200]


def _apply_canonical_fallback(extraction: dict[str, Any], canonical: CanonicalLease | None, provenance: dict[str, list[dict[str, Any]]]) -> None:
    if canonical is None:
        return

    term = extraction.setdefault("term", {})
    premises = extraction.setdefault("premises", {})
    opex = extraction.setdefault("opex", {})
    abatement_analysis = extraction.setdefault("abatement_analysis", {})

    fallback_map = {
        "term.commencement_date": ("commencement_date", str(canonical.commencement_date)),
        "term.expiration_date": ("expiration_date", str(canonical.expiration_date)),
        "term.term_months": ("term_months", int(canonical.term_months)),
        "premises.building_name": ("building_name", canonical.building_name),
        "premises.suite": ("suite", canonical.suite),
        "premises.floor": ("floor", canonical.floor),
        "premises.address": ("address", canonical.address),
        "premises.rsf": ("rsf", float(canonical.rsf)),
        "opex.mode": ("mode", _canonical_opex_mode(canonical)),
        "opex.base_psf_year_1": ("base_psf_year_1", float(canonical.opex_psf_year_1)),
        "opex.growth_rate": ("growth_rate", float(canonical.opex_growth_rate)),
    }

    for field_path, (target_key, value) in fallback_map.items():
        section = field_path.split(".")[0]
        bucket = extraction[section]
        if bucket.get(target_key) in (None, "", 0, 0.0):
            if value in (None, "", 0, 0.0) and target_key not in {"term_months", "rsf"}:
                continue
            bucket[target_key] = value
            provenance.setdefault(field_path, []).insert(
                0,
                {
                    "page": None,
                    "snippet": "canonical normalizer fallback",
                    "bbox": None,
                    "source": "canonical_normalizer",
                    "source_confidence": 0.9,
                },
            )

    if not extraction.get("rent_steps") and canonical.rent_schedule:
        extraction["rent_steps"] = [
            {
                "start_month": int(step.start_month),
                "end_month": int(step.end_month),
                "rate_psf_annual": float(step.rent_psf_annual),
                "source": "canonical_normalizer",
                "source_confidence": 0.9,
            }
            for step in canonical.rent_schedule
        ]
        provenance["rent_steps"] = [
            {
                "page": None,
                "snippet": "canonical rent schedule fallback",
                "bbox": None,
                "source": "canonical_normalizer",
                "source_confidence": 0.9,
            }
        ]

    if not extraction.get("abatements") and canonical.free_rent_periods:
        extraction["abatements"] = [
            {
                "start_month": int(fr.start_month),
                "end_month": int(fr.end_month),
                "scope": "gross_rent" if str(canonical.free_rent_scope).lower().startswith("gross") else "base_rent_only",
                "source": "canonical_normalizer",
                "classification": "rent_abatement",
            }
            for fr in canonical.free_rent_periods
        ]

    if not abatement_analysis:
        has_phase_in = bool(getattr(canonical, "phase_in_schedule", None))
        has_abatement = bool(extraction.get("abatements"))
        classification = "none"
        if has_phase_in and has_abatement:
            classification = "mixed"
        elif has_phase_in:
            classification = "phase_in"
        elif has_abatement:
            classification = "rent_abatement"
        extraction["abatement_analysis"] = {
            "classification": classification,
            "phase_in_detected": has_phase_in,
            "phase_in_confidence": 0.9 if has_phase_in else 0.0,
            "scope": extraction["abatements"][0].get("scope") if has_abatement else None,
        }
        provenance.setdefault("abatement_analysis", []).insert(
            0,
            {
                "page": None,
                "snippet": "canonical abatement/phase-in fallback",
                "bbox": None,
                "source": "canonical_normalizer",
                "source_confidence": 0.9,
            },
        )


def _calc_source_quality(provenance: dict[str, list[dict[str, Any]]]) -> float:
    confs: list[float] = []
    for evidences in provenance.values():
        for e in evidences:
            try:
                confs.append(float(e.get("source_confidence") or 0.0))
            except Exception:
                continue
    if not confs:
        return 0.6
    return max(0.0, min(1.0, sum(confs) / len(confs)))


def run_extraction_pipeline(
    *,
    file_bytes: bytes,
    filename: str,
    content_type: str = "application/pdf",
    canonical_lease: CanonicalLease | None = None,
) -> dict[str, Any]:
    normalized = normalize_document(file_bytes, filename, content_type)

    if filename.lower().endswith(".pdf") and any(p.needs_ocr for p in normalized.pages):
        normalized = apply_ocr_fallback(normalized, file_bytes)

    tmp_pdf_path: str | None = None
    if filename.lower().endswith(".pdf"):
        with tempfile.NamedTemporaryFile(prefix="extract-", suffix=".pdf", delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_pdf_path = tmp.name

    try:
        rent_step_candidates, rent_row_review_tasks = extract_rent_step_candidates_with_review(normalized, file_path=tmp_pdf_path)
    finally:
        if tmp_pdf_path:
            try:
                Path(tmp_pdf_path).unlink(missing_ok=True)
            except Exception:
                pass

    regex_candidates = mine_candidates(normalized)
    snippets = retrieve_section_snippets(normalized)
    classification = classify_document(normalized)
    llm = structured_extract(snippets=snippets, table_candidates=rent_step_candidates, regex_candidates=regex_candidates)

    reconciled = reconcile(
        regex_candidates=regex_candidates,
        rent_step_candidates=rent_step_candidates,
        llm_output=llm,
        full_text=normalized.full_text,
    )
    resolved = reconciled.get("resolved") or {}
    provenance = reconciled.get("provenance") or {}
    reconcile_margin = float(reconciled.get("reconcile_margin") or 0.5)
    solver_debug = reconciled.get("solver_debug") if isinstance(reconciled.get("solver_debug"), dict) else {}
    solver_degraded = bool(reconciled.get("degraded"))

    extraction: dict[str, Any] = {
        "document": classification,
        "term": dict(resolved.get("term") or {}),
        "premises": dict(resolved.get("premises") or {}),
        "rent_steps": list(resolved.get("rent_steps") or []),
        "abatements": list(resolved.get("abatements") or []),
        "parking_abatements": list(resolved.get("parking_abatements") or []),
        "abatement_analysis": {
            "classification": "none",
            "phase_in_detected": False,
            "phase_in_confidence": 0.0,
            "scope": None,
            **dict(resolved.get("abatement_analysis") or {}),
        },
        "concessions": dict(resolved.get("concessions") or {}),
        "tenant_improvements": dict(resolved.get("tenant_improvements") or {}),
        "parking": dict(resolved.get("parking") or {}),
        "rights_options": dict(resolved.get("rights_options") or {}),
        "opex": dict(resolved.get("opex") or {}),
        "review_tasks": list((llm or {}).get("review_tasks") or []) + list(rent_row_review_tasks or []) + list(reconciled.get("review_tasks") or []),
        "provenance": provenance,
        "evidence": _flatten_evidence(
            provenance,
            (classification.get("evidence_spans") or [])
            + (snippets.get("rent_schedule") or [])
            + (snippets.get("term_dates") or [])
            + (snippets.get("operating_expenses") or []),
        ),
        "confidence": {
            "overall": 0.5,
            "status": "yellow",
            "export_allowed": True,
        },
        "export_allowed": True,
    }

    _apply_canonical_fallback(extraction, canonical_lease, provenance)

    extraction = _finalize_extraction(
        extraction,
        solver_debug=solver_debug,
        solver_degraded=solver_degraded,
    )

    extraction = validate_extraction(
        extraction,
        source_quality=_calc_source_quality(provenance),
        reconcile_margin=reconcile_margin,
    )

    valid, errors = validate_canonical_extraction(extraction)
    if not valid:
        extraction.setdefault("review_tasks", []).append(
            {
                "field_path": "schema",
                "severity": "blocker",
                "issue_code": "SCHEMA_INVALID",
                "message": "Canonical extraction JSON failed schema validation.",
                "candidates": [],
                "recommended_value": None,
                "evidence": [{"source": "schema", "source_confidence": 1.0, "snippet": "; ".join(errors[:3]), "page": None, "bbox": None}],
            }
        )
        extraction["confidence"] = {
            "overall": 0.0,
            "status": "red",
            "export_allowed": False,
            "validation_pass_rate": 0.0,
            "reconcile_margin": reconcile_margin,
        }
        extraction["export_allowed"] = False

    return extraction
