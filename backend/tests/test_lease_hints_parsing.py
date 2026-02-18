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
