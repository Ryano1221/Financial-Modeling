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
        "Base Rent: Landlord is proposing initial base rent of $42.00 /rsf, net of operating, with 3% annual increases.\n"
        "Operating Expenses: Estimated operating expenses for 2026 are $14.26. 2025 Operating expenses were $14.35.\n"
        "Tenant Improvements: Tenant shall be provided an allowance of $1.50 RSF.\n"
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
    assert hints["ti_allowance_psf"] == 1.5


def test_regex_prefill_prefers_basic_rent_over_opex_line_in_proposal() -> None:
    text = (
        "Building: Vista Ridge\n"
        "Contraction Premises: A demised portion of Suite 450, approximately 5,944 rentable square feet.\n"
        "Term: Sixty-three (63) Months\n"
        "Commencement Date: December 1, 2026\n"
        "Basic Rent: $27.00 per rentable square foot with 3% annual increases beginning in month 13\n"
        "Rental Abatement: The initial three (3) months' base rent shall be abated\n"
        "Operating Expenses: 2026 Operating Expenses are estimated to be $14.50/sf.\n"
    )
    prefill = _regex_prefill(text)

    assert prefill.get("rate_psf_yr") == 27.0
    assert prefill.get("base_opex_psf_yr") == 14.5
    assert prefill.get("_rent_steps_source") == "base_rate_plus_escalation_regex"
    steps = prefill.get("rent_steps")
    assert isinstance(steps, list)
    assert steps[0] == {"start": 0, "end": 11, "rate_psf_yr": 27.0}
    assert steps[-1]["end"] == 62


def test_regex_prefill_parses_label_value_annual_base_rent_escalation() -> None:
    text = (
        "Premises: Suite 230 consisting of 3,947 RSF.\n"
        "Lease Commencement: May 1, 2027\n"
        "Lease Expiration: April 30, 2032\n"
        "Base Rent | $42.00/SF\n"
        "Annual Base Rent Escalation | 3.00%\n"
        "Base Operating Expenses | $26.80/SF\n"
        "Annual Opex Escalation | 3.00%\n"
    )
    prefill = _regex_prefill(text)

    assert prefill.get("_rent_steps_source") == "base_rate_plus_escalation_regex"
    steps = prefill.get("rent_steps")
    assert isinstance(steps, list)
    assert steps[0] == {"start": 0, "end": 11, "rate_psf_yr": 42.0}
    assert steps[1]["rate_psf_yr"] == 43.26
    assert steps[-1]["end"] == 58


def test_regex_prefill_parses_annual_rental_increases_with_percent_after_phrase() -> None:
    text = (
        "Premises: Suite 230 consisting of 3,947 RSF.\n"
        "Commencement Date: May 1, 2027.\n"
        "Lease Term: Sixty (60) months from the Commencement Date.\n"
        "Lease Rate: First year Base Rental Rate: $42.00 NNN\n"
        "Annual Rental Increases: The Base Rental Rate shall increase 3% per year.\n"
        "Base Operating Expenses: $26.80/SF.\n"
        "Parking: Per existing lease.\n"
    )
    prefill = _regex_prefill(text)

    assert prefill.get("_rent_steps_source") == "base_rate_plus_escalation_regex"
    steps = prefill.get("rent_steps")
    assert isinstance(steps, list)
    assert steps[0] == {"start": 0, "end": 11, "rate_psf_yr": 42.0}
    assert steps[1]["rate_psf_yr"] == 43.26
    assert steps[-1]["end"] == 59


def test_extract_lease_hints_builds_escalated_schedule_from_annual_rental_increases_phrase() -> None:
    text = (
        "Building: Lamar Central\n"
        "Premises: Suite 230 consisting of 3,947 RSF.\n"
        "Commencement Date: May 1, 2027.\n"
        "Lease Term: Sixty (60) months from the Commencement Date.\n"
        "Lease Rate: First year Base Rental Rate: $42.00 NNN\n"
        "Annual Rental Increases: The Base Rental Rate shall increase 3% per year.\n"
        "Base Operating Expenses: $26.80/SF.\n"
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")
    schedule = hints.get("rent_schedule")
    assert isinstance(schedule, list)
    assert schedule[0] == {"start_month": 0, "end_month": 11, "rent_psf_annual": 42.0}
    assert schedule[1]["rent_psf_annual"] == 43.26
    assert schedule[-1]["end_month"] == 59


def test_regex_prefill_prefers_tia_per_sf_over_total_budget() -> None:
    text = (
        "Tenant Improvement Allowance (TIA): $35.00 per RSF.\n"
        "Tenant Improvement Budget: $240,000 total buildout allowance.\n"
    )
    prefill = _regex_prefill(text)
    assert prefill.get("ti_allowance_psf") == 35.0


def test_regex_prefill_does_not_treat_test_fit_or_opex_as_ti_allowance() -> None:
    text = (
        "TEST FIT: Landlord shall provide a test-fit allowance of $.12 per square foot, outside of the Tenant Improvement Allowance.\n"
        "Operating Expenses are estimated to be $14.30 per RSF.\n"
    )
    prefill = _regex_prefill(text)
    assert prefill.get("ti_allowance_psf") is None


def test_regex_prefill_parses_ti_allowance_from_tenant_improvements_clause() -> None:
    text = (
        "Tenant Improvements: Premises is part of Landlord's spec suite program.\n"
        "Tenant shall be provided an allowance of $1.50 RSF for power to furniture.\n"
    )
    prefill = _regex_prefill(text)
    assert prefill.get("ti_allowance_psf") == 1.5


def test_regex_prefill_parses_total_ti_allowance_and_converts_to_psf() -> None:
    text = (
        "Premises: Suite 230 consisting of 3,947 RSF.\n"
        "Tenant Improvement Allowance: Owner shall provide Tenant with a Tenant Improvement Allowance of $50,000.00.\n"
    )
    prefill = _regex_prefill(text)
    assert prefill.get("ti_allowance_total") == 50000.0
    assert abs(float(prefill.get("ti_allowance_psf") or 0.0) - (50000.0 / 3947.0)) < 0.01


def test_extract_lease_hints_parses_total_ti_allowance_in_docx_style_text() -> None:
    text = (
        "Building: Lamar Central\n"
        "Premises: Suite 230 consisting of 3,947 RSF.\n"
        "Commencement Date: May 1, 2027.\n"
        "Lease Term: Sixty (60) months from the Commencement Date.\n"
        "Tenant Improvement Allowance: Owner shall provide Tenant with a Tenant Improvement Allowance, of $50,000.00.\n"
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")
    assert hints.get("ti_allowance_total") == 50000.0
    assert abs(float(hints.get("ti_allowance_psf") or 0.0) - (50000.0 / 3947.0)) < 0.01


def test_regex_prefill_ignores_timeline_dates_and_parses_ordinal_and_through_dates() -> None:
    text = (
        "LL Proposal: November 12, 2025\n"
        "Tenant Response December 23, 2025\n"
        "BUILDING: | Aspen Lake 2 - 10124 Lake Creek Pkwy | Aspen Lake 2 - 10124 Lake Creek Pkwy\n"
        "PREMISES: | 128,990 rentable square feet making up the entire Building.\n"
        "COMMENCEMENT DATE: | May 1st, 2028.\n"
        "LEASE TERM: | Through August, 30, 2033.\n"
        "BASE ANNUAL NET RENTAL RATE: | Months 1-12: Annual Base Rent: $29.69/RSF\n"
    )
    prefill = _regex_prefill(text)

    assert prefill.get("commencement") == "2028-05-01"
    assert prefill.get("expiration") == "2033-08-30"
    assert prefill.get("term_months") in {63, 64}
    assert prefill.get("name") == "Aspen Lake 2"
