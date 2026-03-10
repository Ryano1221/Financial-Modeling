from __future__ import annotations

from extraction.normalize import NormalizedDocument, PageData
from extraction.regex import mine_candidates


def _doc(text: str) -> NormalizedDocument:
    return NormalizedDocument(
        sha256="hardening",
        filename="hardening.docx",
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        pages=[PageData(page_number=1, text=text, words=[], table_regions=[], needs_ocr=False)],
        full_text=text,
    )


def test_regex_normalizes_ocr_spaced_commencement_and_expiration() -> None:
    text = (
        "Broker Summary\n"
        "C o m m e n c e m e n t Date: 09.01.2026\n"
        "E x p i r a t i o n Date: 02.28.2034\n"
        "Lease Term: 90 months\n"
    )
    candidates = mine_candidates(_doc(text))
    comm_vals = [c.get("value") for c in candidates.get("commencement_date", [])]
    exp_vals = [c.get("value") for c in candidates.get("expiration_date", [])]
    term_vals = [int(c.get("value") or 0) for c in candidates.get("term_months", [])]

    assert "2026-09-01" in comm_vals
    assert "2034-02-28" in exp_vals
    assert 90 in term_vals


def test_regex_extracts_multi_value_suite_tokens() -> None:
    text = "Premises: Suite 100,200,300 consisting of 129,600 RSF."
    candidates = mine_candidates(_doc(text))
    suites = [str(c.get("value") or "") for c in candidates.get("suite", [])]
    assert any("100,200,300" in s for s in suites)
