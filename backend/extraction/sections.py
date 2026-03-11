from __future__ import annotations

from collections import defaultdict
from typing import Any

from .normalize import NormalizedDocument

TOPIC_KEYWORDS = {
    "rent_schedule": ["rent schedule", "base rent", "lease year", "annual rent", "$/sf"],
    "term_dates": ["commencement", "expiration", "term", "lease term", "rent commencement"],
    "abatement": ["free rent", "abatement", "rent concession"],
    "operating_expenses": [
        "opex",
        "operating expenses",
        "nnn",
        "triple net",
        "base year",
        "expense stop",
        "gross with stop",
        "modified gross",
        "full service",
        "full service gross",
        "gross lease",
    ],
}


def retrieve_section_snippets(normalized: NormalizedDocument, min_per_topic: int = 3, max_per_topic: int = 10) -> dict[str, list[dict[str, Any]]]:
    by_topic: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for page in normalized.pages:
        lines = [ln.strip() for ln in (page.text or "").splitlines() if ln.strip()]
        for line in lines:
            lower = line.lower()
            for topic, keywords in TOPIC_KEYWORDS.items():
                score = sum(1 for k in keywords if k in lower)
                if score <= 0:
                    continue
                by_topic[topic].append(
                    {
                        "page": page.page_number,
                        "snippet": line[:500],
                        "bbox": None,
                        "source": "section_retriever",
                        "source_confidence": min(0.9, 0.45 + (score * 0.12)),
                        "score": score,
                    }
                )

    # Clip ranges.
    result: dict[str, list[dict[str, Any]]] = {}
    for topic, items in by_topic.items():
        ranked = sorted(items, key=lambda x: (x.get("score", 0), x.get("source_confidence", 0)), reverse=True)
        target_count = min(max_per_topic, max(min_per_topic, len(ranked)))
        result[topic] = ranked[:target_count]
    for topic in TOPIC_KEYWORDS:
        result.setdefault(topic, [])
    return result
