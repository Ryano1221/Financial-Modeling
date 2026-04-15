from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any

from .schema import CANONICAL_EXTRACTION_SCHEMA

# ---------------------------------------------------------------------------
# Provider selection — import from parent package (backend/llm_provider.py)
# ---------------------------------------------------------------------------
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)
try:
    import llm_provider as _lp
except ImportError:
    _lp = None  # type: ignore

MODEL = os.environ.get("OPENAI_EXTRACTION_MODEL", "gpt-4.1-mini")

_LOG = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are a commercial real estate lease abstraction specialist. "
    "Extract lease fields STRICTLY from the provided evidence (snippets, table_candidates, regex_candidates). "
    "Rules:\n"
    "- Set any field to null when it is not clearly present in the evidence. Never guess.\n"
    "- MULTI-OPTION / MULTI-SCENARIO PROPOSALS: When a document presents multiple term options or scenarios, "
    "extract the PRIMARY (longest / main) scenario as the primary values — this is typically the "
    "full-term option the landlord or tenant rep is recommending. "
    "NEVER pick a short-term option over a longer primary term. "
    "Example: if a proposal shows an 18-month short-term option AND a 66-month primary term, "
    "extract term_months=66 as the primary and flag the 18-month variant in review_tasks. "
    "If all options share a value (e.g. same base rent), extract that shared value. "
    "Create a review_task for each alternative scenario so the user can create additional comparisons.\n"
    "- premises.building_name: extract the MARKETING NAME of the property — NOT the street address. "
    "Look for the branded name the building or campus is known by (e.g. 'The Stratum', 'Domain Tower', "
    "'Capital Ridge'). Clues: 'lease at [Name]', 'space at [Name]', 'located at [Name]', 'RE: ... at [Name]', "
    "or a project name capitalized near the address. "
    "Never use the street address as the building_name. Set null only if no branded name exists.\n"
    "- premises.address: the full street address including suite, city, state, zip.\n"
    "- tenant_improvements.allowance_psf: extract the dollar-per-SF TI CONSTRUCTION budget ONLY. "
    "This covers landlord work or a construction allowance for buildout/improvements. "
    "Turn-key delivery with a stated cost cap — e.g. 'turn-key...at a cost not to exceed $60.00 per sq. ft.' — "
    "means allowance_psf = 60.0. 'Turn-key' with NO dollar cap should yield null (note in review_tasks). "
    "CRITICAL: Allowances for moving costs, FF&E, furniture, cabling, data, security deposits, or "
    "other soft costs are NOT TI — do NOT populate allowance_psf from these. "
    "Example: 'Landlord will provide $10/RSF for moving costs, FF&E, and cabling' → allowance_psf = null "
    "(add a review_task noting the $10/SF soft-cost allowance). "
    "Example: 'space delivered turn-key at no additional TI' → allowance_psf = null.\n"
    "- abatements: when abatement is SEQUENTIAL (e.g. 'X months of Gross Rent followed by Y months of Base Rent'), "
    "create TWO separate abatement entries: "
    "entry 1: start_month=0, end_month=X-1, scope='gross_rent'; "
    "entry 2: start_month=X, end_month=X+Y-1, scope='base_rent_only'. "
    "Single abatement: 'Base Rent will be abated for the initial X months' → "
    "start_month=0, end_month=X-1, scope='base_rent_only', classification='rent_abatement'. "
    "Spelled-out numbers count: 'three months' = 3, 'five months' = 5, 'seven months' = 7. "
    "scope must be exactly 'base_rent_only' or 'gross_rent'.\n"
    "- rent_steps: each step needs start_month (0-indexed, month 0 = lease month 1), "
    "end_month (0-indexed, inclusive), and rate_psf_annual (annual $/sf). "
    "Steps must be contiguous and non-overlapping. Account for any abatement period — "
    "rent steps still begin at month 0 even if rent is abated during that period.\n"
    "- term dates: use YYYY-MM-DD format only.\n"
    "- opex.mode: use exactly 'nnn', 'base_year', or 'full_service'; null if uncertain.\n"
    "- Create a review_task for any field where evidence is ambiguous, missing, or conflicting.\n"
    "- Every review_task must include field_path, severity, issue_code, and message.\n"
    "- issue_code must be a short uppercase snake_case identifier.\n"
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
                        "issue_code": {"type": "string"},
                        "message": {"type": "string"},
                    },
                    "required": ["field_path", "severity", "issue_code", "message"],
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
    # ── provider check ──────────────────────────────────────────────────────
    use_anthropic = _lp is not None and _lp.is_anthropic()
    if use_anthropic:
        api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    else:
        api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key:
        return None

    grounded = _build_grounded_prompt(snippets, table_candidates, regex_candidates)
    schema = _build_schema()

    last_exc: Exception | None = None

    # ── Anthropic path: native messages.create with tool_use ────────────────
    if use_anthropic:
        try:
            from anthropic import Anthropic  # type: ignore
        except Exception:
            return None
        client = Anthropic(api_key=api_key)
        model = _lp.get_anthropic_model()
        tool_def = {
            "name": "lease_extract",
            "description": "Extract structured lease fields from the provided evidence.",
            "input_schema": schema,
        }
        for attempt in range(3):
            try:
                resp = client.messages.create(
                    model=model,
                    max_tokens=4096,
                    system=_SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": grounded}],
                    tools=[tool_def],
                    tool_choice={"type": "tool", "name": "lease_extract"},
                )
                parsed: dict[str, Any] | None = None
                for block in resp.content:
                    if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == "lease_extract":
                        parsed = block.input  # type: ignore[attr-defined]
                        break
                if parsed is None:
                    _LOG.warning("llm_extract(anthropic): no tool_use block on attempt %d", attempt + 1)
                    time.sleep(1.0 * (attempt + 1))
                    continue
                if not isinstance(parsed, dict):
                    return None
                return parsed
            except Exception as exc:
                last_exc = exc
                _LOG.warning("llm_extract(anthropic): attempt %d failed: %s", attempt + 1, exc)
                if attempt < 2:
                    time.sleep(1.0 * (attempt + 1))
        if last_exc:
            _LOG.error("llm_extract(anthropic): all attempts failed: %s", last_exc)
        return None

    # ── OpenAI path: responses.create with strict JSON schema ───────────────
    try:
        from openai import OpenAI  # type: ignore
    except Exception:
        return None

    client = OpenAI(api_key=api_key)

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
    if margin >= 0.05 or len(candidates) < 2:
        return None

    use_anthropic = _lp is not None and _lp.is_anthropic()
    if use_anthropic:
        api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    else:
        api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key:
        return None

    user_content = json.dumps({
        "field": field,
        "candidates": candidates,
        "instructions": "Pick one only if evidence strongly supports it; else needs_review=true.",
    })
    arb_schema = {
        "type": "object",
        "properties": {
            "needs_review": {"type": "boolean"},
            "chosen_value": {"type": ["string", "number", "boolean", "null"]},
            "reason": {"type": "string"},
        },
        "required": ["needs_review", "chosen_value", "reason"],
        "additionalProperties": False,
    }

    # ── Anthropic path ───────────────────────────────────────────────────────
    if use_anthropic:
        try:
            from anthropic import Anthropic  # type: ignore
        except Exception:
            return None
        client = Anthropic(api_key=api_key)
        model = _lp.get_anthropic_model()
        try:
            resp = client.messages.create(
                model=model,
                max_tokens=512,
                system="You arbitrate extraction conflicts for commercial lease fields.",
                messages=[{"role": "user", "content": user_content}],
                tools=[{"name": "arbitration", "description": "Arbitrate conflicting lease field extractions.", "input_schema": arb_schema}],
                tool_choice={"type": "tool", "name": "arbitration"},
            )
            for block in resp.content:
                if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == "arbitration":
                    parsed = block.input  # type: ignore[attr-defined]
                    return parsed if isinstance(parsed, dict) else None
            return None
        except Exception as exc:
            _LOG.warning("arbitration_decision(anthropic) failed for field %s: %s", field, exc)
            return None

    # ── OpenAI path ──────────────────────────────────────────────────────────
    try:
        from openai import OpenAI  # type: ignore
    except Exception:
        return None

    client = OpenAI(api_key=api_key)
    try:
        resp = client.responses.create(
            model=MODEL,
            input=[
                {"role": "system", "content": "You arbitrate extraction conflicts for commercial lease fields."},
                {"role": "user", "content": user_content},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "arbitration",
                    "schema": arb_schema,
                    "strict": True,
                }
            },
        )
        parsed = json.loads(resp.output_text or "")
        return parsed if isinstance(parsed, dict) else None
    except Exception as exc:
        _LOG.warning("arbitration_decision failed for field %s: %s", field, exc)
        return None
