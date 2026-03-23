from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import re
from typing import Any

from extraction.normalize import NormalizedDocument, PageData
from extraction.regex import mine_candidates
from extraction.reconcile import reconcile

from .corpus import HardeningCase, SyntheticDocument

_OVERRIDE_CUES = (
    "hereby amended",
    "superseded",
    "replaced",
    "deleted and replaced",
    "notwithstanding",
    "controlling replacement",
    "amended and restated",
)

_ROLE_WEIGHT = {
    "base_lease": 0.20,
    "primary": 0.25,
    "override": 0.65,
    "amendment": 0.65,
    "counter": 0.62,
    "redline": 0.63,
}


@dataclass(frozen=True)
class ResolvedCase:
    case_id: str
    family: str
    extraction: dict[str, Any]
    predicted: dict[str, Any]
    controlling_trace: dict[str, list[dict[str, Any]]]


def _parse_date(value: str | None) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m.%d.%Y", "%m-%d-%Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except Exception:
            continue
    return None


def _doc_rank(doc: SyntheticDocument, position: int) -> float:
    role_key = str(doc.role or "").strip().lower()
    family_key = str(doc.family or "").strip().lower()
    role_boost = _ROLE_WEIGHT.get(role_key, _ROLE_WEIGHT.get(family_key, 0.25))
    as_of = _parse_date(doc.as_of_date)
    date_boost = 0.0
    if as_of:
        date_boost = min(0.2, max(0.0, (as_of.year - 2024) * 0.01))
    return role_boost + date_boost + (position * 0.01)


def _normalize_text_document(doc: SyntheticDocument, position: int) -> NormalizedDocument:
    return NormalizedDocument(
        sha256=f"synthetic-{doc.doc_id}-{position}",
        filename=f"{doc.doc_id}.txt",
        content_type="text/plain",
        pages=[PageData(page_number=1, text=doc.text, words=[], table_regions=[], needs_ocr=False)],
        full_text=doc.text,
    )


def _override_adjustment(snippet: str) -> float:
    low = (snippet or "").lower()
    if any(cue in low for cue in _OVERRIDE_CUES):
        return 0.14
    if "whereas" in low and "scheduled to expire" in low:
        return -0.10
    if "stricken" in low and "replacement" not in low:
        return -0.20
    return 0.0


def _merge_stack_candidates(case: HardeningCase) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    merged: dict[str, list[dict[str, Any]]] = {}
    rent_steps: list[dict[str, Any]] = []
    ranked_docs: list[tuple[float, int, SyntheticDocument]] = []

    for pos, doc in enumerate(case.documents):
        ranked_docs.append((_doc_rank(doc, pos), pos, doc))

    primary_rent_doc: SyntheticDocument | None = None
    for _rank, _pos, doc in sorted(ranked_docs, key=lambda row: (-row[0], row[1])):
        if doc.rent_steps:
            primary_rent_doc = doc
            break

    for rank, pos, doc in ranked_docs:
        normalized = _normalize_text_document(doc, pos)
        candidates = mine_candidates(normalized)

        for field, items in candidates.items():
            bucket = merged.setdefault(field, [])
            for item in items or []:
                if not isinstance(item, dict):
                    continue
                enriched = dict(item)
                base_conf = float(enriched.get("source_confidence") or 0.55)
                adj = _override_adjustment(str(enriched.get("snippet") or ""))
                confidence = max(0.01, min(0.99, base_conf + (rank * 0.35) + adj))
                enriched["source_confidence"] = confidence
                enriched["source"] = f"stack::{doc.doc_id}::{doc.role}::{enriched.get('source') or 'regex'}"
                enriched["snippet"] = f"[{doc.doc_id}|{doc.role}] {str(enriched.get('snippet') or '')}"
                bucket.append(enriched)

        if primary_rent_doc is None or doc.doc_id != primary_rent_doc.doc_id:
            continue

        for step in doc.rent_steps:
            if not isinstance(step, dict):
                continue
            rent_steps.append(
                {
                    "start_month": int(step.get("start_month") or 0),
                    "end_month": int(step.get("end_month") or 0),
                    "rate_psf_annual": float(step.get("rate_psf_annual") or 0.0),
                    "source": f"stack::{doc.doc_id}::{doc.role}::table_parser",
                    "source_confidence": max(0.1, min(0.99, 0.55 + (rank * 0.35))),
                    "snippet": f"[{doc.doc_id}|{doc.role}] rent step",
                    "page": 1,
                    "bbox": None,
                }
            )

    return merged, rent_steps


def _first_rate(resolved: dict[str, Any]) -> float | None:
    steps = list(resolved.get("rent_steps") or [])
    if not steps:
        return None
    first = sorted(steps, key=lambda s: int(s.get("start_month") or 0))[0]
    try:
        return float(first.get("rate_psf_annual"))
    except Exception:
        return None


def _extract_predicted(extraction: dict[str, Any]) -> dict[str, Any]:
    resolved = extraction.get("resolved") or {}
    term = resolved.get("term") or {}
    premises = resolved.get("premises") or {}
    opex = resolved.get("opex") or {}
    return {
        "commencement_date": term.get("commencement_date"),
        "expiration_date": term.get("expiration_date"),
        "term_months": int(term.get("term_months") or 0),
        "rsf": float(premises.get("rsf") or 0.0),
        "suite": premises.get("suite"),
        "base_rent_psf": _first_rate(resolved),
        "op_ex_psf": None if opex.get("base_psf_year_1") in (None, "") else float(opex.get("base_psf_year_1") or 0.0),
    }


def _build_trace(extraction: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    provenance = extraction.get("provenance") or {}
    trace: dict[str, list[dict[str, Any]]] = {}

    for field, evidences in provenance.items():
        rows: list[dict[str, Any]] = []
        for ev in evidences or []:
            source = str(ev.get("source") or "")
            doc_id = None
            role = None
            if source.startswith("stack::"):
                parts = source.split("::")
                if len(parts) >= 3:
                    doc_id = parts[1]
                    role = parts[2]
            rows.append(
                {
                    "doc_id": doc_id,
                    "role": role,
                    "source": source,
                    "confidence": float(ev.get("source_confidence") or 0.0),
                    "snippet": str(ev.get("snippet") or "")[:220],
                }
            )
        trace[field] = rows

    return trace


def resolve_case(case: HardeningCase) -> ResolvedCase:
    merged, rent_steps = _merge_stack_candidates(case)
    extraction = reconcile(regex_candidates=merged, rent_step_candidates=rent_steps, llm_output=None)
    predicted = _extract_predicted(extraction)
    trace = _build_trace(extraction)
    return ResolvedCase(
        case_id=case.case_id,
        family=case.family,
        extraction=extraction,
        predicted=predicted,
        controlling_trace=trace,
    )


def resolve_cases(cases: list[HardeningCase]) -> list[ResolvedCase]:
    return [resolve_case(case) for case in cases]


def trace_contains_override(trace: dict[str, list[dict[str, Any]]], field: str) -> bool:
    for row in trace.get(field, []):
        role = str(row.get("role") or "")
        snippet = str(row.get("snippet") or "").lower()
        if role in {"override", "amendment", "counter", "redline"}:
            return True
        if any(cue in snippet for cue in _OVERRIDE_CUES):
            return True
    return False


def normalize_suite_token(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    m = re.search(r"(?i)(?:suite|ste\.?|unit)\s*([a-z0-9\-, ]+)", raw)
    if m:
        raw = m.group(1).strip()
    if re.search(r"(?i),\s*[A-Za-z .'-]{2,40},\s*(?:[A-Z]{2}|[A-Za-z]{4,})(?:\s+\d{5}(?:-\d{4})?)?\b", raw):
        raw = raw.split(",", 1)[0].strip()
    token_match = re.match(r"(?i)^([A-Za-z0-9][A-Za-z0-9\-]{0,14})", raw)
    if not token_match:
        return None
    token = token_match.group(1)
    return token.upper() if not token.isdigit() else (token.lstrip("0") or token)
