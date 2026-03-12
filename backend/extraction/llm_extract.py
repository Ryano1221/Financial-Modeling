from __future__ import annotations

import json
import os
from typing import Any

from .schema import CANONICAL_EXTRACTION_SCHEMA

MODEL = os.environ.get("OPENAI_EXTRACTION_MODEL", "gpt-4.1-mini")


def _build_grounded_prompt(snippets: dict[str, list[dict[str, Any]]], table_candidates: list[dict[str, Any]], regex_candidates: dict[str, list[dict[str, Any]]]) -> str:
    payload = {
        "snippets": snippets,
        "table_candidates": table_candidates,
        "regex_candidates": regex_candidates,
        "instructions": [
            "Use only the provided evidence.",
            "Set uncertain fields to null.",
            "Create review_tasks for ambiguity instead of guessing.",
        ],
    }
    return json.dumps(payload, ensure_ascii=True)


def structured_extract(snippets: dict[str, list[dict[str, Any]]], table_candidates: list[dict[str, Any]], regex_candidates: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key:
        return None

    try:
        from openai import OpenAI  # type: ignore
    except Exception:
        return None

    client = OpenAI(api_key=api_key)
    grounded = _build_grounded_prompt(snippets, table_candidates, regex_candidates)

    schema = {
        "type": "object",
        "properties": {
            "term": {"type": "object"},
            "premises": {"type": "object"},
            "rent_steps": {"type": "array", "items": {"type": "object"}},
            "abatements": {"type": "array", "items": {"type": "object"}},
            "concessions": {"type": "object"},
            "tenant_improvements": {"type": "object"},
            "parking": {"type": "object"},
            "rights_options": {"type": "object"},
            "opex": {"type": "object"},
            "review_tasks": {"type": "array", "items": {"type": "object"}},
        },
        "required": ["term", "premises", "rent_steps", "abatements", "concessions", "tenant_improvements", "parking", "rights_options", "opex", "review_tasks"],
        "additionalProperties": False,
    }

    try:
        response = client.responses.create(
            model=MODEL,
            input=[
                {
                    "role": "system",
                    "content": (
                        "You extract commercial lease fields strictly from evidence. "
                        "Never infer unsupported values; use null + review_tasks."
                    ),
                },
                {"role": "user", "content": grounded},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "lease_extract",
                    "schema": schema,
                    "strict": True,
                }
            },
        )
    except Exception:
        return None

    text = ""
    try:
        text = response.output_text or ""
    except Exception:
        pass
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except Exception:
        return None

    if not isinstance(parsed, dict):
        return None
    return parsed


def arbitration_decision(field: str, candidates: list[dict[str, Any]], margin: float) -> dict[str, Any] | None:
    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key or margin >= 0.05 or len(candidates) < 2:
        return None
    try:
        from openai import OpenAI  # type: ignore
    except Exception:
        return None

    client = OpenAI(api_key=api_key)
    prompt = {
        "field": field,
        "candidates": candidates,
        "instructions": "Pick one only if evidence strongly supports it; else needs_review=true.",
    }

    try:
        resp = client.responses.create(
            model=MODEL,
            input=[
                {"role": "system", "content": "You arbitrate extraction conflicts."},
                {"role": "user", "content": json.dumps(prompt)},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "arbitration",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "needs_review": {"type": "boolean"},
                            "chosen_value": {},
                            "reason": {"type": "string"},
                        },
                        "required": ["needs_review", "reason"],
                        "additionalProperties": False,
                    },
                    "strict": True,
                }
            },
        )
        parsed = json.loads(resp.output_text or "")
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None
