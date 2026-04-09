from __future__ import annotations

from datetime import date

import main
from models import CanonicalLease


def _stub_canonical() -> CanonicalLease:
    return CanonicalLease.model_validate(
        {
            "scenario_name": "Scanned Lease",
            "building_name": "Lockhill Crossing",
            "suite": "200",
            "rsf": 126626,
            "commencement_date": date(2026, 1, 1),
            "expiration_date": date(2031, 5, 31),
            "term_months": 65,
            "rent_schedule": [{"start_month": 0, "end_month": 64, "rent_psf_annual": 28.5}],
            "opex_psf_year_1": 0,
            "opex_growth_rate": 0.03,
        }
    )


def test_run_extraction_artifacts_skips_pipeline_for_ocr_heavy_pdf(monkeypatch) -> None:
    called = {"build_extract_response": False}

    def _unexpected_build_extract_response(**kwargs):
        called["build_extract_response"] = True
        raise AssertionError("deep extraction pipeline should have been skipped")

    monkeypatch.setattr(main, "build_extract_response", _unexpected_build_extract_response)

    payload = main._run_extraction_artifacts(
        file_bytes=b"fake-pdf",
        filename="Branscomb Law-Executed Lease Agreement.pdf",
        content_type="application/pdf",
        canonical=_stub_canonical(),
        skip_issue_code="PIPELINE_SKIPPED_OCR_HEAVY_PDF",
        skip_message="Deep extraction checks were skipped for an OCR-heavy scanned PDF so lease intake stays responsive.",
    )

    assert called["build_extract_response"] is False
    assert payload["export_allowed"] is True
    assert payload["review_tasks"][0]["issue_code"] == "PIPELINE_SKIPPED_OCR_HEAVY_PDF"
    assert "OCR-heavy scanned PDF" in payload["review_tasks"][0]["message"]
    assert payload["canonical_extraction"]["proposal"]["property_name"] == "Lockhill Crossing"
