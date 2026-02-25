from __future__ import annotations

from datetime import date
from io import BytesIO

from docx import Document
from fastapi.testclient import TestClient

from models import ExtractionResponse, OpexMode, RentStep, Scenario
import main
from scenario_extract import extract_text_from_word


def _sample_scenario(name: str = "DOC Option") -> Scenario:
    return Scenario(
        name=name,
        rsf=4626,
        commencement=date(2026, 12, 1),
        expiration=date(2034, 3, 31),
        rent_steps=[RentStep(start=0, end=87, rate_psf_yr=26.0)],
        free_rent_months=8,
        ti_allowance_psf=0.0,
        opex_mode=OpexMode.NNN,
        base_opex_psf_yr=14.3,
        base_year_opex_psf_yr=14.3,
        opex_growth=0.03,
        discount_rate_annual=0.08,
    )


def _sample_extraction_response(source: str = "doc") -> ExtractionResponse:
    return ExtractionResponse(
        scenario=_sample_scenario(),
        confidence={"rsf": 0.95, "commencement": 0.95, "expiration": 0.95},
        warnings=[],
        source=source,
        text_length=800,
    )


def test_extract_text_from_word_detects_docx_signature_even_with_doc_extension() -> None:
    doc = Document()
    doc.add_paragraph("Legacy upload should still parse as DOCX content.")
    buf = BytesIO()
    doc.save(buf)
    buf.seek(0)

    text, source = extract_text_from_word(buf, filename="legacy.doc")
    assert source == "docx"
    assert "Legacy upload should still parse as DOCX content." in text


def test_extract_endpoint_accepts_doc(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "extract_text_from_word",
        lambda file_obj, filename="": ("Building Benbrook Suite 200 4,626 RSF", "doc"),
    )
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda text, source: _sample_extraction_response(source=source),
    )

    client = TestClient(main.app)
    response = client.post(
        "/extract",
        files={"file": ("proposal.doc", b"fake-doc-binary", "application/msword")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("source") == "doc"
    assert payload.get("extraction_source") == "text"


def test_normalize_endpoint_accepts_doc(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "extract_text_from_word",
        lambda file_obj, filename="": (
            "Benbrook Suite 200 4,626 RSF Commencement 12/1/26 Expiration 3/31/34",
            "doc",
        ),
    )
    monkeypatch.setattr(
        main,
        "extract_scenario_from_text",
        lambda text, source: _sample_extraction_response(source=source),
    )
    monkeypatch.setattr(
        main,
        "_run_extraction_artifacts",
        lambda **kwargs: {
            "provenance": {},
            "review_tasks": [],
            "export_allowed": True,
            "extraction_confidence": {
                "overall": 0.95,
                "status": "green",
                "export_allowed": True,
            },
            "canonical_extraction": {},
        },
    )

    client = TestClient(main.app)
    response = client.post(
        "/normalize",
        data={"source": "WORD"},
        files={"file": ("proposal.doc", b"fake-doc-binary", "application/msword")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("canonical_lease")
    assert payload.get("canonical_lease", {}).get("term_months", 0) > 0
