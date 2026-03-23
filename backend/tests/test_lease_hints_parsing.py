"""Regression tests for building/suite/address hint extraction from lease text."""

from datetime import date

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


def test_floor_normalizer_rejects_preposition_tokens() -> None:
    assert main._normalize_floor_candidate("on") == ""


def test_extract_hints_basic_info_table_prefers_subject_suite_and_term_over_exhibit_noise() -> None:
    text = (
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
    )
    hints = main._extract_lease_hints(text, "centre-one-lease.pdf", "test-rid")

    assert hints["building_name"] == "Centre One Office Building"
    assert hints["suite"] == "201"
    assert hints["floor"] != "ON"
    assert hints["rsf"] == 2175.0
    assert str(hints["commencement_date"]) == "2022-01-01"
    assert str(hints["expiration_date"]) == "2026-12-31"
    assert hints["term_months"] == 60
    assert hints["parking_count"] == 8
    assert 3.0 < float(hints["parking_ratio"] or 0.0) < 4.0


def test_extract_hints_multiline_located_at_suite_building_clause() -> None:
    text = (
        "Landlord leases to Tenant approximately 3,200 rentable square feet (\"RSF\") located at Suite 110,\n"
        "Barton Creek Plaza, Austin, Texas (the \"Premises\").\n"
    )
    hints = main._extract_lease_hints(text, "lease-example-2.pdf", "test-rid")
    assert hints["suite"] == "110"
    assert hints["building_name"] == "Barton Creek Plaza, Austin, Texas"


def test_extract_hints_foster_style_letter_prefers_building_name_over_boilerplate() -> None:
    text = (
        "RE: Lease Renewal Proposal for Foster LLP\n"
        "Thank you for the opportunity to present the following proposal. We are very interested in continuing "
        "our relationship with your client as a tenant at Vista Ridge.\n"
        "Address: 912 S. Capital of Texas Hwy, Austin, TX 78746\n"
        "Contraction Premises: Suite 450 containing approximately 5,944 RSF\n"
        "Term: Sixty-three (63) months\n"
    )
    hints = main._extract_lease_hints(text, "renewal-proposal.docx", "test-rid")
    assert hints["building_name"] == "Vista Ridge"
    assert hints["address"] == "912 S. Capital of Texas Hwy, Austin, TX 78746"
    assert hints["suite"] == "450"
    assert hints["rsf"] == 5944.0
    assert hints["term_months"] == 63


def test_extract_hints_re_office_space_strips_city_from_building_name_and_seeds_rent_schedule() -> None:
    text = (
        "RE: Tenant Counter Proposal for Office Space at Domain Place in Austin, Texas\n"
        "Premises: Portion of suite 500 for a total of approximately 4,165 rentable square feet.\n"
        "Commencement Date: October 1, 2026\n"
        "Lease Term: Seventy-eight (78) months\n"
        "Lease Rate: $44.50 per square foot per year NNN with three percent (2.75%) annual escalations beginning month 19.\n"
        "Operating Expenses: estimated to be $23.08 per square foot for 2026.\n"
    )
    hints = main._extract_lease_hints(text, "PFM - Domain Place LL Counter 3.4.26.docx", "test-rid")

    assert hints["building_name"] == "Domain Place"
    assert hints["suite"] == "500"
    assert hints["rsf"] == 4165.0
    assert hints["term_months"] == 78
    assert str(hints["commencement_date"]) == "2026-10-01"
    assert str(hints["expiration_date"]) == "2033-03-31"
    schedule = hints.get("rent_schedule")
    assert isinstance(schedule, list)
    assert schedule[0] == {"start_month": 0, "end_month": 17, "rent_psf_annual": 44.5}
    assert schedule[1] == {"start_month": 18, "end_month": 29, "rent_psf_annual": 45.72}
    assert schedule[-1]["rent_psf_annual"] == 50.96
    assert schedule[-1]["end_month"] == 77


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


def test_extract_hints_ignores_notice_months_and_keeps_primary_lease_term() -> None:
    text = (
        "COMMENCEMENT DATE: The Commencement Date shall be the earlier of "
        "(i) Tenant occupying the Premises for business purposes, "
        "(ii) substantial completion of Tenant Improvements or "
        "(iii) October 1, 2026.\n"
        "LEASE TERM: Eighty-eight (88) months from the Commencement Date.\n"
        "free base rent: Tenant shall receive four (4) months of abated base rent at the beginning of the lease term.\n"
        "TERMINATION RIGHT: Tenant may terminate in month 64 by providing at least 12 months prior written notice.\n"
    )
    hints = main._extract_lease_hints(text, "ibc-proposal.docx", "test-rid")

    assert hints["term_months"] == 88
    assert str(hints["commencement_date"]) == "2026-10-01"
    assert str(hints["expiration_date"]) == "2034-01-31"


def test_extract_hints_derives_relative_commencement_and_rsf_from_premises_clause() -> None:
    text = (
        "PREMISES: Suite 1550: a 5,618 Rentable Square Foot (RSF) spec suite to be built on a portion of the 15th Floor.\n"
        "Lease Commencement: 30 days following substantial completion of the Landlord's Work to deliver the spec suites.\n"
        "INITIAL TERM: Ninety-one (91) Months.\n"
        "Base Rental Rate: Months 1-7: $0.00 PSF + NNN.\n"
        "Months 8-12: $52.00 PSF + NNN.\n"
        "Starting month 13, the proposed rental rate shall escalate by 3.0% annually.\n"
        "Landlord's work: These spec suites currently have a delivery date of August 15, 2026.\n"
        "Next-level amenities: 7,000 SF fitness center and rooftop sky lounge.\n"
    )
    hints = main._extract_lease_hints(text, "atx-proposal.docx", "test-rid")

    assert hints["rsf"] == 5618.0
    assert hints["term_months"] == 91
    assert str(hints["commencement_date"]) == "2026-10-01"
    assert str(hints["expiration_date"]) == "2034-04-30"


def test_extract_hints_carries_dated_rent_review_tasks() -> None:
    text = (
        "Base Rent Schedule\n"
        "January 1, 2026 - December 31, 2026 Monthly Rent $25,000.00 Annual Rent $300,000.00\n"
        "January 1, 2027 - December 31, 2027 Monthly Rent $26,250.00 Annual Rent $315,000.00\n"
    )

    hints = main._extract_lease_hints(text, "amendment.pdf", "test-rid")

    review_tasks = [task for task in list(hints.get("_review_tasks") or []) if isinstance(task, dict)]
    monthly_review = next(task for task in review_tasks if task.get("issue_code") == "RENT_ROW_REJECTED_MONTHLY_TOTAL")
    assert monthly_review.get("metadata", {}).get("rejection_category") == "monthly_total"
    assert "Monthly Rent $25,000.00" in monthly_review.get("metadata", {}).get("row_text", "")


def test_extract_hints_amendment_prefers_extended_term_not_whereas_schedule() -> None:
    text = (
        "WHEREAS, the term of the Lease is scheduled to expire on August 31, 2019; and\n"
        "NOW, THEREFORE, Landlord and Tenant agree the Lease is hereby amended as follows:\n"
        "The Original Term of the Lease is hereby extended for the period commencing on September 1, 2019 "
        "and ending on November 30, 2026.\n"
    )
    hints = main._extract_lease_hints(text, "first-amendment.pdf", "test-rid")
    assert str(hints["commencement_date"]) == "2019-09-01"
    assert str(hints["expiration_date"]) == "2026-11-30"
    assert hints["term_months"] == 87


def test_extract_hints_amendment_dated_rent_table_derives_schedule_and_rsf() -> None:
    text = (
        "WHEREAS, B&G Vista Ridge, L.P. (\"Original Landlord\") and Tenant entered into the Lease.\n"
        "The Original Term of the Lease is hereby extended for the period commencing on September 1, 2019 "
        "and ending on November 30, 2026.\n"
        "For the period commencing on September 1, 2019 and ending on November 30, 2026, Tenant shall pay "
        "Annual Fixed Rent in accordance with the following schedule:\n"
        "Period Base Rent (per rentable square foot per annum) Base Rent (per annum) Monthly Installment\n"
        "September 1, 2019 – November 30, 2020 $18.50 $186,498.50 $15,541.54\n"
        "December 1, 2020 – November 30, 2021 $19.00 $191,539.00 $15,961.58\n"
    )
    hints = main._extract_lease_hints(text, "first-amendment.pdf", "test-rid")
    assert hints["building_name"] == "Vista Ridge"
    assert isinstance(hints["rent_schedule"], list) and len(hints["rent_schedule"]) >= 2
    assert hints["rent_schedule"][0] == {"start_month": 0, "end_month": 14, "rent_psf_annual": 18.5}
    assert hints["rent_schedule"][1] == {"start_month": 15, "end_month": 26, "rent_psf_annual": 19.0}
    assert abs(float(hints["rsf"]) - 10081.0) < 0.01
    assert int(hints["_rsf_score"]) >= 8


def test_extract_dated_rent_table_parses_fragmented_ocr_schedule_and_aligns_to_commencement() -> None:
    text = (
        "Annual Rent\n"
        "Start\n"
        "End\n"
        "Current\n"
        "5/31/2026\n"
        "$3,762,638\n"
        "$29.17\n"
        "6/1/2026\n"
        "5/31/2027\n"
        "$3,837,453\n"
        "$29.75\n"
        "6/1/2027\n"
        "5/31/2028\n"
        "$3,914,847\n"
        "$30.35\n"
        "6/1/2028\n"
        "5/31/2029\n"
        "$3,993,449\n"
        "$30.96\n"
        "2.0%\n"
        "6/1/2029\n"
        "5/31/2030\n"
        "$4,073,373\n"
        "$31.58\n"
        "6/1/2030\n"
        "5/31/2031\n"
        "$4,154,730\n"
        "$32.21\n"
        "6/1/2031\n"
        "5/31/2032\n"
        "$4,237,817\n"
        "$32.85\n"
        "6/1/2032\n"
        "5/31/2033\n"
        "$4,322,573\n"
        "$33.51\n"
    )
    schedule, _ = main._extract_dated_rent_table_schedule_and_rsf(text, commencement_hint=date(2028, 6, 1))
    assert schedule and schedule[0]["start_month"] == 0
    assert schedule[0]["end_month"] == 11
    assert schedule[0]["rent_psf_annual"] == 30.96
    assert schedule[-1]["end_month"] == 59


def test_extract_hints_prefers_commencement_row_from_fragmented_rent_schedule() -> None:
    text = (
        "COMMENCEMENT DATE: June 1, 2028.\n"
        "LEASE TERM: expires May 31, 2033.\n"
        "OPERATING EXPENSES: 2026 estimated operating expenses $18.16/psf.\n"
        "Rent Schedule\n"
        "6/1/2026\n"
        "5/31/2027\n"
        "$3,837,453\n"
        "$29.75\n"
        "6/1/2027\n"
        "5/31/2028\n"
        "$3,914,847\n"
        "$30.35\n"
        "6/1/2028\n"
        "5/31/2029\n"
        "$3,993,449\n"
        "$30.96\n"
        "6/1/2029\n"
        "5/31/2030\n"
        "$4,073,373\n"
        "$31.58\n"
        "6/1/2030\n"
        "5/31/2031\n"
        "$4,154,730\n"
        "$32.21\n"
        "6/1/2031\n"
        "5/31/2032\n"
        "$4,237,817\n"
        "$32.85\n"
        "6/1/2032\n"
        "5/31/2033\n"
        "$4,322,573\n"
        "$33.51\n"
    )
    hints = main._extract_lease_hints(text, "q2-response.docx", "test-rid")
    assert str(hints["commencement_date"]) == "2028-06-01"
    assert hints["term_months"] == 60
    assert hints["rent_schedule"][0]["rent_psf_annual"] == 30.96
    assert hints["rent_schedule"][0]["start_month"] == 0


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


def test_extract_hints_parses_parking_ratio_label_with_trailing_value() -> None:
    text = (
        "Parking Ratio (per 1,000 RSF): 4.0. "
        "Tenant shall pay parking at $100 per space per month."
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")
    assert hints["parking_ratio"] == 4.0
    assert hints["parking_rate_monthly"] == 100.0


def test_extract_hints_parses_parking_ratio_per_every_1000_without_false_decimal_count() -> None:
    text = (
        "Premises: Portion of Suite 440 consisting of 3,000 RSF.\n"
        "PARKING: Tenant's parking ratio shall be 1.32 parking spaces per every 1,000 rentable square feet of Lease space on a reserved basis.\n"
        "All parking in the building garage shall be $200 per space per month plus applicable sales tax.\n"
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")
    assert hints["parking_ratio"] == 1.32
    assert hints["parking_count"] == 4
    assert hints["parking_rate_monthly"] == 200.0


def test_extract_hints_derives_parking_count_from_ratio_when_count_missing() -> None:
    text = (
        "Premises: Suite 250 consisting of 5,000 RSF.\n"
        "Parking ratio per 1,000 RSF: 3.2.\n"
        "Parking rate is $95 per space per month.\n"
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")
    assert hints["parking_ratio"] == 3.2
    assert hints["parking_count"] == 16
    assert hints["parking_rate_monthly"] == 95.0


def test_extract_hints_prefers_ratio_derived_parking_count_over_small_inline_count() -> None:
    text = (
        "Premises: Suite 400 consisting of 4,949 RSF.\n"
        "Parking ratio per 1,000 RSF: 4.0\n"
        "Parking: on a must-take basis, four (4) parking spaces at $100 per month.\n"
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")
    assert hints["parking_ratio"] == 4.0
    assert hints["parking_count"] == 20
    assert hints["parking_rate_monthly"] == 100.0


def test_extract_hints_keeps_inline_parking_count_when_ratio_not_present() -> None:
    text = (
        "Premises: Suite 400 consisting of 4,949 RSF.\n"
        "Parking: on a must-take, must-pay basis, four (4) parking spaces at the current rate of $100 per month.\n"
        "Brokerage: Landlord will pay a market 4.0% commission per separate agreement.\n"
    )
    hints = main._extract_lease_hints(text, "tffa-proposal.docx", "test-rid")
    assert hints["parking_count"] == 4
    assert hints["parking_rate_monthly"] == 100.0
    assert round(float(hints["parking_ratio"]), 4) == round((4 * 1000.0) / 4949.0, 4)


def test_extract_hints_parses_rentable_sf_ope_and_written_parking_count() -> None:
    text = (
        "Area: 4,308 Rentable SF. "
        "Estimated OPE: $6,174.80 per mo. ($17.20 per s.f.). "
        "Parking: Up to Sixteen (16) unreserved parking spaces at a rate of $75.00 per space per month."
    )
    hints = main._extract_lease_hints(text, "renewal-proposal.pdf", "test-rid")
    assert hints["rsf"] == 4308.0
    assert hints["opex_psf_year_1"] == 17.2
    assert hints["parking_count"] == 16
    assert hints["parking_rate_monthly"] == 75.0


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


def test_extract_hints_defaults_base_rent_escalation_to_three_percent_only_when_rate_missing() -> None:
    text = (
        "Commencement Date: April 1, 2028.\n"
        "Sublease Term: Expiring on October 31, 2036.\n"
        "Base Rent: $44.00 / RSF / YR NNN with annual escalations beginning in month 13 of Term.\n"
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")
    schedule = hints.get("rent_schedule")
    assert isinstance(schedule, list)
    assert schedule[0] == {"start_month": 0, "end_month": 11, "rent_psf_annual": 44.0}
    assert schedule[1] == {"start_month": 12, "end_month": 23, "rent_psf_annual": 45.32}
    assert 100 <= int(schedule[-1]["end_month"]) <= 102


def test_extract_hints_parses_word_percent_base_rent_escalation() -> None:
    text = (
        "Commencement Date: April 1, 2028.\n"
        "Lease Term: Sixty (60) months.\n"
        "Base Rent: $44.00 / RSF / YR NNN with four percent annual escalations beginning in month 13 of Term.\n"
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")
    schedule = hints.get("rent_schedule")
    assert isinstance(schedule, list)
    assert schedule[0] == {"start_month": 0, "end_month": 11, "rent_psf_annual": 44.0}
    assert schedule[1] == {"start_month": 12, "end_month": 23, "rent_psf_annual": 45.76}
    assert schedule[-1]["end_month"] == 59


def test_extract_hints_keeps_rich_rent_schedule_when_option_rate_lacks_escalation() -> None:
    text = (
        "Commencement Date: January 1, 2027.\n"
        "Lease Term: Thirty-six (36) months.\n"
        "Phase I - Initial Occupancy (Months 1-12)\n"
        "Base Rent: $40.00/RSF NNN\n"
        "Phase II - Expansion Premises (Months 13-24)\n"
        "Base Rent: $42.00/RSF NNN\n"
        "Phase III - Expansion Premises (Months 25-36)\n"
        "Base Rent: $44.00/RSF NNN\n"
        "TERM: Option 1: thirty-six (36) months.\n"
        "BASE RENTAL RATE: Option 1: 36 Month Term | $40.00 NNN.\n"
    )
    hints = main._extract_lease_hints(text, "option-counter.docx", "test-rid")
    schedule = hints.get("rent_schedule")
    assert isinstance(schedule, list)
    rates = [float(step["rent_psf_annual"]) for step in schedule if isinstance(step, dict)]
    assert set(rates) >= {40.0, 42.0, 44.0}
    assert len(set(rates)) >= 3


def test_note_highlights_include_parking_ratio() -> None:
    text = "Parking ratio shall be 4.0 spaces per 1,000 RSF for the Premises."
    notes = main._extract_lease_note_highlights(text)
    assert any("Parking ratio:" in n for n in notes)


def _word_tokens(value: str) -> set[str]:
    cleaned = "".join(ch.lower() if ch.isalnum() else " " for ch in value)
    return {token for token in cleaned.split() if token}


def test_condense_note_text_preserves_whole_word_boundaries() -> None:
    text = (
        "Assignment/Sublease RIGHT: The existing lease shall be amended so that Tenant shall have the continuing "
        "right to assign the lease or sublet all or any portion of the premises at any time during the primary "
        "term or any extensions thereof, with landlord consent not unreasonably withheld."
    )
    condensed = main._condense_note_text(text, max_chars=120)
    assert len(condensed) <= 120
    source_tokens = _word_tokens(text)
    assert all(token in source_tokens for token in _word_tokens(condensed))


def test_pack_notes_for_storage_avoids_mid_token_cutoff_when_bounded() -> None:
    lines = [
        "Renewal option: Tenant has one five-year renewal right at fair market value with notice timing.",
        "Assignment/Sublease: Tenant may assign or sublet all or any part of the premises with landlord consent "
        "not unreasonably withheld UNBROKENMARKER.",
        "OpEx exclusions: capital repairs, roof replacement, and structural repairs are excluded.",
    ]
    packed = main._pack_notes_for_storage(
        lines,
        max_total_chars=170,
        max_line_chars=100,
        max_items=3,
    )
    assert len(packed) <= 170
    assert not packed.endswith(" ")
    assert not packed.endswith("|")
    assert ("UNBROKENMARKER" in packed) or ("UNBROKEN" not in packed)


def test_pack_notes_for_storage_dedupes_and_condenses_long_legal_note_lines() -> None:
    lines = [
        (
            "Assignment / sublease: Assignment/Sublease: RIGHT: The existing lease shall be amended so that Tenant shall "
            "have the continuing right to assign the lease or sublet all or any portion of the premises at any time during "
            "the primary term or any extensions thereof, with Landlord's consent which shall not be unreasonably withheld, "
            "conditioned, or delayed."
        ),
        (
            "Assignment / sublease: Assignment/Sublease: RIGHT: The existing lease shall be amended so that Tenant shall "
            "have the continuing right to assign the lease or sublet all or any portion of the premises at any time during "
            "the primary term or any extensions thereof, with Landlord's consent which shall not be unreasonably withheld, "
            "conditioned, or delayed."
        ),
    ]
    packed = main._pack_notes_for_storage(lines, max_total_chars=500, max_line_chars=190, max_items=6)
    parts = [part.strip() for part in packed.split("|") if part.strip()]
    assert len(parts) == 1
    assert len(parts[0]) <= 190
    assert "Assignment/Sublease: RIGHT:" not in parts[0]
    assert "unreasonably withheld" in packed.lower()


def test_pack_notes_for_storage_filters_numeric_noise_fragments() -> None:
    lines = [
        "General: 8",
        "8",
        "Operating expenses: OpEx estimate: source year 2026 value escalated 3.00% YoY to 2027 ($26.80/SF).",
    ]
    packed = main._pack_notes_for_storage(lines, max_total_chars=500, max_line_chars=220, max_items=6)
    assert "General: 8" not in packed
    assert "| 8" not in packed
    assert "OpEx estimate" in packed


def test_summarize_note_clause_renewal_without_terms_returns_empty() -> None:
    summary = main._summarize_note_clause("Renewal option for stated term", max_chars=120)
    assert summary == ""


def test_summarize_note_clause_renewal_keeps_only_count_and_duration() -> None:
    summary = main._summarize_note_clause(
        "Renewal option: Tenant shall have one option to renew for 60 months at FMV with arbitration.",
        max_chars=160,
    )
    assert summary == "1 (One) renewal option for 60 (Sixty) months at FMV"


def test_summarize_note_clause_renewal_supports_numeric_and_word_years() -> None:
    summary = main._summarize_note_clause(
        "Tenant has one (1) renewal option for 4 (Four) years at fair market value.",
        max_chars=200,
    )
    assert summary == "1 (One) renewal option for 4 (Four) years at FMV"


def test_detect_generated_report_document() -> None:
    text = (
        "Lease Economics Comparison\\n"
        "Multi-scenario report generated from stored report payload.\\n"
        "Comparison Matrix\\n"
        "Avg cost/SF/year\\n"
        "Start month End month Rate\\n"
    )
    assert main._looks_like_generated_report_document(text) is True


def test_detect_generated_financial_analysis_document() -> None:
    text = (
        "Financial Analysis\n"
        "Existing Obligation\n"
        "Landlord Renewal Proposal\n"
        "Cash Flow Summary\n"
        "Total Estimated Obligation\n"
        "This analysis is not to be used for accounting purposes.\n"
    )
    assert main._looks_like_generated_report_document(text) is True


def test_remaining_obligation_rollforward_and_schedule_shift() -> None:
    rolled = main._remaining_obligation_rollforward(
        date(2019, 9, 1),
        date(2026, 11, 30),
        analysis_date=date(2026, 2, 25),
    )
    assert rolled == (date(2026, 3, 1), 9, 78)

    schedule = [
        {"start_month": 0, "end_month": 14, "rent_psf_annual": 18.5},
        {"start_month": 15, "end_month": 26, "rent_psf_annual": 19.0},
        {"start_month": 27, "end_month": 38, "rent_psf_annual": 19.5},
        {"start_month": 39, "end_month": 50, "rent_psf_annual": 20.0},
        {"start_month": 51, "end_month": 62, "rent_psf_annual": 20.5},
        {"start_month": 63, "end_month": 74, "rent_psf_annual": 21.0},
        {"start_month": 75, "end_month": 86, "rent_psf_annual": 21.5},
    ]
    shifted = main._shift_rent_schedule_for_elapsed_months(
        schedule,
        elapsed_months=78,
        remaining_term_months=9,
    )
    assert shifted == [{"start_month": 0, "end_month": 8, "rent_psf_annual": 21.5}]


def test_generic_scenario_name_detection_flags_suite_only_names() -> None:
    assert main._looks_like_generic_scenario_name("Suite 200") is True


def test_extract_hints_prefers_option_two_counter_terms_for_option_blocks() -> None:
    text = (
        "PREMISES: Benbrook Suite 200 - Approximately 4,626 RSF\n"
        "COMMENCEMENT:December 1, 2026\n"
        "TERM:Option One:\n"
        "Sixty-(63)three Months with three (3) months base free rent at the beginning of term\n"
        "An additional three (3) months of base rent abatement to be applied during the term\n"
        "Option Two:\n"
        "Eighty-eight (8) Months four(4) months base free rent at the beginning of term\n"
        "An additional four (4) months of base rent abatement to be applied during the term\n"
        "BASE RENT:Option One: Months 01-12:$27.00 NNN with 3% annual increases\n"
        "Option Two: Months 01-12:$26.00 NNN with 3% annual increases\n"
        "PARKING:4.00 unreserved spaces per 1,000 RSF at no cost to Tenant for the entirety of the Term.\n"
    )
    hints = main._extract_lease_hints(text, "counter-option.docx", "test-rid")
    assert str(hints["commencement_date"]) == "2026-12-01"
    assert str(hints["expiration_date"]) == "2034-03-31"
    assert hints["term_months"] == 88
    assert hints["building_name"] == "Benbrook"
    assert hints["free_rent_scope"] == "base"
    assert hints["free_rent_start_month"] == 0
    assert hints["free_rent_end_month"] == 7
    assert hints["parking_ratio"] == 4.0
    assert hints["rsf"] == 4626.0
    assert isinstance(hints["rent_schedule"], list)
    assert hints["rent_schedule"][0] == {"start_month": 0, "end_month": 11, "rent_psf_annual": 26.0}
    assert hints["rent_schedule"][-1]["end_month"] == 87
    assert isinstance(hints["option_variants"], list)
    assert len(hints["option_variants"]) == 2
    assert hints["option_variants"][0]["option_label"] == "Option A"
    assert hints["option_variants"][0]["term_months"] == 63
    assert hints["option_variants"][0]["free_rent_months"] == 6
    assert hints["option_variants"][0]["rent_schedule"][0] == {"start_month": 0, "end_month": 11, "rent_psf_annual": 27.0}
    assert hints["option_variants"][1]["option_label"] == "Option B"
    assert hints["option_variants"][1]["term_months"] == 88
    assert hints["option_variants"][1]["free_rent_months"] == 8
    assert hints["option_variants"][1]["rent_schedule"][0] == {"start_month": 0, "end_month": 11, "rent_psf_annual": 26.0}


def test_extract_option_counter_terms_supports_option_a_and_b_labels() -> None:
    text = (
        "TERM: Option A: Sixty-three (63) months with three (3) months base free rent.\n"
        "Option B: Eighty-eight (88) months with four (4) months base free rent.\n"
        "BASE RENT: Option A: Months 01-12: $27.00 NNN with 3% annual increases.\n"
        "Option B: Months 01-12: $26.00 NNN with 3% annual increases.\n"
    )
    option_hints = main._extract_option_counter_terms(text)
    assert option_hints["selected_option"] == "b"
    assert option_hints["term_months"] == 88
    assert option_hints["base_rate_psf_yr"] == 26.0
    assert option_hints["free_rent_months"] == 4
    assert isinstance(option_hints["options"], list)
    assert len(option_hints["options"]) == 2
    assert option_hints["options"][0]["option_key"] == "a"
    assert option_hints["options"][0]["base_rate_psf_yr"] == 27.0
    assert option_hints["options"][1]["option_key"] == "b"
    assert option_hints["options"][1]["base_rate_psf_yr"] == 26.0


def test_extract_option_counter_terms_parses_mixed_and_distributed_abatements() -> None:
    text = (
        "TERM: Option One: Sixty-five (65) Months with two (2) months base free rent at the beginning of term. "
        "An additional three (3) months of base rent abatement to be applied during the term, allocated as follows: "
        "Bonus: One (1) month of Base Free Rent in 2026 before lease expiration. "
        "Three (3) months in the beginning of lease year 3. "
        "Option Two: Eighty-seven (87) Months two (2) months of gross free rent and two (2) months of base free rent at the beginning of term. "
        "An additional three (3) months of base rent abatement to be applied during the term, allocated as follows: "
        "Bonus: Three (3) months of Base Free Rent in 2026 before lease expiration. "
        "Two (2) months in the beginning of lease year 3. "
        "One (1) month in the beginning of lease year 4. "
        "BASE RENT: Option One: Months 01-12: $21.00 NNN with 3% annual increases. "
        "Option Two: Months 01-12: $21.00 NNN with 3% annual increases."
    )
    option_hints = main._extract_option_counter_terms(text)

    assert option_hints["selected_option"] == "b"
    assert option_hints["term_months"] == 87
    assert option_hints["free_rent_months"] == 7
    assert option_hints["free_rent_periods"] == [
        {"start_month": 0, "end_month": 1, "scope": "gross"},
        {"start_month": 2, "end_month": 3, "scope": "base"},
        {"start_month": 24, "end_month": 25, "scope": "base"},
        {"start_month": 36, "end_month": 36, "scope": "base"},
    ]

    options = {str(o["option_key"]): o for o in option_hints["options"]}
    assert options["a"]["free_rent_months"] == 5
    assert options["a"]["free_rent_periods"] == [
        {"start_month": 0, "end_month": 1, "scope": "base"},
        {"start_month": 24, "end_month": 26, "scope": "base"},
    ]
    assert options["b"]["free_rent_months"] == 7
    assert options["b"]["free_rent_periods"] == [
        {"start_month": 0, "end_month": 1, "scope": "gross"},
        {"start_month": 2, "end_month": 3, "scope": "base"},
        {"start_month": 24, "end_month": 25, "scope": "base"},
        {"start_month": 36, "end_month": 36, "scope": "base"},
    ]


def test_extract_option_counter_terms_handles_word_year_allocations() -> None:
    text = (
        "TERM: Option A: Seventy-two (72) Months two (2) months of gross free rent and one (1) month of base free rent at the beginning of term. "
        "An additional four (4) months of base rent abatement to be applied during the term, allocated as follows: "
        "Two (2) months in the beginning of lease year three. "
        "Two (2) months in the beginning of year four. "
        "BASE RENT: Option A: Months 01-12: $31.00 NNN with 3.0% annual increases."
    )
    option_hints = main._extract_option_counter_terms(text)

    assert option_hints["term_months"] == 72
    assert option_hints["free_rent_months"] == 7
    assert option_hints["free_rent_periods"] == [
        {"start_month": 0, "end_month": 1, "scope": "gross"},
        {"start_month": 2, "end_month": 2, "scope": "base"},
        {"start_month": 24, "end_month": 25, "scope": "base"},
        {"start_month": 36, "end_month": 37, "scope": "base"},
    ]


def test_extract_option_counter_terms_handles_explicit_month_range_allocations() -> None:
    text = (
        "TERM: Option B: Eighty-four (84) months one (1) month of base free rent at the beginning of term. "
        "An additional three (3) months of gross rent abatement to be applied during the term, allocated as follows: "
        "Months 25-26 and month 37. "
        "BASE RENT: Option B: Months 01-12: $29.00 NNN with 2.5% annual increases."
    )
    option_hints = main._extract_option_counter_terms(text)

    assert option_hints["term_months"] == 84
    assert option_hints["free_rent_months"] == 4
    assert option_hints["free_rent_periods"] == [
        {"start_month": 0, "end_month": 0, "scope": "base"},
        {"start_month": 24, "end_month": 25, "scope": "gross"},
        {"start_month": 36, "end_month": 36, "scope": "gross"},
    ]


def test_build_canonical_option_variants_emits_two_scenarios() -> None:
    canonical = main._dict_to_canonical(
        {
            "scenario_name": "Austin Oaks - Benbrook Renewal Counter - Option B",
            "building_name": "Austin Oaks - Benbrook",
            "suite": "200",
            "rsf": 4626,
            "commencement_date": "2026-12-01",
            "expiration_date": "2034-03-31",
            "term_months": 88,
            "rent_schedule": [{"start_month": 0, "end_month": 87, "rent_psf_annual": 26.0}],
            "free_rent_months": 8,
            "free_rent_scope": "base",
            "opex_psf_year_1": 14.3,
            "expense_structure_type": "nnn",
            "discount_rate_annual": 0.08,
        }
    )
    canonical, _ = main.normalize_canonical_lease(canonical)
    variants = main._build_canonical_option_variants(
        canonical=canonical,
        extracted_hints={
            "option_variants": [
                {
                    "option_key": "a",
                    "option_label": "Option A",
                    "term_months": 63,
                    "free_rent_months": 6,
                    "free_rent_scope": "base",
                    "free_rent_periods": [
                        {"start_month": 0, "end_month": 1, "scope": "base"},
                        {"start_month": 24, "end_month": 27, "scope": "base"},
                    ],
                    "rent_schedule": [{"start_month": 0, "end_month": 62, "rent_psf_annual": 27.0}],
                },
                {
                    "option_key": "b",
                    "option_label": "Option B",
                    "term_months": 88,
                    "free_rent_months": 8,
                    "free_rent_scope": "base",
                    "free_rent_periods": [
                        {"start_month": 0, "end_month": 1, "scope": "gross"},
                        {"start_month": 2, "end_month": 3, "scope": "base"},
                        {"start_month": 24, "end_month": 25, "scope": "base"},
                        {"start_month": 36, "end_month": 37, "scope": "base"},
                    ],
                    "rent_schedule": [{"start_month": 0, "end_month": 87, "rent_psf_annual": 26.0}],
                },
            ]
        },
        filename="austin-oaks-counter.docx",
    )
    assert len(variants) == 2
    assert variants[0].scenario_name.endswith("Option A")
    assert variants[0].term_months == 63
    assert str(variants[0].expiration_date) == "2032-02-29"
    assert [(p.start_month, p.end_month, p.scope) for p in variants[0].free_rent_periods] == [
        (0, 1, "base"),
        (24, 27, "base"),
    ]
    assert variants[1].scenario_name.endswith("Option B")
    assert variants[1].term_months == 88
    assert str(variants[1].expiration_date) == "2034-03-31"
    assert variants[1].free_rent_scope == "base"
    assert [(p.start_month, p.end_month, p.scope) for p in variants[1].free_rent_periods] == [
        (0, 1, "gross"),
        (2, 3, "base"),
        (24, 25, "base"),
        (36, 37, "base"),
    ]


def test_extract_hints_parses_option_1_2_counter_with_base_rental_rate_and_abatement() -> None:
    text = (
        "BUILDING INFORMATION: Frost Tower is a 33-story office tower.\n"
        "PREMISES: The Premises shall be approximately 3,833 RSF to be known as suite 1875.\n"
        "Landlord can provide Temporary space if the Premises is not constructed by September 1, 2026. "
        "Tenant shall occupy the Temporary Premises from September 1, 2026 through the Commencement Date.\n"
        "TERM: The Term of the lease shall be Option 1: eighty-seven (87) months or Option 2: sixty (60) months from the Commencement Date.\n"
        "BASE RENTAL RATE: Beginning on the Commencement Date the base rental rate paid on the Premises shall be:\n"
        "Option 1: 87 Month Term | $47.00 NNN\n"
        "Option 2: 60 Month Term | $50.00 NNN\n"
        "Commencing on month 13 there shall be 3.0% annual Base Rent escalations.\n"
        "BASE RENTAL ABATEMENT: Option 1: Tenant shall have three (3) months of base rental abatement. "
        "Option 2: 5-yr term no free rent.\n"
        "Operating Expenses: The 2026 operating expenses are estimated to be $26.88/RSF/Yr.\n"
        "PARKING: ratio of 2.7 permits per 1,000 RSF and parking rate is $288/permit/month.\n"
    )
    hints = main._extract_lease_hints(text, "frost-counter.docx", "test-rid")
    assert hints["building_name"] == "Frost Tower"
    assert hints["suite"] == "1875"
    assert hints["rsf"] == 3833.0
    assert str(hints["commencement_date"]) == "2026-09-01"
    assert hints["term_months"] == 60
    assert str(hints["expiration_date"]) == "2031-08-31"
    assert hints["free_rent_start_month"] is None
    assert hints["free_rent_end_month"] is None
    assert hints["parking_ratio"] == 2.7
    assert hints["parking_rate_monthly"] == 288.0
    assert hints["opex_psf_year_1"] == 26.88
    assert isinstance(hints["rent_schedule"], list)
    assert hints["rent_schedule"][0] == {"start_month": 0, "end_month": 11, "rent_psf_annual": 50.0}
    assert len(hints["option_variants"]) == 2
    assert hints["option_variants"][0]["term_months"] == 87
    assert hints["option_variants"][0]["free_rent_months"] == 3
    assert hints["option_variants"][0]["base_rate_psf_yr"] == 47.0
    assert hints["option_variants"][0]["escalation_pct"] == 3.0
    assert hints["option_variants"][1]["term_months"] == 60
    assert hints["option_variants"][1]["free_rent_months"] == 0
    assert hints["option_variants"][1]["base_rate_psf_yr"] == 50.0
    assert hints["option_variants"][1]["escalation_pct"] == 3.0


def test_extract_option_counter_terms_parses_label_value_escalation_rows() -> None:
    text = (
        "TERM: Option 1: sixty (60) months. Option 2: eighty-four (84) months.\n"
        "BASE RENTAL RATE: "
        "Option 1: 60 Month Term | $42.00 NNN | Annual Base Rent Escalation: 3.00%. "
        "Option 2: 84 Month Term | $40.00 NNN | Annual Base Rent Escalation: 2.50%.\n"
        "IMPROVEMENTS: N/A.\n"
    )
    option_hints = main._extract_option_counter_terms(text)

    assert option_hints["selected_option"] == "b"
    options = {str(o["option_key"]): o for o in option_hints["options"]}
    assert options["a"]["escalation_pct"] == 3.0
    assert options["b"]["escalation_pct"] == 2.5
    assert options["a"]["rent_schedule"][0]["rent_psf_annual"] == 42.0
    assert options["a"]["rent_schedule"][1]["rent_psf_annual"] == 43.26


def test_extract_hints_prefers_parseable_expiration_when_earlier_match_is_malformed() -> None:
    text = (
        "Sublease Term | Expiring on 31, 2036.\n"
        "Sublease Premises shall be delivered as-is.\n"
        "Sublease Term | Expiring on October 31, 2036.\n"
    )
    hints = main._extract_lease_hints(text, "sublease.docx", "test-rid")
    assert str(hints["expiration_date"]) == "2036-10-31"


def test_extract_hints_6xguad_style_docx_text_regression() -> None:
    text = (
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
    )
    hints = main._extract_lease_hints(text, "2 - Response - Solarwinds - 6xGuad.docx", "test-rid")
    assert hints["building_name"] == "6xGuad"
    assert hints["suite"] == ""
    assert hints["floor"] == "26-28"
    assert hints["rsf"] == 92982.0
    assert str(hints["commencement_date"]) == "2028-04-01"
    assert str(hints["expiration_date"]) == "2036-10-31"
    assert hints["term_months"] == 103
    assert hints["parking_ratio"] == 2.76
    assert hints["parking_rate_monthly"] == 200.0


def test_extract_hints_parses_zero_rent_window_and_occupancy_only_phase_in() -> None:
    text = (
        "Premises: Suite 1550 consisting of 5,618 RSF.\n"
        "Commencement Date: 10/1/2026\n"
        "Expiration Date: 4/30/2034\n"
        "Lease Term: 91 months\n"
        "Base Rental Rate: Months 1-7: $0.00 PSF + NNN. Months 8-12: $52.00 PSF + NNN. "
        "Starting month 13, base rent shall escalate by 3.0% annually.\n"
        "Tenant shall pay as if occupying only 4,700 RSF for the first 14 months of the term. "
        "Thereafter, Tenant will pay on the full size of the space.\n"
    )
    hints = main._extract_lease_hints(text, "atx-counter.docx", "test-rid")
    assert hints["term_months"] == 91
    assert hints["free_rent_start_month"] == 0
    assert hints["free_rent_end_month"] == 6
    phase = hints.get("phase_in_schedule")
    assert isinstance(phase, list) and len(phase) == 2
    assert phase[0] == {"start_month": 0, "end_month": 13, "rsf": 4700.0}
    assert phase[1] == {"start_month": 14, "end_month": 90, "rsf": 5618.0}


def test_extract_hints_parking_abatement_can_reference_abatement_period() -> None:
    text = (
        "Commencement Date: April 1, 2028.\n"
        "Lease Term: 103 months.\n"
        "Sublease Term: Expiring on October 31, 2036.\n"
        "Rent Abatement: Nine (9) Months Gross Rent and parking abatement.\n"
        "Parking: Parking costs shall be abated during the Abatement Period.\n"
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")
    assert hints["term_months"] == 103
    assert hints["free_rent_start_month"] == 0
    assert hints["free_rent_end_month"] == 8
    assert hints["parking_abatement_periods"] == [{"start_month": 0, "end_month": 8}]


def test_extract_hints_ignores_termination_fee_months_when_parsing_free_rent() -> None:
    text = (
        "Lease Term: 88 months.\n"
        "Free Base Rent: Tenant shall receive four (4) months of abated base rent at the beginning of the lease term.\n"
        "Termination Right: Termination fee shall include unamortized deal costs (including free rent) "
        "and 7 months' gross rent.\n"
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")
    assert hints["free_rent_start_month"] == 0
    assert hints["free_rent_end_month"] == 3


def test_extract_hints_summit_lantana_prefers_project_name_and_floor_pair() -> None:
    text = (
        "PROJECT: The Summit at Lantana\n"
        "PREMISES: The entirety of floors three (3) and four (4) consisting of approximately 114,558 RSF.\n"
        "COMMENCEMENT DATE: April 1, 2028\n"
        "LEASE TERM: Eighty-nine (89) months\n"
        "RENTAL ABATEMENT: Tenant shall have five (5) months of Base Rental Abatement.\n"
        "OPERATING EXPENSES: Per existing Lease however the base year for the Cap on Controllables will be reset for 2028.\n"
        "ALLOWANCE: Following lease execution, Landlord shall provide a Tenant Improvement Allowance in the amount of $45.00 per RSF.\n"
        "The Tenant Improvement Allowance shall be available and will expire March 31, 2029.\n"
    )
    hints = main._extract_lease_hints(text, "summit-counter.docx", "test-rid")
    assert hints["building_name"] == "The Summit at Lantana"
    assert hints["suite"] == ""
    assert hints["floor"] == "3,4"
    assert hints["rsf"] == 114558.0
    assert str(hints["commencement_date"]) == "2028-04-01"
    assert hints["term_months"] == 89
    assert str(hints["expiration_date"]) == "2035-08-31"
    assert hints["opex_psf_year_1"] is None


def test_extract_hints_zilker_parses_building_floor_ratio_and_unreserved_rate() -> None:
    text = (
        "Building: Zilker Point located at 218 South Lamar. Additional information can be found at https://zilkerpoint.com\n"
        "Premises: Approximately 94,832 RSF on the fifth, sixth and seventh floor (5, 6 & 7).\n"
        "Lease Commencement Date: April 1, 2028\n"
        "Term: 132 months from the Lease Commencement Date.\n"
        "Operating Expenses: Currently operating expenses are estimated to be approximately $18.00/RSF.\n"
        "Parking: Landlord will provide Tenant employees and visitors up to 3.2 per 1000 parking at market rates. "
        "Market rates are $175/month for unreserved parking and $250/space for reserved parking, plus tax. "
        "Landlord shall fix the parking rate for unreserved parking spaces at $125/space/month for the first 3 years.\n"
    )
    hints = main._extract_lease_hints(text, "zilker.docx", "test-rid")
    assert hints["building_name"] == "Zilker Point"
    assert hints["suite"] == ""
    assert hints["floor"] == "5,6,7"
    assert hints["rsf"] == 94832.0
    assert str(hints["commencement_date"]) == "2028-04-01"
    assert str(hints["expiration_date"]) == "2039-03-31"
    assert hints["term_months"] == 132
    assert hints["parking_ratio"] == 3.2
    assert hints["parking_rate_monthly"] == 175.0


def test_extract_hints_6xguad_prefers_re_alias_over_amenity_text() -> None:
    text = (
        "RE: Non-Binding Proposal to Sublease – 400 W 6th Street – Austin, TX (“6xGuad”) – Subtenant SolarWinds\n"
        "Building & Project Overview: 400 W 6th St Austin, TX 78701.\n"
        "Amenities: 14th Floor Rooftop Terrace Amenity – A first-class outdoor amenity space.\n"
        "Sublease Premises: The Premises will be defined to be located on 26-28 (92,982 RSF).\n"
        "Sublease Term: Expiring on October 31, 2036.\n"
    )
    hints = main._extract_lease_hints(text, "6xguad.docx", "test-rid")
    assert hints["building_name"] == "6xGuad"
    assert hints["floor"] == "26-28"
    assert hints["rsf"] == 92982.0


def test_extract_hints_300w6th_prefers_unreserved_rate_and_term_months() -> None:
    text = (
        "Re: SolarWinds Landlord Counter Proposal to 300 West 6th\n"
        "LEASED PREMISES: Approximately 94,420 rentable square feet across three full floors with interconnecting stairs\n"
        "Floor 9 32,142 RSF\n"
        "Floor 10 31,139 RSF\n"
        "Floor 11 31,139 RSF\n"
        "LEASE COMMENCEMENT DATE: April 1, 2028\n"
        "LEASED PREMISES TERM: One Hundred and Thirty Two (132) Months\n"
        "TRANSPORTATION: Tenant shall be provided unreserved parking at a ratio of 3:1,000 in the building structured garage on a must take, must pay basis. "
        "The charge for parking shall be $150.00 per unreserved permit per month plus tax (if applicable) during the initial 3 yrs of the lease and "
        "$220 per unreserved permit per month plus tax for yr 4.\n"
        "Reserved parking shall be $250.00/space/month plus tax.\n"
    )
    hints = main._extract_lease_hints(text, "300w6th.docx", "test-rid")
    assert hints["building_name"] == "300 West 6th"
    assert hints["floor"] == "9,10,11"
    assert hints["rsf"] == 94420.0
    assert str(hints["commencement_date"]) == "2028-04-01"
    assert str(hints["expiration_date"]) == "2039-03-31"
    assert hints["term_months"] == 132
    assert hints["parking_ratio"] == 3.0
    assert hints["parking_rate_monthly"] == 150.0


def test_clean_building_candidate_strips_tenant_prefix_from_office_phrase() -> None:
    cleaned = main._clean_building_candidate("Maev for office Eastlake at Tillery")
    assert cleaned == "Eastlake at Tillery"


def test_extract_hints_parses_building_table_and_net_rental_response_dates() -> None:
    text = (
        "LL Proposal: November 12, 2025\n"
        "Tenant Response December 23, 2025\n"
        "BUILDING: | Aspen Lake 2 - 10124 Lake Creek Pkwy | Aspen Lake 2 - 10124 Lake Creek Pkwy\n"
        "PREMISES: | 128,990 rentable square feet making up the entire Building.\n"
        "COMMENCEMENT DATE: | May 1st, 2028.\n"
        "LEASE TERM: | Through August, 30, 2033.\n"
        "BASE ANNUAL NET RENTAL RATE: | Months 1-12: Annual Base Rent: $29.69/RSF Beginning in Month 13: 2.5% Annual Increases. "
        "The first four months of Annual Base Rent shall be abated.\n"
        "OPERATING EXPENSES: | The estimated 2026 Operating Expenses are $16.34/RSF.\n"
    )
    hints = main._extract_lease_hints(text, "AL2_Q2 T Response 2.17.26.docx", "test-rid")

    assert hints["building_name"] == "Aspen Lake 2"
    assert hints["rsf"] == 128990.0
    assert str(hints["commencement_date"]) == "2028-05-01"
    assert str(hints["expiration_date"]) == "2033-08-30"
    assert hints["term_months"] == 64
    assert hints["lease_type"] == "NNN"
    assert hints["free_rent_scope"] == "base"
    assert hints["free_rent_end_month"] == 3


def test_extract_hints_detects_fsg_and_zeros_opex_passthrough() -> None:
    text = (
        "LEASE TYPE: FSG\n"
        "BASE RENT: $33.50/SF full service gross.\n"
        "OPERATING EXPENSES: included in gross rent.\n"
    )
    hints = main._extract_lease_hints(text, "analysis.pdf", "test-rid")
    assert hints["lease_type"] == "Full Service"
    assert hints["opex_psf_year_1"] == 0.0
    assert hints["opex_by_calendar_year"] == {}


def test_extract_hints_al1_primary_lease_term_prefers_150_month_term_over_rent_commencement_months() -> None:
    text = (
        "PREMISES: Approximately 205,072 rentable square feet.\n"
        "LEASE COMMENCEMENT DATE: May 1, 2028.\n"
        "RENT COMMENCEMENT DATE: Six (6) months after the Commencement Date. For clarity, "
        "Tenant shall not pay base rent or parking during this period of time.\n"
        "PRIMARY LEASE TERM: Please provide a proposal for a twelve (12) year term + 6 months "
        "(150 month term) (\"Term\").\n"
        "BASE ANNUAL NET RENTAL RATE: $28.00 NNN escalating by 3% per annum beginning Month 13.\n"
        "Estimated operating expenses for 2026: $19.35 per RSF.\n"
    )
    hints = main._extract_lease_hints(text, "Aspen Lake 1 - Q2 - Landlord Response 2.26.2026.docx", "test-rid")

    assert hints["rsf"] == 205072.0
    assert str(hints["commencement_date"]) == "2028-05-01"
    assert str(hints["expiration_date"]) == "2040-10-31"
    assert hints["term_months"] == 150


def test_extract_hints_tarrytown_research_park_strips_party_suite_and_parses_composite_term() -> None:
    text = (
        "RE:\tLease Proposal - Tarrytown Expocare at Research Park Building 3\n"
        "On behalf of The RMR Group, we are pleased to submit this proposal to Tarrytown Expocare "
        "(\"Tenant\") to lease office space at Research Park Building 3, 12515 Research Park Loop, Austin, TX 78759 "
        "(\"Building\") under the following terms and conditions:\n"
        "Premises:\n"
        "Research Park Building 3, 12515 Research Park Loop, Austin, TX 78759\n"
        "The full building is approximately 55,388 rentable square feet (\"rsf\").\n"
        "Landlord Legal Entity\n"
        "SIR Properties Trust, with an address of 255 Washington Street, Suite 300, Newton, Massachusetts 02458\n"
        "Lease Commencement Date:\n"
        "The Lease Commencement Date shall be the earlier of January 1, 2028, or when Tenant first conducts business/operations in the Premises.\n"
        "Term:\n"
        "Ten (10) years and four (4) months from the Lease Commencement Date.\n"
        "Base Rental Rate:\n"
        "Effective on the Lease Commencement Date, the Base Rent shall be $20.00 NNN PSF/annum.\n"
        "Rent Abatement Period:\n"
        "The Landlord shall grant Tenant four (4) months of Base Rent Abatement for the months of one (1) through four (4).\n"
        "Additional Rent - Operating Expenses & Real Estate Taxes (managed-net):\n"
        "Estimated 2026 Operating Expenses, net of utilities and janitorial costs, are $10.50 per rsf.\n"
        "Tenant Improvement Allowance:\n"
        "The Landlord shall provide a Tenant Improvement Allowance not to exceed $40.00 per rentable square foot.\n"
        "Parking:\n"
        "3.0 spaces per 1,000 rentable square feet.\n"
    )

    hints = main._extract_lease_hints(text, "tarrytown-research-park-iii.docx", "test-rid")

    assert hints["building_name"] == "Research Park Building 3"
    assert hints["suite"] == ""
    assert hints["address"] == "12515 Research Park Loop, Austin, TX 78759"
    assert hints["rsf"] == 55388.0
    assert str(hints["commencement_date"]) == "2028-01-01"
    assert str(hints["expiration_date"]) == "2038-04-30"
    assert hints["term_months"] == 124
    assert hints["lease_type"] == "NNN"
    assert hints["free_rent_end_month"] == 3
    assert hints["opex_psf_year_1"] == 10.5
    assert hints["opex_source_year"] == 2026
    assert hints["ti_allowance_psf"] == 40.0
    assert hints["parking_ratio"] == 3.0


def test_extract_hints_prefers_counter_month_term_over_holdover_or_request_term() -> None:
    text = (
        "Premises: Suite 130 consisting of 3,827 RSF.\n"
        "Lease Commencement Date | May 1, 2026.\n"
        "Lease Term | Three (3) years.\n"
        "Landlord Proposes a Thirty-Nine (39) month Lease Term.\n"
        "Holdover | In the event that Tenant possesses the Premises beyond the expiration of the Lease Term "
        "for the first three (3) months of such holdover, the Base Rent shall be one hundred twenty five percent (125%).\n"
        "Tenant Improvements | Landlord to provide Tenant with a Tenant Improvement Allowance of $18.00 per square foot.\n"
        "Landlord shall provide Tenant an allowance not to exceed $20.00 per RSF from the Premises as-is condition.\n"
    )
    hints = main._extract_lease_hints(text, "grinnell-counter.docx", "test-rid")
    assert hints["term_months"] == 39
    assert str(hints["expiration_date"]) == "2029-07-31"
    assert hints["ti_allowance_psf"] == 20.0


def test_extract_hints_ksd_counter_prefers_total_premises_and_multisuite_terms() -> None:
    text = (
        "PREMISES: Renewal Suite 100: Approximately 64,800 SF Expansion Suite 200: Approximately 43,200 SF "
        "Second Expansion Suite 300: Approximately 21,600 SF Total Premises: 129,600 SF\n"
        "Expo 11 - Suite 100,200, and 300\n"
        "RENEWAL TERM:\n"
        "Ninety(90) months\n"
        "COMMENCEMENT:\n"
        "September 1, 2026\n"
        "RENEWAL BASE RENT:\n"
        "$13.50NNN with 3.50% annual increases\n"
        "OPERATING EXPENSES:\n"
        "Estimated to be $5.79/sf for 2025.\n"
        "TENANT IMPROVEMENT ALLOWANCE:\n"
        "Landlord shall provide the Tenant a Tenant Improvement allowance equal to $1300 PSF for improvements.\n"
        "Tenant may have the ability to amortize an additional $7.00 PSF at 9% interest over the term of the lease.\n"
        "LL January 21, 2026\n"
    )
    hints = main._extract_lease_hints(text, "KSD - LL Counter 1-21-26.docx", "test-rid")
    assert hints["suite"] == "100,200,300"
    assert hints["rsf"] == 129600.0
    assert str(hints["commencement_date"]) == "2026-09-01"
    assert hints["term_months"] == 90
    assert str(hints["expiration_date"]) == "2034-02-28"
    assert hints["ti_allowance_psf"] == 13.0
    rent_schedule = hints.get("rent_schedule")
    assert isinstance(rent_schedule, list) and rent_schedule
    assert rent_schedule[0]["rent_psf_annual"] == 13.5


def test_extract_hints_m42_commencement_clause_prefers_explicit_c_date_and_building_list_suite() -> None:
    text = (
        "Landlord Proposal\n"
        "March 5, 2026\n"
        "Premises: The Premises will consist of approximately 51,743 RSF located in Buildings 100, 200,300, and Amenity Building.\n"
        "Lease Term: 128 Month Term\n"
        "Lease Commencement Date: The Lease Commencement Date will be the earlier of (a) Substantial Completion of tenant improvements "
        "(b) the date of Substantial Completion if not for Tenant Delay and (c) August 1st, 2026.\n"
        "Operating Expenses: Year 1 operating expenses are estimated to be $16.80 per RSF.\n"
    )
    hints = main._extract_lease_hints(text, "M42 Gaming Proposal_St Elmo_3.5.26_.docx", "test-rid")

    assert hints["suite"] == "100,200,300"
    assert str(hints["commencement_date"]) == "2026-08-01"
    assert hints["term_months"] == 128
    assert str(hints["expiration_date"]) == "2037-03-31"
    assert hints["opex_psf_year_1"] == 16.8


def test_extract_hints_m42_derives_phase_in_from_building_specific_gross_abatement_and_escalates_rent() -> None:
    text = (
        "Premises: The Premises will consist of approximately 51,743 RSF located in Buildings 100, 200,300, and Amenity Building identified in Exhibit A.\n"
        "Amenity: Approximately 5,178 RSF\n"
        "Building 100: Approximately 12,978 RSF\n"
        "Building 200: Approximately 14,260 RSF\n"
        "Building 300: Approximately 19,327 RSF\n"
        "Lease Commencement Date: August 1, 2026.\n"
        "Lease Term: 128 Month Term.\n"
        "Base Rental Rate: $47.50 per RSF NNN.\n"
        "Beginning in Month 13 after the Rent Commencement Date, the Base Rental Rate will increase by 3.0% annually.\n"
        "Rental Abatement: Base Rent will be abated for Months 1-8 of the Lease Term on Building 100, 200, & Amenity Building.\n"
        "So long as Tenant is not in default, Gross Rent will be abated for Months 1-10 on the Lease Term on Building 300.\n"
    )
    hints = main._extract_lease_hints(text, "M42 Gaming Proposal_St Elmo_3.5.26_.docx", "test-rid")

    assert hints["free_rent_scope"] == "base"
    assert hints["free_rent_start_month"] == 0
    assert hints["free_rent_end_month"] == 7

    phase = hints.get("phase_in_schedule")
    assert isinstance(phase, list) and len(phase) == 2
    assert phase[0] == {"start_month": 0, "end_month": 9, "rsf": 32416.0}
    assert phase[1] == {"start_month": 10, "end_month": 127, "rsf": 51743.0}

    rent_schedule = hints.get("rent_schedule")
    assert isinstance(rent_schedule, list) and rent_schedule
    assert rent_schedule[0] == {"start_month": 0, "end_month": 11, "rent_psf_annual": 47.5}
    assert rent_schedule[1] == {"start_month": 12, "end_month": 23, "rent_psf_annual": 48.93}
    assert rent_schedule[-1] == {"start_month": 120, "end_month": 127, "rent_psf_annual": 63.84}


def test_extract_hints_parses_two_digit_term_dates_and_ignores_proposal_header_date() -> None:
    text = (
        "Landlord Proposal March 5, 2026\n"
        "General Inputs\n"
        "Lease Term (Months) 128\n"
        "Lease Commencement 8/1/26\n"
        "Lease Expiration 3/31/37\n"
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")

    assert str(hints["commencement_date"]) == "2026-08-01"
    assert str(hints["expiration_date"]) == "2037-03-31"
    assert hints["term_months"] == 128


def test_extract_hints_term_and_free_rent_clause_uses_free_months_not_term_months() -> None:
    text = (
        "COMMENCEMENT: December 1, 2026.\n"
        "TERM AND FREE RENT: One hundred twenty-seven (127) months, with seven (7) months base free rent.\n"
        "BASE RENT: $33.00 per RSF NNN.\n"
    )
    hints = main._extract_lease_hints(text, "tffa-proposal.docx", "test-rid")
    assert hints["term_months"] == 127
    assert hints["free_rent_scope"] == "base"
    assert hints["free_rent_start_month"] == 0
    assert hints["free_rent_end_month"] == 6


def test_extract_hints_parses_non_contiguous_free_rent_month_list() -> None:
    text = (
        "COMMENCEMENT DATE: December 1, 2026.\n"
        "LEASE TERM: One Hundred Twenty (120) months.\n"
        "FREE BASE RENT: Landlord shall provide Tenant with abated Base Rent during the following months "
        "of the Lease Term: 1, 13, 25, 37, 49, 61, 73.\n"
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")
    assert hints["free_rent_scope"] == "base"
    assert hints["free_rent_start_month"] == 0
    assert hints["free_rent_end_month"] == 72
    periods = hints.get("free_rent_periods")
    assert isinstance(periods, list) and len(periods) == 7
    start_months = sorted(int(p.get("start_month", -1)) for p in periods if isinstance(p, dict))
    assert start_months == [0, 12, 24, 36, 48, 60, 72]


def test_extract_hints_ignores_abatement_distribution_window_month_count() -> None:
    text = (
        "LEASE TERM: Landlord proposes sixty-five (65) months from the Lease Commencement Date.\n"
        "BASE RENT: $47.50 per RSF; full service. The full-service Base Rent shall escalate at 3.00% annually.\n"
        "Landlord shall abate the initial five (5) months from Base Rent.\n"
        "Additionally, Tenant shall have the right to spread the rent abatement out in equal monthly installments "
        "throughout the first twenty-four (24) months of the Term.\n"
    )
    hints = main._extract_lease_hints(text, "proposal.docx", "test-rid")
    assert hints["term_months"] == 65
    assert hints["free_rent_start_month"] == 0
    assert hints["free_rent_end_month"] == 4


def test_extract_hints_parses_reserved_unreserved_parking_counts_and_rates() -> None:
    text = (
        "PARKING INPUTS\n"
        "# Reserved Paid Spaces 0\n"
        "# Unreserved Paid Spaces 20\n"
        "Reserved - Cost per Space $0.00\n"
        "Unreserved - Cost per Space $100.00\n"
    )
    hints = main._extract_lease_hints(text, "parking-table.docx", "test-rid")
    assert hints["parking_reserved_count"] == 0
    assert hints["parking_unreserved_count"] == 20
    assert hints["parking_count"] == 20
    assert hints["parking_unreserved_rate_monthly"] == 100.0
    assert hints["parking_rate_monthly"] == 100.0


def test_summarize_note_clause_parking_includes_space_count_ratio_and_rate() -> None:
    line = (
        "Premises: Suite 400 consisting of 4,949 RSF. PARKING: Tenant shall contract for, on a must-take, must-pay basis, four (4) parking spaces "
        "at the current rate of $100 per month."
    )
    summary = main._summarize_note_clause(line, max_chars=220)
    assert "total 4 spaces" in summary
    assert "0.81/1,000 RSF" in summary
    assert "$100/mo per space" in summary


def test_summarize_note_clause_parking_without_space_and_ratio_returns_empty() -> None:
    line = "Parking terms included in lease economics."
    summary = main._summarize_note_clause(line, max_chars=160)
    assert summary == ""


def test_summarize_note_clause_expense_caps_generic_placeholder_returns_empty() -> None:
    line = "Expense caps/exclusions or audit rights included."
    summary = main._summarize_note_clause(line, max_chars=160)
    assert summary == ""
