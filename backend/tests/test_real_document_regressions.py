from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from fastapi import UploadFile

import main


REPO_ROOT = Path(__file__).resolve().parents[2]
CENTRE_ONE_REAL_PDF_CANDIDATES = [
    Path("/Users/ryanarnold/Downloads/FINAL LEASE FOR CTR1 - #201 - A Glimmer of Hope Foundation - Lease Agreement 4863-3195-4176 5_signed.pdf"),
    Path("/Users/ryanarnold/Library/CloudStorage/OneDrive-JLL/Tenant Rep - 0_AUSTIN TENANT REP-MacBook Pro/0-Client Folder/Signal Wealth Advisors/02 - Lease Docs/00 - Exisiting Lease/FINAL LEASE FOR CTR1 - #201 - A Glimmer of Hope Foundation - Lease Agreement 4863-3195-4176 5_signed.pdf"),
    Path("/Users/ryanarnold/Desktop/Old JLL OneDrive/JLL - Tenant Rep - 0_AUSTIN TENANT REP/0-Client Folder/Signal Wealth Advisors/02 - Lease Docs/00 - Exisiting Lease/FINAL LEASE FOR CTR1 - #201 - A Glimmer of Hope Foundation - Lease Agreement 4863-3195-4176 5_signed.pdf"),
]


@dataclass(frozen=True)
class GoldenCase:
    case_id: str
    filename: str
    text: str | None
    local_path: str | None
    expected: dict[str, Any]


def _load_case_text(case: GoldenCase) -> str:
    if case.text is not None:
        return case.text
    if not case.local_path:
        pytest.skip(f"{case.case_id}: no embedded text or local path")
    path = REPO_ROOT / case.local_path
    if not path.exists():
        pytest.skip(f"{case.case_id}: missing local document {path}")
    if path.suffix.lower() == ".pdf":
        with path.open("rb") as fh:
            return main.extract_text_from_pdf(fh)
    with path.open("rb") as fh:
        text, _source = main.extract_text_from_word(fh, path.name)
        return text


def _assert_expected_hints(hints: dict[str, Any], expected: dict[str, Any]) -> None:
    for field, expected_value in expected.items():
        if field == "rent_schedule_first":
            schedule = hints.get("rent_schedule")
            assert isinstance(schedule, list) and schedule, "expected rent schedule"
            assert schedule[0] == expected_value
            continue
        if field == "required_review_tasks":
            tasks = [task for task in list(hints.get("_review_tasks") or []) if isinstance(task, dict)]
            issue_codes = {str(task.get("issue_code") or "") for task in tasks}
            for issue_code in expected_value:
                assert issue_code in issue_codes
            continue
        actual = hints.get(field)
        assert actual == expected_value, f"{field}: expected {expected_value!r}, got {actual!r}"


def _issue_codes(tasks: list[Any]) -> set[str]:
    codes: set[str] = set()
    for task in tasks or []:
        if hasattr(task, "issue_code"):
            codes.add(str(getattr(task, "issue_code") or ""))
        elif isinstance(task, dict):
            codes.add(str(task.get("issue_code") or ""))
    return codes


def _find_existing_path(candidates: list[Path]) -> Path | None:
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


GOLDEN_CASES: list[GoldenCase] = [
    GoldenCase(
        case_id="simple_sublease_term_clause",
        filename="sublease.pdf",
        text=(
            "Term. Sublessor hereby sublets to Sublessee for the term commencing on the later to occur of "
            "September 1, 2024 and ending on May 31, 2027 (the \"Expiration Date\")."
        ),
        local_path=None,
        expected={
            "commencement_date": date(2024, 9, 1),
            "expiration_date": date(2027, 5, 31),
            "term_months": 33,
            "required_review_tasks": [],
        },
    ),
    GoldenCase(
        case_id="centre_one_lease_text",
        filename="centre-one-lease.pdf",
        text=(
            "BASIC LEASE INFORMATION Preamble Date of Lease: January 1, 2022 "
            "Preamble Building: Centre One Office Building 3103 Bee Caves Rd. Rollingwood, TX 78746 "
            "Section 1.1(a) Premises: Suite 201 Section 1.1(a) Net Rentable Square Feet of Premises: "
            "approximately 2,175 RSF. Section 2.1 Lease Term: Expires at 11:59 p.m. "
            "local time on the last day of December, 2026. Section 2.2 Lease Commencement Date: "
            "The later of January 1, 2022 or the date on which Landlord substantially completes the Tenant "
            "Improvement Work in the Premises in accordance with Exhibit E.\n"
            "Term and upon the terms, conditions, covenants and agreements herein provided, Suite 201, "
            "located on the first (1st) floor of the Building.\n"
            "Concurrently with the signing of this Lease, Tenant shall pay to Landlord a sum equal to one (1) "
            "month's Fixed Monthly Rent.\n"
            "Section 7 Number of Parking Space for Tenant/Tenant Employees: 8 spaces.\n"
            "EXHIBIT E WORK LETTER Landlord will perform the following at its sole cost: Signage, interior "
            "doors in suite, doors in Suite 135, and devising walls between 201 (Tenant) and Suite 200 "
            "(available for Lease).\n"
            "EXHIBIT B CERTIFICATE OF LEASE COMMENCEMENT DATE AND EXPIRATION OF LEASE TERM: "
            "Lease Term shall expire on December 31, 2026.\n"
        ),
        local_path=None,
        expected={
            "building_name": "Centre One Office Building",
            "suite": "201",
            "rsf": 2175.0,
            "commencement_date": date(2022, 1, 1),
            "expiration_date": date(2026, 12, 31),
            "term_months": 60,
            "parking_count": 8,
            "required_review_tasks": [],
        },
    ),
    GoldenCase(
        case_id="sixxguad_sublease_real_text",
        filename="2 - Response - Solarwinds - 6xGuad.docx",
        text=(
            "1703 West 5th Street, Suite 850\n"
            "RE: Non-Binding Proposal to Sublease – 400 W 6th Street – Austin, TX (“6xGuad”) – Subtenant SolarWinds\n"
            "Building & Project Overview | The Project is 66 stories in total with office space and residential units located on floors 34-66.\n"
            "Sublease Premises | Approximately 100,000 Rentable Square Feet (“RSF”). "
            "The Premises will be defined at a later date to be located on 26-28 (92,982 RSF) pending a mutually agreeable architectural test fit.\n"
            "Sublease Term | Expiring on 31, 2036.\n"
            "Rent Commencement Date | April 1, 2028\n"
            "In the event Subtenant operates for business up to twelve (12) months prior to the Rent Commencement Date, "
            "Subtenant shall be responsible for Operating Expenses prior to Rent Commencement.\n"
            "Sublease Term | Expiring on October 31, 2036.\n"
            "Lease Term (Months) | 103 Months\n"
            "Base Rent | $46.00 / RSF / YR NNN with 3% annual escalations beginning in month 13 of Term.\n"
            "Rent Abatement | Nine (9) Months Gross Rent and parking abatement.\n"
            "Operating Expenses | Estimated 2025 Operating Expenses are approximately $28.53/rsf.\n"
            "Subtenant Allowance & Improvements\n"
            "$215.00 per RSF\n"
            "Sublandlord shall provide an allowance equal to the above for construction of improvements (the \"TIA\").\n"
            "Parking | Subtenant will contract for non-exclusive parking at a ratio of 2.76 passes per 1,000 RSF leased "
            "throughout the entire Sublease Term and the current rate for unreserved spaces shall be $200/space/month. "
            "Parking costs shall be abated during the Abatement Period.\n"
        ),
        local_path=None,
        expected={
            "building_name": "6xGuad",
            "floor": "26-28",
            "rsf": 92982.0,
            "commencement_date": date(2028, 4, 1),
            "expiration_date": date(2036, 10, 31),
            "term_months": 103,
            "parking_ratio": 2.76,
            "parking_rate_monthly": 200.0,
            "free_rent_scope": "gross",
            "free_rent_start_month": 0,
            "free_rent_end_month": 8,
            "required_review_tasks": [],
        },
    ),
    GoldenCase(
        case_id="domain_place_counter_docx",
        filename="tmp-domain-place-3.4.26.docx",
        text=None,
        local_path="tmp-domain-place-3.4.26.docx",
        expected={
            "building_name": "Domain Place",
            "suite": "500",
            "rsf": 4165.0,
            "commencement_date": date(2026, 10, 1),
            "expiration_date": date(2033, 3, 31),
            "term_months": 78,
            "rent_schedule_first": {"start_month": 0, "end_month": 17, "rent_psf_annual": 44.5},
            "opex_psf_year_1": 23.08,
            "ti_allowance_psf": 50.0,
            "free_rent_start_month": 0,
            "free_rent_end_month": 5,
            "parking_ratio": 3.0,
            "required_review_tasks": [],
        },
    ),
    GoldenCase(
        case_id="eastlake_proposal_docx",
        filename="tmp-eastlake-proposal.docx",
        text=None,
        local_path="tmp-eastlake-proposal.docx",
        expected={
            "building_name": "Eastlake at Tillery",
            "suite": "1100",
            "rsf": 5900.0,
            "commencement_date": date(2026, 6, 1),
            "expiration_date": date(2030, 5, 31),
            "term_months": 48,
            "rent_schedule_first": {"start_month": 0, "end_month": 11, "rent_psf_annual": 38.0},
            "free_rent_scope": "gross",
            "free_rent_start_month": 0,
            "free_rent_end_month": 3,
            "required_review_tasks": [],
        },
    ),
    GoldenCase(
        case_id="tffa_proposal_docx",
        filename="tmp-tffa-proposal-2.25.26.docx",
        text=None,
        local_path="tmp-tffa-proposal-2.25.26.docx",
        expected={
            "building_name": "1300 Guadalupe",
            "suite": "400",
            "rsf": 4949.0,
            "commencement_date": date(2026, 12, 1),
            "expiration_date": date(2037, 6, 30),
            "term_months": 127,
            "rent_schedule_first": {"start_month": 0, "end_month": 11, "rent_psf_annual": 33.0},
            "opex_psf_year_1": 13.81,
            "free_rent_scope": "base",
            "free_rent_start_month": 0,
            "free_rent_end_month": 6,
            "parking_count": 4,
            "parking_rate_monthly": 100.0,
            "required_review_tasks": [],
        },
    ),
]


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=[case.case_id for case in GOLDEN_CASES])
def test_real_document_hint_regressions(case: GoldenCase) -> None:
    text = _load_case_text(case)
    hints = main._extract_lease_hints(text, case.filename, f"golden-{case.case_id}")
    _assert_expected_hints(hints, case.expected)


def test_real_centre_one_pdf_normalize_regression() -> None:
    pdf_path = _find_existing_path(CENTRE_ONE_REAL_PDF_CANDIDATES)
    if pdf_path is None:
        pytest.skip("Centre One real PDF not available locally")

    upload = UploadFile(filename=pdf_path.name, file=BytesIO(pdf_path.read_bytes()))
    result, used_ai = main._normalize_impl("golden-centre-one-pdf", "PDF", None, None, upload)
    canonical = result.canonical_lease

    assert used_ai is True
    assert canonical.building_name == "Centre One Office Building"
    assert canonical.suite == "201"
    assert canonical.floor == "1"
    assert canonical.rsf == 2175.0
    assert canonical.commencement_date == date(2022, 1, 1)
    assert canonical.expiration_date == date(2026, 12, 31)
    assert canonical.term_months == 60
    assert [float(step.rent_psf_annual) for step in list(canonical.rent_schedule or [])] == [22.0, 22.75, 23.5, 24.25, 25.0]
    assert canonical.opex_psf_year_1 == 14.5
    assert canonical.opex_growth_rate == 0.0
    assert canonical.parking_count == 8

    issue_codes = _issue_codes(list(result.review_tasks or []))
    assert "PARKING_COUNT_CONFLICT" in issue_codes
    assert "RENT_SCHEDULE_COVERAGE" not in issue_codes
