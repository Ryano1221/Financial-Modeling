"""Regression tests for DOCX proposal/LOI parsing quality."""

from __future__ import annotations

from io import BytesIO

from docx import Document

import main
from scenario_extract import _regex_prefill, extract_text_from_docx


def test_extract_text_from_docx_includes_table_rows() -> None:
    doc = Document()
    doc.add_paragraph("Phase-In: Tenant shall pay based on the following RSF.")
    table = doc.add_table(rows=2, cols=2)
    table.rows[0].cells[0].text = "Months 1 - 12"
    table.rows[0].cells[1].text = "3,300 RSF"
    table.rows[1].cells[0].text = "Months 13 - 24"
    table.rows[1].cells[1].text = "4,600 RSF"
    buf = BytesIO()
    doc.save(buf)
    buf.seek(0)

    text = extract_text_from_docx(buf)
    assert "Months 1 - 12 | 3,300 RSF" in text
    assert "Months 13 - 24 | 4,600 RSF" in text


def test_regex_prefill_parses_docx_proposal_month_phrase_schedule() -> None:
    text = (
        "Premises: Spec Suite 1100 consisting of 5,900 rentable square feet (RSF) on the first (1st) floor of Building 1.\n"
        "Commencement Date: Earlier of occupancy or June 1, 2026.\n"
        "Lease Term: Forty-eight (48) months.\n"
        "Abatement: The first four (4) months of Gross Rent following the Commencement Date shall be abated.\n"
        "Base Rent Schedule: $38.00 per RSF NNN for months 1-12 with 3% annual escalations starting in month 13.\n"
        "Tenant Allowance: Landlord shall provide Tenant with an allowance of up to $5.00 per RSF.\n"
        "Operating Expenses for 2026 are currently estimated to be $21.97 per RSF.\n"
    )
    prefill = _regex_prefill(text)

    assert prefill.get("rsf") == 5900.0
    assert prefill.get("commencement") == "2026-06-01"
    assert prefill.get("term_months") == 48
    assert prefill.get("free_rent_months") == 4
    assert prefill.get("ti_allowance_psf") == 5.0
    assert prefill.get("base_opex_psf_yr") == 21.97
    assert prefill.get("_rent_steps_source") == "month_phrase_regex"
    steps = prefill.get("rent_steps")
    assert isinstance(steps, list)
    assert steps[0] == {"start": 0, "end": 11, "rate_psf_yr": 38.0}
    assert steps[-1]["end"] == 47


def test_extract_lease_hints_parses_loi_term_suite_and_opex_from_docx_style_text() -> None:
    text = (
        "Building: Eastbound - 3232 E. Cesar Chavez St. Austin, Texas 78702 - Building 2.\n"
        "Premises: Option 1 - 3,226 RSF located in Suite 2-380.\n"
        "Lease Commencement: estimated to be May 1, 2026.\n"
        "Lease Term: Landlord is proposing a 52 month term.\n"
        "Operating Expenses: Estimated operating expenses for 2026 are $14.26. 2025 Operating expenses were $14.35.\n"
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")

    assert hints["building_name"] == "Eastbound - 3232 E. Cesar Chavez St. Austin"
    assert hints["suite"] == "2-380"
    assert hints["rsf"] == 3226.0
    assert str(hints["commencement_date"]) == "2026-05-01"
    assert hints["term_months"] == 52
    assert str(hints["expiration_date"]) == "2030-08-31"
    assert hints["opex_psf_year_1"] == 14.26
    assert hints["opex_source_year"] == 2026

