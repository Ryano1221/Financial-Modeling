from __future__ import annotations

from extraction.normalize import NormalizedDocument, PageData
from extraction.regex import mine_candidates
from extraction.reconcile import reconcile


def _doc(text: str) -> NormalizedDocument:
    return NormalizedDocument(
        sha256="fixture",
        filename="fixture.docx",
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        pages=[PageData(page_number=1, text=text, words=[], table_regions=[], needs_ocr=False)],
        full_text=text,
    )


def _assert_no_gaps_or_overlaps(rent_steps: list[dict], term_months: int) -> None:
    assert rent_steps, "rent schedule missing"
    expected = 0
    for step in sorted(rent_steps, key=lambda s: (int(s.get("start_month") or 0), int(s.get("end_month") or 0))):
        start = int(step.get("start_month") or 0)
        end = int(step.get("end_month") or start)
        assert start == expected, f"expected start {expected}, got {start}"
        assert end >= start, f"invalid range {start}-{end}"
        expected = end + 1
    assert expected - 1 == term_months - 1


def _run_solver(text: str, rent_steps: list[dict]) -> dict:
    regex_candidates = mine_candidates(_doc(text))
    out = reconcile(regex_candidates=regex_candidates, rent_step_candidates=rent_steps, llm_output=None)
    return out


def test_redlined_lease_prefers_amended_term_and_remains_contiguous() -> None:
    text = (
        "FIRST AMENDMENT TO LEASE\n"
        "WHEREAS, the original term was scheduled to expire on April 30, 2031.\n"
        "The Lease Term is hereby amended to sixty-three (63) months.\n"
        "Commencement Date: 05/01/2027\n"
        "Expiration Date: 07/31/2032\n"
    )
    rent_steps = [
        {"start_month": 0, "end_month": 11, "rate_psf_annual": 42.0, "source": "table_parser", "source_confidence": 0.8, "snippet": "Base Rent Schedule Exhibit A", "page": 1, "bbox": None},
        {"start_month": 12, "end_month": 23, "rate_psf_annual": 43.26, "source": "table_parser", "source_confidence": 0.8, "snippet": "Base Rent Schedule Exhibit A", "page": 1, "bbox": None},
        {"start_month": 24, "end_month": 35, "rate_psf_annual": 44.56, "source": "table_parser", "source_confidence": 0.8, "snippet": "Base Rent Schedule Exhibit A", "page": 1, "bbox": None},
        {"start_month": 36, "end_month": 47, "rate_psf_annual": 45.9, "source": "table_parser", "source_confidence": 0.8, "snippet": "Base Rent Schedule Exhibit A", "page": 1, "bbox": None},
        {"start_month": 48, "end_month": 59, "rate_psf_annual": 47.28, "source": "table_parser", "source_confidence": 0.8, "snippet": "Base Rent Schedule Exhibit A", "page": 1, "bbox": None},
        {"start_month": 60, "end_month": 62, "rate_psf_annual": 47.28, "source": "table_parser", "source_confidence": 0.8, "snippet": "Base Rent Schedule Exhibit A", "page": 1, "bbox": None},
    ]

    first = _run_solver(text, rent_steps)
    second = _run_solver(text, rent_steps)
    assert first.get("resolved") == second.get("resolved"), "solver must be deterministic"

    resolved = first.get("resolved") or {}
    term = resolved.get("term") or {}
    term_months = int(term.get("term_months") or 0)
    assert term_months in {62, 63}
    assert str(term.get("commencement_date") or "") == "2027-05-01"
    assert str(term.get("expiration_date") or "") == "2032-07-31"
    _assert_no_gaps_or_overlaps(resolved.get("rent_steps") or [], max(1, term_months))


def test_sublease_overrides_prime_reference_when_explicitly_amended() -> None:
    text = (
        "Prime Lease term is 120 months from January 1, 2020 through December 31, 2029.\n"
        "SUBLEASE TERM is hereby amended to thirty-three (33) months commencing 02/01/2034 and expiring 10/31/2036.\n"
    )
    rent_steps = [
        {"start_month": 0, "end_month": 32, "rate_psf_annual": 46.0, "source": "table_parser", "source_confidence": 0.78, "snippet": "Sublease Base Rent Schedule", "page": 1, "bbox": None}
    ]

    out = _run_solver(text, rent_steps)
    term = ((out.get("resolved") or {}).get("term") or {})
    term_months = int(term.get("term_months") or 0)
    assert term_months in {32, 33}
    _assert_no_gaps_or_overlaps(((out.get("resolved") or {}).get("rent_steps") or []), max(1, term_months))


def test_counter_revised_schedule_wins_over_original_option() -> None:
    text = (
        "COUNTER PROPOSAL\n"
        "Commencement Date: 05/01/2027\n"
        "Expiration Date: 04/30/2032\n"
        "Lease Term: 60 months\n"
        "Option 2 is amended to replace Option 1 base rent schedule.\n"
    )
    rent_steps = [
        {"start_month": 0, "end_month": 59, "rate_psf_annual": 45.0, "source": "table_parser", "source_confidence": 0.71, "snippet": "Option 1 base rent schedule", "page": 1, "bbox": None},
        {"start_month": 0, "end_month": 59, "rate_psf_annual": 42.0, "source": "table_parser", "source_confidence": 0.70, "snippet": "Option 2 amended to revised base rent schedule", "page": 1, "bbox": None},
    ]

    out = _run_solver(text, rent_steps)
    resolved_steps = ((out.get("resolved") or {}).get("rent_steps") or [])
    assert resolved_steps and abs(float(resolved_steps[0].get("rate_psf_annual") or 0.0) - 42.0) < 1e-6


def test_weird_year_index_schedule_is_expanded_to_month_ranges() -> None:
    text = (
        "Commencement Date: 01/01/2027\n"
        "Expiration Date: 12/31/2031\n"
        "Lease Term: 60 months\n"
    )
    rent_steps = [
        {"start_month": 1, "end_month": 1, "rate_psf_annual": 40.0, "source": "table_parser", "source_confidence": 0.8, "snippet": "Year 1 | $40.00 / SF", "page": 1, "bbox": None},
        {"start_month": 2, "end_month": 2, "rate_psf_annual": 41.2, "source": "table_parser", "source_confidence": 0.8, "snippet": "Year 2 | $41.20 / SF", "page": 1, "bbox": None},
        {"start_month": 3, "end_month": 3, "rate_psf_annual": 42.44, "source": "table_parser", "source_confidence": 0.8, "snippet": "Year 3 | $42.44 / SF", "page": 1, "bbox": None},
        {"start_month": 4, "end_month": 4, "rate_psf_annual": 43.71, "source": "table_parser", "source_confidence": 0.8, "snippet": "Year 4 | $43.71 / SF", "page": 1, "bbox": None},
        {"start_month": 5, "end_month": 5, "rate_psf_annual": 45.02, "source": "table_parser", "source_confidence": 0.8, "snippet": "Year 5 | $45.02 / SF", "page": 1, "bbox": None},
    ]

    out = _run_solver(text, rent_steps)
    resolved = out.get("resolved") or {}
    steps = resolved.get("rent_steps") or []
    assert steps[0]["start_month"] == 0 and steps[0]["end_month"] == 11
    assert steps[-1]["end_month"] == 59
    _assert_no_gaps_or_overlaps(steps, 60)


def test_modified_gross_expense_stop_and_abatement_scope_from_definitions() -> None:
    text = (
        "Lease Type: Modified Gross with Base Year Expense Stop.\n"
        "Operating Expenses estimate: $12.50/SF.\n"
        "Commencement Date: 01/01/2027\n"
        "Expiration Date: 12/31/2031\n"
        "Lease Term: 60 months\n"
        "Rent means Base Rent plus Additional Rent.\n"
        "Tenant shall receive rent abatement for months 1-2.\n"
    )
    rent_steps = [
        {"start_month": 0, "end_month": 59, "rate_psf_annual": 40.0, "source": "table_parser", "source_confidence": 0.78, "snippet": "Base Rent schedule", "page": 1, "bbox": None}
    ]

    out = _run_solver(text, rent_steps)
    resolved = out.get("resolved") or {}
    opex = resolved.get("opex") or {}
    assert str(opex.get("mode") or "") == "base_year"
    assert float(opex.get("base_psf_year_1") or 0.0) > 0

    abatements = resolved.get("abatements") or []
    assert abatements and abatements[0].get("scope") == "gross_rent"
