from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from .schema import CANONICAL_EXTRACTION_SCHEMA

MODEL = os.environ.get("OPENAI_EXTRACTION_MODEL", "gpt-4.1-mini")

_LOG = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are a commercial real estate lease abstraction specialist. "
    "Extract lease fields STRICTLY from the provided evidence (snippets, table_candidates, regex_candidates). "
    "Rules:\n"
    "- Set any field to null when it is not clearly present in the evidence. Never guess.\n"
    "- rent_steps: each step needs start_month (0-indexed integer, month 0 = lease month 1), "
    "end_month (0-indexed integer, inclusive), and rate_psf_annual (annual $/sf as a decimal number). "
    "Steps must be contiguous and non-overlapping.\n"
    "- term dates: use YYYY-MM-DD format only (e.g. '2025-01-01').\n"
    "- opex.mode: use exactly 'nnn', 'base_year', or 'full_service'; null if uncertain.\n"
    "- abatements: scope must be exactly 'base_rent_only' or 'gross_rent'.\n"
    "- Create a review_task for any field where evidence is ambiguous, missing, or conflicting.\n"
    "- Never fabricate values not supported by the evidence."
)


def _build_grounded_prompt(
    snippets: dict[str, list[dict[str, Any]]],
    table_candidates: list[dict[str, Any]],
    regex_candidates: dict[str, list[dict[str, Any]]],
) -> str:
    # Cap per-field regex candidates to avoid token overflow on large docs.
    capped_regex = {k: v[:8] for k, v in (regex_candidates or {}).items()}
    payload = {
        "snippets": snippets,
        "table_candidates": table_candidates[:40],
        "regex_candidates": capped_regex,
        "instructions": [
            "Use only the provided evidence.",
            "Set uncertain fields to null.",
            "Create review_tasks for ambiguity instead of guessing.",
        ],
    }
    return json.dumps(payload, ensure_ascii=True)


def _build_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "term": {
                "type": "object",
                "properties": {
                    "commencement_date": {"type": ["string", "null"]},
                    "expiration_date": {"type": ["string", "null"]},
                    "term_months": {"type": ["integer", "null"]},
                    "rent_commencement_date": {"type": ["string", "null"]},
                },
                "required": ["commencement_date", "expiration_date", "term_months", "rent_commencement_date"],
                "additionalProperties": False,
            },
            "premises": {
                "type": "object",
                "properties": {
                    "rsf": {"type": ["number", "null"]},
                    "suite": {"type": ["string", "null"]},
                    "floor": {"type": ["string", "null"]},
                    "building_name": {"type": ["string", "null"]},
                    "address": {"type": ["string", "null"]},
                },
                "required": ["rsf", "suite", "floor", "building_name", "address"],
                "additionalProperties": False,
            },
            "rent_steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "start_month": {"type": "integer"},
                        "end_month": {"type": "integer"},
                        "rate_psf_annual": {"type": "number"},
                    },
                    "required": ["start_month", "end_month", "rate_psf_annual"],
                    "additionalProperties": False,
                },
            },
            "abatements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "start_month": {"type": "integer"},
                        "end_month": {"type": "integer"},
                        "scope": {"type": "string"},
                        "classification": {"type": "string"},
                    },
                    "required": ["start_month", "end_month", "scope", "classification"],
                    "additionalProperties": False,
                },
            },
            "concessions": {
                "type": "object",
                "properties": {
                    "free_rent_months": {"type": ["integer", "null"]},
                    "notes": {"type": ["string", "null"]},
                },
                "required": ["free_rent_months", "notes"],
                "additionalProperties": False,
            },
            "tenant_improvements": {
                "type": "object",
                "properties": {
                    "allowance_psf": {"type": ["number", "null"]},
                    "allowance_total": {"type": ["number", "null"]},
                },
                "required": ["allowance_psf", "allowance_total"],
                "additionalProperties": False,
            },
            "parking": {
                "type": "object",
                "properties": {
                    "ratio": {"type": ["number", "null"]},
                    "rate_monthly": {"type": ["number", "null"]},
                    "spaces": {"type": ["integer", "null"]},
                },
                "required": ["ratio", "rate_monthly", "spaces"],
                "additionalProperties": False,
            },
            "rights_options": {
                "type": "object",
                "properties": {
                    "renewal_option": {"type": ["string", "null"]},
                    "termination_right": {"type": ["string", "null"]},
                    "expansion_option": {"type": ["string", "null"]},
                    "contraction_option": {"type": ["string", "null"]},
                    "rofr_rofo": {"type": ["string", "null"]},
                },
                "required": ["renewal_option", "termination_right", "expansion_option", "contraction_option", "rofr_rofo"],
                "additionalProperties": False,
            },
            "opex": {
                "type": "object",
                "properties": {
                    "mode": {"type": ["string", "null"]},
                    "base_psf_year_1": {"type": ["number", "null"]},
                    "growth_rate": {"type": ["number", "null"]},
                },
                "required": ["mode", "base_psf_year_1", "growth_rate"],
                "additionalProperties": False,
            },
            "review_tasks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field_path": {"type": "string"},
                        "severity": {"type": "string"},
                        "message": {"type": "string"},
                    },
                    "required": ["field_path", "severity", "message"],
                    "additionalProperties": False,
                },
            },
        },
        "required": [
            "term", "premises", "rent_steps", "abatements", "concessions",
            "tenant_improvements", "parking", "rights_options", "opex", "review_tasks",
        ],
        "additionalProperties": False,
    }


def structured_extract(
    snippets: dict[str, list[dict[str, Any]]],
    table_candidates: list[dict[str, Any]],
    regex_candidates: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key:
        return None

    try:
        from openai import OpenAI  # type: ignore
    except Exception:
        return None

    client = OpenAI(api_key=api_key)
    grounded = _build_grounded_prompt(snippets, table_candidates, regex_candidates)
    schema = _build_schema()

    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            response = client.responses.create(
                model=MODEL,
                input=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
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
            text = ""
            try:
                text = response.output_text or ""
            except Exception:
                pass
            if not text:
                _LOG.warning("llm_extract: empty response on attempt %d", attempt + 1)
                time.sleep(1.0 * (attempt + 1))
                continue
            parsed = json.loads(text)
            if not isinstance(parsed, dict):
                return None
            return parsed
        except Exception as exc:
            last_exc = exc
            _LOG.warning("llm_extract: attempt %d failed: %s", attempt + 1, exc)
            if attempt < 2:
                time.sleep(1.0 * (attempt + 1))

    if last_exc:
        _LOG.error("llm_extract: all attempts failed: %s", last_exc)
    return None


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
                {"role": "system", "content": "You arbitrate extraction conflicts for commercial lease fields."},
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
                            "chosen_value": {"type": ["string", "number", "boolean", "null"]},
                            "reason": {"type": "string"},
                        },
                        "required": ["needs_review", "chosen_value", "reason"],
                        "additionalProperties": False,
                    },
                    "strict": True,
                }
            },
        )
        parsed = json.loads(resp.output_text or "")
        return parsed if isinstance(parsed, dict) else None
    except Exception as exc:
        _LOG.warning("arbitration_decision failed for field %s: %s", field, exc)
        return None
