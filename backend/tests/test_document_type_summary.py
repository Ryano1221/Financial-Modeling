from datetime import date

import main
from backend.models import CanonicalLease


def _stub_canonical() -> CanonicalLease:
    return CanonicalLease.model_validate(
        {
            "scenario_name": "Example",
            "building_name": "100 Congress Avenue",
            "suite": "1100",
            "rsf": 12000,
            "commencement_date": date(2026, 1, 1),
            "expiration_date": date(2031, 1, 31),
            "term_months": 60,
            "rent_schedule": [{"start_month": 0, "end_month": 59, "rent_psf_annual": 48}],
            "opex_psf_year_1": 12.5,
            "opex_growth_rate": 0.03,
        }
    )


def test_detect_document_type_across_five_plus_formats() -> None:
    samples = [
        (
            "RFP for tenant office relocation. Request for proposal response due by March 15. "
            "Please provide base rent and operating expenses assumptions.",
            "client-rfp.docx",
            "rfp",
        ),
        (
            "LETTER OF INTENT\nTenant proposes the following business terms.\n"
            "This LOI is non-binding except confidentiality.",
            "eastbound-loi.docx",
            "loi",
        ),
        (
            "Economic Proposal\nBase Rent Schedule and lease years.\nCounter comments attached.",
            "eastlake-proposal.docx",
            "counter_proposal",
        ),
        (
            "FIRST AMENDMENT TO LEASE\nThis Amendment modifies the Premises and extends the Term.",
            "first-amendment.pdf",
            "amendment",
        ),
        (
            "SUBLEASE AGREEMENT\nSublessor hereby subleases the Premises to Sublessee.",
            "project-sublease.pdf",
            "sublease",
        ),
        (
            "SUB-SUBLEASE AGREEMENT\nSubsublessor and Subsublessee agree to the following terms.",
            "project-subsublease.pdf",
            "subsublease",
        ),
        (
            "LEASE AGREEMENT\nLandlord hereby leases to Tenant the Premises described below.",
            "master-lease.pdf",
            "lease",
        ),
        (
            "TERM SHEET\nSummary of terms for occupancy and economics.",
            "term-sheet.docx",
            "term_sheet",
        ),
    ]

    for text, filename, expected in samples:
        assert main._detect_document_type(text, filename) == expected


def test_extraction_summary_includes_found_missing_and_sections() -> None:
    canonical = _stub_canonical()
    text = (
        "Premises: Suite 1100 at 100 Congress Avenue.\n"
        "Term: 60 months. Commencement Date: January 1, 2026.\n"
        "Expiration Date: January 31, 2031.\n"
        "Base Rent: $48.00/SF.\n"
        "Operating Expenses (CAM): $12.50/SF in 2026.\n"
    )
    summary = main._build_extraction_summary(
        text=text,
        filename="sample-proposal.docx",
        canonical=canonical,
        missing_fields=["parking_ratio", "parking_count"],
        warnings=[],
    )
    assert summary["document_type_detected"] in {"proposal", "counter_proposal", "unknown", "lease"}
    assert any("Building:" in item for item in summary["key_terms_found"])
    assert any("Rsf" in item or "RSF" in item for item in summary["key_terms_found"])
    assert any("Parking Ratio" in item for item in summary["key_terms_missing"])
    assert any("Premises" in s for s in summary["sections_searched"])
    assert any("Operating Expenses" in s for s in summary["sections_searched"])
