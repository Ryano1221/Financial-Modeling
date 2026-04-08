from __future__ import annotations

from typing import Any

from .normalize import NormalizedDocument

_DOC_RULES: list[tuple[str, tuple[str, ...], float]] = [
    ("proposal", ("revised office lease proposal", "office lease proposal", "lease proposal", "proposal presented to"), 0.88),
    ("floorplan", ("floor plan", "floorplan", "stacking plan", "test fit"), 0.89),
    ("flyer", ("marketing flyer", "marketing brochure", "property flyer", "availabilities"), 0.84),
    ("counter_proposal", ("counter proposal", "counteroffer", "counter-offer"), 0.86),
    ("loi", ("letter of intent", "loi"), 0.85),
    ("amendment", ("amendment", "first amendment", "second amendment"), 0.84),
    ("renewal", ("renewal", "extension option"), 0.78),
    ("subsublease", ("sub-sublease", "subsublease"), 0.87),
    ("sublease", ("sublease", "subtenant", "sublandlord"), 0.85),
    ("rfp", ("request for proposal", "request for proposals", "rfp"), 0.83),
    ("term_sheet", ("term sheet",), 0.78),
    ("lease", ("lease agreement", "landlord", "tenant"), 0.74),
]

_ROLE_RULES: list[tuple[str, tuple[str, ...], float]] = [
    ("sublease", ("sublandlord", "subtenant"), 0.82),
    ("prime_lease", ("landlord", "tenant"), 0.72),
    ("amendment", ("amendment", "amends"), 0.76),
    ("proposal", ("proposal", "counter"), 0.78),
]


def optional_layoutlmv3_classify(_features: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """
    Optional hook for future LayoutLMv3 integration.
    Kept CPU-safe and disabled by default.
    """
    return None


def classify_document(normalized: NormalizedDocument) -> dict[str, Any]:
    first_pages_text = "\n".join((p.text or "") for p in normalized.pages[:3]).lower()
    proposal_like = (
        "proposal" in first_pages_text
        and (
            "lease term" in first_pages_text
            or "commencement date" in first_pages_text
            or "base rental rate" in first_pages_text
            or "base annual net rental rate" in first_pages_text
        )
    )
    sublease_strong = any(
        token in first_pages_text
        for token in (
            "sublease agreement",
            "sublease premises",
            "sublease term",
            "sublessor",
            "sublessee",
            "subtenant",
            "sublandlord",
        )
    )
    assignment_sublease_noise = any(
        token in first_pages_text
        for token in (
            "assignment / sublease",
            "assignment/sublease",
            "assignment and sublease",
            "assignment or sublease",
        )
    )

    doc_type = "unknown"
    doc_type_conf = 0.45
    doc_evidence: list[dict[str, Any]] = []

    for label, needles, conf in _DOC_RULES:
        if label == "sublease" and assignment_sublease_noise and not sublease_strong:
            continue
        for n in needles:
            if n in first_pages_text:
                if label == "floorplan" and n == "test fit" and proposal_like:
                    # Proposal/LOI docs often mention a test-fit exhibit; do not let that
                    # overwhelm the surrounding lease economics and misclassify the document.
                    continue
                doc_type = label
                doc_type_conf = conf
                doc_evidence.append(
                    {
                        "page": 1,
                        "snippet": f"keyword match: {n}",
                        "bbox": None,
                        "source": "rule_classifier",
                        "source_confidence": conf,
                    }
                )
                break
        if doc_type != "unknown":
            break

    doc_role = "unknown"
    role_conf = 0.45
    for label, needles, conf in _ROLE_RULES:
        if any(n in first_pages_text for n in needles):
            doc_role = label
            role_conf = conf
            doc_evidence.append(
                {
                    "page": 1,
                    "snippet": f"role cue: {', '.join(needles[:2])}",
                    "bbox": None,
                    "source": "rule_classifier",
                    "source_confidence": conf,
                }
            )
            break

    layout_hint = optional_layoutlmv3_classify(None)
    confidence = max(doc_type_conf, role_conf, float((layout_hint or {}).get("confidence") or 0.0))
    return {
        "doc_type": doc_type,
        "doc_role": doc_role,
        "confidence": round(confidence, 4),
        "evidence_spans": doc_evidence[:6],
    }
