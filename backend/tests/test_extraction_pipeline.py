from __future__ import annotations

import json
from pathlib import Path

from extraction.normalize import NormalizedDocument, PageData
from extraction.regex import mine_candidates
from extraction.reconcile import reconcile
from extraction.schema import validate_canonical_extraction
from extraction.validate import validate_extraction
from services.input_normalizer import _dict_to_canonical
from models.canonical_lease import LeaseType


def _fixture_path(name: str) -> Path:
    return Path(__file__).parent / "fixtures" / "expected_json" / name


def test_schema_validation_fixture_passes() -> None:
    payload = json.loads(_fixture_path("valid_extraction.json").read_text(encoding="utf-8"))
    ok, errors = validate_canonical_extraction(payload)
    assert ok, f"schema should validate fixture, got: {errors}"


def test_rent_coverage_validation() -> None:
    extraction = {
        "document": {"doc_type": "lease", "doc_role": "prime_lease", "confidence": 0.9, "evidence_spans": []},
        "term": {
            "commencement_date": "2026-01-01",
            "expiration_date": "2026-12-31",
            "rent_commencement_date": "2026-01-01",
            "term_months": 12,
        },
        "premises": {"building_name": "A", "suite": "100", "floor": None, "address": "A", "rsf": 1000},
        "rent_steps": [{"start_month": 0, "end_month": 11, "rate_psf_annual": 40.0}],
        "abatements": [],
        "opex": {"mode": "nnn", "base_psf_year_1": 10.0, "growth_rate": 0.03, "cues": ["nnn"]},
        "provenance": {},
        "review_tasks": [],
        "evidence": [{"source": "pdf_text_regex", "source_confidence": 0.9, "snippet": "NNN", "page": 1, "bbox": None}],
        "confidence": {"overall": 0.5, "status": "yellow", "export_allowed": True},
        "export_allowed": True,
    }
    result = validate_extraction(extraction, source_quality=0.9, reconcile_margin=0.5)
    assert result["export_allowed"] is True
    assert not any(t.get("issue_code") == "RENT_SCHEDULE_COVERAGE" for t in result["review_tasks"])


def test_term_constraint_within_tolerance() -> None:
    extraction = {
        "document": {"doc_type": "lease", "doc_role": "prime_lease", "confidence": 0.9, "evidence_spans": []},
        "term": {
            "commencement_date": "2026-01-01",
            "expiration_date": "2026-12-31",
            "rent_commencement_date": "2026-01-01",
            "term_months": 11,
        },
        "premises": {"building_name": "A", "suite": "100", "floor": None, "address": "A", "rsf": 1000},
        "rent_steps": [{"start_month": 0, "end_month": 10, "rate_psf_annual": 40.0}],
        "abatements": [],
        "opex": {"mode": "nnn", "base_psf_year_1": 10.0, "growth_rate": 0.03, "cues": ["nnn"]},
        "provenance": {},
        "review_tasks": [],
        "evidence": [{"source": "pdf_text_regex", "source_confidence": 0.9, "snippet": "NNN", "page": 1, "bbox": None}],
        "confidence": {"overall": 0.5, "status": "yellow", "export_allowed": True},
        "export_allowed": True,
    }
    result = validate_extraction(extraction, source_quality=0.9, reconcile_margin=0.5)
    assert not any(t.get("issue_code") == "TERM_MISMATCH" for t in result["review_tasks"])


def test_opex_gating_when_nnn_cues_present_and_opex_missing() -> None:
    extraction = {
        "document": {"doc_type": "lease", "doc_role": "prime_lease", "confidence": 0.9, "evidence_spans": []},
        "term": {
            "commencement_date": "2026-01-01",
            "expiration_date": "2026-12-31",
            "rent_commencement_date": "2026-01-01",
            "term_months": 11,
        },
        "premises": {"building_name": "A", "suite": "100", "floor": None, "address": "A", "rsf": 1000},
        "rent_steps": [{"start_month": 0, "end_month": 10, "rate_psf_annual": 40.0}],
        "abatements": [],
        "opex": {"mode": "", "base_psf_year_1": None, "growth_rate": None, "cues": []},
        "provenance": {},
        "review_tasks": [],
        "evidence": [{"source": "pdf_text_regex", "source_confidence": 0.9, "snippet": "Lease is NNN.", "page": 1, "bbox": None}],
        "confidence": {"overall": 0.5, "status": "yellow", "export_allowed": True},
        "export_allowed": True,
    }
    result = validate_extraction(extraction, source_quality=0.7, reconcile_margin=0.4)
    assert result["export_allowed"] is False
    blocker_codes = [t.get("issue_code") for t in result["review_tasks"] if t.get("severity") == "blocker"]
    assert "OPEX_NNN_INCOMPLETE" in blocker_codes


def test_arbitration_conflict_has_resolution_or_review_task() -> None:
    regex_candidates = {
        "term_months": [
            {"field": "term_months", "value": 60, "source": "pdf_text_regex", "source_confidence": 0.70, "snippet": "term 60 months", "page": 1, "bbox": None},
            {"field": "term_months", "value": 61, "source": "pdf_text_regex", "source_confidence": 0.69, "snippet": "term 61 months", "page": 2, "bbox": None},
        ]
    }
    rent_steps = [
        {"start_month": 0, "end_month": 59, "rate_psf_annual": 40.0, "source": "table_parser", "source_confidence": 0.71, "snippet": "Year 1-5", "page": 3, "bbox": None},
        {"start_month": 0, "end_month": 59, "rate_psf_annual": 41.0, "source": "table_parser", "source_confidence": 0.70, "snippet": "Year 1-5", "page": 4, "bbox": None},
    ]

    reconciled = reconcile(regex_candidates=regex_candidates, rent_step_candidates=rent_steps, llm_output=None)
    resolved_term = (reconciled.get("resolved") or {}).get("term", {}).get("term_months")
    provenance = (reconciled.get("provenance") or {}).get("term.term_months", [])

    assert resolved_term in {60, 61} or resolved_term is None
    assert provenance, "conflict resolution must include evidence provenance"


def test_regex_detects_full_service_gross_opex_mode() -> None:
    normalized = NormalizedDocument(
        sha256="x",
        filename="sample.pdf",
        content_type="application/pdf",
        pages=[
            PageData(
                page_number=1,
                text="Lease Type: Full Service Gross Lease. Tenant will not pay separate CAM.",
                words=[],
                table_regions=[],
                needs_ocr=False,
            )
        ],
        full_text="Lease Type: Full Service Gross Lease.",
    )
    candidates = mine_candidates(normalized)
    values = [str(c.get("value") or "") for c in candidates.get("opex_mode", [])]
    assert "full_service" in values


def test_regex_opex_mode_prefers_nnn_when_base_year_is_only_cap_reference() -> None:
    normalized = NormalizedDocument(
        sha256="n",
        filename="sample.pdf",
        content_type="application/pdf",
        pages=[
            PageData(
                page_number=1,
                text=(
                    "Operating Expenses: Tenant shall pay its pro rata share of actual NNN operating expenses. "
                    "Operating expenses for 2026 are estimated to be $20.90. "
                    "Tenant shall have a cap on controllable opex using a base year of 2027."
                ),
                words=[],
                table_regions=[],
                needs_ocr=False,
            )
        ],
        full_text="NNN operating expenses with base year cap reference",
    )
    candidates = mine_candidates(normalized)
    values = [str(c.get("value") or "") for c in candidates.get("opex_mode", [])]
    assert "nnn" in values


def test_reconcile_detects_phase_in_without_abatement() -> None:
    normalized = NormalizedDocument(
        sha256="phasein",
        filename="phasein.pdf",
        content_type="application/pdf",
        pages=[
            PageData(
                page_number=1,
                text="Phase-In occupancy schedule: Months 1-12 at 12,500 RSF, Months 13-24 at 21,000 RSF.",
                words=[],
                table_regions=[],
                needs_ocr=False,
            )
        ],
        full_text="Phase-In occupancy schedule",
    )
    candidates = mine_candidates(normalized)
    reconciled = reconcile(regex_candidates=candidates, rent_step_candidates=[], llm_output=None)
    resolved = reconciled.get("resolved") or {}
    analysis = resolved.get("abatement_analysis") or {}
    assert analysis.get("classification") == "phase_in"
    assert analysis.get("phase_in_detected") is True
    assert (resolved.get("abatements") or []) == []


def test_reconcile_detects_gross_vs_base_abatement_scope() -> None:
    gross_doc = NormalizedDocument(
        sha256="gross",
        filename="gross.pdf",
        content_type="application/pdf",
        pages=[
            PageData(
                page_number=1,
                text="Tenant shall receive gross rent abatement for months 1-4, including base rent and operating expenses.",
                words=[],
                table_regions=[],
                needs_ocr=False,
            )
        ],
        full_text="gross rent abatement",
    )
    base_doc = NormalizedDocument(
        sha256="base",
        filename="base.pdf",
        content_type="application/pdf",
        pages=[
            PageData(
                page_number=1,
                text="Landlord grants base rent only abatement during months 1-2.",
                words=[],
                table_regions=[],
                needs_ocr=False,
            )
        ],
        full_text="base rent only abatement",
    )

    gross_reconciled = reconcile(regex_candidates=mine_candidates(gross_doc), rent_step_candidates=[], llm_output=None)
    base_reconciled = reconcile(regex_candidates=mine_candidates(base_doc), rent_step_candidates=[], llm_output=None)

    gross_abatements = (gross_reconciled.get("resolved") or {}).get("abatements") or []
    base_abatements = (base_reconciled.get("resolved") or {}).get("abatements") or []
    assert gross_abatements and gross_abatements[0].get("scope") == "gross_rent"
    assert base_abatements and base_abatements[0].get("scope") == "base_rent_only"


def test_dict_normalizer_maps_full_service_variants() -> None:
    lease = _dict_to_canonical(
        {
            "scenario_name": "Option 1",
            "term_months": 60,
            "rsf": 1000,
            "commencement_date": "2026-01-01",
            "expiration_date": "2031-01-01",
            "lease_type": "Full Service Gross Lease",
            "rent_schedule": [{"start_month": 0, "end_month": 59, "rent_psf_annual": 40}],
        }
    )
    assert lease.lease_type == LeaseType.FULL_SERVICE
