from __future__ import annotations

from extraction.normalize import NormalizedDocument, PageData, TableRegion
from extraction.tables import extract_rent_step_candidates, extract_rent_step_candidates_with_review


def _doc_with_lines(text: str) -> NormalizedDocument:
    return NormalizedDocument(
        sha256="rent-lines",
        filename="rent-lines.pdf",
        content_type="application/pdf",
        pages=[PageData(page_number=1, text=text, words=[], table_regions=[], needs_ocr=False)],
        full_text=text,
    )


def _doc_with_table(rows: list[list[str]]) -> NormalizedDocument:
    return NormalizedDocument(
        sha256="rent-table",
        filename="rent-table.pdf",
        content_type="application/pdf",
        pages=[
            PageData(
                page_number=1,
                text="\n".join(" | ".join(row) for row in rows),
                words=[],
                table_regions=[TableRegion(page=1, bbox=(0.0, 0.0, 100.0, 100.0), rows=rows, source="pdfplumber_table")],
                needs_ocr=False,
            )
        ],
        full_text="\n".join(" | ".join(row) for row in rows),
    )


def test_extract_rent_step_candidates_accepts_annual_psf_table_row() -> None:
    normalized = _doc_with_table(
        [
            ["Lease Year", "Annual Base Rent / SF"],
            ["Year 1", "$42.00 PSF"],
            ["Year 2", "$43.50 PSF"],
        ]
    )

    candidates = extract_rent_step_candidates(normalized)

    assert len(candidates) == 2
    assert candidates[0]["start_month"] == 0
    assert candidates[0]["end_month"] == 11
    assert candidates[0]["rate_psf_annual"] == 42.0
    assert candidates[1]["start_month"] == 12
    assert candidates[1]["end_month"] == 23
    assert candidates[1]["rate_psf_annual"] == 43.5


def test_extract_rent_step_candidates_rejects_monthly_total_rent_lines() -> None:
    normalized = _doc_with_lines(
        "Lease Year 1 Monthly Rent $25,000\n"
        "Lease Year 2 Monthly Rent $26,250\n"
    )

    candidates = extract_rent_step_candidates(normalized)

    assert candidates == []

    candidates_with_review, review_tasks = extract_rent_step_candidates_with_review(normalized)
    assert candidates_with_review == []
    assert any(task.get("issue_code") == "RENT_ROW_REJECTED_MONTHLY_TOTAL" for task in review_tasks)
    monthly_review = next(task for task in review_tasks if task.get("issue_code") == "RENT_ROW_REJECTED_MONTHLY_TOTAL")
    assert "Monthly Rent $25,000" in monthly_review.get("metadata", {}).get("row_text", "")
    assert monthly_review.get("metadata", {}).get("rejection_category") == "monthly_total"


def test_extract_rent_step_candidates_rejects_annual_total_rent_table_rows() -> None:
    normalized = _doc_with_table(
        [
            ["Lease Year", "Annual Rent"],
            ["Year 1", "$300,000"],
            ["Year 2", "$315,000"],
        ]
    )

    candidates = extract_rent_step_candidates(normalized)

    assert candidates == []

    candidates_with_review, review_tasks = extract_rent_step_candidates_with_review(normalized)
    assert candidates_with_review == []
    assert any(task.get("issue_code") == "RENT_ROW_REJECTED_WEAK_CONTEXT" for task in review_tasks)
    annual_review = next(task for task in review_tasks if task.get("issue_code") == "RENT_ROW_REJECTED_WEAK_CONTEXT")
    assert "Year 1 | $300,000" in annual_review.get("metadata", {}).get("row_text", "")
    assert annual_review.get("metadata", {}).get("rejection_reason")


def test_extract_rent_step_candidates_rejects_loose_dollar_lines_without_psf_context() -> None:
    normalized = _doc_with_lines(
        "Year 1 Base Rent is $42.00\n"
        "Year 2 Base Rent is $43.00\n"
    )

    candidates = extract_rent_step_candidates(normalized)

    assert candidates == []

    candidates_with_review, review_tasks = extract_rent_step_candidates_with_review(normalized)
    assert candidates_with_review == []
    assert any(task.get("issue_code") == "RENT_ROW_REJECTED_AMBIGUOUS_CURRENCY" for task in review_tasks)
    loose_review = next(task for task in review_tasks if task.get("issue_code") == "RENT_ROW_REJECTED_AMBIGUOUS_CURRENCY")
    assert loose_review.get("metadata", {}).get("rejection_category") == "ambiguous_currency"


def test_extract_rent_step_candidates_rejects_monthly_psf_lines_instead_of_converting() -> None:
    normalized = _doc_with_lines(
        "Year 1 Monthly Base Rent $3.50 / SF / Month\n"
        "Year 2 Monthly Base Rent $3.65 / SF / Month\n"
    )

    candidates = extract_rent_step_candidates(normalized)

    assert candidates == []

    candidates_with_review, review_tasks = extract_rent_step_candidates_with_review(normalized)
    assert candidates_with_review == []
    assert any(task.get("issue_code") == "RENT_ROW_REJECTED_MONTHLY_PSF" for task in review_tasks)
    monthly_psf_review = next(task for task in review_tasks if task.get("issue_code") == "RENT_ROW_REJECTED_MONTHLY_PSF")
    assert monthly_psf_review.get("metadata", {}).get("rejection_category") == "monthly_psf"
