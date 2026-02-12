"""In-repo brand registry for development and white-labeling."""
from __future__ import annotations

from models_branding import BrandConfig

BRANDS: dict[str, BrandConfig] = {
    "default": BrandConfig(
        brand_id="default",
        company_name="Lease Deck",
        logo_url=None,
        primary_color="#1e3a5f",
        secondary_color="#4a5568",
        font_family="Georgia, 'Times New Roman', serif",
        header_text=None,
        footer_text="Confidential",
        disclaimer_text="This analysis is for discussion purposes only. Figures are based on the assumptions provided and do not constitute legal or financial advice. Please verify all terms with your legal and real estate advisors.",
        cover_page_enabled=True,
        watermark_text=None,
        default_assumptions={},
        support_email=None,
        contact_phone=None,
        address=None,
        report_title_override=None,
        executive_summary_template=None,
        include_confidence_section=False,
        include_methodology_section=True,
        page_margin_mm=18,
        table_density="standard",
    ),
    "sample": BrandConfig(
        brand_id="sample",
        company_name="Sample Brokerage",
        logo_url=None,
        primary_color="#2c5282",
        secondary_color="#718096",
        font_family="'Segoe UI', system-ui, sans-serif",
        header_text="Real Estate Advisory",
        footer_text="Sample Brokerage · Confidential",
        disclaimer_text="This report is prepared by Sample Brokerage for discussion purposes. It does not constitute legal, tax, or financial advice. All figures are subject to verification.",
        cover_page_enabled=True,
        watermark_text=None,
        default_assumptions={"discount_rate_note": "Discount rate as provided by client."},
        support_email="advisory@samplebrokerage.com",
        contact_phone="+1 (555) 123-4567",
        address="123 Market Street, Suite 100",
        report_title_override=None,
        executive_summary_template=None,
        include_confidence_section=True,
        include_methodology_section=True,
        page_margin_mm=18,
        table_density="standard",
    ),
}


def get_brand(brand_id: str) -> BrandConfig | None:
    return BRANDS.get(brand_id)


def list_brands() -> list[BrandConfig]:
    return list(BRANDS.values())
