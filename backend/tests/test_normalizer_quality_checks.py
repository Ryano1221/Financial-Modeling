"""Quality-check regressions for normalize-time safety checks."""

from __future__ import annotations

from datetime import date
from io import BytesIO

from fastapi import UploadFile

import main
from models import ExtractionResponse, OpexMode, RentStep, Scenario


def test_run_extraction_artifacts_primary_pass_omits_canonical_backfill(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_build_extract_response(*, file_bytes: bytes, filename: str, content_type: str, canonical_lease=None):
        captured["file_bytes"] = file_bytes
        captured["filename"] = filename
        captured["content_type"] = content_type
        captured["canonical_lease"] = canonical_lease
        return {
            "document": {"doc_type": "proposal", "doc_role": "proposal", "confidence": 0.91, "evidence_spans": []},
            "term": {
                "commencement_date": "2026-01-01",
                "expiration_date": "2030-12-31",
                "rent_commencement_date": "2026-01-01",
                "term_months": 60,
            },
            "premises": {"building_name": "Signal Tower", "suite": "700", "floor": None, "address": "123 Main St", "rsf": 12000.0},
            "rent_steps": [],
            "abatements": [],
            "parking_abatements": [],
            "opex": {"mode": "nnn", "base_psf_year_1": 8.5, "growth_rate": 0.03, "cues": []},
            "proposal": {},
            "provenance": {"fields": []},
            "review_tasks": [],
            "confidence": {"overall": 0.91, "status": "green", "export_allowed": True},
            "export_allowed": True,
        }

    monkeypatch.setattr(main, "build_extract_response", _fake_build_extract_response)
    canonical = main._dict_to_canonical(
        {
            "building_name": "Legacy Tower",
            "suite": "1200",
            "rsf": 10000,
            "commencement_date": "2026-01-01",
            "expiration_date": "2030-12-31",
            "term_months": 60,
            "rent_schedule": [{"start_month": 0, "end_month": 59, "rent_psf_annual": 42.0}],
        }
    )

    artifacts = main._run_extraction_artifacts(
        file_bytes=b"proposal bytes",
        filename="proposal.docx",
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        canonical=canonical,
    )

    assert captured["canonical_lease"] is None
    assert artifacts["canonical_extraction"]["document"]["doc_type"] == "proposal"
    assert artifacts["extraction_confidence"]["status"] == "green"


def test_run_extraction_artifacts_uses_canonical_only_fallback_when_pipeline_errors(monkeypatch) -> None:
    monkeypatch.setattr(main, "build_extract_response", lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("boom")))
    canonical = main._dict_to_canonical(
        {
            "building_name": "Fallback Tower",
            "suite": "500",
            "rsf": 8500,
            "commencement_date": "2027-01-01",
            "expiration_date": "2031-12-31",
            "term_months": 60,
            "rent_schedule": [{"start_month": 0, "end_month": 59, "rent_psf_annual": 38.5}],
        }
    )

    artifacts = main._run_extraction_artifacts(
        file_bytes=b"lease bytes",
        filename="lease.pdf",
        content_type="application/pdf",
        canonical=canonical,
    )

    assert artifacts["review_tasks"][0]["issue_code"] == "PIPELINE_FALLBACK"
    assert artifacts["canonical_extraction"]["term"]["term_months"] == int(canonical.term_months)
    assert artifacts["canonical_extraction"]["rent_steps"][0]["source"] == "canonical_normalizer"


def test_merge_canonical_primary_then_legacy_prefers_primary_values() -> None:
    legacy = main._dict_to_canonical(
        {
            "building_name": "Legacy Tower",
            "suite": "1200",
            "address": "500 Legacy Blvd",
            "rsf": 10000,
            "commencement_date": "2026-01-01",
            "expiration_date": "2030-12-31",
            "term_months": 60,
            "rent_schedule": [{"start_month": 0, "end_month": 59, "rent_psf_annual": 41.0}],
            "opex_psf_year_1": 11.0,
        }
    )
    extraction = {
        "term": {
            "commencement_date": "2026-02-01",
            "expiration_date": "2031-01-31",
            "term_months": 60,
        },
        "premises": {
            "building_name": "Pipeline Tower",
            "suite": "900",
            "address": "100 Pipeline Ave",
            "rsf": 12500,
        },
        "rent_steps": [
            {"start_month": 0, "end_month": 59, "rate_psf_annual": 48.0},
        ],
        "opex": {"mode": "nnn", "base_psf_year_1": 9.5, "growth_rate": 0.03},
        "provenance": {
            "premises.rsf": [{"source": "pdf_text_regex", "source_confidence": 0.92, "snippet": "12,500 RSF", "page": 1, "bbox": None}],
        },
        "confidence": {"overall": 0.91},
    }

    merged, meta = main._merge_canonical_primary_then_legacy(
        primary_extraction=extraction,
        legacy_canonical=legacy,
        legacy_field_confidence={"suite": 0.7},
    )

    assert merged.building_name == "Pipeline Tower"
    assert merged.suite == "900"
    assert merged.rsf == 12500
    assert meta["field_sources"]["rsf"] == "canonical_pipeline"
    assert meta["field_sources"]["building_name"] == "canonical_pipeline"
    assert meta["provenance"]["rsf"][0]["source"] != "legacy_fallback"


def test_merge_canonical_primary_then_legacy_uses_legacy_only_for_missing_primary_fields() -> None:
    legacy = main._dict_to_canonical(
        {
            "building_name": "Legacy Tower",
            "suite": "500",
            "address": "500 Legacy Blvd",
            "rsf": 10000,
            "commencement_date": "2026-01-01",
            "expiration_date": "2030-12-31",
            "term_months": 60,
            "rent_schedule": [{"start_month": 0, "end_month": 59, "rent_psf_annual": 41.0}],
        }
    )
    extraction = {
        "term": {"commencement_date": "2026-03-01", "expiration_date": "2031-02-28", "term_months": 60},
        "premises": {"building_name": "Primary Tower", "suite": None, "address": "200 Primary Dr", "rsf": 11500},
        "rent_steps": [{"start_month": 0, "end_month": 59, "rate_psf_annual": 46.0}],
        "opex": {"mode": "nnn", "base_psf_year_1": 8.0, "growth_rate": 0.03},
        "provenance": {},
        "confidence": {"overall": 0.86},
    }

    merged, meta = main._merge_canonical_primary_then_legacy(
        primary_extraction=extraction,
        legacy_canonical=legacy,
        legacy_field_confidence={"suite": 0.74},
    )

    assert merged.building_name == "Primary Tower"
    assert merged.rsf == 11500
    assert merged.suite == "500"
    assert meta["field_sources"]["suite"] == "legacy_fallback"
    assert "suite" in list(meta.get("fallback_fields") or [])
    assert meta["provenance"]["suite"][0]["source"] == "legacy_fallback"
    assert any("legacy fallback populated" in str(w).lower() for w in list(meta.get("warnings") or []))


def test_collect_primary_updates_from_canonical_extraction_maps_parking_abatements() -> None:
    updates = main._collect_primary_updates_from_canonical_extraction(
        {
            "term": {"commencement_date": "2026-01-01", "expiration_date": "2030-12-31", "term_months": 60},
            "premises": {"building_name": "Signal Tower", "suite": "700", "address": "123 Main", "rsf": 12000},
            "rent_steps": [{"start_month": 0, "end_month": 59, "rate_psf_annual": 42.0}],
            "abatements": [{"start_month": 0, "end_month": 2, "scope": "base_rent_only"}],
            "parking_abatements": [{"start_month": 0, "end_month": 2}, {"start_month": 24, "end_month": 25}],
            "abatement_analysis": {"classification": "rent_abatement"},
            "concessions": {"free_rent_months": 3},
            "tenant_improvements": {},
            "parking": {},
            "opex": {"mode": "nnn", "base_psf_year_1": 8.5, "growth_rate": 0.03},
        }
    )

    parking_periods = updates.get("parking_abatement_periods") or []
    assert len(parking_periods) == 2
    assert parking_periods[0].start_month == 0
    assert parking_periods[0].end_month == 2
    assert parking_periods[1].start_month == 24
    assert parking_periods[1].end_month == 25


def test_collect_primary_updates_from_canonical_extraction_cleans_building_and_drops_party_suite_noise() -> None:
    updates = main._collect_primary_updates_from_canonical_extraction(
        {
            "term": {"commencement_date": "2028-01-01", "expiration_date": "2038-04-30", "term_months": 124},
            "premises": {
                "building_name": "Tarrytown Expocare at Research Park Building 3",
                "suite": "300, NEWTON, MASSACHUSETTS 02458",
                "address": "12515 Research Park Loop, Austin, TX 78759",
                "rsf": 55388,
            },
            "rent_steps": [],
            "abatements": [],
            "parking_abatements": [],
            "abatement_analysis": {},
            "concessions": {},
            "tenant_improvements": {},
            "parking": {},
            "opex": {},
        }
    )

    assert updates["building_name"] == "Research Park Building 3"
    assert "suite" not in updates
    assert updates["address"] == "12515 Research Park Loop, Austin, TX 78759"
    assert updates["term_months"] == 124




def test_supplemental_quality_checks_flags_rent_schedule_coverage_gap() -> None:
    canonical = main._dict_to_canonical(
        {
            "building_name": "Sample Tower",
            "suite": "1100",
            "rsf": 10000,
            "commencement_date": "2028-04-01",
            "expiration_date": "2033-03-31",
            "term_months": 60,
            "rent_schedule": [
                {"start_month": 0, "end_month": 11, "rent_psf_annual": 40.0},
            ],
        }
    )
    quality = main._supplemental_quality_checks(canonical=canonical, text="Lease term and base rent schedule", extracted_hints={})
    tasks = [t for t in quality["review_tasks"] if isinstance(t, dict)]
    assert any(t.get("issue_code") == "RENT_SCHEDULE_COVERAGE" for t in tasks)
    assert any(str(t.get("severity") or "").lower() == "blocker" for t in tasks)


def test_normalize_impl_merges_dated_rent_review_tasks_from_hints(monkeypatch) -> None:
    monkeypatch.setattr(main, "extract_text_from_pdf", lambda _buf: "dated amendment text")
    monkeypatch.setattr(main, "text_quality_requires_ocr", lambda _text: False)
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "amendment")
    monkeypatch.setattr(
        main,
        "_extract_lease_hints",
        lambda _text, _filename, _rid: {
            "building_name": "Signal Tower",
            "suite": "700",
            "rsf": 12000.0,
            "commencement_date": date(2026, 1, 1),
            "expiration_date": date(2030, 12, 31),
            "term_months": 60,
            "_review_tasks": [
                {
                    "field_path": "rent_steps",
                    "severity": "warn",
                    "issue_code": "RENT_ROW_REJECTED_MONTHLY_TOTAL",
                    "message": "Dated rent row looked like monthly rent dollars, not an annual PSF rent step.",
                    "candidates": [
                        {
                            "row_text": "January 1, 2026 - December 31, 2026 Monthly Rent $25,000.00 Annual Rent $300,000.00",
                            "category": "monthly_total",
                            "reason": "Dated rent row looked like monthly rent dollars, not an annual PSF rent step.",
                            "source": "dated_rent_table_triplet",
                        }
                    ],
                    "recommended_value": None,
                    "evidence": [
                        {
                            "page": None,
                            "snippet": "January 1, 2026 - December 31, 2026 Monthly Rent $25,000.00 Annual Rent $300,000.00",
                            "bbox": None,
                            "source": "dated_rent_table_triplet",
                            "source_confidence": 0.9,
                        }
                    ],
                    "metadata": {
                        "row_text": "January 1, 2026 - December 31, 2026 Monthly Rent $25,000.00 Annual Rent $300,000.00",
                        "rejection_reason": "Dated rent row looked like monthly rent dollars, not an annual PSF rent step.",
                        "rejection_category": "monthly_total",
                        "base_issue_code": "RENT_ROW_REJECTED",
                    },
                }
            ],
        },
    )
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="Signal Tower",
                rsf=12000.0,
                commencement=date(2026, 1, 1),
                expiration=date(2030, 12, 31),
                rent_steps=[RentStep(start=0, end=59, rate_psf_yr=42.0)],
                free_rent_months=0,
                ti_allowance_psf=0.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=8.0,
                base_year_opex_psf_yr=8.0,
                opex_growth=0.03,
                discount_rate_annual=0.08,
            ),
            confidence={"rsf": 0.9},
            warnings=[],
            source="pdf_text",
            text_length=18,
        ),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **_kwargs: {
            "provenance": {},
            "review_tasks": [],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.9, "status": "green", "export_allowed": True},
            "canonical_extraction": {},
        },
    )

    upload = UploadFile(filename="dated-amendment.pdf", file=BytesIO(b"pdf-bytes"))
    result, _used_ai = main._normalize_impl("rid", "PDF", None, None, upload)

    tasks = list(result.review_tasks or [])
    rent_review = next(task for task in tasks if getattr(task, "issue_code", None) == "RENT_ROW_REJECTED_MONTHLY_TOTAL")
    assert rent_review.candidates[0]["category"] == "monthly_total"


def test_normalize_impl_sanitizes_malformed_review_tasks(monkeypatch) -> None:
    monkeypatch.setattr(main, "extract_text_from_pdf", lambda _buf: "lease term text")
    monkeypatch.setattr(main, "text_quality_requires_ocr", lambda _text: False)
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "lease")
    monkeypatch.setattr(
        main,
        "_extract_lease_hints",
        lambda _text, _filename, _rid: {
            "building_name": "Signal Tower",
            "suite": "700",
            "rsf": 12000.0,
            "commencement_date": date(2026, 1, 1),
            "expiration_date": date(2033, 8, 31),
            "term_months": 92,
        },
    )
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="Signal Tower",
                rsf=12000.0,
                commencement=date(2026, 1, 1),
                expiration=date(2033, 8, 31),
                rent_steps=[RentStep(start=0, end=91, rate_psf_yr=42.0)],
                free_rent_months=0,
                ti_allowance_psf=0.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=8.0,
                base_year_opex_psf_yr=8.0,
                opex_growth=0.03,
                discount_rate_annual=0.08,
            ),
            confidence={"rsf": 0.9},
            warnings=[],
            source="pdf_text",
            text_length=15,
        ),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **_kwargs: {
            "provenance": {},
            "review_tasks": [
                {
                    "field_path": "term.commencement_date",
                    "severity": "warn",
                    "message": "Commencement mentioned but not firm.",
                    "evidence": [{"snippet": "Lease shall commence on delivery."}],
                },
                {
                    "field_path": "term.expiration_date",
                    "severity": "warn",
                    "message": "92 months mentioned.",
                },
            ],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.9, "status": "yellow", "export_allowed": True},
            "canonical_extraction": {},
        },
    )

    upload = UploadFile(filename="malformed-review-task.pdf", file=BytesIO(b"pdf-bytes"))
    result, _used_ai = main._normalize_impl("rid", "PDF", None, None, upload)

    review_tasks = list(result.review_tasks or [])
    assert len(review_tasks) >= 2
    commencement_review = next(task for task in review_tasks if task.field_path == "term.commencement_date")
    expiration_review = next(task for task in review_tasks if task.field_path == "term.expiration_date")

    assert commencement_review.issue_code.startswith("REVIEW_TASK_TERM_COMMENCEMENT_DATE_")
    assert expiration_review.issue_code.startswith("REVIEW_TASK_TERM_EXPIRATION_DATE_")
    assert commencement_review.evidence[0].source == "normalize_review_task"


def test_supplemental_quality_checks_flags_opex_equal_to_ti_allowance() -> None:
    canonical = main._dict_to_canonical(
        {
            "building_name": "Sample Tower",
            "suite": "400",
            "rsf": 25000,
            "commencement_date": "2028-04-01",
            "expiration_date": "2035-03-31",
            "term_months": 84,
            "rent_schedule": [
                {"start_month": 0, "end_month": 83, "rent_psf_annual": 44.0},
            ],
            "opex_psf_year_1": 45.0,
            "ti_allowance_psf": 45.0,
        }
    )
    quality = main._supplemental_quality_checks(
        canonical=canonical,
        text="Operating Expenses are estimated. Tenant Improvement Allowance shall be provided.",
        extracted_hints={},
    )
    tasks = [t for t in quality["review_tasks"] if isinstance(t, dict)]
    assert any(t.get("issue_code") == "OPEX_EQUALS_TIA" for t in tasks)
    assert any("OpEx may be contaminated" in str(w) for w in quality["warnings"])


def test_supplemental_quality_checks_blocks_ambiguous_rent_rate_candidates() -> None:
    canonical = main._dict_to_canonical(
        {
            "building_name": "Sample Tower",
            "suite": "300",
            "rsf": 6052,
            "commencement_date": "2026-04-01",
            "expiration_date": "2031-08-31",
            "term_months": 65,
            "rent_schedule": [
                {"start_month": 0, "end_month": 64, "rent_psf_annual": 47.5},
            ],
        }
    )
    quality = main._supplemental_quality_checks(
        canonical=canonical,
        text="Base Rent and abatement language.",
        extracted_hints={
            "_rate_psf_yr_conflict": "low_high_ambiguity",
            "_rate_psf_yr_candidates": [4.5, 47.5],
        },
    )
    tasks = [t for t in quality["review_tasks"] if isinstance(t, dict)]
    assert any(t.get("issue_code") == "RENT_RATE_AMBIGUOUS" for t in tasks)
    assert any(str(t.get("severity") or "").lower() == "blocker" for t in tasks)


def test_supplemental_quality_checks_blocks_implausible_rent_rate_outlier() -> None:
    canonical = main._dict_to_canonical(
        {
            "building_name": "ATX Tower",
            "suite": "1550",
            "rsf": 5618,
            "commencement_date": "2026-10-01",
            "expiration_date": "2034-04-30",
            "term_months": 91,
            "rent_schedule": [
                {"start_month": 0, "end_month": 90, "rent_psf_annual": 244400.0},
            ],
        }
    )
    quality = main._supplemental_quality_checks(
        canonical=canonical,
        text="Base Rent table extracted from proposal.",
        extracted_hints={"rate_psf_yr": 52.0},
    )
    tasks = [t for t in quality["review_tasks"] if isinstance(t, dict)]
    assert any(t.get("issue_code") == "RENT_RATE_OUTLIER" for t in tasks)
    assert any(str(t.get("severity") or "").lower() == "blocker" for t in tasks)
    assert any("outlier detected" in str(w).lower() for w in quality["warnings"])


def test_derive_field_confidence_penalizes_noisy_building_name() -> None:
    canonical = main._dict_to_canonical(
        {
            "building_name": "the entry off Rialto. Additional information can be found at https://example.com",
            "floor": "3,4",
            "rsf": 114558,
            "commencement_date": "2028-04-01",
            "expiration_date": "2035-08-31",
            "term_months": 89,
            "rent_schedule": [
                {"start_month": 0, "end_month": 88, "rent_psf_annual": 36.0},
            ],
        }
    )
    confidence = main._derive_field_confidence(existing={}, canonical=canonical, extracted_hints={})
    assert confidence["building_name"] <= 0.35
    assert confidence["rsf"] >= 0.75


def test_derive_field_confidence_replaces_zero_placeholders_and_covers_free_rent() -> None:
    canonical = main._dict_to_canonical(
        {
            "building_name": "Benbrook",
            "suite": "200",
            "address": "123 Main St, Austin, TX",
            "rsf": 4626,
            "commencement_date": "2026-12-01",
            "expiration_date": "2034-03-31",
            "term_months": 88,
            "free_rent_months": 8,
            "ti_allowance_psf": 0.0,
            "parking_count": 19,
            "parking_sales_tax_rate": 0.0825,
            "rent_schedule": [
                {"start_month": 0, "end_month": 11, "rent_psf_annual": 26.0},
                {"start_month": 12, "end_month": 23, "rent_psf_annual": 26.78},
            ],
        }
    )
    confidence = main._derive_field_confidence(
        existing={"expiration_date": 0.0, "free_rent_months": 0.0, "ti_allowance_psf": 0.0},
        canonical=canonical,
        extracted_hints={},
    )
    assert confidence["expiration_date"] >= 0.75
    assert confidence["free_rent_months"] >= 0.84
    assert confidence["parking_count"] >= 0.82
    assert confidence["ti_allowance_psf"] >= 0.7


def test_normalize_impl_amendment_retains_inferred_rsf_and_opex_when_not_explicit(monkeypatch) -> None:
    amendment_text = (
        "FIRST AMENDMENT TO LEASE\n"
        "WHEREAS, Landlord and Tenant desire to amend the Lease to extend the term thereof.\n"
        "The Original Term of the Lease is hereby extended for the period commencing on September 1, 2019 "
        "and ending on November 30, 2026.\n"
    )

    monkeypatch.setattr(main, "extract_text_from_pdf", lambda _buf: amendment_text)
    monkeypatch.setattr(main, "text_quality_requires_ocr", lambda _text: False)
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="Extracted lease",
                rsf=10000.0,
                commencement=date(2019, 9, 1),
                expiration=date(2026, 11, 30),
                rent_steps=[RentStep(start=0, end=86, rate_psf_yr=18.5)],
                free_rent_months=0,
                ti_allowance_psf=0.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=10.0,
                base_year_opex_psf_yr=10.0,
                opex_growth=0.03,
                discount_rate_annual=0.08,
            ),
            confidence={"rsf": 0.25, "base_opex_psf_yr": 0.25},
            warnings=[],
            source="pdf_text",
            text_length=len(amendment_text),
        ),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **_kwargs: {
            "provenance": {},
            "review_tasks": [],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.9, "status": "green", "export_allowed": True},
            "canonical_extraction": {},
        },
    )

    upload = UploadFile(filename="first-amendment.pdf", file=BytesIO(b"pdf-bytes"))
    result, _used_ai = main._normalize_impl("rid", "PDF", None, None, upload)

    canonical = result.canonical_lease
    assert canonical.rsf > 0
    assert canonical.opex_psf_year_1 > 0
    assert any("retained inferred RSF value" in str(w) for w in result.warnings)
    assert any("retained inferred OpEx value" in str(w) for w in result.warnings)


def test_normalize_impl_rolls_forward_opex_to_future_commencement_year_when_table_missing(monkeypatch) -> None:
    source_year = max(2026, date.today().year)
    commencement_year = source_year + 1
    commencement_date = date(commencement_year, 5, 1)
    expiration_date = date(commencement_year + 4, 4, 30)
    expected_rolled_opex = round(26.02 * 1.03, 4)

    monkeypatch.setattr(main, "extract_text_from_word", lambda _buf, _name: ("proposal text", "docx"))
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "counter_proposal")
    monkeypatch.setattr(
        main,
        "_extract_lease_hints",
        lambda _text, _filename, _rid: {
            "building_name": "Lamar Central",
            "suite": "230",
            "rsf": 3947.0,
            "commencement_date": commencement_date,
            "expiration_date": expiration_date,
            "term_months": 60,
            "opex_psf_year_1": 26.02,
            "opex_source_year": source_year,
            "opex_growth_rate": 0.03,
            "opex_by_calendar_year": {source_year: 26.02},
        },
    )
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="Lamar Central Suite 230",
                rsf=3947.0,
                commencement=commencement_date,
                expiration=expiration_date,
                rent_steps=[RentStep(start=0, end=59, rate_psf_yr=42.0)],
                free_rent_months=0,
                ti_allowance_psf=0.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=26.02,
                base_year_opex_psf_yr=26.02,
                opex_growth=0.03,
                discount_rate_annual=0.08,
            ),
            confidence={"base_opex_psf_yr": 0.9},
            warnings=[],
            source="docx",
            text_length=120,
        ),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **_kwargs: {
            "provenance": {},
            "review_tasks": [],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.9, "status": "green", "export_allowed": True},
            "canonical_extraction": {},
        },
    )

    upload = UploadFile(filename="lamar-counter.docx", file=BytesIO(b"docx-bytes"))
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)
    canonical = result.canonical_lease

    assert abs(float(canonical.opex_psf_year_1) - expected_rolled_opex) < 1e-4
    assert abs(float(canonical.expense_stop_psf) - expected_rolled_opex) < 1e-4
    assert (
        f"OpEx quoted at $26.02/SF in {source_year}; escalated 3.00% for 1 year"
        in (canonical.notes or "")
    )
    assert f"${expected_rolled_opex:,.2f}/SF used for {commencement_year}." in (canonical.notes or "")


def test_normalize_impl_prefers_ratio_derived_parking_count_over_small_inline_count(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "extract_text_from_word",
        lambda _buf, _name: (
            "Premises: Suite 400 consisting of 4,949 RSF. Parking ratio per 1,000 RSF: 4.0. "
            "Parking: on a must-take basis, four (4) parking spaces at $100 per month.",
            "docx",
        ),
    )
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "sublease")
    monkeypatch.setattr(
        main,
        "_extract_lease_hints",
        lambda _text, _filename, _rid: {
            "building_name": "1300 Guadalupe",
            "suite": "400",
            "rsf": 4949.0,
            "commencement_date": date(2026, 12, 1),
            "expiration_date": date(2037, 6, 30),
            "term_months": 127,
            "parking_ratio": 4.0,
            "parking_count": 4,
            "parking_rate_monthly": 100.0,
        },
    )
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="1300 Guadalupe Suite 400",
                rsf=4949.0,
                commencement=date(2026, 12, 1),
                expiration=date(2037, 6, 30),
                rent_steps=[RentStep(start=0, end=126, rate_psf_yr=33.0)],
                free_rent_months=7,
                ti_allowance_psf=10.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=13.81,
                base_year_opex_psf_yr=13.81,
                opex_growth=0.03,
                discount_rate_annual=0.08,
                parking_spaces=4,
                parking_cost_monthly_per_space=100.0,
            ),
            confidence={"parking_count": 0.6, "parking_ratio": 0.8},
            warnings=[],
            source="docx",
            text_length=240,
        ),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **_kwargs: {
            "provenance": {},
            "review_tasks": [],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.9, "status": "green", "export_allowed": True},
            "canonical_extraction": {},
        },
    )

    upload = UploadFile(filename="tffa-proposal.docx", file=BytesIO(b"docx-bytes"))
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)
    canonical = result.canonical_lease

    assert canonical.parking_ratio == 4.0
    assert canonical.parking_count == 20
    assert canonical.parking_rate_monthly == 100.0


def test_normalize_impl_derives_parking_count_when_only_ratio_present(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "extract_text_from_word",
        lambda _buf, _name: (
            "Premises: Suite 250 consisting of 5,000 RSF. "
            "Parking ratio per 1,000 RSF: 3.2. "
            "Parking is charged at $95 per space per month.",
            "docx",
        ),
    )
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "sublease")
    monkeypatch.setattr(
        main,
        "_extract_lease_hints",
        lambda _text, _filename, _rid: {
            "building_name": "Northpoint",
            "suite": "250",
            "rsf": 5000.0,
            "commencement_date": date(2027, 1, 1),
            "expiration_date": date(2031, 12, 31),
            "term_months": 60,
            "parking_ratio": 3.2,
            "parking_count": None,
            "parking_rate_monthly": 95.0,
        },
    )
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="Northpoint Suite 250",
                rsf=5000.0,
                commencement=date(2027, 1, 1),
                expiration=date(2031, 12, 31),
                rent_steps=[RentStep(start=0, end=59, rate_psf_yr=40.0)],
                free_rent_months=0,
                ti_allowance_psf=0.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=14.0,
                base_year_opex_psf_yr=14.0,
                opex_growth=0.03,
                discount_rate_annual=0.08,
                parking_spaces=0,
                parking_cost_monthly_per_space=95.0,
            ),
            confidence={"parking_ratio": 0.85},
            warnings=[],
            source="docx",
            text_length=180,
        ),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **_kwargs: {
            "provenance": {},
            "review_tasks": [],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.9, "status": "green", "export_allowed": True},
            "canonical_extraction": {},
        },
    )

    upload = UploadFile(filename="proposal.docx", file=BytesIO(b"docx-bytes"))
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)
    canonical = result.canonical_lease

    assert canonical.parking_ratio == 3.2
    assert canonical.parking_count == 16
    assert canonical.parking_rate_monthly == 95.0


def test_normalize_impl_keeps_inline_parking_count_when_ratio_missing(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "extract_text_from_word",
        lambda _buf, _name: (
            "Premises: Suite 400 consisting of 4,949 RSF. "
            "Parking: on a must-take, must-pay basis, four (4) parking spaces at the current rate of $100 per month. "
            "Brokerage: Landlord will pay a market 4.0% commission per separate agreement.",
            "docx",
        ),
    )
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "sublease")
    monkeypatch.setattr(
        main,
        "_extract_lease_hints",
        lambda _text, _filename, _rid: {
            "building_name": "1300 Guadalupe",
            "suite": "400",
            "rsf": 4949.0,
            "commencement_date": date(2026, 12, 1),
            "expiration_date": date(2037, 6, 30),
            "term_months": 127,
            "parking_ratio": None,
            "parking_count": 4,
            "parking_rate_monthly": 100.0,
        },
    )
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="1300 Guadalupe Suite 400",
                rsf=4949.0,
                commencement=date(2026, 12, 1),
                expiration=date(2037, 6, 30),
                rent_steps=[RentStep(start=0, end=126, rate_psf_yr=33.0)],
                free_rent_months=7,
                ti_allowance_psf=10.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=13.81,
                base_year_opex_psf_yr=13.81,
                opex_growth=0.03,
                discount_rate_annual=0.08,
                parking_spaces=4,
                parking_cost_monthly_per_space=100.0,
            ),
            confidence={"parking_count": 0.85},
            warnings=[],
            source="docx",
            text_length=280,
        ),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **_kwargs: {
            "provenance": {},
            "review_tasks": [],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.9, "status": "green", "export_allowed": True},
            "canonical_extraction": {},
        },
    )

    upload = UploadFile(filename="tffa-proposal.docx", file=BytesIO(b"docx-bytes"))
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)
    canonical = result.canonical_lease

    assert round(float(canonical.parking_ratio), 4) == round((4 * 1000.0) / 4949.0, 4)
    assert canonical.parking_count == 4
    assert canonical.parking_rate_monthly == 100.0


def test_normalize_impl_overrides_bad_ai_values_with_document_hints_for_ksd_counter(monkeypatch) -> None:
    ksd_text = (
        "PREMISES: Renewal Suite 100: Approximately 64,800 SF Expansion Suite 200: Approximately 43,200 SF "
        "Second Expansion Suite 300: Approximately 21,600 SF Total Premises: 129,600 SF\n"
        "Expo 11 - Suite 100,200, and 300\n"
        "RENEWAL TERM:\n"
        "Ninety(90) months\n"
        "COMMENCEMENT:\n"
        "September 1, 2026\n"
        "RENEWAL BASE RENT:\n"
        "$13.50NNN with 3.50% annual increases\n"
        "OPERATING EXPENSES:\n"
        "Estimated to be $5.79/sf for 2025.\n"
        "TENANT IMPROVEMENT ALLOWANCE:\n"
        "Landlord shall provide the Tenant a Tenant Improvement allowance equal to $1300 PSF for improvements.\n"
        "Tenant may have the ability to amortize an additional $7.00 PSF at 9% interest over the term of the lease.\n"
        "LL January 21, 2026\n"
    )
    monkeypatch.setattr(main, "extract_text_from_word", lambda _buf, _name: (ksd_text, "docx"))
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "counter_proposal")
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="6231 E Stassney Ln Suite 100",
                rsf=43200.0,
                commencement=date(2026, 9, 1),
                expiration=date(2026, 1, 21),
                rent_steps=[RentStep(start=0, end=89, rate_psf_yr=5.79)],
                free_rent_months=6,
                ti_allowance_psf=0.02,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=5.79,
                base_year_opex_psf_yr=5.79,
                opex_growth=0.03,
                discount_rate_annual=0.08,
            ),
            confidence={"rsf": 0.35, "expiration": 0.35, "rate_psf_yr": 0.35},
            warnings=[],
            source="docx",
            text_length=len(ksd_text),
        ),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **_kwargs: {
            "provenance": {},
            "review_tasks": [],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.9, "status": "green", "export_allowed": True},
            "canonical_extraction": {},
        },
    )

    upload = UploadFile(filename="KSD - LL Counter 1-21-26.docx", file=BytesIO(b"docx-bytes"))
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)
    canonical = result.canonical_lease

    assert canonical.suite == "100,200,300"
    assert canonical.rsf == 129600.0
    assert canonical.commencement_date == date(2026, 9, 1)
    assert canonical.expiration_date == date(2034, 2, 28)
    assert canonical.term_months == 90
    assert canonical.ti_allowance_psf == 13.0
    assert canonical.rent_schedule and canonical.rent_schedule[0].rent_psf_annual == 13.5


def test_normalize_impl_applies_mixed_and_distributed_option_abatements(monkeypatch) -> None:
    option_text = (
        "PREMISES: Medina 2nd Floor - Approximately 14,410 RSF\n"
        "COMMENCEMENT: May 1, 2027\n"
        "TERM: Option One: Sixty-five (65) Months with two (2) months base free rent at the beginning of term. "
        "An additional three (3) months of base rent abatement to be applied during the term, allocated as follows: "
        "Three (3) months in the beginning of lease year 3. "
        "Option Two: Eighty-seven (87) Months two (2) months of gross free rent and two (2) months of base free rent at the beginning of term. "
        "An additional three (3) months of base rent abatement to be applied during the term, allocated as follows: "
        "Two (2) months in the beginning of lease year 3. One (1) month in the beginning of lease year 4.\n"
        "BASE RENT: Option One: Months 01-12: $21.00 NNN with 3% annual increases. "
        "Option Two: Months 01-12: $21.00 NNN with 3% annual increases.\n"
        "OPERATING EXPENSES: Estimated to be $14.30 per RSF.\n"
    )
    monkeypatch.setattr(main, "extract_text_from_word", lambda _buf, _name: (option_text, "docx"))
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "counter_proposal")
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="Medina Bldg Floor 2",
                rsf=14410.0,
                commencement=date(2027, 5, 1),
                expiration=date(2034, 7, 31),
                rent_steps=[RentStep(start=0, end=86, rate_psf_yr=21.0)],
                free_rent_months=3,
                ti_allowance_psf=0.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=14.3,
                base_year_opex_psf_yr=14.3,
                opex_growth=0.03,
                discount_rate_annual=0.08,
            ),
            confidence={"free_rent_months": 0.6},
            warnings=[],
            source="docx",
            text_length=len(option_text),
        ),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **_kwargs: {
            "provenance": {},
            "review_tasks": [],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.9, "status": "green", "export_allowed": True},
            "canonical_extraction": {},
        },
    )

    upload = UploadFile(
        filename="Austin Oaks - Tenant Counter Proposal - Oculus Pathology - 3.3.26.docx",
        file=BytesIO(b"docx-bytes"),
    )
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)

    canonical = result.canonical_lease
    assert canonical.term_months == 87
    assert canonical.free_rent_months == 7
    assert [(p.start_month, p.end_month, p.scope) for p in canonical.free_rent_periods] == [
        (0, 1, "gross"),
        (2, 3, "base"),
        (24, 25, "base"),
        (36, 36, "base"),
    ]

    assert len(result.option_variants) == 2
    option_b = next(v for v in result.option_variants if v.scenario_name.endswith("Option B"))
    assert option_b.free_rent_months == 7
    assert [(p.start_month, p.end_month, p.scope) for p in option_b.free_rent_periods] == [
        (0, 1, "gross"),
        (2, 3, "base"),
        (24, 25, "base"),
        (36, 36, "base"),
    ]


def test_normalize_impl_full_service_forces_zero_opex_when_hints_conflict(monkeypatch) -> None:
    text = (
        "LEASE TYPE: FSG\n"
        "COMMENCEMENT DATE: March 1, 2026\n"
        "LEASE TERM: Through December 31, 2026.\n"
        "BASE RENT: $33.50 per RSF full service gross.\n"
        "OPERATING EXPENSES: Estimated at $16.32/SF.\n"
    )
    monkeypatch.setattr(main, "extract_text_from_word", lambda _buf, _name: (text, "docx"))
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "counter_proposal")
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="Centre I Suite 201",
                rsf=2175.0,
                commencement=date(2026, 3, 1),
                expiration=date(2026, 12, 31),
                rent_steps=[RentStep(start=0, end=9, rate_psf_yr=33.5)],
                free_rent_months=0,
                ti_allowance_psf=0.0,
                opex_mode=OpexMode.FULL_SERVICE,
                base_opex_psf_yr=16.32,
                base_year_opex_psf_yr=16.32,
                opex_growth=0.03,
                discount_rate_annual=0.08,
            ),
            confidence={"opex_mode": 0.8},
            warnings=[],
            source="docx",
            text_length=len(text),
        ),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **_kwargs: {
            "provenance": {},
            "review_tasks": [],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.9, "status": "green", "export_allowed": True},
            "canonical_extraction": {},
        },
    )

    upload = UploadFile(filename="centre1-fsg-counter.docx", file=BytesIO(b"docx-bytes"))
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)
    canonical = result.canonical_lease

    lease_type_value = canonical.lease_type.value if hasattr(canonical.lease_type, "value") else str(canonical.lease_type)
    assert lease_type_value == "Full Service"
    assert canonical.opex_psf_year_1 == 0.0
    assert canonical.expense_stop_psf == 0.0
    assert canonical.opex_growth_rate == 0.0


def test_extract_lease_hints_detects_full_service_rate_cue() -> None:
    text = (
        "COMMENCEMENT DATE: March 1, 2026\n"
        "LEASE TERM: Through December 31, 2026.\n"
        "BASE RENT: $33.50 per RSF full service gross.\n"
        "OPERATING EXPENSES: Estimated at $16.32/SF.\n"
    )
    hints = main._extract_lease_hints(text, "centre1-fsg-lease.pdf", "rid-hints")
    assert hints.get("lease_type") == "Full Service"
    assert float(hints.get("full_service_rate_psf_yr") or 0.0) == 33.5
    assert float(hints.get("opex_psf_year_1") or 0.0) == 0.0


def test_normalize_impl_full_service_rate_cue_overrides_nnn_rate_split(monkeypatch) -> None:
    text = (
        "COMMENCEMENT DATE: March 1, 2026\n"
        "LEASE TERM: Through December 31, 2026.\n"
        "BASE RENT: $33.50 per RSF full service gross.\n"
        "OPERATING EXPENSES: Estimated at $16.32/SF.\n"
    )
    monkeypatch.setattr(main, "extract_text_from_word", lambda _buf, _name: (text, "docx"))
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "lease")
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="Centre I Suite 201",
                rsf=2175.0,
                commencement=date(2026, 3, 1),
                expiration=date(2026, 12, 31),
                rent_steps=[RentStep(start=0, end=9, rate_psf_yr=22.75)],
                free_rent_months=0,
                ti_allowance_psf=0.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=14.5,
                base_year_opex_psf_yr=14.5,
                opex_growth=0.03,
                discount_rate_annual=0.08,
            ),
            confidence={"opex_mode": 0.6},
            warnings=[],
            source="docx",
            text_length=len(text),
        ),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **_kwargs: {
            "provenance": {},
            "review_tasks": [],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.9, "status": "green", "export_allowed": True},
            "canonical_extraction": {},
        },
    )

    upload = UploadFile(filename="centre1-fsg-rate-cue.docx", file=BytesIO(b"docx-bytes"))
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)
    canonical = result.canonical_lease

    lease_type_value = canonical.lease_type.value if hasattr(canonical.lease_type, "value") else str(canonical.lease_type)
    assert lease_type_value == "Full Service"
    assert canonical.opex_psf_year_1 == 0.0
    assert canonical.expense_stop_psf == 0.0
    assert canonical.opex_growth_rate == 0.0
    assert canonical.rent_schedule
    assert abs(float(canonical.rent_schedule[0].rent_psf_annual) - 33.5) < 1e-6


CENTRE_ONE_SUITE_201_TEXT = """
Preamble Building: Centre One Office Building
3103 Bee Caves Rd.
Rollingwood, TX 78746
Premises: Suite 201
Section 1.1(a) Premises: Suite 201, located on the first (1st) floor of the Building.
Net Rentable Square Feet of Premises: approximately 2,175 net rentable square feet.
Lease Commencement Date: The later of January 1, 2022 or the date on which Landlord substantially completes the Tenant Improvement Work in the Premises in accordance with Exhibit E.
If the Lease Commencement Date shall have not occurred by February 28, 2022, Tenant shall have the right to terminate this Lease upon written notice.
Lease Term: Expires at 11:59 p.m. local time on the last day of December, 2026.
Base Rent: Fixed Annual Rent is as follows:
Annual Fixed (Base)
Rental Rate per RSF
$
$
$
$
$
22.00
22.75
23.50
24.25
25.00
Annual (Fixed)
Base Rent (Dollars)
$
$
$
$
$
47,850.00
49,481.25
51,112.50
52,743.75
54,375.00
Monthly Fixed
(Base) Rent
$
$
$
$
$
3,987.50
4,123.44
4,259.38
4,395.31
4,531.25
** This is subject to change upon reconcilation and adjustment.
Using $14.50 as starting Operating Expenses.
Tenant's proportionate share of increases in Operating Expenses is 5.48 %.
Section 7 Number of Parking Space for Tenant/Tenant Employees: 8 spaces. All spaces are open, non-reserved.
ARTICLE 7 PARKING
Tenant shall have the right to use 1 unreserved parking space per 322 square feet in the Premises, or seven (7) unreserved parking spaces.
EXHIBIT B CERTIFICATE OF LEASE COMMENCEMENT DATE AND EXPIRATION OF LEASE TERM
(1) The Lease Commencement Date is January 1, 2022; and
(3) The Lease Term shall expire (unless the Lease is extended or sooner terminated in accordance with the provisions thereof) on December 31, 2026.
"""


def test_extract_lease_hints_centre_one_regression_case() -> None:
    hints = main._extract_lease_hints(CENTRE_ONE_SUITE_201_TEXT, "centre-one-suite-201.pdf", "rid-centre-one")

    assert hints["building_name"] == "Centre One Office Building"
    assert hints["suite"] == "201"
    assert hints["floor"] == "1"
    assert str(hints["commencement_date"]) == "2022-01-01"
    assert str(hints["expiration_date"]) == "2026-12-31"
    assert hints["term_months"] == 60
    assert hints["_parking_count_candidates"] == [7, 8]
    assert hints["_proportionate_share_percentages"] == [5.48]
    assert [float(step["rent_psf_annual"]) for step in hints["rent_schedule"]] == [22.0, 22.75, 23.5, 24.25, 25.0]
    assert [(int(step["start_month"]), int(step["end_month"])) for step in hints["rent_schedule"]] == [
        (0, 11),
        (12, 23),
        (24, 35),
        (36, 47),
        (48, 59),
    ]
    review_codes = {str(task.get("issue_code") or "") for task in list(hints.get("_review_tasks") or [])}
    assert "COMMENCEMENT_RELATIVE_TRIGGER" in review_codes
    assert "PARKING_COUNT_CONFLICT" in review_codes


def test_merge_canonical_primary_then_legacy_rejects_noisy_building_and_short_term() -> None:
    legacy = main._dict_to_canonical(
        {
            "building_name": "Centre One Office Building",
            "suite": "201",
            "floor": "1",
            "address": "3103 Bee Caves Rd",
            "rsf": 2175,
            "commencement_date": "2022-01-01",
            "expiration_date": "2026-12-31",
            "term_months": 60,
            "rent_schedule": [{"start_month": 0, "end_month": 59, "rent_psf_annual": 22.0}],
        }
    )
    extraction = {
        "term": {"commencement_date": "2022-01-01", "expiration_date": "2022-02-28", "term_months": 2},
        "premises": {
            "building_name": "(b) If the Building is less than ninety five percent (95%) occupied during any Operating Year",
            "suite": "135",
            "floor": None,
            "address": "3103 Bee Caves Rd",
            "rsf": 2175,
        },
        "confidence": {"overall": 0.9},
        "provenance": {},
    }

    merged, meta = main._merge_canonical_primary_then_legacy(
        primary_extraction=extraction,
        legacy_canonical=legacy,
        legacy_field_confidence={"building_name": 0.9, "term_months": 0.9},
    )

    assert merged.building_name == "Centre One Office Building"
    assert merged.expiration_date == date(2026, 12, 31)
    assert merged.term_months == 60
    assert meta["field_sources"]["building_name"] == "legacy_fallback"
    assert meta["field_sources"]["expiration_date"] == "legacy_fallback"
    review_codes = {str(task.get("issue_code") or "") for task in list(meta.get("review_tasks") or [])}
    assert "BUILDING_OVERRIDE_NOISY" in review_codes
    assert "TERM_OVERRIDE_SHORT_PRIMARY" in review_codes


def test_normalize_impl_centre_one_regression_retains_floor_and_ignores_share_as_opex_growth(monkeypatch) -> None:
    monkeypatch.setattr(main, "extract_text_from_word", lambda _buf, _name: (CENTRE_ONE_SUITE_201_TEXT, "docx"))
    monkeypatch.setattr(main, "_looks_like_generated_report_document", lambda _text: False)
    monkeypatch.setattr(main, "_detect_document_type", lambda _text, _filename: "lease")
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda _text, _source: ExtractionResponse(
            scenario=Scenario(
                name="Centre One Suite 201",
                rsf=2175.0,
                commencement=date(2022, 1, 1),
                expiration=date(2022, 2, 28),
                rent_steps=[RentStep(start=0, end=11, rate_psf_yr=33.5)],
                free_rent_months=0,
                ti_allowance_psf=0.0,
                opex_mode=OpexMode.NNN,
                base_opex_psf_yr=14.5,
                base_year_opex_psf_yr=14.5,
                opex_growth=0.0548,
                discount_rate_annual=0.08,
                parking_spaces=8,
            ),
            confidence={"expiration": 0.45, "opex_growth_rate": 0.35},
            warnings=[],
            source="docx",
            text_length=len(CENTRE_ONE_SUITE_201_TEXT),
        ),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **_kwargs: {
            "provenance": {},
            "review_tasks": [],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.9, "status": "green", "export_allowed": True},
            "canonical_extraction": {
                "term": {"commencement_date": "2022-01-01", "expiration_date": "2022-02-28", "term_months": 2},
                "premises": {
                    "building_name": "(b) If the Building is less than ninety five percent (95%) occupied during any Operating Year",
                    "suite": "135",
                    "floor": None,
                    "address": "3103 Bee Caves Rd",
                    "rsf": 2175,
                },
                "rent_steps": [{"start_month": 0, "end_month": 11, "rate_psf_annual": 33.5}],
                "opex": {"mode": "nnn", "base_psf_year_1": 14.5, "growth_rate": 0.0548},
                "parking": {"spaces": 8},
                "confidence": {"overall": 0.9},
                "provenance": {},
            },
        },
    )

    upload = UploadFile(filename="centre-one-regression.docx", file=BytesIO(b"docx-bytes"))
    result, _used_ai = main._normalize_impl("rid", "WORD", None, None, upload)
    canonical = result.canonical_lease

    assert canonical.building_name == "Centre One Office Building"
    assert canonical.suite == "201"
    assert canonical.floor == "1"
    assert canonical.expiration_date == date(2026, 12, 31)
    assert canonical.term_months == 60
    assert canonical.opex_psf_year_1 == 14.5
    assert canonical.opex_growth_rate == 0.0
    assert [float(step.rent_psf_annual) for step in list(canonical.rent_schedule or [])] == [22.0, 22.75, 23.5, 24.25, 25.0]
