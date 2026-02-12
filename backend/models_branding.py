"""Brand configuration for white-labeled institutional reports."""
from __future__ import annotations

from typing import Any, Dict, Literal

from pydantic import BaseModel, Field


class BrandConfig(BaseModel):
    """Multi-tenant white-label brand for report generation."""
    brand_id: str
    company_name: str
    logo_url: str | None = None
    primary_color: str = "#1e3a5f"
    secondary_color: str = "#4a5568"
    font_family: str = "Georgia, 'Times New Roman', serif"
    header_text: str | None = None
    footer_text: str | None = None
    disclaimer_text: str = "This analysis is for discussion purposes only. Figures are based on the assumptions provided and do not constitute legal or financial advice."
    cover_page_enabled: bool = True
    watermark_text: str | None = None
    default_assumptions: Dict[str, Any] = Field(default_factory=dict)
    # Optional contact and layout (backwards compatible)
    support_email: str | None = None
    contact_phone: str | None = None
    address: str | None = None
    report_title_override: str | None = None
    executive_summary_template: str | None = None
    include_confidence_section: bool = False
    include_methodology_section: bool = True
    page_margin_mm: int = 18
    table_density: Literal["compact", "standard", "spacious"] = "standard"
