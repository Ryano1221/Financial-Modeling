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


def test_detect_generated_report_document() -> None:
    text = (
        "Lease Economics Comparison\\n"
        "Multi-scenario report generated from stored report payload.\\n"
        "Comparison Matrix\\n"
        "Avg cost/SF/year\\n"
        "Start month End month Rate\\n"
    )
    assert main._looks_like_generated_report_document(text) is True


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
                    "rent_schedule": [{"start_month": 0, "end_month": 62, "rent_psf_annual": 27.0}],
                },
                {
                    "option_key": "b",
                    "option_label": "Option B",
                    "term_months": 88,
                    "free_rent_months": 8,
                    "free_rent_scope": "base",
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
    assert variants[1].scenario_name.endswith("Option B")
    assert variants[1].term_months == 88
    assert str(variants[1].expiration_date) == "2034-03-31"


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
        "Sublease Term | Expiring on October 31, 2036.\n"
        "Base Rent | $46.00 / RSF / YR NNN with 3% annual escalations beginning in month 13 of Term.\n"
        "Operating Expenses | Estimated 2025 Operating Expenses are approximately $28.53/rsf.\n"
        "Parking | Subtenant will contract for non-exclusive parking at a ratio of 2.76 passes per 1,000 RSF leased "
        "throughout the entire Sublease Term and the current rate for unreserved spaces shall be $200/space/month.\n"
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
    assert hints["opex_psf_year_1"] == 28.53
    assert hints["opex_source_year"] == 2025
    assert hints["opex_by_calendar_year"] == {2025: 28.53}


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
