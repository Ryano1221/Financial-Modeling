"""Regression tests for building/suite/address hint extraction from lease text."""

import main


def test_suite_parser_ignores_false_positive_from_parking_space_per_month() -> None:
    text = (
        "Tenant shall be entitled to 50 unreserved parking spaces at $150 per space per month "
        "during Years 1-5."
    )
    assert main._extract_suite_from_text(text) == ""


def test_address_and_building_fallback_from_premises_sentence() -> None:
    text = (
        "Landlord hereby leases to Tenant approximately 12,500 rentable square feet located on the 5th\n"
        "floor of 500 Congress Avenue, Austin, Texas (the \"Premises\")."
    )
    addr = main._extract_address_from_text(text)
    hints = main._extract_lease_hints(text, "example-lease.pdf", "test-rid")
    assert addr == "500 Congress Avenue, Austin, Texas"
    assert hints["address"] == "500 Congress Avenue, Austin, Texas"
    assert hints["building_name"] == "500 Congress Avenue, Austin, Texas"
    assert hints["suite"] == ""


def test_floor_parser_extracts_floor_when_suite_missing() -> None:
    text = (
        "Landlord leases to Tenant premises located on the 7th floor of "
        "500 Congress Avenue, Austin, Texas."
    )
    hints = main._extract_lease_hints(text, "floor-only.pdf", "test-rid")
    assert main._extract_floor_from_text(text) == "7"
    assert hints["floor"] == "7"
    assert hints["suite"] == ""


def test_suite_parser_keeps_alphanumeric_suite_values() -> None:
    text = "Premises: Suite 11C at 123 Main Street, Austin, TX."
    assert main._extract_suite_from_text(text) == "11C"


def test_extract_hints_multiline_located_at_suite_building_clause() -> None:
    text = (
        "Landlord leases to Tenant approximately 3,200 rentable square feet (\"RSF\") located at Suite 110,\n"
        "Barton Creek Plaza, Austin, Texas (the \"Premises\").\n"
    )
    hints = main._extract_lease_hints(text, "lease-example-2.pdf", "test-rid")
    assert hints["suite"] == "110"
    assert hints["building_name"] == "Barton Creek Plaza, Austin, Texas"


def test_extract_hints_prefers_premises_suite_over_notice_addresses() -> None:
    text = (
        "Description of Premises:\n"
        "Suite: 1100\n"
        "After occupancy of the Premises:\n"
        "515 Congress Avenue, Suite 1100\n"
        "14. Addresses for Notices:\n"
        "1703 West 5th Street, Suite 850\n"
        "219 N. 2nd Street, Suite 401\n"
    )
    hints = main._extract_lease_hints(text, "copy-lease.pdf", "test-rid")
    assert hints["suite"] == "1100"
    assert hints["address"].startswith("515 Congress Avenue")
    assert hints["building_name"] == "515 Congress Avenue"


def test_extract_hints_building_commonly_known_pattern() -> None:
    text = (
        "Tenant leases certain premises designated as Suite 1100 in the building commonly known as "
        "the Bank of America Center and located at 515 Congress Avenue, Austin, Texas."
    )
    hints = main._extract_lease_hints(text, "amendment.pdf", "test-rid")
    assert hints["suite"] == "1100"
    assert hints["building_name"] == "Bank of America Center"


def test_extract_hints_prefers_premises_rsf_over_total_and_ratio() -> None:
    text = (
        "Landlord leases to Tenant approximately 3,200 rentable square feet (\"RSF\") located at Suite 110, "
        "Barton Creek Plaza, Austin, Texas (the \"Premises\"). "
        "The shopping center contains approximately 85,000 RSF. "
        "Customer parking shall be provided at a ratio of 4.5 spaces per 1,000 RSF."
    )
    hints = main._extract_lease_hints(text, "lease-example-2.pdf", "test-rid")
    assert hints["rsf"] == 3200


def test_extract_hints_parses_commencement_and_expiration_from_term_clause() -> None:
    text = (
        "Term. Sublessor hereby sublets to Sublessee for the term commencing on the later to occur of "
        "September 1, 2024 and ending on May 31, 2027 (the \"Expiration Date\")."
    )
    hints = main._extract_lease_hints(text, "sublease.pdf", "test-rid")
    assert str(hints["commencement_date"]) == "2024-09-01"
    assert str(hints["expiration_date"]) == "2027-05-31"
    assert hints["term_months"] == 33


def test_extract_hints_prefers_subject_premises_rsf_over_rofr_space() -> None:
    text = (
        "Description of Premises: The Premises is known as Suite 300 located at "
        "8300 North MoPac Expressway, Austin, Texas, and consists of approximately 22,022 rentable square feet.\n"
        "Right of First Refusal Space: Suite 200 containing 16,252 RSF may be offered under separate terms.\n"
    )
    hints = main._extract_lease_hints(text, "mopac-sublease.pdf", "test-rid")
    assert hints["suite"] == "300"
    assert hints["rsf"] == 22022
    assert hints["building_name"] == "8300 North MoPac Expressway, Austin, Texas"


def test_extract_hints_parses_parking_ratio_count_and_monthly_rate() -> None:
    text = (
        "Tenant shall be entitled to 77 unreserved parking spaces at $150 per space per month. "
        "Parking ratio: 3.5 spaces per 1,000 RSF."
    )
    hints = main._extract_lease_hints(text, "lease.pdf", "test-rid")
    assert hints["parking_count"] == 77
    assert hints["parking_rate_monthly"] == 150.0
    assert hints["parking_ratio"] == 3.5


def test_extract_hints_parses_opex_psf_and_source_year() -> None:
    text = (
        "Additional Rent. Operating Expenses for 2025 are estimated at $12.50 per RSF per year. "
        "Tenant shall reimburse such operating expenses monthly."
    )
    hints = main._extract_lease_hints(text, "lease.pdf", "test-rid")
    assert hints["opex_psf_year_1"] == 12.5
    assert hints["opex_source_year"] == 2025


def test_extract_hints_parses_opex_psf_without_year() -> None:
    text = "CAM charges are $9.75/SF and reconciled annually."
    hints = main._extract_lease_hints(text, "lease.pdf", "test-rid")
    assert hints["opex_psf_year_1"] == 9.75
    assert hints["opex_source_year"] is None


def test_extract_hints_parses_gross_rent_abatement_range() -> None:
    text = (
        "Base Rent: $48.00/RSF NNN. "
        "Tenant shall receive gross rent abatement for months 1-6."
    )
    hints = main._extract_lease_hints(text, "lease.pdf", "test-rid")
    assert hints["free_rent_scope"] == "gross"
    assert hints["free_rent_start_month"] == 0
    assert hints["free_rent_end_month"] == 5


def test_extract_hints_parses_phase_rent_schedule() -> None:
    text = (
        "Term: 84 Months\n"
        "Phase I - Initial Occupancy (Months 1-18)\n"
        "Base Rent: $48.00/RSF NNN\n"
        "Phase II - Expansion Premises (Month 19)\n"
        "Base Rent: $50.00/RSF NNN\n"
        "Phase III - Optional Future Expansion (Months 24-48)\n"
        "Rent set at 95% of Market Rate\n"
    )
    hints = main._extract_lease_hints(text, "phase-rent.pdf", "test-rid")
    assert hints["rent_schedule"] == [
        {"start_month": 0, "end_month": 17, "rent_psf_annual": 48.0},
        {"start_month": 18, "end_month": 83, "rent_psf_annual": 50.0},
    ]


def test_extract_hints_phase_rent_prefers_base_rent_over_opex_like_values() -> None:
    text = (
        "Term: 60 months\n"
        "Phase I (Months 1-12)\n"
        "Base Rent: $42.00/RSF/YR\n"
        "Operating Expenses: $5.10/RSF/YR\n"
        "Phase II (Months 13-60)\n"
        "Base Rent: $43.26/RSF/YR\n"
        "Operating Expenses: $5.25/RSF/YR\n"
    )
    hints = main._extract_lease_hints(text, "phase-opex-vs-rent.pdf", "test-rid")
    assert hints["rent_schedule"] == [
        {"start_month": 0, "end_month": 11, "rent_psf_annual": 42.0},
        {"start_month": 12, "end_month": 59, "rent_psf_annual": 43.26},
    ]


def test_note_highlights_include_parking_ratio() -> None:
    text = "Parking ratio shall be 4.0 spaces per 1,000 RSF for the Premises."
    notes = main._extract_lease_note_highlights(text)
    assert any("Parking ratio:" in n for n in notes)


def test_detect_generated_report_document() -> None:
    text = (
        "Lease Economics Comparison\\n"
        "Multi-scenario report generated from stored report payload.\\n"
        "Comparison Matrix\\n"
        "Avg cost/SF/year\\n"
        "Start month End month Rate\\n"
    )
    assert main._looks_like_generated_report_document(text) is True
