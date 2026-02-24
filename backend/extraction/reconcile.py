from __future__ import annotations

from collections import defaultdict
from typing import Any

from .llm_extract import arbitration_decision

SOURCE_WEIGHTS = {
    "table_parser": 0.40,
    "pdf_text_regex": 0.25,
    "ocr_regex": 0.15,
    "llm": 0.20,
    "pdfplumber_table": 0.40,
    "text_line_regex": 0.22,
    "textract_table": 0.55,
}


def _source_weight(source: str) -> float:
    src = (source or "").lower()
    for key, weight in SOURCE_WEIGHTS.items():
        if key in src:
            return weight
    return 0.2


def _score_candidate(candidate: dict[str, Any], validation_penalty: float = 0.0) -> float:
    conf = float(candidate.get("source_confidence") or 0.0)
    source = str(candidate.get("source") or "")
    snippet = str(candidate.get("snippet") or "").lower()
    score = (_source_weight(source) * 0.6) + (conf * 0.4)
    if any(
        k in snippet
        for k in [
            "exhibit",
            "schedule",
            "base rent",
            "operating expenses",
            "nnn",
            "triple net",
            "base year",
            "expense stop",
            "full service",
            "gross lease",
        ]
    ):
        score += 0.10
    if any(k in snippet for k in ["page ", "footer", "header", "confidential"]):
        score -= 0.10
    score -= max(0.0, validation_penalty)
    return max(0.0, min(1.0, score))


def _merge_field_candidates(field: str, candidates: list[dict[str, Any]]) -> tuple[Any, float, list[dict[str, Any]], float]:
    if not candidates:
        return None, 0.0, [], 0.0

    scored = sorted(
        [{**c, "_score": _score_candidate(c)} for c in candidates],
        key=lambda x: float(x.get("_score") or 0.0),
        reverse=True,
    )
    top = scored[0]
    top_score = float(top.get("_score") or 0.0)
    runner = scored[1] if len(scored) > 1 else None
    margin = top_score - float((runner or {}).get("_score") or 0.0)

    # Arbitration only when margin is low and values conflict.
    if runner and margin < 0.05 and top.get("value") != runner.get("value"):
        arb = arbitration_decision(field, scored[:2], margin)
        if arb and not arb.get("needs_review") and "chosen_value" in arb:
            chosen_value = arb.get("chosen_value")
            evidence = [c for c in scored if c.get("value") == chosen_value] or scored[:2]
            return chosen_value, top_score, evidence, margin

    return top.get("value"), top_score, scored[:4], margin


def reconcile(
    regex_candidates: dict[str, list[dict[str, Any]]],
    rent_step_candidates: list[dict[str, Any]],
    llm_output: dict[str, Any] | None,
) -> dict[str, Any]:
    by_field: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for field, items in (regex_candidates or {}).items():
        for item in items or []:
            by_field[field].append(item)

    # Rent steps are dedicated field.
    for step in rent_step_candidates or []:
        by_field["rent_steps"].append(
            {
                "field": "rent_steps",
                "value": {
                    "start_month": int(step.get("start_month") or 0),
                    "end_month": int(step.get("end_month") or 0),
                    "rate_psf_annual": float(step.get("rate_psf_annual") or 0.0),
                },
                "page": step.get("page"),
                "snippet": step.get("snippet"),
                "bbox": step.get("bbox"),
                "source": str(step.get("source") or "table_parser"),
                "source_confidence": float(step.get("source_confidence") or 0.7),
            }
        )

    if isinstance(llm_output, dict):
        for fld in [
            "term",
            "premises",
            "rent_steps",
            "abatements",
            "opex",
        ]:
            if fld in llm_output:
                by_field[fld].append(
                    {
                        "field": fld,
                        "value": llm_output.get(fld),
                        "page": None,
                        "snippet": "llm_structured_output",
                        "bbox": None,
                        "source": "llm",
                        "source_confidence": 0.6,
                    }
                )

    resolved: dict[str, Any] = {
        "term": {},
        "premises": {},
        "rent_steps": [],
        "abatements": [],
        "abatement_analysis": {},
        "opex": {},
    }
    provenance: dict[str, list[dict[str, Any]]] = defaultdict(list)
    reconcile_margin = 1.0

    # field-by-field reconciliation
    field_mapping = {
        "commencement_date": ("term", "commencement_date"),
        "expiration_date": ("term", "expiration_date"),
        "rent_commencement_date": ("term", "rent_commencement_date"),
        "term_months": ("term", "term_months"),
        "building_name": ("premises", "building_name"),
        "suite": ("premises", "suite"),
        "floor": ("premises", "floor"),
        "address": ("premises", "address"),
        "rsf": ("premises", "rsf"),
        "opex_mode": ("opex", "mode"),
        "opex_psf_year_1": ("opex", "base_psf_year_1"),
        "opex_growth_rate": ("opex", "growth_rate"),
    }

    for field, target in field_mapping.items():
        value, _score, evidence, margin = _merge_field_candidates(field, by_field.get(field, []))
        reconcile_margin = min(reconcile_margin, margin if margin > 0 else reconcile_margin)
        if value is not None:
            resolved[target[0]][target[1]] = value
        if evidence:
            provenance[f"{target[0]}.{target[1]}"] = [
                {
                    "page": e.get("page"),
                    "snippet": e.get("snippet"),
                    "bbox": e.get("bbox"),
                    "source": e.get("source"),
                    "source_confidence": float(e.get("source_confidence") or 0),
                }
                for e in evidence
            ]

    # Rent steps: keep merged sorted candidates.
    rent_steps = [c.get("value") for c in by_field.get("rent_steps", []) if isinstance(c.get("value"), dict)]
    dedup: dict[tuple[int, int, float], dict[str, Any]] = {}
    for rs in rent_steps:
        key = (int(rs.get("start_month") or 0), int(rs.get("end_month") or 0), round(float(rs.get("rate_psf_annual") or 0.0), 4))
        dedup[key] = rs
    resolved["rent_steps"] = [dedup[k] for k in sorted(dedup)]
    provenance["rent_steps"] = [
        {
            "page": c.get("page"),
            "snippet": c.get("snippet"),
            "bbox": c.get("bbox"),
            "source": c.get("source"),
            "source_confidence": float(c.get("source_confidence") or 0.0),
        }
        for c in by_field.get("rent_steps", [])[:20]
    ]

    # Abatement scope chosen from regex when present.
    abatement_cands = by_field.get("abatement_scope", [])
    abatement_val, _, abatement_ev, margin = _merge_field_candidates("abatement_scope", abatement_cands)
    reconcile_margin = min(reconcile_margin, margin if margin > 0 else reconcile_margin)
    if abatement_val:
        resolved["abatements"] = [{"scope": abatement_val, "classification": "rent_abatement"}]
        provenance["abatements"] = [
            {
                "page": e.get("page"),
                "snippet": e.get("snippet"),
                "bbox": e.get("bbox"),
                "source": e.get("source"),
                "source_confidence": float(e.get("source_confidence") or 0.0),
            }
            for e in abatement_ev
        ]

    classification_cands = by_field.get("abatement_classification", [])
    phase_in_cands = by_field.get("phase_in_detected", [])
    class_val, class_score, class_ev, class_margin = _merge_field_candidates(
        "abatement_classification", classification_cands
    )
    phase_val, phase_score, phase_ev, phase_margin = _merge_field_candidates("phase_in_detected", phase_in_cands)
    if class_margin > 0:
        reconcile_margin = min(reconcile_margin, class_margin)
    if phase_margin > 0:
        reconcile_margin = min(reconcile_margin, phase_margin)

    phase_detected = bool(phase_val) or any(
        str(c.get("value") or "").strip().lower() == "phase_in" for c in classification_cands
    )
    normalized_class = str(class_val or "").strip().lower()
    if not normalized_class:
        if phase_detected and not resolved["abatements"]:
            normalized_class = "phase_in"
        elif resolved["abatements"]:
            normalized_class = "rent_abatement"
        else:
            normalized_class = "none"
    elif normalized_class == "rent_abatement" and phase_detected:
        normalized_class = "mixed"

    resolved["abatement_analysis"] = {
        "classification": normalized_class,
        "phase_in_detected": phase_detected,
        "phase_in_confidence": round(max(phase_score, class_score if normalized_class in {"phase_in", "mixed"} else 0.0), 4),
        "scope": (resolved["abatements"][0].get("scope") if resolved["abatements"] else None),
    }
    analysis_evidence = []
    for e in (class_ev + phase_ev)[:8]:
        analysis_evidence.append(
            {
                "page": e.get("page"),
                "snippet": e.get("snippet"),
                "bbox": e.get("bbox"),
                "source": e.get("source"),
                "source_confidence": float(e.get("source_confidence") or 0.0),
            }
        )
    if analysis_evidence:
        provenance["abatement_analysis"] = analysis_evidence

    # Merge in llm object values only when unresolved.
    if isinstance(llm_output, dict):
        if not resolved["term"] and isinstance(llm_output.get("term"), dict):
            resolved["term"] = dict(llm_output.get("term") or {})
        if not resolved["premises"] and isinstance(llm_output.get("premises"), dict):
            resolved["premises"] = dict(llm_output.get("premises") or {})
        if not resolved["rent_steps"] and isinstance(llm_output.get("rent_steps"), list):
            resolved["rent_steps"] = list(llm_output.get("rent_steps") or [])
        if not resolved["abatements"] and isinstance(llm_output.get("abatements"), list):
            resolved["abatements"] = list(llm_output.get("abatements") or [])
            resolved["abatement_analysis"]["scope"] = (
                resolved["abatements"][0].get("scope") if resolved["abatements"] else None
            )
        if not resolved["opex"] and isinstance(llm_output.get("opex"), dict):
            resolved["opex"] = dict(llm_output.get("opex") or {})

    return {
        "resolved": resolved,
        "provenance": dict(provenance),
        "reconcile_margin": max(0.0, min(1.0, reconcile_margin)),
    }
