from __future__ import annotations

from collections import defaultdict
from typing import Any

from .normalize import NormalizedDocument

TOPIC_KEYWORDS = {
    "rent_schedule": [
        "rent schedule", "base rent", "lease year", "annual rent", "$/sf",
        "escalation", "step rent", "rental rate", "rent per", "per rentable",
        "per square foot", "/rsf", "year 1", "year 2", "year 3",
        "annual escalation", "rent increase", "rent step", "monthly rent",
        "base rental", "annual base rent", "base rent shall", "rent commencing",
        "annual rate", "rent commencement", "psf", "per rsf",
    ],
    "term_dates": [
        "commencement", "expiration", "term", "lease term", "rent commencement",
        "initial term", "start date", "end date", "lease commencement date",
        "term commencement", "effective date", "lease end", "lease start",
        "term of lease", "lease period", "lease expires", "lease commences",
        "commencement date", "expiration date", "term of",
    ],
    "abatement": [
        "free rent", "abatement", "rent concession",
        "free rent period", "rent free", "no rent", "waived", "abated",
        "rent abatement", "abatement period", "rental concession",
        "months free", "rent waiver", "gross rent abatement",
        "free of rent", "abate", "rent shall be abated",
    ],
    "operating_expenses": [
        "opex", "operating expenses", "nnn", "triple net",
        "base year", "expense stop", "gross with stop", "modified gross",
        "full service", "full service gross", "gross lease",
        "cam", "common area maintenance", "real estate taxes", "property taxes",
        "landlord's costs", "insurance", "controllable expenses",
        "operating cost", "additional rent", "triple-net", "n.n.n",
        "expense reconciliation", "operating expense pass",
    ],
    "premises": [
        "rentable square feet", "rsf", "suite", "floor", "premises",
        "rentable area", "leased premises", "office space",
        "square feet", "building", "address", "located at",
        "rentable square", "demised premises", "the premises",
    ],
}

# Lines around a match to include for context (before and after).
_CONTEXT_LINES = 2


def retrieve_section_snippets(
    normalized: NormalizedDocument,
    min_per_topic: int = 3,
    max_per_topic: int = 10,
) -> dict[str, list[dict[str, Any]]]:
    by_topic: dict[str, list[dict[str, Any]]] = defaultdict(list)
    seen_snippets: dict[str, set[str]] = {t: set() for t in TOPIC_KEYWORDS}

    for page in normalized.pages:
        lines = [ln.strip() for ln in (page.text or "").splitlines() if ln.strip()]
        for i, line in enumerate(lines):
            lower = line.lower()
            for topic, keywords in TOPIC_KEYWORDS.items():
                score = sum(1 for k in keywords if k in lower)
                if score <= 0:
                    continue

                # Build a context window: ±_CONTEXT_LINES around the matching line.
                start = max(0, i - _CONTEXT_LINES)
                end = min(len(lines), i + _CONTEXT_LINES + 1)
                snippet = " | ".join(lines[start:end])[:600]

                # Deduplicate by snippet text within topic.
                if snippet in seen_snippets[topic]:
                    continue
                seen_snippets[topic].add(snippet)

                by_topic[topic].append(
                    {
                        "page": page.page_number,
                        "snippet": snippet,
                        "bbox": None,
                        "source": "section_retriever",
                        "source_confidence": min(0.92, 0.50 + (score * 0.10)),
                        "score": score,
                    }
                )

    result: dict[str, list[dict[str, Any]]] = {}
    for topic, items in by_topic.items():
        ranked = sorted(
            items,
            key=lambda x: (x.get("score", 0), x.get("source_confidence", 0)),
            reverse=True,
        )
        target_count = min(max_per_topic, max(min_per_topic, len(ranked)))
        result[topic] = ranked[:target_count]
    for topic in TOPIC_KEYWORDS:
        result.setdefault(topic, [])
    return result
