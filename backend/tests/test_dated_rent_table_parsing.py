from __future__ import annotations

from datetime import date

import main


def test_extract_dated_rent_table_accepts_strong_annual_amendment_rows() -> None:
    text = (
        "Base Rent Schedule\n"
        "September 1, 2019 - November 30, 2020 $18.50 $186,498.50 $15,541.54\n"
        "December 1, 2020 - November 30, 2021 $19.00 $191,539.00 $15,961.58\n"
    )

    schedule, rsf = main._extract_dated_rent_table_schedule_and_rsf(text)

    assert schedule == [
        {"start_month": 0, "end_month": 14, "rent_psf_annual": 18.5},
        {"start_month": 15, "end_month": 26, "rent_psf_annual": 19.0},
    ]
    assert abs(float(rsf or 0.0) - 10081.0) < 0.5


def test_extract_dated_rent_table_rejects_dated_monthly_rent_rows() -> None:
    text = (
        "Base Rent Schedule\n"
        "January 1, 2026 - December 31, 2026 Monthly Rent $25,000.00 Annual Rent $300,000.00\n"
        "January 1, 2027 - December 31, 2027 Monthly Rent $26,250.00 Annual Rent $315,000.00\n"
    )

    schedule, rsf = main._extract_dated_rent_table_schedule_and_rsf(text)

    assert schedule == []
    assert rsf is None

    _schedule, _rsf, review_tasks = main._extract_dated_rent_table_schedule_and_rsf_with_review(text)
    monthly_review = next(task for task in review_tasks if task.get("issue_code") == "RENT_ROW_REJECTED_MONTHLY_TOTAL")
    assert monthly_review.get("metadata", {}).get("rejection_category") == "monthly_total"
    assert "Monthly Rent" in monthly_review.get("metadata", {}).get("row_text", "")


def test_extract_dated_rent_table_rejects_ambiguous_three_amount_rows() -> None:
    text = (
        "Base Rent Schedule\n"
        "January 1, 2026 - December 31, 2026 $42.00 $43.00 $44.00\n"
        "January 1, 2027 - December 31, 2027 $45.00 $46.00 $47.00\n"
    )

    schedule, rsf = main._extract_dated_rent_table_schedule_and_rsf(text)

    assert schedule == []
    assert rsf is None

    _schedule, _rsf, review_tasks = main._extract_dated_rent_table_schedule_and_rsf_with_review(text)
    ambiguous_review = next(task for task in review_tasks if task.get("issue_code") == "RENT_ROW_REJECTED_AMBIGUOUS_CURRENCY")
    assert ambiguous_review.get("metadata", {}).get("rejection_category") == "ambiguous_currency"
    assert "$42.00 $43.00 $44.00" in ambiguous_review.get("metadata", {}).get("row_text", "")


def test_extract_dated_rent_table_fragmented_ocr_requires_annual_schedule_context() -> None:
    text = (
        "Monthly Rent\n"
        "Start\n"
        "End\n"
        "Current\n"
        "6/1/2028\n"
        "5/31/2029\n"
        "$3,993,449\n"
        "$30.96\n"
        "6/1/2029\n"
        "5/31/2030\n"
        "$4,073,373\n"
        "$31.58\n"
    )

    schedule, rsf = main._extract_dated_rent_table_schedule_and_rsf(text, commencement_hint=date(2028, 6, 1))

    assert schedule == []
    assert rsf is None

    _schedule, _rsf, review_tasks = main._extract_dated_rent_table_schedule_and_rsf_with_review(
        text,
        commencement_hint=date(2028, 6, 1),
    )
    fragmented_review = next(task for task in review_tasks if task.get("issue_code") == "RENT_ROW_REJECTED_MONTHLY_TOTAL")
    assert fragmented_review.get("metadata", {}).get("rejection_category") == "monthly_total"
    assert "6/1/2028" in fragmented_review.get("metadata", {}).get("row_text", "")
