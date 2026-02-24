from __future__ import annotations

import tempfile
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
from .tables import extract_rent_step_candidates
from .validate import validate_extraction


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
        rent_step_candidates = extract_rent_step_candidates(normalized, file_path=tmp_pdf_path)
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

    reconciled = reconcile(regex_candidates=regex_candidates, rent_step_candidates=rent_step_candidates, llm_output=llm)
    resolved = reconciled.get("resolved") or {}
    provenance = reconciled.get("provenance") or {}
    reconcile_margin = float(reconciled.get("reconcile_margin") or 0.5)

    extraction: dict[str, Any] = {
        "document": classification,
        "term": dict(resolved.get("term") or {}),
        "premises": dict(resolved.get("premises") or {}),
        "rent_steps": list(resolved.get("rent_steps") or []),
        "abatements": list(resolved.get("abatements") or []),
        "abatement_analysis": {
            "classification": "none",
            "phase_in_detected": False,
            "phase_in_confidence": 0.0,
            "scope": None,
            **dict(resolved.get("abatement_analysis") or {}),
        },
        "opex": dict(resolved.get("opex") or {}),
        "review_tasks": list((llm or {}).get("review_tasks") or []),
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
