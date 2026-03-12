from __future__ import annotations

from typing import Any

CANONICAL_EXTRACTION_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": [
        "document",
        "term",
        "premises",
        "rent_steps",
        "abatements",
        "opex",
        "confidence",
        "review_tasks",
        "evidence",
        "export_allowed",
    ],
    "properties": {
        "document": {
            "type": "object",
            "required": ["doc_type", "doc_role", "confidence", "evidence_spans"],
            "properties": {
                "doc_type": {"type": "string"},
                "doc_role": {"type": "string"},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "evidence_spans": {
                    "type": "array",
                    "items": {"$ref": "#/$defs/evidence"},
                },
            },
        },
        "term": {
            "type": "object",
            "properties": {
                "commencement_date": {"type": ["string", "null"]},
                "expiration_date": {"type": ["string", "null"]},
                "rent_commencement_date": {"type": ["string", "null"]},
                "term_months": {"type": ["integer", "null"], "minimum": 0},
            },
            "additionalProperties": False,
        },
        "premises": {
            "type": "object",
            "properties": {
                "building_name": {"type": ["string", "null"]},
                "suite": {"type": ["string", "null"]},
                "floor": {"type": ["string", "null"]},
                "address": {"type": ["string", "null"]},
                "rsf": {"type": ["number", "null"], "minimum": 0},
            },
            "additionalProperties": False,
        },
        "rent_steps": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["start_month", "end_month", "rate_psf_annual"],
                "properties": {
                    "start_month": {"type": "integer", "minimum": 0},
                    "end_month": {"type": "integer", "minimum": 0},
                    "rate_psf_annual": {"type": "number", "minimum": 0},
                    "source": {"type": ["string", "null"]},
                    "source_confidence": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
                    "rsf": {"type": ["number", "null"], "minimum": 0},
                    "notes": {"type": ["string", "null"]},
                },
            },
        },
        "abatements": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start_month": {"type": "integer", "minimum": 0},
                    "end_month": {"type": "integer", "minimum": 0},
                    "scope": {"type": ["string", "null"]},
                    "source": {"type": ["string", "null"]},
                    "classification": {"type": ["string", "null"]},
                },
            },
        },
        "abatement_analysis": {
            "type": "object",
            "properties": {
                "classification": {
                    "type": ["string", "null"],
                    "enum": [None, "none", "phase_in", "rent_abatement", "mixed", "unknown"],
                },
                "phase_in_detected": {"type": "boolean"},
                "phase_in_confidence": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
                "scope": {"type": ["string", "null"]},
            },
            "additionalProperties": False,
        },
        "concessions": {
            "type": "object",
            "properties": {
                "free_rent_months": {"type": ["integer", "null"], "minimum": 0}
            },
            "additionalProperties": False,
        },
        "tenant_improvements": {
            "type": "object",
            "properties": {
                "ti_allowance_psf": {"type": ["number", "null"], "minimum": 0},
                "ti_allowance_total": {"type": ["number", "null"], "minimum": 0}
            },
            "additionalProperties": False,
        },
        "parking": {
            "type": "object",
            "properties": {
                "ratio_per_1000_rsf": {"type": ["number", "null"], "minimum": 0},
                "rate_monthly_per_space": {"type": ["number", "null"], "minimum": 0},
                "spaces": {"type": ["integer", "null"], "minimum": 0}
            },
            "additionalProperties": False,
        },
        "rights_options": {
            "type": "object",
            "properties": {
                "renewal_option": {"type": ["string", "null"]},
                "termination_right": {"type": ["string", "null"]},
                "expansion_option": {"type": ["string", "null"]},
                "contraction_option": {"type": ["string", "null"]},
                "rofr_rofo": {"type": ["string", "null"]}
            },
            "additionalProperties": False,
        },
        "missing_information": {
            "type": "array",
            "items": {"type": "string"}
        },
        "opex": {
            "type": "object",
            "properties": {
                "mode": {"type": ["string", "null"]},
                "base_psf_year_1": {"type": ["number", "null"], "minimum": 0},
                "growth_rate": {"type": ["number", "null"], "minimum": 0},
                "cues": {"type": "array", "items": {"type": "string"}},
            },
            "additionalProperties": True,
        },
        "confidence": {
            "type": "object",
            "required": ["overall", "status", "export_allowed"],
            "properties": {
                "overall": {"type": "number", "minimum": 0, "maximum": 1},
                "status": {"type": "string", "enum": ["green", "yellow", "red"]},
                "export_allowed": {"type": "boolean"},
                "validation_pass_rate": {"type": "number", "minimum": 0, "maximum": 1},
                "reconcile_margin": {"type": "number", "minimum": 0, "maximum": 1},
            },
        },
        "provenance": {
            "type": "object",
            "additionalProperties": {
                "type": "array",
                "items": {"$ref": "#/$defs/evidence"},
            },
        },
        "review_tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["field_path", "severity", "issue_code", "message"],
                "properties": {
                    "field_path": {"type": "string"},
                    "severity": {"type": "string", "enum": ["info", "warn", "blocker"]},
                    "issue_code": {"type": "string"},
                    "message": {"type": "string"},
                    "candidates": {"type": "array", "items": {"type": "object"}},
                    "recommended_value": {},
                    "evidence": {
                        "type": "array",
                        "items": {"$ref": "#/$defs/evidence"},
                    },
                },
            },
        },
        "evidence": {
            "type": "array",
            "items": {"$ref": "#/$defs/evidence"},
        },
        "export_allowed": {"type": "boolean"},
    },
    "$defs": {
        "evidence": {
            "type": "object",
            "required": ["source", "source_confidence"],
            "properties": {
                "page": {"type": ["integer", "null"], "minimum": 1},
                "snippet": {"type": ["string", "null"]},
                "bbox": {
                    "type": ["array", "null"],
                    "items": {"type": "number"},
                    "minItems": 4,
                    "maxItems": 4,
                },
                "source": {"type": "string"},
                "source_confidence": {"type": "number", "minimum": 0, "maximum": 1},
            },
            "additionalProperties": True,
        },
    },
}


def validate_canonical_extraction(instance: dict[str, Any]) -> tuple[bool, list[str]]:
    try:
        import jsonschema  # type: ignore
    except Exception:
        # Lightweight fallback when jsonschema is unavailable.
        required = {
            "document",
            "term",
            "premises",
            "rent_steps",
            "abatements",
            "opex",
            "confidence",
            "review_tasks",
            "evidence",
            "export_allowed",
        }
        missing = sorted(k for k in required if k not in instance)
        return (len(missing) == 0, [f"missing key: {k}" for k in missing])

    try:
        jsonschema.validate(instance=instance, schema=CANONICAL_EXTRACTION_SCHEMA)
    except Exception as exc:  # noqa: BLE001
        return False, [str(exc)]
    return True, []
