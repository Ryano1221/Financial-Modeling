# Legacy scenario and report models. Re-exported from models package.
# Original: models.py

from __future__ import annotations

import calendar
import base64
import binascii
import re
from datetime import date
from enum import Enum
from typing import Any, List, Literal, Optional, Union

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


class OpexMode(str, Enum):
    NNN = "nnn"
    BASE_YEAR = "base_year"


class OneTimeCost(BaseModel):
    """One-time cost at a specific month (tenant POV: positive = cost)."""
    name: str = ""
    amount: float = Field(ge=0.0)
    month: int = Field(ge=0)


class TerminationOption(BaseModel):
    """Optional termination: at given month, fee with probability (expected cost = fee * probability)."""
    month: int = Field(ge=0)
    fee: float = Field(ge=0.0)
    probability: float = Field(ge=0.0, le=1.0)


class RentStep(BaseModel):
    """
    Rent step specified in months from lease commencement.
    - start: starting month index (0-based, inclusive)
    - end: ending month index (0-based, inclusive)
    - rate_psf_yr: annual rent per square foot for this period
    """
    start: int = Field(ge=0, description="Start month index (0-based, inclusive)")
    end: int = Field(ge=0, description="End month index (0-based, inclusive)")
    rate_psf_yr: float = Field(ge=0.0, description="Annual base rent per RSF")

    @field_validator("end")
    @classmethod
    def validate_range(cls, v: int, info):
        start = info.data.get("start")
        if start is not None and v < start:
            raise ValueError("end month must be >= start month")
        return v


class Scenario(BaseModel):
    """
    Core input scenario for a tenant lease analysis.
    All cashflows are modeled monthly from tenant's point of view (positive = cost to tenant).
    """
    name: str
    rsf: float = Field(gt=0, description="Rentable square footage")
    commencement: date
    expiration: date
    rent_steps: List[RentStep]
    free_rent_months: int = Field(ge=0)
    ti_allowance_psf: float = Field(ge=0.0)
    opex_mode: OpexMode
    base_opex_psf_yr: float = Field(ge=0.0, description="Current annual operating expenses per RSF (year 0)")
    base_year_opex_psf_yr: float = Field(ge=0.0, description="Base year opex per RSF for base-year structures")
    opex_growth: float = Field(ge=0.0, description="Expected annual opex growth rate (e.g. 0.03 for 3%)")
    discount_rate_annual: float = Field(ge=0.0, description="Annual discount rate for NPV (as decimal)")
    parking_spaces: int = Field(ge=0, default=0)
    parking_cost_monthly_per_space: float = Field(ge=0.0, default=0.0)
    one_time_costs: List[OneTimeCost] = Field(default_factory=list)
    broker_fee: float = Field(ge=0.0, default=0.0)
    security_deposit_months: float = Field(ge=0.0, default=0.0)
    holdover_months: int = Field(ge=0, default=0)
    holdover_rent_multiplier: float = Field(ge=0.0, default=1.5)
    sublease_income_monthly: float = Field(ge=0.0, default=0.0)
    sublease_start_month: int = Field(ge=0, default=0)
    sublease_duration_months: int = Field(ge=0, default=0)
    termination_option: Optional[TerminationOption] = None

    @field_validator("free_rent_months", mode="before")
    @classmethod
    def normalize_free_rent_months(cls, v: int | List[int] | None) -> int:
        if v is None:
            return 0
        if isinstance(v, list):
            return max(0, len(v))
        return max(0, int(v))

    @property
    def term_months(self) -> int:
        y_diff = self.expiration.year - self.commencement.year
        m_diff = self.expiration.month - self.commencement.month
        months = y_diff * 12 + m_diff
        if self.expiration.day < self.commencement.day:
            months -= 1
        if self.commencement.day == 1:
            month_end = calendar.monthrange(self.expiration.year, self.expiration.month)[1]
            if self.expiration.day == month_end:
                months += 1
        return max(months, 0)

    @field_validator("rent_steps")
    @classmethod
    def validate_rent_steps(cls, steps: List[RentStep], info):
        if not steps:
            raise ValueError("at least one rent step is required")
        sorted_steps = sorted(steps, key=lambda s: (s.start, s.end))
        expected_start = 0
        for step in sorted_steps:
            if step.start != expected_start:
                raise ValueError("rent steps must be contiguous and start at month 0")
            expected_start = step.end + 1
        return sorted_steps


class RenewalInput(BaseModel):
    rent_steps: List[RentStep]
    free_rent_months: int = Field(ge=0)
    ti_allowance_psf: float = Field(ge=0.0)
    opex_mode: OpexMode
    base_opex_psf_yr: float = Field(ge=0.0)
    base_year_opex_psf_yr: float = Field(ge=0.0)
    opex_growth: float = Field(ge=0.0)
    parking_spaces: int = Field(ge=0, default=0)
    parking_cost_monthly_per_space: float = Field(ge=0.0, default=0.0)


class RelocationInput(BaseModel):
    rent_steps: List[RentStep]
    free_rent_months: int = Field(ge=0)
    ti_allowance_psf: float = Field(ge=0.0)
    moving_costs_total: float = Field(ge=0.0, default=0.0)
    it_cabling_cost: float = Field(ge=0.0, default=0.0)
    signage_cost: float = Field(ge=0.0, default=0.0)
    ffe_cost: float = Field(ge=0.0, default=0.0)
    legal_cost: float = Field(ge=0.0, default=0.0)
    downtime_months: int = Field(ge=0, default=0)
    overlap_months: int = Field(ge=0, default=0)
    broker_fee: float = Field(ge=0.0, default=0.0)
    parking_spaces: int = Field(ge=0, default=0)
    parking_cost_monthly_per_space: float = Field(ge=0.0, default=0.0)
    opex_mode: OpexMode = OpexMode.NNN
    base_opex_psf_yr: float = Field(ge=0.0, default=0.0)
    base_year_opex_psf_yr: float = Field(ge=0.0, default=0.0)
    opex_growth: float = Field(ge=0.0, default=0.0)


class GenerateScenariosRequest(BaseModel):
    rsf: float = Field(gt=0)
    target_term_months: int = Field(gt=0)
    renewal: RenewalInput
    relocation: RelocationInput
    discount_rate_annual: float = Field(ge=0.0, default=0.08)
    commencement: Optional[date] = None


class GenerateScenariosResponse(BaseModel):
    renewal: Scenario
    relocation: Scenario


class ReportBranding(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    org_id: Optional[str] = Field(default=None, validation_alias=AliasChoices("org_id", "orgId"))
    theme_hash: Optional[str] = Field(default=None, validation_alias=AliasChoices("theme_hash", "themeHash"))
    client_name: Optional[str] = None
    logo_url: Optional[str] = None
    date: Optional[str] = None
    market: Optional[str] = None
    submarket: Optional[str] = None
    broker_name: Optional[str] = None
    brand_name: Optional[str] = Field(default=None, validation_alias=AliasChoices("brand_name", "brandName"))
    logo_asset_url: Optional[str] = Field(default=None, validation_alias=AliasChoices("logo_asset_url", "logoAssetUrl"))
    logo_asset_bytes: Optional[str] = Field(default=None, validation_alias=AliasChoices("logo_asset_bytes", "logoAssetBytes", "logoAssetBase64"))
    primary_color: Optional[str] = Field(default=None, validation_alias=AliasChoices("primary_color", "primaryColor"))
    header_text: Optional[str] = Field(default=None, validation_alias=AliasChoices("header_text", "headerText"))
    footer_text: Optional[str] = Field(default=None, validation_alias=AliasChoices("footer_text", "footerText"))
    prepared_by_name: Optional[str] = Field(default=None, validation_alias=AliasChoices("prepared_by_name", "preparedByName"))
    prepared_by_title: Optional[str] = Field(default=None, validation_alias=AliasChoices("prepared_by_title", "preparedByTitle"))
    prepared_by_company: Optional[str] = Field(default=None, validation_alias=AliasChoices("prepared_by_company", "preparedByCompany"))
    prepared_by_email: Optional[str] = Field(default=None, validation_alias=AliasChoices("prepared_by_email", "preparedByEmail"))
    prepared_by_phone: Optional[str] = Field(default=None, validation_alias=AliasChoices("prepared_by_phone", "preparedByPhone"))
    disclaimer_override: Optional[str] = Field(default=None, validation_alias=AliasChoices("disclaimer_override", "disclaimerOverride"))
    cover_photo: Optional[str] = Field(default=None, validation_alias=AliasChoices("cover_photo", "coverPhoto"))
    client_logo_asset_url: Optional[str] = Field(default=None, validation_alias=AliasChoices("client_logo_asset_url", "clientLogoAssetUrl"))
    client_logo_asset_bytes: Optional[str] = Field(default=None, validation_alias=AliasChoices("client_logo_asset_bytes", "clientLogoAssetBytes", "clientLogoAssetBase64"))
    confidentiality_line: Optional[str] = Field(default=None, validation_alias=AliasChoices("confidentiality_line", "confidentialityLine"))
    report_title: Optional[str] = Field(default=None, validation_alias=AliasChoices("report_title", "reportTitle"))

    @field_validator(
        "brand_name",
        "org_id",
        "theme_hash",
        "client_name",
        "broker_name",
        "market",
        "submarket",
        "header_text",
        "footer_text",
        "prepared_by_name",
        "prepared_by_title",
        "prepared_by_company",
        "prepared_by_email",
        "prepared_by_phone",
        "confidentiality_line",
        "report_title",
        mode="before",
    )
    @classmethod
    def _trim_text_fields(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        return text[:400]

    @field_validator("disclaimer_override", mode="before")
    @classmethod
    def _trim_disclaimer(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        return text[:3000]

    @field_validator(
        "logo_url",
        "logo_asset_url",
        "cover_photo",
        "client_logo_asset_url",
        mode="before",
    )
    @classmethod
    def _validate_media_urls(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        if len(text) > 4096:
            raise ValueError("media URL is too long")
        if text.startswith(("https://", "http://", "data:image/")):
            return text
        raise ValueError("media URL must start with https://, http://, or data:image/")

    @field_validator("primary_color", mode="before")
    @classmethod
    def _validate_primary_color(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        if re.fullmatch(r"#[0-9a-fA-F]{3,8}", text):
            return text
        raise ValueError("primary_color must be a valid hex color (e.g. #111111)")

    @field_validator("logo_asset_bytes", "client_logo_asset_bytes", mode="before")
    @classmethod
    def _validate_image_asset_bytes(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        if len(text) > 2_000_000:
            raise ValueError("image asset bytes are too large")
        try:
            decoded = base64.b64decode(text, validate=True)
        except (binascii.Error, ValueError) as e:
            raise ValueError("image asset bytes must be valid base64") from e
        if len(decoded) > 1_500_000:
            raise ValueError("decoded image asset bytes exceeds 1.5MB")
        return text


class ReportScenarioEntry(BaseModel):
    scenario: dict
    result: "CashflowResult"


class CreateReportRequest(BaseModel):
    scenarios: List[ReportScenarioEntry]
    branding: Optional[ReportBranding] = None


class CreateReportResponse(BaseModel):
    report_id: str


ExtractionSource = Literal["text", "ocr", "auto_ocr"]


class ExtractionResponse(BaseModel):
    scenario: Scenario
    confidence: dict[str, float] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    source: str = ""
    text_length: int = 0
    ocr_used: bool = False
    extraction_source: ExtractionSource = "text"


class ExtractedField(BaseModel):
    value: Optional[Any] = None
    confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    citation: str = ""


class LeaseExtraction(BaseModel):
    rsf: ExtractedField = Field(default_factory=ExtractedField)
    commencement: ExtractedField = Field(default_factory=ExtractedField)
    expiration: ExtractedField = Field(default_factory=ExtractedField)
    rent_steps_table: ExtractedField = Field(default_factory=ExtractedField)
    free_rent: ExtractedField = Field(default_factory=ExtractedField)
    ti_allowance: ExtractedField = Field(default_factory=ExtractedField)
    opex_terms: ExtractedField = Field(default_factory=ExtractedField)
    base_year_language: ExtractedField = Field(default_factory=ExtractedField)
    parking_terms: ExtractedField = Field(default_factory=ExtractedField)
    options: ExtractedField = Field(default_factory=ExtractedField)
    termination_clauses: ExtractedField = Field(default_factory=ExtractedField)


class CashflowResult(BaseModel):
    term_months: int
    rent_nominal: float
    opex_nominal: float
    total_cost_nominal: float
    npv_cost: float
    avg_cost_year: float
    avg_cost_psf_year: float
    parking_nominal: float = 0.0
    one_time_nominal: float = 0.0
    broker_fee_nominal: float = 0.0
    deposit_nominal: float = 0.0
    sublease_income_nominal: float = 0.0
    npv_rent: float = 0.0
    npv_opex: float = 0.0
    npv_parking: float = 0.0
    npv_one_time: float = 0.0
    npv_total: float = 0.0


class ReportMeta(BaseModel):
    proposal_name: Optional[str] = None
    tenant_name: Optional[str] = None
    property_name: Optional[str] = None
    prepared_for: str = "—"
    prepared_by: str = "—"
    report_date: str = ""
    market: Optional[str] = None
    submarket: Optional[str] = None
    confidential: bool = True


class ReportRequest(BaseModel):
    brand_id: str = "default"
    scenario: Scenario
    meta: Optional[ReportMeta] = None
